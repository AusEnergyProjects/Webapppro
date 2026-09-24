"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { ActivityAnswer, ActivityCondition, ActivityField, ActivityForm } from "@/lib/trade-activity-form-types";
import { conditionFieldKeys, conditionFields, conditionSummary, conditionValue, directCondition, editorConditionLockReason, makeCondition } from "@/lib/creditex-form-conditions";
import { editorFormPages, editorPageDeleteReason, editorPageRenameReason, editorQuestionDeleteReason, editorQuestionMoveReason, dropEditorQuestion } from "@/lib/creditex-form-pages";
import styles from "./TlinkFormMindMap.module.css";

type Point = { x: number; y: number };
type View = Point & { scale: number };
type Card = { key: string; title: string; detail: string; fields: ActivityField[]; signatureKey?: string; system?: boolean };
type Connection = { source: string; target: string; operator: "equals" | "notEquals"; value: ActivityAnswer };
type Gesture = { kind: "pan"; start: Point; original: View } | { kind: "card"; key: string; start: Point; original: Point } | { kind: "link"; source: string } | { kind: "question"; key: string; start: Point };
type Drop = { source: string; target: string; position: "before" | "after"; reason: string };
type Menu = Point & { kind: "question" | "page" | "signature"; key: string };
type Props = {
  form: ActivityForm; editable: boolean; selectedKey: string;
  onSelect: (key: string) => void; onEdit: (key: string) => void;
  onCondition: (key: string, condition?: ActivityCondition) => boolean;
  onAddPage: () => void; onAddQuestion: (pageKey: string) => void;
  onMoveQuestion: (fieldKey: string, pageKey: string) => void;
  onDropQuestion: (fieldKey: string, targetKey: string, position: "before" | "after") => boolean;
  editor: ReactNode; onCloseEditor: () => void;
  onRenamePage: (pageKey: string) => void;
  onDelete: (kind: "question" | "page" | "signature", key: string) => void;
};

export function TlinkMindMapMark() {
  return <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden="true"><path d="M16 8v8M7 24v-8h18v8" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /><rect x="11" y="2" width="10" height="8" rx="2" fill="currentColor" /><rect x="2" y="22" width="10" height="8" rx="2" fill="#a78bfa" /><rect x="20" y="22" width="10" height="8" rx="2" fill="#32e6bc" /></svg>;
}
function cardLayout(cards: Card[], sizes: Record<string, number>): Record<string, Point> {
  const positions: Record<string, Point> = {};
  const heights = [40, 40, 40];
  cards.forEach((card, index) => {
    const column = index % 3;
    positions[card.key] = { x: 40 + column * 440, y: heights[column] };
    heights[column] += (sizes[card.key] || 190 + card.fields.length * 200) + 60;
  });
  return positions;
}
function curve(from: Point, to: Point) {
  const reach = Math.max(55, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`;
}
const clampScale = (value: number) => Math.max(.05, Math.min(1.75, value));

export function TlinkFormMindMap({ form, editable, selectedKey, onSelect, onEdit, onCondition, onAddPage, onAddQuestion, onMoveQuestion, onDropQuestion, onRenamePage, onDelete, editor, onCloseEditor }: Props) {
  const pages = useMemo(() => editorFormPages(form), [form]);
  const cards = useMemo(() => {
    const result: Card[] = pages.map((page, index) => ({ key: page.key, title: page.section,
      detail: `Page ${index + 1} · ${page.phase === "before" ? "Before" : "After"} work${page.repeatGroup ? " · Per repeated item" : ""}`,
      fields: page.fields.map((field) => form.fields.find((item) => item.key === field.key) || field) }));
    for (const declaration of form.declarations) result.push({ key: `@declaration:${declaration.key}`, title: declaration.title,
      detail: `Signature · ${declaration.role} · ${declaration.phase === "before" ? "Before" : "After"} work`, fields: [], signatureKey: declaration.key });
    const shown = new Set(pages.flatMap((page) => page.fieldKeys));
    const referenced = new Set([...form.fields, ...form.declarations].flatMap((item) => conditionFieldKeys(item.condition)));
    const automatic = form.fields.filter((field) => !shown.has(field.key) && referenced.has(field.key));
    if (automatic.length) result.push({ key: "@system", title: "From the job and team profile", detail: "Recorded automatically · Not an app page", fields: automatic, system: true });
    return result;
  }, [form, pages]);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const defaults = useMemo(() => cardLayout(cards, cardHeights), [cards, cardHeights]);
  const [view, setView] = useState<View>({ x: 15, y: 15, scale: .8 });
  const [anchors, setAnchors] = useState<Record<string, { input?: Point; output?: Point }>>({});
  const [armed, setArmed] = useState("");
  const [pointer, setPointer] = useState<Point | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [notice, setNotice] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [draggingQuestion, setDraggingQuestion] = useState("");
  const menuRef = useRef<HTMLDivElement>(null), inspectorRef = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null), world = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const marker = `mind-map-${useId().replace(/:/g, "")}`;
  const selectedField = form.fields.find((item) => item.key === selectedKey);
  const selectedDeclaration = form.declarations.find((item) => `@declaration:${item.key}` === selectedKey);
  const selected = selectedField || selectedDeclaration;
  const selectedPage = pages.find((page) => page.fieldKeys.includes(selectedKey));
  const lockReason = selected ? editorConditionLockReason(form, selectedKey) : "";
  const source = form.fields.find((field) => field.key === connection?.source);
  const target = connection ? form.fields.find((field) => field.key === connection.target)
    || form.declarations.find((item) => `@declaration:${item.key}` === connection.target) : undefined;
  const targetCondition = target?.condition;
  const width = Math.max(1400, ...cards.map((card) => (positions[card.key] || defaults[card.key]).x + 420));
  const height = Math.max(850, ...cards.map((card) => (positions[card.key] || defaults[card.key]).y + (cardHeights[card.key] || 190 + card.fields.length * 200) + 40));

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null); };
    const close = () => setMenu(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close); window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [menu]);

  useLayoutEffect(() => {
    const element = world.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width) return;
      const next: typeof anchors = {};
      const sizes: Record<string, number> = {};
      element.querySelectorAll<HTMLElement>("[data-map-card]").forEach((card) => { sizes[card.dataset.mapCard!] = Math.ceil(card.getBoundingClientRect().height / view.scale); });
      setCardHeights((current) => JSON.stringify(current) === JSON.stringify(sizes) ? current : sizes);
      element.querySelectorAll<HTMLElement>("[data-map-input], [data-map-output]").forEach((port) => {
        const key = port.dataset.mapInput || port.dataset.mapOutput;
        if (!key) return;
        const bounds = port.getBoundingClientRect();
        const point = { x: (bounds.left + bounds.width / 2 - rect.left) / view.scale, y: (bounds.top + bounds.height / 2 - rect.top) / view.scale };
        next[key] = { ...next[key], [port.dataset.mapInput ? "input" : "output"]: point };
      });
      setAnchors((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    element.querySelectorAll<HTMLElement>("[data-map-card]").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [form, positions, view.scale, defaults]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      setView((current) => {
        const scale = clampScale(current.scale * Math.exp(-event.deltaY * .0015));
        return { scale, x: x - (x - current.x) * scale / current.scale, y: y - (y - current.y) * scale / current.scale };
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  function zoom(factor: number) {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return;
    setView((current) => {
      const scale = clampScale(current.scale * factor), x = rect.width / 2, y = rect.height / 2;
      return { scale, x: x - (x - current.x) * scale / current.scale, y: y - (y - current.y) * scale / current.scale };
    });
  }
  function fit() {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = clampScale(Math.min((rect.width - 40) / width, (rect.height - 40) / height));
    setView({ scale, x: 20, y: 20 });
  }
  function focusSelection() {
    const key = selectedPage?.key || selectedKey;
    const position = positions[key] || defaults[key];
    if (position) setView({ scale: 1, x: 30 - position.x, y: 30 - position.y });
  }
  function worldPoint(event: { clientX: number; clientY: number }): Point {
    const rect = stage.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale };
  }
  function begin(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest("button, input, select, a")) return;
    const handle = element?.closest<HTMLElement>("[data-map-move]");
    if (handle) {
      const key = handle.dataset.mapMove!;
      gesture.current = { kind: "card", key, start: worldPoint(event), original: positions[key] || defaults[key] };
    } else if (element?.closest("button, input, select, a, [data-map-card]")) return;
    else gesture.current = { kind: "pan", start: { x: event.clientX, y: event.clientY }, original: view };
    stage.current?.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function beginLink(event: PointerEvent<HTMLButtonElement>, key: string) {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    setArmed(key); setConnection(null); setNotice(""); setPointer(worldPoint(event));
    gesture.current = { kind: "link", source: key };
    stage.current?.setPointerCapture(event.pointerId);
  }
  function beginQuestion(event: PointerEvent<HTMLButtonElement>, key: string) {
    if (!editable || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault(); cancel();
    onCloseEditor();
    gesture.current = { kind: "question", key, start: { x: event.clientX, y: event.clientY } };
    setDraggingQuestion(key); setPointer(worldPoint(event)); onSelect(key); stage.current?.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "pan") setView({ ...active.original, x: active.original.x + event.clientX - active.start.x, y: active.original.y + event.clientY - active.start.y });
    else if (active.kind === "card") {
      const point = worldPoint(event);
      setPositions((current) => ({ ...current, [active.key]: { x: Math.max(0, active.original.x + point.x - active.start.x), y: Math.max(0, active.original.y + point.y - active.start.y) } }));
    } else if (active.kind === "question") {
      setPointer(worldPoint(event));
      if (Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) < 6) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const question = element?.closest<HTMLElement>("[data-map-target]");
      const page = pages.find((item) => item.key === element?.closest<HTMLElement>("[data-map-card]")?.dataset.mapCard);
      const targetKey = question?.dataset.mapTarget || page?.fieldKeys.at(-1);
      if (!page || !targetKey || targetKey === active.key) { setDrop(null); return; }
      const rect = question?.getBoundingClientRect();
      const position = rect && event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (drop?.target === targetKey && drop.position === position) return;
      let reason = "";
      try { dropEditorQuestion(form, active.key, targetKey, position); }
      catch (error) { reason = error instanceof Error ? error.message : "This question cannot move here."; }
      setDrop({ source: active.key, target: targetKey, position, reason });
    } else setPointer(worldPoint(event));
  }
  function chooseTarget(targetKey: string, from = armed) {
    const sourceField = form.fields.find((item) => item.key === from);
    const targetItem = form.fields.find((item) => item.key === targetKey) || form.declarations.find((item) => `@declaration:${item.key}` === targetKey);
    if (!editable || !sourceField || !targetItem) return;
    const reason = editorConditionLockReason(form, targetKey);
    if (reason || !conditionFields(form, targetKey, targetItem.phase).some((item) => item.key === from)) {
      setNotice(reason || "That connection would create a loop or cross incompatible work stages or repeated items."); return;
    }
    const existing = directCondition(targetItem.condition);
    setConnection({ source: from, target: targetKey, operator: existing?.fieldKey === from ? existing.operator : "equals", value: existing?.fieldKey === from ? existing.value : conditionValue(sourceField) });
    setNotice(""); setArmed(""); setPointer(null); onSelect(targetKey);
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    gesture.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
    if (active?.kind === "link") {
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-map-target]");
      if (targetElement?.dataset.mapTarget && targetElement.dataset.mapTarget !== active.source) chooseTarget(targetElement.dataset.mapTarget, active.source);
      setPointer(null);
    }
    if (active?.kind === "question") {
      if (drop && drop.source === active.key) { if (drop.reason) setNotice(drop.reason); else reorder(drop.source, drop.target, drop.position); }
      setDrop(null); setDraggingQuestion(""); setPointer(null);
    }
  }
  function cancel() { gesture.current = null; setConnection(null); setArmed(""); setPointer(null); setNotice(""); setMenu(null); setDrop(null); setDraggingQuestion(""); }
  function openMenu(event: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, kind: Menu["kind"], key: string, at?: Point) {
    event.preventDefault(); event.stopPropagation(); cancel();
    if (kind !== "page") onSelect(key);
    setMenu({ kind, key, x: Math.max(8, Math.min(at?.x ?? event.clientX, window.innerWidth - 268)), y: Math.max(8, Math.min(at?.y ?? event.clientY, window.innerHeight - 370)) });
  }
  function runMenu(action: () => void) { setMenu(null); action(); }
  function adjacentQuestion(offset: -1 | 1) {
    if (menu?.kind !== "question") return "";
    const page = pages.find((item) => item.fieldKeys.includes(menu.key));
    return page?.fieldKeys[page.fieldKeys.indexOf(menu.key) + offset] || "";
  }
  function reorderReason(targetKey: string, position: Drop["position"]) {
    if (!menu || !targetKey) return "Already at this end of the page.";
    try { dropEditorQuestion(form, menu.key, targetKey, position); return ""; }
    catch (error) { return error instanceof Error ? error.message : "This question order is fixed."; }
  }
  function reorder(key: string, targetKey: string, position: Drop["position"]) {
    try {
      const next = dropEditorQuestion(form, key, targetKey, position).form;
      const before = pages.find((page) => page.fieldKeys.includes(key));
      const after = editorFormPages(next).find((page) => page.fieldKeys.includes(key));
      if (!onDropQuestion(key, targetKey, position)) return;
      if (before && after) setPositions((current) => {
        const result = { ...current };
        for (const page of pages) delete result[page.key];
        for (const nextPage of editorFormPages(next)) {
          const previous = pages.find((page) => page.fieldKeys.some((fieldKey) => fieldKey !== key && nextPage.fieldKeys.includes(fieldKey))) || pages.find((page) => page.key === nextPage.key);
          if (previous) result[nextPage.key] = current[previous.key] || defaults[previous.key];
        }
        return result;
      });
      setNotice(before?.section === after?.section ? "Question order updated. Save your form when ready." : `Question moved to ${after?.section}. Save your form when ready.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "This question could not move."); }
  }
  function select(key: string) {
    if (armed) chooseTarget(key); else { onSelect(key); setMoveTo(""); setNotice(""); }
  }
  function apply() {
    if (!connection || !source || !target || !editable) return;
    if (typeof connection.value === "string" && !connection.value.trim()) { setNotice("Enter the answer that opens this question."); return; }
    if (source.type === "number" && (typeof connection.value !== "number" || !Number.isFinite(connection.value))) { setNotice("Enter a valid number."); return; }
    if (onCondition(connection.target, makeCondition(connection.source, connection.operator, connection.value))) {
      setConnection(null); setNotice("Connection applied. Save your form when ready.");
    }
  }

  const connections = [...form.fields.map((item) => ({ key: item.key, condition: item.condition })),
    ...form.declarations.map((item) => ({ key: `@declaration:${item.key}`, condition: item.condition }))];
  const menuPage = menu ? pages.find((page) => menu.kind === "page" ? page.key === menu.key : page.fieldKeys.includes(menu.key)) : undefined;
  const menuItem = menu ? form.fields.find((item) => item.key === menu.key) || form.declarations.find((item) => `@declaration:${item.key}` === menu.key) : undefined;
  const menuDeleteReason = !menu ? "" : menu.kind === "page" ? editorPageDeleteReason(form, menu.key)
    : menu.kind === "signature" ? editorConditionLockReason(form, menu.key) : editorQuestionDeleteReason(form, menu.key);
  return <section className={styles.map} aria-label="TLink Mind Map for forms">
    <div className={styles.toolbar}><div className={styles.brand}><TlinkMindMapMark /><div><strong>TLink Mind Map</strong><small>Forms, page by page</small></div></div>
      <div className={styles.tools}><button type="button" onClick={onAddPage} disabled={!editable}>+ Add page</button><button type="button" onClick={() => { setPositions({}); setView({ x: 15, y: 15, scale: .8 }); }}>Arrange cards</button><button type="button" onClick={focusSelection}>Find selected</button></div></div>
    <p className={styles.help}>One card = one app page. Double-click to edit here. Right-click for options. Drag a question grip to reorder or move between cards; drag answer dots to connect.</p>
    <div className={styles.canvasShell}>
    <div ref={stage} className={styles.stage} tabIndex={0} aria-label="Form map canvas. Drag the background to pan, scroll to zoom. Plus and minus zoom; arrow keys pan; Escape cancels a connection."
      onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") { cancel(); return; }
        if (event.target !== event.currentTarget) return;
        if (["+", "=", "-", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
        if (event.key === "+" || event.key === "=") zoom(1.2); else if (event.key === "-") zoom(1 / 1.2);
        else if (event.key.startsWith("Arrow")) setView((current) => ({ ...current, x: current.x + (event.key === "ArrowLeft" ? 60 : event.key === "ArrowRight" ? -60 : 0), y: current.y + (event.key === "ArrowUp" ? 60 : event.key === "ArrowDown" ? -60 : 0) }));
      }}>
      <div ref={world} className={styles.world} style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className={styles.lines} width={width} height={height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
          {connections.flatMap((item) => [...new Set(conditionFieldKeys(item.condition))].map((key) => {
            const from = anchors[key]?.output, to = anchors[item.key]?.input;
            if (!from || !to) return null;
            const direct = directCondition(item.condition);
            return <path key={`${key}:${item.key}`} d={curve(from, to)} stroke={(direct?.operator === "equals" ? direct.value === false : direct?.value === true) ? "#fb8aa3" : direct ? "#32e6bc" : "#b49aff"} strokeWidth={selectedKey === item.key || selectedKey === key ? 3.5 : 2} fill="none" markerEnd={`url(#${marker})`}><title>{conditionSummary(item.condition, form)}</title></path>;
          }))}
          {armed && pointer && anchors[armed]?.output && <path d={curve(anchors[armed].output!, pointer)} stroke="#fbd469" strokeWidth="3" strokeDasharray="7 5" fill="none" />}
        </svg>
        {cards.map((card) => {
          const position = positions[card.key] || defaults[card.key];
          const declaration = form.declarations.find((item) => item.key === card.signatureKey);
          return <article key={card.key} data-map-card={card.key} data-drop-page={drop && card.fields.some((field) => field.key === drop.target) ? drop.reason ? "blocked" : "ready" : undefined} className={`${styles.card} ${card.signatureKey ? styles.signature : ""}`} style={{ left: position.x, top: position.y }}
            onContextMenu={card.system ? undefined : (event) => openMenu(event, card.signatureKey ? "signature" : "page", card.key)}>
            <div className={styles.cardHeading} data-map-move={card.key}><span className={styles.grip} aria-hidden="true">⠿</span><div><small>{card.detail}</small><h3>{card.title}</h3></div>{!card.system && <button type="button" className={styles.more} aria-label={`Options for ${card.title}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openMenu(event, card.signatureKey ? "signature" : "page", card.key, { x: rect.left, y: rect.bottom }); }}>⋯</button>}</div>
            {card.fields.map((field) => {
              const locked = editorConditionLockReason(form, field.key);
              return <div key={field.key} className={styles.question} data-selected={selectedKey === field.key || undefined} data-map-target={field.key}
                data-dragging={draggingQuestion === field.key || undefined} data-drop={drop?.target === field.key ? drop.position : undefined}
                onContextMenu={(event) => openMenu(event, "question", field.key)}>
                <div className={styles.questionActions}>{!card.system && <button type="button" className={styles.questionGrip} aria-label={`Drag to reorder ${field.label}`} title="Drag above or below a question, or onto another page" disabled={!editable || Boolean(editorQuestionMoveReason(form, field.key, card.key))} onPointerDown={(event) => beginQuestion(event, field.key)}>⠿</button>}<button type="button" className={styles.more} aria-label={`Options for question ${field.label}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openMenu(event, "question", field.key, { x: rect.left, y: rect.bottom }); }}>⋯</button></div>
                <button type="button" className={styles.inputPort} data-map-input={field.key} aria-label={`Show ${field.label} when an answer matches`} title={locked || `Connect an answer to ${field.label}`} disabled={!editable || Boolean(locked)} onClick={() => select(field.key)}>●</button>
                <button type="button" className={styles.questionTitle} onClick={() => select(field.key)} onDoubleClick={() => { cancel(); onEdit(field.key); }}><strong>{field.label}</strong><small>{field.type === "boolean" ? "Yes / No" : field.type === "select" ? "Choose an answer" : field.type} · {field.required ? "Required" : "Optional"}{locked ? " · Program rule" : ""}</small></button>
                <button type="button" className={styles.outputPort} data-map-output={field.key} aria-label={`Connect from ${field.label}`} title={`Connect an answer from ${field.label}`} disabled={!editable || ["photo", "document"].includes(field.type)} onPointerDown={(event) => beginLink(event, field.key)} onClick={() => { setArmed(field.key); setConnection(null); setNotice(""); }}>●</button>
                {field.condition && <button type="button" className={styles.rule} title={conditionSummary(field.condition, form)} onClick={() => { onSelect(field.key); setArmed(""); }}><span aria-hidden="true">↳</span> {conditionSummary(field.condition, form)}</button>}
              </div>;
            })}
            {declaration && <div className={styles.question} data-map-target={card.key} data-selected={selectedKey === card.key || undefined}><button type="button" className={styles.inputPort} data-map-input={card.key} aria-label={`Show signature ${card.title} when an answer matches`} disabled={!editable || Boolean(editorConditionLockReason(form, card.key))} onClick={() => select(card.key)}>●</button><button type="button" className={styles.questionTitle} onClick={() => select(card.key)}><strong>{declaration.required ? "Required signature" : "Optional signature"}</strong><small>{conditionSummary(declaration.condition, form)}</small></button></div>}
            {!card.signatureKey && !card.system && <div className={styles.cardFooter}><span>{card.fields.length} / 8 questions</span><button type="button" disabled={!editable || card.fields.length >= 8} onClick={() => onAddQuestion(card.key)}>+ Add question</button></div>}
          </article>;
        })}
        {draggingQuestion && pointer && <div className={styles.dragGhost} style={{ left: pointer.x + 18, top: pointer.y + 18 }}><strong>{form.fields.find((item) => item.key === draggingQuestion)?.label}</strong><small>{drop?.reason || (drop ? `Drop ${drop.position} this question in ${pages.find((page) => page.fieldKeys.includes(drop.target))?.section}` : "Drop above, below or onto another page card")}</small></div>}
      </div>
      <div className={styles.zoom} onPointerDown={(event) => event.stopPropagation()}><button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>−</button><output aria-label="Map zoom">{Math.round(view.scale * 100)}%</output><button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>+</button><button type="button" onClick={fit}>Fit</button></div>
    </div>
    {editor && <aside className={styles.editorPanel} aria-label="Edit in Mind Map"><header><strong>{selectedDeclaration ? "Edit signature" : "Edit question"}</strong><button type="button" onClick={onCloseEditor}>Done</button></header><div className={styles.editorBody}>{editor}</div></aside>}
    </div>
    <div className={styles.legend}><span><i /> Answer connection</span><span><i className={styles.no} /> No branch</span><span><i className={styles.advanced} /> Combined rule</span><small>Card positions arrange your view; page membership and answer rules are saved with the form.</small></div>
    {(notice || armed) && <div className={styles.notice} role="status">{notice || `Connect “${form.fields.find((item) => item.key === armed)?.label}” to a follow-up question.`}{armed && <button type="button" onClick={cancel}>Cancel connection</button>}</div>}
    {connection && source && target ? <section className={styles.inspector} aria-label="Answer connection"><h3>{targetCondition ? "Replace answer rule" : "Add answer connection"}</h3><p>Show <strong>{"label" in target ? target.label : target.title}</strong> when <strong>{source.label}</strong>:</p>
      {targetCondition && <p>Current rule: {conditionSummary(targetCondition, form)}</p>}
      <div className={styles.ruleInputs}><label>Match<select value={connection.operator} onChange={(event) => setConnection({ ...connection, operator: event.target.value === "notEquals" ? "notEquals" : "equals" })}><option value="equals">Answer is</option><option value="notEquals">Answer is not</option></select></label>
        <label>Answer{source.type === "boolean" ? <select value={String(connection.value)} onChange={(event) => setConnection({ ...connection, value: event.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select>
          : source.type === "select" ? <select value={String(connection.value)} onChange={(event) => setConnection({ ...connection, value: event.target.value })}>{source.options.map((value) => <option key={value} value={value}>{source.optionLabels?.[value] || value}</option>)}</select>
            : <input type={source.type === "number" ? "number" : source.type === "date" ? "date" : "text"} value={String(connection.value)} onChange={(event) => setConnection({ ...connection, value: source.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value })} />}</label></div>
      <div className={styles.tools}><button type="button" className={styles.primary} disabled={!editable} onClick={apply}>{targetCondition ? "Replace rule" : "Apply connection"}</button><button type="button" onClick={cancel}>Cancel</button></div>
    </section> : selected && <section ref={inspectorRef} className={styles.inspector} aria-label="Selected map item"><h3>{"label" in selected ? selected.label : selected.title}</h3><p>{conditionSummary(selected.condition, form)}</p>{lockReason && <small>{lockReason}</small>}
      <div className={styles.tools}><button type="button" onClick={() => onEdit(selectedKey)}>{editable ? "Edit question or signature" : "View item"}</button>{selected.condition && !lockReason && <button type="button" disabled={!editable} onClick={() => { if (onCondition(selectedKey, undefined)) setNotice("Rule removed. This item is always shown."); }}>Remove rule / always show</button>}</div>
      {editable && selectedField && selectedPage && <div className={styles.moveQuestion}><label>Move question to page<select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}><option value="">Choose a page</option>{pages.map((page, index) => page.key === selectedPage.key ? null : <option key={page.key} value={page.key} disabled={Boolean(editorQuestionMoveReason(form, selectedKey, page.key))}>{index + 1}. {page.section}</option>)}</select></label><button type="button" disabled={!moveTo || Boolean(editorQuestionMoveReason(form, selectedKey, moveTo))} onClick={() => { onMoveQuestion(selectedKey, moveTo); setMoveTo(""); }}>Move to page</button></div>}
    </section>}
    {menu && <div ref={menuRef} className={styles.contextMenu} role="menu" aria-label="Mind Map options" style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (event.key === "Escape") { setMenu(null); stage.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = items.findIndex((item) => item === document.activeElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
      <strong>{menu.kind === "page" ? menuPage?.section : menuItem && ("label" in menuItem ? menuItem.label : menuItem.title)}</strong>
      <button role="menuitem" type="button" onClick={() => runMenu(() => onEdit(menu.key))}>{editable ? `Edit ${menu.kind}` : `View ${menu.kind}`}</button>
      {menu.kind === "question" && <>
        <button role="menuitem" type="button" disabled={!editable || Boolean(reorderReason(adjacentQuestion(-1), "before"))} title={reorderReason(adjacentQuestion(-1), "before")} onClick={() => runMenu(() => reorder(menu.key, adjacentQuestion(-1), "before"))}>Move up</button>
        <button role="menuitem" type="button" disabled={!editable || Boolean(reorderReason(adjacentQuestion(1), "after"))} title={reorderReason(adjacentQuestion(1), "after")} onClick={() => runMenu(() => reorder(menu.key, adjacentQuestion(1), "after"))}>Move down</button>
        <button role="menuitem" type="button" disabled={!editable || !menuPage} onClick={() => runMenu(() => inspectorRef.current?.querySelector<HTMLSelectElement>("select")?.focus())}>Move to another page…</button>
      </>}
      {menuPage && <button role="menuitem" type="button" disabled={!editable || menuPage.fields.length >= 8} onClick={() => runMenu(() => onAddQuestion(menuPage.key))}>Add question to this page</button>}
      {menu.kind === "page" && <button role="menuitem" type="button" disabled={!editable || Boolean(editorPageRenameReason(form, menu.key))} title={editorPageRenameReason(form, menu.key)} onClick={() => runMenu(() => onRenamePage(menu.key))}>Rename page</button>}
      {menuItem?.condition && <button role="menuitem" type="button" disabled={!editable || Boolean(editorConditionLockReason(form, menu.key))} onClick={() => runMenu(() => { onCondition(menu.key, undefined); })}>Remove answer rule</button>}
      <button role="menuitem" type="button" className={styles.deleteAction} disabled={!editable || Boolean(menuDeleteReason)} title={menuDeleteReason} onClick={() => runMenu(() => onDelete(menu.kind, menu.kind === "signature" ? menu.key.slice(13) : menu.key))}>Delete {menu.kind}</button>
      {menuDeleteReason && <small>{menuDeleteReason}</small>}
    </div>}
  </section>;
}
