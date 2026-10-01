import { JobSalesOutcomeError } from "../../src/lib/trade-job-sales-outcome-server.ts";

// Unrelated CRM route tests isolate capability enrichment. Sales SQL and mutations
// are exercised against the production helper in trade-job-sales-outcome.test.mjs.
export const jobSalesOutcomeFixture = {
  JobSalesOutcomeError,
  loadJobSalesOutcomes: async (_db, _access, workOrderIds) => Object.fromEntries(
    workOrderIds.map(id => [id, { canMarkLost: false, canReopen: false }]),
  ),
  changeJobSalesOutcome: async () => { throw new Error("Unexpected sales outcome mutation in an unrelated CRM test"); },
};
