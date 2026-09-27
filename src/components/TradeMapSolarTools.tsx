"use client";

import { useEffect, useRef, useState } from "react";
import { createTradeMapSolarLayout, DEFAULT_SOLAR_PANEL_SIZE, DEFAULT_SOLAR_PANEL_TILT, validSolarPanelSize, validSolarPanelTilt, type SolarLayout } from "@/lib/trade-map-solar";
import { captureTradeMapPng } from "@/lib/trade-map-capture";
import styles from "./TradeMapSolarTools.module.css";
import type { MapQuoteMeasurement } from "@/lib/trade-map-quote";

type Props = { api: typeof google.maps; map: google.maps.Map; active: boolean; disabled: boolean; onActivate: () => void; onClose: () => void; onQuote?: (measurement: MapQuoteMeasurement) => void };

export function TradeMapSolarTools({ api, map, active, disabled, onActivate, onClose, onQuote }: Props) {
  const controller = useRef<ReturnType<typeof createTradeMapSolarLayout> | null>(null);
  const capture = useRef<AbortController | null>(null);
  const [layout, setLayout] = useState<SolarLayout>({ panels: [], selectedId: null, selectionMode: "one", selectedIds: [] });
  const [width, setWidth] = useState(String(DEFAULT_SOLAR_PANEL_SIZE.widthM));
  const [length, setLength] = useState(String(DEFAULT_SOLAR_PANEL_SIZE.lengthM));
  const [angle, setAngle] = useState("0");
  const [lengthTilt, setLengthTilt] = useState(String(DEFAULT_SOLAR_PANEL_TILT.lengthTilt));
  const [widthTilt, setWidthTilt] = useState(String(DEFAULT_SOLAR_PANEL_TILT.widthTilt));
  const [message, setMessage] = useState("");
  const [capturing, setCapturing] = useState(false);
  const selected = layout.panels.find((panel) => panel.id === layout.selectedId);
  const groupSelection = layout.selectionMode !== "one";
  const choosing = layout.selectionMode === "choose";
  useEffect(() => {
    const drawing = createTradeMapSolarLayout(api, map, { panel: styles.panel, face: styles.face, controls: styles.controls, ring: styles.ring, rotate: styles.rotate, copy: styles.copy, group: styles.group, move: styles.move, selectionBox: styles.selectionBox }, (next) => {
      setLayout(next);
      const panel = next.panels.find((item) => item.id === next.selectedId);
      if (panel) {
        setWidth(String(panel.widthM)); setLength(String(panel.lengthM)); setAngle(String(Math.round(panel.heading * 10) / 10));
        setLengthTilt(String(panel.lengthTilt)); setWidthTilt(String(panel.widthTilt));
      }
    });
    controller.current = drawing;
    return () => { capture.current?.abort(); drawing.dispose(); controller.current = null; };
  }, [api, map]);
  useEffect(() => { controller.current?.setEditing(active); }, [active, api, map]);

  function addPanel() {
    const size = { widthM: Number(width), lengthM: Number(length), lengthTilt: lengthTilt.trim() ? Number(lengthTilt) : NaN, widthTilt: widthTilt.trim() ? Number(widthTilt) : NaN };
    if (!validSolarPanelSize(size)) { setMessage("Use a panel width and length between 0.2 and 4 metres."); return; }
    if (!validSolarPanelTilt(size)) { setMessage("Use a length and width tilt between 0° and 85°."); return; }
    onActivate(); controller.current?.setEditing(true); setMessage("");
    if ((map.getZoom() ?? 0) < 20) map.setZoom(20);
    controller.current?.add(size);
    requestAnimationFrame(() => map.getDiv().scrollIntoView({ block: "center", behavior: "smooth" }));
  }
  function applySize() {
    const size = { widthM: Number(width), lengthM: Number(length), lengthTilt: lengthTilt.trim() ? Number(lengthTilt) : NaN, widthTilt: widthTilt.trim() ? Number(widthTilt) : NaN };
    if (!validSolarPanelSize(size) || !angle.trim() || !Number.isFinite(Number(angle))) { setMessage("Enter valid panel dimensions and a rotation."); return; }
    if (!validSolarPanelTilt(size)) { setMessage("Use a length and width tilt between 0° and 85°."); return; }
    controller.current?.updateSelected({ ...size, heading: Number(angle) }); setMessage("");
  }
  async function captureImage() {
    if (capture.current) return;
    const attempt = new AbortController(); capture.current = attempt;
    setCapturing(true); setMessage("Choose this TLink tab in the browser's sharing prompt. Only the map will be saved.");
    try {
      await captureTradeMapPng(map.getDiv(), layout.panels.length, () => controller.current?.setCapturing(true), () => controller.current?.setCapturing(false), attempt.signal);
      if (!attempt.signal.aborted) setMessage("PNG download started. The image includes the map attribution and your panel layout.");
    } catch (error) {
      if (!attempt.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not capture the map. Try again.");
    } finally { if (!attempt.signal.aborted) setCapturing(false); capture.current = null; }
  }
  return <div className={styles.solar} aria-label="Solar panel layout">
    <div className={styles.toolbar}>
      <button type="button" disabled={disabled || capturing} onClick={addPanel}>Add solar panel</button>
      <button type="button" disabled={disabled || capturing} onClick={() => void captureImage()}>{capturing ? "Capturing…" : "Capture image"}</button>
      {capturing && <button type="button" onClick={() => { capture.current?.abort(); setCapturing(false); setMessage("Capture cancelled."); }}>Cancel capture</button>}
      {layout.panels.length > 0 && <><span className={styles.count}>{layout.panels.length} {layout.panels.length === 1 ? "panel" : "panels"}</span>
        {onQuote && <button type="button" disabled={capturing} onClick={() => onQuote({ kind: "solar", quantity: layout.panels.length })}>Add to quote</button>}
        {!active && <button type="button" disabled={capturing} onClick={onActivate}>Edit panels</button>}
      </>}
    </div>
    {active && <>
      <div className={styles.scope} role="group" aria-label="Move and rotate">
        <span>Move &amp; rotate</span>
        <button type="button" aria-pressed={layout.selectionMode === "one"} disabled={capturing || !layout.panels.length} onClick={() => controller.current?.setSelectionMode("one")}>One panel</button>
        <button type="button" aria-pressed={layout.selectionMode === "all"} disabled={capturing || !layout.panels.length} onClick={() => controller.current?.setSelectionMode("all")}>All panels</button>
        <button type="button" aria-pressed={layout.selectionMode === "choose" || layout.selectionMode === "selection"} disabled={capturing || !layout.panels.length} onClick={() => controller.current?.setSelectionMode("choose")}>Choose panels</button>
      </div>
      <div className={styles.settings}>
        {groupSelection ? <>
          <span className={styles.count} role="status">{layout.selectedIds.length} of {layout.panels.length} panels selected</span>
          {choosing ? <button type="button" disabled={capturing || !layout.selectedIds.length} onClick={() => controller.current?.setSelectionMode("selection")}>Move/rotate selection</button> : <>
          <button type="button" disabled={capturing || !layout.selectedIds.length} aria-label="Rotate selected panels left by 1 degree" onClick={() => controller.current?.rotateSelection(-1)}>↶ 1°</button>
          <button type="button" disabled={capturing || !layout.selectedIds.length} aria-label="Rotate selected panels right by 1 degree" onClick={() => controller.current?.rotateSelection(1)}>↷ 1°</button>
          </>}
        </> : <>
        <label><span>Width (m)</span><input type="number" min="0.2" max="4" step="0.01" value={width} onChange={(event) => setWidth(event.target.value)} /></label>
        <label><span>Length (m)</span><input type="number" min="0.2" max="4" step="0.01" value={length} onChange={(event) => setLength(event.target.value)} /></label>
        <label><span>Rotation (°)</span><input type="number" step="1" value={angle} onChange={(event) => setAngle(event.target.value)} /></label>
        <label><span>Length tilt (°)</span><input type="number" min="0" max="85" step="0.5" value={lengthTilt} onChange={(event) => setLengthTilt(event.target.value)} /></label>
        <label><span>Width tilt (°)</span><input type="number" min="0" max="85" step="0.5" value={widthTilt} onChange={(event) => setWidthTilt(event.target.value)} /></label>
        <button type="button" disabled={!selected || capturing} onClick={applySize}>Apply to panel</button>
        <button type="button" disabled={!selected || capturing} onClick={() => controller.current?.removeSelected()}>Remove panel</button>
        </>}
        <button type="button" disabled={!layout.panels.length || capturing} onClick={() => controller.current?.clear()}>Clear panels</button>
        <button type="button" disabled={capturing} onClick={onClose}>Done</button>
      </div>
      <p className={styles.hint}>{choosing
        ? "Drag a box over the panels to select their centres. Tap panels to add or remove them, then choose Move/rotate selection. Keyboard: Tab to a panel and press Enter or Space."
        : groupSelection ? "Drag a selected panel or the centre handle to move the selection. Drag the gold handle to rotate it around its centre. Other panels stay in place."
        : "Drag a panel onto the roof. Drag the gold handle around the circle to rotate. The four arrows add a matching panel with a 2 cm gap."}</p>
      {!groupSelection && <p className={styles.hint}>Tilt shortens the overhead footprint. For a sideways 30° pitch, set length tilt to 0° and width tilt to 30°. The starting 22.5° pitch is an assumption; match it to the roof.</p>}
      <p className={styles.hint}>Concept layout only. Width and length are the physical panel dimensions. Confirm roof pitch, obstructions and installation clearances. Layouts are not saved; capture an image before leaving.</p>
    </>}
    {message && <p className={styles.hint} role="status">{message}</p>}
  </div>;
}
