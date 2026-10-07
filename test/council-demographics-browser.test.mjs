import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root=fileURLToPath(new URL("../",import.meta.url));
const browserPath=[process.env.TEST_BROWSER_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium"].find(value=>value&&fs.existsSync(value));
const bundle=await build({stdin:{resolveDir:root,loader:"tsx",contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';import {CouncilMap} from './src/components/council/CouncilMap';
  const postcodes=['3805','3806','3977'];
  const report={mode:'demonstration',scope:{councilId:'fixture',name:'Synthetic council',state:'VIC',postcodes},generatedAt:'2026-10-07T00:00:00Z',period:{key:'all',label:'All time',timeZone:'Australia/Melbourne'},metrics:{completedJobs:0},postcodes:[],dataQuality:{suppressed:false,suppressedBreakdowns:[]},map:{cells:postcodes.map((postcode,index)=>({postcode,label:'Area '+postcode,position:{lat:-38.04-index*.015,lng:145.29+index*.012},completedJobs:0,registeredLocalBusinesses:0}))}};
  createRoot(document.getElementById('root')).render(<CouncilMap report={report}/>);
`},bundle:true,write:false,outfile:"fixture.js",format:"iife",jsx:"automatic",plugins:[{name:"local-aliases",setup(builder){builder.onResolve({filter:/^@\/lib\//},args=>({path:path.join(root,"src/lib",`${args.path.slice('@/lib/'.length)}${path.extname(args.path)?'':'.ts'}`)}));}}]});
const script=bundle.outputFiles.find(file=>file.path.endsWith(".js")).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith(".css")).text;

test("Council Census layers and postcode comparisons work on desktop and mobile without page overflow",{skip:!browserPath},async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try{
    for(const width of [1366,390]){
      const page=await browser.newPage({viewport:{width,height:950},hasTouch:width<500});
      const errors=[];page.on("pageerror",error=>errors.push(error.message));
      await page.route("**/*",route=>{
        const url=new URL(route.request().url());
        if(url.hostname!=="fixture.invalid")return route.abort();
        if(url.pathname.startsWith("/data/"))return route.fulfill({status:200,contentType:"application/json",body:fs.readFileSync(path.join(root,"public",url.pathname))});
        return route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><html></html>"});
      });
      await page.goto("https://fixture.invalid/");
      await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;padding:16px;font-family:Arial,sans-serif;background:#f2f7f5}#root{max-width:1280px;margin:auto}${css}</style></head><body><div id="root"></div></body></html>`);
      await page.addScriptTag({content:script});
      await page.getByLabel("Map intensity").selectOption("census-renterPercent");
      await page.getByText("3 of 3 reporting postcodes have an ABS 2021 profile.",{exact:false}).waitFor();
      await page.getByRole("button",{name:/^3805: 22.6 % of occupied private dwellings/}).click();
      const panel=page.getByRole("complementary",{name:"Postcode 3805 breakdown"});
      await panel.getByRole("heading",{name:"Community demographics"}).waitFor();
      assert.match(await panel.innerText(),/58,600/);
      assert.match(await panel.innerText(),/5.9 percentage points below state/);
      await panel.getByText("Use this in upgrade planning",{exact:true}).click();
      assert.equal(await panel.getByText("Compare rental share when planning information for tenants, landlords and property managers.",{exact:true}).isVisible(),true);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      assert.equal(overflow,false,`Page must fit ${width}px`);
      assert.deepEqual(errors,[]);
      if(process.env.COUNCIL_DEMOGRAPHICS_SCREENSHOTS){fs.mkdirSync(process.env.COUNCIL_DEMOGRAPHICS_SCREENSHOTS,{recursive:true});await panel.screenshot({path:path.join(process.env.COUNCIL_DEMOGRAPHICS_SCREENSHOTS,`demographics-${width}.png`)});}
      await page.close();
    }
  }finally{await browser.close();}
});
