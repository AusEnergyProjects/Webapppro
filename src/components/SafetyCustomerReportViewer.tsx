"use client";

import { useEffect, useState } from 'react';
import { isSafetyCustomerReport, type SafetyCustomerReport } from '@/lib/safety-customer-report';
import { SafetyCustomerReportContent } from './SafetyCustomerReportContent';
import styles from './SafetyCustomerReport.module.css';

export function SafetyCustomerReportViewer({ token }: { token: string }) {
  const [report, setReport] = useState<SafetyCustomerReport | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/trade-safety-check-report?token=${encodeURIComponent(token)}`, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal })
      .then(async response => {
        const result: unknown = await response.json();
        if (!response.ok || !result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
          const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'This report could not be opened.';
          throw new Error(message);
        }
        if (!('report' in result) || !isSafetyCustomerReport(result.report, token)) throw new Error('This report could not be verified. Ask the inspecting business for a current copy.');
        if (!controller.signal.aborted) setReport(result.report);
      }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'This report could not be opened.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token]);
  if (loading) return <main id="site-content" className={styles.state} role="status"><span className={styles.loadingMark} aria-hidden="true" /><h1>Opening your safety report</h1><p>Your check, photos and official PDF together.</p></main>;
  if (!report) return <main id="site-content" className={styles.state}><h1>Report unavailable</h1><p role="alert">{error || 'This report could not be found.'}</p><p>Ask the inspecting business for a new report link or a copy of your records.</p></main>;
  return <SafetyCustomerReportContent report={report} />;
}
