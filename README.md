# Ian Portal

A personal portal for tools, notes, guides, and side projects, built with Astro and prepared for GitHub Pages deployment.

## Features

- Home / About / Projects / Blog pages
- Markdown-backed blog content via Astro content collections
- A usable Packing List Generator with:
  - rule-based checklist generation
  - editable checklist items
  - personal essentials groups
  - `localStorage` persistence
  - TXT / Markdown export
- Responsive layout designed for desktop and mobile

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

The included workflow at `.github/workflows/deploy.yml` builds the site and deploys it to GitHub Pages.  
If this repository is not a user site like `username.github.io`, the workflow sets a base path from the repository name automatically.

