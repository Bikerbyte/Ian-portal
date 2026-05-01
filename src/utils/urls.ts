import { withBase } from "./paths";

const defaultOrigin = "https://bikerbyte.github.io";

export function siteOrigin() {
  return (import.meta.env.PUBLIC_SITE_URL || defaultOrigin).replace(/\/+$/, "");
}

export function absoluteUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${siteOrigin()}${withBase(path)}`;
}
