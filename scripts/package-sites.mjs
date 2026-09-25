import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = process.argv[2];
if (!archive || !path.isAbsolute(archive) || !archive.endsWith(".tar")) {
  throw new Error("Use npm run package:sites -- <absolute output .tar path outside the checkout>.");
}
const relative = path.relative(root, archive);
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("Keep deployment archives outside the checkout.");
if (existsSync(archive)) throw new Error("Choose a new archive path; existing release artifacts are immutable.");
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const clean = () => { if (run("git", ["status", "--porcelain"])) throw new Error("Commit the task source before packaging."); };
clean();
const commit = run("git", ["rev-parse", "HEAD"]);
if (!process.env.npm_execpath) throw new Error("Run this through npm run package:sites.");
execFileSync(process.execPath, [process.env.npm_execpath, "run", "build"], { cwd: root, stdio: "inherit", windowsHide: true });
clean();
if (run("git", ["rev-parse", "HEAD"]) !== commit) throw new Error("Source changed during the publication build.");
// Sites reads migration sidecars inside dist/.openai, not only root .openai.
run("tar", ["-cf", archive, "-C", path.join(root, "dist"), ".openai", "-C", root, "dist"]);
const entries = new Set(run("tar", ["-tf", archive]).split(/\r?\n/));
const migrations = readdirSync(path.join(root, "drizzle")).filter(name => /^\d{4}_.+\.sql$/.test(name));
for (const required of [".openai/hosting.json", "dist/.openai/hosting.json", "dist/server/index.js", ...migrations.map(name => `dist/.openai/drizzle/${name}`)]) {
  if (!entries.has(required)) throw new Error(`Missing deployment archive entry: ${required}`);
}
console.log(JSON.stringify({ commit, archive, migrations: migrations.length, sha256: createHash("sha256").update(readFileSync(archive)).digest("hex") }));
