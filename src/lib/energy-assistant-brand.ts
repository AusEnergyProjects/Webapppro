export const ENERGY_ASSISTANT_PUBLIC_NAME = "Wattzun AI" as const;

const LEGACY_ASSISTANT_NAME_PATTERN = /\bSurge AI\b/giu;
const LEGACY_ASSISTANT_POSSESSIVE_PATTERN = /\bSurge['’]s(?=\s+(?:answer|answers|assistant|chat|context|conversation|follow-up|guide|guidance|next check|pending question|position|profile|reply|response|review|role)\b)/gu;
const LEGACY_ASSISTANT_DIRECT_REFERENCE_PATTERN = /\b((?:Ask|Back to|Bring|Chat with|Open|Return to|Tell|Using|With|You can ask)\s+)Surge\b/gu;
const LEGACY_ASSISTANT_PRIOR_REFERENCE_PATTERN = /\b((?:earlier|last|previous|prior)\s+)Surge(?=\s+(?:answer|assistant|chat|conversation|guidance|reply|response|review)\b)/gu;
const LEGACY_ASSISTANT_QUESTION_REFERENCE_PATTERN = /\b((?:How can|What can|What did|What should|Why did|Who)\s+)Surge(?=\s+(?:answer|ask|check|compare|explain|help|is|review|say|send)\b)/gu;
const LEGACY_ASSISTANT_ACTION_PATTERN = /\bSurge\b(?=\s+(?:answered\b|asked\b|explained\b|explains\b|focuses\b|helps\b|recommends\b|said\b|says\b|separates\s+(?:evidence|estimates)\b|can\s+(?:answer|ask|check|compare|explain|help|review|send)\b|does\s+not\s+(?:endorse|prefer|rank|recommend)\b|is\s+(?:designed|focused|here|ready|an?\s+(?:Australian|home-energy|energy)\b)|only\s+(?:covers|handles)\b|should\s+(?:answer|ask|check|compare|explain|help|review|send)\b|will\s+(?:answer|ask|check|compare|explain|help|review|send)\b))/gu;

export function normalizeEnergyAssistantBrandText(value: string): string {
  return value
    .replace(LEGACY_ASSISTANT_NAME_PATTERN, ENERGY_ASSISTANT_PUBLIC_NAME)
    .replace(LEGACY_ASSISTANT_POSSESSIVE_PATTERN, `${ENERGY_ASSISTANT_PUBLIC_NAME}'s`)
    .replace(LEGACY_ASSISTANT_DIRECT_REFERENCE_PATTERN, `$1${ENERGY_ASSISTANT_PUBLIC_NAME}`)
    .replace(LEGACY_ASSISTANT_PRIOR_REFERENCE_PATTERN, `$1${ENERGY_ASSISTANT_PUBLIC_NAME}`)
    .replace(LEGACY_ASSISTANT_QUESTION_REFERENCE_PATTERN, `$1${ENERGY_ASSISTANT_PUBLIC_NAME}`)
    .replace(LEGACY_ASSISTANT_ACTION_PATTERN, ENERGY_ASSISTANT_PUBLIC_NAME);
}
