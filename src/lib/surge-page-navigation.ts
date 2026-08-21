const PENDING_SURGE_DRAFT_KEY = "aea-surge-pending-draft-v1";
const MAX_SURGE_DRAFT_LENGTH = 1_200;

function boundedDraft(draft: string) {
  return draft.trim().slice(0, MAX_SURGE_DRAFT_LENGTH);
}

export function storePendingSurgeDraft(draft = "") {
  try {
    const pendingDraft = boundedDraft(draft);
    if (pendingDraft) window.sessionStorage.setItem(PENDING_SURGE_DRAFT_KEY, pendingDraft);
    else window.sessionStorage.removeItem(PENDING_SURGE_DRAFT_KEY);
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
}

export function takePendingSurgeDraft() {
  try {
    const pendingDraft = boundedDraft(window.sessionStorage.getItem(PENDING_SURGE_DRAFT_KEY) || "");
    window.sessionStorage.removeItem(PENDING_SURGE_DRAFT_KEY);
    return pendingDraft;
  } catch {
    return "";
  }
}
