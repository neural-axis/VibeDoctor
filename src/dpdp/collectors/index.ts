import { maskPiiValue } from "../../adapters/privacyDetector";
import type { ToolAdapterContext } from "../../adapters/shared";
import type { Finding } from "../../core/finding";
import type { DpdpCapabilityStatus, TechnicalSignalBag } from "../types";
import { resolveDpdpCandidateFiles, type DpdpScanScope } from "../paths";
import { confidenceMeetsThreshold, filterSignalsByConfidence } from "./confidence";
import { collectDependencySignals } from "./dependencies";
import { collectLifecycleSignals } from "./lifecycle";
import { collectOptionalScannerSignals } from "./optionalScanners";
import { collectPrivacySignals, classifyPrivacyFindingTags } from "./privacyBridge";
import { collectSafeguardSignals } from "./safeguards";
import { collectSchemaSignals } from "./schema";
import { readFileSafe } from "./shared";

export type CollectionBundle = {
  privacyFindings: Finding[];
  signals: TechnicalSignalBag[];
  filesScanned: number;
  scope: DpdpScanScope;
  scopeCapability?: DpdpCapabilityStatus;
  optionalCapabilities: DpdpCapabilityStatus[];
  candidateFiles: string[];
};

export { confidenceMeetsThreshold, filterSignalsByConfidence } from "./confidence";
export { classifyPrivacyFindingTags } from "./privacyBridge";

/**
 * Deterministic DPDP signal collection.
 * Orchestrates privacy bridge, optional scanners (Presidio/Semgrep, opt-out),
 * dependencies, schema, lifecycle, and safeguard collectors.
 */
export async function collectDpdpSignals(
  ctx: ToolAdapterContext,
  options: { optionalScannersEnabled?: boolean } = {}
): Promise<CollectionBundle> {
  const privacyCfg = ctx.config.checks.privacy;
  const dpdpCfg = ctx.config.checks.dpdp;
  const resolution = resolveDpdpCandidateFiles(ctx);
  const candidates = resolution.files;

  const { privacyFindings, signals: privacySignals } = await collectPrivacySignals(ctx, candidates);
  const optional = await collectOptionalScannerSignals(ctx, candidates, {
    enabled: options.optionalScannersEnabled
  });
  const signals: TechnicalSignalBag[] = [...privacySignals, ...optional.signals];

  let filesScanned = 0;
  for (const file of candidates) {
    const content = await readFileSafe(ctx.root, file, privacyCfg.maxFileBytes);
    if (!content) {
      continue;
    }
    filesScanned += 1;
    const lines = content.split(/\r?\n/);

    collectDependencySignals(signals, file, content);
    collectSchemaSignals(signals, file, content);
    collectLifecycleSignals(signals, file, lines);
    collectSafeguardSignals(signals, file, content, lines);
  }

  const seen = new Set<string>();
  const deduped = signals.filter((signal) => {
    const key = `${signal.kind}|${signal.file}|${signal.line}|${signal.summary}|${signal.tags.join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const filtered = filterSignalsByConfidence(deduped, dpdpCfg.minConfidenceToReport);
  return {
    privacyFindings: [...privacyFindings, ...optional.findings],
    signals: filtered,
    filesScanned,
    scope: resolution.scope,
    scopeCapability: resolution.capability,
    optionalCapabilities: optional.capabilities,
    candidateFiles: candidates
  };
}

export function maskForDpdp(value: string, entityType: string, mask: boolean): string {
  return maskPiiValue(value, entityType, mask);
}
