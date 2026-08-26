export const SURGE_ASSESSOR_EDUCATION_SOURCE_CONTRACT =
  "surge-assessor-education-source-custody-v1" as const;

export const SURGE_ASSESSOR_EDUCATION_REVIEW = Object.freeze({
  status: "reviewed_for_editorial_use",
  preparedBy: "codex-primary-source-review",
  custodyVerifiedBy: "codex-pdf-source-audit",
  reviewedOn: "2026-08-26",
  independentSubjectMatterReview: "outstanding",
} as const);

export type SurgeAssessorEducationSource = {
  id: string;
  title: string;
  sourceFileName: string;
  pageCount: number;
  byteLength: number;
  pdfSha256: string;
  extractedTextSha256: string;
  classification: "editorial_primary";
  officialEvidence: false;
  regulatoryEvidence: false;
  mayAnswerCurrentFacts: false;
  currentFactBoundary: "verify_with_current_official_sources";
};

const editorialSource = (
  source: Omit<
    SurgeAssessorEducationSource,
    | "classification"
    | "officialEvidence"
    | "regulatoryEvidence"
    | "mayAnswerCurrentFacts"
    | "currentFactBoundary"
  >,
): SurgeAssessorEducationSource => Object.freeze({
  ...source,
  classification: "editorial_primary",
  officialEvidence: false,
  regulatoryEvidence: false,
  mayAnswerCurrentFacts: false,
  currentFactBoundary: "verify_with_current_official_sources",
});

export const SURGE_ASSESSOR_EDUCATION_SOURCES = Object.freeze([
  editorialSource({
    id: "electric-saul-editorial",
    title: "Electric Saul",
    sourceFileName: "electric saul.pdf",
    pageCount: 10,
    byteLength: 142_937,
    pdfSha256: "48260e86e921a25b4e468ed93a3b6ed754137f2c1d0c70df3addd4667aecd32c",
    extractedTextSha256: "7f3d8c4918f611a317def7ee4f9dde426f3d629ccb53e55370eef3c157c9ef01",
  }),
  editorialSource({
    id: "home-by-evidence",
    title: "Home by Evidence: Australian Home Design and Retrofit Guide",
    sourceFileName: "Evidence_Led_Australian_Home_Design_and_Retrofit_Guide.pdf",
    pageCount: 103,
    byteLength: 426_160,
    pdfSha256: "5c53df499119c53780e19fd286b30979a45d52370f367503b091bc2d183e2f6b",
    extractedTextSha256: "39c72462ce2e4593e58e47c4e1f0df162957ab406620281833b2121301d47bd4",
  }),
  editorialSource({
    id: "drive-the-transition",
    title: "Drive the Transition: Australian Electric Mobility Guide",
    sourceFileName: "Electric_Mobility_Australian_EV_and_Transport_Transition_Guide.pdf",
    pageCount: 86,
    byteLength: 390_702,
    pdfSha256: "3fa876bd416c2e365d975fdb9453253af980a5d4e87d5e89a2289ebbbce78613",
    extractedTextSha256: "eb84438c8d62ad827a324900774be91f098b458d1a8363a48945b31df833683e",
  }),
  editorialSource({
    id: "comfort-by-design",
    title: "Comfort by Design: Australian Insulation and Glazing Guide",
    sourceFileName: "Comfort_Envelope_Australian_Insulation_and_Glazing_Guide.pdf",
    pageCount: 73,
    byteLength: 340_272,
    pdfSha256: "b3512edd99f057bba18a8268c1eb63769d1043acb819a278f3100b39996852d9",
    extractedTextSha256: "0dedbe7628fd30f7468adffd9832796a89e16532e3611fa43fb3f9d5a6855964",
  }),
  editorialSource({
    id: "power-you-control",
    title: "Power You Control: Australian Home Energy Systems Guide",
    sourceFileName: "Power_You_Control_Australian_Home_Energy_Guide.pdf",
    pageCount: 124,
    byteLength: 479_551,
    pdfSha256: "c11f7035e911d58b47a0f67ce202d7f4c270c2826184ada518738b1bce856bf8",
    extractedTextSha256: "a33d9de2186802043cc27dc802e8debda1b801194cf7598d247182b289322b22",
  }),
  editorialSource({
    id: "comfort-you-control",
    title: "Comfort You Control: Australian Renter and Homeowner Field Guide",
    sourceFileName: "Comfort_You_Control_Australian_Home_Handbook.pdf",
    pageCount: 62,
    byteLength: 286_392,
    pdfSha256: "359bc82a6d549b5653ed13eee9a087ac08aaf24055c42030b1933c996b9fca63",
    extractedTextSha256: "3f4b553f072f4a3dce755140879b8c3f36e9e8eaabc099c961c1ad5e263bb679",
  }),
  editorialSource({
    id: "community-informed-response-guide",
    title: "Community-Informed Home Energy AI Response Guide",
    sourceFileName: "meeh-community-ai-response-guide.pdf",
    pageCount: 7,
    byteLength: 146_077,
    pdfSha256: "ce8c8b570251840d819fbac8f342afc3f42d89077833eb114fd0429006ac7b85",
    extractedTextSha256: "19b18f426c218183d1931591dd1464989b65e42f976782a60a8e41c3262494df",
  }),
] as const satisfies readonly SurgeAssessorEducationSource[]);

export type SurgeAssessorEducationSourceId =
  (typeof SURGE_ASSESSOR_EDUCATION_SOURCES)[number]["id"];

export const SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY = Object.freeze({
  contract: SURGE_ASSESSOR_EDUCATION_SOURCE_CONTRACT,
  classification: "editorial_primary",
  authorityBoundary:
    "Education and reasoning guidance only. These records are not current official, regulatory, eligibility, price, tariff or product evidence.",
  currentFactBoundary: "verify_with_current_official_sources",
  review: SURGE_ASSESSOR_EDUCATION_REVIEW,
  extraction: Object.freeze({
    primaryTextEngine: "pypdf 6.10.0",
    verificationTextEngine: "pdfplumber 0.11.9",
    pageCountEngine: "Poppler pdfinfo",
    pagesProcessedByPrimary: 465,
    pagesProcessedByVerification: 465,
    emptyPageCount: 0,
    nearEmptyPageCount: 0,
    extractionErrorCount: 0,
  }),
  sourceCount: 7,
  totalPageCount: 465,
  sources: SURGE_ASSESSOR_EDUCATION_SOURCES,
} as const);
