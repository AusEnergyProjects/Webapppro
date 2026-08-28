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

export function selectSurgeIndustryPassagesForPrompt(
  query: string,
  limit = 5,
): readonly SurgeIndustryPassage[] {
  const safeLimit = Math.max(0, Math.min(6, Math.trunc(limit)));
  if (!safeLimit) return Object.freeze([]);
  const queryTokens = [...new Set(tokens(query))].slice(-48);
  if (!queryTokens.length) return Object.freeze([]);
  const normalizedQuery = normalize(query);
  const phrases = normalizedQuery
    .split(" ")
    .slice(-60)
    .flatMap((word, index, words) => index < words.length - 1 ? [`${word} ${words[index + 1]}`] : [])
    .filter((phrase) => phrase.split(" ").every((word) => word.length >= 3 && !STOP_WORDS.has(word)))
    .slice(-16);

  const ranked = searchableChunks
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

  const selected: SurgeIndustryPassage[] = [];
  const perSource = new Map<string, number>();
  for (const candidate of ranked) {
    if (selected.length >= safeLimit) break;
    const sourceCount = perSource.get(candidate.chunk.sourceId) || 0;
    if (sourceCount >= 2) continue;
    selected.push(Object.freeze({
      sourceTitle: candidate.chunk.sourceTitle,
      page: candidate.chunk.page,
      excerpt: candidate.chunk.text.slice(0, 900),
      authorityBoundary: "stable_industry_guidance_only_verify_current_facts_officially",
    }));
    perSource.set(candidate.chunk.sourceId, sourceCount + 1);
  }
  return Object.freeze(selected);
}
