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

function rankedPassages(query: string) {
  const queryTokens = [...new Set(tokens(query))].slice(-48);
  if (!queryTokens.length) return [];
  const normalizedQuery = normalize(query);
  const phrases = normalizedQuery
    .split(" ")
    .slice(-60)
    .flatMap((word, index, words) => index < words.length - 1 ? [`${word} ${words[index + 1]}`] : [])
    .filter((phrase) => phrase.split(" ").every((word) => word.length >= 3 && !STOP_WORDS.has(word)))
    .slice(-16);

  return searchableChunks
    .map((candidate) => {
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
      if (matchedTerms < 2) score = 0;
      return { ...candidate, score, matchedTerms };
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
  const searchGroups = facets.length > 1
    ? facets.map((facet) => rankedPassages(`${facet}\n${subjectContext}\n${conversationContext}`))
    : [rankedPassages(`${query}\n${conversationContext}`)];
  const selected: SurgeIndustryPassage[] = [];
  const selectedIds = new Set<string>();
  const perSource = new Map<string, number>();
  const add = (candidate: (typeof searchableChunks)[number]) => {
    if (selected.length >= safeLimit || selectedIds.has(candidate.chunk.id)) return;
    const sourceCount = perSource.get(candidate.chunk.sourceId) || 0;
    if (sourceCount >= 2) return;
    selected.push(Object.freeze({
      sourceTitle: candidate.chunk.sourceTitle,
      page: candidate.chunk.page,
      excerpt: candidate.chunk.text.slice(0, 500),
      authorityBoundary: "stable_industry_guidance_only_verify_current_facts_officially",
    }));
    selectedIds.add(candidate.chunk.id);
    perSource.set(candidate.chunk.sourceId, sourceCount + 1);
  };

  const perFacet = facets.length > 1 ? 2 : Math.min(3, safeLimit);
  for (let resultIndex = 0; resultIndex < perFacet; resultIndex += 1) {
    for (const ranked of searchGroups) {
      const candidate = ranked[resultIndex];
      if (candidate) add(candidate);
    }
  }
  if (selected.length < safeLimit) {
    for (const candidate of rankedPassages(`${query}\n${conversationContext}`)) {
      add(candidate);
      if (selected.length >= safeLimit) break;
    }
  }
  return Object.freeze(selected);
}
