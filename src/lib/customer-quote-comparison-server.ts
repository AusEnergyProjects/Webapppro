import { hubQuoteRecord } from './customer-quote-hub-server';
import { parseTradeQuoteDocumentSnapshot } from './trade-quote-review-server';
import { tradeQuoteDocumentDisplayTotals } from './trade-quote-document-totals.mjs';
import type { HubQuoteComparison, HubQuoteEquipment } from './customer-quote-hub';

function equipmentFacts(item:HubQuoteEquipment):HubQuoteEquipment {
  return {kind:item.kind,name:item.name,manufacturer:item.manufacturer,model:item.model,quantity:item.quantity,
    ...(item.watts===undefined?{}:{watts:item.watts}),
    ...(item.capacityKwh===undefined?{}:{capacityKwh:item.capacityKwh}),
    ...(item.capacityLitres===undefined?{}:{capacityLitres:item.capacityLitres}),
    ...(item.warrantyYears===undefined?{}:{warrantyYears:item.warrantyYears}),
    ...(item.datasheetUrl?{datasheetUrl:item.datasheetUrl}:{})};
}

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
  const defaults=tradeQuoteDocumentDisplayTotals(snapshot);
  return {id,scope:snapshot.customerMessage,terms:snapshot.terms,validUntil:snapshot.validUntil,totalCents:snapshot.totalCents,
    quotedTotalCents:defaults.totalCents,
    defaultChoiceNames:snapshot.choices.filter(choice=>defaults.selectedChoiceIds.includes(choice.id)).map(choice=>choice.name),
    equipment:(snapshot.equipment?.common||[]).map(equipmentFacts),
    items:snapshot.items.map(item=>({description:item.description,quantityMilli:item.quantityMilli,totalCents:item.totalCents})),
    choices:snapshot.choices.map(choice=>{
      const option=choice.kind==='addon'?null:tradeQuoteDocumentDisplayTotals({...snapshot,
        choices:snapshot.choices.filter(other=>other.kind!==choice.kind||other.groupKey!==choice.groupKey||other.id===choice.id)});
      return {id:choice.id,name:choice.name,kind:choice.kind,groupKey:choice.groupKey,summary:choice.summary,totalCents:choice.totalCents,
        fullTotalCents:option?.totalCents??null,
        includedChoiceNames:snapshot.choices.filter(other=>other.id!==choice.id&&option?.selectedChoiceIds.includes(other.id)).map(other=>other.name),
        equipment:(snapshot.equipment?.choices.find(group=>group.choiceKey===choice.id)?.items||[]).map(equipmentFacts),
        items:choice.items.map(item=>({description:item.description,quantityMilli:item.quantityMilli,totalCents:item.totalCents}))};
    })};
}
