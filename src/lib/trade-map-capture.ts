type CaptureIdentity = { handle: string; origin?: string };
type CaptureDevices = MediaDevices & { setCaptureHandleConfig?: (config: { handle?: string; exposeOrigin?: boolean; permittedOrigins?: string[] }) => void };
type CaptureTrack = MediaStreamTrack & { cropTo?: (target: object) => Promise<void>; getCaptureHandle?: () => CaptureIdentity | null };
type CaptureWindow = Window & { CropTarget?: { fromElement: (element: Element) => Promise<object> } };
interface MapCaptureOptions extends DisplayMediaStreamOptions {
  preferCurrentTab: boolean;
  selfBrowserSurface: "include";
  surfaceSwitching: "exclude";
  monitorTypeSurfaces: "exclude";
}

export function isCurrentMapTab(track: { getSettings(): { displaySurface?: string }; getCaptureHandle?: () => CaptureIdentity | null }, token: string, origin: string) {
  const identity = track.getCaptureHandle?.();
  return track.getSettings().displaySurface === "browser" && identity?.handle === token && identity.origin === origin;
}

function requireVisibleMap(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  const points = [[bounds.left + 2, bounds.top + 2], [bounds.right - 2, bounds.top + 2],
    [bounds.left + 2, bounds.bottom - 2], [bounds.right - 2, bounds.bottom - 2], [(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2]];
  if (bounds.top < 0 || bounds.left < 0 || bounds.bottom > innerHeight || bounds.right > innerWidth
    || points.some(([x, y]) => !element.contains(document.elementFromPoint(x, y)))) {
    throw new Error("Make the whole map visible without anything covering it, then capture again. Zoom your browser out if needed.");
  }
}

type MapCaptureCaption = { title: string; note: string };
const MAX_IMAGE_BYTES = 4_000_000;
const solarCaption = (panelCount: number): MapCaptureCaption => ({ title: `Solar layout concept · ${panelCount} ${panelCount === 1 ? "panel" : "panels"}`,
  note: "Illustrative layout only. Confirm roof dimensions and installation clearances." });

/** Captures only this tab's entire map region, including its attribution. */
async function captureMapBlob(mapElement: HTMLElement, caption: MapCaptureCaption, prepare: () => void, restore: () => void, signal: AbortSignal) {
  const devices: CaptureDevices = navigator.mediaDevices;
  const captureWindow: CaptureWindow = window;
  if (!devices?.getDisplayMedia || !devices.setCaptureHandleConfig || !captureWindow.CropTarget) {
    throw new Error("Map image capture needs desktop Chrome or Edge. Open TLink there to capture your roof design.");
  }
  const token = crypto.randomUUID();
  const origin = location.origin;
  const cropTarget = captureWindow.CropTarget;
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let invalidated = false;
  const stop = () => { invalidated = true; stream?.getTracks().forEach((track) => track.stop()); };
  devices.setCaptureHandleConfig({ handle: token, exposeOrigin: true, permittedOrigins: [origin] });
  signal.addEventListener("abort", stop, { once: true });
  try {
    const options: MapCaptureOptions = { audio: false, video: { displaySurface: "browser" }, preferCurrentTab: true,
      selfBrowserSurface: "include", surfaceSwitching: "exclude", monitorTypeSurfaces: "exclude" };
    stream = await new Promise<MediaStream>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        settled = true; window.clearTimeout(timer); signal.removeEventListener("abort", cancel);
        if (error) reject(error);
      };
      const cancel = () => finish(new Error("Capture cancelled."));
      const timer = window.setTimeout(() => finish(new Error("No tab was shared. If no sharing prompt appeared, open TLink in desktop Chrome or Edge and try Capture image again.")), 30000);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      void devices.getDisplayMedia(options).then((incoming) => {
        if (settled || signal.aborted) { incoming.getTracks().forEach((track) => track.stop()); return; }
        finish(); resolve(incoming);
      }, (error: unknown) => { if (!settled) finish(error instanceof Error ? error : new Error("The browser could not share this tab.")); });
    });
    const track: CaptureTrack | undefined = stream.getVideoTracks()[0];
    if (signal.aborted || !track || !isCurrentMapTab(track, token, origin)) throw new Error("Choose this TLink browser tab to capture the map. Other tabs and windows are not saved.");
    if (!track.cropTo) throw new Error("This browser cannot capture just the map. Use desktop Chrome or Edge, or your device's screenshot tool.");
    track.addEventListener("capturehandlechange", stop);
    track.addEventListener("ended", stop);
    prepare();
    mapElement.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    requireVisibleMap(mapElement);
    await track.cropTo(await cropTarget.fromElement(mapElement));
    if (invalidated || signal.aborted || !isCurrentMapTab(track, token, origin)) throw new Error("Map capture stopped. Try again and choose this TLink tab.");
    video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    const frame = video;
    await new Promise<void>((resolve, reject) => {
      let frameId = 0, paintId = 0, settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true; window.clearTimeout(timer); frame.cancelVideoFrameCallback(frameId); cancelAnimationFrame(paintId);
        signal.removeEventListener("abort", cancelled); track.removeEventListener("ended", cancelled); track.removeEventListener("capturehandlechange", cancelled);
        if (error) reject(error); else resolve();
      };
      const cancelled = () => finish(new Error("Map capture stopped before an image was ready."));
      const timer = window.setTimeout(() => finish(new Error("The browser did not provide a map image. Try again.")), 8000);
      signal.addEventListener("abort", cancelled, { once: true }); track.addEventListener("ended", cancelled); track.addEventListener("capturehandlechange", cancelled);
      if (signal.aborted || invalidated) { cancelled(); return; }
      // The stream can initially present a buffered frame from before controls were hidden.
      // Discard it, allow another complete paint, then use the next delivered video frame.
      frameId = frame.requestVideoFrameCallback(() => {
        if (settled) return;
        paintId = requestAnimationFrame(() => { paintId = requestAnimationFrame(() => {
          if (!settled) frameId = frame.requestVideoFrameCallback(() => finish());
        }); });
      });
      void frame.play().catch(finish);
    });
    if (invalidated || signal.aborted || !isCurrentMapTab(track, token, origin) || !video.videoWidth || !video.videoHeight) throw new Error("Map capture stopped before an image was ready.");
    requireVisibleMap(mapElement);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not create a PNG image.");
    let scale = Math.min(1, 1600 / video.videoWidth, (1600 - 62) / video.videoHeight);
    for (let attempt = 0; attempt < 7; attempt++) {
      const mapHeight = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = mapHeight + 62;
      context.drawImage(video, 0, 0, canvas.width, mapHeight);
      context.fillStyle = "#142d2b"; context.fillRect(0, mapHeight, canvas.width, 62);
      context.fillStyle = "#fff"; context.font = "bold 16px system-ui, sans-serif";
      context.fillText(caption.title, 14, mapHeight + 25, canvas.width - 28);
      context.font = "12px system-ui, sans-serif";
      context.fillText(caption.note, 14, mapHeight + 46, canvas.width - 28);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not save the map image.")), "image/png"));
      if (invalidated || signal.aborted || !isCurrentMapTab(track, token, origin)) throw new Error("Map capture stopped before the image was saved.");
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
      scale *= 0.8;
    }
    throw new Error("The map image is too large. Make the map smaller on screen and try again.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") throw new Error("Capture cancelled. Choose this TLink tab when the browser asks what to share.");
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    stream?.getTracks().forEach((track) => { track.removeEventListener("capturehandlechange", stop); track.removeEventListener("ended", stop); track.stop(); });
    if (video) { video.pause(); video.srcObject = null; video.remove(); }
    devices.setCaptureHandleConfig({ handle: "", permittedOrigins: [] });
    restore();
  }
}

/** Saves a device copy using the same permission and image checks as quote attachments. */
export async function captureTradeMapPng(mapElement: HTMLElement, panelCount: number, prepare: () => void, restore: () => void, signal: AbortSignal) {
  const blob = await captureMapBlob(mapElement, solarCaption(panelCount), prepare, restore, signal);
  if (signal.aborted) throw new Error("Capture cancelled.");
  const downloadUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = downloadUrl; link.download = `tlink-solar-layout-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(link); link.click(); link.remove();
  } finally { window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000); }
}

/** A quote receives pixels only after the user shares this exact tab. No download is started. */
export async function captureTradeMapQuoteImage(mapElement: HTMLElement, measurement: { kind: "solar" | "area" | "distance"; quantity: number }, prepare: () => void, restore: () => void, signal: AbortSignal): Promise<{ dataUrl: string }> {
  const caption = measurement.kind === "solar" ? solarCaption(measurement.quantity) : {
    title: `Map ${measurement.kind === "area" ? "area" : "distance"} estimate · ${measurement.quantity.toLocaleString("en-AU")} ${measurement.kind === "area" ? "m²" : "m"}`,
    note: "Approximate map measurement only. Confirm roof pitch and actual dimensions on site.",
  };
  const blob = await captureMapBlob(mapElement, caption, prepare, restore, signal);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (signal.aborted) throw new Error("Capture cancelled.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { dataUrl: `data:image/png;base64,${btoa(binary)}` };
}
