import { hubQuoteRecord } from './customer-quote-hub-server';
import { parseTradeQuoteDocumentSnapshot } from './trade-quote-review-server';
import type { HubQuoteComparison } from './customer-quote-hub';

/** Customer-only comparison of the same issued document used by the full quote. */
export async function hubQuoteComparison(db:D1Database,token:string,id:string):Promise<HubQuoteComparison> {
  const {link}=await hubQuoteRecord(db,token,id);
  const now=new Date().toISOString();
  if(link.status!=='active'||link.expires_at<=now||(link.valid_until&&link.valid_until<now.slice(0,10))||link.version_status!=='issued'||Number(link.version_number)!==Number(link.current_version_number))throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  const snapshot=parseTradeQuoteDocumentSnapshot(link.document_snapshot_json);
  if(!snapshot||snapshot.quoteId!==link.quote_id||snapshot.quoteVersionId!==link.quote_version_id||snapshot.work.id!==link.work_order_id||snapshot.customer.id!==link.crm_customer_id)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  const {link:current}=await hubQuoteRecord(db,token,id);
  const checkedAt=new Date().toISOString();
  if(current.status!=='active'||current.expires_at<=checkedAt||(current.valid_until&&current.valid_until<checkedAt.slice(0,10))||current.version_status!=='issued'||Number(current.version_number)!==Number(current.current_version_number))throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  if(current.status!==link.status||current.token_hash!==link.token_hash||current.document_snapshot_json!==link.document_snapshot_json)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  return {id,scope:snapshot.customerMessage,terms:snapshot.terms,validUntil:snapshot.validUntil,totalCents:snapshot.totalCents,
    items:snapshot.items.map(item=>({description:item.description,quantityMilli:item.quantityMilli,totalCents:item.totalCents})),
    choices:snapshot.choices.map(choice=>({name:choice.name,kind:choice.kind,groupKey:choice.groupKey,summary:choice.summary,totalCents:choice.totalCents}))};
}
