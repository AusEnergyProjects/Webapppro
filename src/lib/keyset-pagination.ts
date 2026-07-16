export type KeysetDirection = "asc" | "desc";
export type KeysetValue = string | number;

export type KeysetTerm = {
  expression: string;
  direction: KeysetDirection;
};

type CursorPayload = {
  version: 1;
  sort: string;
  values: KeysetValue[];
};

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeKeysetCursor(sort: string, values: KeysetValue[]) {
  return encodeBase64Url(JSON.stringify({ version: 1, sort, values } satisfies CursorPayload));
}

export function decodeKeysetCursor(raw: string, expectedSort: string, expectedValues: number) {
  if (!raw) return null;
  if (raw.length > 2_000) throw new Error("INVALID_CURSOR");
  try {
    const payload = JSON.parse(decodeBase64Url(raw)) as Partial<CursorPayload>;
    if (payload.version !== 1 || payload.sort !== expectedSort || !Array.isArray(payload.values) || payload.values.length !== expectedValues) {
      throw new Error("INVALID_CURSOR");
    }
    const values = payload.values.map((value) => {
      if (typeof value === "string") return value.slice(0, 500);
      if (typeof value === "number" && Number.isFinite(value)) return value;
      throw new Error("INVALID_CURSOR");
    });
    return values;
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

export function keysetAfter(terms: KeysetTerm[], values: KeysetValue[]) {
  if (!terms.length || terms.length !== values.length) throw new Error("INVALID_CURSOR");
  const direction = terms[0].direction;
  if (terms.every((term) => term.direction === direction)) {
    const comparator = direction === "desc" ? "<" : ">";
    const primaryComparator = direction === "desc" ? "<=" : ">=";
    return {
      sql: `${terms[0].expression} ${primaryComparator} ? AND (${terms.map((term) => term.expression).join(", ")}) ${comparator} (${terms.map(() => "?").join(", ")})`,
      bindings: [values[0], ...values],
    };
  }
  const clauses: string[] = [];
  const bindings: KeysetValue[] = [];
  for (let index = 0; index < terms.length; index += 1) {
    const equality = terms.slice(0, index).map((term) => `${term.expression} = ?`);
    const comparator = terms[index].direction === "desc" ? "<" : ">";
    clauses.push(`(${[...equality, `${terms[index].expression} ${comparator} ?`].join(" AND ")})`);
    bindings.push(...values.slice(0, index), values[index]);
  }
  return { sql: clauses.join(" OR "), bindings };
}
