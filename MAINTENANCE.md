# Maintenance Guide

This project is a static Astro site that deploys to GitHub Pages through GitHub Actions.

## First-Time Setup

If you clone the repo on a new machine:

```bash
npm install
```

To start local development:

```bash
npm run dev
```

To verify before pushing:

```bash
npm run build
npm run check
```

## Daily Workflow

Use this routine for normal updates:

1. Edit content, pages, styles, or tool logic.
2. Run `npm run dev` and check the site locally.
3. Run `npm run build`.
4. Run `npm run check`.
5. Commit and push.

Example:

```bash
git add .
git commit -m "Update blog content"
git push
```

## Where to Edit

### Site identity

Edit:

- `src/data/site.ts`

Use this file to update:

- site title
- GitHub link
- contact text
- footer blurb

### Home / About / Projects / Blog pages

Edit:

- `src/pages/index.astro`
- `src/pages/about.astro`
- `src/pages/projects.astro`
- `src/pages/blog/index.astro`
- `src/pages/blog/[slug].astro`

### Blog posts

Add or edit Markdown files in:

- `src/content/blog/`

Frontmatter format:

```md
---
title: "Post title"
excerpt: "Short summary"
date: 2026-03-29
category: "Study Notes"
tags:
  - Astro
  - Notes
featured: false
---
```

The URL becomes the filename, for example:

- `src/content/blog/my-note.md`
- published as `/blog/my-note/`

### Project cards

Edit:

- `src/data/projects.ts`

Use this when you want to add:

- new tools
- side projects
- guide entry points

### Packing List Generator

Edit:

- `src/components/PackingListTool.astro`

This file contains:

- trip setup form
- packing rules
- personal essentials logic
- localStorage persistence
- export logic

### Global styles

Edit:

- `src/styles/global.css`

## Deployment

Deployment is automatic through:

- `.github/workflows/deploy.yml`

Current behavior:

- pushing to `main` triggers a build
- GitHub Actions deploys the generated `dist` output to GitHub Pages
- the workflow automatically handles repo base paths

## GitHub Pages Setup

In GitHub repository settings:

1. Open `Settings`
2. Open `Pages`
3. Set `Source` to `GitHub Actions`

After that, every push to `main` should publish a new version.

## Recommended Content Workflow

For writing-focused updates:

1. Add or edit the Markdown post.
2. Preview with `npm run dev`.
3. Run build and check.
4. Commit with a content-focused message.

Examples:

```bash
git commit -m "Add new study note about Astro"
git commit -m "Update packing list tool copy"
git commit -m "Refine homepage layout"
```

## Notes About Ignored Files

The following files are intentionally ignored and not part of the maintained site source:

- `ian-portal-spec.md`
- `packing-list-generator-spec.md`

## When Adding New Tools

Recommended path:

1. Add a new page under `src/pages/tools/`
2. Link it from `src/data/projects.ts`
3. Add a homepage entry if needed
4. Verify with `npm run build` and `npm run check`

## When Something Looks Wrong

Quick checklist:

1. Run `npm run check`
2. Run `npm run build`
3. Confirm the changed file is in the expected folder
4. Confirm the GitHub Actions deploy job passed
5. If the deployed site is missing styles or links, check whether the repo name or Pages settings changed
