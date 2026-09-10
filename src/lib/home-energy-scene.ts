import { ACESFilmicToneMapping, Box3, CanvasTexture, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, OrthographicCamera, PCFSoftShadowMap, PMREMGenerator, RepeatWrapping, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHomeEnergyModel, type HomeEnergyModel } from "./home-energy-model";

export interface HomeEnergyScene {
  setScrollProgress: (turn: number, reveal: number) => void;
  dispose: () => void;
}

/** Renders only while the view changes. Horizontal touch gestures turn the model; vertical ones scroll. */
export function createHomeEnergyScene(canvas: HTMLCanvasElement, onContextLost: () => void, onAnnotations: (positions: { key: keyof HomeEnergyModel["features"]; x: number; y: number }[]) => void): HomeEnergyScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  const model = createHomeEnergyModel();
  const bounds = new Box3().setFromObject(model.group);
  const centre = bounds.getCenter(new Vector3());
  const corner = new Vector3();
  scene.add(model.group);
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .65;
  room.dispose();
  pmrem.dispose();
  const textures = [surfaceTexture("wood"), surfaceTexture("stone")];
  const textured = new Set<MeshStandardMaterial>();
  model.group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || textured.has(material)) continue;
      textured.add(material);
      if (["timber", "timberLight", "floor"].includes(material.name)) material.map = textures[0];
      if (["stone", "limestone", "paving"].includes(material.name)) material.map = textures[1];
    }
  });
  scene.add(new HemisphereLight(0xd8eaff, 0x414844, 1.3));
  const sun = new DirectionalLight(0xffeed5, 2.6);
  sun.position.set(-6, 12, 8);
  sun.castShadow = true;
  const shadowSize = window.matchMedia("(max-width: 560px)").matches ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 10, bottom: -9, near: .5, far: 35 });
  sun.shadow.normalBias = .035;
  scene.add(sun);
  const rim = new DirectionalLight(0x9dfbe0, .85);
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
  let aspectRatio = 1;
  let viewWidth = 1, viewHeight = 1;
  let frame = 0, lastFrameTime = 0, stopped = false, visible = true;
  let pointer: { id: number; x: number; y: number; type: string } | null = null;

  function render(now: number) {
    frame = 0;
    if (stopped || !visible || document.hidden) return;
    const elapsed = lastFrameTime ? now - lastFrameTime : 16.7;
    lastFrameTime = now;
    const ease = motion.matches ? 1 : 1 - Math.exp(-elapsed / 80);
    yaw += (targetYaw - yaw) * ease;
    elevation += (targetElevation - elevation) * ease;
    roofHeight += (targetRoofHeight - roofHeight) * ease;
    scrollTurn += (targetScrollTurn - scrollTurn) * ease;
    const angle = yaw + scrollTurn;
    const centreY = centre.y + roofHeight * .3;
    camera.position.set(centre.x + Math.sin(angle) * Math.cos(elevation) * 20, centreY + Math.sin(elevation) * 20, centre.z + Math.cos(angle) * Math.cos(elevation) * 20);
    camera.lookAt(centre.x, centreY, centre.z);
    camera.updateMatrixWorld();
    let halfHeight = 0;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y + roofHeight]) for (const z of [bounds.min.z, bounds.max.z]) {
      corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      halfHeight = Math.max(halfHeight, Math.abs(corner.y), Math.abs(corner.x) / aspectRatio);
    }
    halfHeight *= 1.04;
    camera.left = -halfHeight * aspectRatio; camera.right = halfHeight * aspectRatio;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    model.roof.position.y = roofHeight;
    renderer.render(scene, camera);
    const reveal = roofHeight / 2.4;
    const active: (keyof HomeEnergyModel["features"])[] = reveal < .15 ? ["solar", "ev"] : reveal < .38 ? ["hotWater", "battery"] : reveal < .7 ? ["insulation", "glazing"] : ["airConditioning", "ventilation"];
    const positions = active.map((key) => {
      corner.copy(model.features[key]);
      if (key === "solar") corner.y += roofHeight;
      corner.project(camera);
      return { key, x: Math.max(8, Math.min(viewWidth - 155, (corner.x + 1) * viewWidth / 2)), y: Math.max(12, Math.min(viewHeight - 30, (1 - corner.y) * viewHeight / 2 - 32)) };
    });
    if (Math.abs(positions[0].x - positions[1].x) < 150 && Math.abs(positions[0].y - positions[1].y) < 38) positions[1].y = Math.min(viewHeight - 26, positions[0].y + 38);
    onAnnotations(positions);
    if (Math.abs(targetYaw - yaw) + Math.abs(targetElevation - elevation) + Math.abs(targetRoofHeight - roofHeight) + Math.abs(targetScrollTurn - scrollTurn) > .001) requestRender();
    else lastFrameTime = 0;
  }
  function requestRender() { if (!frame && !stopped && visible && !document.hidden) frame = window.requestAnimationFrame(render); }
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    aspectRatio = width / height;
    viewWidth = width; viewHeight = height;
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
    textures.forEach((texture) => texture.dispose());
    environment.dispose();
    sun.shadow.map?.dispose();
    renderer.dispose();
  }
  return { setScrollProgress: (turn, reveal) => {
    targetScrollTurn = motion.matches ? 0 : turn;
    targetRoofHeight = motion.matches ? 2.4 : reveal * 2.4;
    targetElevation = startElevation + (motion.matches ? .2 : reveal * .2);
    requestRender();
  }, dispose };
}

function surfaceTexture(kind: "wood" | "stone") {
  const surface = document.createElement("canvas");
  surface.width = surface.height = 512;
  const context = surface.getContext("2d");
  if (!context) throw new Error("Surface textures are unavailable");
  const pixels = context.createImageData(512, 512);
  let seed = 37;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const noise = (seed >>> 24) / 255;
      const grain = kind === "wood" ? Math.sin(x * .45 + Math.sin(y * .035) * 1.6) * 9 : 0;
      const shade = Math.round(222 + noise * 25 + grain);
      const index = (y * 512 + x) * 4;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = shade;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(surface);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}
