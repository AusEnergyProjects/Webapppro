import tlinkMark from "../../public/tlink-icon-192.png?inline";

export function rentalReportBrandBytes() {
  const encoded = tlinkMark.slice(tlinkMark.indexOf(",") + 1);
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}
