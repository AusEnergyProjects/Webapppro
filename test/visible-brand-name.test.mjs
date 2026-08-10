import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const roots = ["src/app", "src/components", "src/lib", "integrations", "scripts", "public", "mobile"];
const sourceExtensions = new Set([".css", ".gs", ".html", ".js", ".jsx", ".json", ".md", ".mjs", ".svg", ".ts", ".tsx"]);
const excludedDirectories = new Set([".expo", ".next", "node_modules"]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return excludedDirectories.has(entry.name) ? [] : sourceFiles(target);
    return sourceExtensions.has(path.extname(entry.name)) && statSync(target).isFile() ? [target] : [];
  });
}

function removeExplicitlyAllowedUses(line, file) {
  let remaining = line
    .replaceAll("AEA Field", "")
    .replaceAll("X-AEA", "")
    .replaceAll("AEA-Link-Audit", "")
    .replaceAll("AEA-", "")
    .replaceAll("^AEA", "")
    .replace(/\bAEA(?=\$\{)/g, "");

  const isFieldProductMark = file.endsWith(path.join("mobile", "src", "app", "index.tsx"))
    || file.endsWith(path.join("mobile", "assets", "aea-field-icon.svg"))
    || file.endsWith(path.join("mobile", "assets", "aea-field-foreground.svg"));
  if (isFieldProductMark) remaining = remaining.replaceAll(">AEA<", "><");
  return remaining;
}

test("visible copy spells out Australian Energy Assessments", () => {
  const violations = [];

  for (const file of roots.flatMap(sourceFiles)) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      if (/\bAEA\b/.test(removeExplicitlyAllowedUses(line, file))) {
        violations.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    violations,
    [],
    `Spell out Australian Energy Assessments in visible copy. Allowed uses are the AEA Field product name, AEA reference prefixes, X-AEA headers and the internal link-audit user agent.\n${violations.join("\n")}`,
  );
});
