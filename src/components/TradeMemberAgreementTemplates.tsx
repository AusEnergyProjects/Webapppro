"use client";

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { MemberEngagement, MemberEngagementBusiness } from '@/lib/trade-member-engagement';
import { AGREEMENT_GUIDANCE, agreementTitle, memberAgreementTemplate, type MemberAgreementKind } from '@/lib/trade-member-agreement';
import { useTradeBusiness, useTradeBusinessFetch } from './TradeBusinessProvider';
import type { PrivateFile } from './TradeMemberEngagementPanel';
import styles from './TradeMemberAgreementTemplates.module.css';

type Props = { user: User; memberId: string; displayName: string; engagement: MemberEngagement; businessContext?: MemberEngagementBusiness; disabled: boolean; readOnly: boolean; onSavedFile: (file: PrivateFile) => void; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void };
export function TradeMemberAgreementTemplates({ user, memberId, displayName, engagement, businessContext, disabled, readOnly, onSavedFile, onBusyChange, onDirtyChange }: Props) {
  const business = useTradeBusiness(); const request = useTradeBusinessFetch();
  const [kind, setKind] = useState<MemberAgreementKind>(engagement.engagementType === 'contractor' ? 'contractor' : 'employee');
  const [body, setBody] = useState(''); const [savedBody, setSavedBody] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const dirty = Boolean(body && body !== savedBody);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(Boolean(busy)); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function start(next: MemberAgreementKind) {
    if (dirty && !window.confirm('Replace this unsaved agreement draft?')) return;
    setKind(next); setBody(memberAgreementTemplate(next, business?.businessName || '', displayName, engagement, businessContext)); setSavedBody(''); setNotice(''); setError('');
  }
  async function generate(save: boolean) {
    if (busy || disabled || readOnly || !body.trim()) return;
    setBusy(save ? 'save' : 'download'); setError(''); setNotice('');
    try {
      const [{ renderMemberAgreementPdf }, regular, bold] = await Promise.all([
        import('@/lib/trade-member-agreement-pdf'), fetch('/fonts/LiberationSans-Regular.ttf'), fetch('/fonts/LiberationSans-Bold.ttf'),
      ]);
      if (!regular.ok || !bold.ok) throw new Error('The document fonts could not be loaded. Try again.');
      const bytes = await renderMemberAgreementPdf(kind, body, { regular: new Uint8Array(await regular.arrayBuffer()), bold: new Uint8Array(await bold.arrayBuffer()) });
      const file = new File([new Uint8Array(bytes)], `${kind}-agreement-draft.pdf`, { type: 'application/pdf' });
      if (save) {
        const form = new FormData(); form.set('memberId', memberId); form.set('category', 'other'); form.set('scope', 'employment');
        form.set('title', `${agreementTitle(kind)} - draft`); form.set('file', file);
        const response = await request('/api/trade-team/member-files', { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` }, body: form });
        const result: { ok?: boolean; file?: PrivateFile; error?: string } = await response.json();
        if (!response.ok || !result.ok || !result.file || result.file.memberId !== memberId) throw new Error(result.error || 'The draft could not be saved.');
        onSavedFile(result.file); setSavedBody(body); setNotice('Draft saved to private documents. Download it for review; upload the signed copy when ready.');
      } else {
        const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Draft downloaded. It has not been signed or sent.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The draft could not be prepared.'); }
    finally { setBusy(''); }
  }
  if (readOnly) return null;
  return <details className={styles.templates}><summary>Use an agreement template, optional</summary><p>Start with saved details, edit the draft, then save or download it. You can also upload your own agreement below.</p>
    <div className={styles.actions}><button type="button" disabled={disabled || Boolean(busy)} onClick={() => start('employee')}>Employee template</button><button type="button" disabled={disabled || Boolean(busy)} onClick={() => start('contractor')}>Contractor template</button></div>
    {body && <><label>{agreementTitle(kind)} draft<textarea value={body} rows={16} maxLength={20000} disabled={disabled || Boolean(busy)} onChange={event => { setBody(event.target.value); setNotice(''); }} /></label><p>Complete the bracketed fields and review the terms for this role before signing. <a href={AGREEMENT_GUIDANCE[kind]} target="_blank" rel="noreferrer">Official contract guidance</a></p><div className={styles.actions}><button type="button" disabled={disabled || Boolean(busy) || !body.trim()} onClick={() => void generate(true)}>{busy === 'save' ? 'Saving...' : 'Save draft to private documents'}</button><button type="button" disabled={disabled || Boolean(busy) || !body.trim()} onClick={() => void generate(false)}>{busy === 'download' ? 'Preparing...' : 'Download draft PDF'}</button></div></>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </details>;
}
