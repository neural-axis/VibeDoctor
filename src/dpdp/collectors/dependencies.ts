import type { TechnicalSignalBag } from "../types";
import { pushSignal } from "./shared";

export const EXTERNAL_PROCESSORS: Array<{ pattern: RegExp; name: string; kind: string }> = [
  { pattern: /\b(@sentry\/|sentry-sdk|Sentry\.init)\b/, name: "Sentry", kind: "error_tracking" },
  { pattern: /\b(mixpanel|segment|analytics\.track|posthog|amplitude|hotjar|fullstory)\b/i, name: "Analytics SDK", kind: "analytics" },
  { pattern: /\b(newrelic|datadog|@datadog|opentelemetry|otel)\b/i, name: "Telemetry platform", kind: "telemetry" },
  { pattern: /\b(twilio|sendgrid|@sendgrid|mailgun|ses\.send|nodemailer|msg91)\b/i, name: "Messaging provider", kind: "messaging" },
  { pattern: /\b(stripe|razorpay|paypal|braintree)\b/i, name: "Payment provider", kind: "payments" },
  { pattern: /\b(onfido|jumio|hyperverge|idfy|digilocker)\b/i, name: "Identity verification", kind: "identity" },
  { pattern: /\b(facebook-pixel|fbq\(|gtag\(|google-analytics|googletagmanager|adsense)\b/i, name: "Advertising SDK", kind: "advertising" },
  { pattern: /\b(openai|@openai|anthropic|@anthropic|google\.generativeai|vertexai|cohere|huggingface)\b/i, name: "LLM provider", kind: "llm" },
  { pattern: /\b(aws-sdk|@aws-sdk|@google-cloud|@azure|boto3|google\.cloud)\b/i, name: "Cloud platform", kind: "cloud" },
  { pattern: /\b(pinecone|weaviate|qdrant|chromadb|@pinecone|supabase)\b/i, name: "Vector/data store", kind: "vector_db" },
  { pattern: /\bmcpServers\b|\b@modelcontextprotocol\b/i, name: "MCP server", kind: "mcp" }
];

export function collectDependencySignals(
  signals: TechnicalSignalBag[],
  file: string,
  content: string
): void {
  const lowerFile = file.toLowerCase();

  for (const processor of EXTERNAL_PROCESSORS) {
    if (processor.pattern.test(content)) {
      pushSignal(signals, {
        kind: "external",
        file,
        summary: `External recipient signal: ${processor.name} (${processor.kind})`,
        confidence: "high",
        tags: ["external-processor", processor.kind, processor.name.toLowerCase()],
        detectionMethod: "dependency-pattern",
        relatedControls: ["DPDP-PROC-001", "DPDP-XBR-001", "DPDP-THIRD-001"]
      });
    }
  }

  if (
    /\b(region|aws_region|AWS_REGION|gcp_location|azure_location)\b/i.test(content) &&
    /\b(us-|eu-|ap-|europe|virginia|frankfurt|singapore)\b/i.test(content)
  ) {
    pushSignal(signals, {
      kind: "external",
      file,
      summary: "Cross-border or multi-region configuration signal",
      confidence: "medium",
      tags: ["cross-border"],
      detectionMethod: "region-config",
      relatedControls: ["DPDP-XBR-001"]
    });
  }

  if (
    lowerFile.endsWith("package.json") ||
    lowerFile.endsWith("pyproject.toml") ||
    lowerFile.endsWith("requirements.txt")
  ) {
    for (const processor of EXTERNAL_PROCESSORS) {
      if (processor.pattern.test(content)) {
        pushSignal(signals, {
          kind: "external",
          file,
          summary: `Dependency indicates processor: ${processor.name}`,
          confidence: "high",
          tags: ["lockfile-processor", processor.kind],
          detectionMethod: "manifest-scan",
          relatedControls: ["DPDP-PROC-001"]
        });
      }
    }
  }
}
