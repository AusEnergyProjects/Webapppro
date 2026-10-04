"use client";
/// <reference types="google.maps" />
/* eslint-disable @next/next/no-img-element -- Map tiles must retain their native pixel size and standard browser cache. */

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { CouncilReport } from "@/lib/council-reporting";
import type { CouncilMapTrade } from "@/lib/council-map-directory";
import type { CouncilApi } from "../CouncilPortal";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import { loadGoogleMaps, onGoogleMapsAuthFailure } from "@/lib/google-maps-client";
import { councilMapPoint, councilPreviewTiles, fitCouncilMap, layoutCouncilMapMarkers, moveCouncilMap, MAP_MAX_ZOOM, MAP_MIN_ZOOM, type CouncilMapView } from "@/lib/council-map-view";
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
  const [layerId,setLayerId] = useState("");
  const publicLayer = publicLayers.find(layer => layer.id === layerId);
  const publicValues = useMemo(() => new Map(publicLayer?.postcodes.map(row => [row.postcode, publicValue(row.value)])),[publicLayer]);
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
  const maxActivity = Math.max(0,...report.map.cells.map(cell => activityValue(cell) ?? 0)) || 1;
  const positions = report.map.cells.flatMap(cell => cell.position ? [cell.position] : []);
  const tiles = demonstration ? councilPreviewTiles(view,size.width,size.height) : [];
  const markers = layoutCouncilMapMarkers(report.map.cells.flatMap(cell=>cell.position?[{key:cell.postcode,position:cell.position}]:[]),view,size.width,size.height);
  const markerPositions = new Map(markers.visible.map(marker=>[marker.key,marker]));
  function fitArea() { setView(fitCouncilMap(positions,size.width,size.height)); setSelection(null); }
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
      <div className={styles.sourceDetail} aria-live="polite"><strong>{publicLayer ? publicLayer.label : "Completed upgrades through TLink"}</strong><p>{publicLayer ? `Source: ${publicLayer.sourceLabel}. Values shown in ${publicLayer.unit}.` : demonstration ? "Source: fictional TLink demonstration records." : "Source: completed upgrades recorded in TLink for the selected reporting period."}</p><p>{publicLayer ? `Public data uses its own published reporting period. It is separate from ${demonstration ? "the fictional TLink demonstration activity" : "TLink activity"}.` : "Choose a public dataset to compare the wider community context."}</p></div>
    </div>}
    <div className={styles.toolbar}><div className={styles.layers} aria-label="Map layers">
      <button type="button" aria-pressed={showTrades} onClick={()=>setShowTrades(!showTrades)}><span className={styles.tradeDot}/>Local trades</button>
      <button type="button" aria-pressed={heat} onClick={()=>setHeat(!heat)}><span className={`${styles.heatDot} ${publicLayer ? styles.publicDot : ""}`}/>{publicLayer ? "Public data heat" : "Activity heat"}</button>
      <button type="button" aria-pressed={showArea} onClick={()=>setShowArea(!showArea)}><span className={styles.areaDot}/>Reporting postcodes</button>
    </div><button type="button" className={styles.fit} onClick={fitArea}><CouncilIcon name="map" size={16}/>Fit council area</button></div>
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
          {(showTrades||showArea)&&<svg className={styles.leaders} width={size.width} height={size.height} aria-hidden="true">{markers.visible.filter(marker=>Math.abs(marker.x-marker.anchorX)+Math.abs(marker.y-marker.anchorY)>5).map(marker=><g key={marker.key}><line x1={marker.anchorX} y1={marker.anchorY} x2={marker.x} y2={marker.y}/><circle cx={marker.anchorX} cy={marker.anchorY} r={3}/></g>)}</svg>}
          {report.map.cells.map(cell=>{
            if(!cell.position)return null;
            const point=councilMapPoint(cell.position,view,size.width,size.height);
            if(point.x < -200 || point.x > size.width+200 || point.y < -200 || point.y > size.height+200)return null;
            const value=activityValue(cell);
            const intensity=(value??0)/maxActivity;
            const marker=markerPositions.get(cell.postcode);
            return <div className={styles.areaAnchor} key={cell.postcode} style={{left:point.x,top:point.y}}>
              {heat&&value!==null&&value>0&&<span className={`${styles.heat} ${publicLayer ? styles.publicHeat : ""}`} style={{width:90+intensity*150,height:90+intensity*150,opacity:.45+intensity*.3}}/>}
              {showArea&&<><span className={`${styles.areaCircle} ${publicLayer&&value===null ? styles.unknownArea : ""}`}/>{marker&&<button type="button" className={styles.postcode} style={{left:marker.x-point.x,top:marker.y-point.y+28}} aria-pressed={selectedPostcode===cell.postcode} aria-label={publicLayer ? `${cell.postcode}: ${publicNumber(value)} ${publicLayer.unit}. View local trades.` : undefined} onClick={()=>setSelection({kind:"area",id:cell.postcode})}>{cell.postcode}<span>{publicLayer ? publicNumber(value,true) : `${number(cell.completedJobs)} upgrades`}</span></button>}</>}
            </div>;
          })}
          {showTrades&&pinGroups.map(group=>{
            const point=markerPositions.get(group[0].postcode);
            if(!point)return null;
            if(group.length>1)return <button key={group[0].postcode} type="button" className={styles.cluster} style={{left:point.x,top:point.y-25}} aria-label={`${group.length} local trades in ${group[0].postcode}`} onClick={()=>setSelection({kind:"area",id:group[0].postcode})}><CouncilIcon name="business" size={15}/>{group.length}</button>;
            const trade=group[0];
            return <button type="button" key={trade.id} className={`${styles.pin} ${selectedTrade?.id===trade.id?styles.selectedPin:""}`} style={{left:point.x,top:point.y-27}} title={`${trade.name} · approximate postcode location`} aria-label={`View ${trade.name} in ${trade.postcode}`} onClick={()=>chooseTrade(trade)}><CouncilIcon name="business" size={17}/></button>;
          })}
          {showTrades&&selectedTrade?.position&&<button type="button" className={`${styles.pin} ${styles.selectedPin}`} style={{left:councilMapPoint(selectedTrade.position,view,size.width,size.height).x,top:councilMapPoint(selectedTrade.position,view,size.width,size.height).y-72}} aria-label={`Selected: ${selectedTrade.name}`} onClick={()=>chooseTrade(selectedTrade)}><CouncilIcon name="business" size={17}/></button>}
        </div>}
        <div className={styles.mapBadge}><span/> {publicLayer ? "Public data · postcode areas" : demonstration?"Illustrative outcomes · real geography":"Your community in TLink"}</div>
        {markers.hidden>0&&ready&&<div className={styles.densityNotice}>Zoom in to separate nearby postcodes. All areas are listed below.</div>}
        {ready&&<div className={styles.zoom}><button type="button" aria-label="Zoom in" disabled={view.zoom>=MAP_MAX_ZOOM} onClick={()=>setView(current=>({...current,zoom:Math.min(MAP_MAX_ZOOM,current.zoom+1)}))}>+</button><button type="button" aria-label="Zoom out" disabled={view.zoom<=MAP_MIN_ZOOM} onClick={()=>setView(current=>({...current,zoom:Math.max(MAP_MIN_ZOOM,current.zoom-1)}))}>−</button></div>}
        {!ready&&<div className={styles.unavailable} role="status"><CouncilIcon name="map" size={30}/><strong>{state==="loading"?"Loading your community…":state==="unconfigured"?"Map connection is not configured":state==="auth"?"Map connection needs attention":"Map temporarily unavailable"}</strong><p>{state==="loading"?"Preparing postcode overlays and local trade pins.":"Your postcode results and business directory remain available below. TLink support can check the map connection."}</p>{state!=="loading"&&<button type="button" onClick={()=>{setState("loading");setAttempt(current=>current+1);}}>Retry map</button>}</div>}
        {tileError&&<div className={styles.tileNotice} role="status">Some basemap tiles are unavailable. Postcode positions remain approximate.</div>}
        {heat&&ready&&<div className={`${styles.legend} ${publicLayer ? styles.publicLegend : ""}`}><span>{publicLayer ? "Lower value" : "Fewer upgrades"}</span><i/><span>{publicLayer ? "Higher" : "More"}</span></div>}
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
    <div className={styles.areaCards} aria-label="Postcode map data">{report.map.cells.map(cell=><button type="button" key={cell.postcode} aria-pressed={selectedPostcode===cell.postcode} onClick={()=>{setSelection({kind:"area",id:cell.postcode});if(cell.position)setView({...cell.position,zoom:12});}}><span>{cell.postcode} <small>{areaName(cell.label,cell.postcode)}</small></span><strong>{publicLayer ? publicNumber(activityValue(cell)) : number(cell.completedJobs)} <small>{publicLayer ? publicLayer.unit : "upgrades"}</small></strong>{publicLayer&&<span className={styles.tlinkCount}>{number(cell.completedJobs)} TLink upgrades{demonstration ? " · illustrative" : ""}</span>}<span>{number(cell.registeredLocalBusinesses)} local businesses</span>{!cell.position&&<small>Location unavailable</small>}</button>)}</div>
    {publicLayers.length>0&&<details className={styles.dataTable}><summary>View postcode data table</summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Postcode map data table"><table><caption>{publicLayer ? `${publicLayer.label} (${publicLayer.unit}). Source: ${publicLayer.sourceLabel}.` : "Completed upgrades and local businesses recorded in TLink."}{demonstration ? " TLink activity and businesses are illustrative." : ""}</caption><thead><tr><th scope="col">Postcode</th>{publicLayer&&<th scope="col">{publicLayer.label} ({publicLayer.unit})</th>}<th scope="col">TLink upgrades</th><th scope="col">Local businesses</th></tr></thead><tbody>{report.map.cells.map(cell=><tr key={cell.postcode}><th scope="row">{cell.postcode} <span>{areaName(cell.label,cell.postcode)}</span></th>{publicLayer&&<td>{publicNumber(activityValue(cell))}</td>}<td>{number(cell.completedJobs)}</td><td>{number(cell.registeredLocalBusinesses)}</td></tr>)}</tbody></table></div></details>}
    <p className={styles.method}>{report.map.boundaryNote} Heat shows relative {publicLayer ? "public data values" : "completed-upgrade totals"} at postcode centres, not customer locations or precise hotspots. {demonstration&&"TLink business profiles and outcomes in this demonstration are fictional. Public datasets, where selected, retain the stated source."}</p>
  </section>;
}
