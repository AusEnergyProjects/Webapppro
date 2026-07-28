export const runtime = "edge";

export async function POST() {
  return Response.json({
    ok: true,
    ignored: true,
    code: "SITES_FINANCIAL_TRANSACTIONS_DISABLED",
  }, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
