"use client";

import { useMemo, useRef } from "react";
import type {
  CreditexActivityWorkPackSignatureStroke,
} from "@/lib/creditex-activity-work-pack";
import styles from "./TradeActivityWorkPackPanel.module.css";

type SignaturePoint = CreditexActivityWorkPackSignatureStroke["points"][number];

function bounded(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function normaliseWorkPackSignaturePoint(input: {
  clientX: number;
  clientY: number;
  pressure: number;
  capturedAt: number;
  startedAt: number;
  left: number;
  top: number;
  width: number;
  height: number;
}): SignaturePoint {
  if (input.width <= 0 || input.height <= 0) {
    throw new Error("The signature box is not ready. Try again.");
  }
  return Object.freeze({
    x: bounded((input.clientX - input.left) / input.width),
    y: bounded((input.clientY - input.top) / input.height),
    pressure: input.pressure > 0 ? bounded(input.pressure) : null,
    capturedAtOffsetMs: Math.max(0, Math.round(input.capturedAt - input.startedAt)),
  });
}

function strokePoints(stroke: CreditexActivityWorkPackSignatureStroke) {
  return stroke.points.map((point) => `${(point.x * 1000).toFixed(2)},${(point.y * 360).toFixed(2)}`).join(" ");
}

export function TradeWorkPackSignaturePad({
  label,
  signerName,
  signerCapacity,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  signerName: string;
  signerCapacity: string;
  value: readonly CreditexActivityWorkPackSignatureStroke[];
  disabled?: boolean;
  onChange: (next: readonly CreditexActivityWorkPackSignatureStroke[]) => void;
}) {
  const activePointer = useRef<number | null>(null);
  const activeStroke = useRef<SignaturePoint[]>([]);
  const baseStrokes = useRef<readonly CreditexActivityWorkPackSignatureStroke[]>([]);
  const startedAt = useRef(0);
  const describedBy = useMemo(() => `signature-help-${crypto.randomUUID()}`, []);

  function point(event: React.PointerEvent<SVGSVGElement>) {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return normaliseWorkPackSignaturePoint({
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: event.pressure,
      capturedAt: performance.now(),
      startedAt: startedAt.current,
      left: rectangle.left,
      top: rectangle.top,
      width: rectangle.width,
      height: rectangle.height,
    });
  }

  function start(event: React.PointerEvent<SVGSVGElement>) {
    if (disabled || activePointer.current !== null) return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    startedAt.current = performance.now();
    baseStrokes.current = value;
    activeStroke.current = [point(event)];
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (disabled || activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const nextPoint = point(event);
    const previous = activeStroke.current.at(-1);
    if (previous && Math.hypot(nextPoint.x - previous.x, nextPoint.y - previous.y) < 0.0025) return;
    activeStroke.current = [...activeStroke.current, nextPoint];
    onChange([...baseStrokes.current, Object.freeze({ points: activeStroke.current })]);
  }

  function finish(event: React.PointerEvent<SVGSVGElement>) {
    if (activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const completed = activeStroke.current.length
      ? Object.freeze({ points: Object.freeze([...activeStroke.current]) })
      : null;
    activePointer.current = null;
    activeStroke.current = [];
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (completed) onChange([...baseStrokes.current, completed]);
  }

  function cancel(event: React.PointerEvent<SVGSVGElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    activeStroke.current = [];
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return <section className={styles.signatureBox} aria-label={label}>
    <header>
      <div>
        <strong>{label}</strong>
        <span>{signerCapacity}</span>
      </div>
      {!disabled && <button type="button" disabled={value.length === 0} onClick={() => onChange([])}>Clear and sign again</button>}
    </header>
    <svg
      className={styles.signatureSurface}
      viewBox="0 0 1000 360"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} drawing area`}
      aria-describedby={describedBy}
      data-empty={value.length === 0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <rect x="0" y="0" width="1000" height="360" rx="20" />
      <line x1="70" x2="930" y1="300" y2="300" />
      {value.map((stroke, index) => <polyline key={index} points={strokePoints(stroke)} />)}
    </svg>
    <p id={describedBy}>{value.length ? "Signature captured. Check it before continuing." : "Sign inside the box with a finger, mouse or stylus."}</p>
    <footer>
      <strong>{signerName || "Signer name will appear here"}</strong>
      <span>{signerCapacity}</span>
    </footer>
  </section>;
}
