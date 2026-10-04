export type CouncilMapTrade = {
  id: string;
  name: string;
  postcode: string;
  suburb: string;
  state: string;
  position: { lat: number; lng: number } | null;
  capabilities: string[];
  website: string | null;
};
