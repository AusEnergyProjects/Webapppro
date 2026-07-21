import { getD1 } from "../../../../../db";
import {
  adminError,
  adminJson,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";
import {
  DATABASE_MAX_BODY_LENGTH,
  DatabaseConsoleInputError,
  databaseConsoleErrorResponse,
  databaseDeleteConfirmation,
  databaseDeleteStatements,
  databaseOffset,
  databasePageSize,
  databaseInsertStatements,
  databaseTablePolicy,
  normaliseDatabaseColumn,
  prepareDatabaseInsert,
  prepareDatabaseKey,
  presentDatabaseRow,
  quoteDatabaseIdentifier,
  validateDatabaseInsertForTable,
  type DatabaseColumn,
  type DatabaseTablePolicy,
} from "@/lib/admin-database-console";

export const runtime = "edge";

type CatalogRow = { schema: string; name: string; type: string };
type CatalogEntry = DatabaseTablePolicy & { name: string };

async function databaseCatalog(db: D1Database): Promise<CatalogEntry[]> {
  const result = await db.prepare("PRAGMA table_list").all<CatalogRow>();
  return result.results
    .filter((row) => row.schema === "main" && row.type === "table")
    .map((row) => ({ name: String(row.name), ...databaseTablePolicy(String(row.name)) }))
    .sort((left, right) => left.name.localeCompare(right.name, "en-AU"))
    .filter((entry) => entry.visible);
}

async function selectedTable(db: D1Database, table: unknown) {
  const name = typeof table === "string" ? table : "";
  const catalog = await databaseCatalog(db);
  const entry = catalog.find((candidate) => candidate.name === name);
  if (!entry) throw new DatabaseConsoleInputError("Choose a table from the live database catalogue.", 404);
  const identifier = quoteDatabaseIdentifier(entry.name);
  const schema = await db.prepare(`PRAGMA table_xinfo(${identifier})`).all<Record<string, unknown>>();
  const columns = schema.results.map(normaliseDatabaseColumn);
  if (!columns.length) throw new DatabaseConsoleInputError("This table does not expose row columns.", 409);
  return { entry, identifier, columns };
}

function visibleColumns(columns: DatabaseColumn[]) {
  return columns.filter((column) => column.hidden === 0);
}

function primaryKeyColumns(columns: DatabaseColumn[]) {
  return visibleColumns(columns)
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
}

async function requestBody(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > DATABASE_MAX_BODY_LENGTH) throw new DatabaseConsoleInputError("The request is too large for this console.", 413);
  const text = await request.text();
  if (text.length > DATABASE_MAX_BODY_LENGTH) throw new DatabaseConsoleInputError("The request is too large for this console.", 413);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed as Record<string, unknown>;
  } catch {
    throw new DatabaseConsoleInputError("The database request was not valid JSON.");
  }
}

function consoleFailure(error: unknown) {
  const safe = databaseConsoleErrorResponse(error);
  return safe ? adminJson({ ok: false, error: safe.message }, safe.status) : adminError(error);
}

function requireRecentOwnerAuthentication(authTime: number) {
  if (!Number.isFinite(authTime) || Date.now() / 1000 - authTime > 15 * 60) {
    throw new DatabaseConsoleInputError("Sign out and sign in again before changing a live database row.", 403);
  }
}

async function validateDatabaseInsertReferences(db: D1Database, table: string, values: Record<string, unknown>) {
  if (table === "trade_team_working_hours" || table === "trade_team_unavailability") {
    const member = await db.prepare(`SELECT id FROM trade_team_members
      WHERE id = ? AND owner_uid = ? AND status = 'active' LIMIT 1`)
      .bind(values.team_member_id, values.owner_uid)
      .first();
    if (!member) throw new DatabaseConsoleInputError("Choose an active team member that belongs to the supplied owner.", 409);
    if (table === "trade_team_unavailability" && values.created_by_uid !== values.owner_uid) {
      const creator = await db.prepare(`SELECT id FROM trade_team_members
        WHERE owner_uid = ? AND member_uid = ? AND status = 'active' LIMIT 1`)
        .bind(values.owner_uid, values.created_by_uid)
        .first();
      if (!creator) throw new DatabaseConsoleInputError("created_by_uid must identify the owner or an active member of that team.", 409);
    }
  }
  if (table === "workspace_list_views") {
    const scope = String(values.owner_scope || "");
    const owner = scope.startsWith("admin")
      ? await db.prepare("SELECT id FROM admin_users WHERE firebase_uid = ? AND status = 'active' LIMIT 1").bind(values.owner_uid).first()
      : await db.prepare("SELECT firebase_uid FROM trade_accounts WHERE firebase_uid = ? AND account_status = 'active' LIMIT 1").bind(values.owner_uid).first();
    if (!owner) throw new DatabaseConsoleInputError("The saved view must belong to an active admin or trade account.", 409);
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner"]);
    const db = getD1();
    const url = new URL(request.url);
    const catalog = await databaseCatalog(db);
    const requestedTable = url.searchParams.get("table");
    if (!requestedTable) return adminJson({ ok: true, tables: catalog });

    const { entry, identifier, columns } = await selectedTable(db, requestedTable);
    const pageSize = databasePageSize(url.searchParams.get("pageSize"));
    const offset = databaseOffset(url.searchParams.get("offset"));
    const primaryKey = primaryKeyColumns(columns);
    const orderBy = primaryKey.length
      ? primaryKey.map((column) => `${quoteDatabaseIdentifier(column.name)} ASC`).join(", ")
      : "rowid ASC";
    const [count, rows] = await Promise.all([
      db.prepare(`SELECT COUNT(*) total FROM ${identifier}`).first<{ total: number }>(),
      db.prepare(`SELECT * FROM ${identifier} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .bind(pageSize, offset)
        .all<Record<string, unknown>>(),
    ]);
    const total = Number(count?.total || 0);
    return adminJson({
      ok: true,
      tables: catalog,
      table: {
        ...entry,
        canDelete: entry.canDelete && primaryKey.length > 0,
        columns: visibleColumns(columns),
        primaryKey: primaryKey.map((column) => column.name),
        rows: rows.results.map((row) => ({
          ...presentDatabaseRow(row, columns),
          deleteConfirmation: entry.canDelete && primaryKey.length
            ? databaseDeleteConfirmation(entry.name, primaryKey.map((column) => column.name), primaryKey.map((column) => row[column.name]))
            : "",
        })),
        pagination: {
          offset,
          pageSize,
          total,
          hasPrevious: offset > 0,
          hasNext: offset + rows.results.length < total && offset + pageSize <= 10_000,
        },
      },
    });
  } catch (error) {
    return consoleFailure(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner"]);
    requireRecentOwnerAuthentication(admin.authTime);
    const body = await requestBody(request);
    const db = getD1();
    const { entry, columns } = await selectedTable(db, body.table);
    if (!entry.canInsert) throw new DatabaseConsoleInputError(entry.reason, 403);
    if (body.confirmation !== `ADD ${entry.name}`) {
      throw new DatabaseConsoleInputError(`Type ADD ${entry.name} to confirm this insert.`);
    }
    const prepared = prepareDatabaseInsert(columns, body.values);
    validateDatabaseInsertForTable(entry.name, prepared.values);
    await validateDatabaseInsertReferences(db, entry.name, prepared.values);
    const results = await db.batch(databaseInsertStatements(db, admin.uid, entry.name, columns, prepared));
    if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) throw new Error("DATABASE_INSERT_FAILED");
    return adminJson({ ok: true, table: entry.name }, 201);
  } catch (error) {
    return consoleFailure(error);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner"]);
    requireRecentOwnerAuthentication(admin.authTime);
    const body = await requestBody(request);
    const db = getD1();
    const { entry, columns } = await selectedTable(db, body.table);
    if (!entry.canDelete) throw new DatabaseConsoleInputError(entry.reason, 403);
    const key = prepareDatabaseKey(columns, body.key);
    const keyNames = key.columns.map((column) => column.name);
    const expectedConfirmation = databaseDeleteConfirmation(entry.name, keyNames, key.bindings);
    if (body.confirmation !== expectedConfirmation) {
      throw new DatabaseConsoleInputError(`Type ${expectedConfirmation} to confirm this deletion.`);
    }
    const results = await db.batch(databaseDeleteStatements(db, admin.uid, entry.name, keyNames, key.bindings));
    if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
      throw new DatabaseConsoleInputError("That row no longer exists. Refresh the table before trying again.", 404);
    }
    return adminJson({ ok: true, table: entry.name });
  } catch (error) {
    return consoleFailure(error);
  }
}
