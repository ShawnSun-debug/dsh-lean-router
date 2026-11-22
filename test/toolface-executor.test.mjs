import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NESTED_MARK,
  isNestedCall,
  markNested,
  createCodemodeExecutor,
  loadNativeExecutorModule,
  nativeDependencyMissingError,
} from '../lib/toolface/executor.js';
import { normalizeConfig } from '../lib/toolface/rules.js';

const options = normalizeConfig({});

/** The sections order read goes through ctx.get(); tests pass a minimal context. */
const EXEC_CTX = { get: () => undefined };

/** A recording fake delegate standing in for the native executor. */
function fakeDelegate() {
  const forwarded = [];
  return {
    forwarded,
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
}

test('NESTED_MARK is the shared cross-module symbol the transport stamps', () => {
  assert.equal(NESTED_MARK, Symbol.for('dsh-codemode.nested'), 'must survive module duplication');
  assert.equal(typeof NESTED_MARK.description, 'string');
});

test('isNestedCall reads the signal marker and the :ptc: id', () => {
  assert.equal(isNestedCall(undefined), false);
  assert.equal(isNestedCall(null), false);
  assert.equal(isNestedCall({ id: 'call-1', signal: markNested(new AbortController().signal) }), true);
  assert.equal(isNestedCall({ id: 'call-1:ptc:2' }), true, 'the belt-and-braces id suffix');
  assert.equal(isNestedCall({ id: 'call-1', signal: new AbortController().signal }), false);
  // the marker rides the signal instance, enumerable-false so it does not leak into logs
  const marked = markNested(new AbortController().signal);
  assert.equal(Object.keys(marked).includes(NESTED_MARK.description), false, 'non-enumerable marker');
  assert.equal(markNested('not an object'), 'not an object', 'marking is best-effort on non-objects');
});

test('the executor forwards a batch of preset-owned tools to the delegate', async () => {
  const delegate = fakeDelegate();
  const executor = createCodemodeExecutor(EXEC_CTX, options, { createDelegate: () => delegate });
  const out = await executor.execute({
    calls: [{ id: 'c1', name: 'pwsh', arguments: '{}' }],
    agent: {},
    signal: new AbortController().signal,
  });
  assert.deepEqual(delegate.forwarded, ['pwsh']);
  assert.equal(out.results[0].result.isError, false);
});

test('describe() passes the visible set through the delegate untouched', () => {
  const delegate = fakeDelegate();
  const executor = createCodemodeExecutor(EXEC_CTX, options, { createDelegate: () => delegate });
  const out = executor.describe([{ name: 'pwsh', description: 'd', parameters: {} }]);
  assert.deepEqual(out.schemas.map(s => s.name), ['pwsh']);
});

test('a model-direct call to a masked name is denied before dispatch with a self-heal hint', async () => {
  const delegate = fakeDelegate();
  const view = { enabled: true, globalNames: new Set(['mcp__fake__get_ticker']), presetNames: new Set(['pwsh']), agentNames: new Set(['mcp__fake__get_ticker', 'pwsh']) };
  const executor = createCodemodeExecutor(EXEC_CTX, options, {
    createDelegate: () => delegate,
    viewForName: () => view,
  });
  const denied = await executor.execute({
    calls: [{ id: 'c1', name: 'mcp__fake__get_ticker', arguments: '{}' }],
    agent: {},
    signal: new AbortController().signal,
  });
  assert.equal(denied.results[0].result.isError, true);
  const message = denied.results[0].result.error.message;
  assert.match(message, /mcp__fake__get_ticker/);
  assert.match(message, /code_tools_search/, 'the hint names the search tool');
  assert.match(message, /code_run/, 'the hint names the transport');
  assert.match(denied.results[0].result.content[0].text, /Error:/);
  assert.deepEqual(delegate.forwarded, [], 'denial happens before dispatch');
});

test('the transport name and marked signals are never denied', async () => {
  const delegate = fakeDelegate();
  const view = { enabled: true, globalNames: new Set(['mcp__fake__get_ticker']), presetNames: new Set(), agentNames: new Set() };
  const executor = createCodemodeExecutor(EXEC_CTX, options, { createDelegate: () => delegate, viewForName: () => view });
  await executor.execute({
    calls: [{ id: 'c1', name: 'code_run', arguments: '{}' }],
    agent: {},
    signal: new AbortController().signal,
  });
  assert.deepEqual(delegate.forwarded, ['code_run'], 'the transport is how the model reaches everything else');

  delegate.forwarded.length = 0;
  await executor.execute({
    calls: [{ id: 'c1', name: 'mcp__fake__get_ticker', arguments: '{}' }],
    agent: {},
    signal: markNested(new AbortController().signal),
  });
  assert.deepEqual(delegate.forwarded, ['mcp__fake__get_ticker'], 'a marked batch signal is program-nested');

  delegate.forwarded.length = 0;
  await executor.execute({
    calls: [{ id: 'c1:ptc:1', name: 'mcp__fake__get_ticker', arguments: '{}' }],
    agent: {},
    signal: new AbortController().signal,
  });
  assert.deepEqual(delegate.forwarded, ['mcp__fake__get_ticker'], 'the :ptc: id also admits the call');
});

test('a denied batch rejects the whole batch; allowed siblings get their own retry hint', async () => {
  const delegate = fakeDelegate();
  const view = { enabled: true, globalNames: new Set(['mcp__fake__get_ticker']), presetNames: new Set(['pwsh']), agentNames: new Set(['mcp__fake__get_ticker', 'pwsh']) };
  const executor = createCodemodeExecutor(EXEC_CTX, options, { createDelegate: () => delegate, viewForName: () => view });
  const denied = await executor.execute({
    calls: [
      { id: 'c1', name: 'pwsh', arguments: '{}' },
      { id: 'c2', name: 'mcp__fake__get_ticker', arguments: '{}' },
    ],
    agent: {},
    signal: new AbortController().signal,
  });
  assert.equal(denied.results.length, 2);
  assert.equal(denied.results[0].result.isError, true);
  assert.match(denied.results[0].result.error.message, /was not run/, 'the allowed sibling is told to re-issue alone');
  assert.equal(denied.results[1].result.isError, true);
  assert.deepEqual(delegate.forwarded, [], 'a half-executed batch is harder to reason about than a clean rejection');
});

test('guard false skips the denial but keeps the catalog masking', async () => {
  const delegate = fakeDelegate();
  const executor = createCodemodeExecutor(EXEC_CTX, normalizeConfig({ guard: false }), { createDelegate: () => delegate });
  await executor.execute({
    calls: [{ id: 'c1', name: 'mcp__fake__get_ticker', arguments: '{}' }],
    agent: {},
    signal: new AbortController().signal,
  });
  assert.deepEqual(delegate.forwarded, ['mcp__fake__get_ticker']);
});

test('the executor supplies the tools:sdk section where DSH would put its own', () => {
  const ctx = { get: (service) => service === 'systemPrompt' ? { getSectionOrder: () => 4321 } : undefined };
  const executor = createCodemodeExecutor(ctx, options, {
    createDelegate: fakeDelegate,
    sectionText: () => '## Code Mode (fixture text)',
  });
  assert.equal(executor.sections.length, 1);
  const section = executor.sections[0];
  assert.equal(section.name, 'tools:sdk');
  assert.equal(section.order, 4321);
  assert.equal(section.interpolate, false);
  assert.equal(section.text(), '## Code Mode (fixture text)');
});

test('sdkSection false drops the section entirely', () => {
  const executor = createCodemodeExecutor(EXEC_CTX, normalizeConfig({ sdkSection: false }), { createDelegate: fakeDelegate, sectionText: () => 'x' });
  assert.equal(executor.sections.length, 0);
});

test('missing dependency: the stub delegate raises the install hint on first call', async () => {
  const executor = createCodemodeExecutor(EXEC_CTX, options, {}); // no delegate, no native module
  assert.throws(() => executor.describe([{ name: 'pwsh' }]), /dsh-tool-executor-native/, 'describe raises the install hint');
  await assert.rejects(
    () => executor.execute({ calls: [{ id: 'c1', name: 'pwsh', arguments: '{}' }], signal: new AbortController().signal }),
    /dsh-tool-executor-native/,
  );
});

test('missing dependency: loadNativeExecutorModule rejects instead of breaking the import', async () => {
  // Deterministic: point the lazy loader at a specifier that cannot resolve
  // (the real dependency is installed once node_modules exists).
  await assert.rejects(() => loadNativeExecutorModule('dsh-lean-router/__missing_native_executor__'), (error) => {
    assert.ok(error instanceof Error);
    return true;
  });
});

test('the install-hint error carries the package name and the underlying cause', () => {
  const err = nativeDependencyMissingError(new Error('boom'));
  assert.match(err.message, /dsh-lean-router\/toolface/);
  assert.match(err.message, /@deepseek-ai\/dsh-tool-executor-native/);
  assert.match(err.message, /boom/);
});

test('a native module without a resolvable executor class fails loudly at mount', () => {
  assert.throws(() => createCodemodeExecutor(EXEC_CTX, options, { nativeModule: {} }), /did not export NativeToolExecutor/);
});

test('a caller-provided native module builds the delegate through it', () => {
  const constructed = [];
  const ctx = { get: () => undefined };
  const fakeClass = function (ctx) { constructed.push(ctx); return { describe: () => ({ schemas: [] }), execute: async () => ({ results: [], additionalContexts: [], concluded: false }) }; };
  const mod = { NativeToolExecutor: fakeClass };
  const executor = createCodemodeExecutor(ctx, options, { nativeModule: mod });
  executor.describe([{ name: 'pwsh' }]);
  assert.deepEqual(constructed, [ctx], 'one delegate instance is built on the provided module');
});
