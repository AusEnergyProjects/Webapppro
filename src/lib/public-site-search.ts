export type PublicSiteSearchEntry = {
  path: string;
  title: string;
  description: string;
  keywords: readonly string[];
};

export type PublicSiteSearchResult = PublicSiteSearchEntry & {
  score: number;
};

export const PUBLIC_SITE_SEARCH_ENTRIES: readonly PublicSiteSearchEntry[] = [
  {
    path: "/",
    title: "Home",
    description: "Return to the Australian Energy Assessments home page.",
    keywords: ["home page", "start", "main page"],
  },
  {
    path: "/plan",
    title: "Build my home energy plan",
    description: "Answer simple questions and get a practical order for your next steps.",
    keywords: ["home energy plan", "where do i start", "lower bills", "make my home comfortable", "upgrade plan"],
  },
  {
    path: "/assessments",
    title: "Home energy assessments and ratings",
    description: "Understand which assessment, rating or report suits your home.",
    keywords: ["energy assessor", "energy assessment", "house assessment", "rating", "assessor near me"],
  },
  {
    path: "/book-an-assessment",
    title: "Book a five-minute call",
    description: "Choose a quick call time so we can confirm the right service and logistics.",
    keywords: ["book now", "appointment", "calendar", "calendly", "talk to someone", "phone call"],
  },
  {
    path: "/nathers-for-new-homes",
    title: "NatHERS for new homes",
    description: "Desktop energy ratings for new homes, renovations and building approval.",
    keywords: ["nathers", "new home", "new house", "energy rating", "building plans", "thermal performance"],
  },
  {
    path: "/home-energy-rating-for-existing-homes",
    title: "Home Energy Rating for existing homes",
    description: "Learn about the national rating pathway for an existing home.",
    keywords: ["existing home nathers", "existing house rating", "home energy rating", "new existing homes brand"],
  },
  {
    path: "/nathers-whole-of-home",
    title: "NatHERS Whole of Home",
    description: "See how thermal performance and major household appliances are assessed together.",
    keywords: ["whole of home", "whole home rating", "nathers appliances", "energy use rating"],
  },
  {
    path: "/home-energy-rating-vs-nathers-vs-scorecard",
    title: "Compare home ratings and assessments",
    description: "A plain-English comparison of Home Energy Ratings, NatHERS and Scorecard assessments.",
    keywords: ["which assessment", "rating comparison", "nathers vs scorecard", "home energy rating difference"],
  },
  {
    path: "/residential-efficiency-scorecard",
    title: "Residential Efficiency Scorecard",
    description: "Understand Victoria's existing-home assessment and star-rating service.",
    keywords: ["scorecard", "victorian scorecard", "home efficiency scorecard", "existing home assessment victoria"],
  },
  {
    path: "/basix-nsw",
    title: "BASIX assessment support",
    description: "Understand BASIX requirements and assessment support for NSW projects.",
    keywords: ["basix", "nsw building", "basix certificate", "sustainability assessment"],
  },
  {
    path: "/minimum-rental-standards",
    title: "Minimum rental standards",
    description: "Plain-language guidance for rental energy and safety requirements.",
    keywords: ["rental standards", "landlord", "tenant", "rental compliance", "minimum standards"],
  },
  {
    path: "/rental-assessment/request",
    title: "Request a rental assessment",
    description: "Start a request for an on-site rental property assessment.",
    keywords: ["book rental assessment", "rental inspection", "landlord assessment", "rental report"],
  },
  {
    path: "/commercial-and-industrial-assessments",
    title: "Commercial and industrial assessments",
    description: "Energy assessment support for commercial and industrial buildings.",
    keywords: ["business energy audit", "commercial assessment", "industrial energy", "commercial building"],
  },
  {
    path: "/calculator",
    title: "Rebate calculator",
    description: "Check which rebates and certificate incentives may apply to a project.",
    keywords: ["rebate estimate", "rebate calculater", "incentive calculator", "certificate estimate", "how much rebate"],
  },
  {
    path: "/rebates",
    title: "Rebates and assistance",
    description: "Find official federal, state and territory energy support.",
    keywords: ["rebates", "government rebate", "energy assistance", "discount", "grant", "incentive"],
  },
  {
    path: "/compare",
    title: "Compare electricity plans",
    description: "Compare electricity offers using your usage and available plan data.",
    keywords: ["electricity", "power plan", "energy retailer", "electricity bill", "nem12", "cheaper electricity"],
  },
  {
    path: "/gas-compare",
    title: "Compare gas plans",
    description: "Compare mains gas offers using your household details and usage.",
    keywords: ["gas", "gas plan", "gas retailer", "gas bill", "cheaper gas", "mains gas"],
  },
  {
    path: "/guides",
    title: "Home energy guides",
    description: "Browse practical explanations about assessments, upgrades and rebates.",
    keywords: ["guides", "learn", "advice", "home energy information", "education"],
  },
  {
    path: "/guides/prepare-for-home-energy-assessment",
    title: "Prepare for a home energy assessment",
    description: "What to have ready and what to expect before an assessor visits.",
    keywords: ["prepare assessment", "assessment checklist", "before assessor arrives", "what to expect"],
  },
  {
    path: "/guides/home-energy-upgrades",
    title: "Home energy upgrades",
    description: "Understand the main ways to improve comfort and reduce energy use.",
    keywords: ["upgrade home", "energy efficiency", "make house warmer", "make house cooler", "reduce bills"],
  },
  {
    path: "/guides/free-home-energy-assessments",
    title: "Free home energy assessments explained",
    description: "Check what a free assessment offer may include and what to confirm first.",
    keywords: ["free assessment", "government assessment", "no cost assessment", "free energy advice"],
  },
  {
    path: "/guides/home-energy-assessment-myths",
    title: "Home energy assessment myths",
    description: "Clear up common misunderstandings about ratings, reports and promised savings.",
    keywords: ["assessment myths", "energy rating myth", "is assessment worth it", "assessment facts"],
  },
  {
    path: "/guides/insulation-draught-proofing",
    title: "Insulation and draught proofing",
    description: "Learn how insulation, sealing and ventilation affect comfort and efficiency.",
    keywords: ["insulation", "draft proofing", "draughts", "cold house", "roof insulation", "wall insulation"],
  },
  {
    path: "/guides/heating",
    title: "Heating guide",
    description: "Compare common home heating options and the questions to ask first.",
    keywords: ["heater", "heating", "warm home", "reverse cycle", "space heating"],
  },
  {
    path: "/guides/heat-pumps",
    title: "Heat pump guide",
    description: "Understand heat pumps for space heating, cooling and hot water.",
    keywords: ["heat pump", "reverse cycle air conditioner", "efficient heating", "heatpump"],
  },
  {
    path: "/guides/hot-water",
    title: "Hot water guide",
    description: "Compare electric, heat pump, gas and solar hot-water systems.",
    keywords: ["hot water", "water heater", "heat pump hot water", "electric hot water", "solar hot water"],
  },
  {
    path: "/guides/cooking",
    title: "Efficient cooking guide",
    description: "Understand induction, electric and gas cooking choices.",
    keywords: ["induction", "cooktop", "cooking", "gas stove", "electric cooking"],
  },
  {
    path: "/guides/solar",
    title: "Home solar guide",
    description: "Learn how to assess solar size, value, quotes and roof suitability.",
    keywords: ["solar", "solar panels", "pv", "solar quote", "rooftop solar"],
  },
  {
    path: "/guides/batteries",
    title: "Home battery guide",
    description: "Understand battery sizing, backup, tariffs and realistic value.",
    keywords: ["battery", "home battery", "solar battery", "storage", "backup power"],
  },
  {
    path: "/guides/ev-charging",
    title: "Electric vehicle charging guide",
    description: "Plan safe and practical electric-vehicle charging at home.",
    keywords: ["ev", "electric car", "vehicle charger", "home charging", "ev charger"],
  },
  {
    path: "/guides/certificate-prices",
    title: "Energy certificate prices",
    description: "See indicative certificate market prices and understand what they mean.",
    keywords: ["certificates", "stc", "veu", "esc", "certificate price", "energy savings certificate"],
  },
  {
    path: "/guides/ncc-nathers-basix",
    title: "NCC, NatHERS and BASIX explained",
    description: "A simple guide to the building rules, ratings and NSW requirements.",
    keywords: ["ncc", "building code", "nathers basix", "section j", "energy provisions"],
  },
  {
    path: "/guides/green-building-certifications-australia",
    title: "Green building certifications in Australia",
    description: "Compare common home and building sustainability ratings and certifications.",
    keywords: ["green building", "sustainability certification", "green star", "building rating"],
  },
  {
    path: "/guides/project-preparation",
    title: "Prepare an energy upgrade project",
    description: "Organise priorities, evidence and quotes before committing to work.",
    keywords: ["project preparation", "prepare upgrade", "compare quotes", "before hiring a trade"],
  },
  {
    path: "/wattzun",
    title: "Ask Wattzun AI",
    description: "Get guided help finding the right information or next step.",
    keywords: ["wattzun", "watzun", "watson ai", "surge", "ai help", "energy assistant", "ask a question", "chat"],
  },
  {
    path: "/faq",
    title: "Frequently asked questions",
    description: "Clear answers about assessments, ratings, bookings and reports.",
    keywords: ["faq", "questions", "answers", "help", "how does it work"],
  },
  {
    path: "/trusted-suppliers",
    title: "Official and industry resources",
    description: "Open trusted government and industry information sources.",
    keywords: ["official sources", "trusted resources", "government websites", "industry bodies"],
  },
  {
    path: "/direct-trade",
    title: "TLink for households and trades",
    description: "Learn how households can find trades and how trades can use the free workspace.",
    keywords: ["tlink", "trade", "tradesperson", "installer", "find a trade", "trade software"],
  },
  {
    path: "/direct-trade/partners",
    title: "TLink for industry partners",
    description: "Information for suppliers and industry partners joining TLink.",
    keywords: ["supplier", "partner", "manufacturer", "wholesaler", "tlink partner"],
  },
  {
    path: "/direct-trade/integrations",
    title: "TLink integrations",
    description: "See how TLink connects with common trade and business workflows.",
    keywords: ["tlink integrations", "accounting integration", "calendar integration", "trade software connection"],
  },
  {
    path: "/direct-trade/access",
    title: "TLink access and verification",
    description: "Understand business verification and access to the TLink workspace.",
    keywords: ["tlink access", "trade verification", "join tlink", "trade account", "trade login", "tlink login"],
  },
  {
    path: "/direct-trade/standards",
    title: "TLink standards",
    description: "Read the service, evidence and conduct standards expected in TLink.",
    keywords: ["tlink standards", "trade rules", "service standard", "evidence standard"],
  },
  {
    path: "/platform",
    title: "Australian Energy Assessments platform",
    description: "See how planning, assessments, Wattzun AI and TLink work together.",
    keywords: ["platform", "how the site works", "customer tools", "services overview"],
  },
  {
    path: "/case-studies",
    title: "Case studies",
    description: "See practical examples of Australian home-energy decisions.",
    keywords: ["examples", "case study", "projects", "real homes"],
  },
  {
    path: "/communities-schools",
    title: "Community and school education",
    description: "Energy education and information sessions for communities and schools.",
    keywords: ["school", "community", "workshop", "education", "presentation"],
  },
  {
    path: "/team",
    title: "Meet our team",
    description: "Learn about the people behind Australian Energy Assessments.",
    keywords: ["team", "about us", "who we are", "australian energy assessments"],
  },
  {
    path: "/privacy",
    title: "Privacy and analytics",
    description: "See what the site collects and control analytics on this browser.",
    keywords: ["privacy", "cookies", "analytics", "data", "tracking", "opt out"],
  },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "for", "from", "get", "how", "i", "in", "is", "my", "of", "on", "the", "to", "what", "where", "with", "you", "your",
]);

export function normalizeSiteSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function searchTokens(value: string): string[] {
  const tokens = normalizeSiteSearchText(value).split(" ").filter(Boolean);
  const meaningful = tokens.filter((token) => !STOP_WORDS.has(token));
  return meaningful.length > 0 ? meaningful : tokens;
}

function damerauLevenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      );

      if (
        row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }

  return matrix[left.length][right.length];
}

function tokenMatchScore(queryToken: string, candidateToken: string): number {
  if (queryToken === candidateToken) return 120;
  if (candidateToken.startsWith(queryToken)) return 96 - Math.min(16, candidateToken.length - queryToken.length);
  if (queryToken.length >= 3 && candidateToken.includes(queryToken)) return 78;
  if (candidateToken.length >= 3 && queryToken.includes(candidateToken)) return 70;

  const distance = damerauLevenshtein(queryToken, candidateToken);
  const longest = Math.max(queryToken.length, candidateToken.length);
  const allowance = longest <= 4 ? 1 : longest <= 8 ? 2 : 3;
  if (distance <= allowance && distance / longest <= 0.34) return 64 - distance * 8;
  return 0;
}

function scoreEntry(entry: PublicSiteSearchEntry, query: string): number {
  const normalizedQuery = normalizeSiteSearchText(query);
  if (!normalizedQuery) return 0;

  const normalizedTitle = normalizeSiteSearchText(entry.title);
  const normalizedKeywords = entry.keywords.map(normalizeSiteSearchText);
  const queryCompact = normalizedQuery.replaceAll(" ", "");
  const phrases = [normalizedTitle, ...normalizedKeywords];
  const phraseCompacts = phrases.map((phrase) => phrase.replaceAll(" ", ""));

  let phraseBonus = 0;
  if (phrases.includes(normalizedQuery) || phraseCompacts.includes(queryCompact)) phraseBonus = 900;
  else if (phrases.some((phrase) => phrase.startsWith(normalizedQuery))) phraseBonus = 620;
  else if (normalizedQuery.length >= 3 && phrases.some((phrase) => phrase.includes(normalizedQuery))) phraseBonus = 430;
  else if (queryCompact.length >= 4 && phraseCompacts.some((phrase) => phrase.includes(queryCompact))) phraseBonus = 390;

  const queryParts = searchTokens(normalizedQuery);
  const titleTokens = searchTokens(normalizedTitle);
  const keywordTokens = normalizedKeywords.flatMap(searchTokens);
  const descriptionTokens = searchTokens(entry.description);
  const candidateTokens = [...titleTokens, ...keywordTokens, ...descriptionTokens];
  const tokenScores = queryParts.map((queryToken) => Math.max(
    0,
    ...candidateTokens.map((candidateToken) => tokenMatchScore(queryToken, candidateToken)),
  ));
  const matchedTokens = tokenScores.filter((score) => score > 0).length;
  if (matchedTokens === 0) return phraseBonus;

  const coverage = matchedTokens / queryParts.length;
  if (coverage < 0.6) return phraseBonus;

  const titleBonus = queryParts.reduce((total, queryToken) => (
    total + Math.max(0, ...titleTokens.map((candidateToken) => tokenMatchScore(queryToken, candidateToken)))
  ), 0);
  return phraseBonus + tokenScores.reduce((total, score) => total + score, 0) * coverage + titleBonus * 0.35;
}

export function searchPublicSite(query: string, limit = 6): PublicSiteSearchResult[] {
  const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit) || 6));
  if (!normalizeSiteSearchText(query)) return [];

  return PUBLIC_SITE_SEARCH_ENTRIES
    .map((entry, index) => ({ ...entry, score: scoreEntry(entry, query), index }))
    .filter((entry) => entry.score >= 45)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, safeLimit)
    .map(({ path, title, description, keywords, score }) => ({ path, title, description, keywords, score }));
}
