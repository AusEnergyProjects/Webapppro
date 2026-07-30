import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverBundlePath = path.join(root, "dist", "server", "index.js");

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

console.log(
  "Sites server bundle audit passed: no Node-only Fontkit runtime markers were bundled.",
);
