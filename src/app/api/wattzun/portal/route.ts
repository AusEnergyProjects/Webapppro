import { getWattzunPortal, postWattzunPortal } from "@/lib/wattzun-portal-route";
export const runtime = "edge";
export async function GET(request: Request) { return getWattzunPortal(request); }
export async function POST(request: Request) { return postWattzunPortal(request); }
