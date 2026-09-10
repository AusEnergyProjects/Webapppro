import { ACESFilmicToneMapping, DirectionalLight, HemisphereLight, OrthographicCamera, PCFSoftShadowMap, Scene, WebGLRenderer } from "three";
import { createHomeEnergyModel } from "./home-energy-model";

export interface HomeEnergyScene {
  rotate: (delta: number) => void;
  tilt: (delta: number) => void;
  reset: () => void;
  setRoofOpen: (open: boolean) => void;
  setScrollTurn: (turn: number) => void;
  dispose: () => void;
}

/** Renders only while the view changes. Horizontal touch gestures turn the model; vertical ones scroll. */
export function createHomeEnergyScene(canvas: HTMLCanvasElement, onContextLost: () => void): HomeEnergyScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  const model = createHomeEnergyModel();
  scene.add(model.group);
  scene.add(new HemisphereLight(0xd8f4ff, 0x486765, 2.8));
  const sun = new DirectionalLight(0xffeed5, 3.4);
  sun.position.set(-6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 10, bottom: -9, near: .5, far: 35 });
  sun.shadow.normalBias = .035;
  scene.add(sun);
  const rim = new DirectionalLight(0x76ebda, 2);
  rim.position.set(6, 5, -8);
  scene.add(rim);
  const camera = new OrthographicCamera(-9, 9, 6, -6, .1, 100);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const startYaw = .63;
  const startElevation = .48;
  let yaw = startYaw, targetYaw = yaw;
  let elevation = startElevation, targetElevation = elevation;
  let roofHeight = 0, targetRoofHeight = 0;
  let scrollTurn = 0, targetScrollTurn = 0;
  let frame = 0, stopped = false, visible = true;
  let pointer: { id: number; x: number; y: number; type: string } | null = null;

  function render() {
    frame = 0;
    if (stopped || !visible || document.hidden) return;
    const ease = motion.matches ? 1 : .19;
    yaw += (targetYaw - yaw) * ease;
    elevation += (targetElevation - elevation) * ease;
    roofHeight += (targetRoofHeight - roofHeight) * ease;
    scrollTurn += (targetScrollTurn - scrollTurn) * ease;
    const angle = yaw + scrollTurn;
    camera.position.set(Math.sin(angle) * Math.cos(elevation) * 20, 2.1 + Math.sin(elevation) * 20, Math.cos(angle) * Math.cos(elevation) * 20);
    camera.lookAt(0, 2.1, 0);
    model.roof.position.y = roofHeight;
    renderer.render(scene, camera);
    if (Math.abs(targetYaw - yaw) + Math.abs(targetElevation - elevation) + Math.abs(targetRoofHeight - roofHeight) + Math.abs(targetScrollTurn - scrollTurn) > .001) requestRender();
  }
  function requestRender() { if (!frame && !stopped && visible && !document.hidden) frame = window.requestAnimationFrame(render); }
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const aspect = width / height;
    const halfHeight = Math.max(4.7, 7.1 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestRender();
  }
  function rotate(delta: number) { targetYaw += delta; requestRender(); }
  function tilt(delta: number) { targetElevation = Math.min(1.15, Math.max(.15, targetElevation + delta)); requestRender(); }
  function down(event: PointerEvent) {
    if (pointer || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, type: event.pointerType };
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "true";
  }
  function move(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return;
    rotate(-(event.clientX - pointer.x) * .009);
    if (pointer.type !== "touch") tilt((event.clientY - pointer.y) * .004);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }
  function release(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointer = null;
    delete canvas.dataset.dragging;
  }
  function lost(event: Event) { event.preventDefault(); dispose(); onContextLost(); }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const visibilityObserver = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) requestRender();
  });
  visibilityObserver.observe(canvas);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("webglcontextlost", lost);
  document.addEventListener("visibilitychange", requestRender);
  motion.addEventListener("change", requestRender);
  resize();

  function dispose() {
    if (stopped) return;
    stopped = true;
    window.cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", release);
    canvas.removeEventListener("pointercancel", release);
    canvas.removeEventListener("lostpointercapture", release);
    canvas.removeEventListener("webglcontextlost", lost);
    document.removeEventListener("visibilitychange", requestRender);
    motion.removeEventListener("change", requestRender);
    model.dispose();
    sun.shadow.map?.dispose();
    renderer.dispose();
  }
  return { rotate, tilt, reset: () => { targetYaw = startYaw; targetElevation = startElevation; requestRender(); }, setRoofOpen: (open) => { targetRoofHeight = open ? 1.6 : 0; requestRender(); }, setScrollTurn: (turn) => { targetScrollTurn = motion.matches ? 0 : turn; requestRender(); }, dispose };
}
