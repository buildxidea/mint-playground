import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(process.argv.includes("--dist") ? "./dist/" : "./", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const port = Number(process.env.PORT || 5173);
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://preview.invalid").pathname);
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || !["index.html", "src"].includes(relative.split(path.sep)[0])) {
      res.writeHead(404).end();
      return;
    }
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`Ninjutsu preview listening on port ${port}`));
