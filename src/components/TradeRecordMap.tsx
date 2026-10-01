"use client";

import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import type { Map as TLinkMap, Marker } from "@maptiler/sdk";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { tradeMapDirectionsUrl, tradeMapRecordCategory, TRADE_MAP_PIN_CATEGORY_ORDER, TRADE_MAP_PIN_LABELS, type TradeMapRecord } from "@/lib/trade-record-map";
import type { TradeMapBounds, TradeMapDatasetItem, TradeMapDatasetResponse, TradeMapQuery } from "@/lib/trade-map-contract";
import { isTradeMapDatasetResponse, tradeMapQueryUrl, tradeMapViewportUrl, waitForTradeMapRetry, type TradeMapLocationStatus } from "@/lib/trade-map-client";
import { createTLinkMapAttribution, isTLinkAddressResult, isTLinkMapConfiguration, isTLinkMapLocationProgress, tlinkMapBounds, tlinkMapFailure, type TLinkMapConfiguration } from "@/lib/tlink-map-client";
import { GNAF_LICENCE_URL } from "@/lib/gnaf-address";
import styles from "./TradeRecordMap.module.css";
import dynamic from "next/dynamic";
import type { MapQuoteMeasurement } from "@/lib/trade-map-quote";
import type { MapQuoteAccess } from "./TradeMapQuoteDialog";
import type { SolarDesign } from "@/lib/trade-solar-design";
const TradeMapQuoteDialog = dynamic(() => import("./TradeMapQuoteDialog").then(module => module.TradeMapQuoteDialog));
const TradeRoofDesignMap = dynamic(() => import("./TradeRoofDesignMap").then(module => module.TradeRoofDesignMap), { ssr: false });

type Props = { user: User; query: TradeMapQuery; onOpenRecord: (record: TradeMapRecord) => void; quoteAccess?: MapQuoteAccess; onRegisterMapSave?: (save: (() => Promise<unknown>) | null) => void };
type Runtime = { ownerUid: string; api: typeof import("@maptiler/sdk"); map: TLinkMap };
type MapState = "loading" | "ready" | "unconfigured" | "access" | "auth" | "limit" | "unavailable";
type MarkerEntry = { marker: Marker; element: HTMLButtonElement; badge: HTMLSpanElement; click: () => void };
type View = { scope: string; bounds: TradeMapBounds | null; page: number; addressKey: string; locationStatus: TradeMapLocationStatus };
type Progress = { scope: string; running: boolean; waiting: boolean; completed: number; error: string };

function recordKey(record: TradeMapRecord) { return `${record.kind}:${record.id}`; }
function initialView(scope: string): View { return { scope, bounds: null, page: 1, addressKey: "", locationStatus: "all" }; }
function number(value: number) { return value.toLocaleString("en-AU"); }
function removeMarker(entry: MarkerEntry) { entry.element.removeEventListener("click", entry.click); entry.marker.remove(); }
function fitBounds(runtime: Runtime, bounds: TradeMapBounds) {
  if (bounds.north - bounds.south < 0.00001 && bounds.east - bounds.west < 0.00001) {
    runtime.map.easeTo({ center: [bounds.east, bounds.north], zoom: 17 }); return;
  }
  runtime.map.fitBounds(tlinkMapBounds(bounds), { padding: 55, maxZoom: 18 });
}
const mapMessages: Record<Exclude<MapState, "ready">, { title: string; detail: string }> = {
  loading: { title: "Loading map", detail: "Your saved locations will appear when the map is ready." },
  unconfigured: { title: "Customer maps are being connected", detail: "An administrator needs to finish the map connection. Your saved records are available below." },
  access: { title: "Map access is unavailable", detail: "Refresh your session and try again. Your workspace access may need to be reviewed." },
  auth: { title: "The map connection needs attention", detail: "An administrator needs to check map access for this site. Your customer and job records are still available." },
  limit: { title: "Map display is paused", detail: "The map provider's usage limit has been reached. Saved addresses and customer records remain available below." },
  unavailable: { title: "Map display is unavailable", detail: "Check your connection and try again. Your customer and job records are still available." },
};
const locationLabels: Record<TradeMapLocationStatus, string> = {
  all: "In this area + without a pin", located: "On map in this area", pending: "Waiting for a location", unlocated: "Address needs attention", approximate: "Approximate pins in this area",
};
function locationLabel(record: TradeMapDatasetItem) {
  if (!record.address.trim()) return "Street address needed";
  if (record.locationStatus === "located") return record.approximate ? "Approximate pin" : "On map";
  return record.locationStatus === "unlocated" ? "Address needs attention" : "Waiting for location";
}

export function TradeRecordMap(props: Props) {
  const businessOwnerUid = useTradeBusiness()?.ownerUid || props.user.uid;
  // Remount all map, search and design state when the authenticated business changes.
  return <TradeRecordMapView key={`${props.user.uid}:${businessOwnerUid}`} {...props} businessOwnerUid={businessOwnerUid} />;
}

function TradeRecordMapView({ user, query, onOpenRecord, quoteAccess, onRegisterMapSave, businessOwnerUid }: Props & { businessOwnerUid: string }) {
  const fetch = useTradeBusinessFetch();
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
  const interactedRef = useRef(false);
  const firstFitRef = useRef({ scope: "", final: false });
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [configuration, setConfiguration] = useState<{ ownerUid: string; value: TLinkMapConfiguration } | null>(null);
  const config = configuration?.ownerUid === businessOwnerUid ? configuration.value : null;
  const [designScope, setDesignScope] = useState<string | null>(null);
  const designOpen = designScope === scope;
  const [address, setAddress] = useState("");
  const addressSearchRef = useRef<AbortController | null>(null);
  const addressMarkerRef = useRef<Marker | null>(null);
  const [searchState, setSearchState] = useState({ scope, busy: false, message: "" });
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

  useEffect(() => { interactedRef.current = false; addressMarkerRef.current?.remove(); return () => { addressSearchRef.current?.abort(); }; }, [scope]);
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
    let createdMap: TLinkMap | null = null;
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;
    let themeObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    void (async () => {
      setMapState("loading"); setRuntime(null); setConfiguration(null);
      setSearchState(previous => ({ ...previous, busy: false }));
      firstFitRef.current = { scope: "", final: false };
      const response = await fetch("/api/trade-map/config", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) { if (!controller.signal.aborted) setMapState("access"); return; }
      if (!response.ok) throw new Error("Map configuration unavailable");
      const config: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!isTLinkMapConfiguration(config)) throw new Error("Invalid map configuration");
      setConfiguration({ ownerUid: businessOwnerUid, value: config });
      if (!config.configured) { setMapState("unconfigured"); return; }
      const api = await import("@maptiler/sdk");
      if (controller.signal.aborted || !canvas) return;
      const style = () => document.documentElement.dataset.tlinkColourMode === "night" ? api.MapStyle.STREETS.DARK : api.MapStyle.STREETS.DEFAULT;
      createdMap = new api.Map({
        apiKey: config.apiKey, container: canvas, center: [134, -25.5], zoom: 4, style: style(),
        scaleControl: true, navigationControl: false, fullscreenControl: true,
        terrainControl: false, geolocateControl: false, projectionControl: false,
        // SDK 4.x overrides attributionControl; this disables the underlying HTML control.
        forceNoAttributionControl: true,
        cooperativeGestures: !window.matchMedia("(pointer: fine)").matches,
        dragRotate: false, touchPitch: false, pitchWithRotate: false, maxPitch: 0, renderWorldCopies: false,
      });
      createdMap.addControl(new api.NavigationControl({ showCompass: false }), "bottom-right");
      createdMap.addControl(createTLinkMapAttribution(document, styles.mapAttribution), "bottom-left");
      loadingTimer = setTimeout(() => { if (!controller.signal.aborted) setMapState("unavailable"); }, 20_000);
      createdMap.on("dragstart", () => { interactedRef.current = true; });
      createdMap.on("load", () => { clearTimeout(loadingTimer); if (!controller.signal.aborted) setMapState("ready"); });
      createdMap.on("error", event => { clearTimeout(loadingTimer); if (!controller.signal.aborted) setMapState(tlinkMapFailure(event.error)); });
      setRuntime({ ownerUid: businessOwnerUid, api, map: createdMap });
      themeObserver = new MutationObserver(() => { createdMap?.setStyle(style()); });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tlink-colour-mode"] });
      resizeObserver = new ResizeObserver(() => { if (canvas.clientWidth && canvas.clientHeight) createdMap?.resize(); });
      resizeObserver.observe(canvas);
    })().catch(error => { if (!controller.signal.aborted) setMapState(tlinkMapFailure(error)); });
    return () => {
      controller.abort(); clearTimeout(loadingTimer); themeObserver?.disconnect(); resizeObserver?.disconnect();
      canvas?.removeEventListener("pointerdown", interact);
      canvas?.removeEventListener("wheel", interact);
      canvas?.removeEventListener("keydown", interact);
      for (const entry of markers.values()) removeMarker(entry);
      markers.clear();
      addressSearchRef.current?.abort();
      addressMarkerRef.current?.remove();
      createdMap?.remove();
      canvas?.replaceChildren();
    };
  }, [businessOwnerUid, fetch, user, setupAttempt]);

  useEffect(() => {
    if (!runtime || runtime.ownerUid !== businessOwnerUid) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const currentBounds = runtime.map.getBounds();
        const bounds = { north: currentBounds.getNorth(), south: currentBounds.getSouth(), east: Math.min(180, currentBounds.getEast()), west: Math.max(-180, currentBounds.getWest()) };
        setViewState(previous => {
          const current = previous.scope === scope ? previous : initialView(scope);
          const next = { ...current, bounds };
          if (tradeMapViewportUrl(baseUrl, next) === tradeMapViewportUrl(baseUrl, current)) return previous;
          return { ...next, page: 1 };
        });
      }, 250);
    };
    runtime.map.on("moveend", update);
    update();
    return () => { clearTimeout(timer); runtime.map.off("moveend", update); };
  }, [runtime, businessOwnerUid, scope, baseUrl]);

  useEffect(() => {
    if (!runtime || runtime.ownerUid !== businessOwnerUid || !data?.bounds || interactedRef.current) return;
    if (firstFitRef.current.scope !== scope || (!firstFitRef.current.final && data.pending === 0)) {
      fitBounds(runtime, data.bounds);
      firstFitRef.current = { scope, final: data.pending === 0 };
    }
  }, [runtime, businessOwnerUid, data, scope]);

  useEffect(() => {
    if (!config?.gnaf.ready || !lookupEnabled) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let completed = 0;
    let lastRefresh = 0;
    async function post() {
      const response = await fetch(baseUrl, { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "locate_map_records", limit: 200 }), signal });
      if ((response.status === 401 || response.status === 403) && !signal.aborted) { setDataset(null); setSelection(null); setLookupState({ scope, enabled: false }); }
      if (!response.ok) throw new Error(response.status === 503 ? "The Australian address directory is being prepared. Your saved records are available. Try again later." : "Address processing could not be completed. Retry to continue from your saved locations.");
      const result: unknown = await response.json();
      return result;
    }
    function reload(force = false) {
      if (!signal.aborted && (force || Date.now() - lastRefresh >= 3_000)) { lastRefresh = Date.now(); setRefresh(value => value + 1); }
    }
    void (async () => {
      setProgress({ scope, running: true, waiting: false, completed, error: "" });
      while (!signal.aborted) {
        const batch = await post();
        if (signal.aborted) return;
        if (!isTLinkMapLocationProgress(batch)) throw new Error("Address processing returned an unexpected result. Retry to continue.");
        completed += batch.processed;
        reload(batch.complete);
        setProgress({ scope, running: !batch.complete && !batch.retryAfterMs, waiting: !batch.complete && batch.retryAfterMs > 0, completed, error: "" });
        if (batch.complete) { setLookupState({ scope, enabled: false }); return; }
        // One bounded server batch at a time. The server saves progress even if
        // this view closes; no customer addresses are sent to a map provider.
        await waitForTradeMapRetry(batch.retryAfterMs || 150, signal);
      }
    })().catch(error => {
      if (!signal.aborted) { reload(true); setProgress({ scope, running: false, waiting: false, completed, error: error instanceof Error ? error.message : "Address processing paused. Retry to continue." }); setLookupState({ scope, enabled: false }); }
    });
    return () => controller.abort();
  }, [config?.gnaf.ready, baseUrl, scope, fetch, user, locateAttempt, query.revision, lookupEnabled]);

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
        const element = document.createElement("button"); element.type = "button"; element.className = styles.pinButton;
        const badge = document.createElement("span"); badge.className = styles.pin; badge.setAttribute("aria-hidden", "true");
        element.append(badge);
        const marker = new runtime.api.Marker({ element, anchor: "bottom" }).setLngLat([pin.position.lng, pin.position.lat]).addTo(runtime.map);
        entry = { marker, element, badge, click }; markers.set(pin.id, entry);
      } else { entry.element.removeEventListener("click", entry.click); entry.click = click; }
      entry.element.addEventListener("click", click);
      entry.marker.setLngLat([pin.position.lng, pin.position.lat]);
      const title = `${number(pin.count)} ${pin.count === 1 ? "record" : "records"}. ${TRADE_MAP_PIN_LABELS[pin.category]}. ${pin.count === 1 ? "Select to view details." : pin.addressKey ? "Select to browse this address." : "Select to zoom in."}`;
      entry.element.title = title; entry.element.setAttribute("aria-label", title);
      entry.badge.textContent = pin.count > 1 ? number(pin.count) : "";
      entry.badge.dataset.category = pin.category;
      entry.badge.dataset.cluster = String(pin.count > 1);
      const isSelected = Boolean((selected && pin.record && recordKey(selected) === recordKey(pin.record)) || (view.addressKey && view.addressKey === pin.addressKey));
      entry.badge.dataset.selected = String(isSelected);
      entry.element.style.zIndex = isSelected ? "1000" : "";
    }
  }, [businessOwnerUid, runtime, pins, selected, view.addressKey, scope, query.resource]);

  function selectRecord(record: TradeMapDatasetItem) {
    interactedRef.current = true; setSelection({ scope, record }); setClusterNotice(null);
    if (runtime && record.position) runtime.map.easeTo({ center: [record.position.lng, record.position.lat], zoom: Math.max(runtime.map.getZoom(), 15) });
    selectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  async function findAddress(event: FormEvent) {
    event.preventDefault();
    if (!runtime || runtime.ownerUid !== businessOwnerUid || !config?.gnaf.ready) return;
    const query = address.trim();
    if (query.length < 4) { setSearchState({ scope, busy: false, message: "Enter the street number, street, suburb, state and postcode." }); return; }
    addressSearchRef.current?.abort();
    const controller = new AbortController(); addressSearchRef.current = controller;
    setSearchState({ scope, busy: true, message: "" });
    addressMarkerRef.current?.remove();
    try {
      const response = await fetch("/api/trade-map/locate", { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ address: query }), signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 503 ? "The Australian address directory is being prepared. Try again later." : "Address search is unavailable. Try again.");
      const value: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!isTLinkAddressResult(value)) throw new Error("Address search returned an unexpected result. Try again.");
      if (value.result.status === "located") {
        interactedRef.current = true;
        const position = value.result.position;
        const element = document.createElement("div"); element.className = styles.pinButton; element.setAttribute("role", "img"); element.setAttribute("aria-label", "Matched address");
        const badge = document.createElement("span"); badge.className = styles.pin; badge.dataset.category = "customer"; badge.dataset.selected = "true"; badge.setAttribute("aria-hidden", "true"); element.append(badge);
        addressMarkerRef.current = new runtime.api.Marker({ element, anchor: "bottom" }).setLngLat([position.lng, position.lat]).addTo(runtime.map);
        runtime.map.easeTo({ center: [position.lng, position.lat], zoom: 17 });
        setSearchState({ scope, busy: false, message: value.result.approximate ? "Approximate address found. Confirm its location before travelling." : "Address found in the Australian address directory." });
      } else setSearchState({ scope, busy: false, message: value.result.status === "unlocated" ? value.result.reason === "ambiguous" ? "This address has more than one location. Add the unit number and check the full address." : "No exact address match. Enter the street number, street, suburb, state and postcode." : "The address directory is temporarily unavailable. Try again." });
    } catch (error) { if (!controller.signal.aborted) setSearchState({ scope, busy: false, message: error instanceof Error ? error.message : "Address search is unavailable." }); }
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
      <button type="button" className={styles.button} disabled={!runtime || !data?.bounds || designOpen || mapState !== "ready"} onClick={() => { if (runtime && data?.bounds) { interactedRef.current = true; fitBounds(runtime, data.bounds); setViewState({ ...view, addressKey: "", page: 1 }); } }}>Fit all pins</button>
    </header>
    {!designOpen && <div className={styles.toolbar}><form onSubmit={event => void findAddress(event)} className={styles.addressSearch}><label htmlFor={`map-address-${query.resource}`}>Go to an address</label><div><input id={`map-address-${query.resource}`} value={address} maxLength={1000} autoComplete="off" placeholder="Street number, street, suburb, state and postcode" onChange={event => setAddress(event.target.value)} /><button type="submit" className={styles.button} disabled={!config?.gnaf.ready || mapState !== "ready" || searchState.scope === scope && searchState.busy}>{searchState.scope === scope && searchState.busy ? "Finding..." : "Find address"}</button></div>{searchState.scope === scope && searchState.message && <p role="status">{searchState.message}</p>}</form><button type="button" className={styles.button} onClick={() => setDesignScope(scope)}><svg className={styles.toolIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3Z" /><path d="m8 12 4-3 4 3v5H8Z" /></svg>Roof design & measurements</button></div>}
    {designOpen && <TradeRoofDesignMap key={scope} user={user} onRegisterMapSave={onRegisterMapSave} linkedDesign={linkedDesign} position={selected?.position}
      context={selected ? { title: selected.address || selected.title, customerId: selected.kind === "customer" ? selected.id : "", workOrderId: selected.kind === "job" ? selected.id : "" } : undefined}
      onQuote={quoteAccess ? setQuoteMeasurement : undefined} onClose={() => setDesignScope(null)} />}
    {quoteAccess && quoteMeasurement && <TradeMapQuoteDialog key={businessOwnerUid} user={user} measurement={quoteMeasurement} access={quoteAccess} onDesignLinked={setLinkedDesign} onClose={() => setQuoteMeasurement(null)} />}
    <div className={styles.status} role="status" aria-live="polite"><span><i className={styles.dot} aria-hidden="true" />{number(data?.mapped ?? 0)} mapped</span><span>{number(data?.approximate ?? 0)} approximate</span><span>{number(data?.pending ?? 0)} waiting</span><span>{number(data?.unmapped ?? 0)} need an address check</span>{loading && <span>Updating view...</span>}</div>
    {data && data.pending > 0 && config && <div className={styles.processing}>
      <div><strong>{!config.gnaf.ready ? "Australian address directory is being prepared" : lookupEnabled ? currentProgress?.waiting ? "Waiting for the next available batch" : "Saving permanent address locations" : "Locations ready to prepare"}</strong>
        <p>{!config.gnaf.ready ? "Your customer records are saved. Location matching will be available when the directory is ready." : lookupEnabled ? `${number(currentProgress?.completed ?? 0)} addresses checked this visit. Keep this map open to continue.` : `${number(data.pending)} ${query.resource} are waiting for a location. Start or resume when you are ready.`} Address matching uses the TLink Australian directory, with no per-address Google lookup charge. Saved matches are shared across your business and team.</p></div>
      <button type="button" className={styles.button} disabled={!config.gnaf.ready} onClick={() => { if (lookupEnabled) { setLookupState({ scope, enabled: false }); setRefresh(value => value + 1); } else { setLocateAttempt(value => value + 1); setLookupState({ scope, enabled: true }); } }}>{lookupEnabled ? "Pause lookups" : "Start locating addresses"}</button>
    </div>}
    {legendCategories.length > 0 && <ul className={styles.legend} aria-label="Map pin colours">{legendCategories.map(category => <li key={category}><i className={styles.swatch} data-category={category} aria-hidden="true" /><span>{TRADE_MAP_PIN_LABELS[category]}</span></li>)}</ul>}
    {dataError?.request === requestKey && <div className={styles.notice} role="alert"><p>{dataError.message}</p><button type="button" className={styles.button} onClick={() => setRefresh(value => value + 1)}>Reload map records</button></div>}
    {currentProgress?.error && <div className={styles.notice} role="alert"><p>{currentProgress.error}</p><button type="button" className={styles.button} disabled={!config?.gnaf.ready} onClick={() => { setLocateAttempt(value => value + 1); setLookupState({ scope, enabled: true }); }}>Retry address lookup</button></div>}
    <div className={styles.layout} hidden={designOpen}><div className={styles.mapArea}><div ref={canvasRef} className={styles.canvas} aria-label={`Map of all matching ${query.resource}`} />
      {overlay && <div className={styles.overlay} role="status"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 43S9 29 9 18a15 15 0 0 1 30 0c0 11-15 25-15 25Z" /><circle cx="24" cy="18" r="5" /></svg><strong>{overlay.title}</strong><p>{overlay.detail}</p>{["unavailable", "access", "unconfigured", "auth"].includes(mapState) && <button type="button" className={styles.button} onClick={() => setSetupAttempt(value => value + 1)}>Try again</button>}</div>}
    </div><aside className={styles.sidebar} aria-label="Map records" aria-busy={loading}>
      <div ref={selectionRef} className={styles.selection} aria-live="polite">{selected ? <><div className={styles.selectionHeading}><strong>Selected record</strong><button type="button" className={styles.clearButton} onClick={() => setSelection(null)} aria-label="Clear map selection">×</button></div><article className={styles.selectedRecord}><span className={styles.reference}>{selected.reference || selected.kind}</span><h4>{selected.title}</h4>{selected.detail && <p>{selected.detail}</p>}<p>{selected.address || "Address unavailable"}</p>{selected.approximate && <p className={styles.approximate}>Approximate location. Confirm the address before travelling.</p>}<div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={() => onOpenRecord(selected)}>Open {selected.kind}</button>{directions && <a href={directions} target="_blank" rel="noopener noreferrer">Directions ↗</a>}</div></article></> : <p className={styles.hint}>{clusterNotice?.scope === scope ? clusterNotice.message : "Select a numbered group to zoom in. Select an individual pin or a record for details and directions."}</p>}</div>
      <div className={styles.listControls}><label htmlFor={`map-record-view-${query.resource}`}>Show</label><select id={`map-record-view-${query.resource}`} value={view.locationStatus} onChange={event => { const value = event.target.value; if (value === "all" || value === "located" || value === "pending" || value === "unlocated" || value === "approximate") setLocationStatus(value); }}>{Object.entries(locationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div className={styles.listHeading}><strong>{listTitle}</strong><span>{listCurrent ? number(data?.listTotal ?? 0) : "..."}</span></div>
      {view.addressKey && <button type="button" className={styles.addressReset} onClick={() => { setSelection(null); setViewState({ ...view, addressKey: "", page: 1 }); }}>Show all addresses in this area</button>}
      <ul className={styles.records}>{listCurrent && records.map(record => <li key={recordKey(record)}><button type="button" className={styles.record} aria-pressed={selected !== null && recordKey(selected) === recordKey(record)} onClick={() => selectRecord(record)}><span className={styles.reference}>{record.reference || record.kind}</span><strong>{record.title}</strong><span className={styles.address}>{record.address || "Address unavailable"}</span>{record.kind === "job" && <span className={styles.recordStatus}><i className={styles.swatch} data-category={tradeMapRecordCategory(record)} aria-hidden="true" />{TRADE_MAP_PIN_LABELS[tradeMapRecordCategory(record)]}</span>}<span className={styles.locationState} data-located={record.locationStatus === "located"}>{locationLabel(record)}</span></button></li>)}</ul>
      {!loading && listCurrent && !records.length && <p className={styles.emptyList}>{data?.total ? "No records in this view. Change the view or zoom out." : "No records match these filters."}</p>}
      {data && <div className={styles.pagination}><button type="button" className={styles.button} disabled={loading || !listCurrent || view.page <= 1} onClick={() => setViewState({ ...view, page: view.page - 1 })}>Previous</button><span>Page {number(view.page)}</span><button type="button" className={styles.button} disabled={loading || !listCurrent || !data.hasMore} onClick={() => setViewState({ ...view, page: view.page + 1 })}>Next</button></div>}
    </aside></div>
    <p className={styles.footer}>Matched address locations are saved permanently for your business and reused by every team member and device. New or changed addresses are matched when you start processing. Customer records and address searches stay in TLink. The map provider only supplies the background map.{config?.gnaf.attribution && <> <span>{config.gnaf.attribution}</span> <a href={GNAF_LICENCE_URL} target="_blank" rel="noopener noreferrer">Address data licence</a>.</>}</p>
  </section>;
}
