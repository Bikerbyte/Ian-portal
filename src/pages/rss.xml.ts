import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { site } from "../data/site";
import { postUrl } from "../utils/content";
import { absoluteUrl } from "../utils/urls";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const GET: APIRoute = async () => {
  const posts = (await getCollection("blog")).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const items = posts
    .map((post) => {
      const url = absoluteUrl(postUrl(post.id));

      return `
        <item>
          <title>${escapeXml(post.data.title)}</title>
          <description>${escapeXml(post.data.excerpt)}</description>
          <link>${url}</link>
          <guid>${url}</guid>
          <pubDate>${post.data.date.toUTCString()}</pubDate>
        </item>`;
    })
    .join("");

  const latestDate = posts[0]?.data.date.toUTCString() ?? new Date().toUTCString();

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>${escapeXml(site.title)}</title>
          <description>${escapeXml(site.description)}</description>
          <link>${absoluteUrl("/")}</link>
          <lastBuildDate>${latestDate}</lastBuildDate>
          ${items}
        </channel>
      </rss>`.trim(),
    {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8"
      }
    }
  );
};
