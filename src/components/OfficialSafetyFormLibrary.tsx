"use client";
import type { User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import type { ActivityForm } from '@/lib/trade-activity-form-types';
import { CreditexFormPhonePreview } from './CreditexFormPhonePreview';
import { useTradeBusinessFetch } from './TradeBusinessProvider';
import styles from './TradeSafetyChecksPanel.module.css';

export function OfficialSafetyFormLibrary({ user }: { user: User }) {
  const fetch = useTradeBusinessFetch(), [forms, setForms] = useState<ActivityForm[]>([]);
  const [selected, setSelected] = useState<ActivityForm | null>(null), [error, setError] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch('/api/trade-safety-checks?view=catalogue', {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store', signal,
    });
    const result: { forms?: ActivityForm[]; error?: string } = await response.json();
    if (!response.ok || !result.forms) throw new Error(result.error || 'The official form library could not be loaded.');
    return result.forms;
  }, [fetch, user]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(next => { if (!controller.signal.aborted) { setForms(next); setError(''); } })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The forms could not be loaded.'); });
    return () => controller.abort();
  }, [load]);
  return <section className={styles.panel} aria-label="Official electrical and gas form library">
    <header className={styles.heading}><span className={styles.eyebrow}>GOVERNMENT SAFETY FORMS</span><h4>Fill the official form in TLink</h4><p>Add these from a job&apos;s Forms section. The finished record includes your business branding, the official PDF and the saved evidence.</p></header>
    <div className={styles.choices}>{forms.map(form => <button type="button" key={form.id} onClick={() => setSelected(form)}><strong>{form.title}</strong><span>Preview the questions and sign-off</span></button>)}</div>
    {selected && <div className={styles.form}><button type="button" onClick={() => setSelected(null)}>Close preview</button><CreditexFormPhonePreview key={selected.id} form={selected} canEdit={false} /><p>{selected.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗ </a>)}</p></div>}
    <p className={styles.form}>Smoke alarm service records are available under the job&apos;s rental and safety checks. The official electrical report also includes its smoke-alarm check section.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
