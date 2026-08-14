/** Prefix an internal path with the Astro base (project pages vs custom domain). */
export function withBase(href: string): string {
  if (/^https?:\/\//.test(href) || href.startsWith("mailto:")) {
    return href;
  }
  const base = import.meta.env.BASE_URL;
  const clean = href.replace(/^\//, "");
  if (!clean) {
    return base;
  }
  return `${base}${clean}`;
}
