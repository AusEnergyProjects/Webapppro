const RETAILER_SITES_BY_SLUG = {
  "ergon": "https://www.ergon.com.au/",
  "people-energy": "https://www.peopleenergy.com.au/",
  "covau": "https://covau.com.au/",
  "next-business": "https://www.indigopower.com.au/",
  "blue-nrg": "https://www.bluenrg.com.au/",
  "tango": "https://www.tangoenergy.com/",
  "commander": "https://www.commander.com.au/",
  "agl": "https://www.agl.com.au/",
  "erm-power": "https://www.ermpower.com.au/",
  "alinta": "https://www.alintaenergy.com.au/",
  "powershop": "https://www.powershop.com.au/",
  "qenergy": "https://www.qenergy.com.au/",
  "actewagl": "https://www.actewagl.com.au/",
  "aurora": "https://www.auroraenergy.com.au/",
  "momentum": "https://www.momentumenergy.com.au/",
  "diamond": "https://diamondenergy.com.au/",
  "red-energy": "https://www.redenergy.com.au/",
  "simply-energy": "https://www.engie.com.au/",
  "energyaustralia": "https://www.energyaustralia.com.au/",
  "dodo": "https://www.dodo.com/",
  "origin": "https://www.originenergy.com.au/electricity-gas/plans.html",
  "lumo": "https://www.lumoenergy.com.au/",
  "humenergy": "https://www.humenergy.com.au/",
  "cleanco": "https://cleancoqld.com.au/",
  "yes-energy": "https://yesenergy.net.au/",
  "ampol": "https://www.ampolenergy.com.au/",
  "powow": "https://www.powowpower.com.au/",
  "ovo-energy": "https://www.ovoenergy.com.au/",
  "flow-power": "https://flowpower.com.au/",
  "pacific-blue": "https://www.pacificblue.com.au/",
  "io-energy": "https://www.ioenergy.com.au/",
  "engie": "https://www.engie.com.au/",
  "flipped": "https://flipped.energy/",
  "arcline": "https://energy.arcline.com.au/",
  "smartestenergy": "https://www.smartestenergy.com/",
  "sumo-gas": "https://www.sumo.com.au/",
  "future-x": "https://futurexpower.com.au/",
  "tesla": "https://www.tesla.com/en_au/energy",
  "energy-locals": "https://energylocals.com.au/",
  "macarthur": "https://macarthurenergy.com.au/",
  "savant": "https://savantenergy.com.au/",
  "silver-asset": "https://www.ezipower.com.au/",
  "erc-energy": "https://ercenergy.com.au/",
  "energy-locals-urban": "https://energylocals.com.au/",
  "aseno": "https://aseno.com.au/",
  "1st-energy": "https://1stenergy.com.au/",
  "mojo": "https://mojopower.com.au/",
  "enova": "https://www.enovaenergy.com.au/",
  "winconnect": "https://www.winconnect.com.au/",
  "amaysim": "https://www.amaysim.com.au/",
  "oc-energy": "https://www.ocenergy.com.au/",
  "macquarie": "https://www.macquarie.com/",
  "sumo-power": "https://www.sumo.com.au/",
  "reamped": "https://reampedenergy.com.au/",
  "evergy": "https://evergy.com.au/",
  "discover": "https://www.discoverenergy.com.au/",
  "cleanpeak": "https://cleanpeakenergy.com.au/",
  "real-utilities": "https://www.realutilities.com.au/",
  "dc-power": "https://www.dcpowerco.com.au/",
  "locality-planning": "https://localityenergy.com.au/",
  "seene": "https://seene.com.au/",
  "stanwell": "https://www.stanwell.com/energy-solutions/",
  "cpe-mascot": "https://cleanpeakenergy.com.au/",
  "globird": "https://www.globirdenergy.com.au/",
  "solstice": "https://solsticeenergy.com.au/",
  "kogan": "https://www.koganenergy.com.au/",
  "amber": "https://www.amber.com.au/",
  "nectr": "https://on.nectr.com.au/",
  "active-utilities": "https://activeutilities.com.au/",
};

const RETAILER_SITES_BY_NAME = {
  "agl": RETAILER_SITES_BY_SLUG.agl,
  "alinta energy": RETAILER_SITES_BY_SLUG.alinta,
  "arcline by racv": RETAILER_SITES_BY_SLUG.arcline,
  "arcline by racv - energy": RETAILER_SITES_BY_SLUG.arcline,
  "covau": RETAILER_SITES_BY_SLUG.covau,
  "dodo power & gas": RETAILER_SITES_BY_SLUG.dodo,
  "energy locals": RETAILER_SITES_BY_SLUG["energy-locals"],
  "energyaustralia": RETAILER_SITES_BY_SLUG.energyaustralia,
  "engie": RETAILER_SITES_BY_SLUG.engie,
  "globird energy": RETAILER_SITES_BY_SLUG.globird,
  "kogan energy": RETAILER_SITES_BY_SLUG.kogan,
  "lumo energy": RETAILER_SITES_BY_SLUG.lumo,
  "momentum energy": RETAILER_SITES_BY_SLUG.momentum,
  "origin energy": RETAILER_SITES_BY_SLUG.origin,
  "ovo energy": RETAILER_SITES_BY_SLUG["ovo-energy"],
  "powershop": RETAILER_SITES_BY_SLUG.powershop,
  "red energy": RETAILER_SITES_BY_SLUG["red-energy"],
  "tango energy": RETAILER_SITES_BY_SLUG.tango,
  "1st energy": RETAILER_SITES_BY_SLUG["1st-energy"],
};

function retailerSlug(base) {
  try {
    const url = new URL(String(base || ""));
    if (url.hostname.toLowerCase() !== "cdr.energymadeeasy.gov.au") return null;
    return url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function safeCustomerUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (hostname === "cdr.energymadeeasy.gov.au" || hostname === "localhost" || hostname.endsWith(".localhost")) return null;
    if (url.pathname.toLowerCase().includes("/cds-au/")) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function retailerWebsite(base, name) {
  const slug = retailerSlug(base);
  if (slug && RETAILER_SITES_BY_SLUG[slug]) return RETAILER_SITES_BY_SLUG[slug];
  const normalizedName = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  return RETAILER_SITES_BY_NAME[normalizedName] || null;
}

export function resolveCustomerPlanUrl(candidates, fallback) {
  for (const candidate of candidates || []) {
    const safe = safeCustomerUrl(candidate);
    if (safe) return safe;
  }
  return safeCustomerUrl(fallback);
}
