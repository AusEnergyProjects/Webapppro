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
 assert.equal(observed.url,'https://oauth2.googleapis.com/token');assert.equal(observed.init.redirect,'error');assert.ok(observed.init.signal instanceof AbortSignal);
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
 assert.equal(observed.init.redirect,'error');assert.ok(observed.init.signal instanceof AbortSignal);
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
