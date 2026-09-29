import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeBrowserDevice} from '../src/lib/trade-browser-device.ts';

test('iOS browser guidance distinguishes Chrome, Safari, Edge, Firefox and embedded webviews',()=>{
  for(const [version,browser] of [['CriOS/140.0','chrome'],['Version/18.5','safari'],['EdgiOS/140.0','edge'],['FxiOS/140.0','firefox']]){
    assert.deepEqual(tradeBrowserDevice({userAgent:`Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 ${version} Mobile/15E148 Safari/604.1`}),
      {platform:'ios',browser,embedded:false,device:'iphone'});
  }
  assert.equal(tradeBrowserDevice({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5) AppleWebKit/605.1.15 Mobile/15E148'}).embedded,true);
  assert.equal(tradeBrowserDevice({userAgent:'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 GSA/123 Mobile/15E148 Safari/604.1'}).embedded,true);
});

test('iPad desktop mode and Home Screen apps are not mistaken for desktop or embedded browsers',()=>{
  assert.deepEqual(tradeBrowserDevice({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.5 Safari/605.1.15',maxTouchPoints:5}),
    {platform:'ios',browser:'safari',embedded:false,device:'ipad'});
  assert.deepEqual(tradeBrowserDevice({userAgent:'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148',standalone:true}),
    {platform:'ios',browser:'safari',embedded:false,device:'iphone'});
});

test('Android, desktop and unknown browser branches only describe observed user agents',()=>{
  assert.deepEqual(tradeBrowserDevice({userAgent:'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36'}),
    {platform:'android',browser:'chrome',embedded:false,device:'android'});
  assert.equal(tradeBrowserDevice({userAgent:'Mozilla/5.0 (Linux; Android 15; wv) Chrome/140.0 Mobile Safari/537.36'}).embedded,true);
  assert.equal(tradeBrowserDevice({userAgent:'Mozilla/5.0 (Linux; Android 15) SamsungBrowser/28.0 Chrome/140.0 Mobile Safari/537.36'}).browser,'unknown');
  assert.equal(tradeBrowserDevice({userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0'}).browser,'edge');
  assert.equal(tradeBrowserDevice({userAgent:'Mozilla/5.0 (Macintosh) Version/18.5 Safari/605.1.15',maxTouchPoints:0}).platform,'desktop');
  assert.deepEqual(tradeBrowserDevice({}),{platform:'desktop',browser:'unknown',embedded:false,device:'desktop'});
});
