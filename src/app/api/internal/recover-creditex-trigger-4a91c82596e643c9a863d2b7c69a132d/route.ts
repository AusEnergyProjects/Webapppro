import { NextResponse } from "next/server";

import { getD1 } from "../../../../../db";
import { ensureCreditexWorkPackSchemaGuards } from "@/lib/creditex-work-pack-schema-guards";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const RECOVERY_KEY = "aea-repair-bcc36a09e4f4479ebc157fa273cf1314";
const LEGACY_TRIGGER = "compliance_sres_activation_snapshot_insert_guard";

export async function POST(request: Request) {
  if (request.headers.get("x-recovery-key") !== RECOVERY_KEY) {
    return new NextResponse(null, { status: 404 });
  }

  const database = getD1();
  await database.prepare(`DROP TRIGGER IF EXISTS \`${LEGACY_TRIGGER}\``).run();
  await ensureCreditexWorkPackSchemaGuards(database);

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
