import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { isPublicTag, postUrl, termSlug } from "../utils/content";
import { absoluteUrl } from "../utils/urls";

function urlEntry(path: string, lastmod?: Date) {
  return `
    <url>
      <loc>${absoluteUrl(path)}</loc>
      ${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ""}
    </url>`;
}

export const GET: APIRoute = async () => {
  const posts = await getCollection("blog");
  const categories = [...new Set(posts.map((post) => post.data.category))];
  const tags = [...new Set(posts.flatMap((post) => post.data.tags))].filter(isPublicTag);

  const urls = [
    urlEntry("/"),
    urlEntry("/blog/"),
    urlEntry("/about/"),
    urlEntry("/projects/"),
    ...posts.map((post) => urlEntry(postUrl(post.id), post.data.date)),
    ...categories.map((category) => urlEntry(`/categories/${termSlug(category)}/`)),
    ...tags.map((tag) => urlEntry(`/tags/${termSlug(tag)}/`))
  ].join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        ${urls}
      </urlset>`.trim(),
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8"
      }
    }
  );
};
