import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { AGREEMENT_TEMPLATE_VERSION, agreementTitle, type MemberAgreementKind } from './trade-member-agreement';

export async function renderMemberAgreementPdf(kind: MemberAgreementKind, body: string, fonts: { regular: Uint8Array; bold: Uint8Array }) {
  if (!body.trim() || body.length > 20000) throw new Error('Keep the agreement between 1 and 20,000 characters.');
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts.regular, { subset: true }); const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const ink = rgb(.08, .19, .21), accent = rgb(.04, .42, .35), muted = rgb(.35, .42, .44);
  const title = agreementTitle(kind); pdf.setTitle(`${title} - draft`); pdf.setSubject('Unsigned agreement draft for review');
  let page = pdf.addPage([595.28, 841.89]), y = 735;
  function header() {
    page.drawText(title, { x: 48, y: 790, size: 20, font: bold, color: ink });
    page.drawText('DRAFT | Review and complete before signing', { x: 48, y: 767, size: 10, font: bold, color: accent });
    page.drawLine({ start: { x: 48, y: 753 }, end: { x: 547, y: 753 }, color: accent, thickness: 1 });
  }
  header();
  function line(value: string, font: PDFFont, heading: boolean) {
    if (y < (heading ? 110 : 62)) { page = pdf.addPage([595.28, 841.89]); y = 735; header(); }
    page.drawText(value, { x: 48, y, size: 10, font, color: ink }); y -= heading ? 19 : 15;
  }
  for (const paragraph of body.replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').split('\n')) {
    if (!paragraph.trim()) { y -= 9; continue; }
    const heading = /^[A-Z][A-Z &]+$/.test(paragraph); const font = heading ? bold : regular;
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (current && font.widthOfTextAtSize(`${current} ${word}`, 10) > 499) { line(current, font, heading); current = ''; }
      if (font.widthOfTextAtSize(word, 10) <= 499) { current = current ? `${current} ${word}` : word; continue; }
      for (const character of word) {
        if (font.widthOfTextAtSize(current + character, 10) > 499) { line(current, font, heading); current = ''; }
        current += character;
      }
    }
    if (current) line(current, font, heading);
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => sheet.drawText(`TLink starter ${AGREEMENT_TEMPLATE_VERSION} | Unsigned draft | ${index + 1} of ${pages.length}`, { x: 48, y: 32, size: 8, font: regular, color: muted }));
  return pdf.save();
}
