import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";

const root = new URL("../../", import.meta.url);

export function migratedDataforceSqlite() {
  const sqlite = new DatabaseSync(":memory:");
  const virtualTables = new Map();
  for (const name of fs.readdirSync(new URL("drizzle/", root)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    for (const statement of fs.readFileSync(new URL(`drizzle/${name}`, root), "utf8").split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      const virtual = statement.match(/^CREATE VIRTUAL TABLE ([a-z_]+) USING fts5\((.*)\);?$/is);
      if (virtual) virtualTables.set(virtual[1], statement);
      try { sqlite.exec(statement); }
      catch (error) {
        if (!error.message.includes("no such module: fts5") || !virtual) throw error;
        sqlite.exec(`CREATE TABLE ${virtual[1]} (${virtual[2].split(",").map(value => value.trim())
          .filter(value => !value.startsWith("tokenize=")).map(value => `${value.split(/\s+/)[0]} text`).join(",")})`);
      }
    }
  }
  return { sqlite, virtualTables };
}

export async function migratedDataforceD1(options = {}) {
  const { sqlite, virtualTables } = migratedDataforceSqlite();
  const mf = new Miniflare({ modules: true, script: options.workerScript || 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-05-01", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = sqlite.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'view' THEN 3 ELSE 4 END`).all();
    const statements = schema.filter(item => ![...virtualTables.keys()].some(name => item.name !== name && item.name.startsWith(`${name}_`)))
      .map(item => virtualTables.get(item.name) || item.sql);
    for (let offset = 0; offset < statements.length; offset += 20) await db.batch(statements.slice(offset, offset + 20).map(sql => db.prepare(sql)));
    return { db, dispatch: (input, init) => mf.dispatchFetch(input, init), close: async () => { sqlite.close(); await mf.dispose(); } };
  } catch (error) { sqlite.close(); await mf.dispose(); throw error; }
}
