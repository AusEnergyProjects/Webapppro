const panels = ["overview", "community", "map", "calculator", "activities", "economy", "campaigns", "sessions", "reports", "settings", "team", "wattzun"] as const;
export type CouncilWorkspaceView = typeof panels[number];
export type CouncilPanelAvailability = { community: boolean; map: boolean; calculator: boolean; team: boolean; wattzun: boolean };

/** Panel links only select a view. They never select a council, grant a role or create a record. */
export function councilWorkspaceFromSearch(search: string, available: CouncilPanelAvailability): CouncilWorkspaceView {
  const params = new URLSearchParams(search);
  if (params.getAll("workspace").length !== 1) return "overview";
  const view = panels.find(panel => panel === params.get("workspace")) ?? "overview";
  if ((view === "community" || view === "map" || view === "calculator" || view === "team" || view === "wattzun") && !available[view]) return "overview";
  return view;
}

export function councilWorkspaceSearch(search: string, view: CouncilWorkspaceView): string {
  const params = new URLSearchParams(search);
  params.set("workspace", view);
  return `?${params.toString()}`;
}
