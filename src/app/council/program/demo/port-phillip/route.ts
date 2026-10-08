import { SECCCA_JOURNEY_DEMO_PATH } from "@/lib/council-public-branding";

export function GET(request: Request) {
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "no-store",
      Location: new URL(SECCCA_JOURNEY_DEMO_PATH, request.url).toString(),
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export const HEAD = GET;
