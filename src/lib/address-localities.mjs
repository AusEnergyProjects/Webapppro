import postcodeLocalities from "../data/postcode-localities.json" with { type: "json" };

const AUSTRALIAN_STATES = new Set([
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
]);

export const ADDRESS_LOCALITY_SOURCE = Object.freeze({
  dataset: "Australian Postcodes & Suburbs 2026-05-27 Delivery Area snapshot",
  sourceUrl:
    "https://raw.githubusercontent.com/schappim/australian-postcodes/7874021a281bad87d8cd234a7d8f82d18f279fcc/australian-postcodes-2026-05-27.csv",
  sourceCommit: "7874021a281bad87d8cd234a7d8f82d18f279fcc",
  sourceSha256:
    "9120ed3f90b5dbfa12186ea11f19852f98b556e07c2cb3df5f93d1b97830bff8",
  artifactSha256:
    "1d75e7645d79c50ec117fe7776ed88d761b5e64f474a6448af74ef60697f074c",
  snapshotDate: "2026-05-27",
});

function singleLine(value, maximum) {
  return typeof value === "string"
    ? value
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maximum)
    : "";
}

function canonicalPostcode(value) {
  const postcode = singleLine(value, 4);
  return /^\d{4}$/.test(postcode) ? postcode : "";
}

function canonicalState(value) {
  const state = singleLine(value, 3).toUpperCase();
  return AUSTRALIAN_STATES.has(state) ? state : "";
}

function rawOptions(postcode) {
  const value = postcodeLocalities[postcode];
  return Array.isArray(value) ? value : [];
}

export function addressLocalitiesForPostcode(postcodeValue) {
  const postcode = canonicalPostcode(postcodeValue);
  if (!postcode) return null;
  const localities = rawOptions(postcode)
    .map((option) => ({
      suburb: singleLine(option?.suburb, 80),
      state: canonicalState(option?.state),
    }))
    .filter((option) => option.suburb && option.state);
  return localities.length ? { postcode, localities } : null;
}

export function resolveAddressLocalityTuple({
  postcode: postcodeValue,
  suburb: suburbValue,
  state: stateValue,
} = {}) {
  const postcode = canonicalPostcode(postcodeValue);
  const suburb = singleLine(suburbValue, 80);
  const state = canonicalState(stateValue);
  if (!postcode || !suburb || !state) return null;
  const suburbKey = suburb.toLocaleUpperCase("en-AU");
  const match = rawOptions(postcode).find((option) => (
    singleLine(option?.suburb, 80).toLocaleUpperCase("en-AU") === suburbKey
    && canonicalState(option?.state) === state
  ));
  if (!match) return null;
  return Object.freeze({
    postcode,
    suburb: singleLine(match.suburb, 80),
    state: canonicalState(match.state),
  });
}
