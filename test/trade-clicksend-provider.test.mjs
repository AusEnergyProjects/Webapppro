import assert from "node:assert/strict";
import test from "node:test";
import * as provider from "../src/lib/trade-clicksend-provider.ts";

const credentials = { username: "tlink-provider-user", apiKey: "private-fixture-key-never-output" };
const from = "+61400000001";
const to = "+61412345678";
const sid = "1ABC3200-C38C-6308-BE4B-C7C51D01DCF0";
const inboundSid = "31BC271B-1E0C-45F6-9E7E-97186C46BB82";
const currency = { currency_name_short: "AUD" };
const input = { from, to, body: "Test appointment reminder", localMessageId: "tlink-message-1", subaccountId: "123" };
const message = { from, to, body: input.body, custom_string: input.localMessageId, subaccount_id: 123, country: "AU", is_shared_system_number: false, status: "SUCCESS", message_id: sid, message_parts: 1, message_price: "0.054000" };
const envelope = (data) => ({ http_code: 200, response_code: "SUCCESS", data });
const sent = (changes = {}) => envelope({ _currency: currency, total_count: 1, queued_count: 1, messages: [{ ...message, ...changes }] });
const page = (rows, changes = {}) => envelope({ data: rows, current_page: 1, last_page: 1, next_page_url: null, _currency: currency, ...changes });
const fetchResponse = (body, status = 200) => async (url, options) => {
  assert.equal(new URL(url).origin, "https://rest.clicksend.com");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, `Basic ${btoa(`${credentials.username}:${credentials.apiKey}`)}`);
  assert.ok(options.signal instanceof AbortSignal);
  return Response.json(body, { status });
};
const quote = (number = from) => ({ dedicated_number: number, country: "AU", price_setup: "0.000000", price_monthly: "20.710000", price_total: "20.710000" });
const registration = { business_name: "Sample Electrical", business_address: "42 Example Street", suburb: "Richmond", postcode: "3121", state: "VIC", contact_name: "Example Owner", contact_number: to, country: "AU" };

test("credential validation cannot inject Basic auth separators or control characters", () => {
  assert.deepEqual(provider.clickSendCredentials(credentials.username, credentials.apiKey), credentials);
  for (const username of ["user:password", "bad\r\nAuthorization", "", " user", "ümlaut"]) assert.throws(() => provider.clickSendCredentials(username, credentials.apiKey), /SMS_CREDENTIALS_INVALID/);
  for (const key of ["short", "key\nwith\nnewlines", " ".repeat(20)]) assert.throws(() => provider.clickSendCredentials(credentials.username, key), /SMS_CREDENTIALS_INVALID/);
});

test("money conversion preserves micro-AUD precision and rejects rounding or nonfinite values", () => {
  assert.equal(provider.clickSendMoneyMicro("0.054001"), 54001);
  assert.equal(provider.clickSendMoneyMicro("20.710000"), 20710000);
  assert.equal(provider.clickSendMoneyMicro("-0.000001", true), -1);
  for (const value of ["-1", "1.0000001", "NaN", Infinity, "1e3", "0x10", "1,000"]) assert.throws(() => provider.clickSendMoneyMicro(value), /SMS_PROVIDER_RESPONSE_INVALID/);
});

test("account inspection confirms credential identity and AUD without exposing provider account secrets", async () => {
  const account = { user_id: 42, username: "parent", active: 1, banned: 0, account_name: "TLink", balance: "-1.123456", _currency: currency, _subaccount: { subaccount_id: 123, api_username: credentials.username, api_key: credentials.apiKey } };
  const result = await provider.getClickSendAccount(credentials, fetchResponse(envelope(account)));
  assert.deepEqual(result, { accountId: "42", subaccountId: "123", username: credentials.username, accountName: "TLink", balanceMicro: -1123456, currency: "AUD" });
  assert.ok(!JSON.stringify(result).includes(credentials.apiKey));
  await assert.rejects(provider.getClickSendAccount(credentials, fetchResponse(envelope({ ...account, _subaccount: { subaccount_id: 999, api_username: "other" } }))), /SMS_ACCOUNT_MISMATCH/);
  await assert.rejects(provider.getClickSendAccount(credentials, fetchResponse(envelope({ ...account, active: 0 }))), /SMS_ACCOUNT_INACTIVE/);
});

test("number inventory filters foreign and landline numbers, requires AUD, and keeps exact price", async () => {
  const response = page([quote(), quote("+61212345678"), { ...quote("+61411111111"), country: "NZ" }, quote("+64211234567")]);
  assert.deepEqual(await provider.searchAustralianClickSendNumbers(credentials, fetchResponse(response)), [{ number: from, setupMicro: 0, monthlyMicro: 20710000, totalMicro: 20710000, currency: "AUD" }]);
  await assert.rejects(provider.searchAustralianClickSendNumbers(credentials, fetchResponse(page([quote()], { _currency: { currency_name_short: "USD" } }))), /SMS_CURRENCY_UNSUPPORTED/);
});

test("pagination is bounded and cannot leak Authorization to another host or endpoint", async () => {
  for (const next of ["https://attacker.example/v3/numbers/search/AU?page=2", "https://rest.clicksend.com@attacker.example/v3/numbers/search/AU?page=2", "https://rest.clicksend.com/v3/account?page=2", "https://rest.clicksend.com/v3/numbers/search/AU?page=1", "https://rest.clicksend.com/v3/numbers/search/AU?page=2&leak=secret"]) {
    let calls = 0;
    await assert.rejects(provider.searchAustralianClickSendNumbers(credentials, async () => { calls++; return Response.json(page([quote()], { last_page: 2, next_page_url: next })); }), /SMS_PROVIDER_PAGINATION_INVALID/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(provider.searchAustralianClickSendNumbers(credentials, async () => { calls++; return Response.json(page([], { last_page: 21 })); }), /SMS_PROVIDER_PAGE_LIMIT/);
  assert.equal(calls, 1);
});

test("valid pagination uses locally constructed provider URLs and preserves all AU quotes", async () => {
  const requested = [];
  const result = await provider.searchAustralianClickSendNumbers(credentials, async (url) => {
    requested.push(url);
    return Response.json(requested.length === 1 ? page([quote()], { last_page: 2, next_page_url: "https://rest.clicksend.com/v3/numbers/search/AU?page=2&limit=100" }) : page([quote("+61400000002")], { current_page: 2, last_page: 2 }));
  });
  assert.equal(result.length, 2);
  assert.deepEqual(requested, ["https://rest.clicksend.com/v3/numbers/search/AU?page=1&limit=100", "https://rest.clicksend.com/v3/numbers/search/AU?page=2&limit=100"]);
});

test("live inventory root pagination reconstructs known path and empty owned list omits data and currency", async () => {
  const requested=[];
  const result=await provider.searchAustralianClickSendNumbers(credentials,async url=>{
    requested.push(url);
    return Response.json(requested.length===1?page([quote()],{last_page:2,next_page_url:"/?page=2"}):page([quote("+61400000002")],{current_page:2,last_page:2}));
  });
  assert.equal(result.length,2);
  assert.equal(requested[1],"https://rest.clicksend.com/v3/numbers/search/AU?page=2&limit=100");
  assert.deepEqual(await provider.listPurchasedClickSendNumbers(credentials,fetchResponse(envelope({total:0,current_page:1,last_page:0,next_page_url:null,_currency:null}))),[]);
});

test("subaccount creation enforces restricted permissions and confirms provider-applied values", async () => {
  const details = { username: "tlink_business_123", password: "Generated1!Password", email: "owner@example.test", phone: to, firstName: "Example", lastName: "Owner" };
  let captured;
  const result = await provider.createClickSendSubaccount(credentials, details, async (_url, options) => {
    captured = JSON.parse(options.body);
    return Response.json(envelope({ ...captured, subaccount_id: 123, api_key: credentials.apiKey }));
  });
  assert.equal(result.subaccountId, "123");
  for (const key of ["access_users", "access_billing", "access_reporting", "access_contacts", "access_settings"]) assert.equal(captured[key], 0);
  await assert.rejects(provider.createClickSendSubaccount(credentials, details, fetchResponse(envelope({ ...captured, subaccount_id: 123, api_key: credentials.apiKey, access_users: 1 }))), /SMS_SUBACCOUNT_UNCONFIRMED/);
});

test("purchased numbers become ready only at fully ready registration states", async () => {
  const labels = ["REGISTRATION_NOT_REQUIRED", "REGISTRATION_NOT_INITIATED", "REGISTRATION_INITIATED", "CUST_ACTION_REQUIRED", "REGISTRATION_SUBMITTED", "REGISTERED"];
  const rows = labels.map((label, value) => ({ dedicated_number: `+6140000000${value}`, country: "AU", type: "sms", status: { value, label } }));
  const result = await provider.listPurchasedClickSendNumbers(credentials, fetchResponse(page(rows)));
  assert.deepEqual(result.map((row) => row.ready), [true, false, false, false, false, true]);
  await assert.rejects(provider.listPurchasedClickSendNumbers(credentials, fetchResponse(page([{ ...rows[0], status: { value: 0, label: "CUST_ACTION_REQUIRED" } }]))), /SMS_PROVIDER_RESPONSE_INVALID/);
});

test("subaccount recovery reads exact username without creating duplicates and rejects escalated credentials", async () => {
  const row = { subaccount_id: 123, api_username: "tlink_business_123", api_key: credentials.apiKey, access_users: 0, access_billing: 0, access_reporting: 0, access_contacts: 0, access_settings: 0 };
  const recovered = await provider.findClickSendSubaccount(credentials, row.api_username, fetchResponse(page([row, { ...row, subaccount_id: 999, api_username: "other" }])));
  assert.equal(recovered.subaccountId, "123");
  assert.equal(await provider.findClickSendSubaccount(credentials, "missing", fetchResponse(page([row]))), null);
  await assert.rejects(provider.findClickSendSubaccount(credentials, row.api_username, fetchResponse(page([row, { ...row, subaccount_id: 124 }]))), /SMS_SUBACCOUNT_AMBIGUOUS/);
  await assert.rejects(provider.findClickSendSubaccount(credentials, row.api_username, fetchResponse(page([{ ...row, access_reporting: 1 }]))), /SMS_SUBACCOUNT_UNCONFIRMED/);
  const inspected = await provider.getClickSendSubaccount(credentials, { subaccountId: "123", username: row.api_username }, fetchResponse(envelope(row)));
  assert.equal(inspected.subaccountId, "123");
  await assert.rejects(provider.getClickSendSubaccount(credentials, { subaccountId: "999", username: row.api_username }, fetchResponse(envelope(row))), /SMS_SUBACCOUNT_UNCONFIRMED/);
});

test("rental validates AU business registration and confirms exact purchased number and currency", async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, `https://rest.clicksend.com/v3/numbers/buy/${encodeURIComponent(from)}`);
    assert.deepEqual(JSON.parse(options.body), { dedicated_number: from, type: "sms", registration_data: registration });
    return Response.json(envelope({ dedicated_number: from, country: "AU", _price_setup: "0", _price_monthly: "20.71", price_total: "20.71", _currency: currency }));
  };
  assert.equal((await provider.buyAustralianClickSendNumber(credentials, { number: from, registration }, fetchImpl)).monthlyMicro, 20710000);
  for (const change of [{ business_address: "PO Box 42" }, { country: "NZ" }, { postcode: "abc" }]) await assert.rejects(provider.buyAustralianClickSendNumber(credentials, { number: from, registration: { ...registration, ...change } }, fetchImpl), /SMS_REGISTRATION_INVALID/);
  assert.equal(calls, 1);
});

test("routing creates exact-number JSON inbound rule and separate receipt callback", async () => {
  const callbackUrl = "https://example.test/api/sms/inbound/secret";
  const receiptUrl = "https://example.test/api/sms/receipt/secret";
  const payloads = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    payloads.push(body);
    return Response.json(envelope({ ...body, ...(url.endsWith("/inbound") ? { inbound_rule_id: 1 } : { receipt_rule_id: 2 }) }));
  };
  await provider.createClickSendInboundRule(credentials, { number: from, callbackUrl, ruleName: "TLink incoming" }, fetchImpl);
  await provider.createClickSendReceiptRule(credentials, { callbackUrl: receiptUrl, ruleName: "TLink delivery" }, fetchImpl);
  assert.equal(payloads[0].dedicated_number, from);
  assert.equal(payloads[0].webhook_type, "json");
  assert.equal(payloads[1].action_address, receiptUrl);
  assert.equal(payloads[1].match_type, 0);
  await assert.rejects(provider.createClickSendInboundRule(credentials, { number: "*", callbackUrl, ruleName: "All" }, fetchImpl), /SMS_AU_MOBILE_REQUIRED/);
  await assert.rejects(provider.createClickSendInboundRule(credentials, { number: from, callbackUrl: "https://user:password@example.test/inbound", ruleName: "Invalid" }, fetchImpl), /SMS_CALLBACK_INVALID/);
});

test("accepted submission correlates sender, recipient, tenant and local id and exposes only safe fields", async () => {
  let body;
  const result = await provider.submitClickSendSms(credentials, input, async (_url, options) => { body = JSON.parse(options.body); return Response.json(sent()); });
  assert.equal(body.messages[0].custom_string, input.localMessageId);
  assert.equal(body.messages[0].from, from);
  assert.deepEqual(result, { sid, status: "queued", errorCode: "", segments: 1, priceMicro: 54000, definitiveRejection: false });
  for (const changes of [{ from: "+61400000002" }, { to: from }, { subaccount_id: 999 }, { subaccount_id: undefined }, { custom_string: "another-business-message" }, { is_shared_system_number: true }, { message_id: "invalid-id" }, { country: "NZ" }]) {
    assert.equal((await provider.submitClickSendSms(credentials, input, fetchResponse(sent(changes)))).status, "unknown");
  }
});

test("HTTP 200 per-message rejections differ from ambiguous provider statuses", async () => {
  const result = await provider.submitClickSendSms(credentials, input, fetchResponse(sent({ status: "INSUFFICIENT_CREDIT" })));
  assert.equal(result.status, "failed");
  assert.equal(result.definitiveRejection, true);
  assert.equal(result.errorCode, "SMS_INSUFFICIENT_CREDIT");
  for (const status of ["INTERNAL_ERROR", "SOMETHING_IS_WRONG", credentials.apiKey, "unexpected"]) {
    const unknown = await provider.submitClickSendSms(credentials, input, fetchResponse(sent({ status })));
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.definitiveRejection, false);
    assert.ok(!JSON.stringify(unknown).includes(credentials.apiKey));
  }
});

test("timeouts, malformed responses and ambiguous HTTP statuses never retry or declare rejection", async () => {
  for (const respond of [() => { throw new Error(credentials.apiKey); }, () => new Response("not JSON"), () => Response.json(sent(), { status: 500 }), () => Response.json(sent(), { status: 408 }), () => Response.json(sent(), { status: 409 }), () => Response.json(envelope({ messages: [] }))]) {
    let calls = 0;
    const result = await provider.submitClickSendSms(credentials, input, async () => { calls++; return respond(); });
    assert.equal(calls, 1);
    assert.equal(result.status, "unknown");
    assert.equal(result.definitiveRejection, false);
    assert.ok(!JSON.stringify(result).includes(credentials.apiKey));
  }
  const rejected = await provider.submitClickSendSms(credentials, input, fetchResponse({ response_code: "INVALID_CREDENTIALS", response_msg: credentials.apiKey }, 401));
  assert.equal(rejected.definitiveRejection, true);
  assert.equal(rejected.errorCode, "SMS_CREDENTIALS_REJECTED");
});

test("price quotes accept official schema without subaccount id but still reject fallback senders", async () => {
  const quoted = sent({ subaccount_id: undefined, message_parts: 2, message_price: "0.108000" });
  assert.deepEqual(await provider.quoteClickSendSms(credentials, input, fetchResponse(quoted)), { segments: 2, priceMicro: 108000, currency: "AUD" });
  await assert.rejects(provider.quoteClickSendSms(credentials, input, fetchResponse(sent({ is_shared_system_number: true }))), /SMS_MESSAGE_IDENTITY_MISMATCH/);
});

test("receipt verification uses authenticated id lookup and rejects another subaccount", async () => {
  const receipt = { message_id: sid, subaccount_id: 123, message_type: "sms", status_code: "201", error_code: null, custom_string: input.localMessageId, timestamp: 1790668800 };
  const result = await provider.getClickSendReceipt(credentials, { messageId: sid, subaccountId: "123" }, fetchResponse(envelope(receipt)));
  assert.equal(result.statusCode, 201);
  await assert.rejects(provider.getClickSendReceipt(credentials, { messageId: sid, subaccountId: "999" }, fetchResponse(envelope(receipt))), /SMS_MESSAGE_IDENTITY_MISMATCH/);
});

test("inbound verification looks up original message id then checks inbound id and allocated destination", async () => {
  const received = { message_id: inboundSid, original_message_id: sid, from: to, to: from, body: "STOP", timestamp: 1790668800, custom_string: input.localMessageId };
  const result = await provider.getClickSendInboundMessage(credentials, { messageId: inboundSid, originalMessageId: sid, to: from }, async (url) => {
    assert.equal(url, `https://rest.clicksend.com/v3/sms/inbound/${sid}`);
    return Response.json(envelope(received));
  });
  assert.equal(result.body, "STOP");
  await assert.rejects(provider.getClickSendInboundMessage(credentials, { messageId: inboundSid, originalMessageId: sid, to }, fetchResponse(envelope(received))), /SMS_MESSAGE_IDENTITY_MISMATCH/);
  const unsolicited = await provider.listClickSendInboundMessages(credentials, fetchResponse(page([{ ...received, original_message_id: null }])));
  assert.equal(unsolicited[0].originalMessageId, null);
});
