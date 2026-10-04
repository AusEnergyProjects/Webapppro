export const TLINK_PORTALS = [
  { id: "trade", label: "TLink trades", href: "/direct-trade/dashboard" },
  { id: "admin", label: "Admin portal", href: "/operations/control-centre" },
  { id: "creditex", label: "Creditex compliance team", href: "/creditex/compliance" },
  { id: "council", label: "Council", href: "/council" },
] as const;

export type TlinkPortalId = typeof TLINK_PORTALS[number]["id"];
export type TlinkPortalStatus = "ready" | "verify_email" | "verify_mfa" | "invitation" | "setup" | "no_access";
export type TlinkPortalAvailability = {
  id: TlinkPortalId;
  status: TlinkPortalStatus;
  available: boolean;
};
