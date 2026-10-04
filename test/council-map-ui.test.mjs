import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as mapView from "../src/lib/council-map-view.ts";
import * as mapHeat from "../src/lib/council-map-heat.ts";

const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function load(relative, dependencies) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const code = transformSync(source, { loader: "tsx", format: "cjs", target: "es2022", jsx: "automatic" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, record, record.exports);
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
function renderer() {
  const states=[];let cursor=0,tree;
  const hooks={...React,useEffect(){},useRef:value=>({current:value}),useMemo:factory=>factory(),useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==="function"?initial():initial;return [states[index],value=>{states[index]=typeof value==="function"?value(states[index]):value;}];}};
  const {CouncilMap}=load("../src/components/council/CouncilMap.tsx",{
    react:hooks,"react/jsx-runtime":jsx,"@/lib/energy-service-catalogue.mjs":{ENERGY_SERVICE_LABELS:{}},
    "@/lib/google-maps-client":{},"@/lib/council-map-view":mapView,"@/lib/council-map-heat":mapHeat,"./CouncilPrimitives":primitives,"./CouncilMap.module.css":css,
  });
  function elements(element=tree,result=[]) {if(React.isValidElement(element)){result.push(element);React.Children.forEach(element.props.children,child=>elements(child,result));}return result;}
  return {render(publicLayers=[]){cursor=0;tree=CouncilMap({report,publicLayers});return renderToStaticMarkup(tree);},find(predicate){const found=elements().find(predicate);assert.ok(found,"Expected control not found");return found;},all(predicate){return elements().filter(predicate);}};
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

test("map colours match a numeric cool-to-hot legend while zero and unknown have no heat",()=>{
  const ui=renderer(),layers=[layer("public-upgrades",{"3805":12345,"3920":0,"3000":null,"3001":6172.5})];
  ui.render(layers);
  const anchor=postcode=>ui.find(node=>hasClass(node,"areaAnchor")&&node.key===postcode);
  assert.equal(anchor("3805").props.style["--heat-colour"],"rgb(220, 38, 38)");
  assert.equal(anchor("3001").props.style["--heat-colour"],"rgb(250, 204, 21)");
  assert.equal(anchor("3920").props.style["--heat-colour"],"rgb(37, 99, 235)");
  assert.notEqual(anchor("3000").props.style["--heat-colour"],anchor("3920").props.style["--heat-colour"]);
  for(const postcode of ["3920","3000"]) assert.doesNotMatch(renderToStaticMarkup(anchor(postcode)),/class="heat"/);
  assert.match(renderToStaticMarkup(anchor("3805")),/class="heat"/);
  assert.match(plain(renderToStaticMarkup(anchor("3920"))),/^3920 0$/);
  assert.match(plain(renderToStaticMarkup(anchor("3000"))),/^3000 Not available$/);
  const legend=ui.find(node=>hasClass(node,"legend"));
  assert.equal(legend.props["aria-label"],"Heat scale: 0 to 12,345 activities, across all reporting postcodes");
  assert.match(plain(renderToStaticMarkup(legend)),/activities 0 · Cool 12,345 · Hot Across all reporting postcodes/);
  assert.equal(ui.find(node=>node.type==="i").props.style.background,mapHeat.COUNCIL_MAP_HEAT_GRADIENT);
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
