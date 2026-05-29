import { isWorkingTreeDirty } from "../../core/git";
import { safeFix } from "../../core/engine";

export async function runSafeFixCommand(root: string): Promise<string> {
  const dirty = await isWorkingTreeDirty(root);
  const result = await safeFix(root);

  const lines = [
    dirty ? "Warning: working tree has uncommitted changes." : "Working tree looks clean.",
    "",
    "Safe fix results:"
  ];

  for (const item of result.results) {
    lines.push(`- ${item.id}: ${item.status}`);
  }

  lines.push("", `Before: ${result.before.findings.length} findings`, `After: ${result.after.findings.length} findings`);
  return `${lines.join("\n")}\n`;
}
