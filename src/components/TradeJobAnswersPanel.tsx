"use client";

import { useEffect, useId, useState } from 'react';
import type { User } from 'firebase/auth';
import { JobAnswersHttpError, loadJobAnswers, type JobAnswersRequest, type JobAnswersResult } from '@/lib/trade-job-answers';
import { useTradeBusinessFetch } from './TradeBusinessProvider';
import styles from './TradeJobAnswersPanel.module.css';

function displayedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function TradeJobAnswersPanel({ user, workOrderId }: { user: User; workOrderId: string }) {
  const request = useTradeBusinessFetch();
  const headingId = useId(), selectorId = useId();
  const [load, setLoad] = useState<{ workOrderId: string; request: typeof request; uid: string; result: JobAnswersResult } | null>(null);
  const [selected, setSelected] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const read: JobAnswersRequest = async <T,>(path: string): Promise<T> => {
      const response = await request(path, { method: 'GET', headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new JobAnswersHttpError(typeof body?.error === 'string' ? body.error : 'The saved forms could not be loaded.', response.status);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('The saved forms response was invalid.');
      return body as T;
    };
    void loadJobAnswers(read, workOrderId).then(result => {
      if (active) setLoad({ workOrderId, request, uid: user.uid, result });
    }).catch(error => {
      if (active) setLoad({ workOrderId, request, uid: user.uid, result: { forms: [], errors: [error instanceof Error ? error.message : 'The saved forms could not be loaded.'] } });
    });
    return () => { active = false; controller.abort(); };
  }, [request, retry, user, workOrderId]);
  const result = load?.workOrderId === workOrderId && load.request === request && load.uid === user.uid ? load.result : null;
  const form = result?.forms.find(item => item.key === selected) || result?.forms[0];
  function refresh() { setLoad(null); setRetry(value => value + 1); }
  return <section className={styles.shell} aria-labelledby={headingId} aria-busy={!result}>
    <header className={styles.heading}><div><h3 id={headingId}>Form answers</h3><p>Read the saved questions and answers for this job.</p></div>
      <button type="button" onClick={refresh} disabled={!result}>Refresh answers</button></header>
    {!result ? <p className={styles.message} role="status">Loading saved form answers...</p> : <>
      {result.errors.length > 0 && <div className={styles.error} role="alert"><strong>Some answers could not be loaded</strong>{result.errors.map((error, index) => <p key={index}>{error}</p>)}<button type="button" onClick={refresh}>Try again</button></div>}
      {!result.forms.length && !result.errors.length && <p className={styles.message}>No form attached to the job.</p>}
      {result.forms.length > 1 && <div className={styles.selector}><label htmlFor={selectorId}>Choose a form</label><select id={selectorId} value={form?.key || ''} onChange={event => setSelected(event.target.value)}>{result.forms.map(item => <option key={item.key} value={item.key}>{item.title} · {item.source}{item.version ? ` · v${item.version}` : ''} · {item.status}</option>)}</select><span>{result.forms.length} attached forms</span></div>}
      {form && <article className={styles.form} key={form.key}>
        <header className={styles.formHeading}><div><span>{form.source}{form.version ? ` · Version ${form.version}` : ''}</span><h4>{form.title}</h4>{form.recordedAt && <small>Last saved {displayedDate(form.recordedAt)}</small>}</div><strong className={styles.status}>{form.status}</strong></header>
        {form.emptyMessage ? <p className={styles.message}>{form.emptyMessage}</p> : !form.sections.length ? <p className={styles.message}>No applicable questions are recorded on this form.</p> : form.sections.map(section => <section className={styles.section} key={section.key}>
          <h5>{section.title}</h5>{section.emptyMessage && <p className={styles.message}>{section.emptyMessage}</p>}
          <dl>{section.rows.map(row => <div className={styles.row} key={row.key}>
            <dt><span className={styles.caption}>Question</span>{row.question}{row.note && <p>{row.note}</p>}</dt>
            <dd><span className={styles.caption}>Answer</span><div className={styles.value}>{row.answer}</div>{row.signatures?.map(signature => <div key={signature.id} className={styles.signature}><strong>{signature.name}</strong>{signature.signedAt && <small>Signed {displayedDate(signature.signedAt)}</small>}
              {signature.strokes.length > 0 && <svg viewBox="0 0 1000 360" role="img" aria-label={`Saved signature for ${signature.name}`}>{signature.strokes.map((stroke, index) => <polyline key={index} points={stroke.points.map(point => `${point.x * 1000},${point.y * 360}`).join(' ')} />)}</svg>}</div>)}</dd>
          </div>)}</dl>
        </section>)}
      </article>}
    </>}
  </section>;
}
