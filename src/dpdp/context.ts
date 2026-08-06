import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { VibeDoctorConfig } from "../core/config";
import { pathExists } from "../core/paths";
import type { DeclaredAssertion, DpdpContext } from "./types";

export type OrgTriState = "true" | "false" | "unknown";

export const DEFAULT_DPDP_CONTEXT: DpdpContext = {
  version: 1,
  organization: {
    processesPersonalData: "unknown",
    isSignificantDataFiduciary: "unknown",
    processesChildrenData: "unknown",
    hasCrossBorderTransfer: "unknown"
  }
};

function asTriState(value: unknown): OrgTriState {
  if (value === true || value === "true" || value === "yes") {
    return "true";
  }
  if (value === false || value === "false" || value === "no") {
    return "false";
  }
  return "unknown";
}

function orgFromConfig(config: VibeDoctorConfig): DpdpContext["organization"] {
  const org = config.checks.dpdp.organization;
  return {
    processesPersonalData: org.processesPersonalData,
    isSignificantDataFiduciary: org.isSignificantDataFiduciary,
    processesChildrenData: org.processesChildrenData,
    hasCrossBorderTransfer: org.hasCrossBorderTransfer
  };
}

/**
 * Apply organisation fields only when the overlay value is not `"unknown"`.
 * Used for vibedoctor.yml defaults so explicit context.yml can still win.
 */
export function applyNonUnknownOrg(
  base: DpdpContext["organization"],
  overlay: Partial<DpdpContext["organization"]>
): DpdpContext["organization"] {
  return {
    processesPersonalData:
      overlay.processesPersonalData && overlay.processesPersonalData !== "unknown"
        ? overlay.processesPersonalData
        : base.processesPersonalData,
    isSignificantDataFiduciary:
      overlay.isSignificantDataFiduciary && overlay.isSignificantDataFiduciary !== "unknown"
        ? overlay.isSignificantDataFiduciary
        : base.isSignificantDataFiduciary,
    processesChildrenData:
      overlay.processesChildrenData && overlay.processesChildrenData !== "unknown"
        ? overlay.processesChildrenData
        : base.processesChildrenData,
    hasCrossBorderTransfer:
      overlay.hasCrossBorderTransfer && overlay.hasCrossBorderTransfer !== "unknown"
        ? overlay.hasCrossBorderTransfer
        : base.hasCrossBorderTransfer,
    industry: overlay.industry ?? base.industry,
    notes: overlay.notes ?? base.notes
  };
}

/**
 * Load optional `.vibedoctor/dpdp/context.yml` (or configured path).
 * Does not apply vibedoctor.yml organisation defaults — use {@link resolveDpdpContext}.
 */
export async function loadDpdpContext(root: string, relativePath: string): Promise<DpdpContext> {
  const absolute = path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
  if (!(await pathExists(absolute))) {
    return { ...DEFAULT_DPDP_CONTEXT, organization: { ...DEFAULT_DPDP_CONTEXT.organization } };
  }

  const raw = YAML.parse(await fs.readFile(absolute, "utf8")) as Record<string, unknown>;
  const org = (raw.organization ?? raw.org ?? {}) as Record<string, unknown>;
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    organization: {
      processesPersonalData: asTriState(org.processesPersonalData ?? org.processes_personal_data),
      isSignificantDataFiduciary: asTriState(org.isSignificantDataFiduciary ?? org.is_significant_data_fiduciary),
      processesChildrenData: asTriState(org.processesChildrenData ?? org.processes_children_data),
      hasCrossBorderTransfer: asTriState(org.hasCrossBorderTransfer ?? org.has_cross_border_transfer),
      industry: typeof org.industry === "string" ? org.industry : undefined,
      notes: typeof org.notes === "string" ? org.notes : undefined
    },
    purposes: Array.isArray(raw.purposes) ? raw.purposes.map(String) : undefined,
    processors: Array.isArray(raw.processors) ? raw.processors.map(String) : undefined,
    policies: Array.isArray(raw.policies)
      ? (raw.policies as Array<Record<string, unknown>>).map((policy) => ({
          name: String(policy.name ?? "policy"),
          path: policy.path ? String(policy.path) : undefined,
          version: policy.version ? String(policy.version) : undefined
        }))
      : undefined
  };
}

/**
 * Resolve organisational context for a DPDP scan.
 *
 * Merge order:
 * 1. Defaults (`unknown`)
 * 2. `checks.dpdp.organization` from vibedoctor.yml (non-`unknown` fields only)
 * 3. context.yml when present — full overlay for org fields (including explicit `unknown`)
 *
 * vibedoctor.yml is convenience defaults; the context file is the authoritative workspace declaration when present.
 */
export async function resolveDpdpContext(root: string, config: VibeDoctorConfig): Promise<DpdpContext> {
  const fromFile = await loadDpdpContext(root, config.checks.dpdp.contextFile);
  const contextPath = path.isAbsolute(config.checks.dpdp.contextFile)
    ? config.checks.dpdp.contextFile
    : path.join(root, config.checks.dpdp.contextFile);
  const hasContextFile = await pathExists(contextPath);

  let organization = { ...DEFAULT_DPDP_CONTEXT.organization };
  organization = applyNonUnknownOrg(organization, orgFromConfig(config));

  if (hasContextFile) {
    // Context file wins for all org keys it supplies (parsed values always set).
    organization = {
      ...organization,
      ...fromFile.organization
    };
  }

  return {
    version: fromFile.version,
    organization,
    purposes: fromFile.purposes,
    processors: fromFile.processors,
    policies: fromFile.policies
  };
}

export async function loadDeclaredEvidence(root: string, relativePath: string): Promise<DeclaredAssertion[]> {
  const absolute = path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
  if (!(await pathExists(absolute))) {
    return [];
  }

  const raw = YAML.parse(await fs.readFile(absolute, "utf8")) as Record<string, unknown>;
  const assertions = (raw.assertions ?? raw.evidence ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(assertions)) {
    return [];
  }

  return assertions
    .map((item, index) => {
      const id = String(item.id ?? `declared-${index + 1}`);
      const statement = String(item.statement ?? item.claim ?? "").trim();
      if (!statement) {
        return undefined;
      }
      const status = String(item.verificationStatus ?? item.verification_status ?? "unverified");
      return {
        id,
        statement,
        source: String(item.source ?? "declared"),
        suppliedRole: String(item.suppliedRole ?? item.supplied_role ?? "unknown"),
        date: String(item.date ?? new Date().toISOString().slice(0, 10)),
        relatedControls: Array.isArray(item.relatedControls ?? item.related_controls)
          ? ((item.relatedControls ?? item.related_controls) as unknown[]).map(String)
          : [],
        verificationStatus: (
          ["unverified", "partially_corroborated", "contradicted", "supported_by_signal"].includes(status)
            ? status
            : "unverified"
        ) as DeclaredAssertion["verificationStatus"]
      } satisfies DeclaredAssertion;
    })
    .filter((item): item is DeclaredAssertion => Boolean(item));
}

export function renderDefaultContextYaml(): string {
  return `# DPDP organisational context (optional)
# Defaults are "unknown". Do not treat these answers as deterministic verification.
# Merge order: defaults → vibedoctor.yml checks.dpdp.organization (non-unknown) → this file (authoritative when present).
version: 1
organization:
  processes_personal_data: unknown
  is_significant_data_fiduciary: unknown
  processes_children_data: unknown
  has_cross_border_transfer: unknown
  # industry: fintech
  # notes: ""
# purposes: []
# processors: []
# policies: []
`;
}

export function renderDefaultEvidenceYaml(): string {
  return `# Declared evidence for DPDP technical readiness (optional)
# Assertions are NEVER deterministic verification.
version: 1
assertions: []
# - id: ASSERT-001
#   statement: "Written processor contracts exist for all analytics vendors."
#   source: "legal/contracts-register.md"
#   supplied_role: "legal"
#   date: "2026-01-15"
#   related_controls: ["DPDP-PROC-002"]
#   verification_status: unverified
`;
}
