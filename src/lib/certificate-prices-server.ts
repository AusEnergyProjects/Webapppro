import {
  CERTIFICATE_DEFINITIONS,
  collapseCertificateTradesByDay,
  isoDateMonthsBefore,
  parseDemandManagerCertificateHtml,
} from "@/lib/certificate-prices";
import type { CertificateCode, CertificatePriceDataset, CertificatePricePoint } from "@/lib/certificate-prices";

export const CERTIFICATE_PRICE_SOURCE_URL = "https://www.demandmanager.com.au/certificate-prices/";
const CERTIFICATE_PRICE_DATA_URL = "https://www.demandmanager.com.au/graphs/new_prices.php";
const SOURCE_NAME = "Demand Manager reported trades";
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface HistoryRow {
  certificate_code: string;
  traded_on: string;
  price_cents: number;
  captured_at: string;
}

interface SyncRow {
  fetched_at: string;
}

function syncId(fetchedAt: string) {
  return `demand-manager:${fetchedAt}`;
}

async function recordSyncFailure(db: D1Database, fetchedAt: string, message: string) {
  await db.prepare(`INSERT INTO certificate_price_sync_runs
    (id, source_name, status, record_count, message, fetched_at)
    VALUES (?, ?, 'failed', 0, ?, ?)`)
    .bind(syncId(fetchedAt), SOURCE_NAME, message.slice(0, 300), fetchedAt).run();
}

export async function syncCertificatePriceHistory(
  db: D1Database,
  options: { fetchImpl?: FetchLike; now?: Date } = {},
) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const fetchedAt = now.toISOString();
  const endDate = fetchedAt.slice(0, 10);
  const body = new URLSearchParams({
    day: "1",
    currentProduct: "all",
    stardate: isoDateMonthsBefore(now, 6),
    enddate: endDate,
  });

  try {
    const response = await fetchImpl(CERTIFICATE_PRICE_DATA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "Australian Energy Assessments certificate education tool",
      },
      body,
    });
    if (!response.ok) throw new Error(`Certificate source returned HTTP ${response.status}.`);
    const trades = collapseCertificateTradesByDay(parseDemandManagerCertificateHtml(await response.text()));
    if (trades.length < 7) throw new Error("The certificate source returned too little history.");

    const statements = trades.map((trade) => db.prepare(`INSERT INTO certificate_price_history
      (id, certificate_code, traded_on, price_cents, source_url, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (certificate_code, traded_on) DO UPDATE SET
        price_cents = excluded.price_cents,
        source_url = excluded.source_url,
        captured_at = excluded.captured_at`)
      .bind(`${trade.code}:${trade.tradedOn}`, trade.code, trade.tradedOn, trade.priceCents, CERTIFICATE_PRICE_SOURCE_URL, fetchedAt));
    for (let index = 0; index < statements.length; index += 75) await db.batch(statements.slice(index, index + 75));
    await db.prepare(`INSERT INTO certificate_price_sync_runs
      (id, source_name, status, record_count, message, fetched_at)
      VALUES (?, ?, 'success', ?, '', ?)`)
      .bind(syncId(fetchedAt), SOURCE_NAME, trades.length, fetchedAt).run();
    return { fetchedAt, recordCount: trades.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown certificate source error.";
    await recordSyncFailure(db, fetchedAt, message).catch(() => undefined);
    throw error;
  }
}

async function lastSuccessfulSync(db: D1Database) {
  return db.prepare(`SELECT fetched_at FROM certificate_price_sync_runs
    WHERE status = 'success' ORDER BY fetched_at DESC LIMIT 1`).first<SyncRow>();
}

export async function loadCertificatePriceDataset(
  db: D1Database,
  options: { fetchImpl?: FetchLike; now?: Date } = {},
): Promise<CertificatePriceDataset> {
  const now = options.now || new Date();
  let latestSync = await lastSuccessfulSync(db);
  let refreshFailed = false;
  if (!latestSync || now.getTime() - new Date(latestSync.fetched_at).getTime() >= REFRESH_AFTER_MS) {
    try {
      await syncCertificatePriceHistory(db, options);
      latestSync = await lastSuccessfulSync(db);
    } catch {
      refreshFailed = true;
    }
  }

  const startDate = isoDateMonthsBefore(now, 6);
  const rows = await db.prepare(`SELECT certificate_code, traded_on, price_cents, captured_at
    FROM certificate_price_history
    WHERE traded_on >= ?
    ORDER BY certificate_code, traded_on`).bind(startDate).all<HistoryRow>();
  if (!rows.results.length) throw new Error("Certificate price history is temporarily unavailable.");

  const pointsByCode = new Map<CertificateCode, CertificatePricePoint[]>();
  for (const definition of CERTIFICATE_DEFINITIONS) pointsByCode.set(definition.code, []);
  for (const row of rows.results) {
    const points = pointsByCode.get(row.certificate_code as CertificateCode);
    if (points) points.push({ tradedOn: row.traded_on, priceCents: Number(row.price_cents) });
  }

  const lastCheckedAt = latestSync?.fetched_at || rows.results.reduce((latest, row) => row.captured_at > latest ? row.captured_at : latest, "");
  const stale = refreshFailed || !lastCheckedAt || now.getTime() - new Date(lastCheckedAt).getTime() >= REFRESH_AFTER_MS * 2;
  return {
    asOf: now.toISOString(),
    source: {
      name: SOURCE_NAME,
      url: CERTIFICATE_PRICE_SOURCE_URL,
      lastCheckedAt,
      status: stale ? "stale" : "current",
      note: "Prices are indicative last reported trades, not a live exchange quote or a guaranteed customer rebate.",
    },
    certificates: CERTIFICATE_DEFINITIONS.map((definition) => {
      const points = pointsByCode.get(definition.code) || [];
      return { ...definition, points, latest: points.at(-1) || null };
    }),
  };
}
