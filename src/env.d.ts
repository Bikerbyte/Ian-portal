/// <reference types="astro/client" />

declare module "node:fs" {
  export function readdirSync(path: URL): string[];
}
