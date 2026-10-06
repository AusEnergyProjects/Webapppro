import { getWattzunUsage } from '@/lib/wattzun-portal-route';
export const runtime = 'edge';
export async function GET(request: Request) { return getWattzunUsage(request); }
