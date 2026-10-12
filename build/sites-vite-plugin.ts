import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { minify } from "vite";

/** Vinext replaces its route-classification stubs in generateBundle. Native
 * build.minify runs before that replacement and breaks its marker contract.
 * Compact only internal server chunks after classification, preserving names. */
export function compactServerOutput(): Plugin {
  return {
    name: "aea-compact-server-output",
    apply: "build",
    applyToEnvironment: environment => environment.name === "rsc" || environment.name === "ssr",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== "chunk") continue;
          // Preserve the deferred third-party PDF source markers used by the
          // existing custody/startup audit. They are outside the eager graph.
          if (chunk.code.includes("node_modules/pdf-lib/") || chunk.code.includes("node_modules/@pdf-lib/fontkit/")) continue;
          const compacted = await minify(chunk.fileName, chunk.code, {
            compress: { keepNames: { function: true, class: true } },
            mangle: { keepNames: true },
          });
          if (compacted.errors.length) throw new Error(`Server minification failed: ${chunk.fileName}`);
          chunk.code = compacted.code;
        }
      },
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function sites(): Plugin {
  let root = process.cwd();
  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      if (await exists(hostingConfig)) await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      const drizzleSource = resolve(root, "drizzle");
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}
