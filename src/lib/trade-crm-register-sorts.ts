export const INSTALLER_JOB_REGISTER_SORT_VALUES = [
  "updated-desc",
  "number-asc", "number-desc",
  "first-name-asc", "first-name-desc",
  "last-name-asc", "last-name-desc",
  "phone-asc", "phone-desc",
  "email-asc", "email-desc",
  "street-asc", "street-desc",
  "postcode-asc", "postcode-desc",
  "suburb-asc", "suburb-desc",
  "state-asc", "state-desc",
  "assignee-asc", "assignee-desc",
  "date-asc", "date-desc",
  "created-asc", "created-desc",
  "status-asc", "status-desc",
  "quote-total-asc", "quote-total-desc",
  "s-a", "s-d",
  "v-a", "v-d",
  "e-a", "e-d",
  "o-a", "o-d",
  "service-asc", "service-desc",
] as const;

export type InstallerJobRegisterSort = typeof INSTALLER_JOB_REGISTER_SORT_VALUES[number];

export const INSTALLER_CUSTOMER_REGISTER_SORT_VALUES = [
  "updated-desc",
  "name-asc", "name-desc",
  "first-name-asc", "first-name-desc",
  "last-name-asc", "last-name-desc",
  "email-asc", "email-desc",
  "phone-asc", "phone-desc",
  "suburb-asc", "suburb-desc",
  "postcode-asc", "postcode-desc",
  "jobs-asc", "jobs-desc",
  "created-asc", "created-desc",
  "latest-job-asc", "latest-job-desc",
  "status-asc", "status-desc",
] as const;

export type InstallerCustomerRegisterSort = typeof INSTALLER_CUSTOMER_REGISTER_SORT_VALUES[number];
