import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
for (const file of fs.readdirSync("drizzle").filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
  const migration = fs.readFileSync(`drizzle/${file}`, "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
}
const count = (table, where = "") => Number(db.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get().count);
const summary = {
  installers: count("trade_accounts", "WHERE is_synthetic = 1 AND partner_type = 'installer'"),
  wholesalers: count("trade_accounts", "WHERE is_synthetic = 1 AND partner_type = 'supplier'"),
  consumers: count("customer_accounts", "WHERE is_synthetic = 1"),
  products: count("supplier_products", "WHERE is_synthetic = 1"),
  projects: count("customer_projects", "WHERE is_synthetic = 1"),
  opportunities: count("trade_opportunities", "WHERE is_synthetic = 1"),
  matches: count("trade_opportunity_matches"),
  crmCustomers: count("trade_crm_customers"),
  crmJobs: count("trade_crm_job_details"),
  appointments: count("trade_crm_appointments"),
  tasks: count("trade_work_order_tasks"),
};
const expected = { installers: 100, wholesalers: 50, consumers: 200, products: 150, projects: 200, opportunities: 200, matches: 600, crmCustomers: 500, crmJobs: 800, appointments: 800, tasks: 2400 };
for (const [key, value] of Object.entries(expected)) if (summary[key] !== value) throw new Error(`${key} expected ${value} but found ${summary[key]}`);
const invalidSupplierCounts = db.prepare(`SELECT COUNT(*) count FROM (
  SELECT firebase_uid FROM supplier_products WHERE is_synthetic = 1 GROUP BY firebase_uid HAVING COUNT(*) != 3
)`).get().count;
if (Number(invalidSupplierCounts)) throw new Error("Every synthetic wholesaler must own exactly three products.");
const nonPremiumTrades = db.prepare(`SELECT COUNT(*) count FROM trade_accounts
  WHERE is_synthetic = 1 AND (billing_status != 'active' OR verification_status != 'approved')`).get().count;
if (Number(nonPremiumTrades)) throw new Error("Every synthetic trade account must be approved and premium.");
process.stdout.write(JSON.stringify(summary));
