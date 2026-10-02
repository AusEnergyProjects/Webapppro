"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { ActivityForm } from '@/lib/trade-activity-form-types';
import { useTradeBusiness, useTradeBusinessFetch } from './TradeBusinessProvider';
import { TradeBusinessFormEditor, type RegisterFormLeave } from './TradeBusinessFormEditor';
import { CreditexFormPhonePreview } from './CreditexFormPhonePreview';
import { TlinkFormMindMap } from './TlinkFormMindMap';
import styles from './TradeFormsWorkspace.module.css';
type CatalogueItem = { activityTemplateId: string; title: string; programCode: string; activityCode: string };
export function TradeFormsWorkspace({ user, onRegisterLeave }: { user: User; onRegisterLeave?: RegisterFormLeave }) {
  const business = useTradeBusiness();
  return <FormsWorkspace key={`${user.uid}:${business?.ownerUid || ''}:${business?.memberId || ''}`} user={user} onRegisterLeave={onRegisterLeave} />;
}
function FormsWorkspace({ user, onRegisterLeave }: { user: User; onRegisterLeave?: RegisterFormLeave }) {
  const [tab, setTab] = useState<'compliance' | 'business'>('business');
  const leave = useRef<(() => Promise<unknown>) | null>(null);
  const register = useCallback<RegisterFormLeave>(check => { leave.current = check; onRegisterLeave?.(check); }, [onRegisterLeave]);
  async function open(next: typeof tab) { if (next === tab) return; try { await leave.current?.(); setTab(next); } catch { /* The editor keeps the unsaved draft open. */ } }
  return <section className={styles.workspace} aria-label="Forms"><header><span>BUSINESS TOOLS</span><h1>Forms</h1><p>Design your team&apos;s forms and explore Creditex compliance forms.</p></header><div className={styles.tabs} role="tablist" aria-label="Form libraries"><button role="tab" type="button" aria-selected={tab === 'compliance'} onClick={() => void open('compliance')}>Creditex compliance forms</button><button role="tab" type="button" aria-selected={tab === 'business'} onClick={() => void open('business')}>Forms</button></div>{tab === 'business' ? <TradeBusinessFormEditor user={user} onRegisterLeave={register} /> : <ComplianceForms user={user} />}</section>;
}
function ComplianceForms({ user }: { user: User }) {
  const fetch = useTradeBusinessFetch(); const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [form, setForm] = useState<ActivityForm | null>(null), [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<'preview' | 'map'>('preview'), [selected, setSelected] = useState('');
  const sequence = useRef(0);
  const request = useCallback(async (path: string) => { const response = await fetch(path, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not load forms.'); return result; }, [fetch, user]);
  useEffect(() => { let active = true; void request('/api/trade-form-catalogue').then(result => { if (active) setCatalogue(result.catalogue); }).catch(caught => { if (active) setError(caught.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [request]);
  async function open(id: string, variant = '') { const current = ++sequence.current; setBusy(true); setError(''); try { const result = await request(`/api/trade-form-catalogue?activityTemplateId=${encodeURIComponent(id)}&variantId=${encodeURIComponent(variant)}`); if (current === sequence.current) { setForm(result.form); setSelected(''); } } catch (caught) { if (current === sequence.current) setError(caught instanceof Error ? caught.message : 'Could not open this form.'); } finally { if (current === sequence.current) setBusy(false); } }
  const noChange = () => {};
  return <section className={styles.library}><p>Official forms are managed by Creditex. Explore the form or mind map for team training. Preview answers are not saved and do not complete required training.</p>{error && <p role="alert">{error}</p>}{busy && <p role="status">Loading compliance forms...</p>}{form ? <><div className={styles.toolbar}><button type="button" onClick={() => { sequence.current++; setForm(null); setBusy(false); }}>All compliance forms</button><h2>{form.title}</h2><span>Version {form.version} · View only</span></div>{form.variantOptions.length > 1 && <label>Activity option<select disabled={busy} value={form.variantId} onChange={event => void open(form.activityTemplateId, event.target.value)}>{form.variantOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}<div className={styles.tabs}><button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Try the form</button><button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>TLink mind map</button></div>{mode === 'preview' ? <CreditexFormPhonePreview key={`${form.id}:${form.version}:${form.variantId}`} form={form} canEdit={false} /> : <TlinkFormMindMap form={form} editable={false} selectedKey={selected} onSelect={setSelected} onEdit={noChange} onCondition={() => false} onAddPage={noChange} onAddQuestion={noChange} onMoveQuestion={noChange} onDropQuestion={() => false} editor={null} onCloseEditor={noChange} onRenamePage={noChange} onDelete={noChange} />}</> : <><label>Find a compliance form<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search activity or form name" /></label><div className={styles.cards}>{catalogue.filter(item => `${item.title} ${item.activityCode} ${item.programCode}`.toLowerCase().includes(query.toLowerCase())).map(item => <article key={item.activityTemplateId}><span>{item.programCode} · {item.activityCode}</span><h3>{item.title}</h3><button type="button" disabled={busy} onClick={() => void open(item.activityTemplateId)}>Explore form</button></article>)}</div></>}</section>;
}
