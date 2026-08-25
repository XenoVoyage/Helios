import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const basePath = "/Helios/";
const hostname = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${hostname}`).pathname);
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  if (pathname === "/Helios") {
    send(response, 308, "", { Location: basePath });
    return;
  }
  if (!pathname.startsWith(basePath)) {
    send(response, 404, "Not found");
    return;
  }

  const relative = pathname.slice(basePath.length) || "index.html";
  let target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    send(response, 403, "Forbidden");
    return;
  }

  try {
    const details = await stat(target);
    if (details.isDirectory()) target = path.join(target, "index.html");
    const body = request.method === "HEAD" ? "" : await readFile(target);
    const contentType = mimeTypes.get(path.extname(target).toLowerCase()) ?? "application/octet-stream";
    send(response, 200, body, { "Content-Type": contentType });
  } catch {
    send(response, 404, "Not found");
  }
});

server.listen(port, hostname, () => {
  console.log(`Helios local server: http://${hostname}:${port}${basePath}`);
});
