export const projects = [
  {
    title: "Packing List Generator",
    slug: "packing-list",
    type: "Tool",
    featured: true,
    description:
      "Generate a practical travel packing checklist from trip conditions, then personalize it with your own essential modules.",
    tags: ["Travel", "Checklist", "localStorage"],
    href: "/tools/packing-list/"
  },
  {
    title: "Portal Content System",
    slug: "portal-content-system",
    type: "Experiment",
    featured: false,
    description:
      "A small Astro content setup that keeps blog posts, future notes, and guide pages structured without needing a CMS.",
    tags: ["Astro", "Content Collections", "Static Site"],
    href: "/blog/"
  },
  {
    title: "Route Notes Format",
    slug: "route-notes-format",
    type: "Guide",
    featured: false,
    description:
      "A reusable note pattern for capturing game routes, checkpoints, and practical reminders without writing a giant walkthrough.",
    tags: ["Guides", "Games", "Notes"],
    href: "/blog/elden-ring-shadow-keep-route/"
  }
];

export const featuredLinks = [
  {
    eyebrow: "Featured Tool",
    title: "Packing List Generator",
    description: "A front-end packing workflow built for real trip prep instead of a generic todo list.",
    href: "/tools/packing-list/",
    cta: "Start Packing"
  },
  {
    eyebrow: "Latest Study Note",
    title: "Astro Content Collections Notes",
    description: "A compact note on keeping a portal-style site structured with local Markdown content.",
    href: "/blog/astro-content-collections-notes/",
    cta: "Read Note"
  },
  {
    eyebrow: "Featured Game Guide",
    title: "Shadow Keep Route Notes",
    description: "A practical route memo focused on momentum, shortcuts, and high-value pickups.",
    href: "/blog/elden-ring-shadow-keep-route/",
    cta: "Open Guide"
  }
];
