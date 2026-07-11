import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

export async function createTempFixtureCopy(name: string): Promise<string> {
  const source = path.join(process.cwd(), "fixtures", name);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), `vibedoctor-${name}-`));
  await fs.cp(source, target, { recursive: true });
  const configPath = path.join(target, "vibedoctor.yml");
  let config: Record<string, any> = { version: 1 };
  try {
    config = YAML.parse(await fs.readFile(configPath, "utf8")) as Record<string, any>;
  } catch {
    // The fixture has no custom config yet.
  }
  config.checks = {
    ...(config.checks ?? {}),
    security: { ...(config.checks?.security ?? {}), enabled: false },
    correctness: { ...(config.checks?.correctness ?? {}), enabled: false },
    tests: { ...(config.checks?.tests ?? {}), enabled: false },
    dependencies: { ...(config.checks?.dependencies ?? {}), enabled: false }
  };
  await fs.writeFile(configPath, YAML.stringify(config), "utf8");
  return target;
}
