import type { SolarEquipmentItem } from './trade-solar-equipment';

export type HubService = { id: string; label: string };
export type HubBusinessProfile = { id:string; name:string; websiteUrl:string; googleProfileUrl:string };
export type HubReply = { id:string; body:string; authorType:'customer'|'trade'; createdAt:string; business?:string; businessProfile?:HubBusinessProfile };
export type HubQuote = { id: string; business: string; businessProfile?:HubBusinessProfile; number: string; services: string[]; totalCents: number; status: string; blocked: boolean };
export type HubQuoteEquipment = Pick<SolarEquipmentItem,
  'kind'|'name'|'manufacturer'|'model'|'quantity'|'watts'|'capacityKwh'|'capacityLitres'|'warrantyYears'|'datasheetUrl'>;
export type HubQuoteComparisonLine = {description:string;quantityMilli:number;totalCents:number};
export type HubQuoteComparison = { id:string; scope:string; terms:string; validUntil:string; totalCents:number;
  quotedTotalCents:number; defaultChoiceNames:string[]; equipment:HubQuoteEquipment[];
  items:HubQuoteComparisonLine[];
  choices:{id:string;name:string;kind:'package'|'addon'|'choose_one';groupKey:string;summary:string;totalCents:number;
    fullTotalCents:number|null; includedChoiceNames:string[]; equipment:HubQuoteEquipment[]; items:HubQuoteComparisonLine[]}[] };
export type HubQuestion = { id: string; prompt: string; kind: "text" | "photo" | "document"; services: string[];
  authorType:'customer'|'trade'; business: string; businessProfile?:HubBusinessProfile; replies:HubReply[];
  answer: string; revision: number; closed: boolean; files: { id: string; name: string; type: string }[] };
export type TradeHubQuestion = Omit<HubQuestion,'business'|'businessProfile'|'replies'> & {replies:Omit<HubReply,'business'|'businessProfile'>[]};
export type CustomerQuoteHub = { title: string; reference: string; expiresAt: string; contactExpiresAt: string; requestedWorkBy: string; requestedCompletion: string; accepting: boolean; revision: number;
  services: HubService[]; quotes: HubQuote[]; questions: HubQuestion[] };
