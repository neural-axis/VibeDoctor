export const LEFTOVER_PATTERNS = {
  legacy: ["legacy", "backward compatibility", "backwards compatibility", "compat", "shim"],
  temporary: ["todo", "fixme", "temporary", "temp", "for now", "remove later"],
  fallback: ["fallback", "just in case", "old implementation", "previous implementation"],
  deprecated: ["deprecated", "old", "unused", "dead code"]
} as const;

export const LEFTOVER_NAME_PATTERNS = ["old", "legacy", "deprecated", "compat", "fallback", "v1", "previous"];
