// Shared customer-document layout. Business details and text remain snapshot data.
export function drawTradeDocumentHeader(page, { business, logo, regular, bold, ink, accent, muted, margin, width, height, wrap }) {
  const top = height - margin;
  const identityWidth = width * 0.47;
  let leftBottom = top;
  if (logo) {
    const scale = Math.min(155 / logo.width, 58 / logo.height);
    page.drawImage(logo, { x: margin, y: top - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    leftBottom -= logo.height * scale;
  } else {
    const names = wrap(bold, business.name, 18, identityWidth);
    names.forEach((text, index) => page.drawText(text, { x: margin, y: top - 17 - index * 21, font: bold, size: 18, color: ink }));
    leftBottom -= names.length * 21;
  }
  const details = [logo ? business.name : "", business.phone, business.email, business.abn ? `ABN ${business.abn}` : "", business.website].filter(Boolean);
  let rightY = top - 9;
  for (const [index, value] of details.entries()) {
    const font = index === 0 && logo ? bold : regular;
    for (const text of wrap(font, value, 8.5, identityWidth)) {
      page.drawText(text, { x: margin + width - font.widthOfTextAtSize(text, 8.5), y: rightY, font, size: 8.5, color: font === bold ? ink : muted });
      rightY -= 12;
    }
  }
  const bottom = Math.min(leftBottom, rightY, top - 58) - 12;
  page.drawLine({ start: { x: margin, y: bottom }, end: { x: margin + width, y: bottom }, thickness: 1.2, color: accent });
  return bottom - 25;
}

export function drawTradeDocumentMetadata(page, cells, { y, margin, width, regular, bold, ink, accent, line, wrap }) {
  const cellWidth = width / 3;
  for (let start = 0; start < cells.length; start += 3) {
    const row = cells.slice(start, start + 3).map(([label, value]) => ({ label, lines: wrap(regular, value || "Not supplied", 9, cellWidth - 16) }));
    row.forEach((cell, index) => {
      const x = margin + index * cellWidth;
      page.drawText(cell.label.toUpperCase(), { x, y, font: bold, size: 7, color: accent });
      cell.lines.forEach((text, i) => page.drawText(text, { x, y: y - 16 - i * 12, font: regular, size: 9, color: ink }));
    });
    y -= 28 + Math.max(...row.map(cell => cell.lines.length)) * 12;
  }
  page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: margin + width, y: y + 4 }, thickness: .5, color: line });
  return y - 15;
}
