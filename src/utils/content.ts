export function postSlug(id: string) {
  return id.replace(/\.md$/, "");
}

export function postUrl(id: string) {
  return `/blog/${postSlug(id)}/`;
}

export function termSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

