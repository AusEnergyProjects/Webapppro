import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root=fileURLToPath(new URL('../',import.meta.url));
const browserPath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(value=>value&&fs.existsSync(value));
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {WattzunRecordPicker} from './src/components/WattzunRecordPicker';
  const app=createRoot(document.getElementById('root'));
  window.renderPicker=(uid='actor-one',scopeId='business-one',portal='trade',kind='job')=>app.render(<WattzunRecordPicker user={{uid,getIdToken:async()=>'synthetic-token:'+uid}} scope={{portal,scopeId,label:'Synthetic business'}} lookup={{kind,query:'TL123'}} onNavigate={href=>window.openedJob=href}/>);
  window.renderPicker();
`},bundle:true,write:false,outfile:'records.js',format:'iife',jsx:'automatic',plugins:[{name:'record-test-alias',setup(builder){builder.onResolve({filter:/^@\/lib\//},args=>({path:path.join(root,'src/lib',args.path.slice('@/lib/'.length)+'.ts')}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
let browser;
test.before(async()=>{if(browserPath)browser=await chromium.launch({executablePath:browserPath,headless:true});});
test.after(async()=>{await browser?.close();});
async function pageFixture({width=1366}={}){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('https://fixture.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
  await page.goto('https://fixture.invalid/');
  await page.setContent('<style>*{box-sizing:border-box}body{font-family:Arial;margin:12px}'+css+'</style><div id="root"></div>');
  await page.evaluate(()=>{
    window.requests=[];window.pendingResolve=null;window.responseMode='ok';
    window.fetch=async(url,init)=>{
      const headers=new Headers(init.headers);window.requests.push({url:String(url),authorization:headers.get('authorization'),business:headers.get('x-tlink-business')});
      if(window.responseMode==='deferred')return new Promise(resolve=>{window.pendingResolve=()=>resolve(Response.json({ok:true,items:[{id:'old-job',workNumber:'OLD',title:'Old actor private title'}]}));});
      if(window.responseMode==='forbidden')return Response.json({ok:false,error:'Job access was revoked.'},{status:403});
      if(window.responseMode==='bad')return Response.json({ok:true,items:[{id:'../escape',workNumber:'BAD',title:'Forged record'}]});
      return Response.json({ok:true,items:[{id:'job-one',workNumber:'TL123',title:'Synthetic inspection',customerEmail:'hidden@example.invalid'}]});
    };
  });
  await page.addScriptTag({content:js});
  await page.getByRole('button',{name:'Find job',exact:true}).waitFor();
  return page;
}

test('job selection uses the authorised business, projected metadata and real known job destination',{skip:!browserPath},async()=>{
  const page=await pageFixture();try{
    assert.equal(await page.evaluate(()=>window.requests.length),0);
    await page.getByRole('button',{name:'Find job',exact:true}).click();
    const job=page.getByRole('button',{name:/TL123.*Synthetic inspection/});await job.waitFor();
    const requests=await page.evaluate(()=>window.requests);assert.equal(requests.length,1);assert.equal(requests[0].business,'business-one');assert.equal(requests[0].authorization,'Bearer synthetic-token:actor-one');
    const query=new URL(requests[0].url,'https://fixture.invalid').searchParams;assert.equal(query.get('resource'),'jobs');assert.equal(query.get('filter'),'all');assert.equal(query.get('search'),'TL123');
    assert.equal(await page.getByText('hidden@example.invalid',{exact:true}).count(),0);
    await job.click();assert.equal(await page.evaluate(()=>window.openedJob),'/direct-trade/dashboard?workspace=work&jobId=job-one&jobTab=summary');
  }finally{await page.close();}
});
test('revoked access and malformed search rows cannot open a record',{skip:!browserPath},async()=>{
  const page=await pageFixture();try{for(const mode of ['forbidden','bad']){
    await page.evaluate(mode=>window.responseMode=mode,mode);await page.getByRole('button',{name:'Find job',exact:true}).click();await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button',{name:/Open job/}).count(),0);assert.equal(await page.evaluate(()=>window.openedJob),undefined);
  }}finally{await page.close();}
});
test('scope or actor replacement discards pending metadata and completed old results',{skip:!browserPath},async()=>{
  const page=await pageFixture();try{
    await page.evaluate(()=>window.responseMode='deferred');await page.getByRole('button',{name:'Find job',exact:true}).click();await page.waitForFunction(()=>Boolean(window.pendingResolve));
    await page.evaluate(()=>{window.renderPicker('actor-two','business-two');window.pendingResolve();});
    await page.getByRole('button',{name:'Find job',exact:true}).waitFor();assert.equal(await page.getByText('Old actor private title',{exact:true}).count(),0);
    await page.evaluate(()=>window.responseMode='ok');await page.getByRole('button',{name:'Find job',exact:true}).click();await page.getByRole('button',{name:/Synthetic inspection/}).waitFor();
    assert.equal((await page.evaluate(()=>window.requests)).at(-1).business,'business-two');
    await page.evaluate(()=>window.renderPicker('actor-two','business-three'));assert.equal(await page.getByRole('button',{name:/Synthetic inspection/}).count(),0);
    await page.evaluate(()=>window.renderPicker('actor-two','business-three','council'));assert.equal(await page.getByRole('button',{name:'Find job',exact:true}).count(),0);
  }finally{await page.close();}
});

test('changing the search discards late results before another exact job can be chosen',{skip:!browserPath},async()=>{
  const page=await pageFixture();try{
    await page.evaluate(()=>window.responseMode='deferred');await page.getByRole('button',{name:'Find job',exact:true}).click();await page.waitForFunction(()=>Boolean(window.pendingResolve));
    await page.getByLabel('Job number or customer name').fill('TL456');
    await page.evaluate(()=>{window.pendingResolve();window.responseMode='ok';});
    assert.equal(await page.getByText('Old actor private title',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Find job',exact:true}).click();await page.getByRole('button',{name:/Synthetic inspection/}).waitFor();
    assert.equal(new URL((await page.evaluate(()=>window.requests)).at(-1).url,'https://fixture.invalid').searchParams.get('search'),'TL456');
  }finally{await page.close();}
});
test('mobile file lookup opens the existing Files tab with usable controls',{skip:!browserPath},async()=>{
  const page=await pageFixture({width:390});try{
    await page.evaluate(()=>window.renderPicker('actor-one','business-one','trade','file'));await page.getByRole('heading',{name:'Choose the job for this file'}).waitFor();
    await page.getByRole('button',{name:'Find job',exact:true}).click();const file=page.getByRole('button',{name:/Open Files/});await file.waitFor();await file.click();
    assert.equal(await page.evaluate(()=>window.openedJob),'/direct-trade/dashboard?workspace=work&jobId=job-one&jobTab=field');
    assert.ok(await page.getByRole('button',{name:'Find job',exact:true}).evaluate(el=>el.getBoundingClientRect().height)>=44);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
  }finally{await page.close();}
});
