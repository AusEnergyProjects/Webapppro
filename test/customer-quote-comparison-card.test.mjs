import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {SOLAR_EQUIPMENT_LABELS} from '../src/lib/trade-solar-equipment.ts';

const compiled=ts.transpileModule(readFileSync(new URL('../src/components/CustomerQuoteComparisonCard.tsx',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;
const loaded={};
Function('require','exports',compiled)(name=>{
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/trade-solar-equipment')return {SOLAR_EQUIPMENT_LABELS};
  if(name.endsWith('.module.css'))return {default:new Proxy({},{get:(_,key)=>key})};
  throw new Error('Unexpected comparison dependency: '+name);
},loaded);
const comparison={id:'quote',scope:'Install panels, inverter and monitoring. Check switchboard access.',terms:'Excludes asbestos removal',validUntil:'2099-01-01',totalCents:100000,quotedTotalCents:600000,defaultChoiceNames:['Solar package'],
  equipment:[{kind:'inverter',name:'Quoted inverter',manufacturer:'Demo manufacturer',model:'INV-5',quantity:1,watts:5000,warrantyYears:10}],items:[],
  choices:[{id:'solar',kind:'package',groupKey:'system',name:'Solar package',summary:'Panels and installation',totalCents:500000,fullTotalCents:600000,includedChoiceNames:[],items:[],equipment:[{kind:'panel',name:'Quoted panel',manufacturer:'Demo Solar',model:'P-440',quantity:15,watts:440,warrantyYears:25,datasheetUrl:'https://manufacturer.com/panel.pdf'}]}]};
const render=value=>renderToStaticMarkup(jsx.jsx(loaded.CustomerQuoteComparisonCard,{comparison:value,business:'Demo installer',services:'Solar',busy:false,onOpen(){}}));

test('equipment and scope are visible before complete package totals, with models and stated warranties',()=>{
  const html=render(comparison);
  for(const fact of ['Install panels, inverter and monitoring','INV-5','5 kW','10 years stated','P-440','440 W per panel','6.6 kW across 15 panels','25 years stated'])assert.ok(html.includes(fact),fact);
  assert.ok(html.indexOf('INV-5')<html.indexOf('$6,000.00'));
  assert.ok(html.indexOf('P-440')<html.indexOf('$6,000.00'));
  assert.match(html,/Full quoted total with this option, including GST/);
  assert.doesNotMatch(html,/\+\$5,000\.00|best value|cheapest|winner|backup coverage/i);
  assert.match(html,/href="https:\/\/manufacturer.com\/panel.pdf" target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/Confirm the warranty type, conditions and workmanship cover/);
  assert.match(html,/Excludes asbestos removal/);
});

test('each option retains its exact equipment and full total, including other named default choices',()=>{
  const value={...comparison,choices:[...comparison.choices,{id:'battery',kind:'package',groupKey:'system',name:'Solar and battery',summary:'Battery with solar',totalCents:1000000,fullTotalCents:1130000,includedChoiceNames:['Advanced controls'],items:[],equipment:[{kind:'battery',name:'Quoted battery',manufacturer:'Demo Battery',model:'B-10',quantity:1,capacityKwh:10,warrantyYears:10}]}]};
  const html=render(value);
  const start=html.indexOf('aria-label="Solar and battery"'),end=html.indexOf('</section>',start);
  const packageHtml=html.slice(start,end);
  assert.match(packageHtml,/B-10/);assert.doesNotMatch(packageHtml,/P-440/);
  assert.match(packageHtml,/10 kWh as quoted/);assert.match(packageHtml,/\$11,300\.00/);
  assert.match(packageHtml,/Also includes the quoted default choices: Advanced controls/);
  assert.match(html,/Confirm usable capacity and backup coverage, including the circuits and backup hardware/);
  assert.doesNotMatch(html,/10 kWh usable|whole.home backup|guaranteed backup/i);
});

test('missing equipment, capacity and warranty stay unknown instead of receiving assumed specifications',()=>{
  const value={...comparison,scope:'',terms:'',defaultChoiceNames:[],quotedTotalCents:100000,choices:[],equipment:[{kind:'battery',name:'Battery specified in quote',manufacturer:'',model:'B-unknown',quantity:1}]};
  const html=render(value);
  assert.match(html,/Manufacturer<\/dt><dd>Not provided/);
  assert.match(html,/Capacity<\/dt><dd>Not provided/);
  assert.match(html,/Warranty<\/dt><dd>Not provided/);
  assert.match(html,/Scope note not provided/);assert.match(html,/Confirm terms and exclusions/);
  assert.doesNotMatch(html,/0 kWh|0 years|default.*battery/i);
  const noEquipment=render({...value,equipment:[]});
  assert.match(noEquipment,/Equipment models and capacities not provided separately/);
  assert.doesNotMatch(noEquipment,/backup coverage/);
});

test('hot water capacity and optional extras remain separate from the complete quote',()=>{
  const value={...comparison,quotedTotalCents:100000,defaultChoiceNames:[],equipment:[{kind:'hot_water',name:'Quoted hot water unit',manufacturer:'Demo Hot Water',model:'HW-250',quantity:1,capacityLitres:250}],choices:[{id:'pipework',kind:'addon',groupKey:'extras',name:'Extra pipework',summary:'Only if selected',totalCents:22000,fullTotalCents:null,includedChoiceNames:[],items:[],equipment:[]}]};
  const html=render(value);
  assert.match(html,/HW-250/);assert.match(html,/250 L/);
  assert.match(html,/Quoted total before optional extras/);assert.match(html,/\$1,000\.00/);
  assert.match(html,/Optional extra: \+\$220\.00 including GST/);
  assert.doesNotMatch(html,/\$1,220\.00|Full quoted total with this option/);
});
