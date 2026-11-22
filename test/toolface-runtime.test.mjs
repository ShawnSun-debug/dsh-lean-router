import test from 'node:test';
import assert from 'node:assert/strict';

import { createPool, normalizeMaxParallel, DEFAULT_MAX_PARALLEL, ABANDONED_MESSAGE } from '../lib/toolface/pool.js';
import { createRetention, rootProvider } from '../lib/toolface/retention.js';
import { createTransportTool, parameterSchema, ProgramFailedError, ToolCallFailedError } from '../lib/toolface/transport.js';
import { NESTED_MARK } from '../lib/toolface/executor.js';
import { normalizeConfig } from '../lib/toolface/rules.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// ===== pool =====
test('normalizeMaxParallel accepts a positive number and otherwise falls back', () => {
  assert.equal(normalizeMaxParallel(3), 3);
  assert.equal(normalizeMaxParallel(0), DEFAULT_MAX_PARALLEL);
  assert.equal(normalizeMaxParallel(-1), DEFAULT_MAX_PARALLEL);
  assert.equal(normalizeMaxParallel(undefined), DEFAULT_MAX_PARALLEL);
  assert.equal(DEFAULT_MAX_PARALLEL, 10, 'the ledger default');
});

test('parallel calls overlap only up to the cap, a freed slot admits the next', async () => {
  const pool = createPool(2);
  let running = 0;
  let peak = 0;
  const task = () => new Promise((done) => {
    running += 1;
    peak = Math.max(peak, running);
    setTimeout(() => { running -= 1; done(); }, 5);
  });
  await Promise.all([1, 2, 3, 4, 5].map(n => pool.run(task, 'parallel')));
  assert.equal(peak, 2);
});

test('an exclusive call waits for everything in flight and blocks what is queued behind it', async () => {
  const pool = createPool(4);
  const order = [];
  let release;
  const gate = new Promise((done) => { release = done; });
  const exclusive = pool.run(async () => { await gate; order.push('exclusive'); }, 'exclusive');
  await flush();
  const queued = pool.run(async () => { order.push('queued-parallel'); }, 'parallel');
  await flush();
  release();
  await Promise.all([exclusive, queued]);
  assert.deepEqual(order, ['exclusive', 'queued-parallel'], 'the barrier holds both directions');
});

test('abandon rejects queued entries, lets in-flight work finish, drain still waits', async () => {
  const pool = createPool(1);
  let releaseA;
  const gate = new Promise((done) => { releaseA = done; });
  const first = pool.run(() => gate, 'exclusive');
  const queued = pool.run(async () => 'never', 'exclusive');
  assert.equal(pool.abandon(), 1, 'one queued entry dropped');
  await assert.rejects(() => queued, /program ended before this sub-call/);
  releaseA();
  await assert.doesNotReject(() => first, 'in-flight work still finishes');
  await pool.drain();
  await assert.rejects(() => pool.run(async () => 'late', 'exclusive'), ABANDONED_MESSAGE === 'the program ended before this sub-call was dispatched' ? /program ended/ : /./, 'later submissions are refused');
  assert.equal(pool.stats().abandoned, true);
});

test('drain resolves immediately when nothing was submitted', async () => {
  await createPool(2).drain();
});

// ===== retention =====
/** A fake cordis context: effect() registers a disposer we can trigger. */
function fakeCtx() {
  const effects = [];
  return {
    effects,
    effect: (factory, label) => {
      const entry = { disposer: factory(), label };
      effects.push(entry);
      return () => {
        effects.splice(effects.indexOf(entry), 1);
        return entry.disposer && entry.disposer();
      };
    },
  };
}

test('rootProvider unwraps cordis service proxies down to the state owner', () => {
  const ORIGINAL = Symbol.for('cordis.original');
  const root = { release() {} };
  const proxy = { [ORIGINAL]: root };
  assert.equal(rootProvider(proxy), root);
  assert.equal(rootProvider(root), root);
  assert.equal(rootProvider(undefined), undefined);
});

test('ownerFor registers exactly one agent-scope effect per agent+provider and release runs on disposal', async () => {
  const ctx = fakeCtx();
  const retention = createRetention();
  const released = [];
  const provider = { release: (owner) => { released.push(owner); return Promise.resolve(); } };
  const agent = { ctx, session: 'agent-1' };
  const owner = retention.ownerFor(agent, provider);
  assert.equal(owner, agent, 'the agent itself is the stateOwner');
  assert.equal(retention.size(), 1);
  assert.equal(ctx.effects.length, 1);
  assert.match(ctx.effects[0].label, /dsh-codemode retained environment/, 'the effect label stays the upstream one');

  // idempotent: a second call for the same agent+provider reuses the effect
  const again = retention.ownerFor(agent, provider);
  assert.equal(again, agent);
  assert.equal(ctx.effects.length, 1, 'one cleanup per agent per provider');

  // layer 1: the agent scope disposal releases the environment
  await ctx.effects[0].disposer();
  assert.deepEqual(released, [agent]);
  assert.equal(retention.size(), 0);
});

test('a different provider under the same agent gets its own cleanup and its own release', async () => {
  const ctx = fakeCtx();
  const retention = createRetention();
  const a = { release: () => Promise.resolve() };
  const b = { release: () => Promise.resolve() };
  const agent = { ctx };
  assert.equal(retention.ownerFor(agent, a), agent);
  assert.equal(retention.ownerFor(agent, b), agent);
  assert.equal(retention.size(), 2);
  assert.equal(ctx.effects.length, 2);
  await retention.dispose();
  assert.equal(retention.size(), 0);
});

test('proxies of the same provider share one cleanup', () => {
  const ctx = fakeCtx();
  const retention = createRetention();
  const ORIGINAL = Symbol.for('cordis.original');
  const provider = { release: () => Promise.resolve() };
  const proxy1 = { [ORIGINAL]: provider };
  const proxy2 = { [ORIGINAL]: { [ORIGINAL]: provider } };
  const agent = { ctx };
  retention.ownerFor(agent, proxy1);
  const before = ctx.effects.length;
  retention.ownerFor(agent, proxy2);
  assert.equal(ctx.effects.length, before, 'the root provider is the dedupe key');
});

test('ownerFor declines retention when it cannot guarantee a release', () => {
  const retention = createRetention();
  assert.equal(retention.ownerFor(undefined, { release() {} }), undefined, 'no agent, no lifetime');
  assert.equal(retention.ownerFor({ ctx: {} }, { release() {} }), undefined, 'no effect hook');
  assert.equal(retention.ownerFor({ ctx: fakeCtx() }, {}), undefined, 'no release-capable provider');
  assert.equal(retention.ownerFor({ ctx: fakeCtx() }, undefined), undefined);
});

test('dispose releases everything, unregisters nothing to lose, and declines new owners', async () => {
  const ctx = fakeCtx();
  const retention = createRetention();
  const released = [];
  const provider = { release: (owner) => { released.push(owner); } };
  const agent = { ctx };
  retention.ownerFor(agent, provider);
  const effects = [...ctx.effects];
  await retention.dispose();
  assert.deepEqual(released, [agent]);
  assert.equal(retention.size(), 0);
  assert.equal(ctx.effects.length, 0, 'plugin unload removes the agent-scope effects it registered');
  assert.equal(retention.ownerFor(agent, provider), undefined, 'a disposed registry never mints owners again');
  void effects;
});

test('releaseAll clears outstanding pairs; a later agent disposal is a no-op', async () => {
  const ctx = fakeCtx();
  const retention = createRetention();
  let releases = 0;
  const provider = { release: () => { releases += 1; } };
  const agent = { ctx };
  retention.ownerFor(agent, provider);
  await retention.releaseAll();
  assert.equal(retention.size(), 0);
  assert.equal(releases, 1);
  const effect = [...ctx.effects][0];
  await effect.disposer();
  assert.equal(releases, 2, 'the agent effect still runs; release is idempotent by contract');
});

// ===== transport =====
const VISIBLE = [
  { name: 'pwsh', description: 'Run commands' },
  { name: 'mcp__fake__get_ticker', description: 'Get a ticker' },
  { name: 'code_tools_search', description: 'Search tools' },
];

function fakeRuntime({ timeout, programFormat = 'function-body', outcome } = {}) {
  const runs = [];
  return {
    timeout,
    programFormat,
    runs,
    resolve: (request) => ({ ...request, resolved: true }),
    async run(spec) {
      runs.push(spec);
      return outcome ?? { logs: ['hello'], value: { ok: true } };
    },
    async release() {},
  };
}

function buildTransport({ runtime = fakeRuntime(), retention, schemas = VISIBLE, execute, modes = {}, services = {}, config = {} } = {}) {
  const executed = [];
  const ctx = {
    get(name) {
      if (name === 'ptcRuntime') return runtime;
      if (Object.hasOwn(services, name)) return services[name];
      return undefined;
    },
    tools: {
      schemas: () => schemas,
      get: (name) => VISIBLE.find(s => s.name === name),
      execute: async (input) => {
        executed.push(input);
        const calls = input.calls ?? [];
        const results = [];
        for (const call of calls) {
          const outcome = execute ? await execute({ ...call, signal: input.signal }) : { isError: false, value: 'ran ' + call.name };
          results.push({ callId: call.id, result: outcome });
        }
        return { results, additionalContexts: [], concluded: false };
      },
    },
  };
  const tool = createTransportTool(ctx, normalizeConfig(config), { retention });
  return { tool, executed, runtime, ctx };
}

const PROGRAM = { code: 'return 1', description: 'do a thing' };
const EXEC = { callId: 'call-1', agent: undefined, signal: new AbortController().signal };

test('the transport registers under code_run, never the reserved run_code', () => {
  assert.equal(buildTransport().tool.name, 'code_run');
  assert.equal(normalizeConfig({}).runToolName, 'code_run');
  assert.equal(normalizeConfig({ runToolName: 'run_code' }).runToolName, 'run_code', 'config is normalized; the registry itself rejects the reserved name at register time');
});

test('parameterSchema advertises timeoutMs only when the runtime reports a descriptor', () => {
  const plain = parameterSchema({ programFormat: 'function-body' });
  assert.deepEqual(Object.keys(plain.properties).sort(), ['code', 'description']);
  assert.equal(plain.required.includes('description'), true);
  const withTimeout = parameterSchema({ programFormat: 'function-body', timeout: { defaultMs: 120000, maxMs: 600000 } });
  assert.equal(withTimeout.properties.timeoutMs.type, 'number');
  assert.match(withTimeout.properties.timeoutMs.description, /Default 120000; capped at 600000/);
});

test('the parameters getter reads the mounted runtime lazily', async () => {
  const { tool } = buildTransport();
  assert.equal(typeof tool.execute, 'function');
  const description = tool.description;
  assert.match(description, /TypeScript program/);
  assert.match(description, /ToolCallError/);
});

test('execute rejects malformed arguments before touching the runtime', async () => {
  const { tool, runtime } = buildTransport();
  await assert.rejects(() => tool.execute({}, EXEC), /non-empty program/);
  await assert.rejects(() => tool.execute({ code: '  ', description: 'x' }, EXEC), /non-empty program/);
  await assert.rejects(() => tool.execute({ code: 'return 1' }, EXEC), /description/);
  await assert.rejects(() => tool.execute({ ...PROGRAM, timeoutMs: -1 }, EXEC), /timeoutMs/);
  assert.equal(runtime.runs.length, 0);
});

test('a missing PTC runtime fails loudly instead of running unconfined', async () => {
  const ctx = { get: () => undefined, tools: buildTransport().ctx.tools };
  const tool = createTransportTool(ctx, normalizeConfig({}), {});
  await assert.rejects(() => tool.execute(PROGRAM, EXEC), /PTC runtime service/);
});

test('a runtime with no deadline descriptor refuses timeoutMs instead of forwarding it', async () => {
  const { tool } = buildTransport({ runtime: fakeRuntime() });
  await assert.rejects(() => tool.execute({ ...PROGRAM, timeoutMs: 1000 }, EXEC), /timeoutMs is not available/);
});

test('execute forwards the program and returns logs and value', async () => {
  const { tool, runtime } = buildTransport();
  const out = await tool.execute(PROGRAM, EXEC);
  assert.deepEqual(out, { logs: ['hello'], result: { ok: true } });
  assert.equal(runtime.runs.length, 1);
  const spec = runtime.runs[0];
  assert.equal(spec.program, 'return 1');
  assert.equal(spec.bindings.length, 1);
  assert.equal(spec.bindings[0].global, 'tools');
  assert.equal(spec.bindings[0].errorClass.name, 'ToolCallError');
  assert.ok(spec.bindings[0].functions.pwsh, 'every visible tool becomes a binding except the transport');
  assert.ok(!spec.bindings[0].functions.code_run);
});

test('sub-calls go through the public registry execute() with the nested marker', async () => {
  const { tool, executed, runtime } = buildTransport();
  let releaseRun;
  const gate = new Promise((done) => { releaseRun = done; });
  runtime.run = async (spec) => { runtime.runs.push(spec); await gate; return { logs: [], value: {} }; };
  const pending = tool.execute({ ...PROGRAM, code: 'return tools.pwsh({})' }, EXEC);
  await flush();
  const spec = runtime.runs[0];
  assert.ok(spec.bindings[0].functions.pwsh, 'the visible tool became a binding');
  const value = await spec.bindings[0].functions.pwsh({});
  assert.equal(value, 'ran pwsh', 'the binding resolves to the registry result');
  assert.equal(executed.length, 1);
  const batch = executed[0];
  assert.match(batch.calls[0].id, /:ptc:1$/);
  assert.equal(batch.signal[NESTED_MARK], true, 'the batch signal carries the nesting mark');
  releaseRun();
  await pending;
});

test('a failing sub-call rejects its binding with the tool error message', async () => {
  const { tool, runtime } = buildTransport({
    execute: async () => ({ isError: true, error: { message: 'pwsh exploded' } }),
  });
  let releaseRun;
  const gate = new Promise((done) => { releaseRun = done; });
  runtime.run = async (spec) => { runtime.runs.push(spec); await gate; return { logs: [], value: {} }; };
  const pending = tool.execute({ ...PROGRAM, code: 'return tools.pwsh({})' }, EXEC);
  await flush();
  const binding = runtime.runs[0].bindings[0].functions.pwsh;
  await assert.rejects(
    () => binding({}),
    (error) => {
      assert.ok(error instanceof ToolCallFailedError);
      assert.equal(error.name, 'ToolCallError');
      assert.equal(error.toolName, 'pwsh');
      assert.match(error.message, /pwsh exploded/);
      return true;
    },
  );
  releaseRun();
  await pending;
});

test('a failed program raises ProgramFailedError carrying the taxonomy and logs', async () => {
  const { tool } = buildTransport({ runtime: fakeRuntime({ outcome: { logs: ['a', 'b'], error: { kind: 'syntax', message: 'bad program' } } }) });
  await assert.rejects(
    () => tool.execute(PROGRAM, EXEC),
    (error) => {
      assert.ok(error instanceof ProgramFailedError);
      assert.match(error.message, /syntax/);
      assert.match(error.message, /bad program/);
      assert.match(error.message, /a\nb/);
      return true;
    },
  );
});

test('an agent-scoped call carries the owner retention produced, plus cwd and policy', async () => {
  const retention = { ownerFor: (agent, runtime) => agent };
  const agent = { session: 'agent-1' };
  const directories = { ensure: () => 'D:/work' };
  const policies = { resolve: () => ({ mode: 'workspace-write' }) };
  const { tool, runtime } = buildTransport({
    retention,
    services: { workingDirectory: directories, sandboxPolicy: policies },
  });
  await tool.execute(PROGRAM, { ...EXEC, agent });
  const spec = runtime.runs[0];
  assert.equal(spec.stateOwner, agent);
  assert.equal(spec.cwd, 'D:/work');
  assert.deepEqual(spec.sandboxPolicy, { mode: 'workspace-write' });
});

test('a host-level call passes no stateOwner even when retention is wired', async () => {
  const retention = { ownerFor: () => undefined };
  const { tool, runtime } = buildTransport({ retention });
  await tool.execute(PROGRAM, EXEC);
  assert.equal(runtime.runs[0].stateOwner, undefined);
});

test('an agent-scoped call without the workingDirectory service fails loudly', async () => {
  const retention = { ownerFor: (agent) => agent };
  const { tool } = buildTransport({ retention });
  await assert.rejects(() => tool.execute(PROGRAM, { ...EXEC, agent: { session: 'a' } }), /workingDirectory/);
});

test('a binding reached after the program ended is refused, the pool drains first', async () => {
  const { tool, runtime } = buildTransport();
  await tool.execute(PROGRAM, EXEC);
  // The program is over: the transport drained its pool, so a stale binding
  // the program kept alive must refuse instead of dispatching.
  const binding = runtime.runs[0].bindings[0].functions.pwsh;
  await assert.rejects(() => binding({}), /the program ended/);
  await new Promise((resolve) => setImmediate(resolve));
});

test('timeoutMs is forwarded only when the program supplied one', async () => {
  const { tool, runtime } = buildTransport({ runtime: fakeRuntime({ timeout: { defaultMs: 120000, maxMs: 600000 } }) });
  await tool.execute(PROGRAM, EXEC);
  assert.equal(runtime.runs[0].timeoutMs, undefined);
  await tool.execute({ ...PROGRAM, timeoutMs: 5000 }, EXEC);
  assert.equal(runtime.runs[1].timeoutMs, 5000);
});
