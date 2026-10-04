"use client";
/// <reference types="google.maps" />
/* eslint-disable @next/next/no-img-element -- Map tiles must retain their native pixel size and standard browser cache. */

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { CouncilReport } from "@/lib/council-reporting";
import type { CouncilMapTrade } from "@/lib/council-map-directory";
import type { CouncilApi } from "../CouncilPortal";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import { loadGoogleMaps, onGoogleMapsAuthFailure } from "@/lib/google-maps-client";
import { councilPreviewTiles, fitCouncilMap, layoutCouncilMapMarkers, moveCouncilMap, preferredCouncilMapLayer, MAP_MAX_ZOOM, MAP_MIN_ZOOM, type CouncilMapView } from "@/lib/council-map-view";
import { CouncilIcon } from "./CouncilPrimitives";
import styles from "./CouncilMap.module.css";

type MapResponse = { ok: true; configured: boolean; apiKey: string; mapId: string; trades: CouncilMapTrade[]; coverage: { listedTrades: number; unlocatedTrades: number; total?: number; truncated?: boolean } };
type Selection = { kind: "area" | "trade"; id: string } | null;
export type CouncilMapPublicLayer = {
  id: string;
  label: string;
  unit: string;
  sourceLabel: string;
  postcodes: Array<{ postcode: string; value: number | null }>;
};
const number = (value: number | null) => value === null ? "Protected" : value.toLocaleString("en-AU");
const publicValue = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const publicNumber = (value: number | null, compact = false) => value === null ? (compact ? "No data" : "Not available") : value.toLocaleString("en-AU", { notation: compact ? "compact" : "standard", maximumSignificantDigits: compact ? 3 : 12 });
const serviceLabel = (value: string) => ENERGY_SERVICE_LABELS[value] || value;
const areaName = (label: string, postcode: string) => label.endsWith(` · ${postcode}`) ? label.slice(0,-(` · ${postcode}`).length) : label;

function demoTrades(report: CouncilReport): CouncilMapTrade[] {
  const examples = [
    ["Greendale Electrical", "Heating and cooling"], ["Neighbourhood Solar", "Rooftop solar"],
    ["Community Hot Water", "Heat pump hot water"], ["Brightside Energy", "Heating and cooling"],
    ["Local Comfort Co", "Insulation"], ["Green Roof Solar", "Rooftop solar"],
    ["Village Electrical", "Electrical upgrades"], ["Future Home Services", "Heat pump hot water"],
  ];
  return report.map.cells.flatMap((cell,areaIndex) => Array.from({length:cell.registeredLocalBusinesses||0},(_,index) => {
    const [name,capability]=examples[(index+areaIndex*2)%examples.length];
    return { id: `demo-trade-${cell.postcode}-${index}`, name: `${name} ${index+1} · Demo`, postcode: cell.postcode, suburb: areaName(cell.label,cell.postcode), state: report.scope.state, position: cell.position, capabilities: [capability], website: null };
  }));
}

export function CouncilMap({ report, api, publicLayers = [] }: { report: CouncilReport; api?: CouncilApi; publicLayers?: CouncilMapPublicLayer[] }) {
  const demonstration = report.mode === "demonstration";
  const container = useRef<HTMLDivElement>(null);
  const googleCanvas = useRef<HTMLDivElement>(null);
  const directoryPanel = useRef<HTMLElement>(null);
  const googleMap = useRef<google.maps.Map | null>(null);
  const [size,setSize] = useState({ width: 900, height: 590 });
  const [view,setView] = useState<CouncilMapView>(() => fitCouncilMap(report.map.cells.flatMap(cell => cell.position ? [cell.position] : []),900,590));
  const [liveTrades,setTrades] = useState<CouncilMapTrade[]>([]);
  const trades = useMemo(() => demonstration ? demoTrades(report) : liveTrades,[demonstration,report,liveTrades]);
  const [state,setState] = useState(demonstration ? "ready" : "loading");
  const [directoryError,setDirectoryError] = useState("");
  const [truncated,setTruncated] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [tileError,setTileError] = useState(false);
  const [selection,setSelection] = useState<Selection>(null);
  const [query,setQuery] = useState("");
  const [heat,setHeat] = useState(true);
  const [showTrades,setShowTrades] = useState(true);
  const [showArea,setShowArea] = useState(true);
  // null means automatic; an explicit empty string keeps the user's TLink choice.
  const [layerId,setLayerId] = useState<string | null>(null);
  const publicLayer = publicLayers.find(layer => layer.id === (layerId ?? preferredCouncilMapLayer(publicLayers,report.scope.postcodes)));
  const publicValues = useMemo(() => new Map(publicLayer?.postcodes.map(row => [row.postcode, publicValue(row.value)])),[publicLayer]);
  const [postcodeQuery,setPostcodeQuery] = useState("");
  const [postcodePage,setPostcodePage] = useState(0);
  const drag = useRef<{ pointer: number; x: number; y: number; view: CouncilMapView } | null>(null);
  const viewRef = useRef(view);
  const cellsRef = useRef(report.map.cells);
  useEffect(() => { viewRef.current = view; },[view]);
  useEffect(() => { cellsRef.current = report.map.cells; },[report.map.cells]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
      if (width && height) {
        setSize(previous => previous.width === width && previous.height === height ? previous : {width,height});
        setView(fitCouncilMap(cellsRef.current.flatMap(cell => cell.position ? [cell.position] : []),width,height));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  },[]);

  useEffect(() => {
    if (demonstration || !api) return;
    let disposed = false;
    let created: google.maps.Map | null = null;
    let mapApi: typeof google.maps | null = null;
    const unsubscribe = onGoogleMapsAuthFailure(() => { if (!disposed) setState("auth"); });
    async function initialise() {
      let directoryLoaded = false;
      try {
        const response = await api!<MapResponse>(`/api/council/map?councilId=${encodeURIComponent(report.scope.councilId)}`);
        if (disposed) return;
        setTrades(response.trades.map(trade => ({...trade,capabilities:trade.capabilities.map(serviceLabel)})));
        directoryLoaded = true;
        setTruncated(Boolean(response.coverage.truncated)); setDirectoryError("");
        if (!response.configured || !response.apiKey || !response.mapId) { setState("unconfigured"); return; }
        mapApi = await loadGoogleMaps(response.apiKey);
        if (disposed || !googleCanvas.current) return;
        created = new mapApi.Map(googleCanvas.current, {
          center: viewRef.current, zoom: viewRef.current.zoom, mapId: response.mapId, mapTypeControl: false,
          minZoom: MAP_MIN_ZOOM, maxZoom: MAP_MAX_ZOOM,
          streetViewControl: false, fullscreenControl: false, zoomControl: false, cameraControl: false,
          clickableIcons: false, tilt: 0, heading: 0, tiltInteractionEnabled: false, headingInteractionEnabled: false,
          gestureHandling: "cooperative", scaleControl: true,
          colorScheme: (googleCanvas.current.closest("[data-colour-mode]")?.getAttribute("data-colour-mode") ?? document.documentElement.dataset.tlinkColourMode) === "night" ? "DARK" : "LIGHT",
        });
        googleMap.current = created;
        created.addListener("bounds_changed", () => {
          const centre = created?.getCenter(), zoom = created?.getZoom();
          if (!centre || zoom === undefined || disposed) return;
          const next = { lat: centre.lat(), lng: centre.lng(), zoom };
          setView(current => Math.abs(current.lat-next.lat)<1e-8 && Math.abs(current.lng-next.lng)<1e-8 && current.zoom===next.zoom ? current : next);
        });
        setState("ready");
      } catch {
        if (!disposed) {
          if (!directoryLoaded) setTrades([]);
          setState("unavailable");
          setDirectoryError(directoryLoaded ? "The basemap could not be loaded. You can still explore the local business directory." : "The map or business directory could not be loaded. Try refreshing it.");
        }
      }
    }
    void initialise();
    return () => { disposed = true; unsubscribe(); if (created && mapApi) mapApi.event.clearInstanceListeners(created); googleMap.current = null; };
  },[api,demonstration,report.scope.councilId,report.generatedAt,attempt]);

  useEffect(() => {
    const map = googleMap.current;
    if (!map) return;
    const centre = map.getCenter();
    if (!centre || Math.abs(centre.lat()-view.lat)>1e-8 || Math.abs(centre.lng()-view.lng)>1e-8) map.setCenter(view);
    if (map.getZoom()!==view.zoom) map.setZoom(view.zoom);
  },[view]);

  const filteredTrades = useMemo(() => {
    const search = query.trim().toLowerCase();
    return trades.filter(trade => report.scope.postcodes.includes(trade.postcode) && trade.state===report.scope.state
      && (!search || [trade.name,trade.postcode,trade.suburb,...trade.capabilities.map(serviceLabel)].join(" ").toLowerCase().includes(search)));
  },[trades,query,report.scope.postcodes,report.scope.state]);
  const pinGroups = useMemo(() => {
    const groups = new Map<string,CouncilMapTrade[]>();
    for (const trade of filteredTrades) {
      if (!trade.position) continue;
      const group = groups.get(trade.postcode) || []; group.push(trade); groups.set(trade.postcode,group);
    }
    return [...groups.values()];
  },[filteredTrades]);
  const selectedTrade = selection?.kind === "trade" ? filteredTrades.find(trade => trade.id===selection.id) : undefined;
  const selectedPostcode = selection?.kind === "area" ? selection.id : selectedTrade?.postcode;
  const selectedCell = report.map.cells.find(cell => cell.postcode===selectedPostcode);
  const listedTrades = selectedPostcode ? filteredTrades.filter(trade => trade.postcode===selectedPostcode) : filteredTrades;
  const activityValue = (cell: CouncilReport["map"]["cells"][number]) => publicLayer ? publicValues.get(cell.postcode) ?? null : publicValue(cell.completedJobs);
  const highestActivity = Math.max(0,...report.map.cells.map(cell => activityValue(cell) ?? 0));
  const maxActivity = highestActivity || 1;
  const positions = report.map.cells.flatMap(cell => cell.position ? [cell.position] : []);
  const tiles = demonstration ? councilPreviewTiles(view,size.width,size.height) : [];
  const markers = layoutCouncilMapMarkers(report.map.cells.flatMap(cell=>cell.position?[{key:cell.postcode,position:cell.position}]:[]),view,size.width,size.height,selectedPostcode);
  const markerPositions = new Map(markers.visible.map(marker=>[marker.key,marker]));
  const anchors = new Map(markers.anchors.map(marker=>[marker.key,marker]));
  const tradeGroups = new Map(pinGroups.map(group=>[group[0].postcode,group]));
  const postcodeRows = report.map.cells.filter(cell=>`${cell.postcode} ${cell.label}`.toLowerCase().includes(postcodeQuery.trim().toLowerCase()));
  const pageSize = 8, pageCount = Math.max(1,Math.ceil(postcodeRows.length/pageSize));
  const activePage = Math.min(postcodePage,pageCount-1);
  const displayedPostcodes = postcodeRows.slice(activePage*pageSize,(activePage+1)*pageSize);
  function fitArea() { setView(fitCouncilMap(positions,size.width,size.height)); setSelection(null); }
  function chooseArea(cell: CouncilReport["map"]["cells"][number], focus = false) {
    setSelection({kind:"area",id:cell.postcode});
    if (!cell.position) return;
    const point = anchors.get(cell.postcode);
    const crowded = point && markers.anchors.some(other=>other.key!==cell.postcode&&Math.hypot(other.x-point.x,other.y-point.y)<28);
    if (focus || crowded) setView(current=>({...cell.position!,zoom:focus?Math.max(current.zoom,12):Math.min(MAP_MAX_ZOOM,current.zoom+1)}));
    if (focus) container.current?.scrollIntoView({behavior:"smooth",block:"center"});
  }
  function chooseTrade(trade: CouncilMapTrade) {
    setSelection({kind:"trade",id:trade.id});
    if(trade.position)setView(current=>({...trade.position!,zoom:Math.max(current.zoom,11)}));
    if(window.matchMedia("(max-width:850px)").matches)requestAnimationFrame(()=>directoryPanel.current?.scrollIntoView({behavior:"smooth",block:"start"}));
  }
  function pan(event: PointerEvent<HTMLDivElement>) {
    if (!demonstration || event.button !== 0 || (event.target as HTMLElement).closest("button,a")) return;
    drag.current = {pointer:event.pointerId,x:event.clientX,y:event.clientY,view}; event.currentTarget.setPointerCapture(event.pointerId);
  }
  function panMove(event: PointerEvent<HTMLDivElement>) { const active=drag.current; if(active?.pointer===event.pointerId)setView(moveCouncilMap(active.view,event.clientX-active.x,event.clientY-active.y)); }
  const ready = state === "ready";

  return <section className={styles.root} aria-label="Council community map">
    {publicLayers.length > 0 && <div className={styles.sourcePanel}>
      <label className={styles.layerSelect}>Map intensity<select value={publicLayer?.id ?? ""} onChange={event=>{setLayerId(event.target.value);setHeat(true);}}>
        <option value="">TLink completed upgrades</option>
        {publicLayers.map(layer=><option key={layer.id} value={layer.id}>{layer.label}</option>)}
      </select></label>
      <div className={styles.sourceDetail} aria-live="polite"><strong>{publicLayer ? publicLayer.label : "Completed upgrades through TLink"}</strong><p>{publicLayer ? `Source: ${publicLayer.sourceLabel}. Values shown in ${publicLayer.unit}.` : demonstration ? "Source: fictional TLink demonstration records." : `Source: completed upgrades recorded in TLink · ${report.period.label}.`}</p><p>{publicLayer ? `Public data uses its own published reporting period. It is separate from ${demonstration ? "the fictional TLink demonstration activity" : "TLink activity"}.` : `${report.metrics.completedJobs === 0 ? "No completed TLink upgrades are recorded for this period. " : ""}Choose a public dataset to compare the wider community context.`}</p></div>
    </div>}
    <div className={styles.toolbar}><div className={styles.layers} aria-label="Map layers">
      <button type="button" aria-pressed={showTrades} onClick={()=>setShowTrades(!showTrades)}><span className={styles.tradeDot}/>Local trades</button>
      <button type="button" aria-pressed={heat} onClick={()=>setHeat(!heat)}><span className={`${styles.heatDot} ${publicLayer ? styles.publicDot : ""}`}/>{publicLayer ? "Public data heat" : "Activity heat"}</button>
      <button type="button" aria-pressed={showArea} onClick={()=>setShowArea(!showArea)}><span className={styles.areaDot}/>Reporting postcodes</button>
    </div><button type="button" className={styles.fit} onClick={fitArea}><CouncilIcon name="map" size={16}/>Fit council area</button></div>
    {markers.hidden>0&&ready&&<p className={styles.densityNotice}>Dots stay at postcode centres. Zoom in for labels or search the postcode list below.</p>}
    <div className={styles.layout}>
      <div ref={container} className={styles.map} tabIndex={0} role="region" aria-label="Interactive postcode map. Use arrow keys to pan and plus or minus to zoom." onKeyDown={event=>{
        if(event.target!==event.currentTarget)return;
        const movements:Record<string,[number,number]>={ArrowLeft:[80,0],ArrowRight:[-80,0],ArrowUp:[0,80],ArrowDown:[0,-80]};
        if(movements[event.key]){event.preventDefault();setView(current=>moveCouncilMap(current,...movements[event.key]));}
        if(event.key==="+"||event.key==="="||event.key==="-"){event.preventDefault();setView(current=>({...current,zoom:Math.max(MAP_MIN_ZOOM,Math.min(MAP_MAX_ZOOM,current.zoom+(event.key==="-"?-1:1)))}));}
      }} onPointerDown={pan} onPointerMove={panMove} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
        <div ref={googleCanvas} className={styles.basemap}/>
        {demonstration&&<div className={styles.tiles} aria-hidden="true">{tiles.map(tile=><img key={tile.key} src={tile.url} alt="" width={256} height={256} draggable={false} referrerPolicy="strict-origin-when-cross-origin" style={{left:tile.x,top:tile.y}} onError={()=>setTileError(true)}/>)}</div>}
        {ready&&<div className={styles.overlays}>
          {report.map.cells.map(cell=>{
            const point=anchors.get(cell.postcode);
            if(!point)return null;
            const value=activityValue(cell);
            const intensity=(value??0)/maxActivity;
            const group=showTrades ? tradeGroups.get(cell.postcode) : undefined;
            const selected=selectedPostcode===cell.postcode;
            const description=`${cell.postcode}: ${publicLayer ? `${publicNumber(value)} ${publicLayer.unit}` : `${number(cell.completedJobs)} TLink upgrades`}${group ? `. ${group.length} local trades` : ""}. Select to explore this postcode.`;
            return <div className={`${styles.areaAnchor} ${selected ? styles.selectedAnchor : ""}`} key={cell.postcode} style={{left:point.x,top:point.y}}>
              {heat&&value!==null&&value>0&&<span className={`${styles.heat} ${publicLayer ? styles.publicHeat : ""}`} style={{width:28+intensity*52,height:28+intensity*52,opacity:.3+intensity*.35}}/>}
              {(showArea||group)&&<button type="button" className={`${styles.anchorButton} ${group ? styles.tradeAnchor : ""} ${value===null ? styles.unknownAnchor : ""}`} aria-pressed={selected} aria-label={description} title={description} onClick={()=>group?.length===1&&!showArea?chooseTrade(group[0]):chooseArea(cell)}>{group&&<CouncilIcon name="business" size={13}/>}</button>}
              {showArea&&markerPositions.has(cell.postcode)&&<span className={styles.postcode} aria-hidden="true">{cell.postcode}<span>{publicLayer ? publicNumber(value,true) : `${number(cell.completedJobs)} upgrades`}</span></span>}
            </div>;
          })}
        </div>}
        <div className={styles.mapBadge}><span/> {publicLayer ? "Public data · postcode areas" : demonstration?"Illustrative outcomes · real geography":"Your community in TLink"}</div>
        {ready&&<div className={styles.zoom}><button type="button" aria-label="Zoom in" disabled={view.zoom>=MAP_MAX_ZOOM} onClick={()=>setView(current=>({...current,zoom:Math.min(MAP_MAX_ZOOM,current.zoom+1)}))}>+</button><button type="button" aria-label="Zoom out" disabled={view.zoom<=MAP_MIN_ZOOM} onClick={()=>setView(current=>({...current,zoom:Math.max(MAP_MIN_ZOOM,current.zoom-1)}))}>−</button></div>}
        {!ready&&<div className={styles.unavailable} role="status"><CouncilIcon name="map" size={30}/><strong>{state==="loading"?"Loading your community…":state==="unconfigured"?"Map connection is not configured":state==="auth"?"Map connection needs attention":"Map temporarily unavailable"}</strong><p>{state==="loading"?"Preparing postcode overlays and local trade pins.":"Your postcode results and business directory remain available below. TLink support can check the map connection."}</p>{state!=="loading"&&<button type="button" onClick={()=>{setState("loading");setAttempt(current=>current+1);}}>Retry map</button>}</div>}
        {tileError&&<div className={styles.tileNotice} role="status">Some basemap tiles are unavailable. Postcode positions remain approximate.</div>}
        {heat&&ready&&highestActivity>0&&<div className={`${styles.legend} ${publicLayer ? styles.publicLegend : ""}`}><span>{publicLayer ? "Lower value" : "Fewer upgrades"}</span><i/><span>{publicLayer ? "Higher" : "More"}</span></div>}
        {demonstration&&<div className={styles.attribution}>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Map issue</a></div>}
      </div>
      <aside ref={directoryPanel} className={`${styles.directory} ${selectedTrade?styles.profileDirectory:""}`}>
        <div className={styles.directoryHeader}><span className={styles.eyebrow}>LOCAL DELIVERY NETWORK</span><h2>{selectedTrade?"Business profile":selectedCell?selectedCell.label:"Local trades"}</h2><p>{selectedCell?`${selectedCell.postcode} · ${number(selectedCell.completedJobs)} completed upgrades`:`${trades.length.toLocaleString()} ${demonstration?"illustrative":"onboarded"} business profiles`}</p></div>
        {publicLayer&&selectedCell&&<p className={styles.selectedPublicValue}><strong>{publicNumber(activityValue(selectedCell))} {publicLayer.unit}</strong><span>{publicLayer.label} · {publicLayer.sourceLabel}</span></p>}
        <label className={styles.search}>Find a trade or postcode<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setSelection(null);}} placeholder="Business, service or postcode"/></label>
        {selection&&<button type="button" className={styles.back} onClick={()=>setSelection(null)}>← All local trades</button>}
        {selectedTrade?<div className={styles.profile}><span className={styles.businessAvatar}><CouncilIcon name="business" size={25}/></span><h3>{selectedTrade.name}</h3><p>{selectedTrade.suburb} {selectedTrade.state} {selectedTrade.postcode}</p><span className={styles.businessStatus}>{demonstration?"Fictional demonstration business":"Onboarded with TLink"}</span><h4>Services</h4><div className={styles.tags}>{selectedTrade.capabilities.map(capability=><span key={capability}>{capability}</span>)}</div>{selectedTrade.website&&<a href={selectedTrade.website} target="_blank" rel="noopener noreferrer">Visit business website ↗</a>}<p className={styles.small}>Pin shows the business postcode area, not its street address. Business location does not establish where every worker is based.</p></div>:<div className={styles.tradeList}>
          {listedTrades.map(trade=><button type="button" key={trade.id} onClick={()=>chooseTrade(trade)}><span className={styles.listAvatar}><CouncilIcon name="business" size={19}/></span><span><strong>{trade.name}</strong><small>{trade.suburb} · {trade.postcode}</small><em>{trade.capabilities.slice(0,2).join(" · ")||"Services not recorded"}</em></span><span aria-hidden="true">›</span></button>)}
          {!listedTrades.length&&<p className={styles.empty}>{directoryError|| (query?"No businesses match that search.":"No onboarded local trades to show in this area yet.")}</p>}
        </div>}
        {truncated&&<p className={styles.small}>Showing the first 500 business profiles. The registered business total includes the full approved area.</p>}
        <p className={styles.directoryFoot}>Business pins appear automatically for onboarded local trades. Private customer and job locations are never shown.</p>
      </aside>
    </div>
    {publicLayer&&<p className={styles.layerNote}>Heat compares {publicLayer.unit} across the reporting postcodes. Zero is a reported value with no heat. “Not available” means no usable value was supplied; it is not zero. Public values are not attributed to council or TLink campaigns.</p>}
    <section className={styles.dataTable} aria-label="Explore reporting postcodes">
      <div className={styles.tableToolbar}><div><h3>Explore reporting postcodes</h3><p>{report.map.cells.length} areas · select a postcode to focus the map</p></div><label>Find a postcode<input type="search" value={postcodeQuery} onChange={event=>{setPostcodeQuery(event.target.value);setPostcodePage(0);}} placeholder="Postcode or area"/></label></div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Postcode map data table"><table><caption>{publicLayer ? `${publicLayer.label} (${publicLayer.unit}). Source: ${publicLayer.sourceLabel}.` : `Completed upgrades recorded in TLink · ${report.period.label}.`}{demonstration ? " TLink activity and businesses are illustrative." : ""}</caption><thead><tr><th scope="col">Postcode</th>{publicLayer&&<th scope="col">{publicLayer.label}<span> {publicLayer.unit}</span></th>}<th scope="col">TLink upgrades</th><th scope="col">Local businesses</th></tr></thead><tbody>{displayedPostcodes.map(cell=><tr key={cell.postcode} data-selected={selectedPostcode===cell.postcode||undefined}><th scope="row"><button type="button" aria-pressed={selectedPostcode===cell.postcode} onClick={()=>chooseArea(cell,true)}>{cell.postcode}<span>{areaName(cell.label,cell.postcode)}</span>{!cell.position&&<small>Map location unavailable</small>}</button></th>{publicLayer&&<td>{publicNumber(activityValue(cell))}</td>}<td>{number(cell.completedJobs)}</td><td>{number(cell.registeredLocalBusinesses)}</td></tr>)}</tbody></table>{!postcodeRows.length&&<p className={styles.empty}>No reporting postcodes match your search.</p>}</div>
      <div className={styles.pagination}><span role="status">{postcodeRows.length ? `${activePage*pageSize+1} to ${Math.min((activePage+1)*pageSize,postcodeRows.length)} of ${postcodeRows.length} postcodes` : "0 matching postcodes"}</span><div><button type="button" disabled={activePage===0} onClick={()=>setPostcodePage(activePage-1)}>Previous</button><button type="button" disabled={activePage>=pageCount-1} onClick={()=>setPostcodePage(activePage+1)}>Next</button></div></div>
    </section>
    <p className={styles.method}>{report.map.boundaryNote} Heat shows relative {publicLayer ? "public data values" : "completed-upgrade totals"} at postcode centres, not customer locations or precise hotspots. {demonstration&&"TLink business profiles and outcomes in this demonstration are fictional. Public datasets, where selected, retain the stated source."}</p>
  </section>;
}
