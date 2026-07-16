import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FIREBASE_WEB_API_KEY = "AIzaSyBL9P793q5z7o6Baqg-o2yuIteYU6IHrug";
const BATCH = "aea-demo-20260716";
const LOGIN_BASE = "https://aea-energy-comparison.info294029.chatgpt.site";
const args = Object.fromEntries(process.argv.slice(2).map((entry, index, all) => entry.startsWith("--") ? [entry.slice(2), all[index + 1]] : null).filter(Boolean));
const outputDir = path.resolve(args.out || path.join(process.cwd(), "synthetic-test-output"));
const sqlPath = path.resolve(args.sql || path.join(process.cwd(), "fixtures", "synthetic", "migrations", "0033_synthetic_benchmark_population.sql"));
const csvPath = path.join(outputDir, "aea-demo-account-credentials.csv");
const checkpointPath = path.join(outputDir, ".aea-demo-account-checkpoint.json");
const brokerUrl = args.broker || "";
const brokerSecret = process.env.SYNTHETIC_BROKER_SECRET || (args["broker-secret-file"] ? fs.readFileSync(path.resolve(args["broker-secret-file"]), "utf8").trim() : "");

const states = [
  { code: "VIC", postcode: "3128", suburb: "Box Hill" }, { code: "NSW", postcode: "2150", suburb: "Parramatta" },
  { code: "QLD", postcode: "4000", suburb: "Brisbane City" }, { code: "SA", postcode: "5000", suburb: "Adelaide" },
  { code: "WA", postcode: "6000", suburb: "Perth" }, { code: "TAS", postcode: "7000", suburb: "Hobart" },
  { code: "ACT", postcode: "2600", suburb: "Canberra" }, { code: "NT", postcode: "0800", suburb: "Darwin" },
];
const canonicalState = (code) => code;
const trades = [
  ["assessment", "Energy assessment"], ["solar", "Solar installation"], ["battery", "Battery installation"],
  ["heating-cooling", "Heating and cooling"], ["hot-water", "Heat pump hot water"],
  ["insulation-draughts", "Insulation and draught control"], ["ev-charging", "EV charging"],
  ["electrical", "Electrical services"], ["plumbing", "Plumbing services"], ["other", "Whole home upgrades"],
];
const productTemplates = [
  ["solar", "SunPeak", "SP-440", "440W solar module", 21900, 25],
  ["battery", "VoltStore", "VS-10", "10 kWh home battery", 684000, 10],
  ["heating-cooling", "AirWise", "AW-70", "High efficiency split system", 238000, 7],
  ["hot-water", "ThermaFlow", "TF-270", "270L heat pump water heater", 319000, 7],
  ["ev-charging", "ChargePath", "CP-7", "7 kW smart EV charger", 139000, 5],
  ["insulation-draughts", "EcoLayer", "EL-R6", "R6 ceiling insulation pack", 12900, 50],
  ["electrical", "GridSafe", "GS-DB", "Smart distribution board kit", 178000, 10],
  ["controls", "HomeLogic", "HL-HUB", "Whole home energy control hub", 89000, 5],
  ["mounting-hardware", "MountPro", "MP-RAIL", "Solar mounting rail kit", 16500, 15],
  ["plumbing", "FlowCore", "FC-HW", "Heat pump plumbing connection kit", 42000, 5],
];
const projectGoals = ["Lower energy bills", "Replace ageing equipment", "Improve comfort", "Reduce gas use", "Prepare for an electric vehicle", "Build a staged whole home plan"];
const priorities = ["lower-bills", "comfort", "move-from-gas", "resilience", "future-ready", "replace-failed"];
const stages = ["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"];
const pipelines = ["enquiry", "qualifying", "quoting", "approved", "scheduled", "in_progress", "complete", "invoiced", "paid"];

function stableId(...parts) {
  const hex = createHash("sha256").update(parts.join(":"), "utf8").digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function password() { return `AeA!${randomBytes(12).toString("base64url")}7`; }
function sql(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }
function csv(value) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function day(offset) { const value = new Date(Date.UTC(2026, 6, 16 + offset, 9, 0, 0)); return value.toISOString(); }
function date(offset) { return day(offset).slice(0, 10); }
function json(value) { return JSON.stringify(value); }

async function firebaseRequest(operation, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || `Firebase ${operation} failed`);
  return result;
}
async function createAccount(record) {
  if (brokerUrl) {
    const response = await fetch(brokerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-synthetic-seed-secret": brokerSecret },
      body: JSON.stringify({ email: record.email, password: record.password, displayName: record.displayName }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.firebaseUid) throw new Error(result.error || "Synthetic identity broker failed");
    return { ...record, firebaseUid: result.firebaseUid };
  }
  let result;
  try {
    result = await firebaseRequest("signUp", { email: record.email, password: record.password, returnSecureToken: true });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "EMAIL_EXISTS") throw error;
    result = await firebaseRequest("signInWithPassword", { email: record.email, password: record.password, returnSecureToken: true });
  }
  await firebaseRequest("update", { idToken: result.idToken, displayName: record.displayName, returnSecureToken: false }).catch(() => null);
  return { ...record, firebaseUid: result.localId };
}
async function mapLimit(items, limit, task) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      let attempt = 0;
      while (true) {
        try { output[index] = await task(items[index], index); break; }
        catch (error) {
          attempt += 1;
          if (attempt >= 8 || !/TOO_MANY_ATTEMPTS|QUOTA|UNAVAILABLE|INTERNAL|broker|provider|paused|fetch failed/i.test(String(error))) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return output;
}

function accountDrafts() {
  const records = [];
  for (let index = 1; index <= 100; index += 1) {
    const trade = trades[(index - 1) % trades.length];
    const secondary = trades[(index + 2) % trades.length];
    const state = states[(index - 1) % states.length];
    records.push({
      accountType: "installer", email: `${BATCH}.installer.${String(index).padStart(3, "0")}@example.com`, password: password(),
      displayName: `AEA Demo ${trade[1]} ${String(index).padStart(3, "0")}`, state, capabilities: [trade[0], secondary[0]],
      offering: `${trade[1]}; ${secondary[1]}`, loginUrl: `${LOGIN_BASE}/direct-trade/dashboard`, plan: "Synthetic premium",
    });
  }
  for (let index = 1; index <= 50; index += 1) {
    const state = states[(index + 2) % states.length];
    const categories = [productTemplates[(index - 1) % productTemplates.length][0], productTemplates[index % productTemplates.length][0], productTemplates[(index + 1) % productTemplates.length][0]];
    records.push({
      accountType: "wholesaler", email: `${BATCH}.wholesaler.${String(index).padStart(3, "0")}@example.com`, password: password(),
      displayName: `AEA Demo Energy Supply ${String(index).padStart(3, "0")}`, state, capabilities: [...new Set(categories)],
      offering: `${[...new Set(categories)].join("; ")} product supply`, loginUrl: `${LOGIN_BASE}/direct-trade/dashboard`, plan: "Synthetic premium",
    });
  }
  for (let index = 1; index <= 200; index += 1) {
    const state = states[(index + 4) % states.length];
    const trade = trades[(index * 3) % 7];
    records.push({
      accountType: "consumer", email: `${BATCH}.consumer.${String(index).padStart(3, "0")}@example.com`, password: password(),
      displayName: `AEA Demo Homeowner ${String(index).padStart(3, "0")}`, state, capabilities: [trade[0]],
      offering: `${trade[1]} project enquiry`, loginUrl: `${LOGIN_BASE}/account`, plan: "Always free",
    });
  }
  return records;
}

function writeCredentials(records) {
  const headers = ["account_type", "email", "password", "display_name", "state", "postcode", "trade_or_service_offerings", "plan", "login_url", "firebase_uid", "test_marker", "notes"];
  const rows = records.map((record) => [record.accountType, record.email, record.password, record.displayName, record.state.code, record.state.postcode, record.offering, record.plan, record.loginUrl, record.firebaseUid, BATCH, record.accountType === "consumer" ? "Synthetic enquiry is preloaded. Firebase email is intentionally unverified." : "Synthetic premium test account. Do not use for real work or billing."]);
  fs.writeFileSync(csvPath, `${headers.join(",")}\n${rows.map((row) => row.map(csv).join(",")).join("\n")}\n`, { mode: 0o600 });
}

function buildSql(records) {
  const statements = [];
  const installers = records.filter((record) => record.accountType === "installer");
  const suppliers = records.filter((record) => record.accountType === "wholesaler");
  const consumers = records.filter((record) => record.accountType === "consumer");
  const now = day(0);
  for (const [accountIndex, record] of [...installers, ...suppliers].entries()) {
    const partnerType = record.accountType === "wholesaler" ? "supplier" : "installer";
    const planKey = partnerType === "supplier" ? "supplier_annual" : "installer_annual";
    statements.push(`INSERT OR IGNORE INTO trade_accounts
      (firebase_uid, email, business_name, address_line_1, suburb, address_state, postcode, contact_name, phone,
       partner_type, business_website, service_states, capabilities, summary, account_status, verification_status,
       plan_key, billing_status, availability_status, service_base_postcode, service_radius_km, email_opportunities,
       email_weekly_summary, is_synthetic, consent_version, consent_at, created_at, updated_at)
      VALUES (${sql(record.firebaseUid)}, ${sql(record.email)}, ${sql(record.displayName)}, ${sql(`${accountIndex + 10} Benchmark Street`)},
       ${sql(record.state.suburb)}, ${sql(record.state.code)}, ${sql(record.state.postcode)}, ${sql("Demo Account Manager")},
       ${sql(`0400 ${String(100000 + accountIndex).slice(0, 3)} ${String(100000 + accountIndex).slice(3)}`)}, ${sql(partnerType)}, '',
       ${sql(json(partnerType === "installer" ? states.map((item) => canonicalState(item.code)) : [canonicalState(record.state.code)]))}, ${sql(json(record.capabilities))}, ${sql(`Synthetic ${record.offering} account for product and UI benchmarking.`)},
       'active', 'approved', ${sql(planKey)}, 'active', 'open', ${sql(record.state.postcode)}, ${partnerType === "installer" ? 5000 : 150}, 0, 0, 1,
       'synthetic-benchmark-v1', ${sql(now)}, ${sql(now)}, ${sql(now)});`);
    const roleFeatures = partnerType === "supplier"
      ? ["supplier_visibility", "supplier_bulk_import", "business_operations", "advanced_analytics", "featured_placement", "team_access", "priority_support"]
      : ["installer_leads", "installer_marketplace", "business_operations", "advanced_analytics", "featured_placement", "team_access", "priority_support"];
    for (const feature of roleFeatures) statements.push(`INSERT OR IGNORE INTO trade_account_feature_grants
      (id, firebase_uid, feature_key, status, expires_at, note, granted_by_uid, created_at, updated_at)
      VALUES (${sql(stableId(BATCH, record.firebaseUid, feature))}, ${sql(record.firebaseUid)}, ${sql(feature)}, 'active', '',
      'Synthetic premium benchmark access', 'synthetic-system', ${sql(now)}, ${sql(now)});`);
  }

  for (const [installerIndex, installer] of installers.entries()) {
    for (let customerIndex = 1; customerIndex <= 5; customerIndex += 1) {
      const customerId = stableId(BATCH, installer.firebaseUid, "customer", customerIndex);
      statements.push(`INSERT OR IGNORE INTO trade_crm_customers
        (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, email, phone,
         address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes, record_status, created_at, updated_at)
        VALUES (${sql(customerId)}, ${sql(installer.firebaseUid)}, ${sql(`CUS-${String(customerIndex).padStart(6, "0")}`)}, 'residential',
         ${sql(`Demo${customerIndex}`)}, ${sql(`Customer${installerIndex + 1}`)}, '', ${sql(`${BATCH}.crm.${installerIndex + 1}.${customerIndex}@example.com`)},
         ${sql(`0401 000 ${String(installerIndex * 5 + customerIndex).padStart(3, "0")}`)}, ${sql(`${20 + customerIndex} Synthetic Avenue`)}, '',
         ${sql(installer.state.suburb)}, ${sql(installer.state.code)}, ${sql(installer.state.postcode)}, ${sql(json(["benchmark", installer.capabilities[0]]))},
         'Synthetic direct customer owned by this demo installer.', 'active', ${sql(day(-40 + customerIndex))}, ${sql(now)});`);
    }
    for (let jobIndex = 1; jobIndex <= 8; jobIndex += 1) {
      const jobId = stableId(BATCH, installer.firebaseUid, "job", jobIndex);
      const customerId = stableId(BATCH, installer.firebaseUid, "customer", ((jobIndex - 1) % 5) + 1);
      const category = installer.capabilities[(jobIndex - 1) % installer.capabilities.length];
      const stage = stages[(installerIndex + jobIndex) % stages.length];
      const pipeline = pipelines[(installerIndex + jobIndex) % pipelines.length];
      const startOffset = jobIndex - 3;
      const estimated = 180000 + ((installerIndex + jobIndex) % 12) * 72000;
      const quoted = ["quoting", "approved", "scheduled", "in_progress", "complete", "invoiced", "paid"].includes(pipeline) ? estimated : 0;
      const invoiced = ["invoiced", "paid"].includes(pipeline) ? quoted : 0;
      const paid = pipeline === "paid" ? invoiced : 0;
      statements.push(`INSERT OR IGNORE INTO trade_work_orders
        (id, firebase_uid, partner_type, work_type, source_type, source_reference, work_number, title, service_category,
         site_area, stage, priority, scheduled_start, scheduled_end, assignee_member_id, assignee_label, revision,
         record_status, created_at, updated_at)
        VALUES (${sql(jobId)}, ${sql(installer.firebaseUid)}, 'installer', 'job', 'internal', '', ${sql(`JOB-${String(jobIndex).padStart(6, "0")}`)},
        ${sql(`${trades.find((trade) => trade[0] === category)?.[1] || "Home energy"} job`)}, ${sql(category)}, ${sql(`${installer.state.suburb} ${installer.state.postcode}`)},
        ${sql(stage)}, ${sql(jobIndex % 5 === 0 ? "high" : "standard")}, ${sql(date(startOffset))}, ${sql(date(startOffset + 1))}, '',
        ${sql(`Crew ${(jobIndex % 3) + 1}`)}, 1, 'active', ${sql(day(-20 + jobIndex))}, ${sql(now)});`);
      statements.push(`INSERT OR IGNORE INTO trade_crm_job_details
        (id, work_order_id, firebase_uid, crm_customer_id, customer_source, pipeline_stage, description, customer_reference,
         next_action, tags, estimated_value_cents, quoted_value_cents, invoiced_value_cents, paid_value_cents, quote_status,
         invoice_status, payment_due_at, created_at, updated_at)
        VALUES (${sql(stableId(BATCH, jobId, "detail"))}, ${sql(jobId)}, ${sql(installer.firebaseUid)}, ${sql(customerId)}, 'trade_owned', ${sql(pipeline)},
        ${sql("Synthetic job scope used to test navigation, field workflow, scheduling and financial summaries.")}, ${sql(`REF-${installerIndex + 1}-${jobIndex}`)},
        ${sql(stage === "blocked" ? "Confirm stock arrival" : "Review next scheduled step")}, ${sql(json(["synthetic", category]))}, ${estimated}, ${quoted},
        ${invoiced}, ${paid}, ${quoted ? "'draft'" : "'not_started'"}, ${invoiced ? (paid ? "'paid'" : "'sent'") : "'not_started'"},
        ${sql(date(startOffset + 14))}, ${sql(day(-20 + jobIndex))}, ${sql(now)});`);
      statements.push(`INSERT OR IGNORE INTO trade_crm_appointments
        (id, work_order_id, firebase_uid, appointment_type, title, starts_at, ends_at, assignee_label, status, notes, created_at, updated_at)
        VALUES (${sql(stableId(BATCH, jobId, "appointment"))}, ${sql(jobId)}, ${sql(installer.firebaseUid)}, ${sql(jobIndex % 3 === 0 ? "installation" : "site_visit")},
        ${sql(jobIndex % 3 === 0 ? "Installation visit" : "Site assessment")}, ${sql(day(startOffset))}, ${sql(day(startOffset).replace("09:00:00", "11:00:00"))},
        ${sql(`Crew ${(jobIndex % 3) + 1}`)}, ${sql(startOffset < 0 ? "completed" : "scheduled")}, 'Synthetic appointment for schedule testing.', ${sql(now)}, ${sql(now)});`);
      for (let taskIndex = 1; taskIndex <= 3; taskIndex += 1) statements.push(`INSERT OR IGNORE INTO trade_work_order_tasks
        (id, work_order_id, firebase_uid, title, due_at, status, completed_at, revision, sort_order, created_at, updated_at)
        VALUES (${sql(stableId(BATCH, jobId, "task", taskIndex))}, ${sql(jobId)}, ${sql(installer.firebaseUid)},
        ${sql(["Confirm site access", "Verify products and serials", "Complete handover record"][taskIndex - 1])}, ${sql(date(startOffset + taskIndex - 2))},
        ${sql(taskIndex === 1 && stage !== "backlog" ? "done" : "pending")}, ${sql(taskIndex === 1 && stage !== "backlog" ? day(startOffset - 1) : "")}, 1,
        ${taskIndex}, ${sql(now)}, ${sql(now)});`);
      statements.push(`INSERT OR IGNORE INTO trade_crm_job_notes
        (id, work_order_id, firebase_uid, note_type, body, issue_status, created_at, updated_at)
        VALUES (${sql(stableId(BATCH, jobId, "note"))}, ${sql(jobId)}, ${sql(installer.firebaseUid)}, ${sql(stage === "blocked" ? "issue" : "internal")},
        ${sql(stage === "blocked" ? "Synthetic stock delay requires a revised visit date." : "Synthetic benchmark note for CRM activity history.")},
        ${sql(stage === "blocked" ? "open" : "not_applicable")}, ${sql(now)}, ${sql(now)});`);
    }
    statements.push(`INSERT OR IGNORE INTO trade_crm_counters (firebase_uid, counter_key, last_value, updated_at)
      VALUES (${sql(installer.firebaseUid)}, 'job', 8, ${sql(now)});`);
    statements.push(`INSERT OR IGNORE INTO trade_crm_counters (firebase_uid, counter_key, last_value, updated_at)
      VALUES (${sql(installer.firebaseUid)}, 'customer', 5, ${sql(now)});`);
  }

  for (const [supplierIndex, supplier] of suppliers.entries()) {
    for (let productIndex = 0; productIndex < 3; productIndex += 1) {
      const template = productTemplates[(supplierIndex * 3 + productIndex) % productTemplates.length];
      const productId = stableId(BATCH, supplier.firebaseUid, "product", productIndex + 1);
      statements.push(`INSERT OR IGNORE INTO supplier_products
        (id, firebase_uid, model_number, brand, name, category, description, unit_price_cents_ex_gst, min_order_qty,
         order_increment, unit_label, stock_status, lead_time_days, warranty_years, datasheet_url, listing_status,
         review_status, review_note, is_synthetic, created_at, updated_at)
        VALUES (${sql(productId)}, ${sql(supplier.firebaseUid)}, ${sql(`${template[2]}-${String(supplierIndex + 1).padStart(2, "0")}-${productIndex + 1}`)},
        ${sql(template[1])}, ${sql(template[3])}, ${sql(template[0])}, ${sql("Synthetic approved trade product for catalogue, selection and order benchmarking.")},
        ${Number(template[4]) + supplierIndex * 100}, 1, 1, 'each', ${sql((supplierIndex + productIndex) % 4 === 0 ? "limited" : "in_stock")},
        ${(supplierIndex + productIndex) % 8}, ${Number(template[5])}, '', 'published', 'approved', 'Synthetic benchmark product', 1, ${sql(now)}, ${sql(now)});`);
    }
  }

  for (const [consumerIndex, consumer] of consumers.entries()) {
    const projectId = stableId(BATCH, consumer.firebaseUid, "project");
    const opportunityId = `customer-project:${projectId}`;
    const category = consumer.capabilities[0];
    const secondCategory = trades[(consumerIndex + 2) % 7][0];
    const categories = [...new Set([category, secondCategory])];
    const title = `${trades.find((trade) => trade[0] === category)?.[1] || "Home upgrade"} plan`;
    statements.push(`INSERT OR IGNORE INTO customer_accounts
      (firebase_uid, email, display_name, postcode, address_state, property_type, household_situation, account_updates,
       account_status, is_synthetic, consent_version, consent_at, created_at, updated_at)
      VALUES (${sql(consumer.firebaseUid)}, ${sql(consumer.email)}, ${sql(consumer.displayName)}, ${sql(consumer.state.postcode)}, ${sql(canonicalState(consumer.state.code))},
      'house', 'owner', 0, 'active', 1, 'synthetic-benchmark-v1', ${sql(now)}, ${sql(now)}, ${sql(now)});`);
    statements.push(`INSERT OR IGNORE INTO customer_projects
      (id, firebase_uid, title, home_nickname, postcode, address_state, property_type, household_situation, goal, pace,
       existing_features, service_categories, priorities, project_stage, timing, budget_range, private_notes, plan_snapshot,
       completed_plan_items, status, opportunity_id, submitted_at, archived_at, is_synthetic, created_at, updated_at)
      VALUES (${sql(projectId)}, ${sql(consumer.firebaseUid)}, ${sql(title)}, ${sql(`Demo home ${consumerIndex + 1}`)}, ${sql(consumer.state.postcode)},
      ${sql(canonicalState(consumer.state.code))}, 'house', 'owner', ${sql(projectGoals[consumerIndex % projectGoals.length])}, ${sql(consumerIndex % 3 === 0 ? "whole-home" : "staged")},
      ${sql(json(consumerIndex % 2 ? ["solar"] : []))}, ${sql(json(categories))}, ${sql(json([priorities[consumerIndex % priorities.length], priorities[(consumerIndex + 2) % priorities.length]]))},
      ${sql(consumerIndex % 4 === 0 ? "ready-for-pricing" : "exploring")}, ${sql(consumerIndex % 3 === 0 ? "within_30_days" : "planning")}, ${sql(["under_5k", "5_15k", "15_30k", "not_set"][consumerIndex % 4])},
      'Synthetic private planning note. This text is not shared with installers.', ${sql(json({ version: 1, synthetic: true, nextSteps: ["Compare options", "Review installer responses"] }))},
      '[]', 'matching', ${sql(opportunityId)}, ${sql(now)}, '', 1, ${sql(now)}, ${sql(now)});`);
    statements.push(`INSERT OR IGNORE INTO customer_consent_receipts
      (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
      VALUES (${sql(stableId(BATCH, projectId, "consent"))}, ${sql(consumer.firebaseUid)}, ${sql(projectId)}, 'private_installer_matching',
      'synthetic-benchmark-v1', ${sql(now)}, '', ${sql(now)});`);
    statements.push(`INSERT OR IGNORE INTO trade_opportunities
      (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status, source_reference,
       contact_limit, maximum_connected_installers, expires_at, expired_at, created_by_uid, is_synthetic, created_at, updated_at)
      VALUES (${sql(opportunityId)}, ${sql(title)}, ${sql(category)}, ${sql(consumer.state.postcode)}, ${sql(canonicalState(consumer.state.code))}, ${sql(json(categories))},
      ${sql(consumerIndex % 10 === 0 ? "priority" : "standard")}, ${sql(consumerIndex % 3 === 0 ? "within_30_days" : "planning")},
      ${sql(`Synthetic anonymised ${categories.join(" and ")} enquiry in ${consumer.state.code}.`)}, 'open', ${sql(opportunityId)}, 2, 3,
      ${sql(day(30))}, '', ${sql(consumer.firebaseUid)}, 1, ${sql(now)}, ${sql(now)});`);
    const eligible = installers.filter((installer) => installer.capabilities.includes(category));
    for (let rank = 0; rank < 6; rank += 1) {
      const installer = eligible[(consumerIndex + rank) % eligible.length];
      statements.push(`INSERT OR IGNORE INTO trade_opportunity_matches
        (id, opportunity_id, firebase_uid, status, admin_note, partner_note, matched_categories, distance_metres,
         allocation_rank, match_source, contact_attempt_count, last_contact_at, connected_at, matched_by_uid, matched_at, updated_at)
        VALUES (${sql(stableId(BATCH, opportunityId, installer.firebaseUid))}, ${sql(opportunityId)}, ${sql(installer.firebaseUid)},
        ${sql(rank === 0 && consumerIndex % 5 === 0 ? "viewed" : "offered")}, '', '', ${sql(json(categories.filter((item) => installer.capabilities.includes(item))))},
        ${5000 + rank * 9000}, ${rank + 1}, 'synthetic_benchmark', 0, '', '', 'synthetic-system', ${sql(now)}, ${sql(now)});`);
    }
  }
  return `-- Synthetic benchmark population. No real people, addresses, leads or billing records.\n-- Generated by scripts/seed-synthetic-population.mjs for ${BATCH}.\n${statements.join("\n--> statement-breakpoint\n")}\n`;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const drafts = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, "utf8"))
    : accountDrafts();
  fs.writeFileSync(checkpointPath, JSON.stringify(drafts, null, 2), { mode: 0o600 });
  let completed = drafts.filter((record) => record.firebaseUid);
  const pending = drafts.filter((record) => !record.firebaseUid);
  const created = await mapLimit(pending, brokerUrl ? 2 : 4, async (record) => {
    const result = await createAccount(record);
    const index = drafts.findIndex((draft) => draft.email === record.email);
    drafts[index] = result;
    fs.writeFileSync(checkpointPath, JSON.stringify(drafts, null, 2), { mode: 0o600 });
    return result;
  });
  completed = [...completed, ...created].sort((a, b) => a.accountType.localeCompare(b.accountType) || a.email.localeCompare(b.email));
  if (completed.length !== 350) throw new Error(`Expected 350 accounts but prepared ${completed.length}.`);
  writeCredentials(completed);
  fs.writeFileSync(sqlPath, buildSql(completed), "utf8");
  fs.rmSync(checkpointPath);
  const checksum = createHash("sha256").update(fs.readFileSync(csvPath)).digest("hex");
  process.stdout.write(JSON.stringify({ accounts: completed.length, installers: 100, wholesalers: 50, consumers: 200, csvPath, sqlPath, csvSha256: checksum }));
}

main().catch((error) => { process.stderr.write(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
