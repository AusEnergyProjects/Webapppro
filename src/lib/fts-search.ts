export function ftsPrefixQuery(value: string) {
  const tokens = value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) || [];
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}
