import { defineConfig } from "astro/config";
import markdownEnhance from "./src/utils/markdown-enhance.mjs";

const base = process.env.PUBLIC_BASE_PATH || "/";

export default defineConfig({
  base,
  markdown: {
    rehypePlugins: [markdownEnhance]
  },
  trailingSlash: "always"
});
