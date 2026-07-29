import {
  AEA_BRANDMARK_PNG_DATA_URI,
} from "@/lib/aea-brand-assets.mjs";

export const runtime = "edge";

const PNG_BASE64 = AEA_BRANDMARK_PNG_DATA_URI.replace(
  /^data:image\/png;base64,/,
  "",
);

function brandmarkBytes() {
  const binary = atob(PNG_BASE64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function GET() {
  return new Response(brandmarkBytes(), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
