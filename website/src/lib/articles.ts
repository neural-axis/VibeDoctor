import type { CollectionEntry } from "astro:content";

export type Article = CollectionEntry<"articles">;
export type ArticleStage = NonNullable<Article["data"]["stage"]>;

export const stages: Array<{
  id: ArticleStage;
  numeral: string;
  label: string;
  title: string;
  body: string;
}> = [
  {
    id: "problem",
    numeral: "01",
    label: "The problem",
    title: "What quietly goes wrong.",
    body: "The gap is not that models write malware. They write the happy path, then you point a domain at it."
  },
  {
    id: "tool",
    numeral: "02",
    label: "Your stack",
    title: "Does this tool have that problem?",
    body: "Lovable, Bolt.new, Cursor, and Supabase fail in related ways. The checks are not interchangeable."
  },
  {
    id: "check",
    numeral: "03",
    label: "Before you ship",
    title: "How to look, then how to measure.",
    body: "Checklists first. Then a local scan of the exported repository, not a vibe."
  }
];

export function sortArticles(entries: Article[]): Article[] {
  return [...entries].sort((a, b) => {
    const rank = (a.data.rank ?? 99) - (b.data.rank ?? 99);
    if (rank !== 0) return rank;
    return b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
  });
}

export function stageMeta(id: Article["data"]["stage"]) {
  return stages.find((stage) => stage.id === id);
}

export function fileNumber(post: Article): string {
  return String(post.data.rank ?? "—").padStart(2, "0");
}

export function readingMinutes(source: string): number {
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function formatFiled(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function neighbors(list: Article[], id: string) {
  const index = list.findIndex((entry) => entry.id === id);
  return {
    prev: index > 0 ? list[index - 1] : undefined,
    next: index >= 0 && index < list.length - 1 ? list[index + 1] : undefined
  };
}
