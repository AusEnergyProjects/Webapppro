"use client";
/// <reference types="google.maps" />
/* eslint-disable @next/next/no-img-element -- Map tiles must retain their native pixel size and standard browser cache. */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type MouseEvent } from "react";
import type { CouncilReport } from "@/lib/council-reporting";
import type { CouncilMapTrade } from "@/lib/council-map-directory";
import type { CouncilApi } from "../CouncilPortal";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import { loadGoogleMaps, onGoogleMapsAuthFailure } from "@/lib/google-maps-client";
import { councilPreviewTiles, fitCouncilMap, layoutCouncilMapMarkers, moveCouncilMap, preferredCouncilMapLayer, councilMapPoint, mapWorldPoint, mapWorldPosition, zoomCouncilMap, councilMapWheelDelta, MAP_MAX_ZOOM, MAP_MIN_ZOOM, type CouncilMapView } from "@/lib/council-map-view";
import { councilMapHeat, createCouncilMapHeatScale, COUNCIL_MAP_HEAT_GRADIENT } from "@/lib/council-map-heat";
import { loadCouncilPostcodeBoundaries, councilPostcodeBoundaryPath, councilPostcodeBoundaryContains, councilPostcodeBoundaryLabelPosition, COUNCIL_POSTCODE_BOUNDARY_SOURCE, type CouncilPostcodeBoundary } from "@/lib/council-postcode-boundaries";
import { CouncilPostcodeDetails, type CouncilPostcodeDetailsSources } from "./CouncilPostcodeDetails";
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
const publicNumber = (value: number | null) => value === null ? "Not available" : value.toLocaleString("en-AU", { maximumSignificantDigits: 12 });
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

export function CouncilMap({ report, api, publicLayers = [], postcodeDetails }: { report: CouncilReport; api?: CouncilApi; publicLayers?: CouncilMapPublicLayer[]; postcodeDetails?: CouncilPostcodeDetailsSources }) {
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
  const [boundaries,setBoundaries] = useState<CouncilPostcodeBoundary[]>([]);
  const [boundaryState,setBoundaryState] = useState<"loading" | "ready" | "unavailable">("loading");
  const boundaryByPostcode = useMemo(()=>new Map(boundaries.map(boundary=>[boundary.properties.postcode,boundary])),[boundaries]);
  const positions = useMemo(()=>report.map.cells.flatMap(cell=>{
    const boundary=boundaryByPostcode.get(cell.postcode);
    return boundary ? [{lat:boundary.bbox[1],lng:boundary.bbox[0]},{lat:boundary.bbox[3],lng:boundary.bbox[2]}] : cell.position ? [cell.position] : [];
  }),[report.map.cells,boundaryByPostcode]);
  const drag = useRef<{ pointer: number; x: number; y: number; view: CouncilMapView } | null>(null);
  const clickOrigin = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const viewRef = useRef(view);
  const positionsRef = useRef(positions);
  // Google camera events only update the overlay. Writing every rendered view
  // back into Google interrupted its next drag frame with an older centre.
  function changeView(update: CouncilMapView | ((current: CouncilMapView) => CouncilMapView)) {
    const next = typeof update === "function" ? update(viewRef.current) : update;
    googleMap.current?.setOptions({center: next, zoom: next.zoom});
    viewRef.current = next;
    setView(next);
  }
  useEffect(() => { positionsRef.current=positions; changeView(fitCouncilMap(positions,size.width,size.height)); },[positions,size.width,size.height]);
  useEffect(() => {
    const controller = new AbortController();
    setBoundaryState("loading");
    void loadCouncilPostcodeBoundaries(report.scope.postcodes, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setBoundaries(result.features); setBoundaryState("ready");
    }).catch(() => { if (!controller.signal.aborted) { setBoundaries([]); setBoundaryState("unavailable"); } });
    return () => controller.abort();
  },[report.scope.postcodes]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let accumulated = 0, lastTime = 0;
    const wheel = (event: WheelEvent) => {
      // React wheel listeners are passive. Capture natively before Google or the
      // browser sees Ctrl-wheel, even when the pointer is over a postcode label.
      event.preventDefault(); event.stopPropagation();
      const delta = councilMapWheelDelta(event.deltaY,event.deltaMode,event.ctrlKey);
      if (event.timeStamp-lastTime>180 || Math.sign(delta)!==Math.sign(accumulated)) accumulated=0;
      lastTime=event.timeStamp; accumulated+=delta;
      if (Math.abs(accumulated)<40) return;
      const direction = Math.sign(accumulated); accumulated=0;
      const rect = element.getBoundingClientRect();
      changeView(current=>zoomCouncilMap(current,current.zoom-direction,event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height));
    };
    element.addEventListener("wheel",wheel,{passive:false,capture:true});
    return () => element.removeEventListener("wheel",wheel,{capture:true});
  },[]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
      if (width && height) {
        setSize(previous => previous.width === width && previous.height === height ? previous : {width,height});
        changeView(fitCouncilMap(positionsRef.current,width,height));
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
          gestureHandling: "greedy", scrollwheel: false, scaleControl: true,
          colorScheme: (googleCanvas.current.closest("[data-colour-mode]")?.getAttribute("data-colour-mode") ?? document.documentElement.dataset.tlinkColourMode) === "night" ? "DARK" : "LIGHT",
        });
        googleMap.current = created;
        created.addListener("bounds_changed", () => {
          const centre = created?.getCenter(), zoom = created?.getZoom();
          if (!centre || zoom === undefined || disposed) return;
          const next = { lat: centre.lat(), lng: centre.lng(), zoom };
          viewRef.current = next;
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
  const heatScale = createCouncilMapHeatScale(report.map.cells.map(activityValue));
  const tiles = demonstration ? councilPreviewTiles(view,size.width,size.height) : [];
  const mapAreas = useMemo(()=>report.map.cells.flatMap(cell=>{
    const boundary=boundaryByPostcode.get(cell.postcode);
    const position=boundary ? councilPostcodeBoundaryLabelPosition(boundary,cell.position??undefined) : cell.position;
    return position ? [{key:cell.postcode,position}] : [];
  }),[report.map.cells,boundaryByPostcode]);
  const markers = layoutCouncilMapMarkers(mapAreas,view,size.width,size.height,selectedPostcode,boundaries.length>0);
  const markerLabels = new Map(markers.labels.map(label=>[label.key,label]));
  const anchors = new Map(markers.anchors.map(marker=>[marker.key,marker]));
  const boundaryPaths = useMemo(() => boundaries.map(boundary=>({
    postcode: boundary.properties.postcode,
    path: councilPostcodeBoundaryPath(boundary,position=>councilMapPoint(position,view,size.width,size.height)),
  })),[boundaries,view,size.width,size.height]);
  const tradeGroups = new Map(pinGroups.map(group=>[group[0].postcode,group]));
  const postcodeRows = report.map.cells.filter(cell=>`${cell.postcode} ${cell.label}`.toLowerCase().includes(postcodeQuery.trim().toLowerCase()));
  const pageSize = 8, pageCount = Math.max(1,Math.ceil(postcodeRows.length/pageSize));
  const activePage = Math.min(postcodePage,pageCount-1);
  const displayedPostcodes = postcodeRows.slice(activePage*pageSize,(activePage+1)*pageSize);
  function fitArea() { changeView(fitCouncilMap(positions,size.width,size.height)); setSelection(null); }
  function chooseArea(cell: CouncilReport["map"]["cells"][number], focus = false) {
    setSelection({kind:"area",id:cell.postcode});
    if (window.matchMedia("(max-width:850px)").matches) requestAnimationFrame(()=>directoryPanel.current?.scrollIntoView({behavior:"smooth",block:"start"}));
    if (!cell.position) return;
    const point = anchors.get(cell.postcode);
    const crowded = point && markers.anchors.some(other=>other.key!==cell.postcode&&Math.hypot(other.x-point.x,other.y-point.y)<28);
    if (focus || (crowded && !boundaryByPostcode.has(cell.postcode))) changeView(current=>({...cell.position!,zoom:focus?Math.max(current.zoom,12):Math.min(MAP_MAX_ZOOM,current.zoom+1)}));
    if (focus && !window.matchMedia("(max-width:850px)").matches) container.current?.scrollIntoView({behavior:"smooth",block:"center"});
  }
  function chooseTrade(trade: CouncilMapTrade) {
    setSelection({kind:"trade",id:trade.id});
    if(trade.position)changeView(current=>({...trade.position!,zoom:Math.max(current.zoom,11)}));
    if(window.matchMedia("(max-width:850px)").matches)requestAnimationFrame(()=>directoryPanel.current?.scrollIntoView({behavior:"smooth",block:"start"}));
  }
  function pan(event: PointerEvent<HTMLDivElement>) {
    clickOrigin.current = {x:event.clientX,y:event.clientY,moved:false};
    const target = event.target as HTMLElement;
    const marker = target.closest<HTMLButtonElement>("[data-map-marker]");
    if (!ready || !event.isPrimary || event.button !== 0 || (!marker && target.closest("button,a,input,select"))) return;
    // Google owns touch gestures on its basemap. Mouse/pen and label drags use
    // the same pixel pan, so the postcode overlays cannot trap the pointer.
    if (!demonstration && event.pointerType === "touch" && !marker) return;
    (marker ?? event.currentTarget).focus({preventScroll:true});
    event.preventDefault(); event.stopPropagation();
    drag.current = {pointer:event.pointerId,x:event.clientX,y:event.clientY,view:viewRef.current};
  }
  function panMove(event: PointerEvent<HTMLDivElement>) {
    const start = clickOrigin.current;
    if (start && Math.hypot(event.clientX-start.x,event.clientY-start.y)>5) start.moved=true;
    const active = drag.current;
    if (active?.pointer !== event.pointerId || !start?.moved) return;
    if (event.pointerType !== "touch" && !(event.buttons & 1)) { panEnd(event); return; }
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    changeView(moveCouncilMap(active.view,event.clientX-active.x,event.clientY-active.y));
  }
  function panEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function selectBoundary(event: MouseEvent<HTMLDivElement>) {
    if (clickOrigin.current?.moved && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); return; }
    if ((!showArea && !heat) || (event.target as HTMLElement).closest("button,a,input,select")) return;
    const rect=event.currentTarget.getBoundingClientRect(), current=viewRef.current, centre=mapWorldPoint(current,current.zoom);
    const position=mapWorldPosition({x:centre.x+event.clientX-rect.left-rect.width/2,y:centre.y+event.clientY-rect.top-rect.height/2},current.zoom);
    const boundary=boundaries.find(feature=>councilPostcodeBoundaryContains(feature,position));
    const cell=report.map.cells.find(row=>row.postcode===boundary?.properties.postcode);
    if(cell) { event.stopPropagation(); chooseArea(cell); }
  }
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
      <button type="button" aria-pressed={heat} onClick={()=>setHeat(!heat)}><span className={styles.heatDot} style={{background:COUNCIL_MAP_HEAT_GRADIENT}}/>{publicLayer ? "Public data heat" : "Activity heat"}</button>
      <button type="button" aria-pressed={showArea} onClick={()=>setShowArea(!showArea)}><span className={styles.areaDot}/>Reporting postcodes</button>
    </div><div className={styles.navigation}><button type="button" className={styles.fit} onClick={fitArea}><CouncilIcon name="map" size={16}/>Fit council area</button>{ready&&<div className={styles.zoom}><button type="button" aria-label="Zoom in" disabled={view.zoom>=MAP_MAX_ZOOM} onClick={()=>changeView(current=>({...current,zoom:Math.min(MAP_MAX_ZOOM,current.zoom+1)}))}>+</button><button type="button" aria-label="Zoom out" disabled={view.zoom<=MAP_MIN_ZOOM} onClick={()=>changeView(current=>({...current,zoom:Math.max(MAP_MIN_ZOOM,current.zoom-1)}))}>−</button></div>}</div></div>
    {ready&&<div className={styles.mapSummary}>
      {showArea&&<p className={styles.densityNotice}>{markers.labels.length} of {mapAreas.length} postcodes in view. {boundaries.length ? "Select a shaded area or postcode for its full breakdown." : `Each label shows its postcode and ${publicLayer?.unit ?? "TLink upgrades"}.`} Drag to move. Scroll or pinch over the map to zoom. {markers.crowded>0&&"Zoom in to separate nearby postcodes."}</p>}
      {heat&&heatScale.positiveCount>0&&<div className={styles.legend} aria-label={`Heat colour bands in ${publicLayer?.unit ?? "TLink upgrades"}, across all reporting postcodes`}><strong>{publicLayer?.unit ?? "TLink upgrades"} · lower to higher</strong><div className={styles.legendBands}>{heatScale.zeroCount>0&&<span><i style={{background:councilMapHeat(0,heatScale)?.color}}/>0</span>}{heatScale.bands.map(band=><span key={band.upper} title={`${band.count} reporting postcodes`}><i style={{background:band.color}}/>{publicNumber(band.minimum)}{band.minimum!==band.upper&&` to ${publicNumber(band.upper)}`}</span>)}{heatScale.unavailableCount>0&&<span><i style={{background:"#85909a"}}/>Not available</span>}</div><small>Colours compare postcodes within this dataset. Equal values share a colour.</small></div>}
    </div>}
    <div className={styles.layout}>
      <div ref={container} className={styles.map} tabIndex={0} role="region" aria-label="Interactive postcode map. Drag to move. Scroll or pinch to zoom. Use arrow keys to pan and plus or minus to zoom." onClickCapture={selectBoundary} onPointerDownCapture={pan} onPointerMoveCapture={panMove} onPointerUpCapture={panEnd} onPointerCancelCapture={panEnd} onLostPointerCapture={panEnd} onPointerLeave={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))panEnd(event);}} onKeyDown={event=>{
        if(event.target!==event.currentTarget)return;
        const movements:Record<string,[number,number]>={ArrowLeft:[80,0],ArrowRight:[-80,0],ArrowUp:[0,80],ArrowDown:[0,-80]};
        if(movements[event.key]){event.preventDefault();changeView(current=>moveCouncilMap(current,...movements[event.key]));}
        if(event.key==="+"||event.key==="="||event.key==="-"){event.preventDefault();changeView(current=>({...current,zoom:Math.max(MAP_MIN_ZOOM,Math.min(MAP_MAX_ZOOM,current.zoom+(event.key==="-"?-1:1)))}));}
      }}>
        <div ref={googleCanvas} className={styles.basemap}/>
        {demonstration&&<div className={styles.tiles} aria-hidden="true">{tiles.map(tile=><img key={tile.key} src={tile.url} alt="" width={256} height={256} draggable={false} referrerPolicy="strict-origin-when-cross-origin" style={{left:tile.x,top:tile.y}} onError={()=>setTileError(true)}/>)}</div>}
        {ready&&(heat||showArea)&&boundaries.length>0&&<svg className={styles.boundaries} width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
          {boundaryPaths.map(({postcode,path})=>{
            const cell=report.map.cells.find(row=>row.postcode===postcode);
            if(!cell)return null;
            const value=activityValue(cell),shade=councilMapHeat(value,heatScale);
            return <path key={postcode} data-postcode={postcode} d={path} fillRule="evenodd" fill={heat ? shade?.color??"#85909a" : "transparent"} fillOpacity={heat ? value===null ? .22 : .66 : 0} stroke={selectedPostcode===postcode?"#fff":"#233e4b"} strokeWidth={selectedPostcode===postcode?3:1.1} strokeDasharray={value===null?"4 3":undefined} vectorEffect="non-scaling-stroke"/>;
          })}
          {selectedPostcode&&boundaryPaths.filter(row=>row.postcode===selectedPostcode).map(row=><path key={`selected-${row.postcode}`} d={row.path} fill="none" fillRule="evenodd" stroke="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke"/>)}
        </svg>}
        {ready&&<div className={styles.overlays}>
          {report.map.cells.map(cell=>{
            const point=anchors.get(cell.postcode);
            if(!point)return null;
            const value=activityValue(cell);
            const shade=councilMapHeat(value,heatScale);
            const intensity=shade?.ratio??0;
            const label=markerLabels.get(cell.postcode);
            const group=showTrades ? tradeGroups.get(cell.postcode) : undefined;
            const selected=selectedPostcode===cell.postcode;
            const bounded=boundaryByPostcode.has(cell.postcode);
            const description=`${cell.postcode}: ${publicLayer ? `${publicNumber(value)} ${publicLayer.unit}` : `${number(cell.completedJobs)} TLink upgrades`}${group ? `. ${group.length} local trades` : ""}. Select to explore this postcode.`;
            const markerStyle: CSSProperties & {"--heat-colour":string} = {left:point.x,top:point.y,"--heat-colour":shade?.color??"#788894"};
            return <div className={`${styles.areaAnchor} ${selected ? styles.selectedAnchor : ""}`} key={cell.postcode} style={markerStyle}>
              {heat&&!bounded&&value!==null&&value>0&&<span className={styles.heat} style={{width:64+intensity*56,height:64+intensity*56}}/>}
              {(showArea||group)&&<button type="button" data-map-marker="true" className={`${styles.anchorButton} ${bounded&&showArea ? styles.boundaryAnchor : ""} ${group ? styles.tradeAnchor : ""} ${value===null ? styles.unknownAnchor : ""}`} style={bounded&&showArea&&label ? {left:label.x-point.x,top:label.y-point.y,transform:"none",width:42,height:20} : undefined} aria-pressed={selected} aria-label={description} title={description} onClick={()=>group?.length===1&&!showArea?chooseTrade(group[0]):chooseArea(cell)}>{group&&(!bounded||!showArea)&&<CouncilIcon name="business" size={13}/>}{showArea&&label&&<span className={`${styles.postcode} ${bounded ? styles.boundaryLabel : ""}`} style={bounded ? {left:0,top:0} : {left:label.x-point.x+14,top:label.y-point.y+14}} aria-hidden="true">{cell.postcode}<span>{publicLayer ? publicNumber(value) : number(cell.completedJobs)}</span></span>}</button>}
            </div>;
          })}
        </div>}
        {!ready&&<div className={styles.unavailable} role="status"><CouncilIcon name="map" size={30}/><strong>{state==="loading"?"Loading your community…":state==="unconfigured"?"Map connection is not configured":state==="auth"?"Map connection needs attention":"Map temporarily unavailable"}</strong><p>{state==="loading"?"Preparing postcode overlays and local trade pins.":"Your postcode results and business directory remain available below. TLink support can check the map connection."}</p>{state!=="loading"&&<button type="button" onClick={()=>{setState("loading");setAttempt(current=>current+1);}}>Retry map</button>}</div>}
        {tileError&&<div className={styles.tileNotice} role="status">Some basemap tiles are unavailable. Postcode positions remain approximate.</div>}
        {demonstration&&<div className={styles.attribution}>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Map issue</a></div>}
      </div>
      <aside ref={directoryPanel} className={`${styles.directory} ${selectedTrade?styles.profileDirectory:""} ${selectedCell&&!selectedTrade?styles.postcodeDirectory:""}`} aria-label={selectedCell ? `Postcode ${selectedCell.postcode} breakdown` : "Local trade directory"}>
        <div className={styles.directoryHeader}><span className={styles.eyebrow}>{selectedCell&&!selectedTrade?"POSTCODE BREAKDOWN":"LOCAL DELIVERY NETWORK"}</span><h2>{selectedTrade?"Business profile":selectedCell?selectedCell.label:"Explore a postcode"}</h2><p>{selectedCell?`Postcode ${selectedCell.postcode}`:"Select any shaded area or postcode label to see its upgrades, installations and local trades."}</p></div>
        {selectedCell&&!selectedTrade&&<div className={styles.postcodeData}><CouncilPostcodeDetails postcode={selectedCell.postcode} report={report} sources={postcodeDetails}/></div>}
        <label className={styles.search}>Find a trade or postcode<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setSelection(null);}} placeholder="Business, service or postcode"/></label>
        {selection&&<button type="button" className={styles.back} onClick={()=>setSelection(null)}>← All postcodes and trades</button>}
        {selectedTrade?<div className={styles.profile}><span className={styles.businessAvatar}><CouncilIcon name="business" size={25}/></span><h3>{selectedTrade.name}</h3><p>{selectedTrade.suburb} {selectedTrade.state} {selectedTrade.postcode}</p><span className={styles.businessStatus}>{demonstration?"Fictional demonstration business":"Onboarded with TLink"}</span><h4>Services</h4><div className={styles.tags}>{selectedTrade.capabilities.map(capability=><span key={capability}>{capability}</span>)}</div>{selectedTrade.website&&<a href={selectedTrade.website} target="_blank" rel="noopener noreferrer">Visit business website ↗</a>}<p className={styles.small}>Pin shows the business postcode area, not its street address. Business location does not establish where every worker is based.</p></div>:<div className={styles.tradeList}>
          {listedTrades.map(trade=><button type="button" key={trade.id} onClick={()=>chooseTrade(trade)}><span className={styles.listAvatar}><CouncilIcon name="business" size={19}/></span><span><strong>{trade.name}</strong><small>{trade.suburb} · {trade.postcode}</small><em>{trade.capabilities.slice(0,2).join(" · ")||"Services not recorded"}</em></span><span aria-hidden="true">›</span></button>)}
          {!listedTrades.length&&<p className={styles.empty}>{directoryError|| (query?"No businesses match that search.":"No onboarded local trades to show in this area yet.")}</p>}
        </div>}
        {truncated&&<p className={styles.small}>Showing the first 500 business profiles. The registered business total includes the full approved area.</p>}
        <p className={styles.directoryFoot}>Business pins appear automatically for onboarded local trades. Private customer and job locations are never shown.</p>
      </aside>
    </div>
    <p className={styles.layerNote}>{boundaryState==="loading"?"Loading postcode boundaries…":boundaryState==="unavailable"?"Postcode boundaries are temporarily unavailable. Approximate centre markers are shown.":`${boundaries.length} of ${report.map.cells.length} postcode boundaries available. Areas without a published boundary use a centre marker.`} {publicLayer&&`Heat groups similar ${publicLayer.unit} totals across all reporting postcodes, so a few large totals do not hide smaller differences. Zero uses the cool end of the scale; grey dashed areas have no usable value. Public values are not attributed to council or TLink campaigns.`}</p>
    <section className={styles.dataTable} aria-label="Explore reporting postcodes">
      <div className={styles.tableToolbar}><div><h3>Explore reporting postcodes</h3><p>{report.map.cells.length} areas · select a postcode to focus the map</p></div><label>Find a postcode<input type="search" value={postcodeQuery} onChange={event=>{setPostcodeQuery(event.target.value);setPostcodePage(0);}} placeholder="Postcode or area"/></label></div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Postcode map data table"><table><caption>{publicLayer ? `${publicLayer.label} (${publicLayer.unit}). Source: ${publicLayer.sourceLabel}.` : `Completed upgrades recorded in TLink · ${report.period.label}.`}{demonstration ? " TLink activity and businesses are illustrative." : ""}</caption><thead><tr><th scope="col">Postcode</th>{publicLayer&&<th scope="col">{publicLayer.label}<span> {publicLayer.unit}</span></th>}<th scope="col">TLink upgrades</th><th scope="col">Local businesses</th></tr></thead><tbody>{displayedPostcodes.map(cell=><tr key={cell.postcode} data-selected={selectedPostcode===cell.postcode||undefined}><th scope="row"><button type="button" aria-pressed={selectedPostcode===cell.postcode} onClick={()=>chooseArea(cell,true)}>{cell.postcode}<span>{areaName(cell.label,cell.postcode)}</span>{!cell.position&&<small>Map location unavailable</small>}</button></th>{publicLayer&&<td>{publicNumber(activityValue(cell))}</td>}<td>{number(cell.completedJobs)}</td><td>{number(cell.registeredLocalBusinesses)}</td></tr>)}</tbody></table>{!postcodeRows.length&&<p className={styles.empty}>No reporting postcodes match your search.</p>}</div>
      <div className={styles.pagination}><span role="status">{postcodeRows.length ? `${activePage*pageSize+1} to ${Math.min((activePage+1)*pageSize,postcodeRows.length)} of ${postcodeRows.length} postcodes` : "0 matching postcodes"}</span><div><button type="button" disabled={activePage===0} onClick={()=>setPostcodePage(activePage-1)}>Previous</button><button type="button" disabled={activePage>=pageCount-1} onClick={()=>setPostcodePage(activePage+1)}>Next</button></div></div>
    </section>
    <p className={styles.method}>Boundaries: <a href={COUNCIL_POSTCODE_BOUNDARY_SOURCE.url} target="_blank" rel="noreferrer">ABS Postal Areas 2021</a>, <a href={COUNCIL_POSTCODE_BOUNDARY_SOURCE.licence} target="_blank" rel="noreferrer">CC BY 4.0</a>, simplified for display. Postal Areas approximate postcodes; they are not council boundaries or exact Australia Post delivery areas. Heat shows relative {publicLayer ? "public data values" : "completed-upgrade totals"} across whole postcode areas, not customer locations or precise hotspots. {demonstration&&"TLink business profiles and outcomes in this demonstration are fictional. Public datasets, where selected, retain the stated source."}</p>
  </section>;
}
