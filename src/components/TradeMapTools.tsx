"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { geocodeTradeMapAddress } from "@/lib/google-maps-client";
import { createTradeMapMeasurement, EMPTY_MAP_MEASUREMENT, type TradeMapMeasureMode } from "@/lib/trade-map-measurement";
import styles from "./TradeMapTools.module.css";

type Props = { api: typeof google.maps; map: google.maps.Map; onExplore: () => void; onMeasuring: (active: boolean) => void };
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

export function TradeMapTools({ api, map, onExplore, onMeasuring }: Props) {
  const [view, setView] = useState("roadmap");
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [addressMessage, setAddressMessage] = useState("");
  const addressRequest = useRef(0);
  const addressPin = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [mode, setMode] = useState<TradeMapMeasureMode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [measurement, setMeasurement] = useState(EMPTY_MAP_MEASUREMENT);
  const drawing = useRef<ReturnType<typeof createTradeMapMeasurement> | null>(null);

  useEffect(() => {
    map.setMapTypeId(view);
    map.setTilt(0);
    map.setHeading(0);
  }, [map, view]);

  useEffect(() => () => {
    addressRequest.current++;
    if (addressPin.current) addressPin.current.map = null;
  }, [map]);

  useEffect(() => {
    onMeasuring(Boolean(mode));
    if (addressPin.current) addressPin.current.map = mode ? null : map;
    if (!mode) return;
    const controller = createTradeMapMeasurement(api, map, mode, setMeasurement);
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
    setSearching(true);
    setAddressMessage("");
    if (addressPin.current) { addressPin.current.map = null; addressPin.current = null; }
    const result = await geocodeTradeMapAddress(new api.Geocoder(), query);
    if (request !== addressRequest.current) return;
    const imageryZoom = result.status === "located" ? await bestImageryZoom(api, result.position) : null;
    if (request !== addressRequest.current) return;
    setSearching(false);
    if (result.status === "located") {
      const badge = document.createElement("div");
      badge.className = styles.addressPin;
      badge.textContent = "+";
      const marker = new api.marker.AdvancedMarkerElement({ map, position: result.position, title: "Searched address" });
      marker.append(badge);
      addressPin.current = marker;
      map.setCenter(result.position);
      map.setZoom(imageryZoom ?? 20);
      setAddressMessage(result.approximate ? "Approximate location. Check the building before measuring." : "Address located. Choose Satellite, then Measure to trace the roof.");
    } else if (result.status === "error") {
      setAddressMessage(result.reason === "quota" ? "Address lookup has reached its limit. Try again later." : "Address lookup is unavailable. Try again shortly.");
    } else {
      setAddressMessage("No Australian address found. Add a street number, suburb and postcode.");
    }
  }

  function startMeasure(nextMode: TradeMapMeasureMode) {
    onExplore();
    setMode(nextMode);
    setMeasurement(EMPTY_MAP_MEASUREMENT);
    setAttempt((value) => value + 1);
  }

  const enoughPoints = measurement.points >= (mode === "area" ? 3 : 2);
  return <div className={styles.tools}>
    <div className={styles.toolbar}>
      <form className={styles.addressSearch} onSubmit={(event) => void findAddress(event)} aria-label="Find any address on the map">
        <label><span>Go to address</span><input type="search" value={address} maxLength={300} placeholder="Street address, suburb or postcode" onChange={(event) => setAddress(event.target.value)} /></label>
        <button type="submit" disabled={searching}>{searching ? "Finding…" : "Find address"}</button>
      </form>
      <label className={styles.view}><span>View</span><select value={view} onChange={(event) => { onExplore(); setView(event.target.value); }} aria-label="Map view">{VIEWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" disabled={searching} aria-pressed={Boolean(mode)} onClick={() => {
        if (mode) setMode(null);
        else { setView("satellite"); startMeasure("area"); }
      }}>Measure</button>
    </div>
    {addressMessage && <p className={styles.addressMessage} role="status">{addressMessage}</p>}
    {mode && <div className={styles.measurement} aria-label="Map measurement">
      <div className={styles.measurementTop}>
        <div className={styles.modes} role="group" aria-label="Measurement type">
          <button type="button" aria-pressed={mode === "area"} onClick={() => startMeasure("area")}>Area m²</button>
          <button type="button" aria-pressed={mode === "distance"} onClick={() => startMeasure("distance")}>Distance m</button>
        </div>
        <output className={styles.result} aria-live="polite" aria-label="Measurement result">
          {measurement.crossed ? "Outline crosses itself" : enoughPoints ? <><strong>{number(mode === "area" ? measurement.areaM2 : measurement.lengthM)} {mode === "area" ? "m²" : "m"}</strong>{mode === "area" && <span>{number(measurement.lengthM)} m perimeter</span>}</> : <span>{measurement.points} {measurement.points === 1 ? "point" : "points"} placed</span>}
        </output>
      </div>
      <p>{measurement.crossed ? "Move a corner or undo the last point so the edges do not cross." : measurement.finished ? "Drag the corners or edge handles to refine your measurement." : mode === "area" ? "Click or tap around the edge, then Finish. Use at least 3 corners." : "Click or tap along the distance, then Finish. Use at least 2 points."}</p>
      <div className={styles.actions}>
        {!measurement.finished && <>
          <button type="button" onClick={() => drawing.current?.addCentre()}>Add centre point</button>
          <button type="button" disabled={!measurement.points} onClick={() => drawing.current?.undo()}>Undo</button>
          <button type="button" className={styles.finish} disabled={!enoughPoints || measurement.crossed || (mode === "area" && measurement.areaM2 <= 0)} onClick={() => drawing.current?.finish()}>Finish</button>
        </>}
        <button type="button" disabled={!measurement.points} onClick={() => startMeasure(mode)}>Clear</button>
        <button type="button" onClick={() => setMode(null)}>Close measure</button>
      </div>
      <p className={styles.note}>Approximate {mode === "area" ? "flat area" : "map distance"} only. Roof pitch, overhangs and image accuracy can affect actual measurements. Not saved.</p>
    </div>}
  </div>;
}
