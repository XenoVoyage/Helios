// Pages staging and local serving share this exact publish boundary.
import { cp, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const publishPaths = Object.freeze([
  "index.html", "styles.css", ".nojekyll", "LICENSE", "PROVENANCE.md",
  "assets/", "js/", "vendor/",
]);

// Callers pass a normalized, repository-relative filesystem path.
export function isPublishedPath(relative) {
  const name = relative.split(path.sep).join("/");
  return publishPaths.some((entry) => entry.endsWith("/")
    ? name === entry.slice(0, -1) || name.startsWith(entry)
    : name === entry);
}

export async function stageSite(destination) {
  // Fail if the output exists so stale, undeployed files cannot survive staging.
  await mkdir(destination);
  for (const entry of publishPaths) {
    const name = entry.replace(/\/$/, "");
    await cp(path.join(root, name), path.join(destination, name), {
      recursive: true,
      filter: async (source) => {
        if ((await lstat(source)).isSymbolicLink()) {
          throw new Error(`Published paths must not contain symbolic links: ${source}`);
        }
        return true;
      },
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stageSite(path.resolve(process.argv[2] || "_site"));
}
