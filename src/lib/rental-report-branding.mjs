const AEA_ABN = "73675233557";

/** Commissioning never changes the recorded assessor or authoritative issuing business. */
export function rentalReportBrandingProfile(business, homeStarCommissioned) {
  return homeStarCommissioned === true && String(business?.abn || "").replace(/\s/g, "") === AEA_ABN
    ? "homestar" : "standard";
}

/** Missing branding on an older frozen report remains standard. */
export function rentalReportBranding(snapshot) {
  const homestar = snapshot?.report?.branding === "homestar"
    && rentalReportBrandingProfile(snapshot?.business, true) === "homestar";
  return { homestar,
    issuerLabel: snapshot?.business?.name || "Assessment provider",
    commissionerLabel: homestar ? "HomeStar Upgrades" : "",
    nextSteps: homestar
      ? "Review the report. HomeStar Upgrades will be in contact to discuss quotes for upgrades and any work needed to meet the assessed standards."
      : "Review the findings and any assessment limits. Use the technical details and photos later in this report to discuss the required work with the relevant trades.",
  };
}
