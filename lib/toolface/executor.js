/**
 * [vendored @ upstream dsh-codemode 0.3.x main f9758ec1061a9a0af4f1dfefbacc19c5987b11d1]
 * Source: upstream lib/executor.js (dsh-codemode 0.3.0, main @ f9758ec).
 * Vendored for dsh-lean-router ticket-04. Adapted: the native executor
 * dependency is loaded dynamically with an explicit install-hint stub
 * (no top-level static import); everything else - the
 * Symbol.for('dsh-codemode.nested') nesting marker, isNestedCall/markNested,
 * the describe() masking and the execute() pre-dispatch denial - is unchanged.
 *
 * The plugin-owned tool executor: the seam that decides what the model sees.
 *
 * DSH 0.2.2 moved tool presentation out of the `system-prompt/assemble`
 * waterfall and into a per-scope `ToolExecutor` (`ctx.tools.setExecutor()`). The
 * registry asks the selected executor for the model-facing schemas, so an
 * executor's `describe()` **is** the request surface — which is exactly what
 * Code Mode needs in order to mask.
 *
 * Three jobs, all in one object because the registry admits only one executor
 * per scope:
 *
 * 1. `describe()` drops every tool this preset does not own, so the request
 *    carries the preset composition plus the transport and nothing else. The
 *    full definitions stay in the registry, so a program still reaches them.
 * 2. `sections` supplies the Code Mode instructions. The executor owns that
 *    text because the registry registers executor sections itself; a plugin row
 *    registering `tools:sdk` on its own would collide with it.
 * 3. `execute()` denies model-direct calls to masked names, then forwards the
 *    batch to a native executor. Denial lives here rather than in
 *    `tools.guard()` because the guard runs *inside* the delegate's pipeline,
 *    after the call is already admitted; a masked name is not in the catalog the
 *    model was given, so it must be refused before dispatch.
 *
 * Execution itself is delegated rather than re-implemented: reproducing the
 * pre-execute / approval / around-dispatch / post-execute pipeline by hand is
 * how a plugin silently drops policy. `@deepseek-ai/dsh-tool-executor-native` is
 * a plain Cordis plugin, so this package can carry it as a real dependency and
 * use its executor against the HOST registry — verified across two independent
 * installations of the module graph.
 *
 * @module dsh-codemode/executor
 */

import { isMaskedName } from './rules.js';

// [vendored dsh-lean-router 2026-11-18] The native executor module is loaded on
// demand (a dynamic import inside loadNativeExecutorModule) instead of a
// top-level static import: a deployment missing the dependency must still be
// able to import this package and register its tools, and the stub delegate
// below raises the install hint the moment it is actually called.
export function loadNativeExecutorModule(specifier = '@deepseek-ai/dsh-tool-executor-native') {
  return import(specifier);
}

// The explicit install-hint error raised by the stub delegate.
export function nativeDependencyMissingError(cause) {
  const detail = cause && cause.message ? ' Underlying error: ' + cause.message : '';
  return new Error(
    'dsh-lean-router/toolface requires the dependency "@deepseek-ai/dsh-tool-executor-native".'
    + ' Install dsh-lean-router together with its dependencies (dsh plugin add resolves them)'
    + ' or upgrade the package; until then this executor cannot run or describe tools.'
    + detail,
  );
}

// The stub delegate: every entry point raises the install hint on first call.
function createStubDelegate() {
  return {
    describe() {
      throw nativeDependencyMissingError();
    },
    execute() {
      return Promise.reject(nativeDependencyMissingError());
    },
  };
}

/** Symbol key the transport stamps onto the signal it passes to `tools.execute()`. */
export const NESTED_MARK = Symbol.for('dsh-codemode.nested');

/**
 * Whether one batch call came from inside a program rather than the model.
 *
 * The transport marks the `signal` it hands to `tools.execute()`, because the
 * batch input has no `parent` field: the registry mints execution tokens inside
 * its own pipeline, and a plugin-owned transport cannot create one. The marker
 * rides the AbortSignal instance, which a model cannot fabricate, and the
 * `:ptc:` call-id suffix is kept as a second, belt-and-braces signal.
 *
 * @param call - one batch entry.
 * @returns whether the call is program-nested.
 */
export function isNestedCall(call) {
  if (call === undefined || call === null) return false;
  const signal = call.signal;
  if (signal !== undefined && signal !== null && signal[NESTED_MARK] === true) return true;
  return String(call.id ?? '').includes(':ptc:');
}

/**
 * Mark one signal as belonging to a program sub-call.
 * @param signal - the signal the transport will pass to the registry.
 * @returns the same signal, marked.
 */
export function markNested(signal) {
  try {
    if (signal !== undefined && signal !== null && typeof signal === 'object') {
      Object.defineProperty(signal, NESTED_MARK, { value: true, enumerable: false, configurable: true });
    }
  } catch {
    /* a frozen signal still carries the `:ptc:` call id, so marking is best-effort */
  }
  return signal;
}

/**
 * The delegating executor.
 * @param ctx - the plugin's scoped context.
 * @param options - normalized plugin config.
 * @param hooks - `view(tools)` returns the attribution view for a definition
 *   set; `onDescribe(decision)` reports each decision to the debug tool;
 *   `createDelegate(ctx)` overrides the executor that runs the batch (tests
 *   inject a fake here; production uses the native executor).
 */
export function createCodemodeExecutor(ctx, options, hooks = {}) {
  // One delegate for the life of this executor: its pipeline holds the guards
  // and policy state for this scope, so it must not be rebuilt per call.
  // [vendored dsh-lean-router 2026-11-18] Delegate sources, in order: an
  // injected test delegate, a caller-provided native module, then the stub
  // that raises the install hint when the dependency is missing.
  const native = typeof hooks.createDelegate === 'function'
    ? hooks.createDelegate(ctx)
    : hooks.nativeModule
      ? new (resolveNativeExecutor(hooks.nativeModule))(ctx)
      : createStubDelegate();

  return {
    /**
     * Executor-owned prompt sections. The registry registers these itself, so
     * `tools:sdk` is provided here and nowhere else.
     */
    sections: options.sdkSection ? [{
      name: 'tools:sdk',
      // The registry allocates this position; asking it keeps the Code Mode
      // text exactly where DSH's own SDK text would have gone.
      order: ctx.get('systemPrompt')?.getSectionOrder?.('TOOLS_SDK') ?? 5000,
      interpolate: false,
      text: () => hooks.sectionText?.() ?? '',
    }] : [],

    /**
     * Model-facing schemas for one assembly: the preset composition plus this
     * package's transport, and nothing else.
     */
    describe(tools) {
      const view = hooks.view?.(tools);
      const visible = tools.filter((tool) => !isMaskedName(tool?.name, options, view));
      hooks.onDescribe?.({
        visible: visible.map((tool) => tool?.name),
        masked: tools.map((tool) => tool?.name).filter((name) => isMaskedName(name, options, view)),
        view,
      });
      return native.describe(visible);
    },

    /** Execute one batch, denying model-direct calls to masked names. */
    async execute(input) {
      const denial = (call) => denialFor(call, options, hooks, input?.signal);
      const offending = (input.calls ?? []).filter((call) => denial(call) !== undefined);
      if (offending.length === 0) return native.execute(input);

      // Answered here rather than forwarded: the delegate would run the allowed
      // siblings first, and a half-executed batch is harder for the model to
      // reason about than a clean rejection it can retry.
      const results = (input.calls ?? []).map((call) => {
        const reason = denial(call);
        return {
          callId: call.id,
          result: {
            isError: true,
            error: { message: reason ?? retryWithoutDeniedName(call) },
            content: [{ type: 'text', text: `Error: ${reason ?? retryWithoutDeniedName(call)}` }],
          },
        };
      });
      return { results, additionalContexts: [], concluded: false };
    },
  };
}

/**
 * Resolve the native executor class from the module namespace.
 *
 * DSH ships it as both a named and a default export depending on version, and a
 * missing export must fail loudly at mount rather than at the first call.
 */
function resolveNativeExecutor(module) {
  const candidate = module?.NativeToolExecutor ?? module?.default?.NativeToolExecutor ?? module?.default;
  if (typeof candidate !== 'function') {
    throw new Error('dsh-codemode: @deepseek-ai/dsh-tool-executor-native did not export NativeToolExecutor');
  }
  return candidate;
}

/**
 * The denial reason for one model-direct call, or `undefined` to allow it.
 *
 * @param call - one batch entry.
 * @param options - normalized plugin config.
 * @param hooks - attribution hooks.
 * @param batchSignal - the batch-level signal. This is where the transport's
 *   nesting marker actually lands: `tools.execute()` takes the signal once for
 *   the whole batch, and the registry copies it onto each execution, so reading
 *   only `call.signal` would miss every marked batch.
 */
function denialFor(call, options, hooks, batchSignal) {
  if (options.guard === false) return undefined;
  if (isNestedCall(call) || isMarked(batchSignal)) return undefined;
  const name = call?.name;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  // The transport is always callable: it is how the model reaches everything
  // else, so masking it would lock the session out of its own toolset.
  if (name === options.runToolName) return undefined;
  const view = hooks.viewForName?.(name);
  if (!isMaskedName(name, options, view)) return undefined;
  const searchTool = options.metaTools[1] ?? options.metaTools[0];
  return `"${name}" is not part of this session's tool list. In Code Mode, tools this preset does not own `
    + `(MCP servers, plugins outside the preset) are reachable only from inside ${options.runToolName}: call `
    + `tools.${searchTool}({ query: "..." }) there to discover it, then call it by exact name.`;
}

/** Whether a value carries this package's nesting marker. */
function isMarked(value) {
  return value !== undefined && value !== null && typeof value === 'object' && value[NESTED_MARK] === true;
}

/** Explanation for an allowed sibling that shared a batch with a denied call. */
function retryWithoutDeniedName(call) {
  return `"${call?.name}" was not run: this batch also contained a call that is not part of this session's `
    + 'tool list. Re-issue it on its own.';
}
