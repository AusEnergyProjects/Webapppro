import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const source=fs.readFileSync(new URL('../src/components/BookingTrainingLinks.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports={};
Function('require','exports',code)(id=>{assert.equal(id,'react/jsx-runtime');return jsx;},exports);
const nodes=(node,predicate)=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(child=>nodes(child,predicate)):[...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];

test('required module opens for the correct portal without replacing an unfinished booking',()=>{
  for(const teamPortal of [false,true]) {
    const tree=exports.BookingTrainingLinks({modules:[{id:'veu-6',title:'VEU Activity 6: space heating and cooling'}],teamPortal});
    const link=nodes(tree,node=>node.type==='a')[0];
    assert.equal(link.props.href,`/direct-trade/${teamPortal?'team':'dashboard'}?workspace=training&module=veu-6`);
    assert.equal(link.props.target,'_blank');
    assert.equal(link.props.rel,'noreferrer');
    assert.ok(link.props.children.includes('VEU Activity 6: space heating and cooling'));
  }
  assert.equal(exports.BookingTrainingLinks({modules:[]}),null);
});
