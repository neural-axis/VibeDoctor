import { retryTool } from "../../core/engine";

export async function runToolRetryCommand(
  root: string,
  toolId: string,
  timeoutSeconds?: number
): Promise<{ output: string; exitCode: number }> {
  const result = await retryTool(root, toolId, timeoutSeconds);
  return {
    output: `${JSON.stringify(result, null, 2)}\n`,
    exitCode: result.status === "ok" ? 0 : 2
  };
}
