export type HubService = { id: string; label: string };
export type HubQuote = { id: string; business: string; number: string; services: string[]; totalCents: number; status: string; blocked: boolean };
export type HubQuestion = { id: string; prompt: string; kind: "text" | "photo" | "document"; services: string[];
  business: string; answer: string; revision: number; closed: boolean; files: { id: string; name: string; type: string }[] };
export type CustomerQuoteHub = { title: string; reference: string; expiresAt: string; accepting: boolean; revision: number;
  services: HubService[]; quotes: HubQuote[]; questions: HubQuestion[] };
