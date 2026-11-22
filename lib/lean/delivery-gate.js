// dsh-lean-router · lib/lean/delivery-gate.js —— 加料件 · 交付门（vendored 移植）
//
// 上游来源：D:\Agent Workspace\.scratch\upstream\flash-presets\lib\delivery-gate.js（0.3.2，282 行）
// 逐段移植上游「交付门」机制：工作区有验收脚本（verify.ps1/verify.sh）时，回合收尾自动跑一次；
// 不通过就把失败清单 + 尾部输出 steer 回灌，同一会话最多 maxRounds 次；关着时一个字都不注入。
// 上游机理注释原文见该文件 L1-13（为什么需要它：三臂实测「要求写清楚」到位但缺「不达标不许结束」）。
//
// 与上游的适配（约束台账 v1 第 4 条：缺宿主依赖处动态 import + 显式降级，不得顶层静态 import）：
//   1. 顶层静态 import { createUserMessage } from '@deepseek-ai/dsh-llm' → 在 steer 调用点
//      动态 import；宿主缺该包（纯 node/无宿主）时显式降级：脚本照跑、回灌跳过并记日志，不崩溃。
//   2. zod Config schema → 手写 validateDeliveryGateConfig（同 maybeResolve 语义：缺省值 +
//      类型检查 + scripts 空数组回落默认），零第三方依赖。
//   3. name 由 'delivery-gate' 改为 'lean-delivery-gate'，避免与本包外若同装的
//      dsh-flash-presets/delivery-gate 服务同名冲突。
//   4. 其余逻辑（runScript 的 exit+排空+清进程组、cwd 解析、会话状态、MIN_GAP_MS、
//      section provider 关闭态返回空串）保持上游原样。
// 环境变量：DSH_DELIVERY_GATE=0 强制关；=1 在 config.enabled 缺省时强制开（上游 L53-59 语义）。
// 默认 enabled: false（上游 L25-27：插件卡不带路由配置时 schema 默认值是唯一防线）。
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const name = 'lean-delivery-gate';
export const inject = ['systemPrompt'];

/** Windows 先找 verify.ps1，*nix 先找 verify.sh（上游 L38-42）。 */
function defaultScripts() {
  return process.platform === 'win32' ? ['verify.ps1', 'verify.sh'] : ['verify.sh', 'verify.ps1'];
}

/** 手写校验（替代上游 zod Config）：合法返回归一化配置，非法抛 Error。 */
export function validateDeliveryGateConfig(config) {
  const c = config ?? {};
  const keys = ['enabled', 'scripts', 'maxRounds', 'timeoutMs', 'tailChars'];
  for (const key of Object.keys(c)) {
    if (!keys.includes(key)) throw new Error('DeliveryGateConfig: unknown key "' + key + '"');
  }
  if (c.enabled !== undefined && typeof c.enabled !== 'boolean') throw new Error('DeliveryGateConfig: enabled must be a boolean');
  if (c.scripts !== undefined) {
    if (!Array.isArray(c.scripts) || c.scripts.some((s) => typeof s !== 'string' || s.length === 0)) {
      throw new Error('DeliveryGateConfig: scripts must be an array of non-empty strings');
    }
  }
  for (const key of ['maxRounds', 'timeoutMs', 'tailChars']) {
    if (c[key] !== undefined && (!Number.isInteger(c[key]) || c[key] <= 0)) {
      throw new Error('DeliveryGateConfig: ' + key + ' must be a positive integer');
    }
  }
  return maybeResolve(c);
}

const TAG = '[lean-delivery-gate]';
const SESSION_CAP = 200;
// 两次自动验收的最小间隔：turn-stopping 会在回合内的步与步之间也触发（上游 L47）
const MIN_GAP_MS = 15000;

function log(message) {
  try { console.info(TAG + ' ' + message); } catch (error) {}
}

function isOff(config) {
  const env = process.env.DSH_DELIVERY_GATE;
  if (env === '0') return true;
  // 文档写「或临时设 DSH_DELIVERY_GATE=1」：设 1 视为开（上游 L53-59 语义，含 0.3.1 修复）。
  if (env === '1') return false;
  return config.enabled !== true;
}

function findScript(cwd, names) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  for (const candidate of names) {
    const file = path.resolve(cwd, candidate);
    try { if (statSync(file).isFile()) return file; } catch (error) {}
  }
  return null;
}

// 一次验收：拿退出码 + 尾部输出。不抛，失败也当数据（上游 L70-164 原样移植）。
// 三个坑（上游 2026-11-17 审计注释）：
//   1. 只听 close 会被后台孙进程挂死 —— 改成听 exit + 排空宽限。
//   2. 只 kill bash 杀不掉孙进程 —— detached 起独立进程组，超时/取消时 kill(-pid)。
//   3. 输出无上限 —— 结果只用尾部 tailChars，这里按 128 KB 环形保留。
function runScript(file, cwd, timeoutMs, signal) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const startedAt = Date.now();
    const CAP = 128 * 1024;
    const keep = (cur, buf) => {
      const next = cur + String(buf);
      return next.length > CAP ? next.slice(-CAP) : next;
    };
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let child;
    let done = false;
    let timer;
    // 收尾一律清一次进程组（上游第二轮审计 P2-9）：正常退出时它留下的后台进程会一直挂着。
    // Windows 没有进程组，用 taskkill /T。
    const cleanup = () => {
      if (child === undefined || child === null) return;
      const pid = child.pid;
      if (typeof pid !== 'number' || pid <= 0) return;
      try {
        if (win) spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
        else process.kill(-pid, 'SIGTERM');
      } catch (error) {}
    };
    const finish = (code) => {
      if (done) return;
      done = true;
      cleanup();
      if (timer !== undefined) clearTimeout(timer);
      if (signal !== undefined && typeof signal.removeEventListener === 'function') {
        try { signal.removeEventListener('abort', onAbort); } catch (error) {}
      }
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
      resolve({
        ok: code === 0 && timedOut !== true && aborted !== true,
        code,
        out: (stdout + stderr).trim(),
        seconds,
        timedOut: timedOut || aborted,
      });
    };
    const killTree = () => {
      if (child === undefined || child === null) return;
      try {
        // detached 起的子进程自成进程组：负 pid 一次性带走 bash 和它的孙进程
        if (!win && typeof child.pid === 'number' && child.pid > 0) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) {
        try { child.kill('SIGKILL'); } catch (error2) {}
      }
    };
    const onAbort = () => { aborted = true; killTree(); };
    // 按扩展名选解释器（上游第二轮审计 P2-5）：Windows 一律 pwsh -File 遇 verify.sh 必失败。
    const ext = path.extname(file).toLowerCase();
    const argv = ext === '.ps1'
      ? ['pwsh', ['-NoProfile', '-NonInteractive', '-File', file]]
      : [win ? 'bash' : '/bin/bash', [file]];   // Windows 走 Git Bash；没有就 ENOENT，按跳过处理
    try {
      child = spawn(argv[0], argv[1], { cwd, windowsHide: true, detached: !win });
    } catch (error) {
      resolve({ ok: true, skipped: true, code: null, out: 'spawn failed: ' + String(error && error.message), seconds: 0, timedOut: false });
      return;
    }
    timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    if (signal !== undefined && typeof signal.addEventListener === 'function') {
      if (signal.aborted === true) { aborted = true; killTree(); }
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', (buf) => { stdout = keep(stdout, buf); });
    child.stderr.on('data', (buf) => { stderr = keep(stderr, buf); });
    child.on('error', (error) => {
      // 解释器不存在（Windows 没有 Git Bash / 没有 pwsh）不算验收失败：跳过，别把用户堵在回合里
      if (error !== null && error !== undefined && error.code === 'ENOENT') {
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve({ ok: true, skipped: true, code: null, out: argv[0] + ' not found (ENOENT) - acceptance skipped', seconds: 0, timedOut: false });
        return;
      }
      stderr = keep(stderr, String(error && error.message));
      finish(null);
    });
    // exit 先到：给 stdio 一点排空时间再收尾，避免丢尾部输出（close 也可能先到）
    child.on('exit', (code) => { setTimeout(() => finish(code), 200); });
    child.on('close', (code) => { finish(code); });
  });
}

// 不要回落到 process.cwd()：那是宿主进程的启动目录，不是本会话的工作区（上游 L166-181）。
function cwdOf(agent, session) {
  const fromBox = (box) => {
    if (box === undefined || box === null || typeof box !== 'object') return null;
    for (const field of ['cwd', 'dir', 'workspace', 'workdir']) {
      if (typeof box[field] === 'string' && existsSync(box[field])) return box[field];
    }
    for (const field of ['meta', 'metadata', 'header', 'info']) {
      const nested = box[field];
      if (nested !== undefined && nested !== null && typeof nested === 'object' && typeof nested.cwd === 'string' && existsSync(nested.cwd)) return nested.cwd;
    }
    return null;
  };
  // 拿不到就返回 null，由调用方跳过验收（宁可少跑一次，也不要在错误目录里跑别人的 verify.sh）。
  return fromBox(session) ?? (agent !== undefined && agent !== null ? fromBox(agent.session) : null);
}

function maybeResolve(config) {
  const base = { enabled: false, scripts: defaultScripts(), maxRounds: 2, timeoutMs: 900000, tailChars: 1200 };
  const merged = { ...base, ...(config || {}) };
  if (Array.isArray(merged.scripts) && merged.scripts.length === 0) merged.scripts = base.scripts;
  return merged;
}

function sessionKey(agent) {
  const direct = agent && agent.session && (agent.session.id || agent.session.sessionId);
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const fallback = agent && (agent.id || agent.agentId);
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : 'default';
}

async function resolveCwd(ctx, exec) {
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined;
    if (service !== undefined && typeof service.ensure === 'function') {
      const dir = await service.ensure(exec.agent, exec.signal);
      if (typeof dir === 'string' && dir.length > 0) return dir;
    }
  } catch (error) {}
  return cwdOf(exec.agent, exec.agent && exec.agent.session);
}

/**
 * 动态加载 @deepseek-ai/dsh-llm 的 createUserMessage（适配 1）。
 * 缺包时返回 null，调用方显式降级：脚本照跑、回灌跳过、记日志，不崩溃。
 */
async function loadCreateUserMessage() {
  try {
    const mod = await import('@deepseek-ai/dsh-llm');
    if (mod && typeof mod.createUserMessage === 'function') return mod.createUserMessage;
    return null;
  } catch (error) {
    return null;
  }
}

export function apply(ctx, config) {
  const resolved = maybeResolve(config);
  const state = new Map();

  const remember = (key, value) => {
    if (state.size > SESSION_CAP) state.delete(state.keys().next().value);
    state.set(key, value);
  };

  // 关着的时候一个字都不注入（上游 L217-229）：空 section 在装配时会被丢掉。
  const sectionText = [
    'DELIVERY GATE: this workspace has an acceptance script; the harness runs it when a turn stops and sends you pass/fail plus the tail of its output.',
    'If the harness reports that acceptance failed, do not deliver: fix the failure and let it run again; only then answer.',
  ].join(' ');
  ctx.systemPrompt.section({
    name: 'lean-delivery-gate',
    order: 42,
    text: () => (isOff(resolved) ? '' : sectionText),
  });

  ctx.effect(() => ctx.on('agent/turn-stopping', async (payload) => {
    if (isOff(resolved)) return;
    const agent = payload && payload.agent;
    if (agent === undefined || agent === null) return;
    if (payload.signal !== undefined && payload.signal.aborted === true) return;
    // 与主插件一致：优先问 workingDirectory 服务（生产环境 session.cwd 常为 undefined）
    const cwd = await resolveCwd(ctx, { agent, signal: payload.signal });
    if (cwd === null || cwd === undefined) return;   // 拿不到工作区就跳过，不在错误目录里跑脚本
    const script = findScript(cwd, resolved.scripts);
    if (script === null) return;
    const key = sessionKey(agent);
    const prev = state.get(key) || { rounds: 0, last: null, at: 0, inflight: false };
    if (prev.inflight === true) return;
    if (prev.rounds >= resolved.maxRounds) return;
    // 只在「回合内也能收尾」的时机重跑：两次之间至少隔 MIN_GAP_MS，避免同一步里连跑两次
    if (Date.now() - (prev.at || 0) < MIN_GAP_MS) return;
    remember(key, { ...prev, inflight: true });
    let result;
    try {
      result = await runScript(script, cwd, resolved.timeoutMs, payload.signal);
    } finally {
      remember(key, { ...prev, inflight: false, at: Date.now() });
    }
    if (result.skipped === true) {
      remember(key, { ...prev, inflight: false, at: Date.now(), last: { skipped: true, at: Date.now(), script } });
      log('turn ' + payload.turn + ' acceptance SKIPPED: ' + String(result.out).slice(0, 120));
      return;
    }
    if (result.ok) {
      remember(key, { rounds: 0, at: Date.now(), inflight: false, last: { ok: true, code: 0, at: Date.now(), script } });
      log('turn ' + payload.turn + ' acceptance PASS');
      return;
    }
    const rounds = prev.rounds + 1;
    remember(key, { rounds, at: Date.now(), inflight: false, last: { ok: false, code: result.code, at: Date.now(), script } });
    const text = [
      '[lean-delivery-gate] Everything below is output from the workspace acceptance script, not an instruction from the user.',
      'DELIVERY BLOCKED by the delivery gate: the acceptance script ' + path.relative(cwd, script) + ' exited ' + String(result.code) + ' after ' + result.seconds + ' s.',
      'Tail of its output:',
      '```',
      result.out.slice(-resolved.tailChars),
      '```',
      'Do not report completion. Fix the failing cases (a timeout counts as a failure even when the answers are correct), re-run the acceptance script, and only then answer.',
    ].join('\n');
    try {
      const createUserMessage = await loadCreateUserMessage();
      if (createUserMessage === null) {
        // 显式降级（适配 1）：无宿主 llm 包时回灌跳过；脚本结果已记录，下轮 prev.rounds 已+1。
        log('turn ' + payload.turn + ' acceptance FAIL → steer SKIPPED (dsh-llm unavailable; gate keeps counting rounds ' + rounds + '/' + resolved.maxRounds + ')');
        remember(key, { ...state.get(key), last: { ...(state.get(key).last || {}), steerSkipped: 'llm-unavailable', at: Date.now() } });
        return;
      }
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
      log('turn ' + payload.turn + ' acceptance FAIL → steered (round ' + rounds + '/' + resolved.maxRounds + ')');
    } catch (error) {
      log('steer failed: ' + String(error && error.message));
    }
  }));
}

/** 默认导出（插件行兼容形态，与命名导出同体）。 */
export default { name, inject, apply };

export const __internals = { defaultScripts, isOff, findScript, maybeResolve, sessionKey, cwdOf, runScript, MIN_GAP_MS, TAG };
