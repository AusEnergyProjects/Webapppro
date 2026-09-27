"use client";

import { useEffect, useRef, useState } from "react";
import { createTradeMapSolarLayout, DEFAULT_SOLAR_PANEL_SIZE, validSolarPanelSize, type SolarLayout } from "@/lib/trade-map-solar";
import { captureTradeMapPng } from "@/lib/trade-map-capture";
import styles from "./TradeMapSolarTools.module.css";

type Props = { api: typeof google.maps; map: google.maps.Map; active: boolean; disabled: boolean; onActivate: () => void; onClose: () => void };

export function TradeMapSolarTools({ api, map, active, disabled, onActivate, onClose }: Props) {
  const controller = useRef<ReturnType<typeof createTradeMapSolarLayout> | null>(null);
  const capture = useRef<AbortController | null>(null);
  const [layout, setLayout] = useState<SolarLayout>({ panels: [], selectedId: null });
  const [width, setWidth] = useState(String(DEFAULT_SOLAR_PANEL_SIZE.widthM));
  const [length, setLength] = useState(String(DEFAULT_SOLAR_PANEL_SIZE.lengthM));
  const [angle, setAngle] = useState("0");
  const [message, setMessage] = useState("");
  const [capturing, setCapturing] = useState(false);
  const selected = layout.panels.find((panel) => panel.id === layout.selectedId);
  useEffect(() => {
    const drawing = createTradeMapSolarLayout(api, map, { panel: styles.panel, face: styles.face, controls: styles.controls, ring: styles.ring, rotate: styles.rotate, copy: styles.copy }, (next) => {
      setLayout(next);
      const panel = next.panels.find((item) => item.id === next.selectedId);
      if (panel) { setWidth(String(panel.widthM)); setLength(String(panel.lengthM)); setAngle(String(Math.round(panel.heading * 10) / 10)); }
    });
    controller.current = drawing;
    return () => { capture.current?.abort(); drawing.dispose(); controller.current = null; };
  }, [api, map]);
  useEffect(() => { controller.current?.setEditing(active); }, [active, api, map]);

  function addPanel() {
    const size = { widthM: Number(width), lengthM: Number(length) };
    if (!validSolarPanelSize(size)) { setMessage("Use a panel width and length between 0.2 and 4 metres."); return; }
    onActivate(); controller.current?.setEditing(true); setMessage("");
    if ((map.getZoom() ?? 0) < 20) map.setZoom(20);
    controller.current?.add(size);
    requestAnimationFrame(() => map.getDiv().scrollIntoView({ block: "center", behavior: "smooth" }));
  }
  function applySize() {
    const size = { widthM: Number(width), lengthM: Number(length) };
    if (!validSolarPanelSize(size) || !Number.isFinite(Number(angle))) { setMessage("Enter valid panel dimensions and an angle."); return; }
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
        {!active && <button type="button" disabled={capturing} onClick={onActivate}>Edit panels</button>}
      </>}
    </div>
    {active && <>
      <div className={styles.settings}>
        <label><span>Width (m)</span><input type="number" min="0.2" max="4" step="0.01" value={width} onChange={(event) => setWidth(event.target.value)} /></label>
        <label><span>Length (m)</span><input type="number" min="0.2" max="4" step="0.01" value={length} onChange={(event) => setLength(event.target.value)} /></label>
        <label><span>Rotation (°)</span><input type="number" step="1" value={angle} onChange={(event) => setAngle(event.target.value)} /></label>
        <button type="button" disabled={!selected || capturing} onClick={applySize}>Apply to panel</button>
        <button type="button" disabled={!selected || capturing} onClick={() => controller.current?.removeSelected()}>Remove panel</button>
        <button type="button" disabled={!layout.panels.length || capturing} onClick={() => controller.current?.clear()}>Clear panels</button>
        <button type="button" disabled={capturing} onClick={onClose}>Done</button>
      </div>
      <p className={styles.hint}>Drag a panel onto the roof. Drag the gold handle around the circle to rotate. The four arrows add a matching panel with a 2 cm gap.</p>
      <p className={styles.hint}>Concept layout only. Set your panel dimensions and confirm roof pitch, obstructions and installation clearances. Layouts are not saved; capture an image before leaving.</p>
    </>}
    {message && <p className={styles.hint} role="status">{message}</p>}
  </div>;
}
