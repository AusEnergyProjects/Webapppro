import type { Metadata } from 'next';
import { SafetyCustomerReportViewer } from '@/components/SafetyCustomerReportViewer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const metadata: Metadata = {
  title: 'Your safety check report | TLink',
  robots: { index: false, follow: false, noarchive: true, nocache: true, nosnippet: true },
  referrer: 'no-referrer',
};

export default async function SafetyCustomerReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SafetyCustomerReportViewer key={token} token={token} />;
}
