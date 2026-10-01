import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadModule(file, dependencies) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', javascript)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}

function deviceHarness({ permission = { granted: true, canAskAgain: true }, muted = false, tokenError = false, permissionError = false } = {}) {
  const store = new Map([['aea-field-native-push-token-v1', 'old-token'], ['aea-field-device-id-v1', 'device-test-123']]);
  if (muted) store.set('aea-field-notifications-muted-v1', 'true');
  const calls = { requests: 0, tokens: 0, channels: [], categories: [], nativeConfigure: [], nativeDisable: [] };
  const api = loadModule('../src/lib/device.ts', {
    'expo-application': {}, 'expo-crypto': {}, 'expo-device': { isDevice: true },
    'expo-notifications': {
      AndroidImportance: { DEFAULT: 3, HIGH: 4 },
      setNotificationCategoryAsync: async (id, actions) => calls.categories.push({id,actions}),
      setNotificationChannelAsync: async (id) => calls.channels.push(id),
      getPermissionsAsync: async () => { if (permissionError) throw new Error('Permission unavailable'); return permission; },
      requestPermissionsAsync: async () => { calls.requests++; return { granted: true, canAskAgain: true }; },
      getDevicePushTokenAsync: async () => { calls.tokens++; if (tokenError) throw new Error('Registration offline'); return { data: 'fresh-token' }; },
    },
    'expo-secure-store': {
      getItemAsync: async (key) => store.get(key),
      setItemAsync: async (key, value) => { store.set(key, value); },
      deleteItemAsync: async (key) => { store.delete(key); },
    },
    'react-native': { Platform: { OS: 'android' } },
    '@/lib/native-system-calls': {disableNativeCalls:async preserveActiveCalls=>{calls.nativeDisable.push(preserveActiveCalls);},getNativeCallRegistration:async(configure)=>{calls.nativeConfigure.push(configure);return {voipPushToken:'',nativeCallCapable:true};}},
    '@/lib/config': { APP_VERSION: '1.0.1', MOBILE_PLATFORM: 'android' },
  });
  return { api, calls, store };
}

test('denied notifications clear the stale token and sync never repeats the permission prompt', async () => {
  const h = deviceHarness({ permission: { granted: false, canAskAgain: true } });
  assert.deepEqual(await h.api.getNativePushToken(), { token: '', provider: 'fcm' });
  assert.equal(h.store.has('aea-field-native-push-token-v1'), false);
  assert.equal(h.calls.requests, 0);
  assert.equal(h.calls.tokens, 0);
});

test('the explicit enable action requests permission and registers channels before obtaining a token', async () => {
  const h = deviceHarness({ permission: { granted: false, canAskAgain: true } });
  assert.deepEqual(await h.api.getNativePushToken(true), { token: 'fresh-token', provider: 'fcm' });
  assert.equal(h.calls.requests, 1);
  assert.deepEqual(h.calls.channels, ['field-sync', 'team-messages', 'team-calls']);
});

test('blocked system permission is not requested again even from enable', async () => {
  const h = deviceHarness({ permission: { granted: false, canAskAgain: false } });
  assert.equal((await h.api.getNativePushToken(true)).token, '');
  assert.equal(h.calls.requests, 0);
});

test('muted devices cannot silently re-register a cached push token', async () => {
  const h = deviceHarness();
  await h.api.setNotificationsMuted(true);
  assert.deepEqual(h.calls.nativeDisable,[true], 'muting future alerts preserves an ongoing native call');
  assert.equal(h.store.has('aea-field-native-push-token-v1'), false);
  assert.equal((await h.api.getNativePushToken(true)).token, '');
  assert.equal(h.calls.requests, 0);
  assert.equal(h.calls.tokens, 0);
});

test('registration outage reuses cache only after current permission is confirmed', async () => {
  assert.equal((await deviceHarness({ tokenError: true }).api.getNativePushToken()).token, 'old-token');
  assert.equal((await deviceHarness({ permissionError: true }).api.getNativePushToken()).token, '');
});

test('first approved sign-in prompts only once when permission has never been decided',async()=>{
 const h=deviceHarness({permission:{status:'undetermined',granted:false,canAskAgain:true}});
 await Promise.all([h.api.requestNotificationPermissionOnce(),h.api.requestNotificationPermissionOnce()]);await h.api.requestNotificationPermissionOnce();
 assert.equal(h.calls.requests,1);assert.equal(h.calls.tokens,1);
 assert.ok(h.calls.categories.some(category=>category.id==='team-messages'&&category.actions[0].identifier==='open-conversation'));
 for(const permission of [{status:'denied',granted:false,canAskAgain:true},{status:'granted',granted:true,canAskAgain:true}]){
  const decided=deviceHarness({permission});await decided.api.requestNotificationPermissionOnce();assert.equal(decided.calls.requests,0);
 }
});

test('token callbacks can persist full registration without registering for push again',async()=>{
 const h=deviceHarness();
 const registration=await h.api.deviceRegistration({pushToken:'rotated-token',refreshNativeCalls:false});
 assert.equal(registration.pushToken,'rotated-token');assert.equal(registration.nativeCallCapable,true);
 assert.equal(h.calls.tokens,0);assert.deepEqual(h.calls.nativeConfigure,[false]);
 await h.api.setNotificationsMuted(true);
 const muted=await h.api.deviceRegistration({pushToken:'rotated-token',refreshNativeCalls:false});
 assert.equal(muted.pushToken,'');assert.equal(muted.voipPushToken,'');assert.equal(muted.nativeCallCapable,false);
 assert.deepEqual(h.calls.nativeDisable,[true,true], 'both mute and late registration cleanup preserve the active call');
});

test('foreground alerts respect mute and expiry; notification actions route only to validated conversations',async()=>{
 let handler;
 const team=loadModule('../src/lib/team-messages.ts',{});
 const notifications=loadModule('../src/lib/notifications.ts',{
  'expo-notifications':{DEFAULT_ACTION_IDENTIFIER:'default',setNotificationHandler:value=>{handler=value;}},
  '@/lib/device':{notificationsMuted:async()=>false},'@/lib/team-messages':team,
 });
 const data={type:'team_call',threadId:'thread-1234',callId:'call-1234',expiresAt:'2000-01-01'};
 assert.deepEqual(notifications.notificationResponseTarget(data,'default'),{threadId:'thread-1234'});
 assert.equal(notifications.notificationResponseTarget(data,'dismiss'),null);
 assert.equal(notifications.notificationResponseTarget({...data,threadId:'https://evil.test'},'open-call'),null);
 for(const invalid of [data,{type:'team_call_ended'}])assert.equal((await handler.handleNotification({request:{content:{data:invalid}}})).shouldShowBanner,false);
 const message={type:'team_message',threadId:'thread-1234',url:'https://evil.test'};
 assert.deepEqual(notifications.notificationResponseTarget(message,'open-conversation'),{threadId:'thread-1234'});
 assert.equal((await handler.handleNotification({request:{content:{data:message}}})).shouldPlaySound,true);
});

test('settings mute waits for in-flight registration to settle before posting the disabled token state',async()=>{
 const events=[];let release;const barrier=new Promise(resolve=>{release=resolve;});
 let stateIndex=0;
 const jsx=(type,props)=>({type,props});
 const api=loadModule('../src/components/device-notification-settings.tsx',{
  'react':{useCallback:value=>value,useEffect:()=>{},useRef:value=>({current:value}),useState:initial=>[stateIndex++===0?{granted:true,muted:false,physicalDevice:true,canAskAgain:true}:initial,()=>{}]},
  'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Platform:{OS:'android'},AppState:{addEventListener:()=>({remove(){}})},Linking:{},StyleSheet:{create:value=>value},Switch:'Switch',Text:'Text',View:'View'},
  '@/components/field-button':{FieldButton:'Button'},
  '@/lib/native-system-calls':{getAndroidCallNotificationStatus:async()=>null},
  '@/lib/use-business-api':{useBusinessApi:()=>async(_path,init)=>{if(init?.method==='POST'){events.push('post-disabled');assert.equal(JSON.parse(init.body).pushToken,'');}return {native:{configured:true,registered:false}};}},
  '@/providers/app-provider':{useApp:()=>({sync:{online:true},waitForNotificationRegistrations:async()=>{events.push('wait');await barrier;}})},
  '@/lib/device-registration':{persistDeviceRegistration:async persist=>{events.push('registration');await persist({pushToken:'',voipPushToken:'',nativeCallCapable:false});}},
  '@/lib/device':{setNotificationsMuted:async value=>{events.push(`muted:${value}`);},notificationDeviceState:async()=>({granted:true,muted:true,physicalDevice:true,canAskAgain:true}),getDeviceId:async()=>'device-1234',getNativePushToken:async()=>assert.fail('muting must not request token')},
  '@/lib/sync':{resolveFieldAccessModes:async()=>['trade_team']},'@/lib/theme':{colours:{},radius:{},spacing:{}},
 });
 const view=api.DeviceNotificationSettings();
 const find=node=>!node||typeof node!=='object'?null:node.type==='Switch'?node:(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).map(find).find(Boolean);
 find(view).props.onValueChange(false);
 await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(events,['muted:true','wait']);
 release();await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(events,['muted:true','wait','registration','post-disabled']);
});

function teamHarness() {
  const api = loadModule('../src/lib/team-messages.ts', {});
  return { api };
}

test('team notifications accept only bounded conversation references, never supplied URLs', () => {
  const { api } = teamHarness();
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_call', threadId: 'thread-1', callId: 'call-1', url: 'https://evil.example' }), { threadId: 'thread-1', callId: 'call-1' });
  for (const data of [null, {}, [], { type: 'other', threadId: 'a' }, { type: 'team_message', threadId: '../admin' }, { type: 'team_message', threadId: 'a'.repeat(161) }]) {
    assert.equal(api.teamNotificationTarget(data), null);
  }
});

test('native notification targets never create browser handoffs or accept URLs', () => {
  const { api } = teamHarness();
  assert.equal(api.openTeamMessages, undefined);
  assert.equal(api.trustedTeamHandoffUrl, undefined);
  assert.equal(api.teamNotificationTarget({ type: 'team_message', threadId: 'https://evil.example' }), null);
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_message', threadId: 'thread-1', url: 'https://evil.example' }), { threadId: 'thread-1' });
});

test('call invitation navigation cannot carry an invalid call reference', () => {
  const { api } = teamHarness();
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_call', threadId: 'thread-1', callId: '../admin' }), { threadId: 'thread-1' });
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_message', threadId: 'thread-1', callId: 'ignored-call' }), { threadId: 'thread-1' });
});
