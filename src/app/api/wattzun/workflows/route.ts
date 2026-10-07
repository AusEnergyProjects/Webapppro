import { postWattzunWorkflow } from "@/lib/wattzun-workflow-server";

export const runtime = "edge";
export async function POST(request: Request) {
  return postWattzunWorkflow(request);
}
