import {
  canonicalAustralianState,
  postcodeMatchesState,
  residentialStateFromPostcode,
} from "./australian-postcodes.mjs";

export const TRADE_ADDRESS_SELECTION_PROOF_VERSION = 1;
export const TRADE_ADDRESS_SELECTION_PROOF_TTL_MS = 15 * 60 * 1000;

export type TradeAddressEntryMode = "manual_pending_review" | "provider_selected";

export type AustralianAddressComponents = {
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  addressState: string;
  postcode: string;
};

export type TradeAddressInput = {
  addressLine1?: unknown;
  addressLine2?: unknown;
  suburb?: unknown;
  addressState?: unknown;
  postcode?: unknown;
  addressEntryMode?: unknown;
  addressProvider?: unknown;
  addressProviderReference?: unknown;
  addressFormatted?: unknown;
  addressSelectionProof?: unknown;
};

export type TradeAddressProvenance = AustralianAddressComponents & {
  addressEntryMode: TradeAddressEntryMode;
  addressProvider: string;
  addressProviderReference: string;
  addressFormatted: string;
  addressVerifiedAt: string;
};

export type ProviderAddressSelection = AustralianAddressComponents & {
  provider: string;
  providerReference: string;
  formattedAddress: string;
};

type ProofPayload = {
  version: typeof TRADE_ADDRESS_SELECTION_PROOF_VERSION;
  ownerUid: string;
  issuedAt: number;
  expiresAt: number;
  selection: ProviderAddressSelection;
};

type ProofOptions = {
  ownerUid: string;
  secret: string;
  now?: number;
};

type IssueProofOptions = ProofOptions & {
  ttlMs?: number;
};

export class TradeAddressVerificationError extends Error {
  readonly code:
    | "ADDRESS_INCOMPLETE"
    | "ADDRESS_STATE_INVALID"
    | "ADDRESS_POSTCODE_INVALID"
    | "ADDRESS_POSTCODE_STATE_MISMATCH"
    | "ADDRESS_PROVIDER_INVALID"
    | "ADDRESS_PROVENANCE_MISMATCH"
    | "ADDRESS_SELECTION_PROOF_INVALID"
    | "ADDRESS_SELECTION_PROOF_EXPIRED"
    | "ADDRESS_PROOF_KEY_INVALID";

  constructor(
    code:
      | "ADDRESS_INCOMPLETE"
      | "ADDRESS_STATE_INVALID"
      | "ADDRESS_POSTCODE_INVALID"
      | "ADDRESS_POSTCODE_STATE_MISMATCH"
      | "ADDRESS_PROVIDER_INVALID"
      | "ADDRESS_PROVENANCE_MISMATCH"
      | "ADDRESS_SELECTION_PROOF_INVALID"
      | "ADDRESS_SELECTION_PROOF_EXPIRED"
      | "ADDRESS_PROOF_KEY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "TradeAddressVerificationError";
    this.code = code;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const proofContext = encoder.encode("tlink-address-selection-proof-v1");

function clean(value: unknown, maximum: number) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalOwnerUid(value: unknown) {
  const ownerUid = clean(value, 180);
  if (!ownerUid) throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_INVALID", "Address selection ownership is invalid.");
  return ownerUid;
}

function canonicalProvider(value: unknown) {
  const provider = clean(value, 120).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,118}[a-z0-9])?$/.test(provider)) {
    throw new TradeAddressVerificationError("ADDRESS_PROVIDER_INVALID", "Address provider information is invalid.");
  }
  return provider;
}

export function canonicalAustralianAddress(input: TradeAddressInput): AustralianAddressComponents {
  const addressLine1 = clean(input.addressLine1, 140);
  const addressLine2 = clean(input.addressLine2, 140);
  const suburb = clean(input.suburb, 80);
  const addressState = canonicalAustralianState(clean(input.addressState, 20));
  const postcode = clean(input.postcode, 12);

  if (!addressLine1 || !suburb) {
    throw new TradeAddressVerificationError(
      "ADDRESS_INCOMPLETE",
      "Add the service street and suburb.",
    );
  }
  if (!addressState) {
    throw new TradeAddressVerificationError(
      "ADDRESS_STATE_INVALID",
      "Choose a valid Australian state or territory.",
    );
  }
  if (!/^\d{4}$/.test(postcode) || !residentialStateFromPostcode(postcode)) {
    throw new TradeAddressVerificationError(
      "ADDRESS_POSTCODE_INVALID",
      "Enter a recognised four digit Australian postcode.",
    );
  }
  if (!postcodeMatchesState(postcode, addressState)) {
    throw new TradeAddressVerificationError(
      "ADDRESS_POSTCODE_STATE_MISMATCH",
      "The postcode does not match the selected state or territory.",
    );
  }

  return { addressLine1, addressLine2, suburb, addressState, postcode };
}

export function canonicalProviderAddressSelection(input: ProviderAddressSelection): ProviderAddressSelection {
  const address = canonicalAustralianAddress(input);
  const provider = canonicalProvider(input.provider);
  const providerReference = clean(input.providerReference, 180);
  const formattedAddress = clean(input.formattedAddress, 300);
  if (!providerReference || !formattedAddress) {
    throw new TradeAddressVerificationError(
      "ADDRESS_PROVIDER_INVALID",
      "Address provider reference and formatted address are required.",
    );
  }
  return { ...address, provider, providerReference, formattedAddress };
}

function canonicalProofPayload(payload: ProofPayload) {
  return JSON.stringify({
    version: TRADE_ADDRESS_SELECTION_PROOF_VERSION,
    ownerUid: canonicalOwnerUid(payload.ownerUid),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    selection: canonicalProviderAddressSelection(payload.selection),
  });
}

async function proofKey(secret: string) {
  let root: Uint8Array;
  try { root = fromBase64Url(clean(secret, 1000)); }
  catch {
    throw new TradeAddressVerificationError(
      "ADDRESS_PROOF_KEY_INVALID",
      "Address selection verification is not configured.",
    );
  }
  if (root.byteLength !== 32) {
    throw new TradeAddressVerificationError(
      "ADDRESS_PROOF_KEY_INVALID",
      "Address selection verification is not configured.",
    );
  }
  const material = new Uint8Array(proofContext.byteLength + root.byteLength);
  material.set(proofContext);
  material.set(root, proofContext.byteLength);
  const derived = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueTradeAddressSelectionProof(
  input: ProviderAddressSelection,
  options: IssueProofOptions,
) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? TRADE_ADDRESS_SELECTION_PROOF_TTL_MS;
  if (!Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > TRADE_ADDRESS_SELECTION_PROOF_TTL_MS) {
    throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_INVALID", "Address selection proof timing is invalid.");
  }
  const payload: ProofPayload = {
    version: TRADE_ADDRESS_SELECTION_PROOF_VERSION,
    ownerUid: canonicalOwnerUid(options.ownerUid),
    issuedAt: Math.trunc(now),
    expiresAt: Math.trunc(now + ttlMs),
    selection: canonicalProviderAddressSelection(input),
  };
  const encodedPayload = base64Url(encoder.encode(canonicalProofPayload(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await proofKey(options.secret),
    encoder.encode(encodedPayload),
  );
  return `v${TRADE_ADDRESS_SELECTION_PROOF_VERSION}.${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

async function verifiedProofPayload(proof: string, options: ProofOptions): Promise<ProofPayload> {
  const [version, encodedPayload, encodedSignature] = clean(proof, 5000).split(".");
  if (version !== `v${TRADE_ADDRESS_SELECTION_PROOF_VERSION}` || !encodedPayload || !encodedSignature) {
    throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_INVALID", "Address selection proof is invalid.");
  }
  let signature: Uint8Array;
  let payload: ProofPayload;
  try {
    signature = fromBase64Url(encodedSignature);
    payload = JSON.parse(decoder.decode(fromBase64Url(encodedPayload))) as ProofPayload;
  } catch {
    throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_INVALID", "Address selection proof is invalid.");
  }
  const verified = await crypto.subtle.verify(
    "HMAC",
    await proofKey(options.secret),
    signature as BufferSource,
    encoder.encode(encodedPayload),
  );
  if (!verified) {
    throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_INVALID", "Address selection proof is invalid.");
  }

  const now = options.now ?? Date.now();
  if (
    payload.version !== TRADE_ADDRESS_SELECTION_PROOF_VERSION
    || canonicalOwnerUid(payload.ownerUid) !== canonicalOwnerUid(options.ownerUid)
    || !Number.isSafeInteger(payload.issuedAt)
    || !Number.isSafeInteger(payload.expiresAt)
    || payload.issuedAt > now + 30_000
    || payload.expiresAt <= payload.issuedAt
  ) {
    throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_INVALID", "Address selection proof is invalid.");
  }
  if (now > payload.expiresAt) {
    throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_EXPIRED", "Address selection has expired. Search for the address again.");
  }
  const canonical = canonicalProofPayload(payload);
  if (base64Url(encoder.encode(canonical)) !== encodedPayload) {
    throw new TradeAddressVerificationError("ADDRESS_SELECTION_PROOF_INVALID", "Address selection proof is invalid.");
  }
  return payload;
}

export async function resolveTradeAddressProvenance(
  input: TradeAddressInput,
  options: ProofOptions,
): Promise<TradeAddressProvenance> {
  const address = canonicalAustralianAddress(input);
  const entryMode = clean(input.addressEntryMode, 40) || "manual_pending_review";
  const addressProvider = clean(input.addressProvider, 120);
  const addressProviderReference = clean(input.addressProviderReference, 180);
  const addressFormatted = clean(input.addressFormatted, 300);
  const addressSelectionProof = clean(input.addressSelectionProof, 5000);

  if (entryMode === "manual_pending_review") {
    if (addressProvider || addressProviderReference || addressFormatted || addressSelectionProof) {
      throw new TradeAddressVerificationError(
        "ADDRESS_PROVENANCE_MISMATCH",
        "Manual addresses cannot claim provider verification.",
      );
    }
    return {
      ...address,
      addressEntryMode: "manual_pending_review",
      addressProvider: "",
      addressProviderReference: "",
      addressFormatted: "",
      addressVerifiedAt: "",
    };
  }
  if (entryMode !== "provider_selected") {
    throw new TradeAddressVerificationError("ADDRESS_PROVENANCE_MISMATCH", "Address entry mode is invalid.");
  }

  const payload = await verifiedProofPayload(addressSelectionProof, options);
  const expected = canonicalProviderAddressSelection({
    ...address,
    provider: addressProvider,
    providerReference: addressProviderReference,
    formattedAddress: addressFormatted,
  });
  if (JSON.stringify(expected) !== JSON.stringify(payload.selection)) {
    throw new TradeAddressVerificationError(
      "ADDRESS_PROVENANCE_MISMATCH",
      "The address changed after it was selected. Search for the address again or enter it manually.",
    );
  }
  return {
    ...address,
    addressEntryMode: "provider_selected",
    addressProvider: expected.provider,
    addressProviderReference: expected.providerReference,
    addressFormatted: expected.formattedAddress,
    addressVerifiedAt: new Date(options.now ?? Date.now()).toISOString(),
  };
}
