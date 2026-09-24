import assert from 'node:assert/strict';
import test from 'node:test';
import { changeEditorCondition, conditionFields, editorConditionLockReason, conditionSummary } from '../src/lib/creditex-form-conditions.ts';
import { editorFormPages, addEditorPageQuestion, moveEditorQuestion, reorderEditorQuestion, dropEditorQuestion } from '../src/lib/creditex-form-pages.ts';
import { activityWizardPages, expandedActivityFields } from '../src/lib/trade-activity-form-flow.ts';
import { text, nodes, catalogue, masterForm, button, edit, flush, harness } from './helpers/creditex-master-editor-fixture.mjs';
const field=(key, section='Checks', extra={})=>({key,section,label:key,type:'boolean',phase:'before',required:false,options:[],help:'',...extra});
const form=(fields,declarations=[])=>({id:'map',activityTemplateId:'test',programCode:'TEST',variantId:'',variantOptions:[],title:'Map',version:1,fields,declarations,sources:[],reviewNotes:[]});

test('map connections write the same conditions used by app pages and survive JSON save/reopen',()=>{
  const source=form([field('custom.a'),field('custom.b','Details'),field('custom.c','Details')]);
  const linked=changeEditorCondition(source,'custom.b',{fieldKey:'custom.a',equals:false});
  const saved=JSON.parse(JSON.stringify(linked));
  assert.equal(source.fields[1].condition,undefined);
  assert.deepEqual(expandedActivityFields(saved,{'custom.a':true}).map(f=>f.key),['custom.a','custom.c']);
  assert.deepEqual(expandedActivityFields(saved,{'custom.a':false}).map(f=>f.key),['custom.a','custom.b','custom.c']);
  assert.equal(changeEditorCondition(saved,'custom.b').fields[1].condition,undefined);
  assert.match(conditionSummary(saved.fields[1].condition,saved),/custom.a is No/);
});
test('page cards add and move questions using real app page membership',()=>{
  const source=form([field('custom.a'),field('custom.b','Details')]);
  const added=addEditorPageQuestion(source,'custom.a');
  assert.deepEqual(editorFormPages(added.form)[0].fieldKeys,['custom.a',added.selectedFieldKey]);
  const moved=moveEditorQuestion(added.form,added.selectedFieldKey,'custom.b').form;
  assert.deepEqual(activityWizardPages(moved,{}).filter(p=>p.kind==='fields').map(p=>p.fields.map(f=>f.key)),[['custom.a'],['custom.b',added.selectedFieldKey]]);
});

test('drag ordering keeps the page, hidden fields and other pages intact across save and reopen',()=>{
  const hidden=field('binding.customer','Automatic',{presentation:'derived'});
  const source=form([field('a'),hidden,field('b'),field('c'),field('other','Next')]);
  const reordered=reorderEditorQuestion(source,'c','a','before').form;
  assert.deepEqual(reordered.fields.map(f=>f.key),['c','binding.customer','a','b','other']);
  assert.equal(reordered.fields[1],hidden);
  assert.deepEqual(editorFormPages(JSON.parse(JSON.stringify(reordered)))[0].fieldKeys,['c','a','b']);
  assert.equal(reorderEditorQuestion(reordered,'c','a','before').form,reordered);
  assert.throws(()=>reorderEditorQuestion(source,'a','other','after'),/same page/);
});

test('drag ordering rejects governed fields, broken dependency order and eight-question page crossings',()=>{
  const source=form([field('a'),field('b','Checks',{condition:{fieldKey:'a',equals:true}}),field('locked','Checks',{sourceRequirementId:'required'})]);
  assert.throws(()=>reorderEditorQuestion(source,'b','a','before'),/answer before/);
  assert.throws(()=>reorderEditorQuestion(source,'locked','a','before'),/program or profile/);
  const split=form(Array.from({length:9},(_,i)=>field('item'+i)));
  assert.throws(()=>reorderEditorQuestion(split,'item8','item0','before'),/same page/);
  const indirect=form([field('a'),field('hidden','Checks',{presentation:'derived',condition:{fieldKey:'a',equals:true}}),field('c','Checks',{condition:{fieldKey:'hidden',equals:true}})]);
  assert.throws(()=>reorderEditorQuestion(indirect,'c','a','before'),/answer before/);
});

test('dragging onto another card moves page membership at the exact drop position',()=>{
  const source=form([field('a','First'),field('b','First'),field('c','Second'),field('d','Second')]);
  const moved=dropEditorQuestion(source,'b','d','before').form;
  assert.deepEqual(editorFormPages(moved).map(p=>p.fieldKeys),[['a'],['c','b','d']]);
  assert.equal(moved.fields.find(f=>f.key==='b').section,'Second');
  const differentStage={...source,fields:source.fields.map(f=>f.key==='c'||f.key==='d'?{...f,phase:'after'}:f)};
  assert.throws(()=>dropEditorQuestion(differentStage,'b','c','after'),/same before-work or after-work/);
  const full=form([field('a','First'),...Array.from({length:8},(_,i)=>field('next'+i,'Second'))]);
  assert.throws(()=>dropEditorQuestion(full,'a','next0','before'),/already has 8/);
  const branches=form([field('a','First'),field('b','Second',{condition:{fieldKey:'a',equals:true}})]);
  assert.throws(()=>dropEditorQuestion(branches,'a','b','after'),/answer before/);
});
test('map rejects question loops, page loops, incompatible phases and repeating sources',()=>{
  const source=form([field('custom.a','A'),field('custom.b','B',{condition:{fieldKey:'custom.a',equals:true}}),field('custom.c','A')]);
  assert.throws(()=>changeEditorCondition(source,'custom.a',{fieldKey:'custom.b',equals:true}),/loop/);
  assert.throws(()=>changeEditorCondition(source,'custom.c',{fieldKey:'custom.b',equals:true}),/pages depend/);
  const repeated=form([field('custom.a','A',{repeatGroup:'rooms'}),field('custom.b','B'),field('custom.c','B',{phase:'after'}),field('custom.d','A',{repeatGroup:'rooms'})]);
  assert.throws(()=>changeEditorCondition(repeated,'custom.b',{fieldKey:'custom.a',equals:true}),/repeated item/);
  assert.throws(()=>changeEditorCondition(repeated,'custom.b',{fieldKey:'custom.c',equals:true}),/work stages|earlier answer/);
  assert.ok(conditionFields(repeated,'custom.d','before').some(f=>f.key==='custom.a'));
  assert.ok(conditionFields(repeated,'custom.d','before').some(f=>f.key==='custom.b'));
});
test('governed evidence, profile values, prescribed signatures and policy-owned capacities cannot receive map rules',()=>{
  const source=form([field('custom.a'),field('required','Checks',{sourceRequirementId:'regulator'})]);
  assert.throws(()=>changeEditorCondition(source,'required',{fieldKey:'custom.a',equals:true}),/required program/);
  const capacity={...form([field('custom.a'),field('installed_product.indoor_heating_kw')]),activityTemplateId:'veu-6'};
  assert.ok(editorConditionLockReason(capacity,'installed_product.indoor_heating_kw'));
  const signature={key:'custom.sign',title:'Sign',text:'Agree',phase:'after',role:'customer',required:false,sourceUrl:'https://example.invalid',sourceTextSha256:'fixed'};
  assert.throws(()=>changeEditorCondition(form([field('a')],[signature]),'@declaration:custom.sign',{fieldKey:'a',equals:true}),/required program/);
});
test('advanced rules remain intact until an explicit replacement or removal',()=>{
  const rule={all:[{fieldKey:'a',equals:true},{any:[{fieldKey:'b',equals:true},{fieldKey:'b',equals:false}]}]};
  const source=form([field('a'),field('b'),field('c','Checks',{condition:rule})]);
  conditionFields(source,'c','before'); conditionSummary(rule,source);
  assert.deepEqual(source.fields[2].condition,rule);
  assert.deepEqual(changeEditorCondition(source,'c',{fieldKey:'a',equals:false}).fields[2].condition,{fieldKey:'a',equals:false});
});
test('normal form view is default, map updates the shared form/phone and saves through the existing API',async()=>{
  const sample={...masterForm,fields:[field('custom.a'),field('custom.b')]};
  const h=harness({respond:async(path,init)=>init?.method==='POST'?{form:JSON.parse(init.body).form,expectedVersion:3}:path.includes('activityTemplateId')?{form:sample,expectedVersion:2}:{catalogue}});
  let tree=await h.mount(); edit(tree).props.onClick();await flush();tree=h.render();
  assert.equal(button(tree,'Form editor').props['aria-pressed'],true);
  const mapButton=nodes(tree,n=>n.type==='button'&&text(n).includes('TLink Mind Map'))[0];mapButton.props.onClick();tree=h.render();
  const map=nodes(tree,n=>n.type==='form-mind-map')[0];
  assert.equal(map.props.editable,true);
  assert.equal(map.props.onDropQuestion('custom.b','custom.a','before'),true); tree=h.render();
  assert.deepEqual(nodes(tree,n=>n.type==='phone-preview')[0].props.form.fields.map(f=>f.key),['custom.b','custom.a']);
  const reorderedMap=nodes(tree,n=>n.type==='form-mind-map')[0];
  assert.equal(reorderedMap.props.onDropQuestion('custom.a','custom.b','before'),true); tree=h.render();
  assert.equal(nodes(tree,n=>n.type==='form-mind-map')[0].props.onCondition('custom.b',{fieldKey:'custom.a',equals:false}),true);tree=h.render();
  const phone=nodes(tree,n=>n.type==='phone-preview')[0];assert.deepEqual(phone.props.form.fields[1].condition,{fieldKey:'custom.a',equals:false});
  assert.match(text(tree),/Unsaved changes/);
  button(tree,'Save and publish master').props.onClick();await flush();tree=h.render();
  assert.equal(h.calls.at(-1).body.action,'save_master');
  assert.deepEqual(h.calls.at(-1).body.form.fields[1].condition,{fieldKey:'custom.a',equals:false});
});

test('editing, renaming and deletion stay inside the mind map using the same editor controls',async()=>{
  const h=harness({respond:async path=>path.includes('activityTemplateId')?{form:masterForm,expectedVersion:2}:{catalogue}});
  let tree=await h.mount();edit(tree).props.onClick();await flush();tree=h.render();
  nodes(tree,n=>n.type==='button'&&text(n).includes('TLink Mind Map'))[0].props.onClick();tree=h.render();
  nodes(tree,n=>n.type==='form-mind-map')[0].props.onEdit('custom.comment');tree=h.render();
  assert.equal(button(tree,'Form editor').props['aria-pressed'],false);
  let map=nodes(tree,n=>n.type==='form-mind-map')[0];
  const questionInput=nodes(map.props.editor,n=>n.type==='input'&&n.props.value==='Extra comment')[0];
  questionInput.props.onChange({target:{value:'Edited inside map'}});tree=h.render();
  assert.equal(nodes(tree,n=>n.type==='phone-preview')[0].props.form.fields[0].label,'Edited inside map');
  map=nodes(tree,n=>n.type==='form-mind-map')[0];map.props.onDelete('question','custom.comment');tree=h.render();
  map=nodes(tree,n=>n.type==='form-mind-map')[0];assert.match(text(map.props.editor),/Confirm delete question/);
  assert.equal(button(tree,'Form editor').props['aria-pressed'],false);
  map.props.onCloseEditor();tree=h.render();assert.equal(nodes(tree,n=>n.type==='form-mind-map')[0].props.editor,null);
});
test('read-only map shares preview selection but cannot mutate a form',async()=>{
  const h=harness({canAuthor:false,respond:async path=>path.includes('activityTemplateId')?{form:masterForm,expectedVersion:2}:{catalogue}});
  let tree=await h.mount();nodes(tree,n=>n.type==='button'&&n.props['aria-label']?.startsWith('Preview VEU'))[0].props.onClick();await flush();tree=h.render();
  nodes(tree,n=>n.type==='button'&&text(n).includes('TLink Mind Map'))[0].props.onClick();tree=h.render();
  const map=nodes(tree,n=>n.type==='form-mind-map')[0];assert.equal(map.props.editable,false);
  assert.equal(map.props.onCondition('custom.comment',{fieldKey:'required.photo',equals:true}),false);
  assert.equal(h.calls.length,2);
});
