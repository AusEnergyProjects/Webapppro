export type SafetyCheckEmailInput = {
  businessName: string; recordNumber: string; title: string;
  propertyAddress: string; inspectionDate: string; inspectorName: string;
  photoCount: number; supportingDocumentCount?: number;
  businessEmail?: string; businessPhone?: string;
  outcome?: string; actionRequired?: string; attention?: 'follow_up' | 'urgent';
  reportUrl?: string;
};

function clean(value: string) { return value.replace(/[\r\n\u0000]/g, ' ').trim(); }
function escape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** The sender supplies verified record facts and the immutable attachments. */
export function safetyCheckEmailDraft(input: SafetyCheckEmailInput) {
  const business = clean(input.businessName), number = clean(input.recordNumber), title = clean(input.title);
  if (!business || !number || !title || !Number.isSafeInteger(input.photoCount) || input.photoCount < 0
    || input.supportingDocumentCount !== undefined && (!Number.isSafeInteger(input.supportingDocumentCount) || input.supportingDocumentCount < 0)) {
    throw new Error('SAFETY_CHECK_EMAIL_CONTENT_INVALID');
  }
  const facts = [
    ['Property', input.propertyAddress], ['Checked on', input.inspectionDate],
    ['Checked by', input.inspectorName], ['Record', number],
  ].filter(([, value]) => Boolean(value));
  const supporting = input.supportingDocumentCount || 0;
  const attachments = `Your completed PDF is attached${input.photoCount ? `, with ${input.photoCount} evidence photo${input.photoCount === 1 ? '' : 's'}` : ''}${supporting ? ` and ${supporting} supporting document${supporting === 1 ? '' : 's'}` : ''}. Keep these together with your property records.`;
  const next = input.actionRequired || 'Read the recorded findings and any limitations. Contact the inspecting business about any repairs or follow-up work.';
  const contact = [input.businessEmail, input.businessPhone].filter(Boolean).join(' | ');
  let reportUrl = '';
  if (input.reportUrl) {
    const url = new URL(input.reportUrl);
    if (url.origin !== 'https://ausenergyassessments.com' || url.username || url.password || url.search || url.hash
      || !/^\/reports\/safety\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(url.pathname)) throw new Error('SAFETY_CHECK_REPORT_URL_INVALID');
    reportUrl = url.href;
  }
  const reportLink = reportUrl ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td><a href="${escape(reportUrl)}" style="display:inline-block;padding:15px 24px;border-radius:10px;background:#08795e;color:#fff;font-size:16px;font-weight:bold;text-decoration:none">View your report</a><p style="margin:12px 0 0;font-size:12px;line-height:20px;color:#587078">Open your recorded findings, photos and downloads. This is a private link; anyone you forward it to can view your report.</p></td></tr></table>` : '';
  const resultColours = input.attention === 'urgent' ? { background: '#fff0ee', border: '#edb6ae', text: '#a02718' }
    : input.attention === 'follow_up' ? { background: '#fff7e8', border: '#e8cf9f', text: '#825210' }
      : { background: '#edf8f5', border: '#c7e8df', text: '#166653' };
  const outcome = input.outcome ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:17px 20px;background:${resultColours.background};border:1px solid ${resultColours.border};border-radius:12px"><strong style="font-size:12px;letter-spacing:1px;color:${resultColours.text}">${input.attention === 'urgent' ? 'URGENT RECORDED FINDING' : 'RECORDED RESULT'}</strong><p style="margin:8px 0 0;font-size:18px;line-height:26px;color:#123e45">${escape(input.outcome)}</p></td></tr></table>` : '';
  const rows = facts.map(([label, value]) => `<tr><td style="width:108px;padding:9px 12px 9px 0;font-size:12px;color:#587078;vertical-align:top">${escape(label)}</td><td style="padding:9px 0;font-size:14px;line-height:21px;color:#183c44;overflow-wrap:anywhere">${escape(value)}</td></tr>`).join('');
  const body = `${title}\n${business}\n\n${facts.map(([label, value]) => `${label}: ${value}`).join('\n')}\n${input.outcome ? `\nRecorded result: ${input.outcome}\n` : ''}${reportUrl ? `\nView your report: ${reportUrl}\nOpen your recorded findings, photos and downloads. This is a private link; anyone you forward it to can view your report.\n` : ''}\n${attachments}\n\nWhat happens next\n${next}\n${contact ? `\nContact ${business}: ${contact}\n` : ''}\nPrepared and delivered through TLink. The attached document contains the inspecting person's recorded findings and scope.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#eef4f4;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #d8e5e5;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 28px;background:#082c35;color:#fff"><table role="presentation" width="100%"><tr><td style="font-size:18px;font-weight:bold;color:#fff">${escape(business)}</td><td align="right"><img src="https://ausenergyassessments.com/tlink-icon-192.png" width="38" height="38" alt="TLink" style="display:block;border:0;border-radius:9px"></td></tr></table><p style="margin:20px 0 7px;font-size:11px;letter-spacing:1.8px;color:#78e2c5">YOUR SAFETY CHECK RECORD</p><h1 style="margin:0;font-size:27px;line-height:35px;color:#fff">${escape(title)}</h1></td></tr><tr><td style="padding:26px 28px">${outcome}${reportLink}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:14px 0 22px">${rows}</table><h2 style="margin:0 0 9px;font-size:19px;color:#183c44">Everything together for your records</h2><p style="margin:0;font-size:14px;line-height:24px;color:#526c73">${escape(attachments)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="padding:18px 20px;border:1px solid #dbe8e7;border-radius:12px"><h2 style="margin:0 0 8px;font-size:17px;color:#183c44">What happens next</h2><p style="margin:0;font-size:14px;line-height:24px;color:#526c73">${escape(next)}</p></td></tr></table>${contact ? `<p style="margin:0;font-size:13px;line-height:22px;color:#526c73"><strong style="color:#183c44">Questions about this check?</strong><br>Contact ${escape(business)}<br>${escape(contact)}</p>` : ''}</td></tr><tr><td style="padding:19px 28px;background:#082c35;font-size:11px;line-height:18px;color:#bfdbdf"><strong style="color:#fff">Prepared and delivered through TLink</strong><br>The attached document contains the inspecting person's recorded findings, scope and limitations.</td></tr></table></td></tr></table></body></html>`;
  return { subject: `${title} | ${number}`, body, html };
}
