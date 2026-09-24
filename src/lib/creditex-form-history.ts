import type { ActivityForm } from "./trade-activity-form-types.ts";

export type EditorFormHistory = {
  form: ActivityForm | null;
  savedForm: ActivityForm | null;
  past: ActivityForm[];
  future: ActivityForm[];
  dirty: boolean;
  group: string;
};

const HISTORY_LIMIT = 100;
// Form arrays carry meaningful order; object property insertion order does not.
function formContent(form: ActivityForm | null) {
  return JSON.stringify(form, (_key, value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
}
function sameForm(left: ActivityForm | null, right: ActivityForm | null) {
  return left === right || formContent(left) === formContent(right);
}

/** Forms are immutable snapshots supplied by the editor; history never mutates them. */
export function createEditorFormHistory(form: ActivityForm | null): EditorFormHistory {
  return { form, savedForm: form, past: [], future: [], dirty: false, group: "" };
}

export function changeEditorFormHistory(history: EditorFormHistory, nextForm: ActivityForm, group = ""): EditorFormHistory {
  if (sameForm(history.form, nextForm)) return history;
  const coalescing = Boolean(group) && history.group === group;
  const past = history.form && !coalescing ? [...history.past, history.form].slice(-HISTORY_LIMIT) : history.past;
  return { ...history, form: nextForm, past, future: [], dirty: !sameForm(nextForm, history.savedForm), group };
}

export function endEditorFormHistoryGroup(history: EditorFormHistory): EditorFormHistory {
  return history.group ? { ...history, group: "" } : history;
}

export function undoEditorFormHistory(history: EditorFormHistory): EditorFormHistory {
  const form = history.past.at(-1);
  if (!form || !history.form) return endEditorFormHistoryGroup(history);
  return { ...history, form, past: history.past.slice(0, -1), future: [history.form, ...history.future],
    dirty: !sameForm(form, history.savedForm), group: "" };
}

export function redoEditorFormHistory(history: EditorFormHistory): EditorFormHistory {
  const form = history.future[0];
  if (!form || !history.form) return endEditorFormHistoryGroup(history);
  return { ...history, form, past: [...history.past, history.form].slice(-HISTORY_LIMIT), future: history.future.slice(1),
    dirty: !sameForm(form, history.savedForm), group: "" };
}
