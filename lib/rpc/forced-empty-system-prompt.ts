// Forced-empty system prompt — the `toolNames: []` seam.
//
// pi's `buildSystemPrompt` always produces a non-empty prompt, even with zero active
// tools. worksplice wants a genuinely empty prompt in that case, so a tool-less session
// does not carry (and does not pay for) instructions for tools it cannot call.
//
// The override cannot be a write to `agent.state.systemPrompt`: since 0.99.x that
// property is getter-only, and assigning it throws
// `TypeError: Cannot set property systemPrompt of #<Object> which has only a getter`
// (docs/spike-systemprompt-fix.md §3.2) — which made `POST /api/agent/new` with
// `toolNames: []` return 500.
//
// Two alternatives were measured and rejected (same doc, §1.3): appending an empty
// system message is a no-op, and constructing with `initialState.systemPrompt` is not
// reachable from `createAgentSessionFromServices`. The one channel that reaches the wire
// on both versions is an extension whose `before_agent_start` handler returns
// `{ systemPrompt: "" }`; the runner stores it as `forceSystemPrompt` for that turn
// (pi-coding-agent's `extensions/runner.js:1137-1143`).
//
// The field name must be `systemPrompt`, not `systemPromptOptions` — the latter exists on
// the *event* for handlers to observe, but `BeforeAgentStartEventResult` exposes only
// `message` and `systemPrompt`, and the runner ignores it.

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Inline-extension name; `builtin:`-prefixed so it reads as ours in diagnostics. */
export const FORCED_EMPTY_SYSTEM_PROMPT_EXTENSION = "builtin:worksplice-forced-empty-system-prompt";

/**
 * Live, per-session switch. The wrapper flips it through `setForceEmptySystemPrompt()`
 * (including after a `set_tools` command or a `reload`), so the handler must read the
 * current value rather than close over the value at construction time.
 */
export interface ForcedEmptySystemPromptSwitch {
  enabled: boolean;
}

/**
 * The extension factory registered through
 * `createAgentSessionServices({ resourceLoaderOptions: { extensionFactories } })`.
 *
 * Returning a result from `before_agent_start` replaces the prompt for that turn only —
 * stop returning and the normal prompt comes back, which is what lets the same extension
 * serve a session that later re-enables tools.
 */
export function forcedEmptySystemPromptExtensionFactory(
  switchState: ForcedEmptySystemPromptSwitch,
): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", () => (switchState.enabled ? { systemPrompt: "" } : undefined));
  };
}

/**
 * Build the `InlineExtension` entry for `resourceLoaderOptions.extensionFactories`.
 *
 * `hidden: true` keeps it out of the startup Extensions list — it is an internal
 * mechanism, not something a user installed or would want to toggle.
 */
export function forcedEmptySystemPromptExtension(
  switchState: ForcedEmptySystemPromptSwitch,
): { name: string; factory: ReturnType<typeof forcedEmptySystemPromptExtensionFactory>; hidden: boolean } {
  return {
    name: FORCED_EMPTY_SYSTEM_PROMPT_EXTENSION,
    factory: forcedEmptySystemPromptExtensionFactory(switchState),
    hidden: true,
  };
}