import { postWattzunAction } from "@/lib/wattzun-actions-server";

export const runtime = "edge";
export async function POST(request: Request) {
  return postWattzunAction(request);
}
