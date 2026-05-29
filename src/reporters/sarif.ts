import type { ScanOutput } from "../core/engine";

export function renderSarif(scan: ScanOutput): string {
  return JSON.stringify(
    {
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "VibeDoctor"
            }
          },
          results: scan.findings.map((finding) => ({
            ruleId: finding.id,
            level: finding.severity === "critical" || finding.severity === "high" ? "error" : "warning",
            message: {
              text: finding.message
            },
            locations: finding.file
              ? [
                  {
                    physicalLocation: {
                      artifactLocation: {
                        uri: finding.file
                      },
                      region: {
                        startLine: finding.startLine
                      }
                    }
                  }
                ]
              : undefined
          }))
        }
      ]
    },
    null,
    2
  );
}
