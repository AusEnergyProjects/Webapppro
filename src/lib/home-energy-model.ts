import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, InstancedMesh, Matrix4, MeshStandardMaterial,
  Object3D, Quaternion, SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type HomeEnergyFeature =
  | "hotWater" | "ev" | "airConditioning" | "insulation"
  | "solar" | "battery" | "glazing" | "ventilation";

export interface HomeEnergyModel {
  group: Group;
  roof: Group;
  /** Model-local landmarks. Only solar moves when the roof is raised. */
  features: Record<HomeEnergyFeature, Vector3>;
  dispose: () => void;
}

/** An original single-storey Australian pavilion. The living frontage faces +Z. */
export function createHomeEnergyModel(): HomeEnergyModel {
  const group = new Group();
  group.name = "all-electric-pavilion";
  const roof = new Group();
  roof.name = "removable-roof-assemblies";
  group.add(roof);
  const geometries = {
    box: new BoxGeometry(1, 1, 1),
    rounded: new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
    carBody: new RoundedBoxGeometry(1.82, 0.46, 3.98, 3, 0.18),
    cylinder: new CylinderGeometry(1, 1, 1, 24),
    sphere: new SphereGeometry(1, 16, 10),
    ring: new TorusGeometry(1, 0.025, 5, 28),
    tyre: new TorusGeometry(1, 0.28, 10, 32),
    wheelArch: new TorusGeometry(1, 0.05, 6, 24, Math.PI),
  };
  const ownedGeometries = new Set<BufferGeometry>(Object.values(geometries));
  const materials = {
    stone: new MeshStandardMaterial({ color: "#d8d0c0", roughness: 0.83 }),
    limestone: new MeshStandardMaterial({ color: "#c4c1b5", roughness: 0.9 }),
    floor: new MeshStandardMaterial({ color: "#c4a078", roughness: 0.66 }),
    timber: new MeshStandardMaterial({ color: "#946e4c", roughness: 0.72 }),
    timberLight: new MeshStandardMaterial({ color: "#bd966d", roughness: 0.74 }),
    frame: new MeshStandardMaterial({ color: "#253239", roughness: 0.37, metalness: 0.65 }),
    roof: new MeshStandardMaterial({ color: "#47565d", roughness: 0.43, metalness: 0.55 }),
    silver: new MeshStandardMaterial({ color: "#bac4c7", roughness: 0.29, metalness: 0.83 }),
    glass: new MeshStandardMaterial({
      color: "#d0e9ee", roughness: 0.08, metalness: 0.15,
      transparent: true, opacity: 0.115, depthWrite: false, side: DoubleSide,
    }),
    glassEdge: new MeshStandardMaterial({ color: "#719da3", roughness: 0.28, metalness: 0.3 }),
    plinth: new MeshStandardMaterial({ color: "#233c44", roughness: 0.38, metalness: 0.48 }),
    paving: new MeshStandardMaterial({ color: "#8a9694", roughness: 0.91 }),
    soil: new MeshStandardMaterial({ color: "#3e4940", roughness: 1 }),
    leaf: new MeshStandardMaterial({ color: "#567963", roughness: 0.85, side: DoubleSide }),
    leafLight: new MeshStandardMaterial({ color: "#879783", roughness: 0.83, side: DoubleSide }),
    leafDark: new MeshStandardMaterial({ color: "#3a6458", roughness: 0.91, side: DoubleSide }),
    bark: new MeshStandardMaterial({ color: "#b0a28f", roughness: 0.92 }),
    linen: new MeshStandardMaterial({ color: "#ece7da", roughness: 0.98 }),
    sage: new MeshStandardMaterial({ color: "#81918a", roughness: 0.94 }),
    rug: new MeshStandardMaterial({ color: "#bcb4a4", roughness: 1 }),
    screen: new MeshStandardMaterial({ color: "#14242b", roughness: 0.18, metalness: 0.25 }),
    solar: new MeshStandardMaterial({ color: "#16334e", roughness: 0.21, metalness: 0.65 }),
    solarGrid: new MeshStandardMaterial({ color: "#607b94", roughness: 0.32, metalness: 0.62 }),
    equipment: new MeshStandardMaterial({ color: "#e5e8e4", roughness: 0.28, metalness: 0.28 }),
    carPaint: new MeshStandardMaterial({ color: "#b8c7cf", roughness: 0.16, metalness: 0.76 }),
    carGlass: new MeshStandardMaterial({ color: "#203643", roughness: 0.07, metalness: 0.56 }),
    rubber: new MeshStandardMaterial({ color: "#172022", roughness: 0.92 }),
    insulation: new MeshStandardMaterial({ color: "#dcb550", roughness: 1 }),
    membrane: new MeshStandardMaterial({ color: "#748e8f", roughness: 0.75 }),
    copper: new MeshStandardMaterial({ color: "#b68459", roughness: 0.4, metalness: 0.82 }),
    red: new MeshStandardMaterial({ color: "#b56f58", roughness: 0.56 }),
    blue: new MeshStandardMaterial({ color: "#5f8fba", roughness: 0.52 }),
    headlight: new MeshStandardMaterial({ color: "#e7f2ff", emissive: "#c1e1ff", emissiveIntensity: 0.55 }),
    taillight: new MeshStandardMaterial({ color: "#a92b28", emissive: "#ac281d", emissiveIntensity: 0.28 }),
    mint: new MeshStandardMaterial({ color: "#a5dccc", emissive: "#63bda6", emissiveIntensity: 0.4, roughness: 0.5 }),
    warm: new MeshStandardMaterial({ color: "#ffe5b8", emissive: "#efc48c", emissiveIntensity: 0.65, roughness: 0.6 }),
  };
  for (const [name, material] of Object.entries(materials)) material.name = name;
  const features: Record<HomeEnergyFeature, Vector3> = {
    hotWater: new Vector3(3.65, 1.2, 2.87),
    ev: new Vector3(5.15, 0.95, 0.6),
    airConditioning: new Vector3(3.91, 0.64, 0.82),
    insulation: new Vector3(3.27, 2.77, 0.53),
    solar: new Vector3(-1.63, 3.42, -0.07),
    battery: new Vector3(3.83, 1.01, -0.74),
    glazing: new Vector3(-1.53, 1.53, 1.73),
    ventilation: new Vector3(2.79, 2.31, -1.7),
  };
  type Batch = { geometry: BufferGeometry; material: MeshStandardMaterial; matrices: Matrix4[] };
  const batches = new Map<Group, Map<string, Batch>>();
  const instances: InstancedMesh[] = [];
  const transform = new Object3D();

  function record(geometry: BufferGeometry, material: MeshStandardMaterial, matrix: Matrix4, parent: Group) {
    let collection = batches.get(parent);
    if (!collection) {
      collection = new Map();
      batches.set(parent, collection);
    }
    const key = geometry.uuid + ":" + material.uuid;
    let batch = collection.get(key);
    if (!batch) {
      batch = { geometry, material, matrices: [] };
      collection.set(key, batch);
    }
    batch.matrices.push(matrix.clone());
  }
  function place(geometry: BufferGeometry, material: MeshStandardMaterial,
    x: number, y: number, z: number, sx: number, sy: number, sz: number,
    parent: Group = group, yaw = 0, pitch = 0, roll = 0) {
    transform.position.set(x, y, z);
    transform.rotation.set(pitch, yaw, roll);
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    record(geometry, material, transform.matrix, parent);
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number,
    material: MeshStandardMaterial, parent: Group = group, yaw = 0) {
    place(geometries.box, material, x, y, z, w, h, d, parent, yaw);
  }
  function rounded(w: number, h: number, d: number, x: number, y: number, z: number,
    material: MeshStandardMaterial, parent: Group = group, yaw = 0) {
    place(geometries.rounded, material, x, y, z, w, h, d, parent, yaw);
  }
  function cylinder(r: number, h: number, x: number, y: number, z: number,
    material: MeshStandardMaterial, parent: Group = group) {
    place(geometries.cylinder, material, x, y, z, r, h, r, parent);
  }
  function pipe(points: Vector3[], radius: number, material: MeshStandardMaterial, parent: Group = group) {
    const geometry = new TubeGeometry(new CatmullRomCurve3(points), points.length * 6, radius, 6, false);
    ownedGeometries.add(geometry);
    place(geometry, material, 0, 0, 0, 1, 1, 1, parent);
  }
  function strut(start: Vector3, end: Vector3, radius: number, material: MeshStandardMaterial, parent: Group = group) {
    const direction = end.clone().sub(start);
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
    record(geometries.cylinder, material, new Matrix4().compose(
      start.clone().add(end).multiplyScalar(0.5), rotation, new Vector3(radius, direction.length(), radius),
    ), parent);
  }

  // Paired panes, perimeter spacers and narrow thermally separated frame profiles.
  function glazing(x: number, y: number, z: number, width: number, height: number, along: "x" | "z") {
    const front = along === "x";
    for (const offset of [-0.024, 0.024]) {
      box(front ? width - 0.058 : 0.008, height - 0.05, front ? 0.008 : width - 0.058,
        x + (front ? 0 : offset), y, z + (front ? offset : 0), materials.glass);
    }
    for (const edge of [-1, 1]) {
      box(front ? width : 0.08, 0.048, front ? 0.08 : width, x, y + edge * height / 2, z, materials.frame);
      box(front ? width - 0.06 : 0.046, 0.012, front ? 0.046 : width - 0.06,
        x, y + edge * (height / 2 - 0.035), z, materials.glassEdge);
      box(front ? 0.044 : 0.08, height, front ? 0.08 : 0.044,
        x + (front ? edge * width / 2 : 0), y, z + (front ? 0 : edge * width / 2), materials.frame);
    }
  }

  // Thin display ground, concrete driveway, independent slabs and timber terrace.
  rounded(13.2, 0.22, 9.2, 0, -0.23, 0, materials.plinth);
  rounded(13.05, 0.025, 9.05, 0, -0.107, 0, materials.mint);
  rounded(13.12, 0.105, 9.12, 0, -0.04, 0, materials.paving);
  box(2.56, 0.028, 7.42, 5.09, 0.028, 0.27, materials.limestone);
  for (let i = 0; i < 7; i += 1) box(2.53, 0.006, 0.012, 5.09, 0.046, -2.8 + i * 1.025, materials.paving);
  box(6.1, 0.2, 4.28, -1.57, 0.1, -0.03, materials.stone);
  box(3.02, 0.2, 3.8, 2.18, 0.1, -0.88, materials.stone);
  box(5.78, 0.045, 3.86, -1.58, 0.219, -0.02, materials.floor);
  box(2.75, 0.045, 3.48, 2.2, 0.219, -0.89, materials.floor);
  for (let i = 0; i < 31; i += 1) box(0.009, 0.004, 3.84, -4.42 + i * 0.185, 0.245, -0.02, materials.timber);
  box(5.87, 0.18, 1.43, -0.88, 0.08, 2.54, materials.frame);
  for (let i = 0; i < 37; i += 1) box(0.145, 0.055, 1.41, -3.73 + i * 0.158, 0.193, 2.54,
    i % 4 ? materials.floor : materials.timberLight);
  box(1.58, 0.09, 0.38, -1.18, 0.062, 3.44, materials.limestone);

  // High living pavilion: long glazing, deep reveals and restrained masonry piers.
  box(0.2, 2.86, 0.6, -4.35, 1.67, -1.51, materials.stone);
  box(0.2, 2.82, 0.26, -4.35, 1.65, 1.69, materials.stone);
  box(0.17, 2.66, 0.26, 1.13, 1.57, 1.69, materials.stone);
  box(5.67, 2.74, 0.18, -1.59, 1.61, -1.82, materials.stone);
  box(3.2, 0.67, 0.034, -2.23, 2.32, -1.715, materials.timberLight);
  for (const x of [-3.43, -1.6, 0.23]) {
    const height = 2.67 - (x + 1.6) * 0.045;
    glazing(x, 0.247 + height / 2, 1.735, 1.77, height, "x");
  }
  glazing(-4.35, 1.625, 0.05, 2.63, 2.7, "z");
  box(5.46, 0.015, 0.12, -1.6, 0.247, 1.732, materials.silver);
  box(0.1, 0.015, 2.74, -4.35, 0.247, 0.05, materials.silver);
  for (const x of [-2.52, -0.69]) {
    box(0.017, 0.24, 0.025, x, 1.28, 1.791, materials.silver);
    box(0.013, 0.24, 0.025, x + 0.062, 1.28, 1.791, materials.frame);
  }

  // Rearward bedroom wing, with its near corner opened into a wall section.
  box(2.77, 2.45, 0.17, 2.23, 1.465, -2.58, materials.stone);
  box(0.17, 2.45, 1.04, 3.6, 1.465, -0.06, materials.stone);
  box(0.17, 2.45, 0.43, 3.6, 1.465, -2.42, materials.stone);
  glazing(3.6, 1.48, -1.33, 1.7, 2.37, "z");
  glazing(1.57, 1.48, 0.89, 1.04, 2.37, "x");
  glazing(2.61, 1.48, 0.89, 0.99, 2.37, "x");
  box(0.11, 2.44, 1.95, 1.02, 1.46, -1.55, materials.timberLight);
  box(0.56, 2.44, 0.031, 3.36, 1.46, 0.702, materials.linen);
  box(0.25, 2.4, 0.025, 3.2, 1.46, 0.947, materials.membrane);
  rounded(0.4, 2.22, 0.18, 3.38, 1.43, 0.827, materials.insulation);
  for (const x of [3.08, 3.6]) box(0.06, 2.46, 0.2, x, 1.46, 0.83, materials.timberLight);
  for (const y of [0.3, 1.31, 2.64]) box(0.53, 0.065, 0.2, 3.34, y, 0.83, materials.timberLight);
  // Cut-back outer boards leave the batt and membrane layers visible.
  for (let i = 0; i < 6; i += 1) box(0.034, 1.03, 0.04, 3.36 + i * 0.044, 0.775, 1.04, materials.timberLight);

  const livingRoof = new Group();
  livingRoof.name = "standing-seam-living-roof";
  livingRoof.position.set(-1.64, 3.13, -0.015);
  livingRoof.rotation.z = -0.045;
  roof.add(livingRoof);
  box(6.04, 0.11, 4.17, 0, 0, 0, materials.roof, livingRoof);
  box(5.98, 0.046, 4.1, 0, -0.077, 0, materials.timberLight, livingRoof);
  for (let i = 0; i < 28; i += 1) box(0.018, 0.025, 4.15, -2.96 + i * 0.219, 0.069, 0, materials.roof, livingRoof);
  for (const z of [-2.083, 2.083]) box(6.04, 0.13, 0.045, 0, -0.01, z, materials.frame, livingRoof);
  for (const x of [-3.02, 3.02]) box(0.045, 0.13, 4.17, x, -0.01, 0, materials.frame, livingRoof);
  for (let i = 0; i < 10; i += 1) {
    const x = -2.77 + i * 0.616;
    box(0.067, 0.17, 3.75, x, -0.168, -0.02, materials.timberLight, livingRoof);
    if (i < 9) rounded(0.54, 0.135, 3.66, x + 0.306, -0.167, -0.02, materials.insulation, livingRoof);
  }
  box(5.6, 0.025, 0.02, 0, -0.108, 1.75, materials.warm, livingRoof);
  box(0.095, 0.1, 4.19, 3.065, -0.075, 0, materials.silver, livingRoof);
  pipe([new Vector3(1.46, 2.91, -1.82), new Vector3(1.49, 2.65, -1.86),
    new Vector3(1.49, 0.25, -1.86)], 0.026, materials.frame);

  // The panel array follows the actual pitch of the standing-seam roof.
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      const x = (column - 1.5) * 1.345;
      const z = (row - 0.5) * 1.61;
      box(1.295, 0.048, 1.535, x, 0.15, z, materials.silver, livingRoof);
      box(1.255, 0.018, 1.495, x, 0.185, z, materials.solar, livingRoof);
      for (let grid = 1; grid < 6; grid += 1) box(0.007, 0.004, 1.48,
        x - 0.6275 + grid * 0.2092, 0.196, z, materials.solarGrid, livingRoof);
      for (let grid = 1; grid < 8; grid += 1) box(1.24, 0.004, 0.007,
        x, 0.196, z - 0.7475 + grid * 0.1869, materials.solarGrid, livingRoof);
    }
  }

  const bedroomRoof = new Group();
  bedroomRoof.name = "sectioned-bedroom-roof";
  roof.add(bedroomRoof);
  box(3.18, 0.12, 2.83, 2.25, 2.805, -1.35, materials.stone, bedroomRoof);
  box(2.08, 0.12, 0.93, 1.7, 2.805, 0.53, materials.stone, bedroomRoof);
  box(3.12, 0.037, 2.77, 2.25, 2.882, -1.35, materials.roof, bedroomRoof);
  box(2.02, 0.037, 0.91, 1.7, 2.882, 0.52, materials.roof, bedroomRoof);
  for (const x of [0.68, 3.82]) box(0.065, 0.11, 2.84, x, 2.882, -1.35, materials.frame, bedroomRoof);
  box(3.19, 0.11, 0.06, 2.25, 2.882, -2.77, materials.frame, bedroomRoof);
  // Fixed exposed insulation remains readable throughout the roof reveal.
  box(1.1, 0.03, 0.97, 3.28, 2.574, 0.525, materials.linen);
  for (const x of [2.74, 3.28, 3.81]) box(0.061, 0.19, 0.99, x, 2.689, 0.525, materials.timberLight);
  for (const z of [0.042, 1.015]) box(1.14, 0.19, 0.055, 3.27, 2.689, z, materials.timberLight);
  for (const x of [3.005, 3.54]) {
    rounded(0.45, 0.17, 0.88, x, 2.69, 0.525, materials.insulation);
    for (let crease = 0; crease < 4; crease += 1) box(0.008, 0.01, 0.8,
      x - 0.17 + crease * 0.11, 2.778, 0.525, materials.insulation);
  }

  // Upholstered modular seating, layered textiles and fine media joinery.
  rounded(2.65, 0.019, 2.02, -2.8, 0.26, 0.07, materials.rug);
  rounded(2.13, 0.19, 0.91, -2.92, 0.4, -0.36, materials.timber);
  for (const x of [-3.62, -2.94, -2.26]) {
    rounded(0.65, 0.23, 0.85, x, 0.61, -0.34, materials.linen);
    rounded(0.65, 0.43, 0.17, x, 0.86, -0.726, materials.linen);
  }
  rounded(0.16, 0.41, 0.99, -4.04, 0.67, -0.39, materials.linen);
  rounded(0.16, 0.41, 0.99, -1.87, 0.67, -0.39, materials.linen);
  rounded(0.7, 0.24, 0.8, -3.61, 0.58, 0.39, materials.linen);
  rounded(0.37, 0.32, 0.15, -3.7, 0.87, -0.55, materials.sage, group, 0.13);
  rounded(0.34, 0.29, 0.13, -2.18, 0.87, -0.55, materials.timberLight, group, -0.15);
  place(geometries.cylinder, materials.timberLight, -2.65, 0.62, 0.81, 0.59, 0.06, 0.38);
  cylinder(0.19, 0.33, -2.65, 0.425, 0.81, materials.frame);
  rounded(0.28, 0.026, 0.22, -2.6, 0.67, 0.83, materials.sage, group, 0.23);
  cylinder(0.064, 0.13, -2.91, 0.718, 0.75, materials.stone);
  box(0.35, 0.34, 1.05, -1.46, 0.43, -0.64, materials.timber);
  rounded(0.037, 0.64, 0.96, -1.47, 1.055, -0.64, materials.screen);
  for (let i = 0; i < 12; i += 1) box(0.015, 0.28, 0.026, -1.277, 0.43, -1.13 + i * 0.087, materials.timberLight);

  // Dining and kitchen are dimensioned to residential proportions.
  place(geometries.cylinder, materials.timberLight, -0.28, 0.97, 0.39, 0.75, 0.075, 0.46);
  for (const x of [-0.74, 0.18]) box(0.075, 0.69, 0.41, x, 0.586, 0.39, materials.timber);
  for (let i = 0; i < 4; i += 1) {
    const x = -0.28 + (i % 2 ? 0.46 : -0.46);
    const z = 0.39 + (i < 2 ? 0.73 : -0.73);
    rounded(0.41, 0.08, 0.39, x, 0.685, z, materials.sage);
    rounded(0.41, 0.4, 0.065, x, 0.91, z + (i < 2 ? 0.17 : -0.17), materials.sage);
    for (const dx of [-0.14, 0.14]) for (const dz of [-0.13, 0.13])
      box(0.025, 0.4, 0.025, x + dx, 0.46, z + dz, materials.frame);
  }
  box(3.85, 0.72, 0.55, -1.48, 0.61, -1.39, materials.timber);
  rounded(3.91, 0.045, 0.61, -1.48, 0.995, -1.39, materials.stone);
  for (let i = 0; i < 9; i += 1) {
    box(0.012, 0.64, 0.024, -3.19 + i * 0.427, 0.61, -1.1, materials.frame);
    box(0.22, 0.014, 0.024, -3.0 + i * 0.427, 0.911, -1.1, materials.frame);
  }
  rounded(0.56, 0.014, 0.36, -1.77, 1.025, -1.39, materials.screen);
  for (const x of [-1.94, -1.6]) cylinder(0.108, 0.005, x, 1.036, -1.39, materials.frame);
  rounded(0.44, 0.011, 0.32, -0.68, 1.025, -1.4, materials.silver);
  rounded(0.36, 0.008, 0.24, -0.68, 1.032, -1.4, materials.screen);
  pipe([new Vector3(-0.68, 1.04, -1.61), new Vector3(-0.68, 1.31, -1.61),
    new Vector3(-0.68, 1.36, -1.43), new Vector3(-0.68, 1.22, -1.4)], 0.016, materials.frame);
  for (const x of [0.97, 1.68]) {
    cylinder(0.013, 0.55, -1.64 + x, 2.79, 0.39, materials.frame, roof);
    place(geometries.sphere, materials.stone, -1.64 + x, 2.45, 0.39, 0.15, 0.12, 0.15, roof);
    cylinder(0.075, 0.012, -1.64 + x, 2.329, 0.39, materials.warm, roof);
  }

  // Bedroom linen, bedside lamps and soft curtain folds.
  rounded(1.83, 0.02, 2.25, 2.18, 0.26, -1.14, materials.rug);
  rounded(1.42, 0.19, 1.98, 2.15, 0.395, -1.2, materials.timber);
  rounded(1.39, 0.21, 1.91, 2.15, 0.586, -1.2, materials.linen);
  rounded(1.39, 0.045, 0.72, 2.15, 0.715, -0.63, materials.sage);
  rounded(1.56, 0.85, 0.085, 2.15, 0.705, -2.21, materials.timberLight);
  for (const x of [1.78, 2.51]) rounded(0.57, 0.13, 0.4, x, 0.763, -1.86, materials.linen);
  for (const x of [1.22, 3.08]) {
    rounded(0.33, 0.38, 0.35, x, 0.43, -1.87, materials.stone);
    cylinder(0.028, 0.21, x, 0.74, -1.87, materials.frame);
    place(geometries.sphere, materials.warm, x, 0.87, -1.87, 0.105, 0.075, 0.105);
  }
  for (let i = 0; i < 10; i += 1) cylinder(0.025, 2.21, 1.1 + i * 0.03, 1.35, 0.76, materials.linen);

  // Balanced ventilation with separate metal supply and extract ducts.
  rounded(0.67, 0.32, 0.59, 2.8, 2.34, -1.76, materials.equipment);
  box(0.57, 0.021, 0.51, 2.8, 2.163, -1.76, materials.silver);
  rounded(0.18, 0.036, 0.14, 2.81, 2.15, -1.67, materials.screen);
  for (let i = 0; i < 5; i += 1) box(0.36, 0.008, 0.013, 2.8, 2.138, -1.93 + i * 0.055, materials.frame);
  pipe([new Vector3(2.57, 2.36, -2.05), new Vector3(2.54, 2.57, -2.2),
    new Vector3(1.84, 2.59, -2.2), new Vector3(1.78, 2.44, -1.95)], 0.077, materials.silver);
  pipe([new Vector3(3.05, 2.36, -2.05), new Vector3(3.13, 2.57, -2.27),
    new Vector3(3.48, 2.57, -2.27), new Vector3(3.5, 2.34, -2.27)], 0.077, materials.silver);
  for (let i = 0; i < 9; i += 1) place(geometries.ring, materials.frame,
    1.93 + i * 0.062, 2.59, -2.2, 0.079, 0.079, 0.079, group, Math.PI / 2);
  cylinder(0.12, 0.022, 1.78, 2.435, -1.95, materials.equipment);

  // Battery and charger against the east service wall.
  rounded(0.45, 1.36, 0.31, 3.86, 0.94, -0.79, materials.equipment);
  rounded(0.39, 1.23, 0.035, 3.86, 0.94, -0.615, materials.silver);
  rounded(0.022, 0.4, 0.014, 3.86, 1.04, -0.59, materials.mint);
  box(0.33, 0.055, 0.25, 3.86, 0.238, -0.79, materials.frame);
  pipe([new Vector3(3.84, 0.3, -0.79), new Vector3(3.69, 0.23, -0.9),
    new Vector3(3.685, 1.8, -0.9)], 0.018, materials.frame);
  rounded(0.14, 0.49, 0.3, 3.73, 1.44, -1.49, materials.frame);
  rounded(0.023, 0.41, 0.25, 3.815, 1.44, -1.49, materials.equipment);
  rounded(0.013, 0.105, 0.13, 3.833, 1.5, -1.49, materials.screen);
  box(0.013, 0.022, 0.1, 3.836, 1.39, -1.49, materials.mint);

  // Reverse-cycle unit with circular fan guard, blades, condenser fins and feet.
  rounded(0.94, 0.75, 0.4, 3.94, 0.585, 0.8, materials.equipment);
  for (const x of [3.63, 4.24]) box(0.1, 0.14, 0.4, x, 0.148, 0.8, materials.frame);
  place(geometries.cylinder, materials.screen, 3.79, 0.62, 1.015, 0.257, 0.025, 0.257, group, 0, Math.PI / 2);
  for (const radius of [0.105, 0.168, 0.227, 0.26]) place(geometries.ring, materials.silver,
    3.79, 0.62, 1.041, radius, radius, radius);
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    strut(new Vector3(3.79, 0.62, 1.046),
      new Vector3(3.79 + Math.cos(angle) * 0.26, 0.62 + Math.sin(angle) * 0.26, 1.046), 0.006, materials.silver);
  }
  for (let i = 0; i < 5; i += 1) place(geometries.rounded, materials.frame,
    3.79 + Math.cos(i * 1.257) * 0.1, 0.62 + Math.sin(i * 1.257) * 0.1, 1.024,
    0.16, 0.066, 0.015, group, 0, 0, i * 1.257 + 0.6);
  place(geometries.sphere, materials.silver, 3.79, 0.62, 1.064, 0.038, 0.038, 0.014);
  for (let i = 0; i < 11; i += 1) box(0.185, 0.018, 0.021, 4.23, 0.317 + i * 0.048, 1.021, materials.frame);
  rounded(0.89, 0.27, 0.2, -0.33, 2.59, -1.61, materials.equipment);
  rounded(0.77, 0.032, 0.045, -0.33, 2.495, -1.495, materials.frame);
  box(0.66, 0.013, 0.06, -0.33, 2.478, -1.478, materials.silver);
  pipe([new Vector3(3.51, 0.46, 0.78), new Vector3(3.69, 0.41, 0.39),
    new Vector3(3.69, 2.27, 0.25)], 0.026, materials.equipment);

  // All-in-one heat-pump hot water: storage cylinder, vented compressor and valves.
  cylinder(0.385, 1.42, 3.65, 0.92, 2.86, materials.equipment);
  place(geometries.sphere, materials.equipment, 3.65, 1.633, 2.86, 0.385, 0.078, 0.385);
  cylinder(0.398, 0.083, 3.65, 0.231, 2.86, materials.frame);
  cylinder(0.385, 0.54, 3.65, 1.918, 2.86, materials.silver);
  cylinder(0.393, 0.045, 3.65, 2.208, 2.86, materials.equipment);
  cylinder(0.319, 0.018, 3.65, 2.239, 2.86, materials.screen);
  for (const radius of [0.115, 0.19, 0.265, 0.316]) place(geometries.ring, materials.silver,
    3.65, 2.254, 2.86, radius, radius, radius, group, 0, Math.PI / 2);
  for (let i = 0; i < 9; i += 1) {
    const angle = -1.09 + i * 0.2725;
    box(0.039, 0.38, 0.018, 3.65 + Math.sin(angle) * 0.384, 1.918,
      2.86 + Math.cos(angle) * 0.384, materials.frame, group, angle);
  }
  rounded(0.135, 0.23, 0.021, 3.65, 1.298, 3.251, materials.screen);
  box(0.076, 0.048, 0.009, 3.65, 1.349, 3.266, materials.mint);
  for (const [y, material] of [[0.43, materials.blue], [1.43, materials.red]] as const) {
    strut(new Vector3(3.31, y, 2.86), new Vector3(3.15, y, 2.86), 0.022, materials.copper);
    cylinder(0.043, 0.025, 3.195, y + 0.04, 2.86, material);
  }
  pipe([new Vector3(3.16, 0.43, 2.86), new Vector3(3.03, 0.43, 2.77),
    new Vector3(3.01, 0.27, 1.26)], 0.018, materials.copper);
  pipe([new Vector3(3.16, 1.43, 2.86), new Vector3(3.025, 1.43, 2.69),
    new Vector3(3.025, 1.43, 1.27)], 0.026, materials.rubber);

  // Curved EV bodywork, glazed cabin, wheel arches and fine trim.
  const car = new Group();
  car.name = "electric-vehicle";
  car.position.set(5.13, 0, 0.61);
  group.add(car);
  place(geometries.carBody, materials.carPaint, 0, 0.66, 0, 1, 1, 1, car);
  rounded(1.64, 0.12, 3.6, 0, 0.39, 0, materials.rubber, car);
  rounded(1.69, 0.14, 1.04, 0, 0.848, 1.343, materials.carPaint, car);
  rounded(1.67, 0.11, 0.69, 0, 0.848, -1.6, materials.carPaint, car);
  const cabin = new BufferGeometry();
  cabin.setAttribute("position", new Float32BufferAttribute([
    -0.808, 0.85, -1.37, 0.808, 0.85, -1.37, 0.808, 0.85, 1.028, -0.808, 0.85, 1.028,
    -0.671, 1.394, -0.868, 0.671, 1.394, -0.868, 0.671, 1.394, 0.422, -0.671, 1.394, 0.422,
  ], 3));
  cabin.setIndex([0, 5, 1, 0, 4, 5, 1, 6, 2, 1, 5, 6, 2, 7, 3, 2, 6, 7,
    3, 4, 0, 3, 7, 4, 4, 6, 5, 4, 7, 6, 0, 2, 3, 0, 1, 2]);
  cabin.computeVertexNormals();
  ownedGeometries.add(cabin);
  place(cabin, materials.carGlass, 0, 0, 0, 1, 1, 1, car);
  rounded(1.384, 0.074, 1.39, 0, 1.43, -0.232, materials.carPaint, car);
  rounded(1.108, 0.012, 1.03, 0, 1.472, -0.22, materials.carGlass, car);
  for (const side of [-1, 1]) {
    strut(new Vector3(side * 0.816, 0.85, 1.058), new Vector3(side * 0.685, 1.409, 0.436), 0.024, materials.carPaint, car);
    strut(new Vector3(side * 0.816, 0.85, -1.389), new Vector3(side * 0.685, 1.409, -0.893), 0.034, materials.carPaint, car);
    strut(new Vector3(side * 0.817, 0.86, -0.295), new Vector3(side * 0.69, 1.405, -0.295), 0.026, materials.frame, car);
    box(0.029, 0.036, 2.45, side * 0.823, 0.845, -0.155, materials.silver, car);
    box(0.018, 0.018, 2.28, side * 0.925, 0.456, -0.06, materials.frame, car);
    for (const z of [-0.48, 0.72]) {
      rounded(0.022, 0.035, 0.175, side * 0.921, 0.793, z, materials.frame, car);
      box(0.007, 0.27, 0.008, side * 0.923, 0.645, z - 0.31, materials.frame, car);
    }
    strut(new Vector3(side * 0.79, 0.997, 0.692), new Vector3(side * 1.035, 1.007, 0.622), 0.026, materials.frame, car);
    rounded(0.217, 0.098, 0.18, side * 1.046, 1.023, 0.618, materials.carPaint, car);
    rounded(0.176, 0.063, 0.012, side * 1.046, 1.023, 0.517, materials.carGlass, car);
    for (const z of [-1.23, 1.22]) {
      place(geometries.tyre, materials.rubber, side * 0.909, 0.405, z, 0.283, 0.283, 0.283, car, Math.PI / 2);
      place(geometries.wheelArch, materials.frame, side * 0.931, 0.405, z, 0.378, 0.378, 0.378, car, Math.PI / 2);
      place(geometries.cylinder, materials.frame, side * 1.003, 0.405, z, 0.222, 0.022, 0.222, car, 0, 0, Math.PI / 2);
      place(geometries.ring, materials.silver, side * 1.023, 0.405, z, 0.215, 0.215, 0.215, car, Math.PI / 2);
      for (let spoke = 0; spoke < 5; spoke += 1) {
        const angle = spoke * Math.PI * 2 / 5;
        strut(new Vector3(side * 1.028, 0.405, z),
          new Vector3(side * 1.029, 0.405 + Math.cos(angle) * 0.19, z + Math.sin(angle) * 0.19), 0.016, materials.silver, car);
      }
      place(geometries.sphere, materials.silver, side * 1.035, 0.405, z, 0.015, 0.044, 0.044, car);
    }
  }
  rounded(1.36, 0.09, 0.035, 0, 0.476, 1.983, materials.frame, car);
  rounded(0.5, 0.038, 0.056, -0.574, 0.794, 1.908, materials.headlight, car);
  rounded(0.5, 0.038, 0.056, 0.574, 0.794, 1.908, materials.headlight, car);
  rounded(1.39, 0.026, 0.031, 0, 0.788, -1.995, materials.taillight, car);
  rounded(0.39, 0.105, 0.016, 0, 0.642, 2.007, materials.equipment, car);
  rounded(0.39, 0.105, 0.016, 0, 0.613, -2.005, materials.equipment, car);
  rounded(0.021, 0.15, 0.19, -0.927, 0.821, -1.472, materials.frame, car);
  pipe([new Vector3(3.84, 1.286, -1.48), new Vector3(4.07, 0.81, -1.49),
    new Vector3(4.07, 0.325, -1.22), new Vector3(4.2, 0.56, -0.98),
    new Vector3(4.2, 0.82, -0.864)], 0.023, materials.rubber);
  rounded(0.1, 0.13, 0.06, 4.197, 0.814, -0.866, materials.frame);

  // Curved individual leaves replace the original faceted canopy spheres.
  const leafGeometry = new BufferGeometry();
  const leafPositions: number[] = [];
  const leafIndices: number[] = [];
  for (let row = 0; row < 5; row += 1) {
    const t = row / 4;
    const width = Math.sin(t * Math.PI) * 0.17;
    leafPositions.push(-width, t, t * t * 0.12, 0, t, t * t * 0.12 + Math.sin(t * Math.PI) * 0.027,
      width, t, t * t * 0.12);
    if (row < 4) {
      const a = row * 3;
      leafIndices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  leafGeometry.setAttribute("position", new Float32BufferAttribute(leafPositions, 3));
  leafGeometry.setIndex(leafIndices);
  leafGeometry.computeVertexNormals();
  ownedGeometries.add(leafGeometry);

  function random(seed: number) {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }
  function nativeTree(x: number, z: number, height: number, seed: number) {
    const next = random(seed);
    pipe([new Vector3(x, 0.08, z), new Vector3(x + 0.065, height * 0.33, z - 0.05),
      new Vector3(x - 0.04, height * 0.68, z + 0.025), new Vector3(x + 0.12, height, z - 0.1)],
    0.051, materials.bark);
    for (let branchIndex = 0; branchIndex < 9; branchIndex += 1) {
      const angle = branchIndex * 2.4 + seed;
      const spread = 0.38 + next() * 0.33;
      const y = height * (0.44 + branchIndex * 0.052);
      const tip = new Vector3(x + Math.cos(angle) * spread, y + 0.4, z + Math.sin(angle) * spread);
      strut(new Vector3(x, y, z), tip, 0.018 + next() * 0.007, materials.bark);
      for (let leaf = 0; leaf < 46; leaf += 1) {
        const turn = next() * Math.PI * 2;
        const radius = Math.sqrt(next()) * 0.4;
        const ly = tip.y + (next() - 0.5) * 0.44;
        place(leafGeometry, leaf % 4 ? materials.leaf : materials.leafLight,
          tip.x + Math.cos(turn) * radius, ly, tip.z + Math.sin(turn) * radius,
          0.45 + next() * 0.2, 0.22 + next() * 0.16, 0.7,
          group, next() * Math.PI * 2, 0.3 + next() * 1.7, (next() - 0.5) * 1.8);
      }
    }
  }
  function plant(x: number, z: number, height: number, seed: number, base = 0.12) {
    const next = random(seed);
    for (let leaf = 0; leaf < 31; leaf += 1) {
      const turn = leaf * 2.4;
      const spread = next() * height * 0.33;
      place(leafGeometry, leaf % 3 ? materials.leafDark : materials.leafLight,
        x + Math.cos(turn) * spread, base + next() * height * 0.28, z + Math.sin(turn) * spread,
        height * 1.2, height * (0.7 + next() * 0.55), 0.5,
        group, turn, 0.3 + next() * 0.7, 0.25 + next() * 0.35);
    }
  }
  rounded(1.12, 0.08, 5.4, -5.05, 0.057, -0.29, materials.soil);
  rounded(2.61, 0.07, 0.85, 1.76, 0.052, 3.81, materials.soil);
  rounded(8.05, 0.07, 0.83, -0.61, 0.052, -3.4, materials.soil);
  nativeTree(-5.25, -1.55, 3.14, 73);
  nativeTree(-5.13, 1.55, 2.63, 181);
  nativeTree(2.86, -3.34, 2.75, 277);
  for (let i = 0; i < 10; i += 1) plant(-5.05, -2.75 + i * 0.52, 0.43 + i % 3 * 0.055, 350 + i);
  for (let i = 0; i < 7; i += 1) plant(0.67 + i * 0.36, 3.8, 0.3 + i % 2 * 0.08, 490 + i);
  for (let i = 0; i < 12; i += 1) plant(-4.21 + i * 0.6, -3.38, 0.39, 650 + i);
  for (const [x, z, scale] of [[-5.14, -2.26, 0.32], [-5.02, 2.17, 0.28], [0.76, 3.83, 0.23]]) {
    place(geometries.sphere, materials.limestone, x, 0.12, z, scale, scale * 0.51, scale * 0.69, group, 0.48);
  }
  for (const [x, z] of [[-3.51, 2.32], [0.94, 2.48]]) {
    cylinder(0.19, 0.35, x, 0.405, z, materials.stone);
    plant(x, z, 0.48, Math.round((x + 4) * 111), 0.58);
  }

  for (const [parent, collection] of batches) {
    for (const { geometry, material, matrices } of collection.values()) {
      const mesh = new InstancedMesh(geometry, material, matrices.length);
      mesh.name = (parent.name || "pavilion") + "-" + material.name;
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = !material.transparent && material !== materials.mint && material !== materials.warm;
      mesh.receiveShadow = !material.transparent;
      mesh.computeBoundingSphere();
      parent.add(mesh);
      instances.push(mesh);
    }
  }
  batches.clear();
  let disposed = false;
  return {
    group, roof, features,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of instances) mesh.dispose();
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      group.clear();
    },
  };
}
