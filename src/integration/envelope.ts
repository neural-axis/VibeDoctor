import { createHash, randomUUID } from "node:crypto";
import type { VibeDoctorConfig } from "../core/config";
import type { ScanOutput } from "../core/engine";
import type { ExecutionPolicy } from "../core/executionPolicy";
import { fingerprintFinding, type Finding } from "../core/finding";
import { getChangedFiles, getHeadCommit, isGitRepo, isWorkingTreeDirty } from "../core/git";
import { renderJsonReport } from "../reporters/json";
import type { SourceFingerprint } from "./sourceFingerprint";

/**
 * Versioned machine envelope (`scan --report envelope`).
 *
 * It wraps the unchanged `--report json` document with what an integrating tool needs to trust
 * and reuse a result: producer version, run identity and timing, the execution profile, the
 * exact source snapshot, the configuration fingerprint, a stable fingerprint per finding, and
 * the policy-gate outcome kept separate from completeness. Contract: docs/machine-envelope.md
 * and schemas/machine-envelope.v1.schema.json. Additive changes keep the major version.
 */
export const ENVELOPE_SCHEMA = "vibedoctor.machine-envelope";
export const ENVELOPE_VERSION = "1.0.0";

type JsonReport = Record<string, unknown> & { findings: Finding[] };
export type MachineEnvelope = {
  schema: typeof ENVELOPE_SCHEMA;
  schemaVersion: string;
  producer: { name: string; version: string };
  run: {
    id: string;
    startedAt: string;
    finishedAt: string;
    mode: string;
    profile: ExecutionPolicy["profile"];
    network: boolean;
    categories: string[] | null;
  };
  repository: {
    root: string;
    source: SourceFingerprint;
    git: { head: string | null; dirty: boolean | null; changedFiles: number | null };
  };
  config: { path: string | null; fingerprint: string };
  /** Whether the scan ran to completion; a crash never produces an envelope. */
  execution: { status: "completed" };
  /** Policy gate, independent of completeness: 0 pass, 1 finding/score gate, 2 incomplete. */
  gate: { exitCode: number; status: "pass" | "fail" | "incomplete" };
  /** The `--report json` document; findings additionally carry `fingerprint`. */
  report: JsonReport;
};

const withFingerprint = (findings: unknown) =>
  Array.isArray(findings)
    ? findings.map((f: Finding) => ({ ...f, fingerprint: fingerprintFinding(f) }))
    : findings;

export async function buildMachineEnvelope(input: {
  scan: ScanOutput;
  config: VibeDoctorConfig;
  policy: ExecutionPolicy;
  version: string;
  startedAt: Date;
  finishedAt: Date;
  exitCode: number;
  categories: string[] | null;
  source: SourceFingerprint;
}): Promise<MachineEnvelope> {
  const { scan, config, policy } = input;
  const report = JSON.parse(renderJsonReport(scan)) as JsonReport;
  for (const key of ["findings", "topFindings", "privacyFindings", "dpdpFindings", "suppressedFindings"])
    if (key in report) report[key] = withFingerprint(report[key]);
  const git = (await isGitRepo(scan.root))
    ? {
        head: await getHeadCommit(scan.root),
        dirty: await isWorkingTreeDirty(scan.root),
        changedFiles: (await getChangedFiles(scan.root)).length
      }
    : { head: null, dirty: null, changedFiles: null };
  return {
    schema: ENVELOPE_SCHEMA,
    schemaVersion: ENVELOPE_VERSION,
    producer: { name: "@neuralaxis/vibedoctor", version: input.version },
    run: {
      id: randomUUID(),
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt.toISOString(),
      mode: scan.mode,
      profile: policy.profile,
      network: policy.allowNetwork,
      categories: input.categories
    },
    repository: { root: scan.root, source: input.source, git },
    config: {
      path: scan.configPath ?? null,
      fingerprint: createHash("sha256").update(JSON.stringify(config)).digest("hex")
    },
    execution: { status: "completed" },
    gate: {
      exitCode: input.exitCode,
      status: input.exitCode === 0 ? "pass" : input.exitCode === 2 ? "incomplete" : "fail"
    },
    report
  };
}
