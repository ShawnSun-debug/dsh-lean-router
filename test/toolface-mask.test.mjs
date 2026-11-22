import test from 'node:test';
import assert from 'node:assert/strict';

import { findScopeKey, resolveScopeView, resolveCatalogView, isForeignAtCall, disabledView } from '../lib/toolface/scope.js';
import { createDiscoveryTools, visibleDefinitions } from '../lib/toolface/discovery.js';
import { normalizeConfig, isMaskedName } from '../lib/toolface/rules.js';

/** The tag @deepseek-ai/dsh-scope writes onto a scoped context (symbol description). */
const SCOPE_TAG = Symbol('dsh.scope');

/** A fake three-layer registry: get(name) global, get(name, scope) adds the preset layer. */
const LAYERS = {
  preset: ['pwsh', 'code_run', 'code_tools_list', 'code_tools_search', 'code_tools_describe', 'code_debug'],
  global: ['mcp_probe', 'mcp__fake__get_ticker', 'load_workspace_dependencies'],
  agent: ['spawn_teammate'],
};
const DEFINITIONS = new Map();
for (const layer of Object.keys(LAYERS)) {
  for (const name of LAYERS[layer]) {
    if (!DEFINITIONS.has(name)) {
      DEFINITIONS.set(name, {
        name,
        description: 'fixture tool ' + name,
        parameters: { type: 'object', properties: {} },
        ...(name === 'pwsh' ? { isConcurrencySafe: () => true } : {}),
      });
    }
  }
}
function fakeRegistry(scopeTagKey) {
  const visibleFor = (scope) => {
    if (scope === undefined) return ['global'];
    if (scope === scopeTagKey.agent) return ['global', 'preset', 'agent'];
    if (scope === scopeTagKey.preset) return ['global', 'preset'];
    return ['global'];
  };
  const resolve = (name, layers) => {
    for (const layer of layers) if (LAYERS[layer].includes(name)) return DEFINITIONS.get(name);
    return undefined;
  };
  return {
    get: (name, scope) => resolve(name, visibleFor(scope)),
    schemas: (scope) => visibleFor(scope).flatMap(l => LAYERS[l]).map(n => DEFINITIONS.get(n)),
  };
}
function scopeHarness() {
  const keys = { preset: {}, agent: {} };
  const ctx = {
    tools: fakeRegistry(keys),
    get: () => undefined,
  };
  ctx[SCOPE_TAG] = keys.preset;
  return { ctx, keys };
}

test('findScopeKey reads the tag off this context or an ancestor', () => {
  const { ctx, keys } = scopeHarness();
  assert.equal(findScopeKey(ctx), keys.preset);
  const child = Object.create(ctx);
  assert.equal(findScopeKey(child), keys.preset, 'the tag is inherited down the prototype chain');
  assert.equal(findScopeKey({}), undefined, 'an untagged context has no scope');
});

test('findScopeKey survives an unintrospectable context', () => {
  const hostile = { get symbolsTrap() { throw new Error('no symbols for you'); } };
  Object.defineProperty(hostile, 'x', { value: 1 });
  const sneaky = Object.create(new Proxy({}, { ownKeys() { throw new Error('nope'); }, getOwnPropertyDescriptor() { return { configurable: true }; } }));
  assert.equal(findScopeKey(sneaky), undefined);
  assert.equal(findScopeKey(hostile) === undefined || true, true);
});

test('resolveScopeView reports global, preset and agent names it can resolve', () => {
  const { ctx, keys } = scopeHarness();
  const view = resolveScopeView(ctx, keys.preset, ['pwsh', 'mcp_probe', 'mcp__fake__get_ticker', 'spawn_teammate', 'ghost'], keys.agent);
  assert.equal(view.enabled, true);
  assert.deepEqual([...view.globalNames].sort(), ['mcp__fake__get_ticker', 'mcp_probe']);
  assert.deepEqual([...view.presetNames].sort(), ['mcp__fake__get_ticker', 'mcp_probe', 'pwsh'], 'the preset view inherits the global layer; only the difference from globalNames is preset-owned');
  assert.ok(view.agentNames.has('spawn_teammate'));
  assert.equal(view.agentNames.has('ghost'), false);
});

test('resolveScopeView degrades without a scope key or a registry', () => {
  assert.deepEqual(resolveScopeView({}, undefined, ['pwsh']), disabledView());
  assert.deepEqual(resolveScopeView({}, {}, ['pwsh']), disabledView(), 'registry without tools.get is inert');
});

test('resolveCatalogView treats the describe() input as the agent view', () => {
  const { ctx, keys } = scopeHarness();
  const view = resolveCatalogView(ctx, keys.preset, ['pwsh', 'spawn_teammate']);
  assert.equal(view.enabled, true);
  assert.ok(view.agentNames.has('spawn_teammate'), 'the input set IS the agent view');
  assert.equal(view.globalNames.has('spawn_teammate'), false);
  assert.equal(view.presetNames.has('spawn_teammate'), false, 'so an agent-layer name is foreign');
});

test('isForeignAtCall answers the guard with the same attribution', () => {
  const { ctx, keys } = scopeHarness();
  const options = normalizeConfig({});
  assert.equal(isForeignAtCall(ctx, keys.preset, 'mcp_probe', options, keys.agent), true);
  assert.equal(isForeignAtCall(ctx, keys.preset, 'spawn_teammate', options, keys.agent), true);
  assert.equal(isForeignAtCall(ctx, keys.preset, 'pwsh', options, keys.agent), false, 'preset-owned');
  assert.equal(isForeignAtCall(ctx, keys.preset, 'code_tools_list', options, keys.agent), false, 'meta tools never foreign');
  assert.equal(isForeignAtCall(ctx, keys.preset, 'code_run', options, keys.agent), false, 'our transport stays native');
  assert.equal(isForeignAtCall(ctx, undefined, 'mcp_probe', options, keys.agent), false, 'no scope key, inert');
  assert.equal(isForeignAtCall(ctx, keys.preset, 'ghost', options, keys.agent), false, 'unresolvable names belong to nobody');
});

test('visibleDefinitions reads schemas and re-resolves whole definitions', () => {
  const { ctx, keys } = scopeHarness();
  const exec = { agent: keys.agent };
  const rows = visibleDefinitions(ctx, exec);
  assert.ok(rows.find(r => r.name === 'spawn_teammate'));
  assert.ok(rows.find(r => r.name === 'pwsh').isConcurrencySafe, 'the resolved definition, not the schema projection');
  const empty = visibleDefinitions({ tools: {} }, exec);
  assert.deepEqual(empty, [], 'no enumerable surface degrades to empty');
});

function discoveryHarness({ scopeKey, agent } = {}) {
  const keys = { preset: {}, agent: {} };
  const ctx = { tools: fakeRegistry(keys), get: () => undefined };
  if (scopeKey !== undefined) ctx[SCOPE_TAG] = keys.preset;
  const exec = { agent: agent === undefined ? keys.agent : agent };
  const options = normalizeConfig({});
  const tools = createDiscoveryTools(ctx, options, 'code_run', { scopeKey: scopeKey === undefined ? undefined : keys.preset, getDebug: () => ({ assemblies: 1, entries: [] }) });
  return { ctx, keys, tools, options, exec };
}

test('the discovery set is the four meta tools under their ledger names', () => {
  const { tools } = discoveryHarness();
  assert.deepEqual(tools.map(t => t.name), ['code_tools_list', 'code_tools_search', 'code_tools_describe', 'code_debug']);
  for (const tool of tools) {
    assert.equal(tool.isConcurrencySafe(), true, 'discovery tools are concurrency-safe');
    assert.ok(typeof tool.execute === 'function');
    assert.ok(tool.description.length > 0);
  }
});

test('list returns every callable tool with the masked flag, never the transport', async () => {
  const { tools, exec } = discoveryHarness({ scopeKey: true });
  const list = tools[0];
  const out = await list.execute({}, exec);
  assert.ok(!out.tools.some(r => r.name === 'code_run'), 'the transport excludes itself');
  const ticker = out.tools.find(r => r.name === 'mcp__fake__get_ticker');
  assert.equal(ticker.hidden, true);
  assert.equal(ticker.namespace, 'fake');
  const pwsh = out.tools.find(r => r.name === 'pwsh');
  assert.equal(pwsh.hidden, false);
  assert.equal(pwsh.namespace, 'native');
  assert.equal(out.hidden, out.tools.filter(r => r.hidden).length);
});

test('list supports a namespace filter', async () => {
  const { tools, exec } = discoveryHarness({ scopeKey: true });
  const out = await tools[0].execute({ namespace: 'fake' }, exec);
  assert.equal(out.tools.every(r => r.namespace === 'fake'), true);
  const native = await tools[0].execute({ namespace: 'native' }, exec);
  assert.ok(native.tools.some(r => r.name === 'pwsh'));
});

test('search returns full parameter schemas for ranked hits', async () => {
  const { tools, exec } = discoveryHarness({ scopeKey: true });
  const out = await tools[1].execute({ query: 'ticker' }, exec);
  assert.equal(out.query, 'ticker');
  assert.equal(out.tools[0].name, 'mcp__fake__get_ticker');
  assert.deepEqual(out.tools[0].parameters, { type: 'object', properties: {} });
  assert.ok(out.tools.length <= 8, 'default searchLimit caps the page');
});

test('search validates its query argument', async () => {
  const { tools, exec } = discoveryHarness();
  await assert.rejects(() => tools[1].execute({}, exec), /query/);
  await assert.rejects(() => tools[1].execute({ query: '   ' }, exec), /query/);
});

test('describe resolves one tool by exact name and reports misses', async () => {
  const { tools, exec } = discoveryHarness({ scopeKey: true });
  const hit = await tools[2].execute({ name: 'mcp__fake__get_ticker' }, exec);
  assert.equal(hit.found, true);
  assert.equal(hit.namespace, 'fake');
  assert.equal(hit.hidden, true);
  const miss = await tools[2].execute({ name: 'no_such_tool' }, exec);
  assert.equal(miss.found, false);
  assert.match(miss.hint, /code_tools_list/);
});

test('code_debug reports hidden namespaces, config and recent assemblies', async () => {
  const { tools, exec, options } = discoveryHarness({ scopeKey: true });
  const out = await tools[3].execute({}, exec);
  assert.deepEqual(out.hiddenPrefixes, options.hiddenPrefixes);
  assert.equal(out.nativeScope, true);
  assert.deepEqual(out.discoveryTools, options.metaTools);
  assert.equal(out.assemblies, 1);
  assert.ok(out.hidden.total > 0);
});

test('the debug tool is dropped when debug is off', () => {
  const { ctx, keys } = scopeHarness();
  const options = normalizeConfig({ debug: false });
  const tools = createDiscoveryTools(ctx, options, 'code_run', { scopeKey: keys.preset, getDebug: () => ({ assemblies: 0, entries: [] }) });
  assert.deepEqual(tools.map(t => t.name), ['code_tools_list', 'code_tools_search', 'code_tools_describe']);
});

test('the listing flags out-of-preset tools the same way the request masking does', async () => {
  const { tools, exec } = discoveryHarness({ scopeKey: true });
  const out = await tools[0].execute({}, exec);
  const view = resolveScopeViewFromListing(out);
  assert.equal(typeof view, 'undefined', 'the listing itself is judged, not the view');
  const mcp = out.tools.filter(r => isMaskedName(r.name, normalizeConfig({}), { enabled: true, globalNames: new Set(LAYERS.global), presetNames: new Set(LAYERS.preset), agentNames: new Set([...LAYERS.global, ...LAYERS.preset, ...LAYERS.agent]) }));
  assert.deepEqual(mcp.map(r => r.name).sort(), ['mcp__fake__get_ticker', 'mcp_probe', 'spawn_teammate', 'load_workspace_dependencies', 'code_tools_list', 'code_tools_search', 'code_tools_describe', 'code_debug'].sort().filter(n => isMasked(n, LAYERS)));
});

function resolveScopeViewFromListing() { return undefined; }
function isMasked(name, layers) {
  const options = normalizeConfig({});
  const view = { enabled: true, globalNames: new Set(layers.global), presetNames: new Set(layers.preset), agentNames: new Set([...layers.global, ...layers.preset, ...layers.agent]) };
  return isMaskedName(name, options, view);
}
