const MAX_WINDOWS = 3;
const MIN_WINDOW_MINUTES = 30;
const MAX_WINDOW_MINUTES = 4 * 60;
const MAX_ADVANCE_DAYS = 180;

const STATE_TIME_ZONES = {
  ACT: "Australia/Sydney",
  NSW: "Australia/Sydney",
  NT: "Australia/Darwin",
  QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide",
  TAS: "Australia/Hobart",
  VIC: "Australia/Melbourne",
  WA: "Australia/Perth",
};

export function australiaLocalDateTime(addressState = "NSW", value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATE_TIME_ZONES[addressState] || STATE_TIME_ZONES.NSW,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function australiaSydneyLocalDateTime(value = new Date()) {
  return australiaLocalDateTime("NSW", value);
}

function localDateTime(value) {
  const clean = typeof value === "string" ? value.trim().slice(0, 16) : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(clean) || Number.isNaN(Date.parse(`${clean}:00Z`))) {
    throw new Error("INVALID_ARRIVAL_WINDOWS");
  }
  return clean;
}

export function normaliseArrivalWindows(value, revision = 1, now = "", addressState = "NSW") {
  const localNow = now || australiaLocalDateTime(addressState);
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WINDOWS) throw new Error("INVALID_ARRIVAL_WINDOWS");
  const maximum = new Date(`${localNow}:00Z`);
  maximum.setUTCDate(maximum.getUTCDate() + MAX_ADVANCE_DAYS);
  const maximumValue = maximum.toISOString().slice(0, 16);
  const windows = value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("INVALID_ARRIVAL_WINDOWS");
    const startsAt = localDateTime(item.startsAt);
    const endsAt = localDateTime(item.endsAt);
    if (startsAt <= localNow || endsAt <= startsAt || startsAt.slice(0, 10) !== endsAt.slice(0, 10) || startsAt > maximumValue) {
      throw new Error("INVALID_ARRIVAL_WINDOWS");
    }
    const duration = (Date.parse(`${endsAt}:00Z`) - Date.parse(`${startsAt}:00Z`)) / 60_000;
    if (duration < MIN_WINDOW_MINUTES || duration > MAX_WINDOW_MINUTES) throw new Error("INVALID_ARRIVAL_WINDOWS");
    return { startsAt, endsAt };
  });
  windows.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  for (let index = 1; index < windows.length; index += 1) {
    if (windows[index].startsAt < windows[index - 1].endsAt) throw new Error("INVALID_ARRIVAL_WINDOWS");
  }
  return windows.map((window, index) => ({ id: `window-${revision}-${index + 1}`, ...window }));
}

export function parseArrivalWindows(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string"
      && typeof item.startsAt === "string" && typeof item.endsAt === "string") : [];
  } catch {
    return [];
  }
}

export function selectedArrivalWindow(value, windowId) {
  const windows = parseArrivalWindows(value);
  return windows.find((window) => window.id === windowId) || null;
}
