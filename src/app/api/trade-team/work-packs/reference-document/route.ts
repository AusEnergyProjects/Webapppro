import { getD1 } from "../../../../../../db";
import {
  loadAssignedCreditexActivityWorkPackReferenceDocument,
} from "@/lib/creditex-activity-work-pack-server";
import {
  assignedWorkPackBytesResponse,
  assignedWorkPackError,
  assignedWorkPackOrigin,
  assignedWorkPackRequestScope,
} from "../_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rejected = assignedWorkPackOrigin(request);
  if (rejected) return rejected;
  try {
    const search = new URL(request.url).searchParams;
    const retained = await loadAssignedCreditexActivityWorkPackReferenceDocument(
      getD1(),
      {
        ...await assignedWorkPackRequestScope(request),
        caseInstanceId: String(search.get("caseInstanceId") || ""),
        responseKey: String(search.get("responseKey") || ""),
        sourceArtifactId: String(search.get("sourceArtifactId") || ""),
      },
    );
    return assignedWorkPackBytesResponse(retained);
  } catch (error) {
    return assignedWorkPackError(error);
  }
}
