/** A public Google Maps listing link, never an OAuth connection or review import. */
export function canonicalGoogleBusinessProfileUrl(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input) return "";
  if (input.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(input)) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const shortLink = host === "maps.app.goo.gl" && /^\/[a-zA-Z0-9_-]+\/?$/.test(path);
  const businessLink = host === "g.page" && /^\/(?:r\/)?[a-zA-Z0-9_-]+(?:\/review)?\/?$/.test(path);
  const mapsHost = ["google.com", "www.google.com", "google.com.au", "www.google.com.au"].includes(host);
  const legacyMapsHost = ["maps.google.com", "maps.google.com.au"].includes(host);
  const listingPath = /^\/maps\/(?:place|search)\/.+/.test(path);
  const listingQuery = ["cid", "ftid", "q", "query", "query_place_id"].some((key) => url.searchParams.get(key)?.trim());
  const mapsLink = (mapsHost && (listingPath || (/^\/maps(?:\/search)?\/?$/.test(path) && listingQuery)))
    || (legacyMapsHost && (/^\/(?:maps\/?)?$/.test(path) && listingQuery));
  if (!shortLink && !businessLink && !mapsLink) return null;
  // These are listing URLs, not Google's redirect endpoints.
  if (["url", "continue", "redirect", "redirect_uri", "redirect_url"].some((key) => url.searchParams.has(key))) return null;
  return url.href;
}
