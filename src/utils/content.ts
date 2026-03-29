export function postSlug(id: string) {
  return id.replace(/\.md$/, "");
}

export function postUrl(id: string) {
  return `/blog/${postSlug(id)}/`;
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
