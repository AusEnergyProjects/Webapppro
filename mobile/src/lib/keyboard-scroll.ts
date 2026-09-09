export type KeyboardFrame = { screenY: number; height: number };
export type WindowFrame = { x: number; y: number; width: number; height: number };
export type MeasuredInput = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };

export function keyboardScrollAdjustment(viewport: WindowFrame, input: WindowFrame, keyboard: KeyboardFrame | undefined, offset: number, gap = 16) {
  const visibleBottom = Math.min(viewport.y + viewport.height, keyboard?.screenY ?? Infinity);
  const visibleTop = viewport.y + gap;
  const bottomSpace = keyboard ? Math.max(0, viewport.y + viewport.height - keyboard.screenY) + gap : 0;
  // A tall input cannot fit in full. Keep its beginning visible rather than moving it entirely above the viewport.
  const inputBottom = input.y + Math.min(input.height, Math.max(0, visibleBottom - visibleTop - gap));
  const delta = inputBottom + gap > visibleBottom ? inputBottom + gap - visibleBottom
    : input.y < visibleTop ? input.y - visibleTop : 0;
  return { bottomSpace, scrollY: Math.max(0, offset + delta), needsScroll: Math.abs(delta) > 1 };
}

/** Coordinates are measured in the same native window as the keyboard frame, including modal windows. */
export function createKeyboardScrollCoordinator(dependencies: {
  getFocusedInput: () => MeasuredInput | null;
  measureViewport: (callback: (x: number, y: number, width: number, height: number) => void) => void;
  getOffset: () => number;
  scrollTo: (y: number) => void;
  setBottomSpace: (height: number) => void;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
}) {
  let keyboard: KeyboardFrame | undefined;
  let ownsFocus = false;
  let focusedInput: MeasuredInput | null = null;
  let generation = 0;
  let frame: number | undefined;
  let disposed = false;
  let bottomSpace = 0;

  function setSpace(next: number) {
    if (Math.abs(next - bottomSpace) <= 1) return;
    bottomSpace = next;
    dependencies.setBottomSpace(next);
    schedule();
  }

  function measure(ticket: number) {
    if (disposed || !ownsFocus || generation !== ticket) return;
    const input = dependencies.getFocusedInput();
    if (!input || (focusedInput && input !== focusedInput)) return;
    focusedInput = input;
    dependencies.measureViewport((x, y, width, height) => {
      if (disposed || !ownsFocus || generation !== ticket || input !== dependencies.getFocusedInput() || height <= 0) return;
      input.measureInWindow((inputX, inputY, inputWidth, inputHeight) => {
        if (disposed || !ownsFocus || generation !== ticket || input !== dependencies.getFocusedInput()) return;
        const adjustment = keyboardScrollAdjustment({ x, y, width, height },
          { x: inputX, y: inputY, width: inputWidth, height: inputHeight }, keyboard, dependencies.getOffset());
        setSpace(adjustment.bottomSpace);
        if (adjustment.needsScroll) dependencies.scrollTo(adjustment.scrollY);
      });
    });
  }

  function schedule() {
    if (disposed || !ownsFocus) return;
    if (frame !== undefined) dependencies.cancelFrame(frame);
    const ticket = generation;
    // Focus can precede the IME animation/layout. Recheck after native layout has committed, not inside onFocus.
    frame = dependencies.requestFrame(() => {
      frame = dependencies.requestFrame(() => { frame = undefined; measure(ticket); });
    });
  }

  return {
    activate() { disposed = false; },
    focus(currentKeyboard?: KeyboardFrame) { generation++; ownsFocus = true; focusedInput = null; keyboard = currentKeyboard; schedule(); },
    blur() { generation++; ownsFocus = false; focusedInput = null; if (frame !== undefined) dependencies.cancelFrame(frame); frame = undefined; },
    keyboardChanged(next: KeyboardFrame) { keyboard = next; schedule(); },
    keyboardHidden() { keyboard = undefined; generation++; if (frame !== undefined) dependencies.cancelFrame(frame); frame = undefined; setSpace(0); },
    layoutChanged: schedule,
    dispose() { disposed = true; generation++; if (frame !== undefined) dependencies.cancelFrame(frame); },
  };
}
