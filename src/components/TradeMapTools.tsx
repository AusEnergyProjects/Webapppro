"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { geocodeTradeMapAddress } from "@/lib/google-maps-client";
import { createTradeMapMeasurement, EMPTY_MAP_MEASUREMENT, formatMapDistance, type TradeMapMeasureMode } from "@/lib/trade-map-measurement";
import styles from "./TradeMapTools.module.css";
import { TradeMapSolarTools } from "./TradeMapSolarTools";
import { mapQuoteMeasurement, type MapQuoteMeasurement } from "@/lib/trade-map-quote";
import { captureTradeMapQuoteImage } from "@/lib/trade-map-capture";
import type { User } from "firebase/auth";
import type { SolarDesign } from "@/lib/trade-solar-design";
import type { SolarMapContext } from "./TradeMapSolarTools";

type Props = { user: User; onRegisterMapSave?: (save: (() => Promise<unknown>) | null) => void; context?: SolarMapContext; linkedDesign?: SolarDesign | null; api: typeof google.maps; map: google.maps.Map; onExplore: () => void; onMeasuring: (active: boolean) => void; onQuote?: (measurement: MapQuoteMeasurement) => void };
const VIEWS = [["roadmap", "Map"], ["satellite", "Satellite"], ["hybrid", "Satellite + labels"], ["terrain", "Terrain"]] as const;
const number = (value: number) => new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

function bestImageryZoom(api: typeof google.maps, position: google.maps.LatLngLiteral): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 5000);
    const finish = (zoom: number | null) => { window.clearTimeout(timer); resolve(zoom); };
    void new api.MaxZoomService().getMaxZoomAtLatLng(position)
      .then((result) => finish(Number.isFinite(result.zoom) && result.zoom > 0 ? result.zoom : null))
      .catch(() => finish(null));
  });
}

export function TradeMapTools({ user, onRegisterMapSave, context, linkedDesign, api, map, onExplore, onMeasuring, onQuote }: Props) {
  const [view, setView] = useState("roadmap");
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [addressMessage, setAddressMessage] = useState("");
  const [locatedAddress, setLocatedAddress] = useState("");
  const contextKey = JSON.stringify([context?.customerId, context?.workOrderId]);
  const [locatedContext, setLocatedContext] = useState(contextKey);
  if (locatedContext !== contextKey) {
    setLocatedContext(contextKey);
    setLocatedAddress("");
  }
  const addressRequest = useRef(0);
  const addressPin = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [mode, setMode] = useState<TradeMapMeasureMode | null>(null);
  const [solarEditing, setSolarEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [measurement, setMeasurement] = useState(EMPTY_MAP_MEASUREMENT);
  const drawing = useRef<ReturnType<typeof createTradeMapMeasurement> | null>(null);
  const capture = useRef<AbortController | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [measurementCapturing, setMeasurementCapturing] = useState(false);
  const [captureMessage, setCaptureMessage] = useState("");

  useEffect(() => {
    map.setMapTypeId(view);
    map.setTilt(0);
    map.setHeading(0);
  }, [map, view]);

  useEffect(() => () => {
    addressRequest.current++;
    capture.current?.abort();
    if (addressPin.current) addressPin.current.map = null;
  }, [map]);

  useEffect(() => {
    onMeasuring(Boolean(mode) || solarEditing);
    if (addressPin.current) addressPin.current.map = mode || solarEditing ? null : map;
  }, [map, mode, solarEditing, onMeasuring]);

  useEffect(() => {
    if (!mode) return;
    const previewLabel = document.createElement("div");
    previewLabel.className = styles.distancePreview;
    previewLabel.setAttribute("aria-hidden", "true");
    const controller = createTradeMapMeasurement(api, map, mode, setMeasurement, previewLabel);
    drawing.current = controller;
    return () => { controller.dispose(); drawing.current = null; };
  }, [api, map, mode, attempt, onMeasuring]);

  async function findAddress(event: FormEvent) {
    event.preventDefault();
    const query = address.trim();
    if (query.length < 4) { setAddressMessage("Enter a street address and suburb."); return; }
    const request = ++addressRequest.current;
    onExplore();
    setMode(null);
    setSolarEditing(false);
    setSearching(true);
    setAddressMessage("");
    if (addressPin.current) { addressPin.current.map = null; addressPin.current = null; }
    const result = await geocodeTradeMapAddress(new api.Geocoder(), query);
    if (request !== addressRequest.current) return;
    const imageryZoom = result.status === "located" ? await bestImageryZoom(api, result.position) : null;
    if (request !== addressRequest.current) return;
    setSearching(false);
    if (result.status === "located") {
      setLocatedAddress(query);
      const badge = document.createElement("div");
      badge.className = styles.addressPin;
      badge.textContent = "+";
      const marker = new api.marker.AdvancedMarkerElement({ map, position: result.position, title: "Searched address" });
      marker.append(badge);
      addressPin.current = marker;
      map.setCenter(result.position);
      map.setZoom(imageryZoom ?? 20);
      setAddressMessage(result.approximate ? "Approximate location. Check the building before measuring." : "Address located. Add solar panels or choose Measure area to trace an insulation area.");
    } else if (result.status === "error") {
      setAddressMessage(result.reason === "quota" ? "Address lookup has reached its limit. Try again later." : "Address lookup is unavailable. Try again shortly.");
    } else {
      setAddressMessage("No Australian address found. Add a street number, suburb and postcode.");
    }
  }

  function startMeasure(nextMode: TradeMapMeasureMode) {
    onExplore();
    setSolarEditing(false);
    setMode(nextMode);
    setMeasurement(EMPTY_MAP_MEASUREMENT);
    setAttempt((value) => value + 1);
    setCaptureMessage("");
  }

  async function addMeasurementToQuote(value: MapQuoteMeasurement) {
    if (capture.current || !onQuote) return;
    drawing.current?.finish();
    const attempt = new AbortController(); capture.current = attempt;
    setCapturing(true); setMeasurementCapturing(true); setCaptureMessage("Choose this TLink tab in the sharing prompt to include your measured map.");
    try {
      const roofImage = await captureTradeMapQuoteImage(map.getDiv(), value, () => drawing.current?.setCapturing(true), () => drawing.current?.setCapturing(false), attempt.signal);
      if (!attempt.signal.aborted) { setCaptureMessage(""); onQuote({ ...value, roofImage }); }
    } catch (error) {
      if (!attempt.signal.aborted) setCaptureMessage(error instanceof Error ? error.message : "Could not capture the map. Try again.");
    } finally { if (!attempt.signal.aborted) { setCapturing(false); setMeasurementCapturing(false); } capture.current = null; }
  }

  const enoughPoints = measurement.points >= (mode === "area" ? 3 : 2);
  const quoteMeasurement = mode && enoughPoints && !measurement.crossed
    ? mapQuoteMeasurement(mode, mode === "area" ? measurement.areaM2 : measurement.lengthM) : null;
  return <div className={styles.tools}>
    <div className={styles.toolbar}>
      <form className={styles.addressSearch} onSubmit={(event) => void findAddress(event)} aria-label="Find any address on the map">
        <label><span>Go to address</span><input disabled={capturing} type="search" value={address} maxLength={300} placeholder="Street address, suburb or postcode" onChange={(event) => setAddress(event.target.value)} /></label>
        <button type="submit" disabled={searching || capturing}>{searching ? "Finding…" : "Find address"}</button>
      </form>
      <label className={styles.view}><span>View</span><select disabled={capturing} value={view} onChange={(event) => { onExplore(); setView(event.target.value); }} aria-label="Map view">{VIEWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {addressMessage && <p className={styles.addressMessage} role="status">{addressMessage}</p>}
    <section className={styles.toolSection} aria-label="Solar designs">
    <h3>Solar designs</h3>
    <TradeMapSolarTools user={user} onRegisterMapSave={onRegisterMapSave} context={locatedAddress ? { title: locatedAddress, customerId: "", workOrderId: "" } : context} linkedDesign={linkedDesign} api={api} map={map} active={solarEditing} disabled={searching || capturing} onCapturing={(value) => { setCapturing(value); drawing.current?.setCapturing(value); }} onQuote={onQuote} onActivate={() => {
      onExplore(); setMode(null); setSolarEditing(true); setView("satellite");
    }} onClose={() => setSolarEditing(false)} />
    </section>
    <section className={styles.toolSection} aria-label="Insulation measurements">
    <div className={styles.measureHeading}><div><h3>Insulation measurements</h3><p>Trace an area in m² or measure a distance, then add it to your quote.</p></div><button type="button" disabled={searching || capturing} aria-pressed={Boolean(mode)} onClick={() => {
      if (mode) setMode(null);
      else { setView("satellite"); startMeasure("area"); }
    }}>Measure area</button></div>
    {mode && <div className={styles.measurement} aria-label="Map measurement">
      <div className={styles.measurementTop}>
        <div className={styles.modes} role="group" aria-label="Measurement type">
          <button type="button" disabled={capturing} aria-pressed={mode === "area"} onClick={() => startMeasure("area")}>Area m²</button>
          <button type="button" disabled={capturing} aria-pressed={mode === "distance"} onClick={() => startMeasure("distance")}>Distance m</button>
        </div>
        <output className={styles.result} aria-live={measurement.previewLengthM !== null ? "off" : "polite"} aria-label="Measurement result">
          {measurement.crossed ? "Outline crosses itself" : enoughPoints || measurement.previewLengthM !== null ? <><strong>{mode === "area" ? `${number(measurement.areaM2)} m²` : formatMapDistance(measurement.previewLengthM ?? measurement.lengthM)}</strong>{mode === "area" && <span>{number(measurement.lengthM)} m perimeter</span>}{measurement.previewLengthM !== null && <span>Live distance</span>}</> : <span>{measurement.points} {measurement.points === 1 ? "point" : "points"} placed</span>}
        </output>
      </div>
      <p>{measurement.crossed ? "Move a corner or undo the last point so the edges do not cross." : measurement.finished ? "Drag the corners or edge handles to refine your measurement." : mode === "area" ? "Click or tap around the edge, then Finish. Use at least 3 corners." : "Click a start point, then move the pointer to see the distance. Click or tap to place each point, then Finish. The total follows your path."}</p>
      <div className={styles.actions}>
        {onQuote && quoteMeasurement && <button type="button" disabled={capturing} className={styles.finish} onClick={() => void addMeasurementToQuote(quoteMeasurement)}>{capturing ? "Capturing…" : "Add to quote"}</button>}
        {measurementCapturing && <button type="button" onClick={() => { capture.current?.abort(); setCapturing(false); setMeasurementCapturing(false); setCaptureMessage("Capture cancelled. Your measurement is still here."); }}>Cancel capture</button>}
        {!measurement.finished && <>
          <button type="button" onClick={() => drawing.current?.addCentre()}>Add centre point</button>
          <button type="button" disabled={!measurement.points} onClick={() => drawing.current?.undo()}>Undo</button>
          <button type="button" className={styles.finish} disabled={!enoughPoints || measurement.crossed || (mode === "area" && measurement.areaM2 <= 0)} onClick={() => drawing.current?.finish()}>Finish</button>
        </>}
        <button type="button" disabled={capturing || !measurement.points} onClick={() => startMeasure(mode)}>Clear</button>
        <button type="button" disabled={capturing} onClick={() => setMode(null)}>Close measure</button>
      </div>
      <p className={styles.note}>Approximate {mode === "area" ? "flat area" : "map distance"} only. Roof pitch, overhangs and image accuracy can affect actual measurements. Add to quote includes this map image.</p>
      {captureMessage && <p className={styles.note} role="status">{captureMessage}</p>}
    </div>}
    </section>
  </div>;
}
