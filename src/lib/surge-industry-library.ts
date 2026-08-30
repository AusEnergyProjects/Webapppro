import library from "../data/surge-industry-library.generated.json" with { type: "json" };

type GeneratedIndustryChunk = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  page: number;
  text: string;
};

type GeneratedIndustryLibrary = {
  schemaVersion: number;
  classification: "editorial_primary";
  currentFactBoundary: "verify_with_current_official_sources";
  sourceCount: number;
  pageCount: number;
  chunkCount: number;
  sources: Array<{
    id: string;
    title: string;
    pageCount: number;
    pdfSha256: string;
    chunkCount: number;
  }>;
  chunks: GeneratedIndustryChunk[];
};

export type SurgeIndustryPassage = {
  sourceTitle: string;
  page: number;
  excerpt: string;
  authorityBoundary: "stable_industry_guidance_only_verify_current_facts_officially";
};

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "answer", "are", "because", "been",
  "before", "being", "between", "but", "can", "could", "does", "energy", "for",
  "from", "give", "have", "home", "house", "how", "into", "just", "like", "more",
  "most", "need", "only", "other", "our", "should", "some", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "through",
  "use", "using", "very", "want", "what", "when", "where", "which", "with", "would",
  "you", "your",
]);

const QUESTION_CLAUSE_BOUNDARY =
  /[,;]\s+(?=(?:(?:and|also)\s+)?(?:is|are|am|do|does|did|can|could|should|would|will|what|when|where|which|who|why|how)\b)|\s+(?:and|also|plus)\s+(?=(?:is|are|am|do|does|did|can|could|should|would|will|what|when|where|which|who|why|how)\b)/gi;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/draughty|drafty/g, " draught ")
    .replace(/drafts?/g, " draught ")
    .replace(/air[ -]?leak(?:age|s)?/g, " draught airleak ")
    .replace(/three[ -]?phase/g, " threephase 3phase ")
    .replace(/reverse[ -]?cycle/g, " reversecycle ")
    .replace(/heat[ -]?pump/g, " heatpump ")
    .replace(/hot[ -]?water/g, " hotwater ")
    .replace(/air[ -]?condition(?:er|ing)/g, " airconditioner aircon ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(value: string) {
  if (value.length > 7 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 6 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 5 && value.endsWith("es")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function tokens(value: string) {
  return normalize(value)
    .split(" ")
    .map(stem)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

const generated = library as GeneratedIndustryLibrary;
const searchableChunks = generated.chunks.map((chunk) => ({
  chunk,
  normalizedText: ` ${normalize(chunk.text)} `,
  tokenSet: new Set(tokens(chunk.text)),
  titleTokens: new Set(tokens(chunk.sourceTitle)),
}));

export const SURGE_INDUSTRY_LIBRARY_SUMMARY = Object.freeze({
  schemaVersion: generated.schemaVersion,
  sourceCount: generated.sourceCount,
  pageCount: generated.pageCount,
  chunkCount: generated.chunkCount,
  currentFactBoundary: generated.currentFactBoundary,
});

export const SURGE_INDUSTRY_LIBRARY_SOURCE_HASHES = Object.freeze(
  Object.fromEntries(generated.sources.map((source) => [source.id, source.pdfSha256])),
);

export function splitSurgeQuestionFacets(query: string) {
  const cleaned = query.replace(/\s+/g, " ").trim();
  if (!cleaned) return Object.freeze([]);
  const facets = cleaned
    .split(/[?!\n]+/)
    .flatMap((part) => part.split(QUESTION_CLAUSE_BOUNDARY))
    .map((part) =>
      part
        .replace(/^(?:and|also|plus)\s+/i, "")
        .replace(/[,;]\s*$/, "")
        .trim(),
    )
    .filter((part) => part.length >= 8);
  return Object.freeze([...new Set(facets)].slice(0, 6));
}

type FocusConcept = {
  id: string;
  questionPattern: RegExp;
  passagePattern: RegExp;
};

const FOCUS_CONCEPTS: readonly FocusConcept[] = [
  {
    id: "draught",
    questionPattern: /\b(?:draught|draft|air[- ]?leak)/i,
    passagePattern: /\b(?:draught|draft|air[- ]?leak|weatherstrip|door snake|seal(?:ing|ed)?\s+(?:a\s+)?gap|gap[- ]?seal)/i,
  },
  {
    id: "condensation",
    questionPattern: /\b(?:condensation|mould|mold|humidity)\b/i,
    passagePattern: /\b(?:condensation|mould|mold|humidity|moisture)\b/i,
  },
  {
    id: "insulation",
    questionPattern: /\binsulat(?:ion|ed|ing)\b/i,
    passagePattern: /\binsulat(?:ion|ed|ing)|\bbatts?\b|\bR[- ]?value\b/i,
  },
  {
    id: "glazing",
    questionPattern: /\b(?:windows?|glazing|glass|double[- ]?glazed?)\b/i,
    passagePattern: /\b(?:windows?|glazing|glass|double[- ]?glazed?)\b/i,
  },
  {
    id: "rcac_heating",
    questionPattern: /\b(?:RCAC|reverse[- ]?cycle|air[- ]?con(?:ditioner|ditioning)?|split[- ]?systems?|multi[- ]?(?:head|split)(?:[- ]?systems?)?|ducted (?:gas )?(?:heating|heater)|gas (?:ducted )?(?:heating|heater))\b/i,
    passagePattern: /\b(?:RCAC|reverse[- ]?cycle|air[- ]?con(?:ditioner|ditioning)?|split[- ]?systems?|multi[- ]?(?:head|split)(?:[- ]?systems?)?|ducted (?:gas )?(?:heating|heater)|gas (?:ducted )?(?:heating|heater))\b/i,
  },
  {
    id: "financial_rebate",
    questionPattern: /\b(?:rebate|STCs?|VEECs?|ESCs?|PRCs?|VEU|Victorian Energy Upgrades?|Energy Savings Scheme|certificate discount)\b/i,
    passagePattern: /\b(?:small[- ]scale technology certificates?|STCs?\b[^.!?\n]{0,35}\b(?:solar|rebate|certificate)|VEECs?|ESCs?|PRCs?|VEU|Victorian Energy Upgrades?|Energy Savings Scheme|certificate discounts?|financial (?:assistance|incentive)|government (?:assistance|rebate|scheme|program)|(?:state|territory|federal|government)[- ](?:based )?rebates?|(?:upfront|energy[- ]?upgrade) discounts?|rebates?\b[^.!?\n]{0,35}\b(?:available|eligible|eligibility|amount|claim|scheme|program|upgrade|installation)|(?:available|eligible|claim|government)\b[^.!?\n]{0,35}\brebates?)\b/i,
  },
  {
    id: "tariff",
    questionPattern: /\b(?:tariff|feed[- ]?in|retailer|electricity plan)\b/i,
    passagePattern: /\b(?:tariff|feed[- ]?in|retailer|electricity plan|import rate|export rate)\b/i,
  },
];

function focusConceptsFor(query: string) {
  return FOCUS_CONCEPTS.filter((concept) => concept.questionPattern.test(query));
}

function subjectDecisionAlignmentFor(concepts: readonly FocusConcept[]) {
  const rcac = concepts.find((concept) => concept.id === "rcac_heating");
  const rebate = concepts.find((concept) => concept.id === "financial_rebate");
  return rcac && rebate ? [rcac, rebate] : [];
}

function excerptAroundEvidence(
  text: string,
  concepts: readonly FocusConcept[],
  queryTokens: readonly string[],
) {
  const focusAnchors = concepts.flatMap((concept) => {
    const match = concept.passagePattern.exec(text);
    return match?.index === undefined ? [] : [match.index];
  });
  const tokenAnchors = queryTokens.flatMap((term) => {
    const index = text.toLowerCase().indexOf(term.toLowerCase());
    return index < 0 ? [] : [index];
  });
  const anchor = focusAnchors[0] ?? tokenAnchors[0] ?? 0;
  let start = Math.max(0, anchor - 120);
  if (start > 0) {
    const nearbyBoundary = Math.max(
      text.lastIndexOf(". ", start),
      text.lastIndexOf("\n", start),
    );
    if (nearbyBoundary >= Math.max(0, start - 100)) start = nearbyBoundary + 1;
  }
  return text.slice(start, start + 500).trim();
}

function rankedPassages(
  query: string,
  requiredConcepts: readonly FocusConcept[] = focusConceptsFor(query),
  subjectQuery = query,
) {
  const queryTokens = [...new Set(tokens(query))].slice(-48);
  if (!queryTokens.length) return [];
  const normalizedQuery = normalize(query);
  const phrases = normalizedQuery
    .split(" ")
    .slice(-60)
    .flatMap((word, index, words) => index < words.length - 1 ? [`${word} ${words[index + 1]}`] : [])
    .filter((phrase) => phrase.split(" ").every((word) => word.length >= 3 && !STOP_WORDS.has(word)))
    .slice(-16);
  const subjectConcepts = focusConceptsFor(subjectQuery);
  const alignedDecisionConcepts = subjectDecisionAlignmentFor(subjectConcepts);
  const fabricQuestion = subjectConcepts.some((concept) => (
    concept.id === "draught"
    || concept.id === "condensation"
    || concept.id === "insulation"
    || concept.id === "glazing"
  ));
  const asksAboutHotWater = /\b(?:hot[- ]?water|water heater|HPWH|heat[- ]?pump hot[- ]?water)\b/i.test(subjectQuery);

  return searchableChunks
    .map((candidate) => {
      const matchedConcepts = requiredConcepts.filter((concept) => concept.passagePattern.test(candidate.chunk.text));
      if (requiredConcepts.length && !matchedConcepts.length) {
        return { ...candidate, score: 0, matchedTerms: 0, excerpt: "" };
      }
      if (alignedDecisionConcepts.some((concept) => !concept.passagePattern.test(candidate.chunk.text))) {
        return { ...candidate, score: 0, matchedTerms: 0, excerpt: "" };
      }
      const hotWaterOnlyPassage = /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water tank|water tank|anode|refrigerant|compressor unit|\d{3}[- ]litre tank)\b/i.test(candidate.chunk.text);
      const financialDecision = requiredConcepts.some((concept) => concept.id === "financial_rebate");
      if (!asksAboutHotWater && hotWaterOnlyPassage && (fabricQuestion || financialDecision)) {
        return { ...candidate, score: 0, matchedTerms: 0, excerpt: "" };
      }
      let score = 0;
      let matchedTerms = 0;
      for (const term of queryTokens) {
        if (!candidate.tokenSet.has(term)) continue;
        matchedTerms += 1;
        score += term.length >= 8 ? 4 : term.length >= 5 ? 3 : 2;
        if (candidate.titleTokens.has(term)) score += 4;
      }
      for (const phrase of phrases) {
        if (candidate.normalizedText.includes(` ${phrase} `)) score += 7;
      }
      score += matchedConcepts.length * 12;
      score += subjectConcepts.filter((concept) => (
        !matchedConcepts.some((matched) => matched.id === concept.id)
        && concept.passagePattern.test(candidate.chunk.text)
      )).length * 8;
      if (matchedTerms < (matchedConcepts.length ? 1 : 2)) score = 0;
      const excerptConcepts = [...new Map(
        [...matchedConcepts, ...alignedDecisionConcepts].map((concept) => [concept.id, concept]),
      ).values()];
      const excerpt = excerptAroundEvidence(candidate.chunk.text, excerptConcepts, queryTokens);
      if (alignedDecisionConcepts.some((concept) => !concept.passagePattern.test(excerpt))) {
        return { ...candidate, score: 0, matchedTerms: 0, excerpt: "" };
      }
      return {
        ...candidate,
        score,
        matchedTerms,
        excerpt,
      };
    })
    .filter((candidate) => candidate.score >= 8)
    .sort((left, right) => right.score - left.score
      || right.matchedTerms - left.matchedTerms
      || left.chunk.id.localeCompare(right.chunk.id));
}

export function selectSurgeIndustryPassagesForPrompt(
  query: string,
  limit = 5,
  conversationContext = "",
): readonly SurgeIndustryPassage[] {
  const safeLimit = Math.max(0, Math.min(6, Math.trunc(limit)));
  if (!safeLimit) return Object.freeze([]);
  const facets = splitSurgeQuestionFacets(query);
  if (!facets.length) return Object.freeze([]);
  const subjectContext = facets[0] || query;
  const searchGroups = facets.flatMap((facet) => {
    const concepts = focusConceptsFor(facet);
    const searchText = `${facet}\n${subjectContext}\n${conversationContext}`;
    const decisionSubject = `${subjectContext}\n${facet}`;
    return concepts.length
      ? concepts.map((concept) => rankedPassages(searchText, [concept], decisionSubject))
      : [rankedPassages(searchText, [], decisionSubject)];
  });
  const selected: SurgeIndustryPassage[] = [];
  const selectedIds = new Set<string>();
  const perSource = new Map<string, number>();
  const add = (candidate: ReturnType<typeof rankedPassages>[number]) => {
    if (selected.length >= safeLimit || selectedIds.has(candidate.chunk.id)) return;
    const sourceCount = perSource.get(candidate.chunk.sourceId) || 0;
    if (sourceCount >= 2) return;
    selected.push(Object.freeze({
      sourceTitle: candidate.chunk.sourceTitle,
      page: candidate.chunk.page,
      excerpt: candidate.excerpt,
      authorityBoundary: "stable_industry_guidance_only_verify_current_facts_officially",
    }));
    selectedIds.add(candidate.chunk.id);
    perSource.set(candidate.chunk.sourceId, sourceCount + 1);
  };

  // Reserve one useful passage for each material concept before filling the
  // remaining slots by rank. This prevents a compound question from being
  // monopolised by one easy-to-match subject.
  const queryConcepts = [...new Map(
    facets.flatMap((facet) => focusConceptsFor(facet)).map((concept) => [concept.id, concept]),
  ).values()];
  for (const concept of queryConcepts) {
    if (selected.some((passage) => concept.passagePattern.test(passage.excerpt))) continue;
    for (const candidate of rankedPassages(
      `${query}\n${conversationContext}`,
      [concept],
      query,
    )) {
      const before = selected.length;
      add(candidate);
      if (selected.length > before) break;
    }
  }

  const perFacet = searchGroups.length > 1 ? 2 : Math.min(3, safeLimit);
  for (let resultIndex = 0; resultIndex < perFacet; resultIndex += 1) {
    for (const ranked of searchGroups) {
      const candidate = ranked[resultIndex];
      if (candidate) add(candidate);
    }
  }
  if (selected.length < safeLimit) {
    for (const candidate of rankedPassages(
      `${query}\n${conversationContext}`,
      focusConceptsFor(query),
      query,
    )) {
      add(candidate);
      if (selected.length >= safeLimit) break;
    }
  }
  return Object.freeze(selected);
}
