import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

export async function createTempFixtureCopy(name: string): Promise<string> {
  const source = path.join(process.cwd(), "fixtures", name);
  const safeName = name.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const target = await fs.mkdtemp(path.join(os.tmpdir(), `vibedoctor-${safeName}-`));
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
    dependencies: { ...(config.checks?.dependencies ?? {}), enabled: false },
    privacy: {
      ...(config.checks?.privacy ?? {}),
      // Fixture tests stay deterministic/fast: external scanners opt out unless fixture sets them.
      presidio: {
        ...(config.checks?.privacy?.presidio ?? {}),
        enabled: config.checks?.privacy?.presidio?.enabled === true
      }
    },
    // Keep DPDP off for generic fixtures unless the fixture explicitly enables it.
    // When enabled, default product is opt-out scanners — force opt-out in tests for speed unless fixture enables them.
    dpdp: {
      ...(config.checks?.dpdp ?? {}),
      enabled: config.checks?.dpdp?.enabled === true,
      usePresidio: config.checks?.dpdp?.usePresidio === true || config.checks?.dpdp?.use_presidio === true,
      useSemgrep: config.checks?.dpdp?.useSemgrep === true || config.checks?.dpdp?.use_semgrep === true
    },
    flowAnalysis: {
      ...(config.checks?.flowAnalysis ?? config.checks?.flow_analysis ?? {}),
      enabled: config.checks?.flowAnalysis?.enabled === true || config.checks?.flow_analysis?.enabled === true
    }
  };
  await fs.writeFile(configPath, YAML.stringify(config), "utf8");
  return target;
}
