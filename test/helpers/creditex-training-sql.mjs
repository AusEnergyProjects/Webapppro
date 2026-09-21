import { certificateTestDependency, installCreditexTrainingFixture } from './creditex-training-fixture.mjs';
const { certificateLeadEligibilitySql } = certificateTestDependency('trade-certificate-leads');
const { tradeOpportunityOwnerScopeSql, aeaTradeOwnerSql } = certificateTestDependency('aea-trade-owner-server');

export function expandCreditexLeadSql(sql) {
  return sql.replaceAll(/\$\{(?:await )?certificateLeadEligibilitySql\("([^"]+)", "([^"]+)", "([^"]+)"\)\}/g,
    (_, owner, categories, state) => certificateLeadEligibilitySql(owner, categories, state))
    .replaceAll(/\$\{tradeOpportunityOwnerScopeSql\("([^"]+)", "([^"]+)"\)\}/g, (_, opportunity, owner) => tradeOpportunityOwnerScopeSql(opportunity, owner))
    .replaceAll(/\$\{aeaTradeOwnerSql\("([^"]+)"\)\}/g, (_, owner) => aeaTradeOwnerSql(owner));
}

export function qualifyLeadFixture(database) {
  for (const [table, column, fallback] of [
    ['trade_opportunities', 'state', 'VIC'],
    ['trade_opportunity_matches', 'matched_categories', '["solar"]'],
  ]) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.length && !columns.some(item => item.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT '${fallback}'`);
    }
  }
  installCreditexTrainingFixture(database);
}
