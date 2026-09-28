type CaptureIdentity = { handle: string; origin?: string };
type CaptureDevices = MediaDevices & { setCaptureHandleConfig?: (config: { handle?: string; exposeOrigin?: boolean; permittedOrigins?: string[] }) => void };
type CaptureTrack = MediaStreamTrack & { getCaptureHandle?: () => CaptureIdentity | null };
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

type CaptureBounds = { left: number; top: number; right: number; bottom: number };
type CaptureRegion = { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number };

/** Accept only a complete current-tab frame at a uniform display scale. */
export function mapCaptureRegion(bounds: CaptureBounds, viewport: { width: number; height: number }, width: number, height: number): CaptureRegion | null {
  if (![width, height, viewport.width, viewport.height, bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)
    || width <= 0 || height <= 0 || viewport.width <= 0 || viewport.height <= 0 || width * height > 33_554_432
    || bounds.left < 0 || bounds.top < 0 || bounds.right > viewport.width || bounds.bottom > viewport.height
    || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;
  const scaleX = width / viewport.width, scaleY = height / viewport.height;
  if (Math.abs(scaleX - scaleY) > 2 / Math.min(viewport.width, viewport.height)) return null;
  const x = Math.round(bounds.left * scaleX), y = Math.round(bounds.top * scaleY);
  return { x, y, width: Math.round(bounds.right * scaleX) - x, height: Math.round(bounds.bottom * scaleY) - y, scaleX, scaleY };
}

/** Unique marks outside the map verify its position and freshness in the delivered frame. */
function markMapBounds(element: HTMLElement, token: string) {
  const bounds = element.getBoundingClientRect(), margin = 10, size = 8;
  if (bounds.left < margin || bounds.top < margin || bounds.right + margin > innerWidth || bounds.bottom + margin > innerHeight) throw new Error("Leave a little space around the map before capturing. Exit full screen or zoom your browser out, then try again.");
  const colours = token.replaceAll("-", "");
  const positions = [[bounds.left - margin, bounds.top - margin], [bounds.right + 2, bounds.top - margin],
    [bounds.left - margin, bounds.bottom + 2], [bounds.right + 2, bounds.bottom + 2]];
  const probes = positions.map(([x, y], index) => {
    const rgb = [0, 1, 2].map(channel => 48 + parseInt(colours.slice(index * 6 + channel * 2, index * 6 + channel * 2 + 2), 16) % 160);
    const marker = document.createElement("div");
    marker.setAttribute("aria-hidden", "true");
    Object.assign(marker.style, { position: "fixed", left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`, background: `rgb(${rgb.join(",")})`, zIndex: "2147483647", pointerEvents: "none", border: "0", borderRadius: "0", margin: "0", padding: "0", opacity: "1" });
    document.body.append(marker);
    return { marker, x: x + size / 2, y: y + size / 2, rgb };
  });
  return { bounds, probes, remove: () => probes.forEach(({ marker }) => marker.remove()) };
}

type MapCaptureCaption = { title: string; note: string };
const MAX_IMAGE_BYTES = 4_000_000;
const solarCaption = (panelCount: number): MapCaptureCaption => ({ title: `Solar layout concept · ${panelCount} ${panelCount === 1 ? "panel" : "panels"}`,
  note: "Illustrative layout only. Confirm roof dimensions and installation clearances." });

/** Captures only this tab's entire map region, including its attribution. */
async function captureMapBlob(mapElement: HTMLElement, caption: MapCaptureCaption, prepare: () => void | Promise<void>, restore: () => void, signal: AbortSignal) {
  const devices: CaptureDevices = navigator.mediaDevices;
  if (!devices?.getDisplayMedia || !devices.setCaptureHandleConfig) {
    throw new Error("Map image capture needs desktop Chrome or Edge. Open TLink there to capture your roof design.");
  }
  const token = crypto.randomUUID();
  const origin = location.origin;
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let calibration: ReturnType<typeof markMapBounds> | null = null;
  let pixels: HTMLCanvasElement | null = null;
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
    track.addEventListener("capturehandlechange", stop);
    track.addEventListener("ended", stop);
    // A pending design save must not keep capture locked after the user cancels.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel); track.removeEventListener("ended", cancel); track.removeEventListener("capturehandlechange", cancel);
        complete();
      };
      const cancel = () => finish(() => reject(new Error("Map capture stopped before an image was ready.")));
      signal.addEventListener("abort", cancel, { once: true }); track.addEventListener("ended", cancel); track.addEventListener("capturehandlechange", cancel);
      if (signal.aborted || invalidated) { cancel(); return; }
      void Promise.resolve().then(() => { if (!settled) return prepare(); }).then(
        () => finish(resolve), (error: unknown) => finish(() => reject(error)),
      );
    });
    mapElement.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    requireVisibleMap(mapElement);
    calibration = markMapBounds(mapElement, token);
    const marked = calibration, viewport = { width: innerWidth, height: innerHeight };
    video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    const frame = video;
    if (!frame.requestVideoFrameCallback) throw new Error("This browser cannot verify a map image. Use desktop Chrome or Edge.");
    pixels = document.createElement("canvas");
    const source = pixels, read = source.getContext("2d", { willReadFrequently: true });
    if (!read) throw new Error("This browser could not create a PNG image.");
    const region = await new Promise<CaptureRegion>((resolve, reject) => {
      let frameId = 0, settled = false;
      const finish = (region?: CaptureRegion, error?: unknown) => {
        if (settled) return;
        settled = true; window.clearTimeout(timer); frame.cancelVideoFrameCallback(frameId);
        signal.removeEventListener("abort", cancelled); track.removeEventListener("ended", cancelled); track.removeEventListener("capturehandlechange", cancelled);
        if (region) resolve(region); else reject(error);
      };
      const cancelled = () => finish(undefined, new Error("Map capture stopped before an image was ready."));
      const timer = window.setTimeout(() => finish(undefined, new Error("The browser could not verify the map image. Keep this TLink tab visible and try again.")), 8000);
      signal.addEventListener("abort", cancelled, { once: true }); track.addEventListener("ended", cancelled); track.addEventListener("capturehandlechange", cancelled);
      const receive = () => {
        if (settled) return;
        try {
          if (signal.aborted || invalidated || !isCurrentMapTab(track, token, origin)) { cancelled(); return; }
          requireVisibleMap(mapElement);
          const current = mapElement.getBoundingClientRect();
          if (innerWidth !== viewport.width || innerHeight !== viewport.height
            || Math.abs(current.left - marked.bounds.left) > 0.5 || Math.abs(current.top - marked.bounds.top) > 0.5
            || Math.abs(current.right - marked.bounds.right) > 0.5 || Math.abs(current.bottom - marked.bounds.bottom) > 0.5) throw new Error("The map moved while capturing. Keep it still and try again.");
          const candidate = mapCaptureRegion(marked.bounds, viewport, frame.videoWidth, frame.videoHeight);
          if (candidate) {
            source.width = frame.videoWidth; source.height = frame.videoHeight;
            read.drawImage(frame, 0, 0);
            if (marked.probes.every(probe => {
              const pixel = read.getImageData(Math.floor(probe.x * candidate.scaleX), Math.floor(probe.y * candidate.scaleY), 1, 1).data;
              return probe.rgb.every((channel, index) => Math.abs(pixel[index] - channel) <= 28);
            })) { finish(candidate); return; }
          }
          frameId = frame.requestVideoFrameCallback(receive);
        } catch (error) { finish(undefined, error); }
      };
      if (signal.aborted || invalidated) { cancelled(); return; }
      frameId = frame.requestVideoFrameCallback(receive);
      void frame.play().catch(error => finish(undefined, error));
    });
    if (invalidated || signal.aborted || !isCurrentMapTab(track, token, origin)) throw new Error("Map capture stopped before an image was ready.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not create a PNG image.");
    let scale = Math.min(1, 1600 / region.width, (1600 - 62) / region.height);
    for (let attempt = 0; attempt < 7; attempt++) {
      const mapHeight = Math.max(1, Math.round(region.height * scale));
      canvas.width = Math.max(1, Math.round(region.width * scale)); canvas.height = mapHeight + 62;
      // The verified canvas freezes the frame. Later frames can never replace it during encoding.
      context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, canvas.width, mapHeight);
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
    calibration?.remove();
    if (pixels) { pixels.width = 0; pixels.height = 0; }
    signal.removeEventListener("abort", stop);
    stream?.getTracks().forEach((track) => { track.removeEventListener("capturehandlechange", stop); track.removeEventListener("ended", stop); track.stop(); });
    if (video) { video.pause(); video.srcObject = null; video.remove(); }
    devices.setCaptureHandleConfig({ handle: "", permittedOrigins: [] });
    restore();
  }
}

/** Saves a device copy using the same permission and image checks as quote attachments. */
export async function captureTradeMapPng(mapElement: HTMLElement, panelCount: number, prepare: () => void | Promise<void>, restore: () => void, signal: AbortSignal) {
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
export async function captureTradeMapQuoteImage(mapElement: HTMLElement, measurement: { kind: "solar" | "area" | "distance"; quantity: number }, prepare: () => void | Promise<void>, restore: () => void, signal: AbortSignal): Promise<{ dataUrl: string }> {
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
