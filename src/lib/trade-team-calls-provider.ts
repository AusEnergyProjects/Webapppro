import { env } from "cloudflare:workers";
export type TeamCallIceServer = {
    urls: string | string[];
    username?: string;
    credential?: string;
};
export function teamCallTurnCredentials(source: object = env) {
    const setting = (name: string) => { const value = Reflect.get(source, name); return (typeof value === 'string' ? value : process.env[name] || '').trim(); };
    const accountSid = setting('TWILIO_ACCOUNT_SID'), authToken = setting('TWILIO_AUTH_TOKEN');
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid) || !/^[0-9a-fA-F]{32}$/.test(authToken))
        throw new Error('CALL_UNAVAILABLE');
    return { accountSid, authToken };
}
export async function teamCallIceServers(credentials: {
    accountSid: string;
    authToken: string;
}, ttl: number, fetcher: typeof fetch = fetch): Promise<TeamCallIceServer[]> {
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600)
        throw new Error('CALL_INPUT_INVALID');
    let response: Response;
    try {
        response = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Tokens.json`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Authorization: `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ Ttl: String(ttl) })
        });
    }
    catch {
        throw new Error('CALL_RELAY_UNAVAILABLE');
    }
    if (!response.ok)
        throw new Error('CALL_RELAY_UNAVAILABLE');
    const raw: unknown = await response.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || !('ice_servers' in raw) || !Array.isArray(raw.ice_servers) || raw.ice_servers.length < 1 || raw.ice_servers.length > 10)
        throw new Error('CALL_RELAY_UNAVAILABLE');
    const servers: TeamCallIceServer[] = [];
    for (const item of raw.ice_servers) {
        if (!item || typeof item !== 'object')
            throw new Error('CALL_RELAY_UNAVAILABLE');
        const urls: unknown = item.urls;
        const list = typeof urls === 'string' ? [urls] : Array.isArray(urls) ? urls : [];
        if (!list.length || list.length > 4 || list.some(url => typeof url !== 'string' || url.length > 300 || !/^turns?:[a-z0-9.-]+\.twilio\.com(?::\d+)?(?:\?transport=(?:udp|tcp))?$|^stun:[a-z0-9.-]+\.twilio\.com(?::\d+)?$/i.test(url)))
            throw new Error('CALL_RELAY_UNAVAILABLE');
        if (list.some(url => url.startsWith('turn')) && (typeof item.username !== 'string' || !item.username || item.username.length > 512 || typeof item.credential !== 'string' || !item.credential || item.credential.length > 512))
            throw new Error('CALL_RELAY_UNAVAILABLE');
        servers.push({ urls: typeof urls === 'string' ? urls : list as string[], ...(typeof item.username === 'string' ? { username: item.username } : {}), ...(typeof item.credential === 'string' ? { credential: item.credential } : {}) });
    }
    if (!servers.some(server => (typeof server.urls === 'string' ? [server.urls] : server.urls).some(url => url.startsWith('turn'))))
        throw new Error('CALL_RELAY_UNAVAILABLE');
    return servers;
}
