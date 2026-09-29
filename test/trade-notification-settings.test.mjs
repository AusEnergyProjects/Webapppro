import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {tradeBrowserDevice} from '../src/lib/trade-device-client.ts';
const require=createRequire(import.meta.url),record={exports:{}};
const source=fs.readFileSync(new URL('../src/components/TradeNotificationSettings.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',compiled)(name=>name.endsWith('.css')?{}:name==='./TradeBusinessProvider'?{useTradeBusinessFetch:()=>fetch}:name==='@/lib/trade-device-client'?{tradeBrowserDevice}:require(name),record,record.exports);
const {notificationApplicationKey,notificationDeviceSupport}=record.exports;
test('iPhone and iPad browsers explain Home Screen installation before permission requests',()=>{
  assert.equal(notificationDeviceSupport('iPhone',5,false,false),'home-screen');
  assert.equal(notificationDeviceSupport('Macintosh',5,false,true),'home-screen');
  assert.equal(notificationDeviceSupport('iPad',5,true,true),'ready');
  assert.equal(notificationDeviceSupport('Android',5,false,true),'ready');
  assert.equal(notificationDeviceSupport('Macintosh',0,false,false),'unsupported');
});
test('application server public key is validated before a browser permission request',()=>{
  const key=Buffer.from([4,...Array.from({length:64},(_,i)=>i)]).toString('base64url');
  assert.equal(notificationApplicationKey(key).length,65);assert.equal(notificationApplicationKey(key)[0],4);
  for(const bad of ['',key.slice(1),key.replace(/^B/,'A'),'https://key.example'])assert.throws(()=>notificationApplicationKey(bad),/unavailable/);
});
