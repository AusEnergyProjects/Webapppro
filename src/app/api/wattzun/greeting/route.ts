import { postWattzunGreeting } from "@/lib/wattzun-portal-route";
export const runtime = "edge";
export async function POST(request: Request) { return postWattzunGreeting(request); }
