import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../db/schema.ts',import.meta.url),'utf8').replace(/^export \* from .*;\r?$/gm,'');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiledModule={exports:{}};
new Function('require','module','exports',compiled)(require,compiledModule,compiledModule.exports);
const {tradeSalesJobMetadata,tradeTeamMembers,tradeWorkOrders}=compiledModule.exports;

test('Sales schema retains migration composite tenant keys and restrict foreign keys',()=>{
  const jobIndex=getTableConfig(tradeWorkOrders).indexes.find(index=>index.config.name==='trade_work_orders_sales_owner_id_idx');
  const memberIndex=getTableConfig(tradeTeamMembers).indexes.find(index=>index.config.name==='trade_team_members_owner_id_idx');
  assert.equal(jobIndex.config.unique,true);assert.deepEqual(jobIndex.config.columns.map(column=>column.name),['firebase_uid','id']);
  assert.equal(memberIndex.config.unique,true);assert.deepEqual(memberIndex.config.columns.map(column=>column.name),['owner_uid','id']);
  const config=getTableConfig(tradeSalesJobMetadata);
  assert.deepEqual(config.primaryKeys[0].columns.map(column=>column.name),['owner_uid','work_order_id']);
  assert.deepEqual(config.foreignKeys.map(key=>({columns:key.reference().columns.map(column=>column.name),foreignColumns:key.reference().foreignColumns.map(column=>column.name),onDelete:key.onDelete})),[
    {columns:['owner_uid','work_order_id'],foreignColumns:['firebase_uid','id'],onDelete:'restrict'},
    {columns:['owner_uid','owner_member_id'],foreignColumns:['owner_uid','id'],onDelete:'restrict'},
  ]);
});
