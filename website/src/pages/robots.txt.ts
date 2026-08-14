import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL(`${import.meta.env.BASE_URL}sitemap-index.xml`, site ?? "https://neural-axis.github.io");
  const body = [`User-agent: *`, `Allow: /`, ``, `Sitemap: ${sitemap.href}`, ``].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
};
