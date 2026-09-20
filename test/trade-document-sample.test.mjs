import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import { PDFDocument } from "pdf-lib";
import { tradeDocumentSamples } from "../src/lib/trade-document-sample.ts";
import { createTradeQuotePdfBytes } from "../src/lib/trade-quote-pdf.mjs";
import { createTradeQuickInvoicePdfBytes } from "../src/lib/trade-quick-invoice-pdf.mjs";
const settings={name:"Sample Business",phone:"",email:"hello@example.com",abn:"",website:"",address:"",themeKey:"teal_indigo",borderStyle:"rounded",quoteTerms:"Agreed work only",payment:{accountName:"",bsb:"",accountNumber:"",reference:"",terms:"Payment due in 14 days"}};
test("real sample PDFs use current identity and equal deterministic totals without invented payment details",async()=>{
  const samples=tradeDocumentSamples(settings,new Date("2026-09-20T00:00Z"));
  assert.equal(samples.quote.totalCents,samples.invoice.totalCents);assert.equal(samples.quote.totalCents,422400);
  assert.equal(samples.quote.items.reduce((sum,item)=>sum+item.totalCents,0),422400);assert.equal(samples.invoice.payment.accountNumber,"");
  for(const [kind,render] of [["quote",createTradeQuotePdfBytes],["invoice",createTradeQuickInvoicePdfBytes]]){
    const bytes=await render(samples[kind]);const {text}=await extractText(bytes,{mergePages:true});
    assert.match(text,/Sample Business/);assert.match(text,/4,224\.00/);assert.match(text,/Unit ex GST/);assert.doesNotMatch(text,/Cost price|Supplier cost|Gross margin/);
  }
});
test("long quote rows and invoice terms retain their last text across pages",async()=>{
  const samples=tradeDocumentSamples(settings);
  samples.quote.items=Array.from({length:48},(_,index)=>({...samples.quote.items[0],id:`line${index}`,description:`Equipment, installation and commissioning at the property. End row ${index}`}));
  samples.quote.subtotalCents=samples.quote.items.reduce((sum,item)=>sum+item.subtotalCents,0);samples.quote.taxCents=samples.quote.items.reduce((sum,item)=>sum+item.taxCents,0);samples.quote.totalCents=samples.quote.subtotalCents+samples.quote.taxCents;
  samples.invoice.payment.terms=Array.from({length:100},(_,index)=>`Term ${index}: the work and payment details are recorded here.`).join("\n");
  for(const [kind,render,last] of [["quote",createTradeQuotePdfBytes,/End row 47/],["invoice",createTradeQuickInvoicePdfBytes,/Term 99/]]){
    const bytes=await render(samples[kind]);assert.ok((await PDFDocument.load(bytes)).getPageCount()>1);assert.match((await extractText(bytes,{mergePages:true})).text.replace(/\s+/g," "),last);
  }
});
