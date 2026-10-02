export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
}

export type ToolPreset = "none" | "default" | "full";

/**
 * The repo's single copy of "which builtin coding tools a preset may activate".
 *
 * This used to be spelled twice — here as `PRESET_FULL` and again as
 * `CODING_TOOL_NAMES` in `lib/rpc/session.ts` — so the two could drift and silently
 * disagree about the FULL tier. It lives here because a preset's membership is a
 * *policy* decision, not something `getAllTools()` can report: the registry holds
 * extension- and package-provided tools too, and only this list says which of them
 * belong to the builtin coding tiers. `lib/rpc/session.ts` now imports it from here
 * (ADR-0007 决策 5).
 *
 * The names are plain (`read`, not `builtin:read`) because 0.99.2's `getAllTools()`
 * returns `definition.name` unprefixed (`agent-session.js:1057-1068`) — verified, not
 * assumed.
 */
export const CODING_TOOL_NAMES: readonly string[] = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
];

/** The DEFAULT tier is a subset of the FULL tier, so the two cannot disagree. */
const DEFAULT_TOOL_NAMES: readonly string[] = CODING_TOOL_NAMES.filter(
  (name) => name === "read" || name === "bash" || name === "edit" || name === "write",
);

export const PRESET_NONE: string[] = [];
export const PRESET_DEFAULT: string[] = [...DEFAULT_TOOL_NAMES];
export const PRESET_FULL: string[] = [...CODING_TOOL_NAMES];

const BUILTIN_TOOL_NAMES = new Set(CODING_TOOL_NAMES);

export function getPresetFromTools(tools: ToolEntry[]): ToolPreset {
  const activeTools = tools.filter((t) => t.active);
  if (activeTools.length === 0) return "none";

  const active = activeTools
    .map((t) => t.name)
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(",");

  if (active === [...PRESET_DEFAULT].sort().join(",")) return "default";
  if (active === [...PRESET_FULL].sort().join(",")) return "full";
  return "default";
}

/**
 * Resolve a preset to the tool names to activate.
 *
 * `availableTools` is the session's `getAllTools()` output. When given, names the
 * session does not actually have are dropped — a preset is a *request*, and upstream
 * already ignores unknown names (`agent-session.js:1072-1077`), so filtering here
 * keeps the tier honest instead of silently sending names that will never resolve.
 * When omitted the preset is returned verbatim, which is what the CLI-style callers
 * (which activate tools before any registry exists) rely on.
 */
export function getToolNamesForPreset(preset: ToolPreset, availableTools?: ToolEntry[]): string[] {
  const names = preset === "none"
    ? PRESET_NONE
    : preset === "full"
      ? PRESET_FULL
      : PRESET_DEFAULT;
  if (!availableTools) return [...names];

  const available = new Set(availableTools.map((tool) => tool.name));
  return names.filter((name) => available.has(name));
}