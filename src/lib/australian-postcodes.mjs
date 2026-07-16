const STATE_ALIASES = new Map([
  ["ACT", "ACT"],
  ["NSW", "NSW"],
  ["NT", "NT"],
  ["QLD", "QLD"],
  ["SA", "SA"],
  ["TAS", "TAS"],
  ["VIC", "VIC"],
  ["WA", "WA"],
]);

const STATE_LABELS = {
  ACT: "the Australian Capital Territory",
  NSW: "New South Wales",
  NT: "the Northern Territory",
  QLD: "Queensland",
  SA: "South Australia",
  TAS: "Tasmania",
  VIC: "Victoria",
  WA: "Western Australia",
};

export const AUSTRALIAN_STATE_CODES = Object.freeze(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);

export const AUSTRALIAN_STATE_OPTIONS = Object.freeze([
  ["ACT", "Australian Capital Territory"],
  ["NSW", "New South Wales"],
  ["NT", "Northern Territory"],
  ["QLD", "Queensland"],
  ["SA", "South Australia"],
  ["TAS", "Tasmania"],
  ["VIC", "Victoria"],
  ["WA", "Western Australia"],
]);

export function canonicalAustralianState(value) {
  return STATE_ALIASES.get(String(value || "").trim().toUpperCase()) || null;
}

export function residentialStateFromPostcode(postcode) {
  const text = String(postcode || "").trim();
  if (!/^\d{4}$/.test(text)) return null;
  const value = Number(text);
  if ((value >= 200 && value <= 299) || (value >= 2600 && value <= 2618) || (value >= 2900 && value <= 2920)) return "ACT";
  if ((value >= 1000 && value <= 2599) || (value >= 2619 && value <= 2899) || (value >= 2921 && value <= 2999)) return "NSW";
  if (value >= 800 && value <= 999) return "NT";
  if (value >= 3000 && value <= 3999) return "VIC";
  if (value >= 4000 && value <= 4999) return "QLD";
  if (value >= 5000 && value <= 5999) return "SA";
  if (value >= 6000 && value <= 6999) return "WA";
  if (value >= 7000 && value <= 7999) return "TAS";
  return null;
}

export function postcodeMatchesState(postcode, state) {
  const inferred = residentialStateFromPostcode(postcode);
  const selected = canonicalAustralianState(state);
  return !inferred || !selected || inferred === selected;
}

export function australianStateLabel(state) {
  const canonical = canonicalAustralianState(state);
  return canonical ? STATE_LABELS[canonical] : "the selected state or territory";
}
