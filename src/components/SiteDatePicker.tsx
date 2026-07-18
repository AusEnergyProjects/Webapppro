"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addIsoDays,
  buildCalendarMonth,
  formatDateForDisplay,
  fullDateLabel,
  isIsoWithinRange,
  monthHeading,
  parseIsoDate,
  todayIso,
} from "@/lib/date-picker";

type ActivePicker = {
  input: HTMLInputElement;
  kind: "date" | "datetime-local";
  rangeStartInput: HTMLInputElement | null;
  rangeEndInput: HTMLInputElement | null;
};

type Position = { left: number; top: number };

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function datePart(value: string): string {
  return value.slice(0, 10);
}

function timePart(value: string): string {
  const valueTime = value.includes("T") ? value.split("T")[1]?.slice(0, 5) : "";
  return /^\d{2}:\d{2}$/.test(valueTime) ? valueTime : "09:00";
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findRangeInputs(input: HTMLInputElement): { start: HTMLInputElement | null; end: HTMLInputElement | null } {
  const group = input.dataset.dateRangeGroup;
  if (!group) return { start: null, end: null };
  const candidates = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-date-range-group]"))
    .filter((candidate) => candidate.dataset.dateRangeGroup === group);
  return {
    start: candidates.find((candidate) => candidate.dataset.dateRangeRole === "start") || null,
    end: candidates.find((candidate) => candidate.dataset.dateRangeRole === "end") || null,
  };
}

export function SiteDatePicker() {
  const [active, setActive] = useState<ActivePicker | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("09:00");
  const [draftRangeStart, setDraftRangeStart] = useState("");
  const [draftRangeEnd, setDraftRangeEnd] = useState("");
  const [rangeSelectingEnd, setRangeSelectingEnd] = useState(false);
  const [view, setView] = useState(() => {
    const today = parseIsoDate(todayIso())!;
    return { year: today.getUTCFullYear(), month: today.getUTCMonth() };
  });
  const [position, setPosition] = useState<Position>({ left: 12, top: 12 });
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setActive((current) => {
      if (current) {
        current.input.setAttribute("aria-expanded", "false");
        if (restoreFocus) queueMicrotask(() => current.input.focus({ preventScroll: true }));
      }
      return null;
    });
  }, []);

  const updatePosition = useCallback((input: HTMLInputElement) => {
    const rect = input.getBoundingClientRect();
    const width = Math.min(342, window.innerWidth - 24);
    const estimatedHeight = 430;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = rect.bottom + 8;
    const top = below + estimatedHeight <= window.innerHeight ? below : Math.max(12, rect.top - estimatedHeight - 8);
    setPosition({ left, top });
  }, []);

  const open = useCallback((input: HTMLInputElement) => {
    const kind = input.type === "datetime-local" ? "datetime-local" : "date";
    const range = findRangeInputs(input);
    const initial = datePart(input.value) || datePart(range.start?.value || "") || todayIso();
    const initialDate = parseIsoDate(initial) || parseIsoDate(todayIso())!;
    setDraftDate(initial);
    setDraftTime(timePart(input.value || input.min));
    setDraftRangeStart(datePart(range.start?.value || ""));
    setDraftRangeEnd(datePart(range.end?.value || ""));
    setRangeSelectingEnd(Boolean(range.start && range.end && !range.end.value && range.start.value));
    setView({ year: initialDate.getUTCFullYear(), month: initialDate.getUTCMonth() });
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-expanded", "true");
    updatePosition(input);
    setActive({ input, kind, rangeStartInput: range.start, rangeEndInput: range.end });
  }, [updatePosition]);

  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && (target.type === "date" || target.type === "datetime-local")) {
        if (target.disabled || target.readOnly || event.button !== 0) return;
        event.preventDefault();
        target.focus({ preventScroll: true });
        open(target);
        return;
      }
      if (active && target instanceof Node && !popoverRef.current?.contains(target)) close(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && (target.type === "date" || target.type === "datetime-local")) {
        if (!target.disabled && !target.readOnly && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")) {
          event.preventDefault();
          open(target);
        }
      }
    };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keydown", keyDown, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keydown", keyDown, true);
    };
  }, [active, close, open]);

  useEffect(() => {
    if (!active) return;
    const reposition = () => updatePosition(active.input);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [active, updatePosition]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const preferred = datePart(active.input.value) || datePart(active.rangeStartInput?.value || "") || todayIso();
      popoverRef.current?.querySelector<HTMLButtonElement>(`button[data-calendar-date="${preferred}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const min = datePart(active?.input.min || active?.rangeStartInput?.min || "");
  const max = datePart(active?.input.max || active?.rangeEndInput?.max || "");
  const days = useMemo(() => buildCalendarMonth(view.year, view.month, min, max), [max, min, view.month, view.year]);
  const isRange = Boolean(active?.rangeStartInput && active.rangeEndInput);

  function selectDate(iso: string) {
    if (!isRange) {
      setDraftDate(iso);
      return;
    }
    if (!rangeSelectingEnd || (draftRangeStart && draftRangeEnd)) {
      setDraftRangeStart(iso);
      setDraftRangeEnd("");
      setRangeSelectingEnd(true);
      return;
    }
    if (iso < draftRangeStart) {
      setDraftRangeStart(iso);
      setDraftRangeEnd("");
      return;
    }
    setDraftRangeEnd(iso);
    setRangeSelectingEnd(false);
  }

  function moveSelection(daysToMove: number) {
    const current = isRange ? (rangeSelectingEnd ? draftRangeEnd || draftRangeStart : draftRangeStart) : draftDate;
    const next = addIsoDays(current || todayIso(), daysToMove);
    const nextDate = parseIsoDate(next);
    if (!nextDate || (min && next < min) || (max && next > max)) return;
    selectDate(next);
    setView({ year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() });
    queueMicrotask(() => popoverRef.current?.querySelector<HTMLButtonElement>(`button[data-calendar-date="${next}"]`)?.focus());
  }

  function apply() {
    if (!active) return;
    if (isRange) {
      if (!draftRangeStart || !draftRangeEnd || !active.rangeStartInput || !active.rangeEndInput) return;
      setNativeInputValue(active.rangeStartInput, draftRangeStart);
      setNativeInputValue(active.rangeEndInput, draftRangeEnd);
    } else {
      if (!draftDate) return;
      setNativeInputValue(active.input, active.kind === "datetime-local" ? `${draftDate}T${draftTime}` : draftDate);
    }
    close();
  }

  function clear() {
    if (!active) return;
    if (isRange && active.rangeStartInput && active.rangeEndInput) {
      setNativeInputValue(active.rangeStartInput, "");
      setNativeInputValue(active.rangeEndInput, "");
    } else setNativeInputValue(active.input, "");
    close();
  }

  if (!active || typeof document === "undefined") return null;
  const selectedStart = isRange ? draftRangeStart : draftDate;
  const selectedEnd = isRange ? draftRangeEnd : draftDate;
  const canApply = isRange ? Boolean(draftRangeStart && draftRangeEnd) : Boolean(draftDate && (active.kind !== "datetime-local" || draftTime));
  const required = isRange ? Boolean(active.rangeStartInput?.required || active.rangeEndInput?.required) : active.input.required;

  return createPortal(
    <div
      ref={popoverRef}
      className="site-date-popover"
      role="dialog"
      aria-label={isRange ? "Choose date range" : active.kind === "datetime-local" ? "Choose date and time" : "Choose date"}
      style={{ left: position.left, top: position.top }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "ArrowLeft") { event.preventDefault(); moveSelection(-1); }
        if (event.key === "ArrowRight") { event.preventDefault(); moveSelection(1); }
        if (event.key === "ArrowUp") { event.preventDefault(); moveSelection(-7); }
        if (event.key === "ArrowDown") { event.preventDefault(); moveSelection(7); }
        if (event.key === "PageUp") { event.preventDefault(); setView((current) => current.month === 0 ? { year: current.year - 1, month: 11 } : { ...current, month: current.month - 1 }); }
        if (event.key === "PageDown") { event.preventDefault(); setView((current) => current.month === 11 ? { year: current.year + 1, month: 0 } : { ...current, month: current.month + 1 }); }
      }}
    >
      <div className="site-date-popover-heading">
        <button type="button" aria-label="Previous month" onClick={() => setView((current) => current.month === 0 ? { year: current.year - 1, month: 11 } : { ...current, month: current.month - 1 })}>‹</button>
        <strong>{monthHeading(view.year, view.month)}</strong>
        <button type="button" aria-label="Next month" onClick={() => setView((current) => current.month === 11 ? { year: current.year + 1, month: 0 } : { ...current, month: current.month + 1 })}>›</button>
      </div>
      {isRange && <div className="site-date-range-readout" aria-live="polite">
        <span>{draftRangeStart ? formatDateForDisplay(draftRangeStart) : "Start date"}</span>
        <b>to</b>
        <span>{draftRangeEnd ? formatDateForDisplay(draftRangeEnd) : rangeSelectingEnd ? "Choose end date" : "End date"}</span>
      </div>}
      <div className="site-date-weekdays" aria-hidden="true">{WEEKDAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="site-date-grid" role="grid">
        {days.map((day) => {
          const selected = day.iso === selectedStart || day.iso === selectedEnd;
          const inRange = isRange && isIsoWithinRange(day.iso, draftRangeStart, draftRangeEnd);
          return <button
            type="button"
            role="gridcell"
            data-calendar-date={day.iso}
            className={`${day.inCurrentMonth ? "" : "outside"}${inRange ? " in-range" : ""}${selected ? " selected" : ""}`}
            aria-label={fullDateLabel(day.iso)}
            aria-selected={selected}
            aria-current={day.iso === todayIso() ? "date" : undefined}
            disabled={day.disabled}
            onClick={() => selectDate(day.iso)}
            key={day.iso}
          >{day.day}</button>;
        })}
      </div>
      {!isRange && active.kind === "datetime-local" && <label className="site-date-time"><span>Time</span><input type="time" step={active.input.step || "60"} value={draftTime} onChange={(event) => setDraftTime(event.target.value)} /></label>}
      <div className="site-date-actions">
        {!required && <button type="button" className="site-date-clear" onClick={clear}>Clear</button>}
        <button type="button" className="site-date-apply" disabled={!canApply} onClick={apply}>Apply</button>
      </div>
    </div>,
    document.body,
  );
}
