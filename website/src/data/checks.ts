/**
 * One landing page per problem. Every claim here is traceable to src/ in the CLI:
 * finding titles are quoted from the adapters, examples come from fixtures/.
 * Keep the "misses" lists honest — they are what makes the rest believable.
 */

export type CodeLine = { n: number; text: string; hit?: boolean };
export type CodeFile = { file: string; lines: CodeLine[] };
export type Reported = { title: string; severity: string; grade: string; source: string; note: string };

export type Check = {
  slug: string;
  /** Short name used on cards and in navigation. */
  name: string;
  /** <title> — phrased the way people search for the problem. */
  seoTitle: string;
  description: string;
  h1: string;
  lede: string;
  /** One line for the homepage card. */
  teaser: string;
  why: string[];
  example: CodeFile[];
  exampleSource: string;
  reports: Reported[];
  understands?: string[];
  fix: string[];
  misses: string[];
  articles: string[];
  /** Optional illustration in public/frames/, e.g. "frames/leaked-api-keys.png". */
  frame?: string;
};

export const checks: Check[] = [
  {
    slug: "leaked-api-keys",
    name: "Leaked API keys",
    seoTitle: "Find Leaked API Keys in AI-Generated Code Before You Push",
    description:
      "AI coding tools paste keys inline to make the demo work. VibeDoctor runs gitleaks locally, checks whether each match looks like a real credential, and ranks it first.",
    h1: "Find the API keys your AI pasted into the code.",
    lede:
      "To make a demo work, an assistant will happily write the token straight into a config file. It compiles, it deploys, and now it is in git history.",
    teaser: "Tokens written straight into source to make the demo work.",
    why: [
      "A hardcoded key does not fail a build, a type check, or a test. Nothing in the normal loop notices it.",
      "Once committed, it lives in git history even after you delete the line. Anyone with the repo, or a public mirror of it, has the key."
    ],
    example: [
      {
        file: "src/config.ts",
        lines: [{ n: 1, text: 'export const GITHUB_TOKEN = "ghp_••••••••••••••••••••••••••••••••••••";', hit: true }]
      }
    ],
    exampleSource: "A demo app assembled from VibeDoctor's test fixtures, with a randomly generated, never-valid token.",
    reports: [
      {
        title: "github-pat",
        severity: "critical",
        grade: "verified",
        source: "gitleaks",
        note: "The rule ID comes from gitleaks. The value is redacted in the report."
      }
    ],
    understands: [
      "Gitleaks rules for cloud, payment, source-control, and chat tokens. VibeDoctor can download a pinned copy for you.",
      "A credential check on every match: known prefixes such as sk-, ghp_, AKIA, AIza, glpat-, xox and private-key headers, plus entropy.",
      "Placeholders and identifiers are downgraded and relabelled, so “your-key-here” does not outrank a real token."
    ],
    fix: [
      "Rotate the key first. Deleting the line does not remove it from history.",
      "Move it to an environment variable or your host's secret store, and read it on the server only.",
      "Re-run the scan to confirm the finding is gone."
    ],
    misses: [
      "It does not know whether a VITE_ or NEXT_PUBLIC_ variable ends up in the browser bundle. Check those by hand.",
      "It cannot tell you whether a leaked key was already used. Assume it was."
    ],
    articles: [
      "how-api-keys-get-exposed-in-ai-generated-apps",
      "vibe-coding-security-checklist",
      "supabase-security-for-vibe-coded-apps"
    ]
  },
  {
    slug: "broken-api-routes",
    name: "Broken API routes",
    seoTitle: "Broken API Routes in AI-Built Apps: Frontend Calls Your Backend Doesn't Answer",
    description:
      "Flow Doctor matches your frontend fetch and axios calls against your backend routes and flags wrong methods and routes wired to handlers that do not exist.",
    h1: "Catch frontend calls your backend does not answer.",
    lede:
      "The agent edits the client in one prompt and the server in another. The button sends a POST, the route only accepts GET, both files compile, and nothing happens in production.",
    teaser: "The UI calls a route the server does not answer.",
    why: [
      "Type checks and unit tests usually look at one side at a time. A mismatch between the two only shows up when a real user clicks.",
      "It is the most common way an AI-built feature is “done” and still does nothing."
    ],
    example: [
      { file: "src/client.ts", lines: [{ n: 2, text: 'await fetch("/api/user", { method: "POST" });', hit: true }] },
      { file: "src/server.ts", lines: [{ n: 12, text: 'app.get("/api/user", (_req, res) => {' }] }
    ],
    exampleSource: "fixtures/flow-mismatch in the VibeDoctor repository.",
    reports: [
      {
        title: "HTTP call has no matching backend route",
        severity: "high",
        grade: "verified",
        source: "flow-doctor",
        note: "“POST /api/user has no matching server route.” The path exists, the method does not."
      },
      {
        title: "Route handler is not defined",
        severity: "high",
        grade: "verified",
        source: "flow-doctor",
        note: "A route is wired to a function that is neither defined nor imported."
      },
      {
        title: "Unreachable handler in a route file",
        severity: "medium",
        grade: "verified",
        source: "flow-doctor",
        note: "A handler sits next to the routes but nothing calls it or routes to it."
      }
    ],
    understands: [
      "Client calls: fetch and axios in JavaScript and TypeScript, requests and httpx in Python.",
      "Express-style routers (app, router, server .get/.post/…), Next.js app/api route.ts and pages/api.",
      "FastAPI and Flask 2 decorators (@app.get, @router.post, …) and Flask add_url_rule."
    ],
    fix: [
      "Decide which side is right, then change the other to match.",
      "Add one test that calls the route the way the UI does.",
      "Re-run the scan to confirm the pair now matches."
    ],
    misses: [
      "Calls to paths that exist nowhere are not reported by default, because in a monorepo they often belong to another service.",
      "Template-string URLs, absolute URLs, and fetch calls with no explicit method are skipped rather than guessed.",
      "Flask's @app.route decorator is not matched yet. Parsing is line-based, not a full call graph."
    ],
    articles: ["how-to-security-test-an-ai-generated-web-app", "production-readiness-checklist-ai-app"]
  },
  {
    slug: "swallowed-errors",
    name: "Errors returned as success",
    seoTitle: "Swallowed Errors in AI-Generated Code: When Failures Return Success",
    description:
      "AI-written handlers often catch a failure and return { ok: true } anyway. VibeDoctor finds empty catch blocks and success responses sent after a caught error.",
    h1: "Find the errors your app reports as success.",
    lede:
      "To make the red go away, the assistant wraps the call in try/catch and returns success anyway. The user sees “Saved”. The data never arrived.",
    teaser: "A failed save that still says “Saved”.",
    why: [
      "A swallowed error removes the only evidence that something went wrong. Logs stay clean and dashboards stay green.",
      "Returning success after a failure is worse: the client believes it, and so does every retry and analytics event downstream."
    ],
    example: [
      {
        file: "src/handler.ts",
        lines: [
          { n: 4, text: "} catch (error) {", hit: true },
          { n: 5, text: "}" },
          { n: 8, text: '  await Promise.reject(new Error("write failed"));' },
          { n: 9, text: "} catch (error) { return { ok: true }; }", hit: true }
        ]
      }
    ],
    exampleSource: "fixtures/flow-swallowed in the VibeDoctor repository.",
    reports: [
      {
        title: "Success response after a caught failure",
        severity: "high",
        grade: "verified",
        source: "flow-doctor",
        note: "A catch block sends HTTP 2xx, ok: true, or success: true. In Python, an except block that returns 200 or success."
      },
      {
        title: "Swallowed error path",
        severity: "medium",
        grade: "verified",
        source: "flow-doctor",
        note: "An empty catch {} in JavaScript or TypeScript, or an except that only contains pass."
      }
    ],
    fix: [
      "Return a real error status and message to the caller.",
      "Log the failure with enough context to debug it, without personal data.",
      "Add a test where the write fails and assert that the response says so."
    ],
    misses: [
      "It only looks inside catch and except blocks. A handler that returns 200 with an error message outside one is not flagged."
    ],
    articles: ["production-readiness-checklist-ai-app", "10-security-mistakes-ai-coding-agents-make"]
  },
  {
    slug: "pii-in-llm-prompts",
    name: "Personal data in LLM prompts",
    seoTitle: "Personal Data in LLM Prompts and Logs: Check Your AI App's Code",
    description:
      "VibeDoctor flags code that puts emails, phone numbers and other personal data into OpenAI or Anthropic prompts, embeddings, vector stores, and application logs.",
    h1: "See where personal data reaches your LLM prompts and logs.",
    lede:
      "“Summarise this customer” is one prompt away from sending their name, email, and phone number to a model provider, and logging all three on the way.",
    teaser: "Emails and phone numbers pasted into model prompts and logs.",
    why: [
      "Every prompt is a transfer of data to a third party. Every log line is a copy you now have to retain, secure, and delete.",
      "Neither shows up in a code review that only checks whether the feature works."
    ],
    example: [
      {
        file: "src/service.ts",
        lines: [
          { n: 6, text: 'console.log("processing user", user.email, user.phone);', hit: true },
          { n: 7, text: 'logger.info("customer payload", user);', hit: true },
          { n: 12, text: "content: `Summarise account for ${user.name} email=${user.email}`", hit: true },
          { n: 16, text: "return client.chat.completions.create({ model, messages });" }
        ]
      }
    ],
    exampleSource: "fixtures/dpdp/projects/llm-logs in the VibeDoctor repository.",
    reports: [
      {
        title: "PII in LLM prompts or embeddings",
        severity: "critical",
        grade: "observed",
        source: "DPDP-SEC-002",
        note: "Personal-data fields near chat.completions, Anthropic messages, embeddings, Pinecone, or vector-store calls."
      },
      {
        title: "PII in application logs",
        severity: "high",
        grade: "observed",
        source: "DPDP-SEC-001",
        note: "Logger calls that include personal-data fields or whole user objects."
      },
      {
        title: "Whole user objects sent to third parties",
        severity: "high",
        grade: "observed",
        source: "DPDP-THIRD-001",
        note: "A full user object passed to analytics, error-tracking, or LLM vendors."
      },
      {
        title: "External processors and recipients inventory",
        severity: "info",
        grade: "observed",
        source: "DPDP-PROC-001",
        note: "Lists the LLM SDKs in use: OpenAI, Anthropic, Google, Cohere, Hugging Face."
      }
    ],
    understands: [
      "Personal-data fields such as email, phone, address, date of birth, passport, Aadhaar, and PAN.",
      "The scan and its results stay on your machine. Nothing is sent to a model to find this."
    ],
    fix: [
      "Send the model only what the task needs: an internal ID instead of a name, a redacted field instead of an email.",
      "Log IDs, not user objects.",
      "Record which providers receive personal data, then re-run the scan."
    ],
    misses: [
      "This is proximity, not data-flow tracing: a personal-data field close to a prompt call. Expect some findings you will dismiss.",
      "It cannot see prompts built in another service or loaded from a database at runtime."
    ],
    articles: ["is-vibe-coding-safe", "10-security-mistakes-ai-coding-agents-make", "supabase-security-for-vibe-coded-apps"]
  },
  {
    slug: "vulnerable-packages",
    name: "Vulnerable packages",
    seoTitle: "Vulnerable npm and PyPI Packages in AI-Built Apps: Check Your Lockfile",
    description:
      "AI assistants add dependencies freely and pin versions from their training data. VibeDoctor checks your lockfile for known vulnerabilities and finds unused and missing packages.",
    h1: "Check the packages your AI added for known holes.",
    lede:
      "Assistants add a package for every problem and pin the version they remember from training. Some of those versions have published vulnerabilities.",
    teaser: "Old versions pinned from training data, with published advisories.",
    why: [
      "“npm install succeeded” says nothing about whether a version has a known exploit.",
      "Unused packages still ship, still run install scripts, and still show up in advisories."
    ],
    example: [
      {
        file: "website/package-lock.json",
        lines: [{ n: 0, text: '"astro": "5.18.2"   → advisory fixed in 6.3.3', hit: true }]
      }
    ],
    exampleSource: "A real finding on this website's own lockfile during its build.",
    reports: [
      {
        title: "Advisory ID (for example GHSA-…)",
        severity: "by advisory",
        grade: "verified",
        source: "osv-scanner",
        note: "package@version, whether it is a runtime, dev, or transitive dependency, and the version that fixes it."
      },
      {
        title: "Unused dependency",
        severity: "low–medium",
        grade: "observed",
        source: "knip / deptry",
        note: "knip for JavaScript and TypeScript. deptry reports unused and missing packages in Python."
      }
    ],
    understands: [
      "npm, pnpm, Yarn, and Python lockfiles, through osv-scanner. VibeDoctor can download a pinned copy.",
      "Dev-only and transitive dependencies are ranked below runtime ones."
    ],
    fix: [
      "Upgrade to the fixed version and run your tests.",
      "If no fix exists, check whether you use the vulnerable code path, or replace the package.",
      "Remove packages nothing imports."
    ],
    misses: [
      "Known vulnerabilities only. A package with no published advisory looks clean.",
      "It needs a lockfile, and the vulnerability lookup uses the network."
    ],
    articles: ["vibe-coding-security-checklist", "how-to-secure-a-bolt-new-app"]
  },
  {
    slug: "ai-leftovers",
    name: "AI leftovers and dead code",
    seoTitle: "AI Code Leftovers: Stale TODOs, Dead Code and Half-Removed Features",
    description:
      "Every prompt adds code; few remove it. VibeDoctor finds legacy fallbacks, commented-out code, stale flags, and isolated files nothing imports.",
    h1: "Clear out what the AI left behind.",
    lede:
      "Each prompt adds a layer. The old auth path stays “just in case”, the previous version is commented out, and a file nobody imports keeps getting edited.",
    teaser: "Old fallbacks, commented-out code, and files nothing imports.",
    why: [
      "Leftovers are where the next bug hides: the legacy branch still runs when a flag is unset.",
      "They also mislead your next prompt. The agent reads the dead code and builds on it."
    ],
    example: [
      {
        file: "src/auth.ts",
        lines: [
          { n: 1, text: "// TODO remove old auth fallback later", hit: true },
          { n: 2, text: "export function legacyAuthFallback() {", hit: true },
          { n: 7, text: "  // const oldClient = createClient()", hit: true },
          { n: 8, text: "  return legacyAuthFallback();" }
        ]
      }
    ],
    exampleSource: "fixtures/leftovers in the VibeDoctor repository.",
    reports: [
      { title: "Legacy fallback path appears present", severity: "medium", grade: "observed", source: "built-in", note: "A fallback or compatibility branch that still runs." },
      { title: "Commented-out code", severity: "low", grade: "observed", source: "built-in", note: "Code that was disabled instead of deleted." },
      { title: "Legacy flag or env toggle", severity: "low", grade: "observed", source: "built-in", note: "Flags like LEGACY_AUTH_ENABLED that keep an old path alive." },
      { title: "Dead chain candidate", severity: "low", grade: "heuristic", source: "built-in + knip / vulture", note: "A cluster of files that only import each other, starting from unused files and exports." }
    ],
    understands: ["Built-in detectors run with no extra install, in any language VibeDoctor supports."],
    fix: [
      "Confirm the old path is unused, then delete it and its tests together.",
      "Remove commented-out code. Git already has it.",
      "Re-run the scan so the agent's next prompt starts from a cleaner tree."
    ],
    misses: [
      "These are hints, ranked low on purpose. Confirm behaviour before deleting anything."
    ],
    articles: ["cursor-security-risks", "10-security-mistakes-ai-coding-agents-make"]
  }
];

export function checkBySlug(slug: string): Check | undefined {
  return checks.find((check) => check.slug === slug);
}

/** Checks that list a given article, for linking articles back to check pages. */
export function checksForArticle(articleId: string): Check[] {
  return checks.filter((check) => check.articles.includes(articleId));
}

export type DpdpControl = { id: string; title: string; kind: "Deterministic" | "Signal" | "Human review" | "Declared" };

/** All 38 controls from src/dpdp/catalogue.ts, grouped for reading. */
export const dpdpAreas: Array<{ area: string; controls: DpdpControl[] }> = [
  {
    area: "Notice and consent",
    controls: [
      { id: "NOTICE-001", title: "Notice presentation technical signal", kind: "Signal" },
      { id: "CONSENT-001", title: "Consent capture implementation", kind: "Signal" },
      { id: "CONSENT-002", title: "Consent metadata completeness", kind: "Deterministic" },
      { id: "WITHDRAW-001", title: "Consent withdrawal path", kind: "Signal" },
      { id: "PURPOSE-001", title: "Purpose identifier technical binding", kind: "Signal" },
      { id: "NOTICE-002", title: "Notice and consent adequacy", kind: "Human review" }
    ]
  },
  {
    area: "Security safeguards",
    controls: [
      { id: "SEC-001", title: "PII in application logs", kind: "Deterministic" },
      { id: "SEC-002", title: "PII in LLM prompts or embeddings", kind: "Deterministic" },
      { id: "SEC-003", title: "PII in URLs or query strings", kind: "Deterministic" },
      { id: "SEC-004", title: "Browser storage of personal data", kind: "Deterministic" },
      { id: "SEC-005", title: "Insecure HTTP transmission of personal data", kind: "Deterministic" },
      { id: "SEC-006", title: "Authentication on personal-data routes", kind: "Signal" },
      { id: "SEC-007", title: "Hardcoded production personal data or sensitive fixtures", kind: "Deterministic" },
      { id: "SEC-008", title: "Debug endpoints exposing personal records", kind: "Deterministic" },
      { id: "SEC-009", title: "Weak or reversible masking of identifiers", kind: "Signal" },
      { id: "SEC-010", title: "Missing audit signals on sensitive operations", kind: "Signal" },
      { id: "EXPORT-001", title: "Unprotected personal-data exports", kind: "Deterministic" },
      { id: "BREACH-001", title: "Breach preparedness signals", kind: "Signal" }
    ]
  },
  {
    area: "Minimisation and accuracy",
    controls: [
      { id: "MIN-001", title: "API over-fetching of personal data objects", kind: "Deterministic" },
      { id: "MIN-002", title: "Broad database selection of personal records", kind: "Signal" },
      { id: "ACC-001", title: "Accuracy and correction technical path", kind: "Signal" }
    ]
  },
  {
    area: "Retention and erasure",
    controls: [
      { id: "RET-001", title: "Retention or TTL mechanism for personal data stores", kind: "Deterministic" },
      { id: "ERA-001", title: "Erasure / account deletion path", kind: "Deterministic" },
      { id: "ERA-002", title: "Retained personal data without visible deletion path", kind: "Deterministic" }
    ]
  },
  {
    area: "Data Principal rights",
    controls: [
      { id: "ACC-RIGHT-001", title: "Access / export endpoint", kind: "Signal" },
      { id: "CORR-001", title: "Correction request implementation", kind: "Signal" },
      { id: "REQ-001", title: "Rights request authentication and tracking", kind: "Signal" },
      { id: "GRIEV-001", title: "Grievance handling technical signal", kind: "Signal" },
      { id: "NOM-001", title: "Nomination-related implementation signal", kind: "Signal" }
    ]
  },
  {
    area: "Children's data",
    controls: [
      { id: "CHILD-001", title: "Children's data processing signals", kind: "Signal" },
      { id: "CHILD-002", title: "Guardian / parental consent flow", kind: "Deterministic" }
    ]
  },
  {
    area: "Processors and transfers",
    controls: [
      { id: "PROC-001", title: "External processors and recipients inventory", kind: "Deterministic" },
      { id: "THIRD-001", title: "Whole user objects sent to third parties", kind: "Deterministic" },
      { id: "XBR-001", title: "Cross-border or external-service signals", kind: "Signal" },
      { id: "PROC-002", title: "Processor contracts and instructions", kind: "Declared" }
    ]
  },
  {
    area: "Applicability",
    controls: [
      { id: "APP-001", title: "Personal data processing inventory from code", kind: "Deterministic" },
      { id: "APP-002", title: "Applicability needs organisational context", kind: "Human review" },
      { id: "SDF-001", title: "Significant Data Fiduciary obligations", kind: "Human review" }
    ]
  }
];

export const dpdpControlCount = dpdpAreas.reduce((sum, area) => sum + area.controls.length, 0);

/** Real ranked output from `vibedoctor scan` on a demo app built from fixtures/ (see hero). */
export const heroDiagnosis = {
  findings: 13,
  blockers: 5,
  fixNext: [
    { severity: "high", title: "POST /api/user has no matching route", where: "src/client.ts:2", check: "broken-api-routes" },
    { severity: "high", title: "Success returned after a caught failure", where: "src/handler.ts:9", check: "swallowed-errors" },
    { severity: "critical", title: "GitHub token committed to source", where: "src/config.ts:1", check: "leaked-api-keys" },
    { severity: "medium", title: "Error swallowed by an empty catch", where: "src/handler.ts:4", check: "swallowed-errors" },
    { severity: "critical", title: "Personal data sent in an LLM prompt", where: "src/service.ts", check: "pii-in-llm-prompts" },
    { severity: "high", title: "Email and phone written to logs", where: "src/service.ts:6", check: "pii-in-llm-prompts" }
  ],
  code: [
    { file: "client.ts", n: 2, text: 'fetch("/api/user", { method: "POST" })', hit: 0 },
    { file: "server.ts", n: 12, text: 'app.get("/api/user", (req, res) => {', hit: -1 },
    { file: "handler.ts", n: 9, text: "catch (e) { return { ok: true } }", hit: 1 },
    { file: "config.ts", n: 1, text: 'GITHUB_TOKEN = "ghp_••••••••••••"', hit: 2 },
    { file: "handler.ts", n: 4, text: "catch (error) { }", hit: 3 },
    { file: "service.ts", n: 12, text: "content: `…email=${user.email}`", hit: 4 },
    { file: "service.ts", n: 6, text: "console.log(user.email, user.phone)", hit: 5 }
  ]
} as const;
