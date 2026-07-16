import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tlink-migrations-"));
const persistPath = path.join(temporaryRoot, "state");
const configPath = path.join(temporaryRoot, "wrangler.jsonc");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });
  if (result.status !== 0) {
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`Migration check failed while running: ${args.join(" ")}`);
  }
  return result.stdout;
}

try {
  fs.writeFileSync(configPath, JSON.stringify({
    name: "tlink-migration-check",
    compatibility_date: "2026-07-16",
    d1_databases: [{ binding: "DB", database_name: "tlink-check", database_id: "local-check", migrations_dir: path.join(root, "drizzle").replaceAll("\\", "/") }],
  }, null, 2));
  run(["d1", "migrations", "apply", "DB", "--local", "--config", configPath, "--persist-to", persistPath]);
  const verification = run(["d1", "execute", "DB", "--local", "--config", configPath, "--persist-to", persistPath, "--command", "SELECT COUNT(*) AS migrations_ok FROM api_performance_samples; SELECT COUNT(*) AS fts_ok FROM tlink_product_search;"]);
  if (!verification.includes("migrations_ok") || !verification.includes("fts_ok")) throw new Error("Migration verification tables were not available.");
  process.stdout.write("Production migrations apply cleanly to a fresh Cloudflare D1 database.\n");
} finally {
  const resolved = path.resolve(temporaryRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
}
