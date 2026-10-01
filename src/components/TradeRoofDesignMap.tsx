"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import dynamic from "next/dynamic";
import { GoogleMapsClientError, loadGoogleMaps, onGoogleMapsAuthFailure } from "@/lib/google-maps-client";
import { TradeMapTools } from "./TradeMapTools";
import type { SolarMapContext } from "./TradeMapSolarTools";
import type { SolarDesign } from "@/lib/trade-solar-design";
import type { MapQuoteMeasurement } from "@/lib/trade-map-quote";
import styles from "./TradeRecordMap.module.css";

const TradeMapQuoteDialog = dynamic(() => import("./TradeMapQuoteDialog").then(module => module.TradeMapQuoteDialog));

type WorkspaceProps = { user: User; onRegisterMapSave?: (save: (() => Promise<unknown>) | null) => void; onOpenMap: () => void };

/** The explicit tool entry opens without loading the customer-location map. */
export function TradeDesignWorkspace(props: WorkspaceProps) {
  const businessOwnerUid = useTradeBusiness()?.ownerUid || props.user.uid;
  return <TradeDesignWorkspaceView key={`${props.user.uid}:${businessOwnerUid}`} {...props} />;
}

function TradeDesignWorkspaceView({ user, onRegisterMapSave, onOpenMap }: WorkspaceProps) {
  const [measurement, setMeasurement] = useState<MapQuoteMeasurement | null>(null);
  const [linkedDesign, setLinkedDesign] = useState<SolarDesign | null>(null);
  // Mounted by the verified owner dashboard only, with the same quote rights
  // as its existing CRM map. Team views retain their own permission checks.
  return <section className="dashboard-panel">
    <TradeRoofDesignMap user={user} linkedDesign={linkedDesign} onRegisterMapSave={onRegisterMapSave} onQuote={setMeasurement} onClose={onOpenMap} closeLabel="Jobs & customer map" />
    {measurement && <TradeMapQuoteDialog user={user} measurement={measurement} access={{ canCreate: true, canCreateCustomer: true, canSend: true }} onDesignLinked={setLinkedDesign} onClose={() => setMeasurement(null)} />}
  </section>;
}

type Props = {
  user: User;
  context?: SolarMapContext;
  position?: { lat: number; lng: number };
  linkedDesign: SolarDesign | null;
  onRegisterMapSave?: (save: (() => Promise<unknown>) | null) => void;
  onQuote?: (measurement: MapQuoteMeasurement) => void;
  onClose: () => void;
  closeLabel?: string;
};
type Runtime = { api: typeof google.maps; map: google.maps.Map };
function configured(value: unknown): value is { ok: true; configured: true; apiKey: string; mapId: string } {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true
    && "configured" in value && value.configured === true && "apiKey" in value && typeof value.apiKey === "string" && value.apiKey.trim().length > 0
    && "mapId" in value && typeof value.mapId === "string" && value.mapId.trim().length > 0 && value.mapId !== "DEMO_MAP_ID";
}

/** Mounted only after an explicit request for the existing satellite/design tools. */
export function TradeRoofDesignMap({ user, context, position, linkedDesign, onRegisterMapSave, onQuote, onClose, closeLabel = "Back to customer map" }: Props) {
  const fetch = useTradeBusinessFetch();
  const canvasRef = useRef<HTMLDivElement>(null);
  const initialPosition = useRef(position);
  const saveRef = useRef<(() => Promise<unknown>) | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [message, setMessage] = useState("Loading satellite and design tools...");
  const [attempt, setAttempt] = useState(0);
  const [closing, setClosing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const registerSave = useCallback((save: (() => Promise<unknown>) | null) => {
    saveRef.current = save;
    onRegisterMapSave?.(save);
  }, [onRegisterMapSave]);
  const unchanged = useCallback(() => {}, []);

  useEffect(() => {
    const controller = new AbortController();
    const canvas = canvasRef.current;
    let created: Runtime | null = null;
    const removeAuthListener = onGoogleMapsAuthFailure(() => {
      if (!controller.signal.aborted) { setRuntime(null); setMessage("The satellite connection could not authorise this site. Your customer map is still available."); }
    });
    void (async () => {
      setRuntime(null); setMessage("Loading satellite and design tools...");
      const response = await fetch("/api/trade-map/config?provider=design", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("The satellite tools could not be loaded. Refresh your session and try again.");
      const config: unknown = await response.json();
      if (!configured(config)) throw new Error("Satellite design tools are not connected yet. Your customer map is still available.");
      const api = await loadGoogleMaps(config.apiKey);
      if (controller.signal.aborted || !canvas) return;
      const map = new api.Map(canvas, {
        mapId: config.mapId, center: initialPosition.current ?? { lat: -25.5, lng: 134 }, zoom: initialPosition.current ? 19 : 4,
        mapTypeControl: false, scaleControl: true, zoomControl: true, cameraControl: false, tilt: 0, heading: 0,
        tiltInteractionEnabled: false, headingInteractionEnabled: false, rotateControl: false, streetViewControl: false,
        clickableIcons: false, fullscreenControl: true, gestureHandling: "cooperative",
        colorScheme: document.documentElement.dataset.tlinkColourMode === "night" ? "DARK" : "LIGHT",
      });
      created = { api, map }; setRuntime(created); setMessage("");
    })().catch(error => {
      if (!controller.signal.aborted) setMessage(error instanceof GoogleMapsClientError && error.reason === "auth" ? "The satellite connection could not authorise this site." : error instanceof Error ? error.message : "Satellite design is temporarily unavailable.");
    });
    return () => {
      controller.abort(); removeAuthListener();
      if (created) created.api.event.clearInstanceListeners(created.map);
      canvas?.replaceChildren();
    };
  }, [fetch, user, attempt]);

  async function close() {
    setClosing(true); setSaveError("");
    try { await saveRef.current?.(); onClose(); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Your design could not be saved. Keep this view open and try again."); setClosing(false); }
  }

  return <section className={styles.design} aria-label="Solar designs and insulation measurements">
    <div className={styles.designHeading}><div><strong>Solar designs & measurements</strong><p>Open a saved solar design, lay out panels or measure insulation areas. Add your design and measurements to a quote.</p></div><button type="button" className={styles.button} onClick={() => void close()} disabled={closing}>{closing ? "Saving design..." : closeLabel}</button></div>
    {saveError && <p className={styles.designError} role="alert">{saveError}</p>}
    {runtime && <TradeMapTools user={user} context={context} linkedDesign={linkedDesign} onRegisterMapSave={registerSave} api={runtime.api} map={runtime.map} onExplore={unchanged} onMeasuring={unchanged} onQuote={onQuote} />}
    <div className={styles.mapArea}><div ref={canvasRef} className={styles.canvas} aria-label="Satellite design map" />{message && <div className={styles.overlay} role="status"><strong>{message}</strong>{!message.startsWith("Loading") && <button type="button" className={styles.button} onClick={() => setAttempt(value => value + 1)}>Retry satellite tools</button>}</div>}</div>
  </section>;
}
