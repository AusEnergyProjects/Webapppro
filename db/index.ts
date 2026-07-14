import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error("Trade account storage is unavailable.");
  }
  return env.DB;
}
