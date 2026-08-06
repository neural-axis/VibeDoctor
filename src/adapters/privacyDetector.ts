import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeFilePath, type Confidence, type Finding } from "../core/finding";
import { filterPaths } from "../core/paths";
import type { ToolAdapter, ToolAdapterContext } from "./shared";

export type PrivacySensitivity = "low" | "moderate" | "high" | "regulated_identifier" | "combination_risk";

type PrivacyMatch = {
  entityType: string;
  sensitivity: PrivacySensitivity;
  confidenceScore: number;
  title: string;
  message: string;
  file: string;
  line?: number;
  value?: string;
  maskedValue?: string;
  snippet?: string;
  matchedPattern: string;
  detectionPath: string[];
  reasons: string[];
};

type FieldSignal = {
  field: string;
  normalized: string;
  line: number;
};

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".env",
  ".md",
  ".txt",
  ".log",
  ".csv",
  ".tsv",
  ".sql",
  ".graphql",
  ".gql",
  ".xml",
  ".prisma"
]);

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const verhoeffD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
] as const;

const verhoeffP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
] as const;

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function confidenceFromScore(score: number): Confidence {
  if (score >= 0.85) {
    return "high";
  }
  if (score >= 0.6) {
    return "medium";
  }
  return "low";
}

export function passesLuhn(value: string): boolean {
  const digits = normalizeDigits(value);
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function isValidAadhaar(value: string): boolean {
  const digits = normalizeDigits(value);
  if (!/^[2-9]\d{11}$/.test(digits)) {
    return false;
  }

  let checksum = 0;
  const reversed = digits.split("").reverse().map((digit) => Number(digit));
  for (const [index, digit] of reversed.entries()) {
    checksum = verhoeffD[checksum][verhoeffP[index % 8][digit]];
  }
  return checksum === 0;
}

function looksLikePan(value: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase());
}

function isPublicIp(value: string): boolean {
  const parts = value.split(".").map((item) => Number(item));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  if (first === 10 || first === 127 || first === 0) {
    return false;
  }
  if (first === 192 && second === 168) {
    return false;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return false;
  }
  return true;
}

export function maskPiiValue(value: string, entityType: string, maskExamples = true): string {
  if (!maskExamples) {
    return value;
  }

  const trimmed = value.trim();
  const digits = normalizeDigits(trimmed);
  if (entityType === "email") {
    const [local, domain] = trimmed.split("@");
    return `${local.slice(0, 2)}***@${domain ?? ""}`;
  }
  if (entityType === "pan") {
    const upper = trimmed.toUpperCase();
    return `${upper.slice(0, 1)}****${upper.slice(5, 9)}*`;
  }
  if (entityType === "aadhaar") {
    return `********${digits.slice(-4)}`;
  }
  if (entityType === "payment_card") {
    return `${digits.slice(0, 4)}********${digits.slice(-4)}`;
  }
  if (digits.length >= 8) {
    return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
  }
  if (trimmed.length <= 3) {
    return "***";
  }
  return `${trimmed.slice(0, 2)}***`;
}

function redactKnownValues(line: string, maskExamples: boolean): string {
  let redacted = line;
  redacted = redacted.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (match) => maskPiiValue(match, "email", maskExamples));
  redacted = redacted.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, (match) => maskPiiValue(match, "pan", maskExamples));
  redacted = redacted.replace(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, (match) =>
    isValidAadhaar(match) ? maskPiiValue(match, "aadhaar", maskExamples) : match
  );
  redacted = redacted.replace(/\b(?:\d[ -]?){13,19}\b/g, (match) =>
    passesLuhn(match) ? maskPiiValue(match, "payment_card", maskExamples) : match
  );
  redacted = redacted.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (match) => maskPiiValue(match, "ip_address", maskExamples));
  redacted = redacted.replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})\b/g, (match) =>
    maskPiiValue(match, "date_of_birth", maskExamples)
  );
  redacted = redacted.replace(/(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{3,5}\)?[-.\s]?){2,}\d{3,4}/g, (match) => {
    const digits = normalizeDigits(match);
    if (digits.length < 10 || digits.length > 14 || passesLuhn(digits) || isValidAadhaar(digits)) {
      return match;
    }
    return maskPiiValue(match, "phone", maskExamples);
  });
  return redacted;
}

function redactSnippet(line: string, value: string | undefined, entityType: string, maskExamples: boolean): string {
  const compact = redactKnownValues(line.trim(), maskExamples);
  if (!value) {
    return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
  }
  const redacted = compact.replace(value, maskPiiValue(value, entityType, maskExamples));
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

function hasContext(line: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(line));
}

function isTextCandidate(file: string): boolean {
  const extension = path.extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  return /(^|\/)(openapi|schema|graphql|Dockerfile|\.env)/i.test(file);
}

function fieldEntity(field: string): Pick<PrivacyMatch, "entityType" | "sensitivity" | "confidenceScore" | "matchedPattern" | "reasons"> | undefined {
  const normalized = normalizeFieldName(field);
  const reason = `field name '${field}' matched privacy vocabulary`;

  if (/aadhaar|aadhar|uidai/.test(normalized)) {
    return { entityType: "aadhaar", sensitivity: "regulated_identifier", confidenceScore: 0.82, matchedPattern: "aadhaar-field", reasons: [reason] };
  }
  if (/^(?:permanentaccountnumber|pan(?:number|no|card)?)$/.test(normalized)) {
    return { entityType: "pan", sensitivity: "regulated_identifier", confidenceScore: 0.82, matchedPattern: "pan-field", reasons: [reason] };
  }
  if (/passport/.test(normalized)) {
    return { entityType: "passport", sensitivity: "regulated_identifier", confidenceScore: 0.78, matchedPattern: "passport-field", reasons: [reason] };
  }
  if (/creditcard|cardnumber|paymentcard/.test(normalized)) {
    return { entityType: "payment_card", sensitivity: "regulated_identifier", confidenceScore: 0.78, matchedPattern: "payment-card-field", reasons: [reason] };
  }
  if (/bankaccount|accountnumber|accountno|iban|ifsc/.test(normalized)) {
    return { entityType: "bank_account", sensitivity: "regulated_identifier", confidenceScore: 0.76, matchedPattern: "bank-account-field", reasons: [reason] };
  }
  if (/email|mailaddress/.test(normalized)) {
    return { entityType: "email", sensitivity: "low", confidenceScore: 0.7, matchedPattern: "email-field", reasons: [reason] };
  }
  if (/phone|mobile|telephone|contactnumber|contactno/.test(normalized)) {
    return { entityType: "phone", sensitivity: "moderate", confidenceScore: 0.68, matchedPattern: "phone-field", reasons: [reason] };
  }
  if (/dateofbirth|birthdate|dob/.test(normalized)) {
    return { entityType: "date_of_birth", sensitivity: "moderate", confidenceScore: 0.72, matchedPattern: "dob-field", reasons: [reason] };
  }
  if (/address|street|postcode|postalcode|zipcode|zip/.test(normalized)) {
    return { entityType: "address", sensitivity: "moderate", confidenceScore: 0.66, matchedPattern: "address-field", reasons: [reason] };
  }
  if (/ipaddress|clientip|remoteaddr|remoteaddress/.test(normalized)) {
    return { entityType: "ip_address", sensitivity: "moderate", confidenceScore: 0.7, matchedPattern: "ip-field", reasons: [reason] };
  }
  if (/deviceid|cookieid|advertisingid|imei|imsi/.test(normalized)) {
    return { entityType: "device_id", sensitivity: "moderate", confidenceScore: 0.72, matchedPattern: "device-field", reasons: [reason] };
  }
  if (/(employee|customer|user|patient|applicant|member|policy)(id|number|no)$/.test(normalized)) {
    return { entityType: "person_linkable_id", sensitivity: "moderate", confidenceScore: 0.65, matchedPattern: "person-id-field", reasons: [reason] };
  }
  if (/medicalrecord|patientdiagnosis|diagnosis|patientcondition|healthcondition|prescription/.test(normalized)) {
    return { entityType: "health_data", sensitivity: "high", confidenceScore: 0.78, matchedPattern: "health-field", reasons: [reason] };
  }
  if (/salary|income|payroll|compensation/.test(normalized)) {
    return { entityType: "financial_attribute", sensitivity: "high", confidenceScore: 0.74, matchedPattern: "financial-field", reasons: [reason] };
  }
  if (/disciplinary|performancereview|terminationreason/.test(normalized)) {
    return { entityType: "employment_sensitive", sensitivity: "high", confidenceScore: 0.74, matchedPattern: "employment-sensitive-field", reasons: [reason] };
  }
  if (/preciselocation|gps|latitude|longitude|geolocation/.test(normalized)) {
    return { entityType: "precise_location", sensitivity: "high", confidenceScore: 0.74, matchedPattern: "location-field", reasons: [reason] };
  }

  return undefined;
}

function extractFields(file: string, line: string, lineNumber: number): FieldSignal[] {
  const fields: FieldSignal[] = [];
  const trimmed = line.trim();
  const extension = path.extname(file).toLowerCase();

  if ((extension === ".csv" || extension === ".tsv") && lineNumber <= 5) {
    const separator = extension === ".tsv" ? "\t" : ",";
    const cells = trimmed.split(separator).map((cell) => cell.trim().replace(/^["']|["']$/g, ""));
    if (cells.length > 1 && cells.every((cell) => /^[A-Za-z_][A-Za-z0-9_. -]{0,80}$/.test(cell))) {
      for (const cell of cells) {
        fields.push({ field: cell, normalized: normalizeFieldName(cell), line: lineNumber });
      }
    }
  }

  const keyPatterns = [
    /["']?([A-Za-z_][A-Za-z0-9_.-]{1,80})["']?\s*[:=]/g,
    /\b([A-Za-z_][A-Za-z0-9_]{1,80})\??:\s*[A-Za-z_{[]/g
  ];

  for (const pattern of keyPatterns) {
    for (const match of trimmed.matchAll(pattern)) {
      const field = match[1];
      if (!field || ["http", "https", "return", "case", "default"].includes(field.toLowerCase())) {
        continue;
      }
      fields.push({ field, normalized: normalizeFieldName(field), line: lineNumber });
    }
  }

  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.normalized}:${field.line}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function makeFieldMatch(file: string, line: string, signal: FieldSignal, ctx: ToolAdapterContext): PrivacyMatch | undefined {
  const entity = fieldEntity(signal.field);
  if (!entity) {
    return undefined;
  }

  return {
    ...entity,
    file,
    line: signal.line,
    title: `Privacy field: ${entity.entityType}`,
    message: `${signal.field} appears to describe ${entity.entityType}.`,
    snippet: redactSnippet(line, undefined, entity.entityType, ctx.config.checks.privacy.maskExamples),
    detectionPath: ["metadata"],
    reasons: [...entity.reasons, "metadata-only finding; sample values were not required"]
  };
}

function makeValueMatch(
  file: string,
  line: string,
  lineNumber: number,
  value: string,
  entityType: string,
  sensitivity: PrivacySensitivity,
  confidenceScore: number,
  matchedPattern: string,
  detectionPath: string[],
  reasons: string[],
  ctx: ToolAdapterContext
): PrivacyMatch {
  const maskedValue = maskPiiValue(value, entityType, ctx.config.checks.privacy.maskExamples);
  return {
    entityType,
    sensitivity,
    confidenceScore,
    title: `PII detected: ${entityType}`,
    message: `${entityType} detected with ${confidenceFromScore(confidenceScore)} confidence.`,
    file,
    line: lineNumber,
    value,
    maskedValue,
    snippet: redactSnippet(line, value, entityType, ctx.config.checks.privacy.maskExamples),
    matchedPattern,
    detectionPath,
    reasons
  };
}

function findValueMatches(file: string, line: string, lineNumber: number, ctx: ToolAdapterContext): PrivacyMatch[] {
  const matches: PrivacyMatch[] = [];
  const lower = line.toLowerCase();

  for (const match of line.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    matches.push(
      makeValueMatch(file, line, lineNumber, match[0], "email", "low", 0.88, "email-regex", ["regex"], ["email address format matched"], ctx)
    );
  }

  for (const match of line.matchAll(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi)) {
    const value = match[0].toUpperCase();
    if (looksLikePan(value)) {
      matches.push(
        makeValueMatch(file, line, lineNumber, value, "pan", "regulated_identifier", 0.93, "pan-regex", ["regex"], ["PAN format matched"], ctx)
      );
    }
  }

  for (const match of line.matchAll(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g)) {
    const confidence = isValidAadhaar(match[0]) ? 0.93 : 0.78;
    if (confidence >= 0.85 || hasContext(lower, [/aadhaar|aadhar|uidai/])) {
      matches.push(
        makeValueMatch(
          file,
          line,
          lineNumber,
          match[0],
          "aadhaar",
          "regulated_identifier",
          confidence,
          "aadhaar-regex",
          isValidAadhaar(match[0]) ? ["regex", "checksum"] : ["regex", "context"],
          isValidAadhaar(match[0]) ? ["Aadhaar format and Verhoeff checksum matched"] : ["Aadhaar-like number appeared near Aadhaar context"],
          ctx
        )
      );
    }
  }

  for (const match of line.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = normalizeDigits(match[0]);
    if (passesLuhn(digits)) {
      matches.push(
        makeValueMatch(
          file,
          line,
          lineNumber,
          match[0],
          "payment_card",
          "regulated_identifier",
          0.92,
          "payment-card-luhn",
          ["regex", "checksum"],
          ["payment-card length and Luhn checksum matched"],
          ctx
        )
      );
    }
  }

  if (hasContext(lower, [/passport/])) {
    for (const match of line.matchAll(/\b[A-Z][0-9]{7}\b/gi)) {
      matches.push(
        makeValueMatch(
          file,
          line,
          lineNumber,
          match[0].toUpperCase(),
          "passport",
          "regulated_identifier",
          0.84,
          "passport-context-regex",
          ["regex", "context"],
          ["passport-like value appeared near passport context"],
          ctx
        )
      );
    }
  }

  if (hasContext(lower, [/bank|account\s*(number|no)|iban|ifsc/])) {
    for (const match of line.matchAll(/\b\d{9,18}\b/g)) {
      const digits = normalizeDigits(match[0]);
      if (!passesLuhn(digits) && !isValidAadhaar(digits)) {
        matches.push(
          makeValueMatch(
            file,
            line,
            lineNumber,
            match[0],
            "bank_account",
            "regulated_identifier",
            0.78,
            "bank-account-context-regex",
            ["regex", "context"],
            ["long numeric value appeared near bank/account context"],
            ctx
          )
        );
      }
    }
  }

  if (hasContext(lower, [/dob|date of birth|birthdate|birth_date/])) {
    for (const match of line.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})\b/g)) {
      matches.push(
        makeValueMatch(
          file,
          line,
          lineNumber,
          match[0],
          "date_of_birth",
          "moderate",
          0.78,
          "dob-context-regex",
          ["regex", "context"],
          ["date appeared near date-of-birth context"],
          ctx
        )
      );
    }
  }

  for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (isPublicIp(match[0]) || hasContext(lower, [/client[_\s-]?ip|ip[_\s-]?address|remote[_\s-]?addr/])) {
      matches.push(
        makeValueMatch(
          file,
          line,
          lineNumber,
          match[0],
          "ip_address",
          "moderate",
          isPublicIp(match[0]) ? 0.76 : 0.66,
          "ip-regex",
          ["regex"],
          ["IP address format matched"],
          ctx
        )
      );
    }
  }

  for (const match of line.matchAll(/(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{3,5}\)?[-.\s]?){2,}\d{3,4}/g)) {
    const digits = normalizeDigits(match[0]);
    if (digits.length < 10 || digits.length > 14 || passesLuhn(digits) || isValidAadhaar(digits)) {
      continue;
    }
    const contextual = hasContext(lower, [/phone|mobile|telephone|contact/]);
    matches.push(
      makeValueMatch(
        file,
        line,
        lineNumber,
        match[0],
        "phone",
        "moderate",
        contextual ? 0.78 : 0.56,
        "phone-regex",
        contextual ? ["regex", "context"] : ["regex"],
        contextual ? ["phone-like value appeared near phone context"] : ["phone-like value matched without strong context"],
        ctx
      )
    );
  }

  return matches;
}

function combinationRisk(file: string, fields: FieldSignal[]): PrivacyMatch | undefined {
  const groups = new Map<string, string[]>();
  for (const field of fields) {
    const normalized = field.normalized;
    if (/^(?:age|dob|dateofbirth|birthdate|userage|customerage|employeeage|patientage)$/.test(normalized)) {
      groups.set("age_or_dob", [...(groups.get("age_or_dob") ?? []), field.field]);
    }
    if (/^(?:gender|sex|usergender|customergender|employeegender|patientgender)$/.test(normalized)) {
      groups.set("gender", [...(groups.get("gender") ?? []), field.field]);
    }
    if (/^(?:location|site|city|branch|address|latitude|longitude|gps|userlocation|customerlocation|employeelocation|patientlocation)$/.test(normalized)) {
      groups.set("location", [...(groups.get("location") ?? []), field.field]);
    }
    if (/^(?:designation|role|title|department|team|job|jobtitle|employeerole|employeedepartment)$/.test(normalized)) {
      groups.set("role_or_department", [...(groups.get("role_or_department") ?? []), field.field]);
    }
  }

  if (!groups.has("age_or_dob") || groups.size < 3) {
    return undefined;
  }

  const reasons = Array.from(groups.entries()).map(([group, names]) => `${group}: ${Array.from(new Set(names)).slice(0, 4).join(", ")}`);
  return {
    entityType: "combination_risk",
    sensitivity: "combination_risk",
    confidenceScore: 0.78,
    title: "Combination-risk personal data fields",
    message: "Multiple fields together may raise re-identification risk.",
    file,
    line: fields[0]?.line,
    matchedPattern: "combination-risk-fields",
    detectionPath: ["metadata", "combination-risk"],
    reasons
  };
}

function toFinding(match: PrivacyMatch): Finding {
  const confidence = confidenceFromScore(match.confidenceScore);
  return {
    id: `privacy:${match.file}:${match.line ?? 0}:${match.entityType}:${match.matchedPattern}`,
    source: "privacy-detector",
    category: "privacy",
    severity: match.sensitivity === "low" ? "low" : "medium",
    confidence,
    title: match.title,
    message: match.message,
    file: match.file,
    startLine: match.line,
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    agentInstruction:
      match.confidenceScore >= 0.85
        ? "Verify whether this personal data belongs in the repository. Remove, anonymize, or move it to controlled test data if not required."
        : "Review the privacy signal before treating it as confirmed PII.",
    tags: ["privacy", match.entityType, match.sensitivity],
    evidence: {
      snippet: match.snippet,
      detector: "privacy-detector",
      entityType: match.entityType,
      sensitivity: match.sensitivity,
      maskedValue: match.maskedValue,
      fieldPath: match.line ? `${match.file}:${match.line}` : match.file,
      matchedPattern: match.matchedPattern,
      detectionPath: match.detectionPath.join(" + "),
      confidenceScore: Number(match.confidenceScore.toFixed(2)),
      coverageConfidence: 0.9,
      reviewState: match.confidenceScore >= 0.85 ? "confirmed" : "needs_human_review",
      reasons: match.reasons
    },
    scoreImpact: 0
  };
}

async function readCandidate(root: string, file: string, maxFileBytes: number): Promise<string | undefined> {
  const absolutePath = path.join(root, file);
  const stat = await fs.stat(absolutePath).catch(() => undefined);
  if (!stat || stat.size > maxFileBytes) {
    return undefined;
  }

  const content = await fs.readFile(absolutePath, "utf8").catch(() => undefined);
  if (!content || content.includes("\0")) {
    return undefined;
  }
  return content;
}

function passesConfidenceThreshold(finding: Finding, minimum: Confidence): boolean {
  return CONFIDENCE_RANK[finding.confidence] >= CONFIDENCE_RANK[minimum];
}

export type DetectPiiFindingsOptions = {
  /**
   * When set, only these files are scanned (already path-normalized preferred).
   * Used by DPDP changed-scope collection so privacy reuse the same allowlist.
   */
  fileAllowlist?: string[];
  /** Override include patterns (defaults to config.paths.include). Ignored when fileAllowlist is set. */
  include?: string[];
  /** Override exclude patterns (defaults to config.paths.exclude). Ignored when fileAllowlist is set. */
  exclude?: string[];
  /** Bypass process-lifetime cache (tests / forced refresh). */
  skipCache?: boolean;
};

/** Process-lifetime cache: privacy adapter + DPDP collectors often scan the same tree once per run. */
const privacyFindingsCache = new Map<string, Promise<Finding[]>>();
let privacyCacheHits = 0;
let privacyCacheMisses = 0;

export function clearPrivacyFindingsCache(): void {
  privacyFindingsCache.clear();
  privacyCacheHits = 0;
  privacyCacheMisses = 0;
}

export function getPrivacyFindingsCacheStats(): { size: number; hits: number; misses: number } {
  return {
    size: privacyFindingsCache.size,
    hits: privacyCacheHits,
    misses: privacyCacheMisses
  };
}

function privacyConfigFingerprint(ctx: ToolAdapterContext): string {
  const privacy = ctx.config.checks.privacy;
  return JSON.stringify({
    minConfidenceToReport: privacy.minConfidenceToReport,
    maskExamples: privacy.maskExamples,
    maxFileBytes: privacy.maxFileBytes,
    detectUnsanitizedLogs: privacy.detectUnsanitizedLogs,
    detectApiOverfetching: privacy.detectApiOverfetching,
    detectMissingRetention: privacy.detectMissingRetention
  });
}

function resolvePrivacyCandidates(ctx: ToolAdapterContext, options: DetectPiiFindingsOptions): string[] {
  if (options.fileAllowlist !== undefined) {
    return options.fileAllowlist.filter(isTextCandidate).map((file) => file.replaceAll("\\", "/")).sort();
  }
  return filterPaths(
    ctx.project.projectFiles,
    options.include ?? ctx.config.paths.include,
    options.exclude ?? ctx.config.paths.exclude
  )
    .filter(isTextCandidate)
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
}

async function buildPrivacyFindingsCacheKey(
  ctx: ToolAdapterContext,
  options: DetectPiiFindingsOptions,
  candidates: string[]
): Promise<string> {
  const fileVersions: string[] = [];
  for (const candidate of candidates) {
    const stat = await fs.stat(path.join(ctx.root, candidate)).catch(() => undefined);
    fileVersions.push(`${candidate}:${stat?.size ?? -1}:${stat?.mtimeMs ?? -1}`);
  }
  return [
    ctx.root,
    privacyConfigFingerprint(ctx),
    fileVersions.join("\n"),
    JSON.stringify({
      include: options.include ?? null,
      exclude: options.exclude ?? null,
      allowlist: options.fileAllowlist !== undefined
    })
  ].join("::");
}

function cloneFindings(findings: Finding[]): Finding[] {
  return structuredClone(findings);
}

async function detectPiiFindingsUncached(
  ctx: ToolAdapterContext,
  candidates: string[]
): Promise<Finding[]> {
  const privacyCfg = ctx.config.checks.privacy;
  const findings: Finding[] = [];

  for (const file of candidates) {
    const content = await readCandidate(ctx.root, file, privacyCfg.maxFileBytes);
    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const fieldSignals: FieldSignal[] = [];
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const fields = extractFields(file, line, lineNumber);
      fieldSignals.push(...fields);

      const matches = [
        ...fields.map((field) => makeFieldMatch(file, line, field, ctx)).filter((match): match is PrivacyMatch => Boolean(match)),
        ...findValueMatches(file, line, lineNumber, ctx)
      ];

      for (const match of matches) {
        findings.push(toFinding(match));
      }

      // Log Sanitization Check
      if (
        privacyCfg.detectUnsanitizedLogs &&
        /\.(ts|tsx|js|jsx|py)$/.test(file) &&
        /\b(console|logger|log|info|warn|error|debug)\.(log|info|warn|error|debug|trace)\s*\(/i.test(line) &&
        /\b(user|customer|member|client|patient|email|phone|password|address|dob|pan|aadhaar)\b/i.test(line) &&
        !/\b(redact|mask|safe|anon|hide|hash|encrypt|obfuscate)\b/i.test(line)
      ) {
        findings.push({
          id: `privacy:unsanitized-log:${file}:${lineNumber}`,
          source: "privacy-detector",
          category: "privacy",
          severity: "medium",
          confidence: "medium",
          title: "Potential unsanitized PII in logger call",
          message: "Potential unsanitized variable passed to logger. Consider wrapping it in a redaction helper.",
          file,
          startLine: lineNumber,
          isNew: true,
          isAutofixable: false,
          safeToAutofix: false,
          agentInstruction: "Configure log serialization to redact PII keys or wrap this log call in a redaction helper (e.g., redact(user)).",
          tags: ["privacy", "logging", "leaks"],
          evidence: {
            detector: "privacy-detector",
            reasons: ["Logger method call detected on same line as PII keyword", "No redaction function detected"]
          },
          scoreImpact: 5
        });
      }

      // API Over-fetching Check
      if (privacyCfg.detectApiOverfetching && /\.(ts|tsx|js|jsx|py)$/.test(file)) {
        const hasExpressApi = /\b(res|reply)\.(json|send)\s*\(\s*\b(user|customer|member|client|patient|profile|account)\b\s*\)/i.test(line);
        const hasPythonApi = /\bjsonify\s*\(\s*\b(user|customer|member|client|patient|profile|account)\b\s*\)/i.test(line);

        if (hasExpressApi || hasPythonApi) {
          findings.push({
            id: `privacy:api-overfetching:${file}:${lineNumber}`,
            source: "privacy-detector",
            category: "privacy",
            severity: "medium",
            confidence: "medium",
            title: "Potential API over-fetching",
            message: "Direct serialization of user/customer entity in API response. This may leak sensitive fields.",
            file,
            startLine: lineNumber,
            isNew: true,
            isAutofixable: false,
            safeToAutofix: false,
            agentInstruction: "Do not serialize ORM models directly in API responses. Define a strict projection select list or wrap the output in a safe Data Transfer Object (DTO) class.",
            tags: ["privacy", "api", "overfetching"],
            evidence: {
              detector: "privacy-detector",
              reasons: ["Direct model serialization pattern matched in routing code"]
            },
            scoreImpact: 10
          });
        }
      }
    }

    const combination = combinationRisk(file, fieldSignals);
    if (combination) {
      findings.push(toFinding(combination));
    }

    // Database Retention Check
    if (privacyCfg.detectMissingRetention && file.endsWith(".prisma")) {
      const modelBlocks = content.match(/model\s+(\w+)\s*\{([^}]*)\}/g);
      if (modelBlocks) {
        for (const block of modelBlocks) {
          const modelNameMatch = block.match(/model\s+(\w+)/);
          const modelName = modelNameMatch ? modelNameMatch[1] : "Unknown";
          const blockLines = block.split("\n");

          const hasPii = blockLines.some((l) => /\b(email|phone|ssn|password|address|dob|pan|aadhaar)\b/i.test(l));
          const hasRetention = blockLines.some((l) => /\b(deletedAt|deleted_at|expiresAt|expires_at|ttl)\b/i.test(l));

          if (hasPii && !hasRetention) {
            const blockStartIndex = content.indexOf(block);
            const lineOffset = content.slice(0, blockStartIndex).split("\n").length;

            findings.push({
              id: `privacy:missing-retention:${file}:${modelName}`,
              source: "privacy-detector",
              category: "privacy",
              severity: "medium",
              confidence: "medium",
              title: "Database table storing PII lacks retention fields",
              message: `Database model '${modelName}' stores personal data but has no soft-delete (deletedAt) or expiration (ttl) field.`,
              file,
              startLine: lineOffset,
              isNew: true,
              isAutofixable: false,
              safeToAutofix: false,
              agentInstruction: "Add a soft-delete (deletedAt) column or database TTL configuration to enforce data retention limits.",
              tags: ["privacy", "database", "retention"],
              evidence: {
                detector: "privacy-detector",
                reasons: [`Model '${modelName}' contains PII attributes`, `No retention columns (deletedAt/ttl) found in model definition`]
              },
              scoreImpact: 10
            });
          }
        }
      }
    }
  }

  return findings.filter((finding) => passesConfidenceThreshold(finding, privacyCfg.minConfidenceToReport));
}

/**
 * Deterministic privacy scan with process-lifetime cache.
 * Concurrent callers with the same key share one in-flight computation (dedupes privacy + DPDP double walks).
 */
export async function detectPiiFindings(
  ctx: ToolAdapterContext,
  options: DetectPiiFindingsOptions = {}
): Promise<Finding[]> {
  const candidates = resolvePrivacyCandidates(ctx, options);

  if (options.skipCache) {
    return detectPiiFindingsUncached(ctx, candidates);
  }

  const key = await buildPrivacyFindingsCacheKey(ctx, options, candidates);
  const existing = privacyFindingsCache.get(key);
  if (existing) {
    privacyCacheHits += 1;
    return cloneFindings(await existing);
  }

  privacyCacheMisses += 1;
  const pending = detectPiiFindingsUncached(ctx, candidates);
  privacyFindingsCache.set(key, pending);

  try {
    const findings = await pending;
    return cloneFindings(findings);
  } catch (error) {
    privacyFindingsCache.delete(key);
    throw error;
  }
}

export const privacyDetectorAdapter: ToolAdapter = {
  id: "privacy-detector",
  category: "privacy",
  async detect(_project, config) {
    return config.checks.privacy.enabled;
  },
  async runStandalone(ctx) {
    const findings = await detectPiiFindings(ctx);
    return { findings };
  },
  installHint: "Built-in deterministic privacy detector. No external install needed."
};

export function normalizeExternalFile(file: string | undefined, root: string): string | undefined {
  return normalizeFilePath(file, root);
}
