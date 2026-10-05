import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as mapView from "../src/lib/council-map-view.ts";
import * as mapHeat from "../src/lib/council-map-heat.ts";
import * as mapBoundaries from "../src/lib/council-postcode-boundaries.ts";

const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function load(relative, dependencies) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const code = transformSync(source, { loader: "tsx", format: "cjs", target: "es2022", jsx: "automatic" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", "window", code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, record, record.exports, {matchMedia:()=>({matches:false})});
  return record.exports;
}
const primitives = load("../src/components/council/CouncilPrimitives.tsx", { "react/jsx-runtime": jsx, "./CouncilWorkspace.module.css": css });
const postcodes = ["3805", "3920", ...Array.from({length:71},(_,index)=>String(3000+index))];
const report = {
  mode:"demonstration",generatedAt:"2026-10-05T00:00:00Z",
  scope:{councilId:"fixture",name:"Map test council",state:"VIC",postcodes},
  period:{key:"year",label:"This year",timeZone:"Australia/Melbourne"},metrics:{completedJobs:0},
  map:{cells:postcodes.map((postcode,index)=>({postcode,label:`Area ${postcode}`,position:{lat:-38-index*.003,lng:145+index*.004},completedJobs:0,registeredLocalBusinesses:0})),boundaryNote:"Approximate postcode centres only."},
};
function layer(id, values = {}) {
  return { id,label:id === "public-upgrades" ? "Approved community upgrades" : "Public solar installations",unit:"activities",sourceLabel:"Public test source · 2026",
    postcodes:postcodes.map(postcode=>({postcode,value:Object.hasOwn(values,postcode)?values[postcode]:12})) };
}
function renderer(boundaries=[]) {
  const states=[],effects=[],refs=[];let cursor=0,refCursor=0,tree;
  const hooks={...React,useEffect(effect){effects.push(effect);},useRef(value){const index=refCursor++;return refs[index]??(refs[index]={current:value});},useMemo:factory=>factory(),useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==="function"?initial():initial;return [states[index],value=>{states[index]=typeof value==="function"?value(states[index]):value;}];}};
  const {CouncilMap}=load("../src/components/council/CouncilMap.tsx",{
    react:hooks,"react/jsx-runtime":jsx,"@/lib/energy-service-catalogue.mjs":{ENERGY_SERVICE_LABELS:{}},
    "@/lib/google-maps-client":{},"@/lib/council-map-view":mapView,"@/lib/council-map-heat":mapHeat,"@/lib/council-postcode-boundaries":{...mapBoundaries,loadCouncilPostcodeBoundaries:async()=>({features:boundaries,missingPostcodes:[]})},"./CouncilPostcodeDetails":{CouncilPostcodeDetails:()=>null},"./CouncilPrimitives":primitives,"./CouncilMap.module.css":css,
  });
  function elements(element=tree,result=[]) {if(React.isValidElement(element)){result.push(element);React.Children.forEach(element.props.children,child=>elements(child,result));}return result;}
  return {render(publicLayers=[]){cursor=0;refCursor=0;effects.length=0;tree=CouncilMap({report,publicLayers});return renderToStaticMarkup(tree);},async load(){for(const effect of effects)effect();await Promise.resolve();},find(predicate){const found=elements().find(predicate);assert.ok(found,"Expected control not found");return found;},all(predicate){return elements().filter(predicate);}};
}
const plain=html=>html.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const hasClass=(node,name)=>node.props.className?.split(" ").includes(name);

test("all 73 map postcodes retain complete numeric labels and operable marker buttons",()=>{
  const values=Object.fromEntries(postcodes.map((postcode,index)=>[postcode,12345+index]));
  const ui=renderer(),html=ui.render([layer("public-upgrades",values)]);
  const labels=ui.all(node=>hasClass(node,"postcode"));
  assert.equal(labels.length,73);
  for(const postcode of postcodes) {
    const marker=ui.find(node=>node.type==="button"&&node.props["aria-label"]?.startsWith(`${postcode}:`));
    const markerText=plain(renderToStaticMarkup(marker));
    assert.match(markerText,new RegExp(`^${postcode} ${values[postcode].toLocaleString("en-AU")}$`));
    assert.equal(marker.props.type,"button");
    assert.equal(typeof marker.props.onClick,"function");
  }
  assert.match(plain(html),/73 of 73 postcodes in view/);
  assert.doesNotMatch(renderToStaticMarkup(labels[0]),/12\.3K|12k|No data/);
});

test("map colours match the distribution bands and numeric legend while zero and unknown stay distinct",()=>{
  const ui=renderer(),layers=[layer("public-upgrades",{"3805":12345,"3920":0,"3000":null,"3001":6172.5})];
  ui.render(layers);
  const anchor=postcode=>ui.find(node=>hasClass(node,"areaAnchor")&&node.key===postcode);
  assert.equal(anchor("3805").props.style["--heat-colour"],"rgb(220, 38, 38)");
  assert.equal(anchor("3001").props.style["--heat-colour"],"rgb(220, 38, 38)");
  assert.equal(anchor("3920").props.style["--heat-colour"],"rgb(37, 99, 235)");
  assert.notEqual(anchor("3000").props.style["--heat-colour"],anchor("3920").props.style["--heat-colour"]);
  for(const postcode of ["3920","3000"]) assert.doesNotMatch(renderToStaticMarkup(anchor(postcode)),/class="heat"/);
  assert.match(renderToStaticMarkup(anchor("3805")),/class="heat"/);
  assert.match(plain(renderToStaticMarkup(anchor("3920"))),/^3920 0$/);
  assert.match(plain(renderToStaticMarkup(anchor("3000"))),/^3000 Not available$/);
  const legend=ui.find(node=>hasClass(node,"legend"));
  assert.equal(legend.props["aria-label"],"Heat colour bands in activities, across all reporting postcodes");
  assert.match(plain(renderToStaticMarkup(legend)),/activities · lower to higher 0 12 6,172.5 to 12,345 Not available Colours compare postcodes/);
  const swatches=ui.all(node=>node.type==="i").map(node=>node.props.style.background);
  assert.deepEqual(swatches,["rgb(37, 99, 235)","rgb(37, 99, 235)","rgb(220, 38, 38)","#85909a"]);
  ui.find(node=>node.type==="button"&&React.Children.toArray(node.props.children).includes("Public data heat")).props.onClick();
  ui.render(layers);
  assert.equal(ui.all(node=>hasClass(node,"heat")).length,0);
  assert.equal(ui.all(node=>hasClass(node,"legend")).length,0);
  assert.equal(ui.all(node=>hasClass(node,"postcode")).length,73,"Turning heat off must preserve postcode and number labels");
});

test("asynchronous public layers become the default without overriding explicit TLink selection",()=>{
  const ui=renderer();ui.render();
  ui.render([layer("solar")]);assert.equal(ui.find(node=>node.type==="select").props.value,"solar");
  ui.render([layer("solar"),layer("public-upgrades")]);assert.equal(ui.find(node=>node.type==="select").props.value,"public-upgrades");
  ui.find(node=>node.type==="select").props.onChange({target:{value:""}});
  const html=ui.render([layer("solar"),layer("public-upgrades")]);
  assert.equal(ui.find(node=>node.type==="select").props.value,"");
  assert.match(plain(html),/No completed TLink upgrades are recorded/);
  assert.equal(ui.all(node=>node.props.className?.split(" ").includes("legend")).length,0);
});

test("73-postcode listing is bounded, pageable and searchable including unavailable values",()=>{
  const ui=renderer(),layers=[layer("public-upgrades",{"3805":0,"3920":null})];
  const first=ui.render(layers);
  assert.match(plain(first),/1 to 8 of 73 postcodes/);
  assert.equal(ui.all(node=>node.type==="tbody")[0].props.children.length,8);
  assert.doesNotMatch(first,/areaCards|leaders|NaN|Infinity/);
  ui.find(node=>node.type==="button"&&node.props.children==="Next").props.onClick();
  assert.match(plain(ui.render(layers)),/9 to 16 of 73 postcodes/);
  ui.find(node=>node.type==="input"&&node.props.placeholder==="Postcode or area").props.onChange({target:{value:"3920"}});
  const missing=ui.render(layers);
  assert.match(plain(missing),/1 to 1 of 1 postcodes/);
  assert.match(plain(renderToStaticMarkup(ui.all(node=>node.type==="tbody")[0])),/3920.*Not available/);
  ui.find(node=>node.type==="input"&&node.props.placeholder==="Postcode or area").props.onChange({target:{value:"3805"}});
  ui.render(layers);
  assert.match(plain(renderToStaticMarkup(ui.all(node=>node.type==="tbody")[0])),/3805 Area 3805 0 0 0/);
  ui.find(node=>node.type==="input"&&node.props.placeholder==="Postcode or area").props.onChange({target:{value:"missing"}});
  assert.match(plain(ui.render(layers)),/No reporting postcodes match your search/);
});

test("non-finite public values never produce heat, numeric markup or a false zero",()=>{
  const ui=renderer(),layers=[layer("public-upgrades",{"3805":NaN,"3920":Infinity})];
  const html=ui.render(layers);
  assert.doesNotMatch(html,/NaN|Infinity/);
  const rows=plain(renderToStaticMarkup(ui.all(node=>node.type==="tbody")[0]));
  assert.match(rows,/3805 Area 3805 Not available/);assert.match(rows,/3920 Area 3920 Not available/);
  assert.match(plain(html),/Public test source · 2026/);
});

test("map selection, keyboard zoom and Fit retain genuine coordinate anchors",()=>{
  const ui=renderer(),layers=[layer("public-upgrades")];ui.render(layers);
  const marker=()=>ui.find(node=>node.type==="button"&&node.props["aria-label"]?.startsWith("3805:"));
  marker().props.onClick();ui.render(layers);assert.equal(marker().props["aria-pressed"],true);
  let prevented=false;
  const map=ui.find(node=>node.props.role==="region"&&node.props["aria-label"]?.startsWith("Interactive postcode"));
  const target={};map.props.onKeyDown({target,currentTarget:target,key:"+",preventDefault(){prevented=true;}});ui.render(layers);assert.equal(prevented,true);
  ui.find(node=>node.type==="button"&&node.props.className==="fit").props.onClick();ui.render(layers);assert.equal(marker().props["aria-pressed"],false);
});

test("loaded boundaries replace heat spots, preserve missing data and select the postcode breakdown",async()=>{
  const boundaries=mapBoundaries.parseCouncilPostcodeBoundaries({type:"FeatureCollection",features:["3805","3920","3000"].map((postcode,index)=>({type:"Feature",properties:{postcode},geometry:{type:"Polygon",coordinates:[[[144.999+index*.004,-38.001-index*.003],[145.001+index*.004,-38.001-index*.003],[145.001+index*.004,-37.999-index*.003],[144.999+index*.004,-37.999-index*.003],[144.999+index*.004,-38.001-index*.003]]]}}))});
  const ui=renderer(boundaries),layers=[layer("public-upgrades",{"3805":12,"3920":0,"3000":null})];
  ui.render(layers);await ui.load();const html=ui.render(layers);
  assert.match(plain(html),/3 of 73 postcode boundaries available/);
  const paths=ui.all(node=>node.type==="path"&&node.props["data-postcode"]);
  assert.equal(paths.length,3);
  assert.equal(paths.find(node=>node.props["data-postcode"]==="3920").props.fill,"rgb(37, 99, 235)");
  assert.equal(paths.find(node=>node.props["data-postcode"]==="3000").props.strokeDasharray,"4 3");
  assert.equal(paths[0].props.fillRule,"evenodd");
  for(const postcode of ["3805","3920","3000"]){
    const anchor=ui.find(node=>hasClass(node,"areaAnchor")&&node.key===postcode);
    assert.equal(React.Children.toArray(anchor.props.children).some(child=>hasClass(child,"heat")),false);
  }
  ui.find(node=>node.type==="button"&&node.props["aria-label"]?.startsWith("3805:")).props.onClick();
  ui.render(layers);
  assert.equal(ui.find(node=>node.type==="aside").props["aria-label"],"Postcode 3805 breakdown");
  assert.ok(ui.all(node=>node.type==="path"&&node.props.strokeWidth===3).length>0);
});


test("dragging from a postcode label pans by the pointer distance and suppresses only its drag click",()=>{
  const ui=renderer();ui.render([layer("public-upgrades")]);
  const map=()=>ui.find(node=>node.props.role==="region"&&node.props["aria-label"]?.startsWith("Interactive postcode"));
  const anchor=()=>ui.find(node=>hasClass(node,"areaAnchor")&&node.key==="3805");
  const before={...anchor().props.style};
  const captured=new Set();
  let focused=false;
  const markerTarget={focus(){focused=true;}};
  const currentTarget={focus(){focused=true;},setPointerCapture(id){captured.add(id);},hasPointerCapture(id){return captured.has(id);},releasePointerCapture(id){captured.delete(id);}};
  const event=(x,y)=>({pointerId:1,pointerType:"mouse",isPrimary:true,button:0,buttons:1,clientX:x,clientY:y,currentTarget,target:{closest:()=>markerTarget},preventDefault(){},stopPropagation(){}});
  map().props.onPointerDownCapture(event(300,250));
  assert.equal(focused,true,"Pointer focus must survive default-event suppression");
  map().props.onPointerMoveCapture(event(303,251));
  ui.render([layer("public-upgrades")]);
  assert.equal(anchor().props.style.left,before.left,"Click jitter must not move the map");
  map().props.onPointerMoveCapture(event(420,290));
  ui.render([layer("public-upgrades")]);
  assert.ok(Math.abs(anchor().props.style.left-before.left-120)<1e-6);
  assert.ok(Math.abs(anchor().props.style.top-before.top-40)<1e-6);
  assert.equal(captured.has(1),true);
  map().props.onPointerUpCapture(event(420,290));
  assert.equal(captured.size,0);
  let prevented=false,stopped=false;
  map().props.onClickCapture({...event(420,290),detail:1,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(prevented,true);assert.equal(stopped,true);
  prevented=false;stopped=false;
  map().props.onClickCapture({...event(420,290),detail:0,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(prevented,false,"Keyboard activation must remain available after a drag");assert.equal(stopped,false);
  const stable={...anchor().props.style};
  map().props.onPointerDownCapture(event(300,250));
  map().props.onPointerMoveCapture({...event(390,280),buttons:0});
  ui.render([layer("public-upgrades")]);
  assert.equal(anchor().props.style.left,stable.left,"Releasing outside must not leave hover dragging the map");
  assert.equal(captured.size,0);
  const marker=ui.find(node=>node.type==="button"&&node.props["aria-label"]?.startsWith("3805:"));
  marker.props.onClick();ui.render();assert.equal(ui.find(node=>node.type==="aside").props["aria-label"],"Postcode 3805 breakdown");
});
