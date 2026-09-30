"use client";

import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
/// <reference types="google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { geocodeTradeMapAddress, GoogleMapsClientError, loadGoogleMaps, onGoogleMapsAuthFailure } from "@/lib/google-maps-client";
import { tradeMapDirectionsUrl, tradeMapRecordCategory, TRADE_MAP_PIN_CATEGORY_ORDER, TRADE_MAP_PIN_LABELS, type TradeMapRecord } from "@/lib/trade-record-map";
import type { TradeMapBounds, TradeMapDatasetItem, TradeMapDatasetResponse, TradeMapQuery } from "@/lib/trade-map-contract";
import { isTradeMapClaimsResponse, isTradeMapDatasetResponse, resolveTradeMapClaims, tradeMapQueryUrl, tradeMapViewportUrl, waitForTradeMapRetry, type TradeMapLocationStatus } from "@/lib/trade-map-client";
import styles from "./TradeRecordMap.module.css";
import { TradeMapTools } from "./TradeMapTools";
import dynamic from "next/dynamic";
import type { MapQuoteMeasurement } from "@/lib/trade-map-quote";
import type { MapQuoteAccess } from "./TradeMapQuoteDialog";
import type { SolarDesign } from "@/lib/trade-solar-design";
const TradeMapQuoteDialog = dynamic(() => import("./TradeMapQuoteDialog").then(module => module.TradeMapQuoteDialog));

type Props = { user: User; query: TradeMapQuery; onOpenRecord: (record: TradeMapRecord) => void; quoteAccess?: MapQuoteAccess; onRegisterMapSave?: (save: (() => Promise<unknown>) | null) => void };
type Runtime = { ownerUid: string; api: typeof google.maps; map: google.maps.Map; geocoder: google.maps.Geocoder };
type MapState = "loading" | "ready" | "unconfigured" | "access" | "auth" | "unavailable";
type MarkerEntry = { marker: google.maps.marker.AdvancedMarkerElement; badge: HTMLDivElement; click: () => void };
type View = { scope: string; bounds: TradeMapBounds | null; page: number; addressKey: string; locationStatus: TradeMapLocationStatus };
type Progress = { scope: string; running: boolean; waiting: boolean; completed: number; error: string };

function recordKey(record: TradeMapRecord) { return `${record.kind}:${record.id}`; }
function initialView(scope: string): View { return { scope, bounds: null, page: 1, addressKey: "", locationStatus: "all" }; }
function number(value: number) { return value.toLocaleString("en-AU"); }
function removeMarker(entry: MarkerEntry) { entry.marker.removeEventListener("gmp-click", entry.click); entry.marker.map = null; }
function fitBounds(runtime: Runtime, bounds: TradeMapBounds) {
  if (bounds.north - bounds.south < 0.00001 && bounds.east - bounds.west < 0.00001) {
    runtime.map.setCenter({ lat: bounds.north, lng: bounds.east }); runtime.map.setZoom(17); return;
  }
  runtime.map.fitBounds(bounds, 55);
  runtime.api.event.addListenerOnce(runtime.map, "idle", () => { if ((runtime.map.getZoom() ?? 0) > 18) runtime.map.setZoom(18); });
}
function isConfiguredMap(value: unknown): value is { ok: true; configured: boolean; apiKey?: string; mapId?: string } {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true && "configured" in value && typeof value.configured === "boolean";
}
const mapMessages: Record<Exclude<MapState, "ready">, { title: string; detail: string }> = {
  loading: { title: "Loading map", detail: "Your saved locations will appear when the map is ready." },
  unconfigured: { title: "Google Maps is not connected yet", detail: "An administrator needs to finish Google Maps setup. You can still open your records below." },
  access: { title: "Map access is unavailable", detail: "Refresh your session and try again. Your workspace access may need to be reviewed." },
  auth: { title: "Google Maps could not authorise this site", detail: "An administrator needs to check the Google Maps connection. Refresh this page after it is corrected." },
  unavailable: { title: "Google Maps is unavailable", detail: "Check your connection and try again. Your customer and job records are still available." },
};
const geocodeMessages = {
  denied: "Google could not authorise address lookup. An administrator needs to check the Maps connection.",
  quota: "Google's address lookup limit has been reached. Your saved locations are available. Remaining addresses will resume later.",
  unavailable: "Address lookup is temporarily unavailable. Your saved locations are available. Retry to continue.",
};
const locationLabels: Record<TradeMapLocationStatus, string> = {
  all: "In this area + without a pin", located: "On map in this area", pending: "Waiting for a location", unlocated: "Address needs attention", approximate: "Approximate pins in this area",
};
function locationLabel(record: TradeMapDatasetItem) {
  if (!record.address.trim()) return "Street address needed";
  if (record.locationStatus === "located") return record.approximate ? "Approximate pin" : "On map";
  return record.locationStatus === "unlocated" ? "Address needs attention" : "Waiting for location";
}

export function TradeRecordMap({ user, query, onOpenRecord, quoteAccess, onRegisterMapSave }: Props) {
  const fetch = useTradeBusinessFetch();
  const businessOwnerUid = useTradeBusiness()?.ownerUid || user.uid;
  const baseUrl = tradeMapQueryUrl(query);
  const scope = `${user.uid}:${businessOwnerUid}:${baseUrl}`;
  const [viewState, setViewState] = useState<View>(() => initialView(scope));
  const view = viewState.scope === scope ? viewState : initialView(scope);
  const [dataset, setDataset] = useState<{ scope: string; url: string; value: TradeMapDatasetResponse } | null>(null);
  const data = dataset?.scope === scope ? dataset.value : null;
  const [dataError, setDataError] = useState<{ request: string; message: string } | null>(null);
  const [completedRequest, setCompletedRequest] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<{ scope: string; record: TradeMapDatasetItem } | null>(null);
  const selected = selection?.scope === scope ? selection.record : null;
  const [clusterNotice, setClusterNotice] = useState<{ scope: string; message: string } | null>(null);
  const [quoteMeasurement, setQuoteMeasurement] = useState<MapQuoteMeasurement | null>(null);
  const [linkedDesign, setLinkedDesign] = useState<SolarDesign | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const activeScopeRef = useRef<string | null>(scope);
  const interactedRef = useRef(false);
  const firstFitRef = useRef({ scope: "", final: false });
  const [measuring, setMeasuring] = useState(false);
  const exploreMap = useCallback(() => { interactedRef.current = true; }, []);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [progress, setProgress] = useState<Progress>({ scope, running: false, waiting: false, completed: 0, error: "" });
  const currentProgress = progress.scope === scope ? progress : null;
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [locateAttempt, setLocateAttempt] = useState(0);
  const [lookupState, setLookupState] = useState({ scope, enabled: false });
  const lookupEnabled = lookupState.scope === scope && lookupState.enabled;
  // An explicit start applies only to this set of filters and this business.
  if (lookupState.scope !== scope) setLookupState({ scope, enabled: false });
  const requestUrl = tradeMapViewportUrl(baseUrl, view);
  const requestKey = `${scope}:${requestUrl}:${query.revision ?? 0}:${refresh}`;
  const loading = completedRequest !== requestKey;

  useEffect(() => { interactedRef.current = false; activeScopeRef.current = scope; return () => { activeScopeRef.current = null; }; }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(requestUrl, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: controller.signal });
      if ((response.status === 401 || response.status === 403) && !controller.signal.aborted) { setDataset(null); setSelection(null); setLookupState({ scope, enabled: false }); }
      if (!response.ok) throw new Error(response.status === 403 ? "You do not have access to these map records." : "Map records could not be loaded. Try again.");
      const result: unknown = await response.json();
      if (!isTradeMapDatasetResponse(result) || result.resource !== query.resource) throw new Error("Map records could not be read. Try again.");
      if (!controller.signal.aborted) { setDataset({ scope, url: requestUrl, value: result }); setDataError(null); }
    })().catch(error => { if (!controller.signal.aborted) setDataError({ request: requestKey, message: error instanceof Error ? error.message : "Map records could not be loaded." }); })
      .finally(() => { if (!controller.signal.aborted) setCompletedRequest(requestKey); });
    return () => controller.abort();
  }, [fetch, user, requestUrl, scope, query.resource, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    const canvas = canvasRef.current;
    const markers = markersRef.current;
    const interact = () => { interactedRef.current = true; };
    canvas?.addEventListener("pointerdown", interact);
    canvas?.addEventListener("wheel", interact, { passive: true });
    canvas?.addEventListener("keydown", interact);
    let createdMap: google.maps.Map | null = null;
    let api: typeof google.maps | null = null;
    const unsubscribeAuth = onGoogleMapsAuthFailure(() => {
      if (controller.signal.aborted) return;
      controller.abort(); setMapState("auth"); setRuntime(null);
    });
    void (async () => {
      setMapState("loading"); setRuntime(null);
      firstFitRef.current = { scope: "", final: false };
      const response = await fetch("/api/trade-map/config", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) { if (!controller.signal.aborted) setMapState("access"); return; }
      if (!response.ok) throw new Error("Map configuration unavailable");
      const config: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!isConfiguredMap(config)) throw new Error("Invalid map configuration");
      if (!config.configured) { setMapState("unconfigured"); return; }
      if (!config.apiKey?.trim() || !config.mapId?.trim() || config.mapId === "DEMO_MAP_ID") throw new Error("Incomplete map configuration");
      api = await loadGoogleMaps(config.apiKey);
      if (controller.signal.aborted || !canvas) return;
      createdMap = new api.Map(canvas, {
        mapId: config.mapId, center: { lat: -25.5, lng: 134 }, zoom: 4, mapTypeControl: false,
        scaleControl: true, zoomControl: true, cameraControl: false, tilt: 0, heading: 0,
        tiltInteractionEnabled: false, headingInteractionEnabled: false, rotateControl: false,
        streetViewControl: false, clickableIcons: false, fullscreenControl: true,
        gestureHandling: window.matchMedia("(pointer: fine)").matches ? "greedy" : "cooperative",
        colorScheme: document.documentElement.dataset.tlinkColourMode === "night" ? "DARK" : "LIGHT",
      });
      createdMap.addListener("dragstart", () => { interactedRef.current = true; });
      setRuntime({ ownerUid: businessOwnerUid, api, map: createdMap, geocoder: new api.Geocoder() });
      setMapState("ready");
    })().catch(error => { if (!controller.signal.aborted) setMapState(error instanceof GoogleMapsClientError && error.reason === "auth" ? "auth" : "unavailable"); });
    return () => {
      controller.abort(); unsubscribeAuth();
      canvas?.removeEventListener("pointerdown", interact);
      canvas?.removeEventListener("wheel", interact);
      canvas?.removeEventListener("keydown", interact);
      for (const entry of markers.values()) removeMarker(entry);
      markers.clear();
      if (createdMap && api) api.event.clearInstanceListeners(createdMap);
      canvas?.replaceChildren();
    };
  }, [businessOwnerUid, fetch, user, setupAttempt]);

  useEffect(() => {
    if (!runtime || runtime.ownerUid !== businessOwnerUid) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const bounds = runtime.map.getBounds()?.toJSON();
        if (!bounds) return;
        setViewState(previous => {
          const current = previous.scope === scope ? previous : initialView(scope);
          const next = { ...current, bounds };
          if (tradeMapViewportUrl(baseUrl, next) === tradeMapViewportUrl(baseUrl, current)) return previous;
          return { ...next, page: 1 };
        });
      }, 250);
    };
    const listener = runtime.map.addListener("idle", update);
    update();
    return () => { clearTimeout(timer); listener.remove(); };
  }, [runtime, businessOwnerUid, scope, baseUrl]);

  useEffect(() => {
    if (!runtime || runtime.ownerUid !== businessOwnerUid || !data?.bounds || interactedRef.current) return;
    if (firstFitRef.current.scope !== scope || (!firstFitRef.current.final && data.pending === 0)) {
      fitBounds(runtime, data.bounds);
      firstFitRef.current = { scope, final: data.pending === 0 };
    }
  }, [runtime, businessOwnerUid, data, scope]);

  useEffect(() => {
    if (!runtime || runtime.ownerUid !== businessOwnerUid || !lookupEnabled) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let completed = 0;
    let lastRefresh = 0;
    async function post(body: unknown, saveCompleted = false) {
      const response = await fetch(baseUrl, { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: saveCompleted ? undefined : signal });
      if (!response.ok) throw new Error("Location progress could not be saved. Retry to continue from your saved locations.");
      const result: unknown = await response.json();
      return result;
    }
    function reload(force = false) {
      if (!signal.aborted && (force || Date.now() - lastRefresh >= 3_000)) { lastRefresh = Date.now(); setRefresh(value => value + 1); }
    }
    void (async () => {
      setProgress({ scope, running: true, waiting: false, completed, error: "" });
      while (!signal.aborted) {
        const claims = await post({ action: "claim_map_locations", limit: 10 });
        if (signal.aborted) return;
        if (!isTradeMapClaimsResponse(claims)) throw new Error("Address processing could not be started. Retry to continue.");
        if (!claims.claims.length) {
          reload(true);
          if (!claims.retryAfterMs) { setProgress({ scope, running: false, waiting: false, completed, error: "" }); setLookupState({ scope, enabled: false }); return; }
          setProgress({ scope, running: false, waiting: true, completed, error: "" });
          await waitForTradeMapRetry(Math.min(Math.max(claims.retryAfterMs, 3_000), 60_000), signal);
          continue;
        }
        setProgress({ scope, running: true, waiting: false, completed, error: "" });
        const batch = await resolveTradeMapClaims(claims.claims, address => geocodeTradeMapAddress(runtime.geocoder, address), signal);
        if (batch.results.length) {
          // Save completed work even if the user paused or navigated away during
          // this batch. Cancellation prevents any new Google lookups.
          const saved = await post({ action: "save_map_locations", results: batch.results }, true);
          if (typeof saved !== "object" || saved === null || !("saved" in saved) || typeof saved.saved !== "number") throw new Error("Location progress could not be confirmed. Retry to continue.");
          if (signal.aborted) { if (activeScopeRef.current === scope) setRefresh(value => value + 1); return; }
          completed += saved.saved;
          reload(Boolean(batch.error));
        }
        if (signal.aborted) return;
        if (batch.error) { setProgress({ scope, running: false, waiting: false, completed, error: geocodeMessages[batch.error] }); setLookupState({ scope, enabled: false }); return; }
        setProgress({ scope, running: true, waiting: false, completed, error: "" });
      }
    })().catch(error => {
      if (!signal.aborted) { reload(true); setProgress({ scope, running: false, waiting: false, completed, error: error instanceof Error ? error.message : "Address processing paused. Retry to continue." }); setLookupState({ scope, enabled: false }); }
    });
    return () => controller.abort();
  }, [runtime, businessOwnerUid, baseUrl, scope, fetch, user, locateAttempt, query.revision, lookupEnabled]);

  const pins = useMemo(() => data?.markers ?? [], [data]);
  const legendCategories = useMemo(() => {
    const categories = new Set(pins.map(pin => pin.category));
    return TRADE_MAP_PIN_CATEGORY_ORDER.filter(category => categories.has(category));
  }, [pins]);
  useEffect(() => {
    if (!runtime || runtime.ownerUid !== businessOwnerUid) return;
    const markers = markersRef.current;
    const active = new Set(pins.map(pin => pin.id));
    for (const [key, entry] of markers) if (!active.has(key)) { removeMarker(entry); markers.delete(key); }
    for (const pin of pins) {
      let entry = markers.get(pin.id);
      const click = () => {
        interactedRef.current = true;
        setClusterNotice(null);
        if (pin.record && pin.count === 1) {
          setSelection({ scope, record: { ...pin.record, addressKey: pin.addressKey || "", position: pin.position, approximate: pin.approximate, locationStatus: "located" } });
        } else if (pin.addressKey) {
          setSelection(null);
          setViewState(previous => ({ ...(previous.scope === scope ? previous : initialView(scope)), page: 1, addressKey: pin.addressKey || "", locationStatus: "all" }));
        } else {
          setSelection(null);
          setViewState(previous => ({ ...(previous.scope === scope ? previous : initialView(scope)), page: 1, addressKey: "", locationStatus: "located" }));
          fitBounds(runtime, pin.bounds);
          if (pin.bounds.north - pin.bounds.south < 0.00001 && pin.bounds.east - pin.bounds.west < 0.00001) setClusterNotice({ scope, message: "Several addresses share this map position. Browse the records below and confirm approximate addresses before travelling." });
        }
        selectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
      if (!entry) {
        const badge = document.createElement("div"); badge.className = styles.pin;
        const marker = new runtime.api.marker.AdvancedMarkerElement({ map: runtime.map, position: pin.position, gmpClickable: true });
        marker.append(badge); entry = { marker, badge, click }; markers.set(pin.id, entry);
      } else { entry.marker.removeEventListener("gmp-click", entry.click); entry.click = click; }
      entry.marker.addEventListener("gmp-click", click);
      entry.marker.map = measuring ? null : runtime.map;
      entry.marker.position = pin.position;
      entry.marker.title = `${number(pin.count)} ${pin.count === 1 ? "record" : "records"}. ${TRADE_MAP_PIN_LABELS[pin.category]}. ${pin.count === 1 ? "Select to view details." : pin.addressKey ? "Select to browse this address." : "Select to zoom in."}`;
      entry.badge.textContent = pin.count > 1 ? number(pin.count) : query.resource === "jobs" ? "J" : "C";
      entry.badge.dataset.category = pin.category;
      entry.badge.dataset.cluster = String(pin.count > 1);
      const isSelected = Boolean((selected && pin.record && recordKey(selected) === recordKey(pin.record)) || (view.addressKey && view.addressKey === pin.addressKey));
      entry.badge.dataset.selected = String(isSelected);
      entry.marker.zIndex = isSelected ? 1000 : undefined;
    }
  }, [businessOwnerUid, runtime, pins, selected, view.addressKey, scope, query.resource, measuring]);

  function selectRecord(record: TradeMapDatasetItem) {
    interactedRef.current = true; setSelection({ scope, record }); setClusterNotice(null);
    if (runtime && record.position) { runtime.map.panTo(record.position); if ((runtime.map.getZoom() ?? 0) < 15) runtime.map.setZoom(15); }
    selectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function setLocationStatus(status: TradeMapLocationStatus) { setSelection(null); setClusterNotice(null); setViewState({ ...view, page: 1, addressKey: "", locationStatus: status }); }
  const overlay = mapState !== "ready" ? mapMessages[mapState] : null;
  const records = data?.items ?? [];
  const listCurrent = dataset?.scope === scope && dataset.url === requestUrl;
  const listTitle = view.addressKey ? "At this address" : locationLabels[view.locationStatus];
  const directions = selected ? tradeMapDirectionsUrl(selected.address) : null;

  return <section className={styles.root} aria-label={query.resource === "jobs" ? "Job map" : "Customer map"}>
    <header className={styles.header}>
      <div><h3>{query.resource === "jobs" ? "Job locations" : "Customer locations"}</h3><p>{data ? `${number(data.total)} matching ${query.resource}. All saved locations are included. Zoom in to expand numbered groups.` : `Loading matching ${query.resource}...`}</p></div>
      <button type="button" className={styles.button} disabled={!runtime || !data?.bounds || measuring || mapState !== "ready"} onClick={() => { if (runtime && data?.bounds) { interactedRef.current = true; fitBounds(runtime, data.bounds); setViewState({ ...view, addressKey: "", page: 1 }); } }}>Fit all pins</button>
    </header>
    {runtime && runtime.ownerUid === businessOwnerUid && mapState === "ready" && <TradeMapTools key={businessOwnerUid} user={user} onRegisterMapSave={onRegisterMapSave} linkedDesign={linkedDesign}
      context={selected ? { title: selected.address || selected.title, customerId: selected.kind === "customer" ? selected.id : "", workOrderId: selected.kind === "job" ? selected.id : "" } : undefined}
      api={runtime.api} map={runtime.map} onExplore={exploreMap} onMeasuring={setMeasuring} onQuote={quoteAccess ? setQuoteMeasurement : undefined} />}
    {quoteAccess && quoteMeasurement && <TradeMapQuoteDialog key={businessOwnerUid} user={user} measurement={quoteMeasurement} access={quoteAccess} onDesignLinked={setLinkedDesign} onClose={() => setQuoteMeasurement(null)} />}
    <div className={styles.status} role="status" aria-live="polite"><span><i className={styles.dot} aria-hidden="true" />{number(data?.mapped ?? 0)} mapped</span><span>{number(data?.approximate ?? 0)} approximate</span><span>{number(data?.pending ?? 0)} waiting</span><span>{number(data?.unmapped ?? 0)} need an address check</span>{loading && <span>Updating view...</span>}</div>
    {data && data.pending > 0 && mapState === "ready" && <div className={styles.processing}>
      <div><strong>{lookupEnabled ? currentProgress?.waiting ? "Waiting for the next available lookup" : "Saving address locations" : "Locations ready to prepare"}</strong>
        <p>{lookupEnabled ? `${number(currentProgress?.completed ?? 0)} addresses checked this visit. Keep this map open to continue.` : `${number(data.pending)} ${query.resource} are waiting for a location. Start or resume when you are ready.`} Google Maps lookup charges may apply. Saved progress is shared with your team.</p></div>
      <button type="button" className={styles.button} onClick={() => { if (lookupEnabled) { setLookupState({ scope, enabled: false }); setRefresh(value => value + 1); } else { setLocateAttempt(value => value + 1); setLookupState({ scope, enabled: true }); } }}>{lookupEnabled ? "Pause lookups" : "Start locating addresses"}</button>
    </div>}
    {legendCategories.length > 0 && <ul className={styles.legend} aria-label="Map pin colours">{legendCategories.map(category => <li key={category}><i className={styles.swatch} data-category={category} aria-hidden="true" /><span>{TRADE_MAP_PIN_LABELS[category]}</span></li>)}</ul>}
    {dataError?.request === requestKey && <div className={styles.notice} role="alert"><p>{dataError.message}</p><button type="button" className={styles.button} onClick={() => setRefresh(value => value + 1)}>Reload map records</button></div>}
    {currentProgress?.error && mapState === "ready" && <div className={styles.notice} role="alert"><p>{currentProgress.error}</p><button type="button" className={styles.button} onClick={() => { setLocateAttempt(value => value + 1); setLookupState({ scope, enabled: true }); }}>Retry address lookup</button></div>}
    <div className={styles.layout}><div className={styles.mapArea}><div ref={canvasRef} className={styles.canvas} aria-label={`Google map of all matching ${query.resource}`} />
      {overlay && <div className={styles.overlay} role="status"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 43S9 29 9 18a15 15 0 0 1 30 0c0 11-15 25-15 25Z" /><circle cx="24" cy="18" r="5" /></svg><strong>{overlay.title}</strong><p>{overlay.detail}</p>{["unavailable", "access", "unconfigured"].includes(mapState) && <button type="button" className={styles.button} onClick={() => setSetupAttempt(value => value + 1)}>Try again</button>}</div>}
    </div><aside className={styles.sidebar} aria-label="Map records" aria-busy={loading}>
      <div ref={selectionRef} className={styles.selection} aria-live="polite">{selected ? <><div className={styles.selectionHeading}><strong>Selected record</strong><button type="button" className={styles.clearButton} onClick={() => setSelection(null)} aria-label="Clear map selection">×</button></div><article className={styles.selectedRecord}><span className={styles.reference}>{selected.reference || selected.kind}</span><h4>{selected.title}</h4>{selected.detail && <p>{selected.detail}</p>}<p>{selected.address || "Address unavailable"}</p>{selected.approximate && <p className={styles.approximate}>Approximate location. Confirm the address before travelling.</p>}<div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={() => onOpenRecord(selected)}>Open {selected.kind}</button>{directions && <a href={directions} target="_blank" rel="noopener noreferrer">Directions ↗</a>}</div></article></> : <p className={styles.hint}>{clusterNotice?.scope === scope ? clusterNotice.message : "Select a numbered group to zoom in. Select an individual pin or a record for details and directions."}</p>}</div>
      <div className={styles.listControls}><label htmlFor={`map-record-view-${query.resource}`}>Show</label><select id={`map-record-view-${query.resource}`} value={view.locationStatus} onChange={event => { const value = event.target.value; if (value === "all" || value === "located" || value === "pending" || value === "unlocated" || value === "approximate") setLocationStatus(value); }}>{Object.entries(locationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div className={styles.listHeading}><strong>{listTitle}</strong><span>{listCurrent ? number(data?.listTotal ?? 0) : "..."}</span></div>
      {view.addressKey && <button type="button" className={styles.addressReset} onClick={() => { setSelection(null); setViewState({ ...view, addressKey: "", page: 1 }); }}>Show all addresses in this area</button>}
      <ul className={styles.records}>{listCurrent && records.map(record => <li key={recordKey(record)}><button type="button" className={styles.record} aria-pressed={selected !== null && recordKey(selected) === recordKey(record)} onClick={() => selectRecord(record)}><span className={styles.reference}>{record.reference || record.kind}</span><strong>{record.title}</strong><span className={styles.address}>{record.address || "Address unavailable"}</span>{record.kind === "job" && <span className={styles.recordStatus}><i className={styles.swatch} data-category={tradeMapRecordCategory(record)} aria-hidden="true" />{TRADE_MAP_PIN_LABELS[tradeMapRecordCategory(record)]}</span>}<span className={styles.locationState} data-located={record.locationStatus === "located"}>{locationLabel(record)}</span></button></li>)}</ul>
      {!loading && listCurrent && !records.length && <p className={styles.emptyList}>{data?.total ? "No records in this view. Change the view or zoom out." : "No records match these filters."}</p>}
      {data && <div className={styles.pagination}><button type="button" className={styles.button} disabled={loading || !listCurrent || view.page <= 1} onClick={() => setViewState({ ...view, page: view.page - 1 })}>Previous</button><span>Page {number(view.page)}</span><button type="button" className={styles.button} disabled={loading || !listCurrent || !data.hasMore} onClick={() => setViewState({ ...view, page: view.page + 1 })}>Next</button></div>}
    </aside></div>
    <p className={styles.footer}>Saved locations are reused across your business. Changed addresses and expired Google locations wait for the next lookup you start. Only street addresses are sent to Google. Customer names, contacts and job details stay in TLink.</p>
  </section>;
}
