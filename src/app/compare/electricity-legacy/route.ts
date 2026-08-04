export async function GET(request: Request) {
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "no-store",
      Location: new URL("/electricity-comparator", request.url).toString(),
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
