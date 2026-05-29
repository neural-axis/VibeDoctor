import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir, pathExists } from "./paths";
import { fingerprintFinding, type BaselineEntry, type Finding } from "./finding";

export type BaselineFile = {
  createdAt: string;
  findings: BaselineEntry[];
};

export async function loadBaseline(root: string, filePath: string): Promise<BaselineFile> {
  const absolutePath = path.join(root, filePath);
  if (!(await pathExists(absolutePath))) {
    return {
      createdAt: new Date().toISOString(),
      findings: []
    };
  }

  return JSON.parse(await fs.readFile(absolutePath, "utf8")) as BaselineFile;
}

export async function writeBaseline(root: string, filePath: string, findings: Finding[]): Promise<BaselineFile> {
  const absolutePath = path.join(root, filePath);
  await ensureDir(path.dirname(absolutePath));

  const baseline: BaselineFile = {
    createdAt: new Date().toISOString(),
    findings: findings.map((finding) => ({
      fingerprint: fingerprintFinding(finding)
    }))
  };

  await fs.writeFile(absolutePath, JSON.stringify(baseline, null, 2), "utf8");
  return baseline;
}
