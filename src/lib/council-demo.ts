import { councilReportPeriod, COUNCIL_MINIMUM_COHORT, COUNCIL_REPORT_METHODOLOGY, COUNCIL_SECTORS, type CouncilBreakdown, type CouncilPeriodKey, type CouncilReport, type CouncilSectorKey } from "./council-reporting.ts";
import { postcodeCoordinate } from "./postcode-distance.ts";
import type { CouncilProfile } from "./council-profile.ts";
import { SECCCA_DEMO_POSTCODES } from "./council-public-branding.ts";

type DemonstrationOutcome = { month: string; postcode: string; activity: string; sector: CouncilSectorKey; jobs: number; value: number; local: number; veecs: number; stcs: number; carbon: number; campaign: number; referred: number; enquiries: number };
const activities = [
  { key:"hot-water",label:"Heat pump hot water",value:320000,veecs:35,stcs:28 },
  { key:"heating-cooling",label:"Heating and cooling",value:620000,veecs:52,stcs:0 },
  { key:"solar",label:"Rooftop solar",value:760000,veecs:0,stcs:68 },
  { key:"electric-cooking",label:"Replacing gas cooking",value:240000,veecs:0,stcs:0 },
  { key:"insulation",label:"Insulation and comfort",value:410000,veecs:18,stcs:0 },
];
const placeLabels = ["St Kilda", "Brighton", "Mentone", "Narre Warren", "Pakenham", "Mornington", "Wonthaggi"];
const sampleBusinessCounts = [7, 11, 16, 9, 12, 10, 15];
const defaultPlaces = SECCCA_DEMO_POSTCODES.map((postcode, index) => ({ postcode, label: placeLabels[index], registeredLocalBusinesses: sampleBusinessCounts[index] }));
const campaigns = [
  { id:"demo-electrify",name:"Community electrification demonstration",referenceCode:"DEMO-ELECTRIFY",channel:"Council campaign" },
  { id:"demo-business",name:"Business energy upgrade drive",referenceCode:"DEMO-BUSINESS",channel:"Council campaign" },
  { id:"demo-session",name:"Community energy information sessions",referenceCode:"DEMO-SESSION",channel:"Information session" },
];
const total = (rows: DemonstrationOutcome[], field: keyof Pick<DemonstrationOutcome,"jobs"|"value"|"local"|"veecs"|"stcs"|"carbon"|"referred"|"enquiries">) => rows.reduce((sum,row) => sum+row[field],0);
function group(rows: DemonstrationOutcome[],key:string,label:string): CouncilBreakdown {
  return { key,label,completedJobs:total(rows,"jobs"),completedValueCents:total(rows,"value"),localJobs:total(rows,"local"),veecQuantity:total(rows,"veecs"),stcQuantity:total(rows,"stcs"),estimatedTonnesCo2e:total(rows,"carbon") };
}

/** Fictional, deterministic outcomes at real postcode centres. No customer records. */
export function loadCouncilDemo(periodKey: CouncilPeriodKey = "year", now = new Date(), profile?: Pick<CouncilProfile,"name"|"state"|"postcodes">): CouncilReport {
  const places = profile ? profile.postcodes.map(postcode => defaultPlaces.find(place => place.postcode === postcode) || { postcode, label: `Postcode ${postcode}`, registeredLocalBusinesses: 5 + Number(postcode) % 13 }) : defaultPlaces;
  const state = profile?.state || "VIC";
  const period = councilReportPeriod(periodKey,state,now);
  const outcomes: DemonstrationOutcome[] = [];
  const monthKeys: string[] = [];
  const end = new Date(`${period.end.slice(0,7)}-01T00:00:00Z`);
  for (let index=0;index<6;index++) {
    const date = new Date(end); date.setUTCMonth(date.getUTCMonth()-5+index);
    const month = date.toISOString().slice(0,7); monthKeys.push(month);
    if (`${month}-01`<period.start) continue;
    for (let place=0;place<places.length;place++) for (let activity=0;activity<activities.length;activity++) {
      const method=activities[activity]; const jobs=6+index*2+place+(activity%3);
      const referred=Math.floor(jobs*.6); const veecs=jobs*method.veecs;
      outcomes.push({ month,postcode:places[place].postcode,activity:method.key,sector:(place+activity)%3===0 ? "business" : "residential",jobs,value:jobs*method.value,local:Math.floor(jobs*(.60+index*.035)),veecs,stcs:jobs*method.stcs,carbon:veecs,campaign:(place+activity)%campaigns.length,referred,enquiries:referred*2+3 });
    }
  }
  const completedJobs=total(outcomes,"jobs"); const localJobs=total(outcomes,"local");
  const rows=activities.map(activity => group(outcomes.filter(row => row.activity===activity.key),activity.key,activity.label));
  const postcodeRows=places.map(place => ({ ...group(outcomes.filter(row => row.postcode===place.postcode),place.postcode,`${place.label} · ${place.postcode}`),registeredLocalBusinesses:place.registeredLocalBusinesses }));
  const firstMonth=outcomes[0]?.month || period.end.slice(0,7);
  return {
    generatedAt:now.toISOString(),mode:"demonstration",
    scope:{ councilId:"demonstration",name:profile?.name || "SECCCA Demonstration",state,postcodes:places.map(place => place.postcode) },
    period:{ key:period.key,label:period.label,start:periodKey === "all" ? `${firstMonth}-01` : period.start,end:period.end,timeZone:period.timeZone },
    metrics:{ completedJobs,completedValueCents:total(outcomes,"value"),localJobs,outsideJobs:completedJobs-localJobs,unknownLocalityJobs:0,localSharePercent:completedJobs ? localJobs/completedJobs*100 : null,registeredLocalBusinesses:places.reduce((sum,place)=>sum+place.registeredLocalBusinesses,0),attributedEnquiries:total(outcomes,"enquiries"),attributedCompletedJobs:total(outcomes,"referred"),veecQuantity:total(outcomes,"veecs"),stcQuantity:total(outcomes,"stcs"),estimatedTonnesCo2e:total(outcomes,"carbon") },
    activities:rows,
    sectors:{basis:"recorded_customer_type",suppressed:false,coverageNote:"All TLink sector outcomes are fictional demonstration data. Generation kW illustrates sample solar capacity only; actual generation is unavailable.",rows:COUNCIL_SECTORS.map(sector=>{
      const matches=outcomes.filter(row=>row.sector===sector.key), solar=matches.filter(row=>row.activity==="solar");
      return {...sector,metrics:{completedJobs:total(matches,"jobs"),completedValueCents:total(matches,"value"),veecQuantity:total(matches,"veecs"),stcQuantity:total(matches,"stcs"),estimatedTonnesCo2e:total(matches,"carbon"),generationInstallations:total(solar,"jobs"),generationCapacityKw:total(solar,"jobs")*6,storageInstallations:0,storageCapacityKwh:0,measuredGenerationKwh:null},activities:activities.map(activity=>group(matches.filter(row=>row.activity===activity.key),activity.key,activity.label)),postcodes:places.map(place=>group(matches.filter(row=>row.postcode===place.postcode),place.postcode,place.label)),trend:[]};
    })},
    enquiries: {total:total(outcomes,"enquiries")+completedJobs,postcodes:places.map(place=>({postcode:place.postcode,count:total(outcomes.filter(row=>row.postcode===place.postcode),"enquiries")+total(outcomes.filter(row=>row.postcode===place.postcode),"jobs")})),trend:monthKeys.filter(month=>outcomes.some(row=>row.month===month)).map(month=>({month,count:total(outcomes.filter(row=>row.month===month),"enquiries")+total(outcomes.filter(row=>row.month===month),"jobs")})),suppressed:false},
    postcodes:postcodeRows,
    map:{ coordinateBasis:"postcode_centroid",cells:postcodeRows.map(row => { const coordinate=postcodeCoordinate(row.key); return { postcode:row.key,label:row.label,position:coordinate ? {lat:coordinate[0],lng:coordinate[1]} : null,completedJobs:row.completedJobs,registeredLocalBusinesses:row.registeredLocalBusinesses }; }),boundaryNote:"Selected representative SECCCA demonstration postcodes, not a verified entire alliance boundary; synthetic TLink outcomes, no council affiliation. Markers show real postcode centres, not businesses or customer addresses. Postcodes cross municipal boundaries." },
    trend:monthKeys.filter(month => outcomes.some(row => row.month===month)).map(month => {
      const next=new Date(`${month}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth()+1);
      const end=new Date(next.getTime()-86400000).toISOString().slice(0,10);
      return { ...group(outcomes.filter(row => row.month===month),month,`${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sept","Oct","Nov","Dec"][Number(month.slice(5,7))-1]} ${month.slice(0,4)}`),start:`${month}-01`,end:end<period.end ? end : period.end };
    }),
    campaigns:campaigns.map((campaign,index) => { const rows=outcomes.filter(row => row.campaign===index); return { ...campaign,enquiries:total(rows,"enquiries"),completedJobs:total(rows,"referred"),completedValueCents:rows.reduce((sum,row) => sum+row.referred*(row.value/row.jobs),0) }; }),
    dataQuality:{ minimumCohort:COUNCIL_MINIMUM_COHORT,suppressed:false,suppressedBreakdowns:[],missingInvoice:0,missingLocality:0,missingCarbonMethod:false,impactEvidence:"demonstration",impactCoverageJobs:completedJobs,coverageNote:"Fictional TLink participation only. Selected representative SECCCA postcodes illustrate the area, not a verified entire alliance boundary. Campaigns and every TLink outcome are synthetic with no council affiliation. No customer or trade records are used. Carbon represents an illustrative lifetime VEU abatement equivalent only, excluding STCs." },
    methodology:["DEMONSTRATION: selected representative SECCCA postcodes, not a verified entire alliance boundary; synthetic TLink outcomes, no council affiliation. Real postcode centres do not define a council boundary. TLink sample data must not be used as evidence of actual outcomes, certificate creation or measured emissions reductions.","Illustrative carbon totals use the fictional VEEC quantity as a lifetime abatement proxy. STCs are displayed separately and contribute no carbon figure. Actual reporting requires governed scheme and activity evidence.",...COUNCIL_REPORT_METHODOLOGY],
  };
}
