import solar from "./product-guides/solar.json";
import inverters from "./product-guides/inverters.json";
import batteries from "./product-guides/batteries.json";
import hotWater from "./product-guides/hot-water.json";
import airConditioning from "./product-guides/air-conditioning.json";

export type ProductGuideSource = { title: string; url: string; kind: string; revision: string };
export type ProductGuideOption = {
  id: string; name: string; group: string; fit: string; why: string; check: string;
  checkedAt: string; sources: ProductGuideSource[];
};
export type ProductGuideCategory = {
  slug: string; title: string; summary: string; introduction: string;
  startingPoints: { title: string; answer: string }[];
  quoteQuestions: string[]; learnPath: string; comparePath: string; compareLabel: string;
  options: ProductGuideOption[];
};

export const PRODUCT_GUIDE_REVIEW_DATE = "2026-10-10";
export const PRODUCT_GUIDE_CATEGORIES: ProductGuideCategory[] = [
  {
    slug: "solar", title: "Solar panels",
    summary: "20 panel families, with roof fit, useful differences and support questions explained.",
    introduction: "Start with your roof and the electricity you use during the day. A good panel choice also needs the right inverter, installation and someone who will help if a problem arises.",
    startingPoints: [
      { title: "Limited roof space?", answer: "Ask how much electricity the complete layout is expected to produce. A panel's efficiency describes output for its area; a bigger wattage number can simply mean a bigger panel." },
      { title: "Want reliable support?", answer: "Ask who handles a fault, who pays for inspection and removal, and whether the installer is authorised for the proposed warranty. A long output warranty is different from product and installation cover." },
      { title: "Comparing panel technology?", answer: "You do not need to choose by cell acronyms. Compare the roof layout, expected generation, shading plan, exact models and complete written warranty." },
    ],
    quoteQuestions: ["Exact panel and inverter models, panel count and total system size", "A roof layout and generation estimate that allows for direction, shade and local weather", "Who handles a fault and which labour, freight and removal costs are covered", "Complete installed price and the current eligibility of the quoted equipment"],
    learnPath: "/guides/solar", comparePath: "/compare", compareLabel: "See what solar could save me", options: solar,
  },
  {
    slug: "inverters",
    title: "Solar inverters",
    summary: "20 inverter families, with existing-solar fit, battery compatibility and blackout limits explained.",
    introduction: "The inverter turns electricity from your panels into power your home can use. It also shapes which batteries can be added and what works in a blackout. Start with the solar you have, your home's electricity supply and what you want to add.",
    startingPoints: [{"title":"Adding a battery later?","answer":"A battery-ready inverter still needs a compatible battery, and sometimes extra controls or paid activation. Ask which exact batteries work and what the later installation involves."},{"title":"Already have solar?","answer":"You may be able to keep your solar inverter and add a separate battery system. Check compatibility and whether the existing solar keeps working during a blackout."},{"title":"Want blackout cover?","answer":"A normal solar inverter shuts down when the grid fails. Backup usually needs a compatible battery, switching equipment and an installer-designed circuit plan. Three-phase power does not automatically mean three-phase backup."}],
    quoteQuestions: ["Exact inverter model and compatibility with the panel layout and electricity supply","Supported battery models, any extra activation and later installation requirements","Backup circuits, switching hardware and solar operation during an outage","Included monitoring, internet needs, warranty cover and local service contact"],
    learnPath: "/guides/solar",
    comparePath: "/compare",
    compareLabel: "Explore my solar and storage options",
    options: inverters,
  },
  {
    slug: "batteries", title: "Home batteries",
    summary: "20 storage families, with existing-solar fit, blackout limits and everyday control explained.",
    introduction: "Choose for the energy you need after sunset, the appliances you want in a blackout and the solar you already have. Storage size alone does not tell you what the system can power.",
    startingPoints: [
      { title: "Already have solar?", answer: "Ask whether the battery can work with your exact solar inverter or whether it needs replacing. Keeping existing solar and running it during a blackout are separate compatibility questions." },
      { title: "Need blackout cover?", answer: "Name the appliances that matter, such as the fridge, office and internet. Ask the installer to list the backed-up circuits, power limits and whether solar can recharge the battery during an outage." },
      { title: "Have a cheap charging window?", answer: "Ask for a demonstration of scheduled charging with your electricity plan. Check the plan's conditions and how much energy must be kept for a blackout." },
    ],
    quoteQuestions: ["Exact battery, controller and backup-switch models", "Energy available to use and how much power it can supply at once, on each phase", "Named backup circuits and proof of existing-solar operation during an outage", "Warranty conditions, including energy-use limits, internet requirements and installer labour"],
    learnPath: "/guides/batteries", comparePath: "/compare", compareLabel: "See what storage could add", options: batteries,
  },
  {
    slug: "hot-water", title: "Heat-pump hot water",
    summary: "20 hot-water families, with household demand, winter performance and maintenance explained.",
    introduction: "A heat pump uses electricity to move heat from the air into your water. The right system needs to keep up with your showers, work in your winter weather and fit somewhere its sound will be acceptable.",
    startingPoints: [
      { title: "Several showers together?", answer: "Ask how much hot water is available and how quickly it recovers after a busy morning. Tank litres alone do not describe shower capacity or winter recovery." },
      { title: "Cold winters or close neighbours?", answer: "Ask for heating output in your winter conditions, any extra electric-heater use, and the proposed location's noise and clearance requirements." },
      { title: "Want to use your solar?", answer: "Check that heating can be scheduled for daytime without leaving you short of hot water. Ask what changes when a boost is needed or the electricity supply is controlled." },
    ],
    quoteQuestions: ["Exact unit and tank models, location and household sizing", "Winter recovery time, extra electric-heater operation and noise", "Heating schedule and compatibility with the electricity circuit and tariff", "Water-quality conditions, required servicing and cover for parts and labour"],
    learnPath: "/guides/hot-water", comparePath: "/gas-compare", compareLabel: "Explore moving hot water off gas", options: hotWater,
  },
  {
    slug: "air-conditioning", title: "Heating and cooling",
    summary: "20 split-system families, with room fit, comfort controls and climate ratings explained.",
    introduction: "Reverse-cycle air conditioning heats as well as cools. Start with the rooms you use, your local climate and the building. This shortlist covers individual-room wall and floor systems; a whole-home ducted design needs a separate assessment.",
    startingPoints: [
      { title: "Replacing a gas heater?", answer: "Choose a heating-and-cooling model and ask for its winter heating performance. A cooling-only unit cannot replace your gas heating." },
      { title: "Want lower running costs?", answer: "Compare similarly sized indoor/outdoor pairs using the energy label for your climate. A brand's best star rating does not apply to every model." },
      { title: "Need several rooms comfortable?", answer: "A large lounge unit will not reliably heat closed bedrooms. Compare separate room systems with a properly designed multi-room or ducted option." },
    ],
    quoteQuestions: ["Exact matched indoor and outdoor models, sized for the rooms and building", "Heating and cooling energy labels for your climate", "Indoor and outdoor noise at the planned positions", "Included controls, electrical work, drainage, warranty labour and service access"],
    learnPath: "/guides/heating", comparePath: "/gas-compare", compareLabel: "Explore replacing gas heating", options: airConditioning,
  },
];

export function findProductGuideCategory(slug: string): ProductGuideCategory | undefined {
  return PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === slug);
}

export const PRODUCT_GUIDE_EVIDENCE = [
  { title: "Manufacturer information", explanation: "Useful for exact equipment, controls and warranty conditions. These are maker claims; we have not tested these products ourselves." },
  { title: "CHOICE public guides and methodology", explanation: "Useful independent buying advice. Its current split-system comparisons use manufacturer data checked against government registration, rather than routinely testing every unit in a lab. Historical battery trial results do not prove how a new model performs.", url: "https://www.choice.com.au/home-and-living/cooling/air-conditioners/articles/how-we-test-air-conditioners" },
  { title: "SolarQuotes installer surveys", explanation: "Useful evidence of what responding installers favour and work with. A preference survey is different from a controlled product test or a long-term failure-rate comparison. SolarQuotes operates a commercial referral service.", url: "https://www.solarquotes.com.au/blog/best-home-battery-in-australia-2026/" },
  { title: "Official registers and safety notices", explanation: "Use them to check the exact quoted model and installation-date requirements. Registration and rebate eligibility do not prove it is the best product for your home.", url: "https://www.productsafety.gov.au/" },
];
