export function postSlug(id: string) {
  return id.replace(/\.md$/, "");
}

export function postUrl(id: string) {
  return `/blog/${postSlug(id)}/`;
}

const hiddenTagLabels = new Set(["demo", "test", "測試"]);

export function isPublicTag(tag: string) {
  return !hiddenTagLabels.has(tag.normalize("NFKC").trim().toLowerCase());
}

export function termSlug(value: string) {
  return Array.from(value.normalize("NFKC").trim().toLowerCase())
    .map((char) => {
      if (/^[a-z0-9]$/.test(char)) {
        return char;
      }

      if (/^[\s/_-]$/.test(char)) {
        return "-";
      }

      return `u${char.codePointAt(0)?.toString(16)}`;
    })
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
