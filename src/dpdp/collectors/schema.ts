import type { TechnicalSignalBag } from "../types";
import { pushSignal } from "./shared";

const PII_FIELD =
  /\b(email|phone|aadhaar|pan|password|address|dob|date_of_birth|passport|ssn|mobile|first_name|last_name)\b/i;
const RETENTION_FIELD = /\b(deletedAt|deleted_at|expiresAt|expires_at|ttl|retain_until|retention)\b/i;

/**
 * Structured schema extraction for Prisma models and SQL CREATE TABLE.
 * Emits store signals plus per-field evidence when personal-data columns are named.
 */
export function collectSchemaSignals(
  signals: TechnicalSignalBag[],
  file: string,
  content: string
): void {
  const isSchemaFile =
    file.endsWith(".prisma") ||
    file.endsWith(".sql") ||
    /models?\.py$|schema\.(ts|js|py)$/i.test(file);

  if (!isSchemaFile && !/\bmodel\s+\w+\s*\{/.test(content) && !/\bCREATE\s+TABLE\b/i.test(content)) {
    return;
  }

  let foundPii = false;
  let foundRetention = false;

  // Prisma models
  for (const block of content.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
    const modelName = block[1];
    const body = block[2] ?? "";
    const modelStart = content.slice(0, block.index ?? 0).split(/\r?\n/).length;

    for (const fieldLine of body.split(/\r?\n/)) {
      const trimmed = fieldLine.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
        continue;
      }
      const fieldMatch = trimmed.match(/^(\w+)\s+/);
      if (!fieldMatch) {
        continue;
      }
      const fieldName = fieldMatch[1];
      if (PII_FIELD.test(fieldName) || PII_FIELD.test(trimmed)) {
        foundPii = true;
        pushSignal(signals, {
          kind: "field",
          file,
          line: modelStart,
          field: `${modelName}.${fieldName}`,
          summary: `Personal-data field in Prisma model ${modelName}.${fieldName}`,
          confidence: "high",
          tags: ["pii-store", "schema", "prisma-field", fieldName.toLowerCase()],
          detectionMethod: "prisma-field-extract",
          relatedControls: ["DPDP-APP-001", "DPDP-RET-001", "DPDP-ERA-002"]
        });
      }
      if (RETENTION_FIELD.test(fieldName) || RETENTION_FIELD.test(trimmed)) {
        foundRetention = true;
      }
    }
  }

  // SQL CREATE TABLE
  for (const block of content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\)\s*;/gi)) {
    const tableName = block[1];
    const body = block[2] ?? "";
    const tableStart = content.slice(0, block.index ?? 0).split(/\r?\n/).length;

    for (const colLine of body.split(/,\s*\n|,\s*(?=\w)/)) {
      const colMatch = colLine.trim().match(/^["'`]?(\w+)["'`]?/);
      if (!colMatch) {
        continue;
      }
      const colName = colMatch[1];
      if (PII_FIELD.test(colName)) {
        foundPii = true;
        pushSignal(signals, {
          kind: "field",
          file,
          line: tableStart,
          field: `${tableName}.${colName}`,
          summary: `Personal-data column in SQL table ${tableName}.${colName}`,
          confidence: "high",
          tags: ["pii-store", "schema", "sql-column", colName.toLowerCase()],
          detectionMethod: "sql-column-extract",
          relatedControls: ["DPDP-APP-001", "DPDP-RET-001", "DPDP-ERA-002"]
        });
      }
      if (RETENTION_FIELD.test(colName)) {
        foundRetention = true;
      }
    }
  }

  // Fallback for ORM/schema files without Prisma/SQL blocks
  if (!foundPii && PII_FIELD.test(content) && isSchemaFile) {
    foundPii = true;
    pushSignal(signals, {
      kind: "storage",
      file,
      summary: "Personal-data fields present in schema/model",
      confidence: "high",
      tags: ["pii-store", "schema"],
      detectionMethod: "schema-scan",
      relatedControls: ["DPDP-APP-001", "DPDP-RET-001", "DPDP-ERA-002"]
    });
  }

  if (foundPii) {
    // Aggregate store signal when field-level signals were emitted
    if (!signals.some((s) => s.file === file && s.kind === "storage" && s.tags.includes("schema"))) {
      pushSignal(signals, {
        kind: "storage",
        file,
        summary: "Personal-data fields present in schema/model",
        confidence: "high",
        tags: ["pii-store", "schema"],
        detectionMethod: "schema-scan",
        relatedControls: ["DPDP-APP-001", "DPDP-RET-001", "DPDP-ERA-002"]
      });
    }
  }

  if (foundPii && (foundRetention || RETENTION_FIELD.test(content))) {
    pushSignal(signals, {
      kind: "retention",
      file,
      summary: "Retention/TTL/soft-delete field observed in schema",
      confidence: "high",
      tags: ["retention-present"],
      detectionMethod: "schema-retention",
      relatedControls: ["DPDP-RET-001"]
    });
  }
}
