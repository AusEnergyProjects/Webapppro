import type {
  CustomerPlanReportView,
} from "./customer-plan-report";

const MAX_REPORT_BYTES = 96_000;
const DOWNLOAD_URL_REVOKE_DELAY_MS = 1_000;

export type PublicPlanPdfInput = {
  snapshot: {
    goals: string[];
    pace: string;
    situation: string;
    approvalContext: string;
    budgetRange: string;
    addressState: string;
    features: string[];
    propertyContext?: {
      propertyType?: string;
      storeys?: string;
      ageBand?: string;
      floorArea?: string;
      occupants?: string;
      sharedWalls?: string;
      roofType?: string;
      roofColour?: string;
      roofForm?: string;
      roofCondition?: string;
      switchboard?: string;
      wallConstruction?: string;
      floorConstruction?: string;
    };
  };
  name: string;
  postcode: string;
  projectCategories: string[];
  preparedAt: string;
};

function responseFileName(response: Response) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="([a-z0-9-]+\.pdf)"/i.exec(disposition);
  return match?.[1] || "home-energy-plan.pdf";
}

async function downloadPdf(
  field: "report" | "publicPlan",
  value: CustomerPlanReportView | PublicPlanPdfInput,
): Promise<void> {
  const serializedReport = JSON.stringify(value);
  if (
    new TextEncoder().encode(serializedReport).byteLength > MAX_REPORT_BYTES
  ) {
    throw new Error(
      "This plan is too large to download. Review the planner answers and try again.",
    );
  }
  const response = await fetch("/api/customer-plan-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ [field]: serializedReport }),
  });
  if (!response.ok) {
    const message = (await response.text()).trim().slice(0, 240);
    throw new Error(
      message || "The PDF could not be prepared. Please try again.",
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/pdf")) {
    throw new Error(
      "The PDF service returned an invalid document. Please try again.",
    );
  }
  const blob = await response.blob();
  if (blob.size < 1_000) {
    throw new Error(
      "The PDF service returned an incomplete document. Please try again.",
    );
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = responseFileName(response);
  link.hidden = true;
  window.document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    DOWNLOAD_URL_REVOKE_DELAY_MS,
  );
}

export async function downloadCustomerPlanPdf(
  report: CustomerPlanReportView,
): Promise<void> {
  await downloadPdf("report", report);
}

export async function downloadPublicPlanPdf(
  input: PublicPlanPdfInput,
): Promise<void> {
  await downloadPdf("publicPlan", input);
}
