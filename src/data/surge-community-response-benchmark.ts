export type SurgeCommunityBenchmarkCase = {
  id: string;
  questionType: string;
  question: string;
  requiredAnswerGroups: string[][];
  rejectedPhrases?: string[];
  useSavedHomeContext?: boolean;
  recentTurns?: Array<{ role: "user" | "assistant"; content: string }>;
};

/**
 * Anonymous, synthetic questions based on recurring household decision patterns
 * observed in a bounded 2026 MEEH community sample. They contain no member names,
 * contact details or copied posts. These cases test response behaviour, not the
 * truth of community claims.
 */
export const SURGE_COMMUNITY_RESPONSE_BENCHMARK: SurgeCommunityBenchmarkCase[] = [
  {
    id: "community-bedroom-draught",
    questionType: "comfort and draught control",
    question: "What's a good way to reduce draughts in my bedroom?",
    requiredAnswerGroups: [["draught", "moving air", "gap"], ["seal", "weather strip", "door snake"]],
    rejectedPhrases: ["room load", "floor area need heating", "staged whole-home diagnosis"],
    useSavedHomeContext: true,
  },
  {
    id: "community-bedroom-draught-windy-follow-up",
    questionType: "short draught follow-up",
    question: "What if it only happens when it's windy?",
    requiredAnswerGroups: [["air leak"], ["windy day"], ["weather seal", "door snake"]],
    rejectedPhrases: ["room load", "floor area", "start by sealing the gaps that are actually letting air"],
    recentTurns: [
      { role: "user", content: "What's a good way to reduce draughts in my bedroom?" },
      { role: "assistant", content: "Start by finding and sealing the gaps that are letting air into the room." },
    ],
  },
  {
    id: "community-regional-solar-trade",
    questionType: "regional installer search",
    question: "Does anyone know a company that services the Grampians area for a solar install on a container shed?",
    requiredAnswerGroups: [["solar installer"], ["competing quotes", "approved trades"], ["area", "postcode"]],
    rejectedPhrases: ["clean the panels", "self-clean"],
  },
  {
    id: "community-commercial-gas-abolishment",
    questionType: "gas connection cost",
    question: "I was quoted $4,340 for gas abolishment at a commercial site. Does that make sense?",
    requiredAnswerGroups: [["$4,340"], ["gas"], ["abolishment", "disconnection", "meter lock"]],
    rejectedPhrases: ["exact model", "induction cooking"],
  },
  {
    id: "community-flat-rate-plan",
    questionType: "electricity plan comparison",
    question: "What are the pros and cons of a flat-rate electricity plan?",
    requiredAnswerGroups: [["simple", "predictable"], ["actual electricity use", "yearly cost"], ["supply charge", "import rate", "export rate"]],
    rejectedPhrases: ["major end use", "interval data"],
  },
  {
    id: "community-humid-climate-hot-water",
    questionType: "heat-pump hot water suitability",
    question: "Is a heat-pump hot-water system suitable for a family of five in Darwin's humid climate? We also have solar.",
    requiredAnswerGroups: [["yes"], ["warm", "humid"], ["household of five", "family of five"], ["solar", "daylight"]],
    rejectedPhrases: ["exact quote model", "for hot water, start here"],
  },
  {
    id: "community-solar-pressure-sale",
    questionType: "sales claim challenge",
    question: "A salesperson says my five-year-old solar panels are outdated and wants $20,000 for new panels and an 8 kWh battery. Should I believe them?",
    requiredAnswerGroups: [["not automatically outdated"], ["measured evidence", "fault", "poor output"], ["independent quote"]],
    rejectedPhrases: ["governed product evidence", "try again later"],
    useSavedHomeContext: true,
  },
  {
    id: "community-battery-value",
    questionType: "battery price and value",
    question: "Is $12,000 for a 14 kWh home battery worth it?",
    requiredAnswerGroups: [["$857"], ["warranty"], ["yearly bill saving", "payback"]],
    rejectedPhrases: ["governed product evidence", "try again later"],
  },
  {
    id: "community-low-e-surface",
    questionType: "window specification",
    question: "Is low-E on surface 4 okay for double glazing?",
    requiredAnswerGroups: [["surface 4"], ["room-side"], ["supplier", "manufacturer"], ["warranty"]],
    rejectedPhrases: ["battery hazard", "fire or shock"],
  },
  {
    id: "community-tilt-turn-honeycomb",
    questionType: "blind compatibility",
    question: "Can honeycomb blinds work on tilt-and-turn double-glazed doors?",
    requiredAnswerGroups: [["yes"], ["honeycomb"], ["no-drill", "manufacturer-approved"], ["handle", "hinge", "clearance"]],
    rejectedPhrases: ["outside the scope", "Australian home energy only"],
  },
  {
    id: "community-solar-battery-or-offset",
    questionType: "upgrade opportunity cost",
    question: "Should I put $22,000 into solar and a battery or leave it in my mortgage offset?",
    requiredAnswerGroups: [["mortgage rate"], ["solar"], ["battery"], ["yearly bill savings", "interest saved"]],
    rejectedPhrases: ["it depends"],
    useSavedHomeContext: true,
  },
  {
    id: "community-condensation-window-coverings",
    questionType: "condensation and window coverings",
    question: "Our bedroom windows are wet every morning. Would honeycomb blinds fix the condensation?",
    requiredAnswerGroups: [["moisture", "condensation"], ["honeycomb blinds"], ["dry", "air the room", "exhaust"]],
    rejectedPhrases: ["replace every window"],
    useSavedHomeContext: true,
  },
  {
    id: "community-high-bill-first-check",
    questionType: "high electricity bill",
    question: "My electricity bill has jumped. What should I check first?",
    requiredAnswerGroups: [["electricity", "bill"], ["kWh", "use"], ["same period last year", "biggest appliance"]],
    rejectedPhrases: ["battery fire", "staged diagnosis"],
    useSavedHomeContext: true,
  },
  {
    id: "community-saved-plan-priority",
    questionType: "survey-based starting point",
    question: "Where should I start based on my survey answers?",
    requiredAnswerGroups: [["saved answers"], ["condensation", "windows"], ["honeycomb blinds", "exhaust"]],
    rejectedPhrases: ["major end use", "staged whole-home diagnosis"],
    useSavedHomeContext: true,
  },
  {
    id: "community-casual-quote-follow-up",
    questionType: "short conversational follow-up",
    question: "What about the cheaper one?",
    requiredAnswerGroups: [["price alone", "cheaper quote"], ["installation", "same job", "warranty"]],
    rejectedPhrases: ["what topic", "tell me more about your home"],
    recentTurns: [
      { role: "user", content: "I have two heat-pump quotes, one is $6,000 and one is $8,000." },
      { role: "assistant", content: "I can help compare what each quote includes." },
    ],
  },
];
