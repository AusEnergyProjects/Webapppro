import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

export interface HomeEnergyModel {
  group: Group;
  roof: Group;
  dispose: () => void;
}

/** A metre-scale architectural miniature. The entrance faces +Z. */
export function createHomeEnergyModel(): HomeEnergyModel {
  const group = new Group();
  group.name = "home-energy-model";
  const roof = new Group();
  roof.name = "removable-roof-and-solar";
  group.add(roof);

  const geometries = {
    box: new BoxGeometry(1, 1, 1),
    cylinder: new CylinderGeometry(1, 1, 1, 12),
    branch: new CylinderGeometry(0.62, 1, 1, 7),
    foliage: new IcosahedronGeometry(1, 1),
  };
  const materials = {
    stone: new MeshStandardMaterial({ color: "#e1d5bd", roughness: 0.82 }),
    limestone: new MeshStandardMaterial({ color: "#b5b09f", roughness: 0.88 }),
    floor: new MeshStandardMaterial({ color: "#c19b70", roughness: 0.74 }),
    timber: new MeshStandardMaterial({ color: "#9a6948", roughness: 0.78 }),
    timberLight: new MeshStandardMaterial({ color: "#bf9667", roughness: 0.7 }),
    frame: new MeshStandardMaterial({ color: "#172e34", roughness: 0.38, metalness: 0.5 }),
    roof: new MeshStandardMaterial({ color: "#34454c", roughness: 0.44, metalness: 0.48 }),
    silver: new MeshStandardMaterial({ color: "#aabbb9", roughness: 0.32, metalness: 0.7 }),
    glass: new MeshStandardMaterial({
      color: "#b6ede3", roughness: 0.12, metalness: 0.2,
      transparent: true, opacity: 0.17, depthWrite: false,
    }),
    plinth: new MeshStandardMaterial({ color: "#112b35", roughness: 0.28, metalness: 0.65 }),
    paving: new MeshStandardMaterial({ color: "#7e918c", roughness: 0.85 }),
    soil: new MeshStandardMaterial({ color: "#293e36", roughness: 1 }),
    leaf: new MeshStandardMaterial({ color: "#547d61", roughness: 1 }),
    leafLight: new MeshStandardMaterial({ color: "#88a37b", roughness: 1 }),
    leafDark: new MeshStandardMaterial({ color: "#31574c", roughness: 1 }),
    bark: new MeshStandardMaterial({ color: "#b2a48b", roughness: 1 }),
    linen: new MeshStandardMaterial({ color: "#f3e8d2", roughness: 1 }),
    sage: new MeshStandardMaterial({ color: "#81988a", roughness: 1 }),
    rug: new MeshStandardMaterial({ color: "#d3c5a7", roughness: 1 }),
    screen: new MeshStandardMaterial({ color: "#132b32", roughness: 0.28, metalness: 0.2 }),
    solar: new MeshStandardMaterial({ color: "#153b58", roughness: 0.24, metalness: 0.65 }),
    solarGrid: new MeshStandardMaterial({ color: "#557d8e", roughness: 0.4, metalness: 0.5 }),
    mint: new MeshStandardMaterial({
      color: "#a7ffe0", emissive: "#51ecc0", emissiveIntensity: 1.5,
      roughness: 0.36, metalness: 0.15,
    }),
    warm: new MeshStandardMaterial({
      color: "#ffe3aa", emissive: "#ffc875", emissiveIntensity: 0.85, roughness: 0.65,
    }),
  };

  // Repeated architectural elements share geometry and are drawn in material batches.
  // Roof batches remain beneath their own group so lifting it does not rebuild the model.
  type Batch = { geometry: BufferGeometry; material: MeshStandardMaterial; matrices: Matrix4[] };
  const batches = new Map<Group, Map<string, Batch>>();
  const transform = new Object3D();
  const instances: InstancedMesh[] = [];

  function place(
    geometry: BufferGeometry, material: MeshStandardMaterial,
    x: number, y: number, z: number, sx: number, sy: number, sz: number,
    parent: Group = group, yaw = 0,
  ) {
    transform.position.set(x, y, z);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    record(geometry, material, transform.matrix, parent);
  }

  function record(geometry: BufferGeometry, material: MeshStandardMaterial, matrix: Matrix4, parent: Group) {
    let parentBatches = batches.get(parent);
    if (!parentBatches) {
      parentBatches = new Map();
      batches.set(parent, parentBatches);
    }
    const key = `${geometry.uuid}:${material.uuid}`;
    let batch = parentBatches.get(key);
    if (!batch) {
      batch = { geometry, material, matrices: [] };
      parentBatches.set(key, batch);
    }
    batch.matrices.push(matrix.clone());
  }

  function box(
    width: number, height: number, depth: number,
    x: number, y: number, z: number, material: MeshStandardMaterial,
    parent: Group = group, yaw = 0,
  ) {
    place(geometries.box, material, x, y, z, width, height, depth, parent, yaw);
  }

  function cylinder(radius: number, height: number, x: number, y: number, z: number, material: MeshStandardMaterial) {
    place(geometries.cylinder, material, x, y, z, radius, height, radius);
  }

  function branch(start: Vector3, end: Vector3, radius: number) {
    const direction = end.clone().sub(start);
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
    const matrix = new Matrix4().compose(
      start.clone().add(end).multiplyScalar(0.5), rotation,
      new Vector3(radius, direction.length(), radius),
    );
    record(geometries.branch, materials.bark, matrix, group);
  }

  // Window spans run along X or Z. Transparent panes keep the cutaway readable.
  function windowBay(x: number, y: number, z: number, width: number, height: number, along: "x" | "z") {
    const horizontal = along === "x";
    box(horizontal ? width : 0.024, height, horizontal ? 0.024 : width, x, y, z, materials.glass);
    for (const edge of [-1, 1]) {
      box(horizontal ? width + 0.07 : 0.07, 0.065, horizontal ? 0.07 : width + 0.07,
        x, y + edge * height / 2, z, materials.frame);
      box(0.065, height, 0.065,
        x + (horizontal ? edge * width / 2 : 0), y, z + (horizontal ? 0 : edge * width / 2), materials.frame);
    }
  }

  // Layered model base, fine mint reveal, and individual paving joints.
  box(9.8, 0.32, 7.5, 0, -0.28, 0, materials.plinth);
  box(9.62, 0.045, 7.32, 0, -0.098, 0, materials.mint);
  box(9.74, 0.12, 7.44, 0, -0.015, 0, materials.paving);
  box(7.2, 0.15, 5.05, -0.05, 0.12, -0.05, materials.limestone);
  box(6.65, 0.085, 4.55, -0.05, 0.24, -0.05, materials.floor);
  for (let i = 0; i < 13; i += 1) {
    box(0.012, 0.008, 4.48, -3.15 + i * 0.52, 0.286, -0.05, materials.timber);
  }
  for (let i = 0; i < 8; i += 1) {
    box(0.54, 0.045, 0.79, -2.18 + i * 0.63, 0.064, 3.18, materials.limestone);
  }
  box(1.55, 0.11, 0.38, -2.48, 0.1, 2.71, materials.stone);
  box(1.72, 0.06, 0.3, -2.48, 0.075, 3, materials.stone);

  // Ground-floor structure: stone piers, deep lintels, and timber-lined entrance.
  for (const x of [-3.38, -0.52, 3.28]) {
    box(0.2, 2.17, 0.25, x, 1.36, 2.13, materials.stone);
    box(0.2, 2.17, 0.25, x, 1.36, -2.22, materials.stone);
  }
  box(6.86, 0.24, 4.73, -0.05, 2.47, -0.05, materials.stone);
  box(6.94, 0.06, 4.81, -0.05, 2.61, -0.05, materials.frame);
  box(6.6, 0.045, 0.035, -0.05, 2.335, 2.15, materials.warm);
  box(0.23, 2.13, 1.3, -3.38, 1.35, -1.56, materials.stone);
  box(0.23, 2.13, 0.52, 3.28, 1.35, -1.96, materials.stone);
  box(0.22, 2.13, 0.52, 3.28, 1.35, 1.98, materials.stone);
  box(1.12, 2.12, 0.14, -2.71, 1.35, 1.42, materials.timber);
  for (let i = 0; i < 12; i += 1) {
    box(0.035, 2.11, 0.065, -3.21 + i * 0.087, 1.35, 1.52, materials.timberLight);
  }
  box(0.035, 0.38, 0.045, -2.3, 1.27, 1.565, materials.silver);
  box(1.36, 2.11, 0.13, -2.64, 1.35, -2.21, materials.stone);
  box(1.32, 2.11, 0.13, 2.59, 1.35, -2.21, materials.stone);
  for (const x of [-1.65, -0.34, 0.97]) windowBay(x, 1.35, -2.21, 1.23, 1.99, "x");
  for (const x of [-1.64, 0.37, 1.83]) windowBay(x, 1.34, 2.14, x === -1.64 ? 1.85 : 1.36, 1.99, "x");
  for (const z of [-0.83, 0.63]) windowBay(3.28, 1.35, z, 1.39, 1.99, "z");
  windowBay(-3.38, 1.35, 0.38, 2.38, 1.99, "z");

  // Upper level is set back behind a usable balcony and has a deliberately open front.
  box(5.65, 0.12, 3.65, 0.45, 2.72, -0.46, materials.floor);
  box(5.77, 0.22, 0.18, 0.45, 2.84, -2.21, materials.stone);
  box(0.18, 1.78, 0.25, -2.42, 3.6, -2.19, materials.stone);
  box(0.18, 1.78, 0.25, 3.28, 3.6, -2.19, materials.stone);
  box(5.87, 0.19, 0.24, 0.43, 4.41, -2.21, materials.stone);
  for (const x of [-1.66, -0.21, 1.24, 2.69]) windowBay(x, 3.61, -2.21, 1.34, 1.43, "x");
  box(0.18, 1.76, 0.64, -2.42, 3.6, -1.76, materials.stone);
  box(0.18, 1.76, 0.64, 3.28, 3.6, -1.76, materials.stone);
  for (const x of [-2.42, 3.28]) {
    windowBay(x, 3.57, -0.3, 2.1, 1.63, "z");
    box(0.19, 1.76, 0.18, x, 3.6, 1.25, materials.stone);
  }
  // A low partition makes the bedroom and study visible when the roof is lifted.
  box(0.105, 0.95, 2.75, 0.66, 3.24, -0.65, materials.stone);
  box(0.105, 0.94, 0.55, -0.92, 3.24, -1.88, materials.stone);
  box(5.8, 0.14, 0.18, 0.44, 4.43, 1.28, materials.stone);
  for (const x of [-1.7, -0.28, 1.14, 2.56]) windowBay(x, 3.63, 1.3, 1.32, 1.55, "x");
  box(5.65, 0.038, 0.034, 0.43, 4.32, 1.22, materials.warm);
  for (let i = 0; i < 17; i += 1) {
    box(0.07, 1.79, 0.08, -3.16 + i * 0.043, 3.6, -0.9, i % 3 ? materials.timber : materials.timberLight);
  }
  // Balcony glazing is kept low enough to reveal the upstairs furniture.
  for (const x of [-2.25, -0.67, 0.91, 2.49]) windowBay(x, 3.08, 2.18, 1.48, 0.81, "x");
  for (const x of [-3.08, 3.28]) windowBay(x, 3.08, 1.71, 0.9, 0.81, "z");

  // Floating roof planes and restrained standing-seam detailing.
  box(5.99, 0.12, 3.89, 0.43, 4.57, -0.46, materials.stone, roof);
  box(6.12, 0.11, 4.02, 0.43, 4.685, -0.46, materials.roof, roof);
  box(1.09, 0.14, 3.03, -2.93, 4.38, -0.88, materials.roof, roof);
  box(1.02, 0.055, 2.96, -2.93, 4.278, -0.88, materials.timberLight, roof);
  for (let i = 0; i < 20; i += 1) {
    box(0.018, 0.018, 3.99, -2.5 + i * 0.309, 4.75, -0.46, materials.silver, roof);
  }
  for (const x of [-2.52, 3.39]) box(0.065, 0.1, 4.03, x, 4.735, -0.46, materials.frame, roof);
  for (const z of [-2.46, 1.54]) box(6.11, 0.1, 0.065, 0.43, 4.735, z, materials.frame, roof);
  box(1.03, 0.07, 0.76, -2.91, 4.475, -1.31, materials.frame, roof);
  box(0.87, 0.035, 0.61, -2.91, 4.532, -1.31, materials.glass, roof);

  const solar = new Group();
  solar.name = "pitched-solar-array";
  solar.position.set(0.48, 5.06, -0.49);
  solar.rotation.x = -0.2;
  roof.add(solar);
  for (const x of [-1.5, 2.38]) {
    box(0.05, 0.28, 0.06, x, 4.9, -1.49, materials.frame, roof);
    box(0.05, 0.66, 0.06, x, 5.06, 0.61, materials.frame, roof);
  }
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      const x = (column - 1) * 1.48;
      const z = (row - 0.5) * 1.23;
      box(1.42, 0.064, 1.17, x, 0, z, materials.silver, solar);
      box(1.35, 0.02, 1.1, x, 0.046, z, materials.solar, solar);
      for (let line = 1; line < 6; line += 1) {
        box(0.009, 0.008, 1.085, x - 0.675 + line * 0.225, 0.062, z, materials.solarGrid, solar);
      }
      for (let line = 1; line < 4; line += 1) {
        box(1.335, 0.008, 0.009, x, 0.062, z - 0.55 + line * 0.275, materials.solarGrid, solar);
      }
    }
  }

  // Lounge: layered cushions, round coffee table, woven rug, and a small media cabinet.
  box(2.05, 0.025, 1.65, -1.3, 0.308, 0.35, materials.rug);
  box(1.72, 0.15, 0.76, -1.64, 0.49, 0.08, materials.timber);
  for (const x of [-2.16, -1.64, -1.12]) {
    box(0.5, 0.21, 0.7, x, 0.66, 0.1, materials.linen);
    box(0.5, 0.42, 0.18, x, 0.88, -0.22, materials.linen);
  }
  for (const x of [-2.56, -0.72]) box(0.14, 0.39, 0.86, x, 0.74, 0.06, materials.linen);
  box(0.29, 0.26, 0.16, -2.25, 0.91, -0.02, materials.sage, group, 0.2);
  cylinder(0.43, 0.075, -1.5, 0.67, 1.21, materials.timberLight);
  cylinder(0.18, 0.32, -1.5, 0.47, 1.21, materials.frame);
  cylinder(0.13, 0.022, -1.53, 0.721, 1.19, materials.stone);
  box(0.39, 0.055, 0.27, -1.33, 0.74, 1.17, materials.sage, group, -0.18);
  box(0.35, 0.39, 1.36, -0.22, 0.53, -0.38, materials.timber);
  box(0.035, 0.72, 1.11, -0.27, 1.15, -0.38, materials.screen);

  // Dining and kitchen, visible through the east and rear glazing.
  cylinder(0.58, 0.09, 1.63, 1.03, 0.63, materials.timberLight);
  cylinder(0.13, 0.66, 1.63, 0.66, 0.63, materials.frame);
  for (let i = 0; i < 4; i += 1) {
    const angle = i * Math.PI / 2;
    const x = 1.63 + Math.cos(angle) * 0.83;
    const z = 0.63 + Math.sin(angle) * 0.83;
    box(0.38, 0.08, 0.38, x, 0.72, z, materials.sage);
    box(0.31, 0.36, 0.055, x + Math.cos(angle) * 0.18, 0.91, z + Math.sin(angle) * 0.18,
      materials.sage, group, Math.PI / 2 - angle);
    for (const dx of [-0.13, 0.13]) for (const dz of [-0.13, 0.13]) {
      box(0.034, 0.4, 0.034, x + dx, 0.49, z + dz, materials.timber);
    }
  }
  box(2.25, 0.7, 0.54, 1.16, 0.66, -1.75, materials.stone);
  box(2.34, 0.06, 0.6, 1.16, 1.04, -1.75, materials.linen);
  for (let i = 0; i < 5; i += 1) {
    box(0.012, 0.62, 0.02, 0.24 + i * 0.45, 0.67, -1.473, materials.timber);
    box(0.1, 0.022, 0.026, 0.45 + i * 0.45, 0.93, -1.461, materials.frame);
  }
  box(0.66, 0.022, 0.37, 0.77, 1.083, -1.75, materials.screen);
  for (const x of [0.59, 0.95]) cylinder(0.11, 0.012, x, 1.1, -1.75, materials.frame);
  cylinder(0.027, 0.23, 1.87, 1.18, -1.86, materials.silver);
  box(0.025, 0.025, 0.16, 1.87, 1.31, -1.79, materials.silver);

  // Upstairs bedroom and study, with warm recessed strips under the roof.
  box(1.9, 0.025, 2.25, -1.03, 2.801, -0.2, materials.rug);
  box(1.46, 0.23, 1.94, -1.04, 2.95, -0.3, materials.timber);
  box(1.4, 0.2, 1.86, -1.04, 3.15, -0.3, materials.linen);
  box(1.4, 0.055, 0.66, -1.04, 3.278, 0.23, materials.sage);
  for (const x of [-1.41, -0.68]) {
    place(geometries.foliage, materials.linen, x, 3.31, -0.93, 0.3, 0.12, 0.23);
  }
  box(1.53, 0.66, 0.09, -1.04, 3.24, -1.3, materials.timberLight);
  for (const x of [-2.06, -0.03]) {
    box(0.34, 0.4, 0.38, x, 3, -1.06, materials.stone);
    cylinder(0.09, 0.15, x, 3.28, -1.06, materials.warm);
  }
  box(1.73, 0.09, 0.61, 2.03, 3.52, -1.72, materials.timberLight);
  for (const x of [1.34, 2.72]) box(0.075, 0.72, 0.49, x, 3.12, -1.72, materials.frame);
  box(0.56, 0.39, 0.035, 2.1, 3.8, -1.89, materials.frame);
  box(0.5, 0.32, 0.012, 2.1, 3.8, -1.863, materials.screen);
  box(0.27, 0.025, 0.21, 2.1, 3.578, -1.73, materials.silver);
  box(0.52, 0.12, 0.48, 2.05, 3.15, -0.84, materials.sage);
  box(0.52, 0.55, 0.07, 2.05, 3.43, -0.62, materials.sage);
  cylinder(0.075, 0.33, 2.05, 2.94, -0.84, materials.frame);
  cylinder(0.28, 0.045, 2.05, 2.793, -0.84, materials.frame);
  box(1.49, 0.19, 0.51, 1.92, 2.96, 0.57, materials.stone);
  for (let i = 0; i < 6; i += 1) box(0.115, 0.25 + (i % 2) * 0.09, 0.22,
    1.39 + i * 0.16, 3.19, 0.57, i % 2 ? materials.timber : materials.sage);

  // Household equipment and a precise visible energy path at the east side.
  box(0.57, 1.3, 0.38, 3.86, 0.75, 0.45, materials.silver);
  box(0.51, 1.2, 0.035, 3.86, 0.75, 0.658, materials.linen);
  box(0.025, 0.61, 0.02, 3.86, 0.87, 0.685, materials.mint);
  box(0.46, 0.07, 0.38, 3.86, 0.12, 0.45, materials.frame);
  box(0.73, 0.79, 0.52, 3.94, 0.48, -1.15, materials.stone);
  box(0.62, 0.64, 0.035, 3.94, 0.5, -0.869, materials.frame);
  for (let i = 0; i < 9; i += 1) {
    box(0.59, 0.027, 0.024, 3.94, 0.23 + i * 0.066, -0.843, materials.silver);
  }
  box(0.032, 0.024, 1.37, 4.17, 0.07, 1.22, materials.mint);
  box(0.88, 0.024, 0.032, 3.75, 0.07, 1.91, materials.mint);
  box(0.027, 1.07, 0.032, 3.34, 0.61, 1.91, materials.mint);
  box(0.37, 0.026, 0.032, 3.68, 0.12, 0.45, materials.mint);

  function planter(x: number, z: number, width: number, depth: number) {
    box(width, 0.21, depth, x, 0.15, z, materials.plinth);
    box(width - 0.09, 0.045, depth - 0.09, x, 0.269, z, materials.soil);
  }

  function shrub(x: number, z: number, size: number, seed: number, base = 0.28) {
    for (let i = 0; i < 5; i += 1) {
      const angle = i * 2.4 + seed;
      const radius = size * (i ? 0.42 : 0);
      place(geometries.foliage, i % 2 ? materials.leafDark : materials.leaf,
        x + Math.cos(angle) * radius, base + size * 0.48, z + Math.sin(angle) * radius,
        size * 0.44, size * (0.53 + (i % 2) * 0.15), size * 0.39);
    }
  }

  function tree(x: number, z: number, height: number, seed: number) {
    const bottom = new Vector3(x, 0.27, z);
    const top = new Vector3(x + 0.14, height, z - 0.08);
    branch(bottom, top, 0.055);
    for (let i = 0; i < 7; i += 1) {
      const angle = seed + i * 2.4;
      const spread = 0.38 + (i % 3) * 0.15;
      const branchY = height * (0.59 + (i % 3) * 0.12);
      const tip = new Vector3(x + Math.cos(angle) * spread, branchY + 0.43, z + Math.sin(angle) * spread);
      branch(new Vector3(x + 0.09, branchY, z), tip, 0.024);
      for (let leaf = 0; leaf < 3; leaf += 1) {
        const offset = angle + leaf * 2.1;
        place(geometries.foliage, (i + leaf) % 3 ? materials.leaf : materials.leafLight,
          tip.x + Math.cos(offset) * 0.16, tip.y + leaf * 0.07, tip.z + Math.sin(offset) * 0.16,
          0.25 + leaf * 0.025, 0.31, 0.22);
      }
    }
  }

  planter(-4.08, -1.93, 1.02, 2.13);
  planter(4.11, -2.88, 1.02, 0.83);
  planter(1.4, 2.72, 2.34, 0.47);
  planter(-3.96, 1.87, 1.07, 1.05);
  tree(-4.11, -1.84, 2.9, 0.3);
  tree(4.12, -2.86, 2.52, 1.3);
  tree(-3.97, 1.88, 2.25, 2.6);
  for (let i = 0; i < 7; i += 1) shrub(0.43 + i * 0.32, 2.73, 0.28, i);
  for (let i = 0; i < 4; i += 1) shrub(-4.1, -2.61 + i * 0.43, 0.32, i);
  for (const [x, z] of [[-3.94, 1.65], [4.1, -2.98], [-4.24, -2.36]]) {
    place(geometries.foliage, materials.limestone, x, 0.36, z, 0.24, 0.13, 0.18);
  }
  // Small ceramic planters soften the balcony and front entrance.
  for (const [x, y, z] of [[-2.86, 2.91, 1.68], [2.98, 2.91, 1.75], [-2.74, 0.45, 1.9]]) {
    place(geometries.branch, materials.stone, x, y, z, 0.15, 0.37, 0.15);
    shrub(x, z, 0.25, x, y + 0.16);
  }

  for (const [parent, parentBatches] of batches) {
    for (const { geometry, material, matrices } of parentBatches.values()) {
      const mesh = new InstancedMesh(geometry, material, matrices.length);
      mesh.name = `${parent.name || "house"}-${material.uuid}`;
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
    group,
    roof,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of instances) mesh.dispose();
      for (const geometry of Object.values(geometries)) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      group.clear();
    },
  };
}
