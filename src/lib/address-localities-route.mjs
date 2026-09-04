import { addressLocalitiesForPostcode } from "./address-localities.mjs";
import { energyRatingClimateForPostcode } from "./energy-rating-climate.mjs";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function addressLocalitiesGet(request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      error: "Request origin was not accepted.",
      postcode: "",
      localities: [],
    }, 403);
  }
  const postcode = new URL(request.url).searchParams.get("postcode") || "";
  const result = addressLocalitiesForPostcode(postcode);
  if (!result) {
    return json({
      ok: false,
      error: "Enter a recognised four digit Australian delivery-area postcode.",
      postcode: "",
      localities: [],
    }, 400);
  }
  return json({
    ok: true,
    ...result,
    energyRatingClimate: energyRatingClimateForPostcode(result.postcode),
  });
}
