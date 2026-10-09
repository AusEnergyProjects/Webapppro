import type { ReactNode } from 'react';
import type { HubQuoteComparison, HubQuoteComparisonLine, HubQuoteEquipment } from '@/lib/customer-quote-hub';
import { SOLAR_EQUIPMENT_LABELS } from '@/lib/trade-solar-equipment';
import styles from './CustomerQuoteHub.module.css';

const money=(cents:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(cents/100);

function EquipmentFacts({items}:{items:HubQuoteEquipment[]}) {
  if(!items.length)return <p className={styles.quoteUnknown}>Equipment models and capacities not provided separately. Confirm the exact equipment with the installer.</p>;
  return <ul className={styles.equipmentFacts}>{items.map((item,index)=><li key={index}>
    <small>{item.quantity} × {SOLAR_EQUIPMENT_LABELS[item.kind]}</small>
    <strong>{item.name}</strong>
    <dl>
      <div><dt>Model</dt><dd>{item.model}</dd></div>
      <div><dt>Manufacturer</dt><dd>{item.manufacturer||'Not provided'}</dd></div>
      <div><dt>{item.kind==='panel'||item.kind==='inverter'?'Power':'Capacity'}</dt><dd>{item.kind==='panel'
        ?item.watts===undefined?'Not provided':`${item.watts} W per panel`
        :item.kind==='inverter'?item.watts===undefined?'Not provided':`${item.watts/1000} kW`
        :item.kind==='battery'?item.capacityKwh===undefined?'Not provided':`${item.capacityKwh} kWh as quoted`
        :item.capacityLitres===undefined?'Not provided':`${item.capacityLitres} L`}</dd></div>
      {item.kind==='panel'&&item.watts!==undefined&&<div><dt>Listed panels</dt><dd>{Number((item.quantity*item.watts/1000).toFixed(3))} kW across {item.quantity} panels</dd></div>}
      <div><dt>Warranty</dt><dd>{item.warrantyYears===undefined?'Not provided':`${item.warrantyYears} years stated`}</dd></div>
    </dl>
    {item.datasheetUrl&&<a href={item.datasheetUrl} target="_blank" rel="noopener noreferrer">Product datasheet ↗</a>}
  </li>)}</ul>;
}

function IncludedItems({items}:{items:HubQuoteComparisonLine[]}) {
  return <details><summary>Itemised work ({items.length})</summary>{items.length?<ul>{items.map((item,index)=><li key={index}>{item.quantityMilli/1000} × {item.description} <strong>{money(item.totalCents)}</strong></li>)}</ul>:<p>Itemised work not provided here. Confirm the installation scope with the installer.</p>}</details>;
}

export function CustomerQuoteComparisonCard({comparison:item,business,services,busy,onOpen}:{
  comparison:HubQuoteComparison; business:ReactNode; services:string; busy:boolean; onOpen:()=>void;
}) {
  const options=item.choices.filter(choice=>choice.kind!=='addon');
  const extras=item.choices.filter(choice=>choice.kind==='addon');
  const hasBattery=[...item.equipment,...item.choices.flatMap(choice=>choice.equipment)].some(equipment=>equipment.kind==='battery');
  return <article>
    <h3>{business}</h3><small>{services}</small>
    <h4>Work included</h4><p>{item.scope||'Scope note not provided. Check the itemised work and confirm with the installer.'}</p>
    <h4>{options.length?'Equipment included in every option':'Quoted equipment'}</h4><EquipmentFacts items={item.equipment}/>
    {hasBattery&&<p className={styles.quoteUnknown}>Battery capacity is as quoted. Confirm usable capacity and backup coverage, including the circuits and backup hardware. These are not recorded as separate equipment details.</p>}
    <IncludedItems items={item.items}/>
    {options.map(choice=><section key={choice.id} className={styles.quoteOption} aria-label={choice.name}>
      <small>{choice.kind==='package'?'Package option':'Required choice'}</small>
      <h4>{choice.name}</h4>{choice.summary&&<p>{choice.summary}</p>}
      <EquipmentFacts items={choice.equipment}/><IncludedItems items={choice.items}/>
      <p className={styles.optionTotal}><strong>{choice.fullTotalCents===null?'Total not provided':money(choice.fullTotalCents)}</strong><small>Full quoted total with this option, including GST</small></p>
      {choice.includedChoiceNames.length>0&&<small>Also includes the quoted default choices: {choice.includedChoiceNames.join(', ')}.</small>}
    </section>)}
    <div className={styles.quotedTotal}><small>{options.length?'Quoted starting configuration':extras.length?'Quoted total before optional extras':'Quoted total'}</small><strong>{money(item.quotedTotalCents)}</strong><small>Including GST{item.defaultChoiceNames.length?` · ${item.defaultChoiceNames.join(', ')}`:''}</small></div>
    {extras.length>0&&<details><summary>Optional extras ({extras.length})</summary>{extras.map(choice=><section key={choice.id} className={styles.quoteOption}><h4>{choice.name}</h4>{choice.summary&&<p>{choice.summary}</p>}<EquipmentFacts items={choice.equipment}/><IncludedItems items={choice.items}/><p>Optional extra: {choice.totalCents>=0?'+':''}{money(choice.totalCents)} including GST</p></section>)}</details>}
    <details><summary>Terms and exclusions</summary><p>{item.terms||'Not provided here. Confirm terms and exclusions with the installer.'}</p></details>
    <p className={styles.quoteUnknown}>Warranty periods are quoted equipment details. Confirm the warranty type, conditions and workmanship cover with the installer.</p>
    <small>{item.validUntil?'Valid until '+item.validUntil:'No expiry stated in this quote'}</small>
    <button disabled={busy} onClick={onOpen}>Open full quote</button>
  </article>;
}
