"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { SALES_STAGE_LIMIT, type SalesConfig, type SalesItem, type SalesList, type SalesStage, type SalesStageUpdate, type SalesUpdate } from '@/lib/trade-sales';
import { useTradeBusiness, useTradeBusinessFetch } from './TradeBusinessProvider';
import styles from './TradeSalesWorkspace.module.css';

export type SuppliedSalesLead = { id: string; title: string; detail?: string };
export type TradeSalesWorkspaceProps = {
  user: User;
  onOpenJob: (id: string, tab?: 'summary' | 'quote') => void;
  onNewQuote?: () => void;
  suppliedLeads?: readonly SuppliedSalesLead[];
  suppliedLeadsLoading?: boolean;
  suppliedLeadsError?: string;
  onReviewSuppliedLeads?: () => void;
  onRegisterLeave?: (check: (() => Promise<unknown>) | null) => void;
};
type Reply<T> = T & { ok: boolean; error?: string; code?: string };
type Page = { items: SalesItem[]; total: number; hasNext: boolean; nextCursor: string; loading: boolean; error: string };
type Filters = { search: string; owner: string; needsAction: boolean; status: 'open' | 'won' | 'lost' | 'all' };
type Draft = { stageId: string; ownerMemberId: string; value: string; expectedCloseOn: string; lastContactOn: string; nextAction: string; nextActionOn: string };
type Edit = { scope: string; item: SalesItem; draft: Draft; initial: string; error: string; conflict: boolean };
type StageEdit = { scope: string; revision: number; stages: SalesStage[]; initial: string; error: string; conflict: boolean };
const emptyPage = (): Page => ({ items: [], total: 0, hasNext: false, nextCursor: '', loading: true, error: '' });
const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value / 100);
const dayLabel = (value: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const localDay = (value: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const today = () => localDay(new Date());
const toDraft = (item: SalesItem): Draft => ({ stageId: item.stageId, ownerMemberId: item.ownerMemberId, value: !item.estimatedValueCents ? '' : (item.estimatedValueCents / 100).toFixed(2), expectedCloseOn: item.expectedCloseOn, lastContactOn: item.lastContactOn, nextAction: item.nextAction, nextActionOn: item.nextActionOn });
class RequestFailure extends Error {
  constructor(message: string, readonly conflict = false) { super(message); }
}

export function TradeSalesWorkspace({ user, onOpenJob, onNewQuote, suppliedLeads = [], suppliedLeadsLoading = false, suppliedLeadsError = '', onReviewSuppliedLeads, onRegisterLeave }: TradeSalesWorkspaceProps) {
  const fetch = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const identity = JSON.stringify([user.uid, business?.ownerUid, business?.memberId, business?.role]);
  const scope = useMemo(() => `${identity}:${crypto.randomUUID()}`, [identity]);
  const lifecycle = useMemo(() => ({ scope, active: true, saving: false, controllers: new Set<AbortController>() }), [scope]);
  const [configState, setConfig] = useState<{ scope: string; data: SalesConfig } | null>(null);
  const [configError, setConfigError] = useState<{ scope: string; message: string } | null>(null);
  const [configRefresh, setConfigRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>({ search: '', owner: '', needsAction: false, status: 'open' });
  const [mode, setMode] = useState<'board' | 'list'>('board');
  const [refresh, setRefresh] = useState(0);
  const [pages, setPages] = useState<{ key: string; value: Record<string, Page> }>({ key: '', value: {} });
  const [editing, setEditing] = useState<Edit | null>(null);
  const [stageEditing, setStageEditing] = useState<StageEdit | null>(null);
  const [busyState, setBusy] = useState<{ scope: string; id: string } | null>(null);
  const [message, setMessage] = useState<{ scope: string; text: string; error: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const config = configState?.scope === scope ? configState.data : null;
  const edit = editing?.scope === scope ? editing : null;
  const stageEdit = stageEditing?.scope === scope ? stageEditing : null;
  const busy = busyState?.scope === scope ? busyState.id : '';
  const dirty = Boolean(edit && JSON.stringify(edit.draft) !== edit.initial || stageEdit && JSON.stringify(stageEdit.stages) !== stageEdit.initial);
  const configFailure = configError?.scope === scope ? configError.message : '';
  const columns = useMemo(() => config ? [
    ...(filters.status === 'open' || filters.status === 'all' ? config.settings.stages : []),
    ...(filters.status === 'won' || filters.status === 'all' ? [{ id: 'won', name: 'Won' }] : []),
    ...(filters.status === 'lost' || filters.status === 'all' ? [{ id: 'lost', name: 'Lost' }] : []),
  ] : [], [config, filters.status]);
  const requestKey = JSON.stringify([scope, filters, mode, refresh, config?.settings]);
  const currentPages = pages.key === requestKey ? pages.value : {};

  useEffect(() => { lifecycle.active = true; return () => { lifecycle.active = false; for (const controller of lifecycle.controllers) controller.abort(); }; }, [lifecycle]);

  const request = useCallback(async <T,>(path: string, controller: AbortController, body?: SalesUpdate | SalesStageUpdate): Promise<Reply<T>> => {
    const token = await user.getIdToken();
    if (controller.signal.aborted || !lifecycle.active) throw new DOMException('Request cancelled', 'AbortError');
    const response = await fetch(path, { method: body ? 'PATCH' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store', signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result: Reply<T> = await response.json();
    if (!response.ok || !result.ok) throw new RequestFailure(result.error || 'Sales could not be loaded. Try again.', response.status === 409 || result.code === 'REVISION_CONFLICT');
    return result;
  }, [fetch, user, lifecycle]);

  useEffect(() => {
    const controller = new AbortController(); lifecycle.controllers.add(controller);
    const timer = setTimeout(() => { controller.abort(); if (lifecycle.active) setConfigError({ scope, message: 'Sales took too long to load. Try again.' }); }, 25000);
    void request<SalesConfig>('/api/trade-sales?mode=config', controller).then(result => {
      if (!result.settings || !Array.isArray(result.settings.stages) || !Array.isArray(result.owners) || !result.permissions) throw new Error('Sales settings could not be loaded. Try again.');
      if (!controller.signal.aborted && lifecycle.active) { setConfig({ scope, data: result }); setConfigError(null); }
    }).catch(error => { if (!controller.signal.aborted && lifecycle.active) setConfigError({ scope, message: error instanceof Error ? error.message : 'Sales could not be loaded.' }); }).finally(() => { clearTimeout(timer); lifecycle.controllers.delete(controller); });
    return () => { controller.abort(); clearTimeout(timer); lifecycle.controllers.delete(controller); };
  }, [request, scope, lifecycle, configRefresh]);

  const loadPage = useCallback(async (column: string, cursor: string, controller: AbortController): Promise<Page> => {
    const params = new URLSearchParams({ mode: 'list', status: filters.status, pageSize: '25' });
    if (column !== 'list') params.set('stage', column);
    if (filters.search) params.set('search', filters.search);
    if (filters.owner) params.set('owner', filters.owner);
    if (filters.needsAction) params.set('needsNextAction', '1');
    if (cursor) params.set('cursor', cursor);
    const result = await request<SalesList>(`/api/trade-sales?${params}`, controller);
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || (result.hasNext && (!result.nextCursor || result.nextCursor === cursor))) throw new Error('The sales list could not be loaded. Try again.');
    return { items: result.items, total: result.total, hasNext: result.hasNext, nextCursor: result.nextCursor, loading: false, error: '' };
  }, [filters, request]);

  useEffect(() => {
    if (!config || configFailure) return;
    let active = true;
    const controller = new AbortController(); lifecycle.controllers.add(controller);
    const keys = mode === 'list' ? ['list'] : columns.map(column => column.id);
    const timer = setTimeout(() => {
      controller.abort();
      if (active && lifecycle.active) setPages(current => ({ key: requestKey, value: Object.fromEntries(keys.map(key => {
        const page = (current.key === requestKey ? current.value[key] : undefined) ?? emptyPage();
        return [key, page.loading ? { ...page, loading: false, error: 'Sales took too long to load. Try again.' } : page];
      })) }));
    }, 25000);
    void Promise.all(keys.map(async key => {
      try {
        const page = await loadPage(key, '', controller);
        if (active && lifecycle.active && !controller.signal.aborted) setPages(current => ({ key: requestKey, value: { ...(current.key === requestKey ? current.value : {}), [key]: page } }));
      } catch (failure) {
        if (active && lifecycle.active && !controller.signal.aborted) setPages(current => ({ key: requestKey, value: { ...(current.key === requestKey ? current.value : {}), [key]: { ...emptyPage(), loading: false, error: failure instanceof Error ? failure.message : 'Sales could not be loaded.' } } }));
      }
    })).finally(() => { clearTimeout(timer); lifecycle.controllers.delete(controller); });
    return () => { active = false; controller.abort(); clearTimeout(timer); lifecycle.controllers.delete(controller); };
  }, [config, configFailure, columns, lifecycle, loadPage, mode, requestKey]);

  const canLeave = useCallback(async () => {
    if (busy) throw new Error('Wait for your sales changes to save.');
    if (dirty && !window.confirm('Discard unsaved sales changes?')) throw new Error('Keep editing');
  }, [busy, dirty]);
  useEffect(() => { onRegisterLeave?.(canLeave); return () => onRegisterLeave?.(null); }, [canLeave, onRegisterLeave]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  const dialogOpen = Boolean(edit || stageEdit);
  useEffect(() => {
    if (!dialogOpen) return;
    const element = dialog.current; const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, [dialogOpen]);

  async function more(column: string) {
    const page = currentPages[column]; if (!page || page.loading || !page.hasNext) return;
    const controller = new AbortController(); lifecycle.controllers.add(controller);
    setPages(current => current.key === requestKey ? { ...current, value: { ...current.value, [column]: { ...page, loading: true, error: '' } } } : current);
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const next = await loadPage(column, page.nextCursor, controller);
      if (lifecycle.active && !controller.signal.aborted) setPages(current => current.key !== requestKey ? current : { ...current, value: { ...current.value, [column]: { ...next, items: [...page.items, ...next.items.filter(item => !page.items.some(previous => previous.id === item.id))] } } });
    } catch (failure) {
      if (lifecycle.active) setPages(current => current.key !== requestKey ? current : { ...current, value: { ...current.value, [column]: { ...page, loading: false, error: controller.signal.aborted ? 'More sales took too long to load. Try again.' : failure instanceof Error ? failure.message : 'More sales could not be loaded.' } } });
    } finally { clearTimeout(timer); lifecycle.controllers.delete(controller); }
  }

  async function mutate(body: SalesUpdate | SalesStageUpdate, id: string) {
    if (lifecycle.saving || !config) return false;
    lifecycle.saving = true; setBusy({ scope, id }); setMessage(null);
    const controller = new AbortController(); lifecycle.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      await request('/api/trade-sales', controller, body);
      if (!lifecycle.active || controller.signal.aborted) return false;
      setMessage({ scope, text: body.action === 'save_stages' ? 'Sales stages saved.' : 'Sales details saved.', error: false });
      if (body.action === 'save_stages') setConfigRefresh(value => value + 1);
      else setRefresh(value => value + 1);
      return true;
    } catch (failure) {
      if (!lifecycle.active) return false;
      const conflict = controller.signal.aborted || failure instanceof RequestFailure && failure.conflict;
      const text = controller.signal.aborted ? 'The save could not be confirmed. Refresh the saved record before trying again.' : conflict ? 'This record changed since you opened it. Refresh the saved record before making your changes again.' : failure instanceof Error ? failure.message : 'Sales changes could not be saved.';
      setMessage({ scope, text, error: true });
      if (body.action === 'save_stages') setStageEditing(current => current?.scope === scope ? { ...current, error: text, conflict } : current);
      else setEditing(current => current?.scope === scope && current.item.id === body.workOrderId ? { ...current, error: text, conflict } : current);
      return false;
    } finally { clearTimeout(timer); lifecycle.controllers.delete(controller); lifecycle.saving = false; if (lifecycle.active) setBusy(null); }
  }

  function openEdit(item: SalesItem) { const draft = toDraft(item); setMessage(null); setEditing({ scope, item, draft, initial: JSON.stringify(draft), error: '', conflict: false }); }
  function changeDraft(patch: Partial<Draft>) { setEditing(current => current?.scope === scope ? { ...current, draft: { ...current.draft, ...patch }, error: '' } : current); }
  function closeDialog() { void canLeave().then(() => { setEditing(null); setStageEditing(null); }).catch(() => {}); }
  function refreshSaved() { void canLeave().then(() => { setEditing(null); setStageEditing(null); setRefresh(value => value + 1); setConfigRefresh(value => value + 1); }).catch(() => {}); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!edit || edit.conflict || busy) return;
    const draft = edit.draft;
    const body: SalesUpdate = { action: 'update', workOrderId: edit.item.id, expectedRevision: edit.item.revision, expectedJobRevision: edit.item.jobRevision, stageId: draft.stageId, ownerMemberId: draft.ownerMemberId, expectedCloseOn: draft.expectedCloseOn, lastContactOn: draft.lastContactOn, nextAction: draft.nextAction, nextActionOn: draft.nextActionOn };
    if (edit.item.canEditValue && draft.value !== toDraft(edit.item).value) {
      if (draft.value && !/^\d+(?:\.\d{1,2})?$/.test(draft.value)) { setEditing({ ...edit, error: 'Enter an estimated value with up to two decimal places.', conflict: false }); return; }
      body.estimatedValueCents = Math.round(Number(draft.value) * 100);
    }
    if (await mutate(body, edit.item.id)) setEditing(null);
  }
  async function move(item: SalesItem, stageId: string) { if (stageId !== item.stageId) await mutate({ action: 'update', workOrderId: item.id, expectedRevision: item.revision, expectedJobRevision: item.jobRevision, stageId }, item.id); }
  async function saveStages(event: FormEvent) { event.preventDefault(); if (stageEdit && !stageEdit.conflict && await mutate({ action: 'save_stages', expectedRevision: stageEdit.revision, stages: stageEdit.stages }, 'stages')) setStageEditing(null); }
  function reorder(index: number, direction: number) { if (!stageEdit) return; const stages = [...stageEdit.stages]; [stages[index], stages[index + direction]] = [stages[index + direction], stages[index]]; setStageEditing({ ...stageEdit, stages, error: '' }); }
  function searchSubmit(event: FormEvent) { event.preventDefault(); setFilters(current => ({ ...current, search: search.trim() })); }
  function openJob(item: SalesItem, tab: 'summary' | 'quote') { void canLeave().then(() => onOpenJob(item.id, tab)).catch(() => {}); }

  function card(item: SalesItem) {
    const overdue = Boolean(item.nextActionOn && item.nextActionOn < today() && item.status === 'open');
    return <article className={styles.card} key={item.id} role="listitem">
      <div className={styles.cardTitle}><span>{item.workNumber}</span><h4>{item.title}</h4><p>{item.customerProtected ? 'Customer details protected' : item.customerName || 'Customer not added'}</p></div>
      <dl><div><dt>Owner</dt><dd>{item.ownerName || 'Unassigned'}</dd></div><div><dt>Estimated value excl GST</dt><dd>{!config?.permissions.canViewValues || item.estimatedValueCents === null ? 'Value protected' : item.estimatedValueCents === 0 ? 'Not estimated' : money(item.estimatedValueCents)}</dd></div><div><dt>Expected close</dt><dd>{item.expectedCloseOn ? dayLabel(item.expectedCloseOn) : 'Not set'}</dd></div><div><dt>Last recorded contact</dt><dd>{item.lastContactOn ? dayLabel(item.lastContactOn) : 'No contact recorded'}</dd></div><div className={styles.nextAction}><dt>Next action</dt><dd>{item.nextAction || 'Not set'}<small className={overdue ? styles.overdue : ''}>{item.nextActionOn ? `${overdue ? 'Overdue: ' : 'Due '}${dayLabel(item.nextActionOn)}` : 'No date set'}</small></dd></div></dl>
      {item.canEdit && config && <label className={styles.stageControl}>Stage<select aria-label={`Stage for ${item.workNumber}`} value={item.stageId} disabled={Boolean(busy)} onChange={event => void move(item, event.target.value)}>{config.settings.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>}
      {!item.canEdit && <p className={styles.outcome}>{item.stageName}{item.status !== 'open' ? ' · Recorded outcome' : ''}</p>}
      <div className={styles.cardActions}><button type="button" onClick={() => openJob(item, 'summary')}>Open job</button><button type="button" onClick={() => openJob(item, 'quote')}>Open quote</button>{item.canEdit && <button type="button" disabled={Boolean(busy)} onClick={() => openEdit(item)}>Edit sales details</button>}</div>
    </article>;
  }
  function pageContent(key: string, label: string) {
    const page = currentPages[key];
    if (!page) return <p className={styles.state} role="status">Loading {label.toLowerCase()}...</p>;
    if (page.error && !page.items.length) return <div className={styles.state} role="alert"><p>{page.error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>;
    return <><div className={mode === 'list' ? styles.list : styles.cards} role="list" aria-label={label}>{page.items.map(card)}</div>{!page.items.length && !page.loading && !page.error && <p className={styles.state}>No opportunities match this view.</p>}{page.error && <p className={styles.error} role="alert">{page.error}</p>}{page.loading && <p role="status">Loading more sales...</p>}{page.hasNext && <button className={styles.loadMore} type="button" disabled={page.loading || Boolean(busy)} onClick={() => void more(key)}>Load more {label.toLowerCase()} ({page.items.length} of {page.total})</button>}{!page.hasNext && page.items.length > 0 && <p className={styles.range}>{page.items.length} of {page.total} shown</p>}</>;
  }

  return <section className={styles.workspace} aria-label="Sales">
    <header className={styles.heading}><div><span>Sales</span><h2>Keep every opportunity moving</h2><p>Track your existing jobs, follow-ups and expected sales.</p></div><div className={styles.actions}>{onNewQuote && config?.permissions.canManage && <button className={styles.primary} type="button" onClick={onNewQuote}>New quote</button>}{config?.permissions.canConfigure && <button type="button" disabled={Boolean(busy)} onClick={() => { const stages = config.settings.stages.map(stage => ({ ...stage })); setStageEditing({ scope, revision: config.settings.revision, stages, initial: JSON.stringify(stages), error: '', conflict: false }); }}>Manage stages</button>}<button type="button" disabled={Boolean(busy)} onClick={() => { setRefresh(value => value + 1); setConfigRefresh(value => value + 1); }}>Refresh</button></div></header>
    {onReviewSuppliedLeads && <aside className={styles.supplied}><div><strong>Supplied leads</strong><p>Review enquiries supplied to your business before starting a quote.</p>{suppliedLeadsLoading ? <p role="status">Loading supplied leads...</p> : suppliedLeadsError ? <p role="alert" className={styles.error}>{suppliedLeadsError}</p> : suppliedLeads.length > 0 ? <ul>{suppliedLeads.map(lead => <li key={lead.id}><strong>{lead.title}</strong>{lead.detail && <span>{lead.detail}</span>}</li>)}</ul> : <p>No supplied leads awaiting review.</p>}</div><button type="button" onClick={onReviewSuppliedLeads}>Review supplied leads</button></aside>}
    <form className={styles.filters} onSubmit={searchSubmit}><label className={styles.search}>Find an opportunity<input type="search" value={search} maxLength={100} placeholder="Job number, title or customer" onChange={event => setSearch(event.target.value)} /></label><button type="submit">Search</button><label>Owner<select value={filters.owner} onChange={event => setFilters(current => ({ ...current, owner: event.target.value }))}><option value="">All owners</option><option value="unassigned">Unassigned</option>{config?.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label><label>Show<select value={filters.status} onChange={event => { const status = event.target.value; if (status === 'open' || status === 'won' || status === 'lost' || status === 'all') setFilters(current => ({ ...current, status })); }}><option value="open">Open opportunities</option><option value="won">Won</option><option value="lost">Lost</option><option value="all">All outcomes</option></select></label><label className={styles.check}><input type="checkbox" checked={filters.needsAction} onChange={event => setFilters(current => ({ ...current, needsAction: event.target.checked }))} />Needs next action</label>{(filters.search || filters.owner || filters.needsAction) && <button type="button" onClick={() => { setSearch(''); setFilters(current => ({ ...current, search: '', owner: '', needsAction: false })); }}>Clear filters</button>}</form>
    <div className={styles.viewBar}><div role="group" aria-label="Sales view"><button type="button" aria-pressed={mode === 'board'} onClick={() => setMode('board')}>Board</button><button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>List</button></div><p>Won and Lost follow the job&apos;s recorded outcome.</p></div>
    {message?.scope === scope && !edit && !stageEdit && <p className={message.error ? styles.error : styles.notice} role={message.error ? 'alert' : 'status'}>{message.text}{message.error && <button type="button" onClick={refreshSaved}>Refresh saved records</button>}</p>}
    {configFailure ? <div className={styles.state} role="alert"><p>{configFailure}</p><button type="button" onClick={() => { setConfigError(null); setConfigRefresh(value => value + 1); }}>Try again</button></div> : !config ? <p role="status">Loading sales...</p> : mode === 'list' ? pageContent('list', 'Opportunities') : <div className={styles.board} aria-label="Sales stages">{columns.map(column => <section className={styles.column} key={column.id} aria-label={column.name}><header><h3>{column.name}</h3><span>{currentPages[column.id] && !currentPages[column.id].error ? currentPages[column.id].total : '...'}</span></header>{pageContent(column.id, column.name)}</section>)}</div>}
    {dialogOpen && <dialog ref={dialog} className={styles.dialog} aria-labelledby="sales-dialog-title" onCancel={event => { event.preventDefault(); closeDialog(); }}><header><h2 id="sales-dialog-title">{edit ? `Sales details: ${edit.item.workNumber}` : 'Sales stages'}</h2><button type="button" disabled={Boolean(busy)} onClick={closeDialog}>Close</button></header>{edit && config && <form onSubmit={event => void save(event)}><fieldset disabled={Boolean(busy) || edit.conflict} className={styles.editFields}><label>Stage<select value={edit.draft.stageId} onChange={event => changeDraft({ stageId: event.target.value })}>{config.settings.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label>Owner<select value={edit.draft.ownerMemberId} onChange={event => changeDraft({ ownerMemberId: event.target.value })}><option value="">Unassigned</option>{config.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>{edit.item.canEditValue ? <label>Estimated value excl GST (AUD)<input autoFocus type="number" min="0" step="0.01" value={edit.draft.value} onChange={event => changeDraft({ value: event.target.value })} /><small>Leave blank to clear the estimate.</small></label> : <p>{config.permissions.canViewValues ? 'Estimated value is read only.' : 'Value protected'}</p>}<label>Expected close<input type="date" value={edit.draft.expectedCloseOn} onChange={event => changeDraft({ expectedCloseOn: event.target.value })} /></label><label>Last recorded contact<input type="date" max={today()} value={edit.draft.lastContactOn} onChange={event => changeDraft({ lastContactOn: event.target.value })} /><small>Only record a customer contact that happened.</small></label><label>Next action date<input type="date" value={edit.draft.nextActionOn} onChange={event => changeDraft({ nextActionOn: event.target.value })} /></label><label className={styles.wide}>Next action<input maxLength={200} value={edit.draft.nextAction} onChange={event => changeDraft({ nextAction: event.target.value })} placeholder="e.g. Call to confirm the site visit" /></label></fieldset>{edit.error && <p className={styles.error} role="alert">{edit.error}</p>}<footer><button type="button" disabled={Boolean(busy)} onClick={closeDialog}>Cancel</button>{edit.conflict ? <button type="button" disabled={Boolean(busy)} onClick={refreshSaved}>Refresh saved record</button> : <button className={styles.primary} type="submit" disabled={Boolean(busy) || !dirty}>{busy ? 'Saving...' : 'Save sales details'}</button>}</footer></form>}{stageEdit && <form onSubmit={event => void saveStages(event)}><p>Rename, add or reorder the open stages. Won and Lost come from recorded outcomes.</p><fieldset disabled={Boolean(busy) || stageEdit.conflict} className={styles.stageFields}>{stageEdit.stages.map((stage, index) => <div key={stage.id}><label>Stage {index + 1}<input autoFocus={index === 0} maxLength={60} required value={stage.name} onChange={event => setStageEditing({ ...stageEdit, stages: stageEdit.stages.map(item => item.id === stage.id ? { ...item, name: event.target.value } : item), error: '' })} /></label><button type="button" aria-label={`Move ${stage.name} up`} disabled={index === 0} onClick={() => reorder(index, -1)}>Up</button><button type="button" aria-label={`Move ${stage.name} down`} disabled={index === stageEdit.stages.length - 1} onClick={() => reorder(index, 1)}>Down</button></div>)}<button type="button" disabled={stageEdit.stages.length >= SALES_STAGE_LIMIT} onClick={() => setStageEditing({ ...stageEdit, stages: [...stageEdit.stages, { id: crypto.randomUUID(), name: '' }], error: '' })}>Add stage</button></fieldset>{stageEdit.error && <p className={styles.error} role="alert">{stageEdit.error}</p>}<footer><button type="button" disabled={Boolean(busy)} onClick={closeDialog}>Cancel</button>{stageEdit.conflict ? <button type="button" onClick={refreshSaved}>Refresh saved stages</button> : <button className={styles.primary} type="submit" disabled={Boolean(busy) || !dirty}>{busy ? 'Saving...' : 'Save stages'}</button>}</footer></form>}</dialog>}
  </section>;
}
