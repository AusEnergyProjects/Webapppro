export type TradeJobFormSelection =
  | { kind: "business"; templateKey: string; templateVersion: number; name: string }
  | { kind: "rental"; moduleKey: "minimum_standards" | "electrical_safety_check" | "gas_safety_check" | "smoke_alarm_check"; name: string }
  | { kind: "creditex"; programTemplateId: string; activityTemplateId: string; variantId?: string; name: string }
  | { kind: "piesa"; name: string };

export type TradeJobFormLibraryOption = {
  id: string;
  name: string;
  group: "Creditex forms" | "Rental assessments" | "Business forms";
  jurisdiction: string;
  description: string;
  categories: string[];
  searchText: string;
  selection: TradeJobFormSelection;
  added?: boolean;
  unavailableReason: string;
};

export function tradeJobFormSelectionId(selection: TradeJobFormSelection): string {
  switch (selection.kind) {
    case "business": return `business:${selection.templateKey}:${selection.templateVersion}`;
    case "rental": return `rental:${selection.moduleKey}`;
    case "creditex": return `creditex:${selection.programTemplateId}:${selection.activityTemplateId}`;
    case "piesa": return "piesa:veu-pre-installation-electrical-safety-assessment";
  }
}
