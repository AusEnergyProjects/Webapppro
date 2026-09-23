const paths = {
  work: "M9 6V4h6v2M4 6h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM3 11a22 22 0 0 0 18 0M12 11v3",
  map: "M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87",
  training: "M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1ZM5 8h4M5 12h4M15 8h4M15 12h4",
  schedule: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 14h2M15 14h2M7 18h2",
  finance: "M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6M21 13h-4a2 2 0 0 0 0 4h4M17 15h.01",
  leads: "M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM19 7v6M16 10h6",
  products: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5V15",
  calculator: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM8 6h8v3H8V6ZM8 13h1M15 13h1M8 17h1M15 17h1",
  business: "M4 22V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18M2 22h20M9 22v-5h6v5M8 6h1M15 6h1M8 10h1M15 10h1",
  orders: "M1 3h13v14H1V3ZM14 8h4l4 4v5h-8M4 17a3 3 0 1 0 6 0M15 17a3 3 0 1 0 6 0M14 12h8",
  import: "M12 3v12M7 10l5 5 5-5M3 15v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5",
  jobs: "M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3M9 2h6v4H9V2ZM8 11h8M8 15h8M8 19h5",
  customers: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5V3ZM2 7h5M2 12h5M2 17h5M16 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 17a4 4 0 0 1 8 0",
};

export function TLinkNavigationIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="tlink-navigation-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
