import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  const database = env.DB as D1Database | undefined;
  if (!database) {
    throw new Error("Trade account storage is unavailable.");
  }
  return database;
}
