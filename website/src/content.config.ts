import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    /** Shorter <title> for search results when the headline runs past ~60 characters. */
    seoTitle: z.string().optional(),
    description: z.string(),
    pubDate: z.coerce.date(),
    draft: z.boolean().default(false),
    rank: z.number().int().positive().optional(),
    stage: z.enum(["problem", "tool", "check"]).optional(),
    related: z.array(z.string()).default([])
  })
});

export const collections = { articles };
