import type { WorkspaceListPreferences } from "@/components/WorkspaceListControls";

export type AdminWorkspaceApi = (path: string, init?: RequestInit) => Promise<{ preferences?: WorkspaceListPreferences }>;

export function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function dateTime(value: unknown) {
  if (!value) return "Not yet";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export function workspaceError(error: unknown, fallback = "The secure workspace action could not be completed.") {
  return error instanceof Error ? error.message : fallback;
}

export async function saveWorkspaceListView(api: AdminWorkspaceApi, view: string, preferences: WorkspaceListPreferences) {
  await api(`/api/admin/list-views?view=${view}`, { method: "PATCH", body: JSON.stringify(preferences) });
}

export async function resetWorkspaceListView(api: AdminWorkspaceApi, view: string) {
  const result = await api(`/api/admin/list-views?view=${view}`, { method: "DELETE" });
  return result.preferences || { search: "", filter: "all", sort: "", pageSize: 25 };
}
