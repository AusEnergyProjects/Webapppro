import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const clientRoot = path.join(root, "dist", "client");
const manifestPath = path.join(clientRoot, ".vite", "manifest.json");

function fail(message) {
  throw new Error(`Public performance budget failed: ${message}`);
}

function assetBytes(file) {
  const target = path.join(clientRoot, file);
  if (!fs.existsSync(target)) fail(`missing built asset ${file}`);
  return fs.statSync(target).size;
}

function requireEntry(manifest, key) {
  const entry = manifest[key];
  if (!entry) fail(`missing manifest entry ${key}`);
  return entry;
}

if (!fs.existsSync(manifestPath)) fail("run the production build before this audit");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const lazy = requireEntry(manifest, "src/components/LazyEnergyAssistantWidget.tsx");
const assistant = requireEntry(manifest, "src/components/EnergyAssistantWidget.tsx");
const adapterKey = "src/lib/energy-assistant-enquiry-adapter.mjs";

if (!lazy.dynamicImports?.includes("src/components/EnergyAssistantWidget.tsx")) {
  fail("the root launcher no longer defers the full Surge assistant");
}
if (lazy.imports?.includes("src/components/EnergyAssistantWidget.tsx")) {
  fail("the full Surge assistant returned to the initial root dependency graph");
}
if (!assistant.dynamicImports?.includes(adapterKey) || assistant.imports?.includes(adapterKey)) {
  fail("the postcode-backed enquiry adapter must load only when an enquiry is submitted");
}

const lazyBytes = assetBytes(lazy.file)
  + (lazy.css || []).reduce((total, file) => total + assetBytes(file), 0);
if (lazyBytes > 12_000) fail(`root Surge launcher is ${lazyBytes} bytes; budget is 12000`);

const assistantBytes = assetBytes(assistant.file);
if (assistantBytes > 100_000) fail(`deferred Surge assistant is ${assistantBytes} bytes; budget is 100000`);

const globalCss = fs.readdirSync(path.join(clientRoot, "assets"))
  .filter((file) => /^index-.*\.css$/.test(file))
  .map((file) => ({ file, bytes: assetBytes(path.join("assets", file)) }))
  .sort((left, right) => right.bytes - left.bytes)[0];
if (!globalCss) fail("global stylesheet was not found");
if (globalCss.bytes > 735_000) fail(`global stylesheet is ${globalCss.bytes} bytes; budget is 735000`);

for (const [file, maximum] of [
  ["aea-immersive-home-journey.webp", 150_000],
  ["surge-mascot.webp", 100_000],
]) {
  const bytes = assetBytes(file);
  if (bytes > maximum) fail(`${file} is ${bytes} bytes; budget is ${maximum}`);
}

console.log(
  `Public performance budgets passed: root launcher ${lazyBytes} bytes, deferred assistant ${assistantBytes} bytes, global CSS ${globalCss.bytes} bytes.`,
);
