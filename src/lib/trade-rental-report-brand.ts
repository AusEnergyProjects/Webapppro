import tlinkMark from "../../public/tlink-icon-192.png?inline";
import aeaMark from "../../public/aea-email-signature-brand-lockup.png?inline";
import homeStarMark from "../../public/homestar-upgrades.png?inline";
import { rentalReportBranding } from "./rental-report-branding.mjs";

function imageBytes(image: string) {
  const encoded = image.slice(image.indexOf(",") + 1);
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

export function rentalReportBrandBytes(snapshot?: { report?: { branding?: string }; business?: { abn?: string } }) {
  return rentalReportBranding(snapshot).homestar
    ? { tlink: imageBytes(tlinkMark), aea: imageBytes(aeaMark), homestar: imageBytes(homeStarMark) }
    : imageBytes(tlinkMark);
}
