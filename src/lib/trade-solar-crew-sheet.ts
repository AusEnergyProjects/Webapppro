import { decodeQuoteRoofImage } from "./trade-quote-roof-image.ts";
import { normalizeSolarDesignEquipment, normalizeSolarEquipmentItem, solarEquipmentDescription, solarEquipmentSummary, type SolarDesignEquipment, type SolarEquipmentItem } from "./trade-solar-equipment.ts";

export type SolarCrewSheetInput = {
  title: string;
  address?: string;
  imageDataUrl: string;
  panels: readonly { equipment?: SolarEquipmentItem }[];
  equipment: SolarDesignEquipment;
  installationNotes: string;
};
const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);

/** Contains only the supplied clean map image and customer-safe equipment data. */
export function buildSolarCrewSheetHtml(input: SolarCrewSheetInput) {
  decodeQuoteRoofImage({ dataUrl: input.imageDataUrl });
  const equipment = normalizeSolarDesignEquipment(input.equipment);
  if (input.panels.length > 1000 || typeof input.title !== "string" || input.title.length > 180
    || (input.address !== undefined && (typeof input.address !== "string" || input.address.length > 500))
    || typeof input.installationNotes !== "string" || input.installationNotes.length > 5000) throw new Error("Installation sheet details are not valid.");
  const panels = input.panels.map((panel) => {
    if (!panel.equipment) return {};
    const equipment = normalizeSolarEquipmentItem(panel.equipment);
    if (equipment.kind !== "panel") throw new Error("A roof panel must use a solar panel model.");
    return { equipment };
  });
  const summary = solarEquipmentSummary(panels);
  const items = [...summary.models, ...equipment.filter((item) => item.kind !== "panel")];
  const capacity = summary.systemKw === null ? (summary.unknownPanelCount ? "Panel power not fully specified" : "") : `${summary.systemKw.toLocaleString("en-AU", { maximumFractionDigits: 3 })} kW DC`;
  const rows = items.map((item) => `<tr><td>${item.quantity}</td><td><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.manufacturer, item.model].filter(Boolean).join(" · "))}</span>${item.datasheetUrl ? `<a href="${escapeHtml(item.datasheetUrl)}" target="_blank" rel="noopener noreferrer">Manufacturer datasheet</a>` : ""}</td><td>${escapeHtml(solarEquipmentDescription(item))}</td></tr>`).join("");
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(input.title || "Installation sheet")}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#edf2f1;color:#183935;font:14px/1.5 Arial,Helvetica,sans-serif}.sheet{max-width:850px;margin:24px auto;padding:36px;background:#fff}.actions{max-width:850px;margin:20px auto 0;display:flex;justify-content:flex-end;gap:12px;align-items:center;padding:0 12px}.actions button{border:0;border-radius:8px;background:#087567;color:#fff;padding:11px 18px;font:600 14px Arial;cursor:pointer}.actions span{font-size:12px;color:#536d67}.eyebrow{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#087567;font-weight:700}header{border-bottom:2px solid #087567;padding-bottom:18px;margin-bottom:20px}h1{font-size:24px;line-height:1.2;margin:7px 0 8px;font-weight:700}p{margin:7px 0}.summary{display:flex;gap:18px;font-weight:700;margin-top:14px}.map{display:block;width:100%;height:auto;border:1px solid #d6e3df;border-radius:6px;margin:0 0 20px}.map-section{break-inside:avoid}h2{font-size:15px;margin:22px 0 10px}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;background:#edf5f2;font-size:11px}td,th{padding:10px;border-bottom:1px solid #d6e3df;vertical-align:top}td:first-child{width:50px;font-weight:700}td span,td a{display:block;font-size:11px;color:#536d67;overflow-wrap:anywhere}td a{color:#087567;margin-top:4px}tr{break-inside:avoid}.notes{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;padding:14px;background:#f5f8f7;border:1px solid #d6e3df;border-radius:6px}.footnote{margin-top:22px;padding-top:12px;border-top:1px solid #d6e3df;color:#536d67;font-size:10px}@page{size:A4;margin:14mm}@media print{body{background:#fff}.sheet{max-width:none;margin:0;padding:0}.actions{display:none}.map{max-height:130mm;object-fit:contain}a{color:#087567;text-decoration:none}thead{display:table-header-group}}@media(max-width:600px){.sheet{padding:20px;margin:12px}.actions{flex-wrap:wrap}.summary{flex-wrap:wrap;gap:6px 16px}}
  </style></head><body><div class="actions"><span>Choose Save as PDF in the print window.</span><button id="print-sheet" type="button">Print or save PDF</button></div><main class="sheet"><header><div class="eyebrow">Installation sheet</div><h1>${escapeHtml(input.title || "Roof design")}</h1>${input.address ? `<p>${escapeHtml(input.address)}</p>` : ""}<div class="summary"><span>${summary.panelCount} ${summary.panelCount === 1 ? "panel" : "panels"}</span>${capacity ? `<span>${escapeHtml(capacity)}</span>` : ""}</div></header><section class="map-section"><img class="map" id="roof-layout" src="${input.imageDataUrl}" alt="Roof panel layout with map attribution" /></section><h2>Equipment</h2><table><thead><tr><th>Qty</th><th>Model</th><th>Specification</th></tr></thead><tbody>${rows}${summary.unknownPanelCount ? `<tr><td>${summary.unknownPanelCount}</td><td>Solar panel<span>Model not specified</span></td><td>Confirm before installation</td></tr>` : ""}${!items.length && !summary.unknownPanelCount ? '<tr><td colspan="3">No equipment specified.</td></tr>' : ""}</tbody></table>${input.installationNotes.trim() ? `<h2>Installation notes</h2><div class="notes">${escapeHtml(input.installationNotes)}</div>` : ""}<footer class="footnote">Layout concept. Confirm dimensions, roof structure, clearances and electrical design on site. Map attribution is retained in the roof image.</footer></main></body></html>`;
}

/** Reserve on the user's click, before awaiting the map capture permission dialog. */
export function reserveSolarCrewSheetWindow(): Window | null {
  const target = window.open("", "_blank");
  if (!target) return null;
  target.opener = null;
  target.document.open();
  target.document.write('<!doctype html><html lang="en"><head><title>Preparing installation sheet</title></head><body style="font:16px system-ui;padding:32px"><p>Preparing your installation sheet. Return to TLink to share the map image.</p></body></html>');
  target.document.close();
  window.focus();
  return target;
}

/** Reuses a reserved window so asynchronous map capture cannot trigger a blocked popup. */
export function openSolarCrewSheet(input: SolarCrewSheetInput, reservedWindow?: Window | null) {
  const html = buildSolarCrewSheetHtml(input);
  const target = reservedWindow || reserveSolarCrewSheetWindow();
  if (!target || target.closed) throw new Error("Allow pop-ups for TLink, then try the installation sheet again.");
  target.document.open(); target.document.write(html); target.document.close();
  target.document.getElementById("print-sheet")?.addEventListener("click", () => { target.focus(); target.print(); });
  const image = target.document.getElementById("roof-layout");
  const showPrint = () => { if (!target.closed) { target.focus(); target.print(); } };
  if (image && "complete" in image && !image.complete) image.addEventListener("load", showPrint, { once: true });
  else target.setTimeout(showPrint, 0);
  return target;
}
