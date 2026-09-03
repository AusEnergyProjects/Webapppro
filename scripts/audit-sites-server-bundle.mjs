import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverBundlePath = path.join(root, "dist", "server", "index.js");
const serverManifestPath = path.join(root, "dist", "server", ".vite", "manifest.json");
const workerConfigPath = path.join(root, "dist", "server", "wrangler.json");
const sourceMigrationPath = path.join(root, "drizzle");
const packagedMigrationPath = path.join(root, "dist", ".openai", "drizzle");
const migrationPattern = /^\d{4}_.+\.sql$/;

if (!fs.existsSync(serverBundlePath)) {
  throw new Error("Sites server bundle audit failed: dist/server/index.js is missing.");
}
if (!fs.existsSync(workerConfigPath)) {
  throw new Error("Sites server bundle audit failed: dist/server/wrangler.json is missing.");
}
if (!fs.existsSync(serverManifestPath)) {
  throw new Error("Sites server bundle audit failed: dist/server/.vite/manifest.json is missing.");
}

const serverManifest = JSON.parse(fs.readFileSync(serverManifestPath, "utf8"));
const workerEntryKey = "virtual:cloudflare/worker-entry";
const workerEntry = serverManifest[workerEntryKey];
if (!workerEntry) {
  throw new Error("Sites server bundle audit failed: Worker manifest entry is missing.");
}
const quotePdfEntryKey = Object.keys(serverManifest).find(
  (key) => serverManifest[key]?.name === "trade-quote-pdf-server",
);
if (!quotePdfEntryKey) {
  throw new Error("Sites server bundle audit failed: trade quote PDF module is missing.");
}

function collectStaticEntries(entryKey, seen = new Set()) {
  if (seen.has(entryKey)) return seen;
  const entry = serverManifest[entryKey];
  if (!entry) {
    throw new Error(`Sites server bundle audit failed: missing manifest dependency ${entryKey}.`);
  }
  seen.add(entryKey);
  for (const dependency of entry.imports || []) {
    collectStaticEntries(dependency, seen);
  }
  return seen;
}

function entryBytes(entryKey) {
  const file = serverManifest[entryKey]?.file;
  if (!file) return 0;
  const target = path.join(root, "dist", "server", file);
  if (!fs.existsSync(target)) {
    throw new Error(`Sites server bundle audit failed: missing server asset ${file}.`);
  }
  return fs.statSync(target).size;
}

function builtEntrySource(entryKey) {
  const file = serverManifest[entryKey]?.file;
  if (!file) return "";
  return fs.readFileSync(path.join(root, "dist", "server", file), "utf8");
}

const eagerWorkerEntries = collectStaticEntries(workerEntryKey);
if (eagerWorkerEntries.has(quotePdfEntryKey)) {
  throw new Error(
    "Sites server bundle audit failed: trade quote PDF tooling returned to the eager Worker graph.",
  );
}
const workerDynamicEntries = new Set(
  [...eagerWorkerEntries].flatMap(
    (entryKey) => serverManifest[entryKey]?.dynamicImports || [],
  ),
);
const guardedPdfEntryKeys = [
  "src/lib/creditex-activity-work-pack-pdf-renderer.ts",
  "src/lib/customer-plan-pdf.mjs",
  "src/lib/public-plan-customer-pdf.mjs",
  "src/lib/trade-quick-invoice-pdf.mjs",
  "src/lib/trade-quote-acceptance-pdf-server.ts",
  "src/lib/trade-quote-pdf-server.ts",
  "src/lib/trade-rental-report-pdf.mjs",
];
for (const entryKey of guardedPdfEntryKeys) {
  if (!serverManifest[entryKey]) {
    throw new Error(
      `Sites server bundle audit failed: guarded PDF entry ${entryKey} is missing.`,
    );
  }
  if (eagerWorkerEntries.has(entryKey) || !workerDynamicEntries.has(entryKey)) {
    throw new Error(
      `Sites server bundle audit failed: ${entryKey} must be available only through a guarded dynamic import.`,
    );
  }
}
const pdfRuntimeEntries = new Set(
  Object.keys(serverManifest).filter((entryKey) => {
    const source = builtEntrySource(entryKey);
    return source.includes("node_modules/pdf-lib/")
      || source.includes("node_modules/@pdf-lib/fontkit/");
  }),
);
if (pdfRuntimeEntries.size === 0) {
  throw new Error(
    "Sites server bundle audit failed: the generated PDF runtime could not be identified.",
  );
}
for (const entryKey of pdfRuntimeEntries) {
  if (eagerWorkerEntries.has(entryKey)) {
    throw new Error(
      `Sites server bundle audit failed: PDF runtime ${serverManifest[entryKey].file} returned to the eager Worker graph.`,
    );
  }
}
for (const guardedEntryKey of guardedPdfEntryKeys) {
  const guardedStaticEntries = collectStaticEntries(guardedEntryKey);
  if (![...pdfRuntimeEntries].some((entryKey) => guardedStaticEntries.has(entryKey))) {
    throw new Error(
      `Sites server bundle audit failed: ${guardedEntryKey} no longer reaches the shared PDF runtime.`,
    );
  }
}
const eagerWorkerBytes = [...eagerWorkerEntries].reduce(
  (total, entryKey) => total + entryBytes(entryKey),
  0,
);
const quotePdfModuleBytes = entryBytes(quotePdfEntryKey);
const deferredPdfRuntimeBytes = [...pdfRuntimeEntries].reduce(
  (total, entryKey) => total + entryBytes(entryKey),
  0,
);

const workerConfig = JSON.parse(fs.readFileSync(workerConfigPath, "utf8"));
const compatibilityFlags = Array.isArray(workerConfig.compatibility_flags)
  ? workerConfig.compatibility_flags
  : [];
for (const requiredFlag of ["nodejs_compat", "global_fetch_strictly_public"]) {
  if (!compatibilityFlags.includes(requiredFlag)) {
    throw new Error(
      `Sites server bundle audit failed: required compatibility flag ${requiredFlag} is missing.`,
    );
  }
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
  `Sites server bundle audit passed: required Worker compatibility flags, no Node-only Fontkit runtime markers, ${sourceMigrations.length} exact migrations and guarded PDF loading. Eager Worker graph ${eagerWorkerBytes} bytes; deferred quote PDF module ${quotePdfModuleBytes} bytes; deferred shared PDF runtime ${deferredPdfRuntimeBytes} bytes.`,
);
