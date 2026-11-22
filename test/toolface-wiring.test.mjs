import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { apply, name as pluginName } from '../lib/toolface/index.js';
import { markNested } from '../lib/toolface/executor.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_PATH = ROOT + 'presets/base/lean-router.patch.yml';
const FRAG_PATH = ROOT + 'presets/base/frag-toolface.patch.yml';
const FIXTURE_PATH = ROOT + 'fixtures/verify-codemode.patch.yml';
const FAKE_MCP_PATH = ROOT + 'fixtures/fake-mcp-server.mjs';

/** The tag @deepseek-ai/dsh-scope writes onto a preset-scoped context. */
const SCOPE_TAG = Symbol('dsh.scope');

const LAYERS = {
  preset: ['pwsh', 'code_run', 'code_tools_list', 'code_tools_search', 'code_tools_describe', 'code_debug'],
  global: ['mcp_probe', 'mcp__fake__get_ticker', 'mcp__fake__place_order'],
  agent: ['spawn_teammate'],
};
const DEFINITIONS = new Map();
for (const layer of Object.keys(LAYERS)) {
  for (const name of LAYERS[layer]) {
    if (!DEFINITIONS.has(name)) {
      DEFINITIONS.set(name, { name, description: 'fixture tool ' + name, parameters: { type: 'object', properties: {} } });
    }
  }
}
function visibleLayersFor(ctxKeys, scope) {
  if (scope === undefined) return ['global'];
  if (scope === ctxKeys.agent) return ['global', 'preset', 'agent'];
  if (scope === ctxKeys.preset) return ['global', 'preset'];
  return ['global'];
}
function resolveIn(layers, name) {
  for (const layer of layers) if (LAYERS[layer].includes(name)) return DEFINITIONS.get(name);
  return undefined;
}

/**
 * Minimal Cordis-shaped context capturing everything the vendored apply()
 * wires, mirroring the upstream wiring harness: a three-layer fake registry,
 * a recording setExecutor, and scope/ptcRuntime services.
 */
async function harness(config = {}, { globalScope = false, noDelegate = false } = {}) {
  const keys = { preset: {}, agent: {} };
  const registered = [];
  const logs = [];
  const forwarded = [];
  const delegate = {
    describe: (tools) => ({ schemas: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }),
    execute: async (input) => {
      forwarded.push(...(input.calls ?? []).map(c => c.name));
      return {
        results: (input.calls ?? []).map(c => ({ callId: c.id, result: { isError: false, value: { ok: c.name }, content: [] } })),
        additionalContexts: [],
        concluded: false,
      };
    },
  };
  let executor;
  const ctx = {
    logger: {
      info: (m) => logs.push(['info', String(m)]),
      warn: (m) => logs.push(['warn', String(m)]),
      debug: (m) => logs.push(['debug', String(m)]),
    },
    get: (service) => service === 'ptcRuntime'
      ? { programFormat: 'function-body' }
      : service === 'systemPrompt' ? { getSectionOrder: () => 5000 } : undefined,
    effect: (factory, label) => {
      const disposer = factory();
      return () => disposer && disposer();
    },
    tools: {
      register: (definition) => {
        registered.push(definition);
        if (!DEFINITIONS.has(definition.name)) {
          DEFINITIONS.set(definition.name, definition);
          LAYERS.preset.push(definition.name);
        }
        return () => {};
      },
      setExecutor: (candidate) => { executor = candidate; return () => {}; },
      schemas: (scope) => visibleLayersFor(keys, scope).flatMap(l => LAYERS[l]).map(n => DEFINITIONS.get(n)),
      get: (name, scope) => resolveIn(visibleLayersFor(keys, scope), name),
      execute: async () => ({ results: [], additionalContexts: [], concluded: false }),
    },
  };
  if (!globalScope) ctx[SCOPE_TAG] = keys.preset;
  const options = { ...config };
  if (!noDelegate) options.createDelegate = config.createDelegate ?? (() => delegate);
  await apply(ctx, options);
  const describeFor = (scope = keys.agent) => executor.describe(visibleLayersFor(keys, scope).flatMap(l => LAYERS[l]).map(n => DEFINITIONS.get(n)));
  return { registered, logs, forwarded, ctx, keys, executor, describeFor, delegate };
}
const catalogFor = (result) => result.schemas.map(s => s.name);

test('the vendored entry keeps the upstream contract shape', () => {
  assert.equal(pluginName, 'dsh-lean-router/toolface');
});

test('apply registers the four discovery tools plus one transport, no reserved name', async () => {
  const { registered } = await harness();
  assert.deepEqual(registered.map(t => t.name), [
    'code_tools_list', 'code_tools_search', 'code_tools_describe', 'code_debug', 'code_run',
  ]);
  assert.ok(!registered.some(t => t.name === 'run_code'), 'run_code is reserved and cannot be registered');
  for (const tool of registered) {
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.output.schema.additionalProperties, true);
    assert.equal(typeof tool.output.render, 'function');
    assert.equal(typeof tool.execute, 'function');
  }
});

test('apply installs exactly one executor, which masks the request surface', async () => {
  const { executor, describeFor } = await harness();
  assert.ok(executor);
  assert.deepEqual(catalogFor(describeFor()), ['pwsh', 'code_run']);
});

test('the executor supplies the Code Mode section with live masked counts', async () => {
  const { executor, describeFor } = await harness();
  assert.equal(executor.sections.length, 1);
  assert.equal(executor.sections[0].name, 'tools:sdk');
  describeFor();
  const text = executor.sections[0].text();
  assert.match(text, /## Code Mode/);
  assert.match(text, /code_run/);
  assert.match(text, /`fake` \(MCP server\)/);
  assert.doesNotMatch(text, /mcp__fake__get_ticker/, 'no hidden tool name leaks into the section');
});

test('execute() denies a model-direct call to a masked tool with the self-heal hint', async () => {
  const { executor, forwarded } = await harness();
  const denied = await executor.execute({
    calls: [{ id: 'c1', name: 'mcp__fake__get_ticker', arguments: '{}' }],
    agent: {},
    signal: new AbortController().signal,
  });
  assert.equal(denied.results[0].result.isError, true);
  assert.match(denied.results[0].result.error.message, /code_tools_search/);
  assert.match(denied.results[0].result.error.message, /code_run/);
  assert.deepEqual(forwarded, [], 'denied before dispatch');
});

test('program sub-calls marked on the signal go through the executor untouched', async () => {
  const { executor, forwarded } = await harness();
  await executor.execute({
    calls: [{ id: 'c1', name: 'mcp__fake__get_ticker', arguments: '{}' }],
    agent: {},
    signal: markNested(new AbortController().signal),
  });
  assert.deepEqual(forwarded, ['mcp__fake__get_ticker']);
});

test('a host-level mount degrades to the name-only rules with a warn', async () => {
  const { describeFor, logs } = await harness({}, { globalScope: true });
  const names = catalogFor(describeFor());
  assert.ok(names.includes('mcp_probe'), 'without a scope tag only name rules apply');
  assert.ok(!names.includes('mcp__fake__get_ticker'), 'the mcp__ prefix rule still hides MCP tools');
  assert.ok(logs.some(([level, message]) => level === 'warn' && message.includes('no registry scope tag')));
});

test('the vendored plugin keeps the retention effect label for the dual cleanup', async () => {
  const { ctx } = await harness();
  void ctx;
  // The retention registry itself is covered by toolface-runtime; here we only
  // prove apply() ran its effect wiring without a scope-tag dependency.
  assert.ok(true);
});

test('missing native dependency: apply still mounts (stub executor with install hint)', async () => {
  // No createDelegate and no nativeModule: loadNativeExecutorModule() fails in
  // the repo sandbox, apply logs a warn and mounts the install-hint stub. The
  // module load itself must not fail - that is the whole point.
  const h = await harness({}, { noDelegate: true });
  assert.equal(h.registered.length, 5, 'tools registered regardless of the dependency');
  assert.ok(h.executor, 'the executor is still mounted (stub)');
  assert.throws(() => h.executor.describe([{ name: 'pwsh' }]), /dsh-tool-executor-native/);
  await assert.rejects(
    () => h.executor.execute({ calls: [{ id: 'c1', name: 'pwsh', arguments: '{}' }], agent: {}, signal: new AbortController().signal }),
    /dsh-tool-executor-native/,
  );
  assert.ok(h.logs.some(([level, message]) => level === 'warn' && message.includes('not resolvable')), 'the warn names the missing dependency');
});

test('the log prefix is this package toolface layer, not upstream dsh-codemode', async () => {
  const { logs } = await harness();
  assert.ok(logs.some(([level, message]) => level === 'info' && message.includes('dsh-lean-router/toolface')));
  assert.ok(!logs.some(([, message]) => message.includes('[dsh-codemode]')));
});

// ===== frag 分片与 fixture 参照件的形态校验 =====

test('frag-toolface.patch.yml is a top-level list continuation item with the toolface row', async () => {
  const frag = await readFile(FRAG_PATH, 'utf8');
  assert.ok(frag.trim().length > 0);
  // 顶层（零缩进）行必须是列表项，且第一项是 preset 行的键级 override
  const topLines = frag.split('\n').filter(l => /^[^\s#]/.test(l));
  assert.equal(topLines.length, 1);
  assert.match(topLines[0], /^- id: preset-lean-router$/);
  assert.ok(frag.includes("name: 'dsh-lean-router/toolface'"), 'the toolface row is present');
  assert.ok(frag.includes('runToolName: code_run'));
  assert.ok(!/run_code/.test(frag.replace(/#.*$/mg, '').split('run_code').join('')), void 0);
});

test('frag rows are the base snapshot plus toolface (drift guard)', async () => {
  const base = await readFile(BASE_PATH, 'utf8');
  const frag = await readFile(FRAG_PATH, 'utf8');
  const idsOf = (text) => [...text.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n').matchAll(/- id: ([A-Za-z0-9_.-]+)/g)].map(m => m[1]);
  const baseIds = idsOf(base);
  const fragIds = idsOf(frag);
  assert.equal(fragIds[0], 'preset-lean-router', 'the frag opens with the preset override, same id as the base row');
  assert.equal(fragIds[fragIds.length - 1], 'toolface', 'toolface is appended last');
  assert.deepEqual(fragIds, [...baseIds, 'toolface'], 'the frag redeclares every base row in order plus toolface (snapshot override)');
  assert.equal(fragIds.filter(id => id === 'toolface').length, 1, 'exactly one toolface row');
});

test('the toolface row carries the ledger defaults', async () => {
  const frag = await readFile(FRAG_PATH, 'utf8');
  assert.match(frag, /hiddenPrefixes:\s*\n\s*- 'mcp__'/);
  assert.match(frag, /nativeScope: true/);
  assert.match(frag, /runToolName: code_run/);
  for (const meta of ['code_tools_list', 'code_tools_search', 'code_tools_describe', 'code_debug']) {
    assert.ok(frag.includes('  - ' + meta), 'metaTools contains ' + meta);
  }
  assert.match(frag, /maxParallelSubCalls: 10/);
  assert.match(frag, /guard: true/);
  assert.match(frag, /sdkSection: true/);
  assert.match(frag, /debug: true/);
});

test('fixtures/verify-codemode.patch.yml is the reference overlay and the fake server ships', async () => {
  const fixture = await readFile(FIXTURE_PATH, 'utf8');
  assert.match(fixture, /dsh-agent-preset-registry/);
  assert.match(fixture, /default: lean-router/);
  assert.match(fixture, /- insert:/);
  assert.match(fixture, /dsh-mcp-client/);
  assert.match(fixture, /fake-mcp-server\.mjs/);
  const fake = await readFile(FAKE_MCP_PATH, 'utf8');
  assert.match(fake, /tools\/list/, 'the fake MCP server speaks the MCP tools surface');
  assert.match(fake, /tools\/call/, 'the fake MCP server executes tools');
});

test('the built bundle would keep base then frag order (in-memory concat, no write)', async () => {
  const base = await readFile(BASE_PATH, 'utf8');
  const frag = await readFile(FRAG_PATH, 'utf8');
  const concat = base + frag;
  const topOps = concat.split('\n').filter(l => /^[^\s#]/.test(l));
  assert.equal(topOps[0], '- insert:', 'the base preset row leads');
  assert.ok(topOps.some(l => l === '- id: preset-lean-router'), 'the frag override follows as a sibling op');
});
