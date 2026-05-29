import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { pathExists } from "../core/paths";

export type AgentPolicy = {
  agentPolicy: {
    allowSafeFix: boolean;
    allowDeadCodeDelete: boolean;
    allowDependencyUpgrade: boolean;
    allowPublicApiChange: boolean;
    requireTestsAfterEdit: boolean;
    requireScanAfterEdit: boolean;
  };
  approvalRequired: string[];
};

export const defaultAgentPolicy: AgentPolicy = {
  agentPolicy: {
    allowSafeFix: true,
    allowDeadCodeDelete: false,
    allowDependencyUpgrade: false,
    allowPublicApiChange: false,
    requireTestsAfterEdit: true,
    requireScanAfterEdit: true
  },
  approvalRequired: [
    "delete_file",
    "remove_backward_compatibility",
    "upgrade_dependency",
    "refactor_security_sensitive_file",
    "modify_ci_thresholds"
  ]
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePolicy(raw: unknown): AgentPolicy {
  if (!isRecord(raw)) {
    return defaultAgentPolicy;
  }

  const rawPolicy = raw.agentPolicy ?? raw.agent_policy;
  const policy = isRecord(rawPolicy) ? rawPolicy : {};
  const rawApproval = raw.approvalRequired ?? raw.approval_required;

  return {
    agentPolicy: {
      allowSafeFix: (policy.allowSafeFix as boolean | undefined) ?? (policy.allow_safe_fix as boolean | undefined) ?? defaultAgentPolicy.agentPolicy.allowSafeFix,
      allowDeadCodeDelete:
        (policy.allowDeadCodeDelete as boolean | undefined) ??
        (policy.allow_dead_code_delete as boolean | undefined) ??
        defaultAgentPolicy.agentPolicy.allowDeadCodeDelete,
      allowDependencyUpgrade:
        (policy.allowDependencyUpgrade as boolean | undefined) ??
        (policy.allow_dependency_upgrade as boolean | undefined) ??
        defaultAgentPolicy.agentPolicy.allowDependencyUpgrade,
      allowPublicApiChange:
        (policy.allowPublicApiChange as boolean | undefined) ??
        (policy.allow_public_api_change as boolean | undefined) ??
        defaultAgentPolicy.agentPolicy.allowPublicApiChange,
      requireTestsAfterEdit:
        (policy.requireTestsAfterEdit as boolean | undefined) ??
        (policy.require_tests_after_edit as boolean | undefined) ??
        defaultAgentPolicy.agentPolicy.requireTestsAfterEdit,
      requireScanAfterEdit:
        (policy.requireScanAfterEdit as boolean | undefined) ??
        (policy.require_scan_after_edit as boolean | undefined) ??
        defaultAgentPolicy.agentPolicy.requireScanAfterEdit
    },
    approvalRequired: Array.isArray(rawApproval)
      ? rawApproval.map((item) => String(item))
      : defaultAgentPolicy.approvalRequired
  };
}

export function renderAgentPolicy(policy: AgentPolicy = defaultAgentPolicy): string {
  return [
    "agent_policy:",
    `  allow_safe_fix: ${policy.agentPolicy.allowSafeFix}`,
    `  allow_dead_code_delete: ${policy.agentPolicy.allowDeadCodeDelete}`,
    `  allow_dependency_upgrade: ${policy.agentPolicy.allowDependencyUpgrade}`,
    `  allow_public_api_change: ${policy.agentPolicy.allowPublicApiChange}`,
    `  require_tests_after_edit: ${policy.agentPolicy.requireTestsAfterEdit}`,
    `  require_scan_after_edit: ${policy.agentPolicy.requireScanAfterEdit}`,
    "",
    "approval_required:",
    ...policy.approvalRequired.map((item) => `  - ${item}`),
    ""
  ].join("\n");
}

export async function loadAgentPolicy(root: string): Promise<{ policy: AgentPolicy; policyPath?: string }> {
  const policyPath = path.join(root, ".vibedoctor", "agent-policy.yml");
  if (!(await pathExists(policyPath))) {
    return { policy: defaultAgentPolicy };
  }

  const content = await fs.readFile(policyPath, "utf8");
  return { policy: normalizePolicy(YAML.parse(content)), policyPath };
}

export function getAllowedActions(policy: AgentPolicy): string[] {
  const actions = ["edit source files", "add tests"];

  if (policy.agentPolicy.allowSafeFix) {
    actions.push("run safe fixes");
  }

  if (policy.agentPolicy.allowDeadCodeDelete) {
    actions.push("delete verified high-confidence dead code");
  }

  if (policy.agentPolicy.allowDependencyUpgrade) {
    actions.push("upgrade dependencies with approval");
  }

  if (policy.agentPolicy.allowPublicApiChange) {
    actions.push("change public APIs with approval");
  }

  return actions;
}

export function getForbiddenActions(policy: AgentPolicy): string[] {
  const actions = ["disable tests", "lower thresholds"];

  if (!policy.agentPolicy.allowDeadCodeDelete) {
    actions.push("delete low-confidence dead code");
  }

  if (!policy.agentPolicy.allowDependencyUpgrade) {
    actions.push("upgrade dependencies");
  }

  if (!policy.agentPolicy.allowPublicApiChange) {
    actions.push("change public APIs without approval");
  }

  return actions;
}
