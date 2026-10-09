/**
 * Questions people ask before trying a code scanner. Shown on the homepage, emitted as
 * FAQPage structured data, and repeated in /llms.txt. Answers must stay true to src/.
 */
export const faq = [
  {
    q: "Is VibeDoctor free?",
    a: "Yes. VibeDoctor is free and open source under GPL-3.0-or-later. Run it with npx; there is no account, sign-up, or API key."
  },
  {
    q: "Does VibeDoctor upload my code?",
    a: "No. Scans run on your machine and the report is written to .vibedoctor/ in your repository. Installing tools, looking up known vulnerabilities in the OSV database, and the optional AI review can use the network."
  },
  {
    q: "Can I scan an app built with Lovable, Bolt.new, Replit or v0?",
    a: "Yes, once the code is in a git repository. Connect the project to GitHub, clone it, and run npx @neuralaxis/vibedoctor scan in the folder."
  },
  {
    q: "Does it work with Cursor, Claude Code, Codex and GitHub Copilot?",
    a: "Yes. vibedoctor agent init writes instructions each of them reads, so the agent can scan, fix the top-ranked issue, and verify. There is also an MCP server for agents that call tools."
  },
  {
    q: "Which languages does VibeDoctor support?",
    a: "JavaScript, TypeScript, Python, and repositories that mix them. It needs Node.js 18 or later."
  },
  {
    q: "How is it different from a linter or a single security scanner?",
    a: "It runs those tools for you, including gitleaks, osv-scanner, TypeScript, Ruff and Biome, and adds its own checks for broken API routes, errors returned as success, personal data in LLM prompts, AI leftovers, and India's DPDP Act. Everything lands in one ranked list, and a scan is marked partial when a tool did not run."
  },
  {
    q: "Is the DPDP scan a compliance certificate?",
    a: "No. It is technical readiness evidence from your code: a data map, a control matrix, and a review queue. It is not legal advice and not a DPDP compliance certification."
  }
] as const;
