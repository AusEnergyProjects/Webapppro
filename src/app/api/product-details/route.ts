import { buildProductComparisonItem } from "@/lib/product-comparison-item";

export const runtime = "edge";

export async function GET(request: Request) {
  const values = new URL(request.url).searchParams.getAll("productId");
  const id = values[0] || "";
  if (values.length !== 1 || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(id)) {
    return Response.json({ error: "Choose a valid product." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { PRODUCT_GUIDE_CATEGORIES } = await import("@/lib/product-guides");
  for (const category of PRODUCT_GUIDE_CATEGORIES) {
    const option = category.options.find(product => product.id === id);
    if (option) {
      return Response.json({ product: buildProductComparisonItem(option, category.slug) }, {
        headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
      });
    }
  }
  return Response.json({ error: "This product was not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
