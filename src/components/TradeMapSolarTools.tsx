"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { createTradeMapSolarLayout, DEFAULT_SOLAR_PANEL_TILT, validSolarPanelSize, validSolarPanelTilt, type SolarLayout } from "@/lib/trade-map-solar";
import { captureTradeMapPng, captureTradeMapQuoteImage } from "@/lib/trade-map-capture";
import { solarEquipmentSummary, DEFAULT_SOLAR_EQUIPMENT, SOLAR_STARTER_PANELS, SOLAR_EQUIPMENT_LABELS, type SolarEquipmentItem, type SolarEquipmentKind } from "@/lib/trade-solar-equipment";
import { openSolarCrewSheet, reserveSolarCrewSheetWindow } from "@/lib/trade-solar-crew-sheet";
import { TradeSolarEquipmentPicker } from "./TradeSolarEquipmentPicker";
import { solarDesignRequest, useTradeSolarDesign } from "./useTradeSolarDesign";
import type { SolarDesign, SolarDesignSummary } from "@/lib/trade-solar-design";
import styles from "./TradeMapSolarTools.module.css";
import type { MapQuoteMeasurement } from "@/lib/trade-map-quote";

export type SolarMapContext = { title: string; customerId: string; workOrderId: string };
type Props = { user: User; onRegisterMapSave?: (save: (() => Promise<unknown>) | null) => void; context?: SolarMapContext; linkedDesign?: SolarDesign | null; api: typeof google.maps; map: google.maps.Map; active: boolean; disabled: boolean; onActivate: () => void; onClose: () => void; onCapturing: (active: boolean) => void; onQuote?: (measurement: MapQuoteMeasurement) => void };
const EMPTY_LAYOUT: SolarLayout = { panels: [], selectedId: null, selectionMode: "one", selectedIds: [] };

export function TradeMapSolarTools({ user, onRegisterMapSave, context, linkedDesign, api, map, active, disabled, onActivate, onClose, onCapturing, onQuote }: Props) {
  const controller = useRef<ReturnType<typeof createTradeMapSolarLayout> | null>(null);
  const capture = useRef<AbortController | null>(null);
  const [layout, setLayout] = useState<SolarLayout>(EMPTY_LAYOUT);
  const [width, setWidth] = useState(String(DEFAULT_SOLAR_EQUIPMENT.widthM));
  const [length, setLength] = useState(String(DEFAULT_SOLAR_EQUIPMENT.lengthM));
  const [watts, setWatts] = useState(String(DEFAULT_SOLAR_EQUIPMENT.watts));
  const [angle, setAngle] = useState("0");
  const [lengthTilt, setLengthTilt] = useState(String(DEFAULT_SOLAR_PANEL_TILT.lengthTilt));
  const [widthTilt, setWidthTilt] = useState(String(DEFAULT_SOLAR_PANEL_TILT.widthTilt));
  const [message, setMessage] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [title, setTitle] = useState("");
  const [links, setLinks] = useState({ customerId: "", workOrderId: "" });
  const [acceptedLink, setAcceptedLink] = useState<SolarDesign | null>(null);
  const [notes, setNotes] = useState("");
  const [equipment, setEquipment] = useState<SolarEquipmentItem[]>([]);
  const [panelModel, setPanelModel] = useState<SolarEquipmentItem | null>(DEFAULT_SOLAR_EQUIPMENT);
  const [priceBookPanels, setPriceBookPanels] = useState<SolarEquipmentItem[]>([]);
  const [equipmentKind, setEquipmentKind] = useState<SolarEquipmentKind>("panel");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedDesigns, setSavedDesigns] = useState<SolarDesignSummary[]>([]);
  const [savedSearch, setSavedSearch] = useState("");
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedHasMore, setSavedHasMore] = useState(false);
  const [savedOffset, setSavedOffset] = useState(0);
  const persistence = useTradeSolarDesign(user, Boolean(onQuote));
  const { update, accept, ensureSaved } = persistence;
  useEffect(() => { onRegisterMapSave?.(ensureSaved); return () => onRegisterMapSave?.(null); }, [onRegisterMapSave, ensureSaved]);
  const selected = layout.panels.find((panel) => panel.id === layout.selectedId);
  const groupSelection = layout.selectionMode !== "one";
  const choosing = layout.selectionMode === "choose";
  const summary = useMemo(() => solarEquipmentSummary(layout.panels), [layout.panels]);
  const panelOptions = useMemo(() => [DEFAULT_SOLAR_EQUIPMENT, ...priceBookPanels.filter((item) => item.kind === "panel"), ...SOLAR_STARTER_PANELS.filter((item) => !priceBookPanels.some((savedPanel) => savedPanel.id === item.id))], [priceBookPanels]);
  const busy = disabled || capturing || savedLoading;

  useEffect(() => {
    const drawing = createTradeMapSolarLayout(api, map, { panel: styles.panel, face: styles.face, controls: styles.controls, ring: styles.ring, rotate: styles.rotate, copy: styles.copy, group: styles.group, move: styles.move, selectionBox: styles.selectionBox }, (next) => {
      setLayout(next);
      const panel = next.panels.find((item) => item.id === next.selectedId);
      if (panel) {
        setWidth(String(panel.widthM)); setLength(String(panel.lengthM)); setAngle(String(Math.round(panel.heading * 10) / 10));
        setLengthTilt(String(panel.lengthTilt)); setWidthTilt(String(panel.widthTilt));
        setPanelModel(panel.equipment ?? null);
        setWatts(String(panel.equipment?.watts ?? DEFAULT_SOLAR_EQUIPMENT.watts));
      }
    });
    controller.current = drawing;
    return () => { capture.current?.abort(); drawing.dispose(); controller.current = null; };
  }, [api, map]);
  useEffect(() => { controller.current?.setEditing(active && !busy); }, [active, busy, api, map]);
  useEffect(() => {
    if (!onQuote) return;
    let live = true;
    void (async () => {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-price-book?mode=solar_panels", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result: { ok?: boolean; solarPanels?: SolarEquipmentItem[] } = await response.json();
      if (!response.ok || !result.ok) throw new Error("Your price-list panels could not load. Reopen the map to try again.");
      if (live) setPriceBookPanels(result.solarPanels ?? []);
    })().catch((error: unknown) => { if (live) setMessage(error instanceof Error ? error.message : "Your price-list panels could not load."); });
    return () => { live = false; };
  }, [user, onQuote]);

  const restoreDesign = useCallback((design: SolarDesign) => {
    accept(design); setTitle(design.title); setLinks({ customerId: design.customerId, workOrderId: design.workOrderId });
    setEquipment(design.equipment); setNotes(design.installationNotes); setPanelModel(design.panels[0]?.equipment ?? null);
    controller.current?.restore(design.panels); map.setCenter(design.center); map.setZoom(design.zoom);
  }, [accept, map]);
  // Quote attachment changes the saved identity and links, not the open geometry.
  if (linkedDesign && linkedDesign !== acceptedLink) {
    setAcceptedLink(linkedDesign); accept(linkedDesign);
    setLinks({ customerId: linkedDesign.customerId, workOrderId: linkedDesign.workOrderId });
  }
  useEffect(() => {
    if (!layout.panels.length && !persistence.design) return;
    const center = map.getCenter()?.toJSON();
    if (!center) return;
    update({ title: title.trim() || context?.title.slice(0, 180) || "Roof design", panels: layout.panels, equipment,
      installationNotes: notes, center, zoom: map.getZoom() ?? 20, ...links });
  }, [layout.panels, equipment, title, notes, links, context?.title, map, update, persistence.design]);

  function choosePanel(item: SolarEquipmentItem) {
    setPanelModel(item); setWidth(String(item.widthM)); setLength(String(item.lengthM)); setWatts(String(item.watts));
    controller.current?.applyEquipment(item); setPickerOpen(false); setMessage("");
  }
  function addPanel() {
    const size = { widthM: Number(width), lengthM: Number(length), lengthTilt: lengthTilt.trim() ? Number(lengthTilt) : NaN, widthTilt: widthTilt.trim() ? Number(widthTilt) : NaN,
      equipment: modelForInputs() };
    if (!size.equipment) { setMessage("Enter panel power between 1 and 2,000 watts."); return; }
    if (!validSolarPanelSize(size)) { setMessage("Use a panel width and length between 0.2 and 4 metres."); return; }
    if (!validSolarPanelTilt(size)) { setMessage("Use a length and width tilt between 0° and 85°."); return; }
    if (layout.panels.length >= 500) { setMessage("This design has reached 500 panels. Start another design for the next roof."); return; }
    if (!layout.panels.length && !persistence.design) {
      setTitle(context?.title.slice(0, 180) || `Roof design ${new Date().toLocaleDateString("en-AU")}`);
      setLinks({ customerId: context?.customerId ?? "", workOrderId: context?.workOrderId ?? "" });
    }
    onActivate(); controller.current?.setEditing(true); setMessage("");
    if ((map.getZoom() ?? 0) < 20) map.setZoom(20);
    controller.current?.add(size);
    requestAnimationFrame(() => map.getDiv().scrollIntoView({ block: "center", behavior: "smooth" }));
  }
  function applySize() {
    const size = { widthM: Number(width), lengthM: Number(length), lengthTilt: lengthTilt.trim() ? Number(lengthTilt) : NaN, widthTilt: widthTilt.trim() ? Number(widthTilt) : NaN };
    if (!validSolarPanelSize(size) || !angle.trim() || !Number.isFinite(Number(angle))) { setMessage("Enter valid panel dimensions and a rotation."); return; }
    if (!validSolarPanelTilt(size)) { setMessage("Use a length and width tilt between 0° and 85°."); return; }
    const model = modelForInputs();
    if (!model) { setMessage("Enter panel power between 1 and 2,000 watts."); return; }
    controller.current?.updateSelected({ ...size, equipment: model, heading: Number(angle) }); setMessage("");
  }
  function modelForInputs(): SolarEquipmentItem | undefined {
    const power = Number(watts);
    if (!watts.trim() || !Number.isFinite(power) || power < 1 || power > 2000) return undefined;
    if (panelModel && panelModel.widthM === Number(width) && panelModel.lengthM === Number(length) && panelModel.watts === power) return panelModel;
    return { ...DEFAULT_SOLAR_EQUIPMENT, name: `Generic ${power} W panel`, model: `Generic ${power} W panel`, watts: power, widthM: Number(width), lengthM: Number(length) };
  }
  async function showSaved(search = savedSearch, offset = 0) {
    setSavedOpen(true); setSavedLoading(true); setMessage("");
    try {
      const result = await solarDesignRequest(user, `?search=${encodeURIComponent(search.trim())}&offset=${offset}`);
      setSavedDesigns((previous) => offset ? [...previous, ...(result.designs ?? [])].filter((item, index, items) => items.findIndex((other) => other.id === item.id) === index) : result.designs ?? []);
      setSavedOffset(offset); setSavedHasMore(Boolean(result.hasMore));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load saved designs."); }
    finally { setSavedLoading(false); }
  }
  async function openDesign(id: string) {
    setSavedLoading(true); setMessage("");
    try {
      await ensureSaved();
      const result = await solarDesignRequest(user, `?id=${encodeURIComponent(id)}`);
      if (!result.design) throw new Error("This saved design is unavailable.");
      restoreDesign(result.design); onActivate(); setSavedOpen(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not open this design."); }
    finally { setSavedLoading(false); }
  }
  async function newDesign() {
    setSavedLoading(true);
    try {
      await ensureSaved(); accept(null); setTitle(""); setLinks({ customerId: "", workOrderId: "" }); setNotes(""); setEquipment([]);
      controller.current?.restore([]); setSavedOpen(false); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save this design before starting another."); }
    finally { setSavedLoading(false); }
  }
  async function captureImage(action: "image" | "quote" | "crew" = "image") {
    if (capture.current) return;
    const crewWindow = action === "crew" ? reserveSolarCrewSheetWindow() : null;
    if (action === "crew" && !crewWindow) { setMessage("Allow the crew sheet window, then try again."); return; }
    const attempt = new AbortController(); capture.current = attempt;
    setCapturing(true); onCapturing(true); setMessage("Choose this TLink tab in the sharing prompt to include your roof image.");
    try {
      const savedDesign = onQuote ? await ensureSaved() : null;
      if (attempt.signal.aborted) return;
      const prepare = () => controller.current?.setCapturing(true), restore = () => controller.current?.setCapturing(false);
      if (action !== "image") {
        const measurement: MapQuoteMeasurement = { kind: "solar", quantity: layout.panels.length,
          equipment: [...summary.models, ...equipment.filter((item) => item.kind !== "panel")],
          ...(savedDesign ? { designId: savedDesign.id, designRevision: savedDesign.revision, workOrderId: savedDesign.workOrderId } : {}) };
        const roofImage = await captureTradeMapQuoteImage(map.getDiv(), measurement, prepare, restore, attempt.signal);
        if (!attempt.signal.aborted) {
          setMessage("");
          if (action === "quote") onQuote?.({ ...measurement, roofImage });
          else if (crewWindow) openSolarCrewSheet({ title: title || "Roof design", imageDataUrl: roofImage.dataUrl, panels: layout.panels, equipment, installationNotes: notes }, crewWindow);
        }
      } else {
        await captureTradeMapPng(map.getDiv(), layout.panels.length, prepare, restore, attempt.signal);
        if (!attempt.signal.aborted) setMessage("PNG download started. Your map attribution and panel layout are included.");
      }
    } catch (error) {
      crewWindow?.close();
      if (!attempt.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not capture the map. Try again.");
    } finally { if (attempt.signal.aborted) crewWindow?.close(); if (!attempt.signal.aborted) setCapturing(false); onCapturing(false); capture.current = null; }
  }
  return <div className={styles.solar} aria-label="Solar panel layout">
    <div className={styles.toolbar}>
      <button type="button" disabled={busy} onClick={addPanel}>Add solar panel</button>
      <label className={styles.model}><span>Panel model</span><select disabled={busy} value={panelModel?.id ?? ""} onChange={(event) => {
        if (event.target.value === "custom") { setEquipmentKind("panel"); setPickerOpen(true); return; }
        const item = panelOptions.find((option) => option.id === event.target.value); if (item) choosePanel(item);
      }}><option value="">Choose model for kW</option>{panelModel && !panelOptions.some((item) => item.id === panelModel.id) && <option value={panelModel.id}>{panelModel.name}</option>}{panelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="custom">Other model…</option></select></label>
      {layout.panels.length > 0 && <><output className={styles.count}>{layout.panels.length} {layout.panels.length === 1 ? "panel" : "panels"}{summary.systemKw !== null ? ` · ${summary.systemKw} kW` : ""}</output>
        {onQuote && <button className={styles.primary} type="button" disabled={busy} onClick={() => void captureImage("quote")}>Add to quote</button>}
        {!active && <button type="button" disabled={busy} onClick={onActivate}>Edit panels</button>}
      </>}
      {onQuote && <button type="button" disabled={busy} aria-expanded={savedOpen} onClick={() => { if (savedOpen) setSavedOpen(false); else void showSaved(); }}>Saved designs</button>}
      {persistence.status && <span className={styles.saveStatus} role="status">{persistence.status}</span>}
      {capturing && <button type="button" onClick={() => { capture.current?.abort(); setCapturing(false); onCapturing(false); setMessage("Capture cancelled. Your design is still here."); }}>Cancel capture</button>}
    </div>
    {persistence.error && <div className={styles.error} role="alert"><span>{persistence.error}</span><button type="button" disabled={busy} onClick={() => void ensureSaved().catch(() => {})}>Retry save</button><button type="button" disabled={busy} onClick={() => void persistence.saveCopy().then((value) => { if (value) restoreDesign(value); }).catch(() => {})}>Save a copy</button></div>}
    {savedOpen && <div className={styles.saved}>
      <form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); void showSaved(); }}><input type="search" aria-label="Find saved design" placeholder="Find a saved roof design" value={savedSearch} maxLength={100} onChange={(event) => setSavedSearch(event.target.value)} /><button disabled={savedLoading} type="submit">Find</button><button type="button" disabled={busy} onClick={() => void newDesign()}>New design</button></form>
      {savedLoading ? <p>Loading designs…</p> : savedDesigns.length ? <div className={styles.savedList}>{savedDesigns.map((item) => <button type="button" key={item.id} onClick={() => void openDesign(item.id)}><strong>{item.title}</strong><span>{item.panelCount} panels · {new Date(item.updatedAt).toLocaleDateString("en-AU")}</span></button>)}</div> : <p>No saved designs found. Your first panel layout saves automatically.</p>}
      {savedHasMore && <button type="button" disabled={savedLoading} onClick={() => void showSaved(savedSearch, savedOffset + 50)}>Show more designs</button>}
    </div>}
    {pickerOpen && <div className={styles.equipment}><div className={styles.toolbar}><strong>{SOLAR_EQUIPMENT_LABELS[equipmentKind]}</strong><button type="button" onClick={() => setPickerOpen(false)}>Close equipment</button></div><TradeSolarEquipmentPicker user={user} kind={equipmentKind} priceBookPanels={priceBookPanels} selected={equipmentKind === "panel" ? panelModel : equipment.find((item) => item.kind === equipmentKind)} onSelect={(item) => {
      if (item.kind === "panel") choosePanel(item); else { setEquipment((previous) => [...previous.filter((old) => old.kind !== item.kind), item]); setPickerOpen(false); }
    }} /></div>}
    {active && <>
      <div className={styles.scope} role="group" aria-label="Move and rotate">
        <span>Move &amp; rotate</span>
        <button type="button" aria-pressed={layout.selectionMode === "one"} disabled={busy || !layout.panels.length} onClick={() => controller.current?.setSelectionMode("one")}>One panel</button>
        <button type="button" aria-pressed={layout.selectionMode === "all"} disabled={busy || !layout.panels.length} onClick={() => controller.current?.setSelectionMode("all")}>All panels</button>
        <button type="button" aria-pressed={choosing || layout.selectionMode === "selection"} disabled={busy || !layout.panels.length} onClick={() => controller.current?.setSelectionMode("choose")}>Choose panels</button>
        {choosing && <button type="button" disabled={busy || !layout.selectedIds.length} onClick={() => controller.current?.setSelectionMode("selection")}>Move/rotate selection</button>}
        <button type="button" disabled={busy} onClick={onClose}>Done</button>
      </div>
      <p className={styles.hint}>{choosing ? "Drag a box around the panels you want. Tap any panel to add or remove it." : groupSelection ? `${layout.selectedIds.length} panels selected. Drag to move together, or use the gold handle to rotate.` : "Drag a panel into place. Turn the gold handle to rotate. Tap an arrow to add another panel."}</p>
      <details className={styles.details}><summary>Panel size &amp; tilt</summary><div className={styles.settings}>
        {groupSelection ? <><span>{layout.selectedIds.length} selected</span><button type="button" disabled={busy || choosing || !layout.selectedIds.length} onClick={() => controller.current?.rotateSelection(-1)}>↶ 1°</button><button type="button" disabled={busy || choosing || !layout.selectedIds.length} onClick={() => controller.current?.rotateSelection(1)}>↷ 1°</button></> : <>
          <label><span>Power (W)</span><input disabled={busy} type="number" min="1" max="2000" step="1" value={watts} onChange={(event) => setWatts(event.target.value)} /></label>
          <label><span>Width (m)</span><input disabled={busy} type="number" min="0.2" max="4" step="0.001" value={width} onChange={(event) => setWidth(event.target.value)} /></label>
          <label><span>Length (m)</span><input disabled={busy} type="number" min="0.2" max="4" step="0.001" value={length} onChange={(event) => setLength(event.target.value)} /></label>
          <label><span>Rotation (°)</span><input disabled={busy} type="number" step="1" value={angle} onChange={(event) => setAngle(event.target.value)} /></label>
          <label><span>Length tilt (°)</span><input disabled={busy} type="number" min="0" max="85" step="0.5" value={lengthTilt} onChange={(event) => setLengthTilt(event.target.value)} /></label>
          <label><span>Width tilt (°)</span><input disabled={busy} type="number" min="0" max="85" step="0.5" value={widthTilt} onChange={(event) => setWidthTilt(event.target.value)} /></label>
          <button type="button" disabled={!selected || busy} onClick={applySize}>Apply to panel</button><button type="button" disabled={!selected || busy} onClick={() => controller.current?.removeSelected()}>Remove panel</button>
        </>}
      </div><p className={styles.hint}>Generic panels are estimates. The starting 22.5° pitch is an assumption. Changing a named model’s dimensions or watts switches it to a generic panel.</p></details>
    </>}
    {layout.panels.length > 0 && <details className={styles.details}><summary>Equipment, notes &amp; exports</summary>
      <div className={styles.designFields}><label>Design name<input disabled={busy} value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} /></label><label>Installation notes<textarea disabled={busy} rows={2} maxLength={5000} value={notes} placeholder="Access, roof sections or instructions for the crew" onChange={(event) => setNotes(event.target.value)} /></label></div>
      <div className={styles.toolbar}>{(["inverter", "battery", "hot_water"] as const).map((kind) => <button type="button" disabled={busy} key={kind} onClick={() => { setEquipmentKind(kind); setPickerOpen(true); }}>{equipment.some((item) => item.kind === kind) ? "Change" : "Add"} {SOLAR_EQUIPMENT_LABELS[kind].toLowerCase()}</button>)}</div>
      {equipment.filter((item) => item.kind !== "panel").map((item) => <div className={styles.equipmentRow} key={item.id}><span>{item.quantity} × {item.name}</span><button type="button" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => setEquipment((previous) => previous.filter((old) => old.id !== item.id))}>Remove</button></div>)}
      <div className={styles.toolbar}><button type="button" disabled={busy} onClick={() => void captureImage()}>Capture image</button><button type="button" disabled={busy} onClick={() => void captureImage("crew")}>Crew sheet</button>{onQuote && <button type="button" disabled={busy} onClick={() => void newDesign()}>New design</button>}</div>
      <p className={styles.hint}>Concept layout. Confirm pitch, obstructions and clearances on site. Equipment specs and links are saved with the design.</p>
    </details>}
    {message && <p className={styles.hint} role="status">{message}</p>}
  </div>;
}
