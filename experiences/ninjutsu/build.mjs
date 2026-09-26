import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL(".", import.meta.url)));
for (const file of await readdir("src")) {
  if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", `src/${file}`]);
}
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
console.log("Built portable Ninjutsu capsule.");
