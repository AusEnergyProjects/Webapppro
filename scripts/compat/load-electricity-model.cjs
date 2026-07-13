/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../../public/electricity-model.js"), "utf8");
const compatibilityModule = { exports: {} };
new Function("module", "exports", source)(compatibilityModule, compatibilityModule.exports);

module.exports = compatibilityModule.exports;
