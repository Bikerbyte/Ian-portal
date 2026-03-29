export function withBase(path: string) {
  if (!path) {
    return path;
  }

  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("#")) {
    return path;
  }

  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;

  return base ? `${base}${normalized}` : normalized;
}

