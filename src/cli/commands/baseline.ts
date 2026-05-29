import { createBaseline } from "../../core/engine";

export async function runBaselineCreateCommand(root: string): Promise<string> {
  const result = await createBaseline(root);
  return `Baseline created at ${result.file} with ${result.count} findings.\n`;
}
