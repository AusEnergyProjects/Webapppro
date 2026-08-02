import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverBundlePath = path.join(root, "dist", "server", "index.js");
const sourceMigrationPath = path.join(root, "drizzle");
const packagedMigrationPath = path.join(root, "dist", ".openai", "drizzle");
const migrationPattern = /^\d{4}_.+\.sql$/;

if (!fs.existsSync(serverBundlePath)) {
  throw new Error("Sites server bundle audit failed: dist/server/index.js is missing.");
}

const serverBundle = fs.readFileSync(serverBundlePath, "utf8");
const forbiddenRuntimeMarkers = [
  "__dirname",
  "next/dist/compiled/@next/font/dist/fontkit",
];

for (const marker of forbiddenRuntimeMarkers) {
  if (serverBundle.includes(marker)) {
    throw new Error(
      `Sites server bundle audit failed: unsupported runtime marker ${marker} was bundled.`,
    );
  }
}

if (!fs.existsSync(packagedMigrationPath)) {
  throw new Error(
    "Sites server bundle audit failed: dist/.openai/drizzle is missing.",
  );
}

const sourceMigrations = fs.readdirSync(sourceMigrationPath)
  .filter((name) => migrationPattern.test(name))
  .sort();
const packagedMigrations = fs.readdirSync(packagedMigrationPath)
  .filter((name) => migrationPattern.test(name))
  .sort();

if (!sourceMigrations.length) {
  throw new Error("Sites server bundle audit failed: no source migrations found.");
}
if (JSON.stringify(packagedMigrations) !== JSON.stringify(sourceMigrations)) {
  throw new Error(
    "Sites server bundle audit failed: packaged migration inventory differs from source.",
  );
}

for (const migration of sourceMigrations) {
  const source = fs.readFileSync(path.join(sourceMigrationPath, migration));
  const packaged = fs.readFileSync(path.join(packagedMigrationPath, migration));
  if (!source.equals(packaged)) {
    throw new Error(
      `Sites server bundle audit failed: packaged migration differs from source: ${migration}.`,
    );
  }
}

console.log(
  `Sites server bundle audit passed: no Node-only Fontkit runtime markers were bundled and ${sourceMigrations.length} exact migrations were packaged.`,
);
