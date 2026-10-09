import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { product, commands, links } from "../data/product";
import { checks, dpdpControlCount } from "../data/checks";
import { faq } from "../data/faq";
import { sortArticles } from "../lib/articles";

/**
 * /llms.txt (llmstxt.org): a plain summary AI assistants and answer engines can read
 * when someone asks for a tool like this. Built from the same data as the pages.
 */
export const GET: APIRoute = async ({ site }) => {
  const at = (path: string) => new URL(`${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`, site).href;
  const articles = sortArticles(await getCollection("articles", ({ data }) => !data.draft));

  const body = [
    `# ${product.name}`,
    "",
    `> ${product.seoDescription}`,
    "",
    `${product.name} is a free, open-source (${product.license}) command-line tool by ${product.maker}. It runs locally on JavaScript, TypeScript, Python, and mixed repositories (Node.js ${product.node}). Current version: ${product.version}.`,
    "",
    "Run it in a repository:",
    "",
    "```",
    commands.scan,
    "```",
    "",
    `It writes a ranked report to .vibedoctor/ and marks the scan COMPLETE, PARTIAL, or INVALID depending on whether every check actually ran. Agent instructions are available for Cursor, Claude Code, Codex and GitHub Copilot via \`${commands.agentInit}\`, and \`${commands.mcp}\` starts an MCP server.`,
    "",
    "## What it checks",
    "",
    ...checks.map((check) => `- [${check.name}](${at(`/checks/${check.slug}/`)}): ${check.description}`),
    `- [DPDP technical readiness](${at("/dpdp/")}): ${dpdpControlCount} technical controls from India's DPDP Act, checked against the code. Technical readiness evidence, not legal certification.`,
    "",
    "## Docs",
    "",
    `- [How it works](${at("/how-it-works/")}): scan modes, completeness, evidence grades, and the tool matrix.`,
    `- [Agents](${at("/agents/")}): agent-plan, AGENTS.md, editor wiring, and the MCP server.`,
    `- [Privacy](${at("/privacy/")}): what stays on the machine and what may use the network.`,
    `- [Source code](${links.github})`,
    `- [npm package](${links.npm})`,
    "",
    "## Articles",
    "",
    ...articles.map((post) => `- [${post.data.title}](${at(`/articles/${post.id}/`)}): ${post.data.description}`),
    "",
    "## FAQ",
    "",
    ...faq.flatMap((item) => [`### ${item.q}`, "", item.a, ""])
  ].join("\n");

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
