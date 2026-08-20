const textEncoder = new TextEncoder();

export const SURGE_CLIENT_COOKIE_NAME = "aea_surge_client";
export const SURGE_CLIENT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const CLIENT_ID_BYTES = 24;
const COOKIE_VERSION = "v1";
const MINIMUM_SECRET_LENGTH = 32;

export type SurgeClientIdentity = {
  ready: boolean;
  clientKey: string;
  networkKey: string;
  setCookie: string | null;
};

type SurgeClientIdentityOptions = {
  secret?: unknown;
  production?: boolean;
  now?: Date | number;
  randomBytes?: (length: number) => Uint8Array;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(key: CryptoKey, value: string) {
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function opaqueKey(key: CryptoKey, value: string) {
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verify(key: CryptoKey, value: string, signature: string) {
  const signatureBytes = base64UrlToBytes(signature);
  if (!signatureBytes) return false;
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    textEncoder.encode(value),
  );
}

function readCookie(request: Request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== SURGE_CLIENT_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value.length <= 512 ? value : "";
  }
  return "";
}

function nowSeconds(value: Date | number | undefined) {
  const milliseconds = value instanceof Date ? value.getTime() : value ?? Date.now();
  return Math.floor(milliseconds / 1_000);
}

function defaultRandomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function readSignedClientId(token: string, key: CryptoKey, currentSeconds: number) {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, clientId, expiresText, signature] = parts;
  if (version !== COOKIE_VERSION || !/^[A-Za-z0-9_-]{32}$/u.test(clientId)) return null;
  if (!/^\d{1,12}$/u.test(expiresText)) return null;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= currentSeconds) return null;
  const signedValue = `${version}.${clientId}.${expiresText}`;
  return await verify(key, signedValue, signature) ? clientId : null;
}

async function createSignedClient(key: CryptoKey, currentSeconds: number, randomBytes: (length: number) => Uint8Array) {
  const random = randomBytes(CLIENT_ID_BYTES);
  if (!(random instanceof Uint8Array) || random.byteLength !== CLIENT_ID_BYTES) {
    throw new Error("Surge client identity randomness is unavailable.");
  }
  const clientId = bytesToBase64Url(random);
  const expiresAt = currentSeconds + SURGE_CLIENT_COOKIE_MAX_AGE_SECONDS;
  const signedValue = `${COOKIE_VERSION}.${clientId}.${expiresAt}`;
  const token = `${signedValue}.${await sign(key, signedValue)}`;
  return {
    clientId,
    setCookie: `${SURGE_CLIENT_COOKIE_NAME}=${token}; Max-Age=${SURGE_CLIENT_COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  };
}

function parseIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const byte = Number(part);
    if (byte < 0 || byte > 255) return null;
    bytes.push(byte);
  }
  return bytes;
}

function parseIpv6(value: string) {
  if (!value || value.includes("%") || value.split("::").length > 2) return null;
  let normalized = value.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (!ipv4) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const compressed = normalized.includes("::");
  const [leftText, rightText = ""] = normalized.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  if ((!compressed && left.length !== 8) || (compressed && left.length + right.length >= 8)) return null;

  const missing = 8 - left.length - right.length;
  const groups = compressed ? [...left, ...Array(missing).fill("0"), ...right] : left;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    const group = Number.parseInt(groups[index], 16);
    bytes[index * 2] = group >>> 8;
    bytes[(index * 2) + 1] = group & 0xff;
  }
  return bytes;
}

function coarseNetworkPrefix(value: string) {
  const candidate = value.trim();
  const ipv4 = parseIpv4(candidate);
  if (ipv4) return `ipv4:${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`;

  const ipv6 = parseIpv6(candidate);
  if (!ipv6) return null;
  const mappedIpv4 = ipv6.slice(0, 10).every((byte) => byte === 0)
    && ipv6[10] === 0xff
    && ipv6[11] === 0xff;
  if (mappedIpv4) return `ipv4:${ipv6[12]}.${ipv6[13]}.${ipv6[14]}.0/24`;
  return `ipv6:${bytesToBase64Url(ipv6.slice(0, 7))}/56`;
}

function requestNetworkPrefix(request: Request, production: boolean) {
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  if (cloudflareIp) {
    const prefix = coarseNetworkPrefix(cloudflareIp);
    if (prefix) return prefix;
  }
  if (production) return null;

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",", 1)[0];
  if (forwardedIp) {
    const prefix = coarseNetworkPrefix(forwardedIp);
    if (prefix) return prefix;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const prefix = coarseNetworkPrefix(realIp);
    if (prefix) return prefix;
  }
  return "local";
}

export async function resolveSurgeClientIdentity(
  request: Request,
  options: SurgeClientIdentityOptions = {},
): Promise<SurgeClientIdentity> {
  const secret = typeof options.secret === "string" ? options.secret : "";
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    return { ready: false, clientKey: "", networkKey: "", setCookie: null };
  }

  const key = await hmacKey(secret);
  const currentSeconds = nowSeconds(options.now);
  const existingToken = readCookie(request);
  let clientId = existingToken
    ? await readSignedClientId(existingToken, key, currentSeconds)
    : null;
  let setCookie: string | null = null;
  if (!clientId) {
    const created = await createSignedClient(
      key,
      currentSeconds,
      options.randomBytes || defaultRandomBytes,
    );
    clientId = created.clientId;
    setCookie = created.setCookie;
  }

  const networkPrefix = requestNetworkPrefix(
    request,
    options.production ?? process.env.NODE_ENV === "production",
  );
  const clientKey = await opaqueKey(key, `client:${clientId}`);
  if (!networkPrefix) {
    return { ready: false, clientKey, networkKey: "", setCookie };
  }
  const networkKey = await opaqueKey(key, `network:${networkPrefix}`);
  return { ready: true, clientKey, networkKey, setCookie };
}
