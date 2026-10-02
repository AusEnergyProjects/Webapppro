"use client";
import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { User } from 'firebase/auth';
import type { TradeMapRecord } from '@/lib/trade-record-map';
import styles from './CreditexCustomerDirectory.module.css';
const TradeRecordMap = dynamic(() => import('./TradeRecordMap').then(module => module.TradeRecordMap), { ssr: false, loading: () => <p role="status">Loading map...</p> });
export function CreditexCustomerMap({ user, onOpenRecord, canViewCustomers, canViewJobs }: { user: User; onOpenRecord: (record: TradeMapRecord) => void; canViewCustomers: boolean; canViewJobs: boolean }) {
  const [resource, setResource] = useState<'customers' | 'jobs'>(canViewJobs ? 'jobs' : 'customers');
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const allowed = resource === 'jobs' ? canViewJobs : canViewCustomers;
  return <section className={styles.workspace} aria-label="Customer and job map"><header><div><span>Locations</span><h1>Customer &amp; job map</h1><p>Find customers and plan work across your authorised certificate jobs.</p></div></header>
    <form className={styles.search} onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}><label><span>Find customers or jobs</span><input type="search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} placeholder="Customer, job or address" /></label><button type="submit">Search</button></form>
    <nav className={styles.actions} aria-label="Map records">{canViewJobs && <button type="button" aria-pressed={resource === 'jobs'} onClick={() => setResource('jobs')}>Jobs</button>}{canViewCustomers && <button type="button" aria-pressed={resource === 'customers'} onClick={() => setResource('customers')}>Customers</button>}</nav>
    {allowed && <div className={styles.map}><TradeRecordMap key={`${user.uid}:${resource}`} user={user} workspace="creditex" query={{ resource, filters: { search: query } }} onOpenRecord={onOpenRecord}/></div>}
  </section>;
}
