import type { JobRegisterRecord } from "./trade-crm-job-register.ts";
import type { TradeMapRecord } from "./trade-record-map.ts";

type CustomerMapSource = {
  id: string;
  customerNumber: string;
  displayName: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  addressState: string;
  postcode: string;
  jobCount?: number;
};

type JobMapSource = {
  id: string;
  workNumber: string;
  title: string;
  customerDisplayName?: string;
  sourceType: string;
  customerSource: string;
  serviceSiteId: string;
  jobRegister: Pick<JobRegisterRecord, "streetAddress" | "suburb" | "state" | "postcode" | "service" | "operationalStatus">;
};

function streetAddress(street: string, suburb: string, state: string, postcode: string): string {
  // Locality alone is not a customer's location. Leave incomplete records unpinned.
  if (!street.trim() || (!suburb.trim() && !postcode.trim())) return "";
  return [street, suburb, state, postcode, "Australia"].map((part) => part.trim()).filter(Boolean).join(", ");
}

export function customerMapRecord(customer: CustomerMapSource): TradeMapRecord {
  const jobs = customer.jobCount || 0;
  return {
    id: customer.id,
    kind: "customer",
    title: customer.displayName || customer.customerNumber,
    reference: customer.customerNumber,
    address: customer.addressLine1.trim()
      ? streetAddress([customer.addressLine1, customer.addressLine2].map((part) => part.trim()).filter(Boolean).join(", "), customer.suburb, customer.addressState, customer.postcode)
      : "",
    detail: `${jobs} linked ${jobs === 1 ? "job" : "jobs"}`,
  };
}

export function jobMapRecord(job: JobMapSource): TradeMapRecord {
  const protectedLocation = job.sourceType === "opportunity" || job.customerSource === "platform_private";
  const record = job.jobRegister;
  return {
    id: job.id,
    kind: "job",
    jobStatus: record.operationalStatus,
    title: protectedLocation ? "Protected job" : job.customerDisplayName || job.title || job.workNumber,
    reference: job.workNumber,
    // The register projection comes from the job's service site, never its customer's billing address.
    address: !protectedLocation && job.serviceSiteId
      ? streetAddress(record.streetAddress, record.suburb, record.state, record.postcode)
      : "",
    detail: protectedLocation
      ? "Customer location protected"
      : [record.service, record.operationalStatus.replaceAll("_", " ")].filter(Boolean).join(" | "),
  };
}
