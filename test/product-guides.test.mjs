import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import {renderToStaticMarkup} from "react-dom/server";
import {PUBLIC_SITE,buildPlatformMetadata} from "../src/lib/public-site.ts";
import {searchPublicSite} from "../src/lib/public-site-search.ts";
function compile(relative, dependencies) {
 const compiled=ts.transpileModule(readFileSync(new URL(relative,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const loaded={}; Function("require","exports",compiled)(name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},loaded);return loaded;
}
const datasets=Object.fromEntries(["solar","inverters","batteries","hot-water","air-conditioning"].map(slug=>["./product-guides/"+slug+".json",{default:JSON.parse(readFileSync(new URL("../src/lib/product-guides/"+slug+".json",import.meta.url),"utf8"))}]));
const guide=compile("../src/lib/product-guides.ts",datasets);
const dependencies={
 "react/jsx-runtime":jsx,
 "next/link":{default:({children,...props})=>jsx.jsx("a",{...props,children})},
 "next/navigation":{notFound(){throw new Error("NOT_FOUND");}},
 "@/components/GuideShell":{GuideShell:({title,children})=>jsx.jsxs("main",{children:[jsx.jsx("h1",{children:title}),children]}),GuideSection:({title,children})=>jsx.jsxs("section",{children:[jsx.jsx("h2",{children:title}),children]})},
 "@/components/JsonLd":{JsonLd:({data})=>jsx.jsx("script",{type:"application/ld+json",dangerouslySetInnerHTML:{__html:JSON.stringify(data)}})},
 "@/lib/product-guides":guide,"@/lib/public-site":{PUBLIC_SITE,buildPlatformMetadata},
 "../../page.module.css":{default:new Proxy({},{get:(_,key)=>String(key)})},"../page.module.css":{default:new Proxy({},{get:(_,key)=>String(key)})},
};
const categoryPage=compile("../src/app/guides/products/[category]/page.tsx",dependencies);
const overview=compile("../src/app/guides/products/page.tsx",dependencies);
test("five categories contain 20 distinct source-backed families without scores or prices",()=>{
 assert.deepEqual(guide.PRODUCT_GUIDE_CATEGORIES.map(c=>c.slug),["solar","inverters","batteries","hot-water","air-conditioning"]);
 const identifiers=[];
 for(const category of guide.PRODUCT_GUIDE_CATEGORIES) {
  assert.equal(category.options.length,20,category.slug);assert.equal(new Set(category.options.map(o=>o.name)).size,20);
  for(const option of category.options) {
   identifiers.push(option.id);assert.match(option.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
   for(const field of ["name","group","fit","why","check"])assert.ok(option[field].trim(),option.id+":"+field);
   assert.equal(option.checkedAt,"2026-10-10");assert.ok(option.sources.length);
   for(const source of option.sources){assert.equal(new URL(source.url).protocol,"https:");assert.ok(source.title&&source.kind&&source.revision,option.id);}
   for(const field of ["score","price","rank","rating","reviewCount"])assert.equal(Object.hasOwn(option,field),false);
   assert.doesNotMatch([option.fit,option.why,option.check].join(" "),/[\u2013\u2014]/);
  }
 }
 assert.equal(new Set(identifiers).size,100);
});
test("all household advice is visible with matching unordered schema and safety boundaries",async()=>{
 for(const category of guide.PRODUCT_GUIDE_CATEGORIES) {
  const html=renderToStaticMarkup(await categoryPage.default({params:Promise.resolve({category:category.slug})}));
  assert.equal((html.match(/<article /g)||[]).length,20);assert.equal((html.match(/<h4>/g)||[]).length,20);
  assert.doesNotMatch(html,/<details|<form|<input/);
  const schema=JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
  assert.equal(schema.mainEntity.numberOfItems,20);assert.equal(schema.mainEntity.itemListOrder,"https://schema.org/ItemListUnordered");
  assert.equal(schema.mainEntity.itemListElement.length,20);
  for(const option of category.options) {
   assert.ok(html.includes('id="'+option.id+'"'),option.id);
   assert.ok(schema.mainEntity.itemListElement.some(item=>item.url.endsWith("#"+option.id)));
   for(const source of option.sources)assert.ok(html.includes(source.url.replaceAll("&","&amp;")),source.url);
  }
  assert.match(html,/Why consider it:/);assert.match(html,/Check before choosing:/);assert.match(html,/approval, local stock, eligibility/);
  if(category.slug==="hot-water"){assert.match(html,/apricus-all-in-one/);assert.match(html,/recall/i);assert.match(html,/serial/i);}
  if(category.slug==="batteries")assert.match(html,/older 8\/10\/12 kW single-phase/);
 }
});
test("category routes have canonical metadata and missing categories return not-found",async()=>{
 assert.deepEqual(categoryPage.generateStaticParams().map(p=>p.category),guide.PRODUCT_GUIDE_CATEGORIES.map(c=>c.slug));
 for(const category of guide.PRODUCT_GUIDE_CATEGORIES) {
  const metadata=await categoryPage.generateMetadata({params:Promise.resolve({category:category.slug})});
  assert.equal(metadata.alternates.canonical,PUBLIC_SITE.apexUrl+"/guides/products/"+category.slug);
 }
 assert.equal(guide.findProductGuideCategory("missing"),undefined);
 await assert.rejects(categoryPage.default({params:Promise.resolve({category:"missing"})}),/NOT_FOUND/);
 await assert.rejects(categoryPage.generateMetadata({params:Promise.resolve({category:"missing"})}),/NOT_FOUND/);
});
test("overview explains evidence limits and search discovers options by brands",()=>{
 const html=renderToStaticMarkup(overview.default());
 for(const category of guide.PRODUCT_GUIDE_CATEGORIES)assert.ok(html.includes('href="/guides/products/'+category.slug+'"'));
 assert.match(html,/have not installed or tested these 100 options/);assert.match(html,/preference survey is different/);
 assert.match(html,/established brands with an Australian presence/);assert.match(html,/online star ratings or review counts do not determine the selection/);
 assert.match(html,/rather than routinely testing every unit in a lab/);assert.doesNotMatch(html,/aggregateRating|reviewRating/);
 for(const [query,expected] of [["product guide","/guides/products"],["aiko rec panels","/guides/products/solar"],["fronius sma inverter","/guides/products/inverters"],["foxess sigenstor","/guides/products/batteries"],["sanden istore","/guides/products/hot-water"],["daikin mitsubishi","/guides/products/air-conditioning"]])assert.equal(searchPublicSite(query)[0]?.path,expected,query);
});
