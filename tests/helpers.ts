import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function createTempFixtureCopy(name: string): Promise<string> {
  const source = path.join(process.cwd(), "fixtures", name);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), `vibedoctor-${name}-`));
  await fs.cp(source, target, { recursive: true });
  return target;
}
