import { capabilityStateLabel, isCoverageGap } from "../core/capability";
import type { ScanOutput } from "../core/engine";
import type { Finding } from "../core/finding";

// SARIF forbids a region that carries columns without a line, so positions are
// emitted together or not at all.
function buildRegion(finding: Finding) {
  if (finding.startLine === undefined) {
    return undefined;
  }

  return {
    startLine: finding.startLine,
    endLine: finding.endLine,
    startColumn: finding.startColumn,
    endColumn: finding.endColumn
  };
}

export function renderSarif(scan: ScanOutput): string {
  const gaps = scan.capabilityMatrix.tools.filter(isCoverageGap);

  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "VibeDoctor"
            }
          },
          invocations: [
            {
              executionSuccessful: scan.completeness.status !== "invalid",
              // Every tool that did not fully cover the repository is reported
              // here, so a consumer never reads an incomplete scan as a clean one.
              toolExecutionNotifications: gaps.map((tool) => ({
                level: tool.trust === "absent" ? "error" : "warning",
                message: {
                  text: `${tool.id} (${capabilityStateLabel(tool.state)}): ${tool.reason}${tool.remediation ? ` ${tool.remediation}` : ""}`
                },
                descriptor: {
                  id: `vibedoctor.coverage.${tool.id}`
                }
              }))
            }
          ],
          results: scan.findings.map((finding) => ({
            ruleId: finding.id,
            level: finding.severity === "critical" || finding.severity === "high" ? "error" : "warning",
            message: {
              text: finding.message
            },
            properties: {
              category: finding.category,
              confidence: finding.confidence,
              entityType: finding.evidence?.entityType,
              sensitivity: finding.evidence?.sensitivity,
              evidenceGrade: finding.evidenceGrade,
              fileRole: finding.fileRole,
              baselineState: finding.baselineState,
              priority: finding.priority,
              package: finding.package
            },
            suppressions: finding.suppression
              ? [
                  {
                    kind: "external",
                    status: finding.suppression.expired ? "rejected" : "accepted",
                    justification: `${finding.suppression.ruleId} (${finding.suppression.classification}): ${finding.suppression.reason}`
                  }
                ]
              : undefined,
            locations: finding.file
              ? [
                  {
                    physicalLocation: {
                      artifactLocation: {
                        uri: finding.file
                      },
                      region: buildRegion(finding)
                    }
                  }
                ]
              : undefined
          })),
          properties: {
            capabilityMatrix: scan.capabilityMatrix,
            relevance: scan.relevance,
            suppressions: scan.suppressions
          }
        }
      ]
    },
    null,
    2
  );
}
