"use client";

/// <reference types="google.maps" />

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  geocodeTradeMapAddress,
  GoogleMapsClientError,
  loadGoogleMaps,
  onGoogleMapsAuthFailure,
} from "@/lib/google-maps-client";
import {
  createTradeMapAddressResolver,
  groupTradeMapPins,
  prepareTradeMapAddress,
  tradeMapAddressKey,
  tradeMapDirectionsUrl,
  type TradeMapGeocodeResult,
  type TradeMapPosition,
  type TradeMapRecord,
} from "@/lib/trade-record-map";
import styles from "./TradeRecordMap.module.css";

type Props = {
  user: User;
  records: TradeMapRecord[];
  loading?: boolean;
  total: number;
  onOpenRecord: (record: TradeMapRecord) => void;
};
type Runtime = {
  ownerUid: string;
  api: typeof google.maps;
  map: google.maps.Map;
  resolve: ReturnType<typeof createTradeMapAddressResolver>;
};
type MapState = "loading" | "ready" | "unconfigured" | "access" | "auth" | "unavailable";
type Selection = { kind: "pin" | "record"; key: string } | null;
type MarkerEntry = { marker: google.maps.marker.AdvancedMarkerElement; badge: HTMLDivElement; click: () => void };
type Progress = { completed: number; total: number; running: boolean; error: "denied" | "quota" | "unavailable" | null };

const INITIAL_PROGRESS: Progress = { completed: 0, total: 0, running: false, error: null };

function recordKey(record: TradeMapRecord) { return `${record.kind}:${record.id}`; }

function removeMarker(entry: MarkerEntry) {
  entry.marker.removeEventListener("gmp-click", entry.click);
  entry.marker.map = null;
}

function updateMarker(entry: MarkerEntry, title: string, label: string, selected: boolean) {
  entry.marker.title = title;
  entry.badge.textContent = label;
  entry.badge.dataset.selected = String(selected);
  entry.marker.zIndex = selected ? 1000 : undefined;
}

function fitPositions(runtime: Runtime, positions: readonly TradeMapPosition[]) {
  if (!positions.length) return;
  if (positions.length === 1) {
    runtime.map.setCenter(positions[0]);
    runtime.map.setZoom(15);
    return;
  }
  const bounds = new runtime.api.LatLngBounds();
  for (const position of positions) bounds.extend(position);
  runtime.map.fitBounds(bounds, 55);
  runtime.api.event.addListenerOnce(runtime.map, "idle", () => {
    if ((runtime.map.getZoom() ?? 0) > 16) runtime.map.setZoom(16);
  });
}

function isConfiguredMap(value: unknown): value is { ok: true; configured: boolean; apiKey?: string; mapId?: string } {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true
    && "configured" in value && typeof value.configured === "boolean";
}

const mapMessages: Record<Exclude<MapState, "ready">, { title: string; detail: string }> = {
  loading: { title: "Loading map", detail: "Your records will appear here when the map is ready." },
  unconfigured: { title: "Google Maps is not connected yet", detail: "An administrator needs to finish Google Maps setup. You can still open your records below." },
  access: { title: "Map access is unavailable", detail: "Refresh your session and try again. Your workspace access may need to be reviewed." },
  auth: { title: "Google Maps could not authorise this site", detail: "An administrator needs to check the Google Maps connection. Refresh this page after it is corrected." },
  unavailable: { title: "Google Maps is unavailable", detail: "Check your connection and try again. Your customer and job records are still available." },
};

const geocodeMessages = {
  denied: "Google could not authorise address lookup. An administrator needs to check the Maps connection.",
  quota: "Google's address lookup limit has been reached. The remaining addresses have not been checked. Try again later.",
  unavailable: "Address lookup is temporarily unavailable. The remaining addresses have not been checked.",
};

export function TradeRecordMap({ user, records, loading = false, total, onOpenRecord }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const interactedRef = useRef(false);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [locations, setLocations] = useState<ReadonlyMap<string, TradeMapGeocodeResult>>(new Map());
  const [progress, setProgress] = useState<Progress>(INITIAL_PROGRESS);
  const [selection, setSelection] = useState<Selection>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [locateAttempt, setLocateAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const canvas = canvasRef.current;
    let createdMap: google.maps.Map | null = null;
    let api: typeof google.maps | null = null;
    const unsubscribeAuth = onGoogleMapsAuthFailure(() => {
      if (controller.signal.aborted) return;
      controller.abort();
      setMapState("auth");
      setRuntime(null);
    });

    async function initialise() {
      setMapState("loading");
      setRuntime(null);
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const response = await fetch("/api/trade-map/config", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setMapState("access");
          return;
        }
        if (!response.ok) throw new Error("Map configuration unavailable");
        const config: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!isConfiguredMap(config)) throw new Error("Invalid map configuration");
        if (!config.configured) {
          setMapState("unconfigured");
          return;
        }
        if (typeof config.apiKey !== "string" || !config.apiKey.trim()
          || typeof config.mapId !== "string" || !config.mapId.trim() || config.mapId === "DEMO_MAP_ID") {
          throw new Error("Incomplete map configuration");
        }
        api = await loadGoogleMaps(config.apiKey);
        if (controller.signal.aborted || !canvas) return;
        createdMap = new api.Map(canvas, {
          mapId: config.mapId,
          center: { lat: -25.5, lng: 134 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
          fullscreenControl: true,
          gestureHandling: "cooperative",
          colorScheme: document.documentElement.dataset.tlinkColourMode === "night" ? "DARK" : "LIGHT",
        });
        createdMap.addListener("dragstart", () => { interactedRef.current = true; });
        const geocoder = new api.Geocoder();
        setRuntime({ ownerUid: user.uid, api, map: createdMap, resolve: createTradeMapAddressResolver((address) => geocodeTradeMapAddress(geocoder, address)) });
        setMapState("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setMapState(error instanceof GoogleMapsClientError && error.reason === "auth" ? "auth" : "unavailable");
      }
    }
    void initialise();
    return () => {
      controller.abort();
      unsubscribeAuth();
      if (createdMap && api) api.event.clearInstanceListeners(createdMap);
      canvas?.replaceChildren();
    };
  }, [user, setupAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    async function locateRecords() {
      setSelection(null);
      setLocations(new Map());
      setProgress(INITIAL_PROGRESS);
      interactedRef.current = false;
      if (!runtime || runtime.ownerUid !== user.uid || loading) return;
      const addresses = new Map<string, string>();
      for (const record of records) {
        const address = prepareTradeMapAddress(record.address);
        if (address) addresses.set(tradeMapAddressKey(address), address);
      }
      const nextLocations = new Map<string, TradeMapGeocodeResult>();
      setProgress({ completed: 0, total: addresses.size, running: addresses.size > 0, error: null });
      let completed = 0;
      let firstPin = true;
      for (const [key, address] of addresses) {
        const result = await runtime.resolve(address, controller.signal);
        if (controller.signal.aborted || !result) return;
        nextLocations.set(key, result);
        completed += 1;
        setLocations(new Map(nextLocations));
        if (result.status === "error") {
          setProgress({ completed, total: addresses.size, running: false, error: result.reason });
          return;
        }
        if (firstPin && result.status === "located") {
          firstPin = false;
          if (!interactedRef.current) fitPositions(runtime, [result.position]);
        }
        setProgress({ completed, total: addresses.size, running: completed < addresses.size, error: null });
      }
      if (!interactedRef.current) fitPositions(runtime, groupTradeMapPins(records, nextLocations).map((pin) => pin.position));
    }
    void locateRecords();
    return () => { controller.abort(); };
  }, [runtime, records, loading, locateAttempt, user.uid]);

  const pins = useMemo(() => groupTradeMapPins(records, locations), [records, locations]);
  const selectedRecords = useMemo(() => {
    if (!selection) return [];
    if (selection.kind === "pin") return pins.find((pin) => pin.key === selection.key)?.records ?? [];
    const selected = records.find((record) => recordKey(record) === selection.key);
    return selected ? [selected] : [];
  }, [selection, pins, records]);
  const selectedPinKeys = useMemo(() => new Set(pins.filter((pin) =>
    pin.records.some((record) => selectedRecords.some((selected) => recordKey(record) === recordKey(selected))),
  ).map((pin) => pin.key)), [pins, selectedRecords]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const entry of markers.values()) removeMarker(entry);
      markers.clear();
    };
  }, [runtime]);

  useEffect(() => {
    if (!runtime || runtime.ownerUid !== user.uid) return;
    const markers = markersRef.current;
    const activeKeys = new Set(pins.map((pin) => pin.key));
    for (const [key, entry] of markers) {
      if (activeKeys.has(key)) continue;
      removeMarker(entry);
      markers.delete(key);
    }
    for (const pin of pins) {
      let entry = markers.get(pin.key);
      if (!entry) {
        const badge = document.createElement("div");
        badge.className = styles.pin;
        const marker = new runtime.api.marker.AdvancedMarkerElement({ map: runtime.map, position: pin.position, gmpClickable: true });
        marker.append(badge);
        const click = () => {
          interactedRef.current = true;
          setSelection({ kind: "pin", key: pin.key });
          selectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        };
        marker.addEventListener("gmp-click", click);
        entry = { marker, badge, click };
        markers.set(pin.key, entry);
      }
      // Google receives a local pin's address/count, never customer names or job details.
      updateMarker(entry,
        `${pin.records.length} ${pin.records.length === 1 ? "record" : "records"} at ${pin.records[0].address}. Select to view details.`,
        pin.records.length > 1 ? String(pin.records.length) : pin.records[0].kind === "job" ? "J" : "C",
        selectedPinKeys.has(pin.key),
      );
    }
  }, [runtime, pins, selectedPinKeys, user.uid]);

  function selectRecord(record: TradeMapRecord) {
    interactedRef.current = true;
    setSelection({ kind: "record", key: recordKey(record) });
    const pin = pins.find((candidate) => candidate.records.some((item) => recordKey(item) === recordKey(record)));
    if (runtime && pin) {
      runtime.map.panTo(pin.position);
      if ((runtime.map.getZoom() ?? 0) < 15) runtime.map.setZoom(15);
    }
    selectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function locationLabel(record: TradeMapRecord) {
    if (!record.address.trim()) return "Address unavailable";
    const address = prepareTradeMapAddress(record.address);
    if (!address) return "Street address needed";
    const result = locations.get(tradeMapAddressKey(address));
    if (result?.status === "located") return result.approximate ? "Approximate pin" : "On map";
    if (result?.status === "unlocated") return result.reason === "outside_australia" ? "No Australian match" : "Address not found";
    if (result?.status === "error") return "Lookup unavailable";
    return progress.running ? "Waiting for location" : "Not mapped";
  }

  const locatedCount = pins.reduce((count, pin) => count + pin.records.length, 0);
  const unavailableCount = records.length - locatedCount;
  const allJobs = records.length > 0 && records.every((record) => record.kind === "job");
  const allCustomers = records.length > 0 && records.every((record) => record.kind === "customer");
  const recordLabel = allJobs ? "jobs" : allCustomers ? "customers" : "records";
  const overlay = loading ? { title: "Loading records", detail: "Updating this page of the map." }
    : !records.length ? { title: "No matching records", detail: "Adjust your filters to see customer or job locations." }
      : mapState !== "ready" ? mapMessages[mapState] : null;

  return (
    <section className={styles.root} aria-label={allJobs ? "Job map" : allCustomers ? "Customer map" : "Record map"}>
      <header className={styles.header}>
        <div>
          <h3>{allJobs ? "Job locations" : allCustomers ? "Customer locations" : "Locations"}</h3>
          <p>Showing {records.length} of {total} matching {recordLabel}. Pins cover this page.</p>
        </div>
        <button type="button" className={styles.button} disabled={!runtime || !pins.length || loading || mapState !== "ready"}
          onClick={() => { if (runtime) { interactedRef.current = true; fitPositions(runtime, pins.map((pin) => pin.position)); } }}>
          Fit all pins
        </button>
      </header>

      <div className={styles.status} role="status" aria-live="polite">
        <span><i className={styles.dot} aria-hidden="true" />{locatedCount} mapped{pins.length ? ` at ${pins.length} ${pins.length === 1 ? "location" : "locations"}` : ""}</span>
        <span>{unavailableCount} {progress.running ? "not mapped yet" : "without a pin"}</span>
        {progress.running ? <span>Checking addresses: {progress.completed} of {progress.total}</span> : null}
      </div>
      {progress.error && mapState === "ready" ? (
        <div className={styles.notice} role="alert">
          <p>{geocodeMessages[progress.error]}</p>
          <button type="button" className={styles.button} onClick={() => setLocateAttempt((attempt) => attempt + 1)}>Retry address lookup</button>
        </div>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.mapArea}>
          <div ref={canvasRef} className={styles.canvas} aria-label="Google map of the records on this page" />
          {overlay ? <div className={styles.overlay} role="status">
            <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 43S9 29 9 18a15 15 0 0 1 30 0c0 11-15 25-15 25Z" /><circle cx="24" cy="18" r="5" /></svg>
            <strong>{overlay.title}</strong>
            <p>{overlay.detail}</p>
            {!loading && records.length > 0 && ["unavailable", "access", "unconfigured"].includes(mapState)
              ? <button type="button" className={styles.button} onClick={() => setSetupAttempt((attempt) => attempt + 1)}>Try again</button> : null}
          </div> : null}
        </div>

        <aside className={styles.sidebar} aria-label="Map records">
          <div ref={selectionRef} className={styles.selection} aria-live="polite">
            {selectedRecords.length ? <>
              <div className={styles.selectionHeading}>
                <strong>{selectedRecords.length > 1 ? `${selectedRecords.length} records at this pin` : "Selected record"}</strong>
                <button type="button" className={styles.clearButton} onClick={() => setSelection(null)} aria-label="Clear map selection">×</button>
              </div>
              {selectedRecords.map((record) => {
                const directions = tradeMapDirectionsUrl(record.address);
                return <article className={styles.selectedRecord} key={recordKey(record)}>
                  <span className={styles.reference}>{record.reference || (record.kind === "job" ? "Job" : "Customer")}</span>
                  <h4>{record.title}</h4>
                  {record.detail ? <p>{record.detail}</p> : null}
                  <p>{record.address || "Address unavailable"}</p>
                  {locationLabel(record) === "Approximate pin" ? <p className={styles.approximate}>Approximate location. Confirm the address before travelling.</p> : null}
                  <div className={styles.actions}>
                    <button type="button" className={styles.primaryButton} onClick={() => onOpenRecord(record)}>Open {record.kind}</button>
                    {directions ? <a href={directions} target="_blank" rel="noopener noreferrer">Directions ↗</a> : null}
                  </div>
                </article>;
              })}
            </> : <p className={styles.hint}>Select a pin or a record to see details, open it or get directions.</p>}
          </div>

          <div className={styles.listHeading}><strong>On this page</strong><span>{records.length}</span></div>
          <ul className={styles.records}>
            {records.map((record) => {
              const selected = selectedRecords.some((item) => recordKey(item) === recordKey(record));
              const label = locationLabel(record);
              return <li key={recordKey(record)}>
                <button type="button" className={styles.record} aria-pressed={selected} onClick={() => selectRecord(record)}>
                  <span className={styles.reference}>{record.reference || (record.kind === "job" ? "Job" : "Customer")}</span>
                  <strong>{record.title}</strong>
                  <span className={styles.address}>{record.address || "Address unavailable"}</span>
                  <span className={styles.locationState} data-located={label === "On map" || label === "Approximate pin"}>{label}</span>
                </button>
              </li>;
            })}
          </ul>
          {!records.length ? <p className={styles.emptyList}>No records on this page.</p> : null}
        </aside>
      </div>
      <p className={styles.footer}>Map view uses Google to locate addresses. Customer names, contacts and job details stay in TLink. Pins marked approximate need address confirmation.</p>
    </section>
  );
}
