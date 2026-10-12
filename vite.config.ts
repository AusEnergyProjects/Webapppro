import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites, compactServerOutput } from "./build/sites-vite-plugin";

const { d1, r2 } = hostingConfig;

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    environments: {
      rsc: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [{
                  // Cheap request validation must not share a chunk with the
                  // on-demand rebate engine and its official product registers.
                  name: "product-rebate-contract",
                  test: /[\\/]src[\\/]lib[\\/]product-rebate-check\.ts$/,
                  priority: 30,
                  minSize: 0,
                  includeDependenciesRecursively: true,
                }, {
                  // A stateless Worker otherwise resolves dozens of shared
                  // modules before even a trivial API can begin. Co-locate the
                  // already-eager graph while keeping on-demand modules separate.
                  name: "worker-startup",
                  tags: ["$initial"],
                  priority: 20,
                  minSize: 0,
                  includeDependenciesRecursively: true,
                }],
              },
            },
          },
        },
      },
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [{
                  // Keep shared schedule helpers from pulling the full Jobs workspace into the dashboard.
                  name: "trade-schedule",
                  test: /[\\/]src[\\/]lib[\\/]trade-schedule\.ts$/,
                  priority: 20,
                  minSize: 0,
                  includeDependenciesRecursively: false,
                }],
              },
            },
          },
        },
      },
    },
    plugins: [
      vinext(),
      compactServerOutput(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: [
            "nodejs_compat",
            "global_fetch_strictly_public",
          ],
          triggers: { crons: ["* * * * *", "15 20 * * *", "5 13,14 * * *", "25 13,14 * * *"] },
          d1_databases: d1 ? [{ binding: d1, database_name: "aea-energy", database_id: "00000000-0000-4000-8000-000000000000" }] : [],
          r2_buckets: r2 ? [{ binding: r2, bucket_name: "aea-energy" }] : [],
        },
      }),
    ],
  };
});
