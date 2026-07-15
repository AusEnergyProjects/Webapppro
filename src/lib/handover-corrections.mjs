export const HANDOVER_CORRECTION_FIELDS = [
  ["brand", "Brand"],
  ["model_number", "Model number"],
  ["serial_number", "Serial number"],
  ["quantity", "Quantity"],
  ["installed_at", "Installed date"],
  ["warranty_provider", "Warranty provider"],
  ["warranty_reference", "Warranty reference"],
  ["warranty_start", "Warranty start"],
  ["warranty_end", "Warranty end"],
];

export const HANDOVER_CORRECTION_DATE_FIELDS = new Set(["installed_at", "warranty_start", "warranty_end"]);

export function correctionFieldLabel(fieldKey) {
  return HANDOVER_CORRECTION_FIELDS.find(([key]) => key === fieldKey)?.[1] || String(fieldKey || "").replaceAll("_", " ");
}
