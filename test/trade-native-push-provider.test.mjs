import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jose from 'jose';
import * as pure from '../src/lib/trade-push.ts';

const source=fs.readFileSync(new URL('../src/lib/trade-native-push-provider.ts',import.meta.url),'utf8');
const loadedModule={exports:{}};
const dependencies={'cloudflare:workers':{env:{}},jose,'./trade-push':pure};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
  (name=>{assert.ok(Object.hasOwn(dependencies,name));return dependencies[name];},loadedModule,loadedModule.exports);
const provider=loadedModule.exports;
const {privateKey,publicKey}=await jose.generateKeyPair('RS256',{extractable:true});
const privatePem=await jose.exportPKCS8(privateKey);
const serviceAccount={type:'service_account',project_id:'australian-energy-assessments',client_email:'tlink-notifications@australian-energy-assessments.iam.gserviceaccount.com',private_key:privatePem};
const credentials={clientEmail:serviceAccount.client_email,privateKey:privatePem};
const authorization={accessToken:'synthetic-oauth-token',expiresAt:Date.now()+3600000};
const payload={v:1,kind:'team-call',id:'call-1234',threadId:'thread-1234',title:'Private name',body:'Incoming team video call',url:'https://evil.test/',expiresAt:new Date(Date.now()+60000).toISOString()};
const token='synthetic:android_registration_token_123456789';

test('native credentials prefer dedicated connection, validate project, and permit explicitly configured existing connection reuse',()=>{
 assert.equal(provider.tradeNativePushCredentials({}),null);
 assert.deepEqual(provider.tradeNativePushCredentials({TLINK_FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)}),credentials);
 assert.deepEqual(provider.tradeNativePushCredentials({FIREBASE_AUTH_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)}),credentials);
 assert.equal(provider.tradeNativePushCredentials({TLINK_FCM_SERVICE_ACCOUNT_JSON:'broken',FIREBASE_AUTH_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)}),null);
 for(const value of [{...serviceAccount,project_id:'foreign-project'},{...serviceAccount,client_email:'attacker@example.test'},{...serviceAccount,private_key:'bad'}])assert.equal(provider.tradeNativePushCredentials({TLINK_FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(value)}),null);
});

test('OAuth uses signed short-lived assertion with only Firebase messaging scope and fixed Google endpoint',async()=>{
 let observed;
 const result=await provider.authorizeTradeNativePush(credentials,async(url,init)=>{observed={url,init};return Response.json({token_type:'Bearer',access_token:'test-token',expires_in:3600});});
 assert.equal(observed.url,'https://oauth2.googleapis.com/token');assert.equal(observed.init.redirect,'manual');assert.ok(observed.init.signal instanceof AbortSignal);
 assert.equal(observed.init.body.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
 const {payload:claims}=await jose.jwtVerify(observed.init.body.get('assertion'),publicKey,{issuer:serviceAccount.client_email,audience:observed.url});
 assert.equal(claims.scope,'https://www.googleapis.com/auth/firebase.messaging');assert.equal(claims.exp-claims.iat,300);
 assert.equal(result.accessToken,'test-token');assert.ok(result.expiresAt>Date.now()+3500000);
 for(const response of [Response.json({error:'unauthorized'},{status:403}),Response.json({token_type:'Bearer',access_token:'test-token',expires_in:0})])assert.equal(await provider.authorizeTradeNativePush(credentials,async()=>response),null);
});

test('Android push has generic private notification, existing app routing, proper channel and bounded call TTL',async()=>{
 let observed;
 assert.equal(await provider.sendTradeNativePush(token,payload,authorization,async(url,init)=>{observed={url,init};return Response.json({name:'projects/australian-energy-assessments/messages/received'});}),'accepted');
 assert.equal(observed.url,'https://fcm.googleapis.com/v1/projects/australian-energy-assessments/messages:send');
 assert.equal(observed.init.redirect,'manual');assert.ok(observed.init.signal instanceof AbortSignal);
 const {message}=JSON.parse(observed.init.body);assert.equal(message.token,token);assert.equal(message.notification.title,'TLink');assert.equal(message.notification.body,'Incoming team video call');
 assert.deepEqual(message.data,{type:'team_call',threadId:'thread-1234',eventId:'call-1234',callId:'call-1234',expiresAt:payload.expiresAt});
 assert.equal(message.android.priority,'HIGH');assert.equal(message.android.notification.channel_id,'team-calls');assert.equal(message.android.notification.visibility,'PRIVATE');assert.ok(parseInt(message.android.ttl)<=60);
 assert.doesNotMatch(observed.init.body,/Private name|evil\.test|private_key|client_email/);
 await provider.sendTradeNativePush(token,{...payload,kind:'team-message',body:'Private content'},authorization,async(_url,init)=>{
  const {message:sent}=JSON.parse(init.body);assert.equal(sent.data.type,'team_message');assert.equal(sent.data.callId,undefined);assert.equal(sent.android.notification.channel_id,'team-messages');assert.equal(sent.notification.body,'New team message');return Response.json({name:'projects/australian-energy-assessments/messages/received'});
 });
});

test('only explicit FCM token rejection disables a registration, while failures and stale calls stay distinct',async()=>{
 const failure=(errorCode,status=400)=>Response.json({error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode}]}},{status});
 assert.equal(await provider.sendTradeNativePush(token,payload,authorization,async()=>failure('UNREGISTERED',404)),'expired');
 for(const response of [failure('INVALID_ARGUMENT'),failure('SENDER_ID_MISMATCH',403),Response.json({error:{status:'INVALID_ARGUMENT',details:[{'@type':'type.googleapis.com/google.rpc.BadRequest'}]}},{status:400}),Response.json({error:{status:'PERMISSION_DENIED'}},{status:403})])assert.equal(await provider.sendTradeNativePush(token,payload,authorization,async()=>response),'failed');
 assert.equal(await provider.sendTradeNativePush(token,{...payload,expiresAt:'2000-01-01'},authorization,async()=>assert.fail('stale call sent')),'stale');
 assert.equal(await provider.sendTradeNativePush('https://evil.test/',payload,authorization,async()=>assert.fail('invalid token sent')),'failed');
 assert.equal(await provider.sendTradeNativePush(token,payload,authorization,async()=>{throw new Error('provider unavailable');}),'failed');
});

test('Apple authorization validates explicit environment, signs ES256 and reuses the provider token',async()=>{
 const keys=await jose.generateKeyPair('ES256',{extractable:true});
 const apple={keyId:'TESTKEY123',teamId:'TESTTEAM12',privateKey:await jose.exportPKCS8(keys.privateKey),environment:'production'};
 const settings={TLINK_APNS_KEY_ID:apple.keyId,TLINK_APNS_TEAM_ID:apple.teamId,TLINK_APNS_PRIVATE_KEY:apple.privateKey,TLINK_APNS_ENVIRONMENT:apple.environment};
 assert.deepEqual(provider.tradeApnsCredentials(settings),apple);
 for(const key of Object.keys(settings))assert.equal(provider.tradeApnsCredentials({...settings,[key]:''}),null,key);
 assert.equal(provider.tradeApnsCredentials({...settings,TLINK_APNS_ENVIRONMENT:'https://evil.test'}),null);
 const [first,second]=await Promise.all([provider.authorizeTradeApns(apple),provider.authorizeTradeApns(apple)]);
 assert.equal(first.token,second.token);
 const {payload:claims,protectedHeader}=await jose.jwtVerify(first.token,keys.publicKey,{issuer:apple.teamId});
 assert.equal(protectedHeader.alg,'ES256');assert.equal(protectedHeader.kid,apple.keyId);assert.ok(Math.abs(claims.iat-Date.now()/1000)<5);
 assert.ok(first.expiresAt>Date.now()+49*60000);
});

test('iPhone message alerts use APNs, generic content, default sound, bounded expiry and conversation action',async()=>{
 const appleToken='ab'.repeat(32),auth={token:'synthetic',expiresAt:Date.now()+3600000,environment:'production'};
 let observed;
 assert.equal(await provider.sendTradeApns(appleToken,{...payload,kind:'team-message',body:'Private message'},auth,async(url,init)=>{observed={url,init};return new Response(null,{status:200});}),'accepted');
 assert.equal(observed.url,`https://api.push.apple.com/3/device/${appleToken}`);
 assert.equal(observed.init.headers['apns-topic'],'au.com.australianenergyassessments.field');
 assert.equal(observed.init.headers['apns-push-type'],'alert');assert.equal(observed.init.headers['apns-priority'],'10');
 assert.ok(Number(observed.init.headers['apns-expiration'])<=Date.now()/1000+60);
 assert.equal(observed.init.redirect,'manual');assert.ok(observed.init.signal instanceof AbortSignal);
 const sent=JSON.parse(observed.init.body);
 assert.deepEqual(sent.aps,{alert:{title:'TLink',body:'New team message'},sound:'default','thread-id':'thread-1234',category:'team-messages'});
 assert.equal(sent.type,'team_message');assert.equal(sent.threadId,'thread-1234');assert.equal(sent.eventId,'call-1234');
 assert.doesNotMatch(observed.init.body,/Private|evil\.test/);
 const sandbox={...auth,environment:'sandbox'};
 await provider.sendTradeApns(appleToken,payload,sandbox,async(url)=>{assert.match(url,/^https:\/\/api\.sandbox\.push\.apple\.com\//);return new Response(null,{status:200});});
});

test('Apple token retirement is explicit, configuration errors do not erase registrations, and expired alerts never send',async()=>{
 const appleToken='ab'.repeat(32),auth={token:'synthetic',expiresAt:Date.now()+3600000,environment:'production'};
 assert.equal(await provider.sendTradeApns(appleToken,payload,auth,async()=>Response.json({reason:'Unregistered'},{status:410})),'expired');
 for(const [status,reason] of [[400,'BadDeviceToken'],[400,'DeviceTokenNotForTopic'],[403,'InvalidProviderToken'],[429,'TooManyRequests'],[410,'Other']])
  assert.equal(await provider.sendTradeApns(appleToken,payload,auth,async()=>Response.json({reason},{status})),'failed');
 assert.equal(await provider.sendTradeApns(appleToken,{...payload,expiresAt:'2000-01-01'},auth,async()=>assert.fail('expired sent')),'stale');
 assert.equal(await provider.sendTradeApns('https://evil.test',payload,auth,async()=>assert.fail('invalid token sent')),'failed');
});

test('native-capable call delivery uses VoIP or data only; call cancellation never sends a new ringing alert',async()=>{
 const appleToken='ab'.repeat(32),auth={token:'synthetic',expiresAt:Date.now()+3600000,environment:'production'};
 for(const ended of [false,true]){
  await provider.sendTradeApns(appleToken,payload,auth,async(_url,init)=>{
   const body=JSON.parse(init.body);assert.equal(body.aps.alert,undefined);assert.equal(body.mode,'video');assert.equal(body.hasVideo,true);
   assert.equal(body.type,ended?'team_call_ended':'team_call');assert.equal(init.headers['apns-push-type'],ended?'background':'voip');
   assert.equal(init.headers['apns-topic'],`au.com.australianenergyassessments.field${ended?'':'.voip'}`);assert.equal(init.headers['apns-expiration'],'0');
   if(ended)assert.equal(body.aps['content-available'],1);
   return new Response(null,{status:200});
  },{voip:true,ended});
  await provider.sendTradeNativePush(token,payload,authorization,async(_url,init)=>{
   const {message}=JSON.parse(init.body);assert.equal(message.notification,undefined);assert.equal(message.android.notification,undefined);
   assert.equal(message.data.type,ended?'team_call_ended':'team_call');assert.equal(message.data.mode,'video');assert.equal(message.data.hasVideo,'true');
   return Response.json({name:'projects/australian-energy-assessments/messages/received'});
  },{nativeCall:true,ended});
 }
});
