import { completeTradeEmailConnection, isTradeEmailProvider } from '@/lib/trade-email-server';

export const runtime = 'edge';
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  let status = 'failed';
  try {
    if (!isTradeEmailProvider(provider)) throw new Error('EMAIL_CONNECTION_INVALID');
    const browser = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('tlink_email_oauth='))?.slice('tlink_email_oauth='.length) || '';
    if (url.searchParams.get('error') === 'access_denied') status = 'cancelled';
    else {
      await completeTradeEmailConnection(provider, url.searchParams.get('state') || '', browser, url.searchParams.get('code') || '', `${url.origin}${url.pathname}`);
      status = 'connected';
    }
  } catch { status = 'failed'; }
  const target = new URL('/direct-trade/dashboard', url.origin);
  target.searchParams.set('workspace', 'account'); target.searchParams.set('email_connection', status); target.hash = 'business-settings-email';
  return new Response(null, { status: 303, headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Set-Cookie': `tlink_email_oauth=; HttpOnly; SameSite=Lax; Path=/api/trade-email/callback; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}` } });
}
