import { encryptProtectedPayload, decryptProtectedPayload } from "./trade-integration-crypto";
import { newQuoteLinkSecret, hashQuoteLinkSecret, splitQuoteLinkToken } from "./trade-quote-links";
import { publicPlanContactReleaseAccessSql } from "./public-plan-enquiry.mjs";

export type HubAuthority = { id: string; opportunity_id: string; release_id: string; token_hash: string; email_hash: string; recipient_email:string; expires_at: string };
export const hubContactSql = `FROM trade_opportunities opportunity
  JOIN public_trade_lead_contact_releases contact ON contact.opportunity_id=opportunity.id AND contact.source_reference=opportunity.source_reference AND contact.postcode=opportunity.postcode
  WHERE opportunity.id=? AND opportunity.status='open' AND opportunity.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND contact.status='active' AND contact.withdrawn_at=''
    AND ${publicPlanContactReleaseAccessSql("contact")} AND datetime(contact.granted_at) IS NOT NULL`;

async function prepareCustomerHub(db: D1Database, opportunityId: string, email: string, expectedReleaseId = '', onlyMissing = false) {
  const contact = await db.prepare(`SELECT contact.id,contact.customer_email ${hubContactSql}`).bind(opportunityId).first<{id:string;customer_email:string}>();
  if (!contact || (expectedReleaseId && contact.id !== expectedReleaseId) || contact.customer_email.trim().toLowerCase() !== email.trim().toLowerCase()) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const emailHash = await hashQuoteLinkSecret(email.trim().toLowerCase());
  const existing=await db.prepare('SELECT id FROM customer_quote_hubs WHERE opportunity_id=?').bind(opportunityId).first<{id:string}>();
  const id=existing?.id||crypto.randomUUID(), secret=newQuoteLinkSecret(), now=new Date().toISOString();
  const encrypted=await encryptProtectedPayload({kind:"customer_quote_hub",id,secret});
  await db.prepare(`INSERT INTO customer_quote_hubs(id,opportunity_id,release_id,email_hash,recipient_email,token_hash,encrypted_token,expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 ${hubContactSql} AND contact.id=? AND lower(trim(contact.customer_email))=?)
    ON CONFLICT(opportunity_id) DO UPDATE SET release_id=excluded.release_id,email_hash=excluded.email_hash,recipient_email=excluded.recipient_email,
      token_hash=excluded.token_hash,encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at,revoked_at=''
    WHERE ?=0 AND customer_quote_hubs.id=excluded.id AND (customer_quote_hubs.release_id<>excluded.release_id OR customer_quote_hubs.email_hash<>excluded.email_hash
      OR customer_quote_hubs.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR customer_quote_hubs.revoked_at<>'')`)
    .bind(id,opportunityId,contact.id,emailHash,email.trim().toLowerCase(),await hashQuoteLinkSecret(secret),encrypted,new Date(Date.now()+90*86400000).toISOString(),now,
      opportunityId,contact.id,email.trim().toLowerCase(),onlyMissing?1:0).run();
  const stored=await db.prepare(`SELECT id,encrypted_token,token_hash FROM customer_quote_hubs WHERE opportunity_id=? AND release_id=? AND email_hash=? AND revoked_at='' AND expires_at>?`)
    .bind(opportunityId,contact.id,emailHash,now).first<{id:string;encrypted_token:string;token_hash:string}>();
  if(!stored) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return stored;
}

/** Provision only a missing hub after the caller has checked the owner's exact matched lead. Never return its private token. */
export async function ensureCustomerHubForReleasedLead(db: D1Database, opportunityId: string, releaseId: string, email: string) {
  await prepareCustomerHub(db, opportunityId, email, releaseId, true);
}

/** Only customer-email delivery may call this. Never add the result to a trade response or shared lead envelope. */
export async function customerHubEmailUrl(db: D1Database, opportunityId: string, email: string) {
  const stored = await prepareCustomerHub(db, opportunityId, email);
  const recovered=await decryptProtectedPayload(stored.encrypted_token);
  if(recovered.kind!=="customer_quote_hub" || recovered.id!==stored.id || typeof recovered.secret!=="string" || await hashQuoteLinkSecret(recovered.secret)!==stored.token_hash) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return `https://ausenergyassessments.com/customer-hub/${encodeURIComponent(`${stored.id}.${recovered.secret}`)}`;
}

export function hubAuthorityScope(hub: HubAuthority) {
  return {sql:`EXISTS(SELECT 1 FROM customer_quote_hubs hub WHERE hub.id=? AND hub.opportunity_id=? AND hub.release_id=? AND hub.email_hash=? AND hub.token_hash=?
    AND hub.revoked_at='' AND hub.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND EXISTS(SELECT 1 ${hubContactSql} AND contact.id=hub.release_id AND lower(trim(contact.customer_email))=?))`, values:[hub.id,hub.opportunity_id,hub.release_id,hub.email_hash,hub.token_hash,hub.opportunity_id,hub.recipient_email]};
}

export async function authoriseCustomerHub(db:D1Database, token:string):Promise<HubAuthority> {
  const parsed=splitQuoteLinkToken(token);
  const hub=await db.prepare(`SELECT hub.id,hub.opportunity_id,hub.release_id,hub.email_hash,hub.token_hash,hub.expires_at,lower(trim(contact.customer_email)) recipient_email
    FROM customer_quote_hubs hub JOIN public_trade_lead_contact_releases contact ON contact.id=hub.release_id AND contact.opportunity_id=hub.opportunity_id WHERE hub.id=?`).bind(parsed.linkId).first<HubAuthority>();
  if(!hub || await hashQuoteLinkSecret(parsed.secret)!==hub.token_hash) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const scope=hubAuthorityScope(hub);
  if(!await db.prepare(`SELECT 1 WHERE ${scope.sql}`).bind(...scope.values).first()) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const contact=await db.prepare(`SELECT contact.customer_email ${hubContactSql}`).bind(hub.opportunity_id).first<{customer_email:string}>();
  if(!contact || await hashQuoteLinkSecret(contact.customer_email.trim().toLowerCase())!==hub.email_hash) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return hub;
}
