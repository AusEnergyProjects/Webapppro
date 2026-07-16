import { getD1 } from "../../../../db";
import { loadCertificatePriceDataset } from "@/lib/certificate-prices-server";

export const runtime = "edge";

export async function GET() {
  try {
    const dataset = await loadCertificatePriceDataset(getD1());
    return Response.json(dataset, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("Certificate price history request failed.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Certificate price history is temporarily unavailable. Please try again later." }, { status: 503 });
  }
}
