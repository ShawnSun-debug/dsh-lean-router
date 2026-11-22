import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HIDDEN_PREFIXES,
  DEFAULT_META_TOOLS,
  DEFAULT_RUN_TOOL_NAME,
  RESERVED_RUN_TOOL,
  normalizeConfig,
  isAlwaysNativeName,
  isHiddenName,
  isForeignName,
  isMaskedName,
  filterAssemblyTools,
  namespaceOf,
  isMcpToolName,
  summarizeHidden,
  truncate,
  tokenize,
  rankTools,
  buildCodemodeSectionText,
} from '../lib/toolface/rules.js';

// 台账约束 3 的默认值契约（vendored 自上游 0.3.x，不得漂移）
test('normalizeConfig applies the ledger defaults', () => {
  const options = normalizeConfig({});
  assert.deepEqual(options.hiddenPrefixes, ['mcp__']);
  assert.deepEqual(options.metaTools, ['code_tools_list', 'code_tools_search', 'code_tools_describe', 'code_debug']);
  assert.equal(options.runToolName, 'code_run');
  assert.equal(options.nativeScope, true);
  assert.equal(options.maxParallelSubCalls, 10);
  assert.equal(options.searchLimit, 8);
  assert.equal(options.guard, true);
  assert.equal(options.sdkSection, true);
  assert.equal(options.debug, true);
});

test('normalizeConfig honors overrides and clamps bad input', () => {
  const custom = normalizeConfig({ runToolName: ' my_run ', maxParallelSubCalls: 3.7, searchLimit: 0, metaTools: ['only_one'] });
  assert.equal(custom.runToolName, 'my_run');
  assert.equal(custom.maxParallelSubCalls, 3);
  assert.equal(custom.searchLimit, 8, 'invalid searchLimit falls back');
  assert.deepEqual(custom.metaTools, DEFAULT_META_TOOLS, 'a single meta tool is replaced wholesale');
  assert.equal(normalizeConfig({ nativeScope: false }).nativeScope, false);
  assert.equal(normalizeConfig({ guard: false }).guard, false);
});

test('isAlwaysNativeName exempts the reserved transport, our transport and explicit natives', () => {
  const options = normalizeConfig({ nativeTools: ['load_workspace_dependencies'] });
  assert.equal(isAlwaysNativeName(RESERVED_RUN_TOOL, options), true, 'run_code is presentation infrastructure');
  assert.equal(isAlwaysNativeName('code_run', options), true);
  assert.equal(isAlwaysNativeName('load_workspace_dependencies', options), true);
  assert.equal(isAlwaysNativeName('code_tools_list', options), false, 'meta tools are never exempt');
});

test('isHiddenName applies the name-only rules', () => {
  const options = normalizeConfig({});
  assert.equal(isHiddenName('mcp__fake__get_ticker', options), true);
  assert.equal(isHiddenName('code_tools_list', options), true, 'discovery tools hide themselves');
  assert.equal(isHiddenName('code_debug', options), true);
  assert.equal(isHiddenName('code_run', options), false);
  assert.equal(isHiddenName('pwsh', options), false);
  const tuned = normalizeConfig({ hiddenTools: ['pwsh'], nativeTools: ['mcp_probe'] });
  assert.equal(isHiddenName('pwsh', tuned), true);
  assert.equal(isHiddenName('mcp_probe', tuned), false);
});

test('isForeignName hides everything outside the preset scope view', () => {
  const options = normalizeConfig({});
  const view = {
    enabled: true,
    globalNames: new Set(['mcp_probe', 'mcp__fake__get_ticker']),
    presetNames: new Set(['pwsh', 'code_run']),
    agentNames: new Set(['mcp_probe', 'mcp__fake__get_ticker', 'pwsh', 'code_run', 'spawn_teammate']),
  };
  assert.equal(isForeignName('mcp_probe', options, view), true, 'global layer is foreign');
  assert.equal(isForeignName('mcp__fake__get_ticker', options, view), true);
  assert.equal(isForeignName('spawn_teammate', options, view), true, 'agent layer is foreign');
  assert.equal(isForeignName('pwsh', options, view), false, 'preset-owned stays native');
  assert.equal(isForeignName('code_run', options, view), false);
  assert.equal(isForeignName('ghost', options, view), false, 'unattributable names are left alone');
  assert.equal(isForeignName('pwsh', normalizeConfig({ nativeScope: false }), view), false, 'scope rule can be disabled');
  assert.equal(isForeignName('pwsh', options, { enabled: false }), false, 'no view, inert rule');
});

test('isMaskedName unions both rule sets and filterAssemblyTools drops them', () => {
  const options = normalizeConfig({});
  const view = { enabled: true, globalNames: new Set(['mcp_probe']), presetNames: new Set(['pwsh']), agentNames: new Set(['mcp_probe', 'pwsh']) };
  assert.equal(isMaskedName('mcp_probe', options, view), true);
  assert.equal(isMaskedName('pwsh', options, view), false);
  const tools = [{ name: 'pwsh' }, { name: 'mcp_probe' }, { name: 'mcp__fake__ping' }, { name: 'code_run' }];
  assert.deepEqual(filterAssemblyTools(tools, options, view).map(t => t.name), ['pwsh', 'code_run']);
});

test('summarizeHidden counts MCP namespaces and ignores the discovery tools', () => {
  const options = normalizeConfig({});
  const out = summarizeHidden(['mcp__fake__a', 'mcp__fake__b', 'mcp__okx__t', 'code_tools_list', 'code_run'], options);
  assert.equal(out.total, 3);
  assert.deepEqual(out.namespaces, [{ namespace: 'fake', count: 2, kind: 'mcp' }, { namespace: 'okx', count: 1, kind: 'mcp' }]);
});

test('namespaceOf and isMcpToolName parse MCP names', () => {
  assert.equal(namespaceOf('mcp__okx__market_get_ticker'), 'okx');
  assert.equal(namespaceOf('spawn_teammate'), 'plugin');
  assert.equal(isMcpToolName('mcp__okx__t'), true);
  assert.equal(isMcpToolName('spawn_teammate'), false);
});

test('truncate collapses whitespace and ellipsizes over the cap', () => {
  assert.equal(truncate('  a   b  ', 10), 'a b');
  const long = truncate('x'.repeat(300), 240);
  assert.equal(long.length, 240);
  assert.ok(long.endsWith('\u2026'));
});

test('tokenize splits identifiers and runs CJK into bigrams', () => {
  assert.deepEqual(tokenize('mcp__okx__market_get_ticker'), ['mcp', 'okx', 'market', 'get', 'ticker']);
  const cjk = tokenize('\u80a1\u7968\u884c\u60c5');
  assert.ok(cjk.includes('\u80a1\u7968') && cjk.includes('\u7968\u884c') && cjk.includes('\u884c\u60c5'));
});

test('rankTools prefers name hits and filters namespaces', () => {
  const rows = [
    { name: 'mcp__okx__market_get_ticker', description: 'get ticker' },
    { name: 'mcp__okx__market_get_depth', description: 'get depth' },
    { name: 'pwsh', description: 'run commands' },
  ];
  const hits = rankTools('ticker', rows, 5);
  assert.equal(hits[0].name, 'mcp__okx__market_get_ticker');
  assert.equal(rankTools('ticker', rows, 5, 'okx').length, 1);
  assert.equal(rankTools('zzz-nothing', rows, 5).length, 0);
});

test('buildCodemodeSectionText documents discovery without leaking hidden names', () => {
  const text = buildCodemodeSectionText({
    runToolName: 'code_run',
    metaTools: DEFAULT_META_TOOLS,
    hidden: { total: 3, namespaces: [{ namespace: 'fake', count: 3, kind: 'mcp' }] },
    searchLimit: 8,
    programFormat: 'function-body',
  });
  assert.match(text, /## Code Mode/);
  assert.match(text, /code_run/);
  assert.match(text, /code_tools_search/);
  assert.match(text, /3 tool\(s\) are outside this preset/);
  assert.match(text, /`fake` \(MCP server\) — 3 tool\(s\)/);
  assert.match(text, /body of an async function/);
  assert.doesNotMatch(text, /mcp__fake__get_ticker/, 'no hidden tool’s own name leaks into the section');
});

test('buildCodemodeSectionText degrades cleanly with nothing hidden', () => {
  const text = buildCodemodeSectionText({});
  assert.match(text, /No masked tools are connected right now/);
});

test('buildCodemodeSectionText switches to REPL syntax for a retained runtime', () => {
  const text = buildCodemodeSectionText({ programFormat: 'repl', hidden: { total: 0, namespaces: [] } });
  assert.match(text, /retained TypeScript REPL/);
  assert.doesNotMatch(text, /body of an async function/);
});
