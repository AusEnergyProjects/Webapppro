"use client";

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { CreditexCustomerDetail, CreditexCustomerPage } from '@/lib/creditex-customer-directory';
import { customerEmailHref, customerPhoneHref } from '@/lib/portal-customer-connect';
import styles from './CreditexCustomerDirectory.module.css';

type Props = { user: User; initialCustomerId?: string; onOpenJob: (id: string) => void; onContact: (id: string) => void; canOpenJobs: boolean };
function useDirectory<T>(user: User, params: string) {
  const key = `${user.uid}:${params}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(`/api/creditex/customers?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Customers could not be loaded.');
      if (!controller.signal.aborted) setResult({ key, data });
    })().catch(error => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : 'Customers could not be loaded.' }); });
    return () => controller.abort();
  }, [user, params, key, revision]);
  return { data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined, loading: result?.key !== key, refresh: () => setRevision(value => value + 1) };
}
export function CreditexCustomerDirectory(props: Props) {
  return <Directory key={`${props.user.uid}:${props.initialCustomerId || ''}`} {...props} />;
}
function Directory({ user, initialCustomerId = '', onOpenJob, onContact, canOpenJobs }: Props) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const [selected, setSelected] = useState(initialCustomerId);
  const list = useDirectory<CreditexCustomerPage>(user, new URLSearchParams({ search: query, page: String(page) }).toString());
  if (selected) return <CustomerDetails user={user} id={selected} onBack={() => setSelected('')} onOpenJob={onOpenJob} onContact={onContact} canOpenJobs={canOpenJobs} />;
  return <section className={styles.workspace} aria-label="Creditex customers">
    <header><div><span>Customer directory</span><h1>Customers</h1><p>Contact details and certificate jobs in your Creditex workspace.</p></div><button type="button" onClick={list.refresh}>Refresh</button></header>
    <form className={styles.search} onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}><label><span>Find a customer</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="Name, email, phone or installer" /></label><button type="submit">Search</button></form>
    {list.error && <p role="alert">{list.error}</p>}{list.loading && <p role="status">Loading customers...</p>}
    {list.data && <><p className={styles.muted}>{list.data.total.toLocaleString('en-AU')} {list.data.total === 1 ? 'customer' : 'customers'}</p><div className={styles.table}><table><thead><tr><th>Customer</th><th>Contact</th><th>Installer</th><th>Jobs</th></tr></thead><tbody>{list.data.customers.map(customer => <tr key={customer.id}><td><button className={styles.link} type="button" onClick={() => setSelected(customer.id)}>{customer.name}</button><small>{customer.address || 'Address not recorded'}</small></td><td>{customer.phone}<small>{customer.email}</small></td><td>{customer.installer}</td><td>{customer.jobCount}</td></tr>)}</tbody></table></div>{!list.data.customers.length && <p className={styles.empty}>{query ? 'No customers match your search.' : 'Customers appear here when certificate jobs are shared with Creditex.'}</p>}<nav className={styles.actions} aria-label="Customer pages"><button type="button" disabled={list.data.page <= 1} onClick={() => setPage(list.data!.page - 1)}>Previous</button><span>Page {list.data.page} of {list.data.totalPages}</span><button type="button" disabled={list.data.page >= list.data.totalPages} onClick={() => setPage(list.data!.page + 1)}>Next</button></nav></>}
  </section>;
}
function CustomerDetails({ user, id, onBack, onOpenJob, onContact, canOpenJobs }: Omit<Props, 'initialCustomerId'> & { id: string; onBack: () => void }) {
  const [page, setPage] = useState(1);
  const detail = useDirectory<CreditexCustomerDetail>(user, new URLSearchParams({ id, page: String(page) }).toString());
  const customer = detail.data?.customer;
  return <section className={styles.workspace} aria-label="Customer details"><header><button type="button" onClick={onBack}>Back to customers</button><button type="button" onClick={detail.refresh}>Refresh</button></header>{detail.loading && <p role="status">Loading customer...</p>}{detail.error && <p role="alert">{detail.error}</p>}{customer && detail.data && <>
    <header><div><span>{customer.installer}</span><h1>{customer.name}</h1><p>{customer.address || 'Address not recorded'}</p></div></header>
    <div className={styles.actions}>{customerPhoneHref(customer.phone) && <a href={customerPhoneHref(customer.phone)}>Call {customer.phone}</a>}{customerEmailHref(customer.email) && <a href={customerEmailHref(customer.email)}>Email {customer.email}</a>}</div>
    <h2>Certificate jobs</h2><div className={styles.jobs}>{detail.data.jobs.map(job => <article key={job.id}><div><strong>{job.number} · {job.title}</strong><p>{job.activity}</p><small>{job.address}</small></div><div className={styles.actions}>{canOpenJobs && <button type="button" onClick={() => onOpenJob(job.id)}>Open job</button>}<button type="button" onClick={() => onContact(job.id)}>Open Connect</button></div></article>)}</div>
    <nav className={styles.actions} aria-label="Customer job pages"><button type="button" disabled={detail.data.page <= 1} onClick={() => setPage(detail.data!.page - 1)}>Previous</button><span>Page {detail.data.page} of {detail.data.totalPages}</span><button type="button" disabled={detail.data.page >= detail.data.totalPages} onClick={() => setPage(detail.data!.page + 1)}>Next</button></nav>
  </>}</section>;
}
