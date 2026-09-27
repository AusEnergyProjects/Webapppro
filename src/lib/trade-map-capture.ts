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

/** Captures only this tab's map region, with the browser's explicit sharing permission. */
export async function captureTradeMapPng(mapElement: HTMLElement, panelCount: number, prepare: () => void, restore: () => void, signal: AbortSignal) {
  const devices: CaptureDevices = navigator.mediaDevices;
  const captureWindow: CaptureWindow = window;
  if (!devices?.getDisplayMedia || !devices.setCaptureHandleConfig || !captureWindow.CropTarget) {
    throw new Error("Capture image needs desktop Chrome or Edge. You can also use your device's screenshot tool.");
  }
  const token = crypto.randomUUID();
  const origin = location.origin;
  const cropTarget = captureWindow.CropTarget;
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let invalidated = false;
  let downloadUrl: string | null = null;
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
      const timer = window.setTimeout(() => { frame.cancelVideoFrameCallback(frameId); reject(new Error("The browser did not provide a map image. Try again.")); }, 8000);
      const frameId = frame.requestVideoFrameCallback(() => { window.clearTimeout(timer); resolve(); });
      void frame.play().catch((error: unknown) => { window.clearTimeout(timer); frame.cancelVideoFrameCallback(frameId); reject(error); });
    });
    if (invalidated || signal.aborted || !isCurrentMapTab(track, token, origin) || !video.videoWidth || !video.videoHeight) throw new Error("Map capture stopped before an image was ready.");
    requireVisibleMap(mapElement);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight + 62;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not create a PNG image.");
    context.drawImage(video, 0, 0);
    context.fillStyle = "#142d2b"; context.fillRect(0, video.videoHeight, canvas.width, 62);
    context.fillStyle = "#fff"; context.font = "bold 16px system-ui, sans-serif";
    context.fillText(`Solar layout concept · ${panelCount} ${panelCount === 1 ? "panel" : "panels"}`, 14, video.videoHeight + 25, canvas.width - 28);
    context.font = "12px system-ui, sans-serif";
    context.fillText("Illustrative layout only. Confirm roof dimensions and installation clearances.", 14, video.videoHeight + 46, canvas.width - 28);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not save the map image.")), "image/png"));
    if (signal.aborted) return;
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl; link.download = `tlink-solar-layout-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(link); link.click(); link.remove();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") throw new Error("Capture cancelled. Choose this TLink tab when the browser asks what to share.");
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    stream?.getTracks().forEach((track) => { track.removeEventListener("capturehandlechange", stop); track.removeEventListener("ended", stop); track.stop(); });
    if (video) { video.pause(); video.srcObject = null; video.remove(); }
    devices.setCaptureHandleConfig({ handle: "", permittedOrigins: [] });
    restore();
    if (downloadUrl) { const url = downloadUrl; window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
