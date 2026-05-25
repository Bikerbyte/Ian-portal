export const site = {
  title: "Ian Notes",
  tagline: "筆記、文章、紀錄。",
  description: "簡單的個人網站，放筆記、文章和學習紀錄。",
  githubUrl: "https://github.com/Bikerbyte",
  contactText: "",
  footerBlurb: ""
};

/**
 * Main navigation items.
 *
 * To add a new page to the nav:
 *   1. Create the page file under src/pages/
 *   2. Add one entry here — href, label, and an inline SVG icon.
 *
 * That's it — no need to touch BaseLayout.astro.
 */
export const navItems = [
  {
    href: "/",
    label: "首頁",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10.5 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>`
  },
  {
    href: "/blog/",
    label: "文章",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>`
  },
  {
    href: "/about/",
    label: "關於",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>`
  }
];
