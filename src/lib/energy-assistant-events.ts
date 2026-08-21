export const OPEN_SURGE_EVENT = "aea:open-surge";

export type OpenSurgeEventDetail = {
  draft?: string;
};

export function requestSurgeOpen(draft = "") {
  window.dispatchEvent(new CustomEvent<OpenSurgeEventDetail>(OPEN_SURGE_EVENT, {
    detail: { draft: draft.trim().slice(0, 1_200) },
  }));
}
