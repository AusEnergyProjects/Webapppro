import { AEA_RESERVED_SERVICE_IDS, requiresAeaDelivery } from "./aea-service-identity.mjs";

// Authorize the complete stored scope before exposing any part of an enquiry.
export function tradeOpportunityServiceScopeAllowed(value) {
  let services;
  try {
    services = Array.isArray(value) ? value : JSON.parse(String(value ?? ""));
  } catch {
    return false;
  }
  if (!Array.isArray(services) || services.length === 0
    || services.some((service) => typeof service !== "string" || !service.trim())) {
    return false;
  }
  return !requiresAeaDelivery(services.map((service) => service.trim().toLowerCase()));
}

// Only server-owned SQL aliases are accepted; service IDs come from the catalogue.
function opportunityServiceScopeSqlParts(alias) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid opportunity SQL alias.");
  const raw = alias + ".service_categories";
  const reserved = AEA_RESERVED_SERVICE_IDS.map((id) => "'" + id.replaceAll("'", "''") + "'").join(", ");
  return { raw, reserved };
}

export function tradeOpportunityServiceScopeSql(alias) {
  const { raw, reserved } = opportunityServiceScopeSqlParts(alias);
  return "(CASE WHEN json_valid(" + raw + ") THEN (json_type(" + raw + ") = 'array' AND json_array_length(" + raw + ") > 0"
    + " AND NOT EXISTS (SELECT 1 FROM json_each(" + raw + ") scope_service"
    + " WHERE scope_service.type <> 'text' OR trim(scope_service.value) = ''"
    + " OR lower(trim(scope_service.value)) IN (" + reserved + "))) ELSE 0 END)";
}

// Customer delivery may use reserved drafts, but invalid scope is never permission.
export function aeaDeliveredServiceScopeSql(alias) {
  const { raw, reserved } = opportunityServiceScopeSqlParts(alias);
  return "(CASE WHEN json_valid(" + raw + ") THEN (json_type(" + raw + ") = 'array' AND json_array_length(" + raw + ") > 0"
    + " AND NOT EXISTS (SELECT 1 FROM json_each(" + raw + ") scope_service"
    + " WHERE scope_service.type <> 'text' OR trim(scope_service.value) = '')"
    + " AND EXISTS (SELECT 1 FROM json_each(" + raw + ") reserved_service"
    + " WHERE lower(trim(reserved_service.value)) IN (" + reserved + "))) ELSE 0 END)";
}
