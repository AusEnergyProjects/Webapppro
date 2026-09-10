import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { draftComplianceDeletionGuardDefinitions, draftWorkPackDeletionGuardDefinitions } from '../../src/lib/trade-job-draft-compliance-deletion.ts';

let dependencySchema;
function deletionDependencySchema() {
  if (dependencySchema) return dependencySchema;
  const schema = new DatabaseSync(':memory:');
  try {
    const root = new URL('../../drizzle/', import.meta.url);
    for (const name of fs.readdirSync(root).filter(name => /^\d{4}_.+\.sql$/.test(name) && !name.startsWith('0044_')).sort()) {
      schema.exec(fs.readFileSync(new URL(name, root), 'utf8').replaceAll('--> statement-breakpoint', ''));
    }
    const tables = new Map(schema.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table'").all().map(row => [row.name, row.sql]));
    const dependencies = new Set();
    for (const guard of [...draftComplianceDeletionGuardDefinitions, ...draftWorkPackDeletionGuardDefinitions]) {
      for (const match of guard.sql.matchAll(/(?:FROM|JOIN|DELETE ON)\s+`?([a-z_]+)/gi)) {
        if (tables.has(match[1])) dependencies.add(match[1]);
      }
    }
    dependencySchema = [...dependencies].map(name => ({ name, sql: tables.get(name), columns: schema.prepare(`PRAGMA table_info(\`${name}\`)`).all() }));
    return dependencySchema;
  } finally {
    schema.close();
  }
}

// Isolated legacy suites create a subset of the domain schema. Extend only the
// context now read by deletion guards, from real migrations. Existing columns,
// constraints and rows are untouched; absent columns remain nullable fixture
// context unless the production schema supplies a default. No permit is added.
export function installMissingDraftDeletionContext(database) {
  const existingTables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => row.name));
  for (const table of deletionDependencySchema()) {
    if (!existingTables.has(table.name)) {
      database.exec(table.sql);
      continue;
    }
    const existingColumns = new Set(database.prepare(`PRAGMA table_info(\`${table.name}\`)`).all().map(row => row.name));
    for (const column of table.columns) {
      if (!existingColumns.has(column.name)) database.exec(`ALTER TABLE \`${table.name}\` ADD COLUMN \`${column.name}\` ${column.type}${column.dflt_value === null ? '' : ` DEFAULT ${column.dflt_value}`}`);
    }
  }
}
