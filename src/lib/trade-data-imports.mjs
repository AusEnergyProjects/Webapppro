export const IMPORT_MAX_ROWS = 500;

export const IMPORT_DEFINITIONS = {
  customers: {
    label: "Customers",
    roles: ["installer"],
    headers: [
      "customer_type", "first_name", "last_name", "business_name", "email", "phone",
      "address_line_1", "address_line_2", "suburb", "state", "postcode", "tags", "private_notes",
    ],
    examples: [
      ["residential", "Alex", "Taylor", "", "alex.taylor@example.com", "0400 000 001", "12 Sample Street", "", "Box Hill", "VIC", "3128", "repeat customer|heat pump", "Imported example only"],
      ["business", "", "", "Example Property Group", "projects@example.com", "03 9000 0000", "40 Example Road", "Level 2", "Parramatta", "NSW", "2150", "builder|commercial", "Imported example only"],
    ],
  },
  jobs: {
    label: "Historical jobs",
    roles: ["installer"],
    headers: [
      "title", "customer_email", "service_category", "pipeline_stage", "work_stage", "priority",
      "scheduled_start", "scheduled_end", "estimated_value", "description", "next_action", "tags",
    ],
    examples: [
      ["Heat pump hot water installation", "alex.taylor@example.com", "hot-water", "scheduled", "scheduled", "standard", "2026-08-03", "2026-08-03", "4200.00", "Replace existing unit and complete commissioning", "Confirm product delivery", "heat pump|scheduled"],
      ["Switchboard assessment", "projects@example.com", "electrical", "complete", "completed", "standard", "2026-05-12", "2026-05-12", "550.00", "Historical completed assessment", "", "historical|assessment"],
    ],
  },
  products: {
    label: "Wholesaler products",
    roles: ["supplier"],
    headers: [
      "model_number", "brand", "name", "category", "description", "unit_price_ex_gst",
      "min_order_qty", "order_increment", "unit_label", "stock_status", "lead_time_days", "warranty_years", "datasheet_url",
    ],
    examples: [
      ["EX-HP-270", "Example Energy", "270L heat pump water heater", "hot-water", "Import example requiring catalogue review", "2890.00", "1", "1", "each", "in_stock", "3", "7", "https://example.com/datasheet.pdf"],
      ["EX-BAT-10", "Example Energy", "10 kWh home battery", "battery", "Import example requiring catalogue review", "6200.00", "1", "1", "each", "order_in", "14", "10", "https://example.com/battery.pdf"],
    ],
  },
};

const CUSTOMER_TYPES = new Set(["residential", "business"]);
const STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const SERVICE_CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "electrical", "plumbing", "mounting-hardware", "controls", "other"]);
const PIPELINE_STAGES = new Set(["enquiry", "qualifying", "quoting", "approved", "scheduled", "in_progress", "complete", "invoiced", "paid", "lost"]);
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "standard", "high", "urgent"]);
const STOCK_STATUSES = new Set(["in_stock", "limited", "order_in", "unavailable"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function integer(value, fallback, minimum = 0, maximum = 100000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function dollarsToCents(value) {
  const cleaned = text(value, 40).replaceAll("$", "").replaceAll(",", "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100000000 ? Math.round(parsed * 100) : -1;
}

function list(value) {
  return text(value, 1000).split(/[|,]/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
}

function validDate(value) {
  if (!value) return true;
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function customerKey(values) {
  if (values.email) return `email:${values.email}`;
  const phone = values.phone.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${[values.firstName, values.lastName, values.businessName, values.postcode].join(":").toLowerCase()}`;
}

function jobKey(values) {
  return `job:${values.title.toLowerCase()}:${values.customerEmail}:${values.scheduledStart}`;
}

function productKey(values) {
  return `model:${values.modelNumber.toLowerCase()}`;
}

function rowStatus(issues, duplicate) {
  if (issues.some((item) => item.level === "error")) return "error";
  if (duplicate) return "duplicate";
  if (issues.length) return "warning";
  return "ready";
}

function customerRow(record) {
  const values = {
    customerType: text(record.customer_type, 20).toLowerCase() || "residential",
    firstName: text(record.first_name, 80), lastName: text(record.last_name, 80), businessName: text(record.business_name, 140),
    email: text(record.email, 180).toLowerCase(), phone: text(record.phone, 40),
    addressLine1: text(record.address_line_1, 140), addressLine2: text(record.address_line_2, 140), suburb: text(record.suburb, 80),
    addressState: text(record.state, 20).toUpperCase(), postcode: text(record.postcode, 12),
    tags: list(record.tags), privateNotes: text(record.private_notes, 2000),
  };
  const issues = [];
  if (!CUSTOMER_TYPES.has(values.customerType)) issues.push({ level: "error", message: "Customer type must be residential or business." });
  if (!values.businessName && !values.firstName && !values.lastName) issues.push({ level: "error", message: "Add a customer or business name." });
  if (values.email && !EMAIL_PATTERN.test(values.email)) issues.push({ level: "error", message: "Check the email address." });
  if (values.addressState && !STATES.has(values.addressState)) issues.push({ level: "error", message: "Use a valid Australian state or territory code." });
  if (values.postcode && !/^\d{4}$/.test(values.postcode)) issues.push({ level: "error", message: "Postcode must contain four digits." });
  if (!values.email && !values.phone) issues.push({ level: "warning", message: "No email or phone was supplied." });
  if (!values.addressLine1 || !values.suburb || !values.addressState || !values.postcode) issues.push({ level: "warning", message: "The address is incomplete and can be finished after import." });
  return { values, key: customerKey(values), issues };
}

function jobRow(record, customerEmails) {
  const values = {
    title: text(record.title, 160), customerEmail: text(record.customer_email, 180).toLowerCase(),
    serviceCategory: text(record.service_category, 60).toLowerCase() || "other",
    pipelineStage: text(record.pipeline_stage, 30).toLowerCase() || "enquiry",
    workStage: text(record.work_stage, 30).toLowerCase() || "backlog",
    priority: text(record.priority, 20).toLowerCase() || "standard",
    scheduledStart: text(record.scheduled_start, 10), scheduledEnd: text(record.scheduled_end, 10),
    estimatedValueCents: dollarsToCents(record.estimated_value), description: text(record.description, 3000),
    nextAction: text(record.next_action, 200), tags: list(record.tags),
  };
  const issues = [];
  if (!values.title) issues.push({ level: "error", message: "Add a job title." });
  if (values.customerEmail && !EMAIL_PATTERN.test(values.customerEmail)) issues.push({ level: "error", message: "Check the customer email address." });
  if (!SERVICE_CATEGORIES.has(values.serviceCategory)) issues.push({ level: "error", message: "Choose a supported service category." });
  if (!PIPELINE_STAGES.has(values.pipelineStage)) issues.push({ level: "error", message: "Choose a supported sales stage." });
  if (!WORK_STAGES.has(values.workStage)) issues.push({ level: "error", message: "Choose a supported work stage." });
  if (!PRIORITIES.has(values.priority)) issues.push({ level: "error", message: "Priority must be low, standard, high or urgent." });
  if (!validDate(values.scheduledStart) || !validDate(values.scheduledEnd)) issues.push({ level: "error", message: "Dates must use YYYY-MM-DD." });
  if (values.scheduledStart && values.scheduledEnd && values.scheduledEnd < values.scheduledStart) issues.push({ level: "error", message: "Scheduled finish cannot be before the start." });
  if (values.estimatedValueCents < 0) issues.push({ level: "error", message: "Estimated value must be a valid positive amount." });
  if (values.customerEmail && !customerEmails.has(values.customerEmail)) issues.push({ level: "warning", message: "This customer email is not in the CRM, so the job will import without a linked contact." });
  return { values, key: jobKey(values), issues };
}

function productRow(record) {
  const values = {
    modelNumber: text(record.model_number, 100), brand: text(record.brand, 100), name: text(record.name, 160),
    category: text(record.category, 60).toLowerCase(), description: text(record.description, 2000),
    unitPriceCentsExGst: dollarsToCents(record.unit_price_ex_gst), minOrderQty: integer(record.min_order_qty, 1, 1, 100000),
    orderIncrement: integer(record.order_increment, 1, 1, 100000), unitLabel: text(record.unit_label, 40) || "each",
    stockStatus: text(record.stock_status, 30).toLowerCase() || "order_in", leadTimeDays: integer(record.lead_time_days, -1, 0, 3650),
    warrantyYears: integer(record.warranty_years, -1, 0, 100), datasheetUrl: text(record.datasheet_url, 500),
  };
  const issues = [];
  if (!values.modelNumber || !values.brand || !values.name || !values.description) issues.push({ level: "error", message: "Model, brand, product name and description are required." });
  if (!SERVICE_CATEGORIES.has(values.category)) issues.push({ level: "error", message: "Choose a supported product category." });
  if (values.unitPriceCentsExGst <= 0) issues.push({ level: "error", message: "Unit price must be greater than zero." });
  if (!STOCK_STATUSES.has(values.stockStatus)) issues.push({ level: "error", message: "Choose in_stock, limited, order_in or unavailable." });
  if (values.leadTimeDays < 0 || values.warrantyYears < 0) issues.push({ level: "error", message: "Lead time and warranty must be whole numbers." });
  if (values.datasheetUrl && !/^https:\/\//i.test(values.datasheetUrl)) issues.push({ level: "warning", message: "Datasheet links should use HTTPS." });
  return { values, key: productKey(values), issues };
}

export function parseImportCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(source || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw new Error("CSV_QUOTE_UNCLOSED");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function validateImportCsv({ importType, source, existingKeys = new Set(), customerEmails = new Set() }) {
  const definition = IMPORT_DEFINITIONS[importType];
  if (!definition) throw new Error("IMPORT_TYPE_INVALID");
  const parsed = parseImportCsv(source);
  if (parsed.length < 2) throw new Error("IMPORT_EMPTY");
  const headers = parsed[0].map((value) => text(value, 80).toLowerCase().replaceAll(" ", "_"));
  const missingHeaders = definition.headers.filter((header) => !headers.includes(header));
  if (missingHeaders.length) return { headers, missingHeaders, rows: [], summary: { total: 0, ready: 0, warning: 0, duplicate: 0, error: 0 } };
  const dataRows = parsed.slice(1).filter((values) => values.some(Boolean));
  if (!dataRows.length) throw new Error("IMPORT_EMPTY");
  if (dataRows.length > IMPORT_MAX_ROWS) throw new Error("IMPORT_TOO_LARGE");
  const seen = new Set();
  const rows = dataRows.map((columns, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, columns[column] || ""]));
    const normalized = importType === "customers" ? customerRow(record) : importType === "jobs" ? jobRow(record, customerEmails) : productRow(record);
    const duplicate = existingKeys.has(normalized.key) || seen.has(normalized.key);
    seen.add(normalized.key);
    const status = rowStatus(normalized.issues, duplicate);
    const issues = duplicate ? [...normalized.issues, { level: "warning", message: "A matching record already exists or appears earlier in this file." }] : normalized.issues;
    return {
      rowNumber: index + 2, key: normalized.key, values: normalized.values, status, issues,
      resolution: status === "error" || status === "duplicate" ? "skip" : "import",
    };
  });
  const summary = { total: rows.length, ready: 0, warning: 0, duplicate: 0, error: 0 };
  for (const rowItem of rows) summary[rowItem.status] += 1;
  return { headers, missingHeaders: [], rows, summary };
}

function csvCell(value) {
  const string = String(value ?? "");
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function importTemplateCsv(importType) {
  const definition = IMPORT_DEFINITIONS[importType];
  if (!definition) throw new Error("IMPORT_TYPE_INVALID");
  return `${definition.headers.join(",")}\n${definition.examples.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
