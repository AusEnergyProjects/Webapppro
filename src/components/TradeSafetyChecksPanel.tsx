"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { SafetyCheckKind, SafetyCheckPresentation } from '@/lib/job-safety-check';
import type { ActivityAnswers } from '@/lib/trade-activity-form-types';
import type { CreditexActivityWorkPackSignatureStroke } from '@/lib/creditex-activity-work-pack';
import { activityOptionLabel, activityRepeatCount, boundActivityDeclaration, expandedActivityFields, fieldConditionMet, removeLastActivityRepeat } from '@/lib/trade-activity-form-flow';
import { TradeWorkPackSignaturePad } from './TradeWorkPackSignaturePad';
import { useTradeBusiness, useTradeBusinessFetch } from './TradeBusinessProvider';
import styles from './TradeSafetyChecksPanel.module.css';

const endpoint = '/api/trade-safety-checks';
type Result = { ok: boolean; error?: string; record?: SafetyCheckPresentation; records?: SafetyCheckPresentation[]; canManage?: boolean };
const same = (left: ActivityAnswers, right: ActivityAnswers) => JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());

export function TradeSafetyChecksPanel({ user, workOrderId, readOnly = false, canManageDelivery = false, refreshKey = 0, onChanged }: {
  user: User; workOrderId: string; readOnly?: boolean; canManageDelivery?: boolean; refreshKey?: number; onChanged?: () => Promise<void>;
}) {
  const business = useTradeBusiness();
  return <SafetyChecks key={`${business?.ownerUid || user.uid}:${workOrderId}`} {...{user, workOrderId, readOnly, canManageDelivery, refreshKey, onChanged}} />;
}

function SafetyChecks({ user, workOrderId, readOnly, canManageDelivery, refreshKey, onChanged }: {
  user: User; workOrderId: string; readOnly: boolean; canManageDelivery: boolean; refreshKey: number; onChanged?: () => Promise<void>;
}) {
  const fetch = useTradeBusinessFetch();
  const [records, setRecords] = useState<SafetyCheckPresentation[]>([]);
  const [record, setRecord] = useState<SafetyCheckPresentation | null>(null);
  const [answers, setAnswers] = useState<ActivityAnswers>({});
  const [canManage, setCanManage] = useState(false), [busy, setBusy] = useState('load');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [section, setSection] = useState('');
  const [ink, setInk] = useState<Record<string, readonly CreditexActivityWorkPackSignatureStroke[]>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const current = useRef({ record, answers, busy });
  useLayoutEffect(() => { current.current = { record, answers, busy }; }, [record, answers, busy]);
  const receipt = useRef({ identity: '', key: '' });
  const request = useCallback(async (suffix: string, init?: RequestInit): Promise<Result> => {
    const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    const response = await fetch(`${endpoint}${suffix}`, { ...init, headers, cache: 'no-store' });
    const result: Result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'This safety check could not be loaded.');
    return result;
  }, [fetch, user]);
  useEffect(() => {
    const controller = new AbortController();
    void request(`?workOrderId=${encodeURIComponent(workOrderId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setRecords(result.records || []); setCanManage(Boolean(result.canManage)); setError(''); } })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The safety checks could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(''); });
    return () => controller.abort();
  }, [request, workOrderId, refreshKey]);
  const dirty = Boolean(record && !same(answers, record.answers));
  const writable = canManage && !readOnly && record?.status === 'draft' && !record.signatures.length;
  const signable = canManage && !readOnly && record?.status === 'draft';
  const fields = record ? expandedActivityFields(record.form, answers).filter(field => fieldConditionMet(field.condition, answers, record.form, field.repeatGroup, field.repeatIndex)) : [];
  const sections = [...new Set(fields.map(field => field.section))];

  function adopt(next: SafetyCheckPresentation) {
    setRecord(next); setAnswers(next.answers);
    setRecords(previous => [...previous.filter(item => item.id !== next.id), next]);
  }
  async function run(label: string, operation: () => Promise<void>) {
    if (current.current.busy) return;
    current.current.busy = label; setBusy(label); setError(''); setNotice('');
    try { await operation(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'The check could not be saved.'); }
    finally { current.current.busy = ''; setBusy(''); }
  }
  async function mutate(action: string, extra: Record<string, unknown> = {}, selected = current.current.record) {
    if (!selected) throw new Error('Open a safety check first.');
    const body = { action, recordId: selected.id, baseRevision: selected.revision, ...extra };
    const identity = JSON.stringify(body);
    if (receipt.current.identity !== identity) receipt.current = { identity, key: crypto.randomUUID() };
    const result = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, requestKey: receipt.current.key }) });
    if (!result.record || result.record.workOrderId !== workOrderId) throw new Error('The saved safety check could not be confirmed.');
    adopt(result.record); return result.record;
  }
  async function saved() {
    const selected = current.current.record;
    if (!selected) throw new Error('Open a safety check first.');
    return same(current.current.answers, selected.answers) ? selected : mutate('save', { answers: current.current.answers }, selected);
  }
  async function go(next: string) { if (writable) await saved(); setSection(next); }
  async function start(kind: SafetyCheckKind) {
    const result = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', workOrderId, kind }) });
    if (!result.record || result.record.workOrderId !== workOrderId) throw new Error('The new safety check could not be confirmed.');
    adopt(result.record); setSection(result.record.form.fields[0]?.section || 'Sign off');
    await onChanged?.();
  }
  async function open(next: SafetyCheckPresentation) {
    if (dirty) { await saved(); }
    const result = await request(`?recordId=${encodeURIComponent(next.id)}`);
    if (!result.record || result.record.workOrderId !== workOrderId) throw new Error('This safety check was not found on this job.');
    adopt(result.record); setSection(result.record.status === 'complete' ? 'Finish' : result.record.form.fields[0]?.section || 'Sign off'); setInk({}); setAccepted({});
  }
  async function upload(fieldKey: string, file: File) {
    const selected = await saved(), data = new FormData();
    data.set('action', 'upload'); data.set('recordId', selected.id); data.set('baseRevision', String(selected.revision));
    data.set('requestKey', crypto.randomUUID()); data.set('fieldKey', fieldKey); data.set('file', file);
    const result = await request('', { method: 'POST', body: data });
    if (!result.record) throw new Error('The evidence upload could not be confirmed.');
    adopt(result.record);
  }
  async function download(view: 'pdf' | 'evidence', evidenceId?: string) {
    if (!record) return;
    const response = await fetch(`${endpoint}?recordId=${encodeURIComponent(record.id)}&view=${view}${evidenceId ? `&evidenceId=${encodeURIComponent(evidenceId)}` : ''}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
    if (!response.ok) throw new Error('The saved file could not be downloaded.');
    const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = view === 'pdf' ? `${record.recordNumber}.pdf` : record.evidence.find(item => item.id === evidenceId)?.fileName || 'Evidence';
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return <section className={styles.panel} aria-label="Official safety checks">
    <header className={styles.heading}><div><span className={styles.eyebrow}>OFFICIAL FORMS · YOUR BUSINESS</span><h4>Electrical and gas safety checks</h4><p>{readOnly ? "Saved safety checks, signatures and evidence for this job." : "Fill the government form, sign it and send the PDF with its photo evidence."}</p></div></header>
    {readOnly && !records.length && !busy && <p>No safety checks have been added to this job.</p>}
    <div className={styles.choices}>{(['electrical', 'gas'] as const).map(kind => {
      const attached = records.find(item => item.kind === kind);
      if (readOnly && !attached) return null;
      return <button key={kind} type="button" disabled={Boolean(busy) || !attached && (!canManage || readOnly)} onClick={() => void run(kind, () => attached ? open(attached) : start(kind))}>
        <strong>{kind === 'electrical' ? 'Electrical safety check' : 'Gas safety check'}</strong><span>{attached ? `${attached.status === 'complete' ? 'Completed PDF' : 'Continue form'} · ${attached.recordNumber}` : 'Add official form to this job'}</span>
      </button>;
    })}</div>
    {record && <div className={styles.form}>
      <header><h5>{record.form.title}</h5><span>{record.recordNumber} · {record.status === 'complete' ? 'Completed' : dirty ? 'Unsaved answers' : 'Saved'}</span></header>
      <nav className={styles.navigation} aria-label="Safety check sections">{[...sections, 'Sign off', 'Finish'].map(name => <button key={name} type="button" aria-current={section === name ? 'step' : undefined} disabled={Boolean(busy)} onClick={() => void run('section', () => go(name))}>{name}</button>)}</nav>
      {[...new Set(fields.filter(field => field.section === section && field.repeatGroup).map(field => field.repeatGroup!))].map(group => <div className={styles.navigation} key={group}><span>{activityRepeatCount(record.form, answers, group)} {group.replaceAll('_', ' ')} recorded</span><button type="button" disabled={!writable || Boolean(busy) || activityRepeatCount(record.form, answers, group) >= 20} onClick={() => setAnswers(previous => ({ ...previous, [`$repeat.${group}`]: activityRepeatCount(record.form, previous, group) + 1 }))}>Add another</button><button type="button" disabled={!writable || Boolean(busy) || activityRepeatCount(record.form, answers, group) <= 1} onClick={() => setAnswers(previous => removeLastActivityRepeat(record.form, previous, group))}>Remove last</button></div>)}
      {fields.filter(field => field.section === section).map(field => <div className={styles.field} key={field.key}>
        <label htmlFor={`safety-${record.id}-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>
        {field.type === 'photo' || field.type === 'document' ? <><input id={`safety-${record.id}-${field.key}`} type="file" accept={field.type === 'photo' ? 'image/jpeg,image/png' : 'application/pdf'} disabled={!writable || Boolean(busy)} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run('upload', () => upload(field.key, file)); }} />{record.evidence.filter(item => item.fieldKey === field.key).map(item => <button key={item.id} type="button" disabled={Boolean(busy)} onClick={() => void run('download', () => download('evidence', item.id))}>{item.fileName}</button>)}</>
          : field.type === 'boolean' || field.type === 'select' ? <select id={`safety-${record.id}-${field.key}`} disabled={!writable || Boolean(busy)} value={String(answers[field.key] ?? '')} onChange={event => setAnswers(previous => ({ ...previous, [field.key]: field.type === 'boolean' && event.target.value !== '' ? event.target.value === 'true' : event.target.value }))}><option value="">Choose an answer</option>{(field.type === 'boolean' ? ['true', 'false'] : field.options).map(value => <option key={value} value={value}>{field.type === 'boolean' ? value === 'true' ? 'Yes' : 'No' : activityOptionLabel(value, field.optionLabels?.[value])}</option>)}</select>
            : <input id={`safety-${record.id}-${field.key}`} type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} disabled={!writable || Boolean(busy)} value={String(answers[field.key] ?? '')} onChange={event => setAnswers(previous => ({ ...previous, [field.key]: field.type === 'number' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value }))} />}
        {field.help && <p>{field.help}</p>}
      </div>)}
      {section === 'Sign off' && record.form.declarations.filter(declaration => !declaration.condition || fieldConditionMet(declaration.condition, answers, record.form)).map(declaration => {
        const signature = record.signatures.find(item => item.declarationKey === declaration.key), name = String(answers[record.signerFields[declaration.key]] || '');
        return <div className={styles.declaration} key={declaration.key}><h5>{declaration.title}</h5><p>{boundActivityDeclaration(declaration, answers)}</p>{signature ? <p>Signed by {signature.signerName} · {signature.signedAt}</p> : <><label><input type="checkbox" checked={Boolean(accepted[declaration.key])} disabled={!signable || Boolean(busy) || dirty} onChange={event => setAccepted(previous => ({ ...previous, [declaration.key]: event.target.checked }))} /> I am the named signer and agree to this declaration.</label><TradeWorkPackSignaturePad label="Draw your signature" signerName={name} signerCapacity={declaration.title} value={ink[declaration.key] || []} disabled={!signable || Boolean(busy) || dirty || !accepted[declaration.key] || !name} onChange={value => setInk(previous => ({ ...previous, [declaration.key]: value }))} /><button type="button" disabled={!canManage || readOnly || Boolean(busy) || dirty || !accepted[declaration.key] || !(ink[declaration.key]?.length) || record.missing.some(item => item.kind !== 'signature')} onClick={() => void run('sign', async () => { await mutate('sign', { declarationKey: declaration.key, signerName: name, accepted: true, scopeSha256: record.signingScopes[declaration.phase], strokes: ink[declaration.key].map(stroke => ({ points: stroke.points.map(point => ({ x: point.x, y: point.y })) })) }); setInk(previous => ({ ...previous, [declaration.key]: [] })); })}>Save signature</button></>}</div>;
      })}
      {section === 'Finish' && <div className={styles.finish}>{record.status === 'draft' ? <><h5>Finish and send your records</h5><p>Completing this check saves its final PDF and automatically emails the customer and business copies with the required evidence attachments.</p>{record.missing.length > 0 && <ul>{record.missing.map(item => <li key={item.key}>{item.label}</li>)}</ul>}<button type="button" disabled={!canManage || readOnly || Boolean(busy) || dirty || !record.ready} onClick={() => void run('complete', async () => { await mutate('complete'); await onChanged?.(); })}>Complete check and email PDF</button></> : <><h5>Your completed record is saved</h5><button type="button" disabled={Boolean(busy)} onClick={() => void run('download', () => download('pdf'))}>Download completed PDF</button>{record.delivery.map(delivery => <p key={delivery.role}><strong>{delivery.role === 'customer' ? 'Customer copy' : 'Business copy'}</strong> · {delivery.message}</p>)}{canManage && (!readOnly || canManageDelivery) && <><button type="button" disabled={Boolean(busy)} onClick={() => void run('delivery', async () => { await mutate('retry_delivery'); })}>Check or retry email delivery</button><button type="button" disabled={Boolean(busy)} onClick={() => void run('progress', async () => { await mutate('recover_progress'); await onChanged?.(); })}>Refresh job completion</button></>}</>}{record.jobProgress?.blockers.map(blocker => <p key={blocker.key}>{blocker.label}</p>)}</div>}
      {writable && <button type="button" disabled={Boolean(busy) || !dirty} onClick={() => void run('save', async () => { await saved(); setNotice('Answers saved.'); })}>Save answers</button>}
    </div>}
    {notice && <p role="status">{notice}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
