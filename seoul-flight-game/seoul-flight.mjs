import * as THREE from "./vendor/three.module.js";

const dom = {
  root: document.getElementById("game-root"),
  speedValue: document.getElementById("speed-value"),
  altitudeValue: document.getElementById("altitude-value"),
  headingValue: document.getElementById("heading-value"),
  headingCardinal: document.getElementById("heading-cardinal"),
  timerValue: document.getElementById("timer-value"),
  targetName: document.getElementById("target-name"),
  distanceValue: document.getElementById("distance-value"),
  bearingValue: document.getElementById("bearing-value"),
  statusText: document.getElementById("status-text"),
  startPanel: document.getElementById("start-panel"),
  startBtn: document.getElementById("start-btn"),
  messagePanel: document.getElementById("message-panel"),
  messageTag: document.getElementById("message-tag"),
  messageTitle: document.getElementById("message-title"),
  messageBody: document.getElementById("message-body"),
  restartBtn: document.getElementById("restart-btn"),
  horizonInner: document.getElementById("horizon-inner"),
  mapCredit: document.getElementById("map-credit"),
  miniMap: document.getElementById("mini-map"),
  touchButtons: Array.from(document.querySelectorAll("[data-control]")),
};

const world = {
  width: 3200,
  depth: 2300,
  ceiling: 720,
  boundaryPadding: 140,
};

const riverWidth = 284;
let riverPath = [];
let hillDefs = [];
let noBuildZones = [];
let districtDefs = [];
let landmarkDefs = [];
let checkpointDefs = [];
let bridgeDefs = [];

const buildingMaterials = [
  [
    new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.92, metalness: 0.06 }),
    new THREE.MeshStandardMaterial({ color: 0x7d8d9f, roughness: 0.72, metalness: 0.2, emissive: 0x13253a, emissiveIntensity: 0.14 }),
  ],
  [
    new THREE.MeshStandardMaterial({ color: 0xd6e3ee, roughness: 0.7, metalness: 0.16 }),
    new THREE.MeshStandardMaterial({ color: 0x8ba4bd, roughness: 0.46, metalness: 0.42, emissive: 0x122844, emissiveIntensity: 0.18 }),
  ],
  [
    new THREE.MeshStandardMaterial({ color: 0x9aa8b7, roughness: 0.68, metalness: 0.12 }),
    new THREE.MeshStandardMaterial({ color: 0x5d7085, roughness: 0.58, metalness: 0.32, emissive: 0x14263e, emissiveIntensity: 0.16 }),
  ],
];

const shared = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 24),
  towerRing: new THREE.TorusGeometry(1, 0.14, 12, 48),
  beam: new THREE.CylinderGeometry(1, 1.4, 1, 20, 1, true),
};

const state = {
  mode: "intro",
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  roll: 0,
  speed: 0,
  elapsedMs: 0,
  startedAt: 0,
  checkpointIndex: 0,
};

const input = {
  pitchUp: false,
  pitchDown: false,
  bankLeft: false,
  bankRight: false,
  yawLeft: false,
  yawRight: false,
  boost: false,
  level: false,
};

const runtime = {
  scene: null,
  camera: null,
  renderer: null,
  sun: null,
  cockpitLight: null,
  lastTime: performance.now(),
  checkpointGroups: [],
  clouds: [],
  riverSamples: [],
  waterMasks: [],
  boundaryBeacons: [],
  projectedMap: null,
  rasterMapImage: null,
  miniMapBase: null,
  pointerLocked: false,
  lookRollVelocity: 0,
  currentStatus: "서울 상공 뷰를 준비 중입니다.",
};

const urlParams = new URLSearchParams(window.location.search);

dom.statusText.textContent = "서울 공역 로딩 중...";

try {
  await init();
} catch (error) {
  showFatalError(error);
}

async function init() {
  const mapData = await loadMapData();
  runtime.rasterMapImage = await loadRasterMapImage();
  configureSeoulMap(mapData);
  buildMiniMapBase();
  setupThree();
  buildWorld();
  bindEvents();
  resetFlight();
  dom.mapCredit.textContent = mapData.attribution;
  if (urlParams.get("autostart") === "1") {
    startGame();
  }
  updateHud();
  requestAnimationFrame(loop);
}

function showFatalError(error) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  runtime.currentStatus = `초기화 오류: ${message}`;
  dom.startPanel.classList.add("hidden");
  dom.messageTag.textContent = "SYSTEM";
  dom.messageTitle.textContent = "초기화 오류";
  dom.messageBody.textContent = message;
  dom.messagePanel.classList.remove("hidden");
  updateHud();
}

async function loadMapData() {
  const response = await fetch("./assets/seoul-scene-data.json");
  if (!response.ok) {
    throw new Error(`Map data load failed (${response.status})`);
  }
  return response.json();
}

async function loadRasterMapImage() {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => {
      console.warn("Raster map image unavailable. Falling back to vector texture.");
      resolve(null);
    };
    image.src = "./assets/seoul-raster-map.png";
  });
}

function configureSeoulMap(mapData) {
  const mercMinX = mercatorX(mapData.bbox.minLon);
  const mercMaxX = mercatorX(mapData.bbox.maxLon);
  const mercMinY = mercatorY(mapData.bbox.minLat);
  const mercMaxY = mercatorY(mapData.bbox.maxLat);
  const spanX = mercMaxX - mercMinX;
  const spanY = mercMaxY - mercMinY;
  const scale = Math.min((world.width - 320) / spanX, (world.depth - 320) / spanY);
  const centerX = (mercMinX + mercMaxX) * 0.5;
  const centerY = (mercMinY + mercMaxY) * 0.5;

  const project = (lon, lat) => ({
    x: (mercatorX(lon) - centerX) * scale,
    z: -(mercatorY(lat) - centerY) * scale,
  });

  runtime.projectedMap = {
    attribution: mapData.attribution,
    waterPolygons: mapData.waterPolygons.map((points) => projectLine(points, project)),
    waterLines: mapData.waterLines.map((points) => projectLine(points, project)),
    roads: {
      trunk: mapData.roads.trunk.map((points) => projectLine(points, project)),
      primary: mapData.roads.primary.map((points) => projectLine(points, project)),
      secondary: mapData.roads.secondary.map((points) => projectLine(points, project)),
    },
    route: projectLine(mapData.route.points, project),
    buildings: mapData.buildings.map((building) => projectBuilding(building, project)).filter(Boolean),
  };

  runtime.waterMasks = runtime.projectedMap.waterPolygons
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => {
      const bounds = polygonBounds(polygon);
      const signedArea = polygonSignedArea(polygon);
      const anchor = polygonCentroid(polygon, signedArea);
      return {
        points: polygon,
        minX: bounds.minX,
        maxX: bounds.maxX,
        minZ: bounds.minZ,
        maxZ: bounds.maxZ,
        anchorX: anchor.x,
        anchorZ: anchor.z,
      };
    });

  riverPath = pickLongestLine(runtime.projectedMap.waterLines).map(([x, z]) => new THREE.Vector2(x, z));
  if (riverPath.length < 2) {
    throw new Error("River path missing from map data");
  }

  const landmarkPositions = {
    sixtythree: project(mapData.landmarks.sixtythree.lon, mapData.landmarks.sixtythree.lat),
    gyeongbokgung: project(mapData.landmarks.gyeongbokgung.lon, mapData.landmarks.gyeongbokgung.lat),
    nseoul: project(mapData.landmarks.nseoul.lon, mapData.landmarks.nseoul.lat),
    coex: project(mapData.landmarks.coex.lon, mapData.landmarks.coex.lat),
    lotte: project(mapData.landmarks.lotte.lon, mapData.landmarks.lotte.lat),
  };

  landmarkDefs = [
    { id: "sixtythree", label: "63빌딩", create: create63Building, height: 254, colliderRadius: 34, ...landmarkPositions.sixtythree },
    { id: "gyeongbokgung", label: "경복궁", create: createGyeongbokgung, height: 26, colliderRadius: 84, ...landmarkPositions.gyeongbokgung },
    { id: "nseoul", label: "N서울타워", create: createSeoulTower, height: 246, colliderRadius: 28, ...landmarkPositions.nseoul },
    { id: "coex", label: "COEX", create: createCoexTower, height: 214, colliderRadius: 32, ...landmarkPositions.coex },
    { id: "lotte", label: "롯데월드타워", create: createLotteTower, height: 548, colliderRadius: 42, ...landmarkPositions.lotte },
  ];

  checkpointDefs = [
    { name: "63빌딩", y: 220, radius: 68, note: "여의도 구간을 보는 중입니다.", ...landmarkPositions.sixtythree },
    { name: "경복궁", y: 252, radius: 76, note: "종로 북쪽 구간을 보는 중입니다.", ...landmarkPositions.gyeongbokgung },
    { name: "N서울타워", y: 330, radius: 84, note: "남산 상공을 보는 중입니다.", ...landmarkPositions.nseoul },
    { name: "COEX", y: 262, radius: 82, note: "강남 업무지구를 보는 중입니다.", ...landmarkPositions.coex },
    { name: "롯데월드타워", y: 388, radius: 92, note: "잠실 구간을 보는 중입니다.", ...landmarkPositions.lotte },
  ];

  noBuildZones = landmarkDefs.map((landmark) => ({
    x: landmark.x,
    z: landmark.z,
    radius: landmark.colliderRadius + 90,
  }));

  districtDefs = [
    makeDistrict(project, "MAPO", 126.9105, 37.5485, 330, 220, 18, 90, 11, 0),
    makeDistrict(project, "YEOUIDO", 126.9267, 37.5254, 210, 150, 14, 136, 31, 1),
    makeDistrict(project, "JONGNO", 126.9840, 37.5720, 260, 190, 20, 88, 51, 2),
    makeDistrict(project, "YONGSAN", 126.9765, 37.5348, 260, 180, 20, 112, 71, 0),
    makeDistrict(project, "SEONGSU", 127.0468, 37.5440, 250, 160, 16, 120, 91, 2),
    makeDistrict(project, "GANGNAM", 127.0285, 37.4985, 430, 250, 30, 162, 111, 1),
    makeDistrict(project, "JAMSIL", 127.0870, 37.5160, 260, 170, 16, 122, 131, 0),
  ];

  hillDefs = [
    makeHill(project, 126.9882805, 37.5512700, 160, 76, 0x516f46),
    makeHill(project, 126.9750, 37.5920, 220, 58, 0x445d40),
    makeHill(project, 127.0740, 37.5660, 210, 48, 0x4c6447),
    makeHill(project, 127.0300, 37.4810, 240, 40, 0x4a6144),
  ];

  bridgeDefs = [
    makeBridge(project, "양화대교", 126.9052, 37.5435, 300, 0.08),
    makeBridge(project, "마포대교", 126.9359, 37.5392, 290, 0.1),
    makeBridge(project, "반포대교", 126.9950, 37.5140, 318, 0.14),
    makeBridge(project, "청담대교", 127.0668, 37.5262, 302, 0.08),
    makeBridge(project, "올림픽대교", 127.1036105, 37.5343153, 336, 0.02),
  ];
}

function setupThree() {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: "default",
    failIfMajorPerformanceCaveat: false,
    precision: "mediump",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  dom.root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9acdf8);
  scene.fog = new THREE.Fog(0x98c8eb, 850, 3400);

  const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.5, 6000);
  camera.position.set(0, 200, 0);

  const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x36503c, 2.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff6df, 2.7);
  sun.position.set(460, 980, -220);
  scene.add(sun);

  const cockpitLight = new THREE.PointLight(0x8fe7ff, 0.48, 320);
  camera.add(cockpitLight);
  scene.add(camera);

  runtime.renderer = renderer;
  runtime.scene = scene;
  runtime.camera = camera;
  runtime.sun = sun;
  runtime.cockpitLight = cockpitLight;
}

function buildWorld() {
  const scene = runtime.scene;

  const groundTexture = createGroundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(world.width, world.depth),
    new THREE.MeshStandardMaterial({
      map: groundTexture,
      roughness: 0.98,
      metalness: 0.04,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const river = createRiverMesh();
  scene.add(river);

  const waterGlow = createRiverMesh(riverWidth * 0.56, 2.4, 0x74d8ff, 0.28);
  scene.add(waterGlow);

  createMountains(scene);
  createActualBuildings(scene);
  createLandmarks(scene);
  createBridges(scene);
  createCheckpoints(scene);
  createClouds(scene);
}

function buildMiniMapBase() {
  const base = document.createElement("canvas");
  base.width = dom.miniMap.width;
  base.height = dom.miniMap.height;
  const ctx = base.getContext("2d");
  const map = runtime.projectedMap;

  if (runtime.rasterMapImage) {
    ctx.drawImage(runtime.rasterMapImage, 0, 0, base.width, base.height);
    ctx.fillStyle = "rgba(7, 14, 24, 0.16)";
    ctx.fillRect(0, 0, base.width, base.height);
  } else {
    ctx.fillStyle = "#09131b";
    ctx.fillRect(0, 0, base.width, base.height);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    for (let x = 0; x <= base.width; x += 32) {
      ctx.fillRect(x, 0, 1, base.height);
    }
    for (let y = 0; y <= base.height; y += 32) {
      ctx.fillRect(0, y, base.width, 1);
    }

    map.waterPolygons.forEach((polygon) => drawMiniMapPolygon(ctx, base, polygon, "rgba(48, 121, 212, 0.95)"));
    map.buildings.forEach((building) => {
      if (building.area < 280 && building.height < 28) {
        return;
      }
      drawMiniMapPolygon(ctx, base, building.points, building.height >= 90 ? "rgba(187, 220, 255, 0.34)" : "rgba(226, 236, 242, 0.16)");
    });
    map.waterLines.forEach((line) => drawMiniMapLine(ctx, base, line, 10, "rgba(105, 193, 255, 0.42)"));
    map.roads.primary.forEach((line) => drawMiniMapLine(ctx, base, line, 2.2, "rgba(255, 224, 157, 0.15)"));
    map.roads.trunk.forEach((line) => drawMiniMapLine(ctx, base, line, 3, "rgba(255, 200, 120, 0.24)"));
  }
  runtime.miniMapBase = base;
}

function createGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 3072;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d");
  const map = runtime.projectedMap;

  if (runtime.rasterMapImage) {
    ctx.save();
    ctx.filter = "contrast(1.06) saturate(0.88) brightness(0.76)";
    ctx.drawImage(runtime.rasterMapImage, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const wash = ctx.createLinearGradient(0, 0, 0, canvas.height);
    wash.addColorStop(0, "rgba(8, 20, 28, 0.1)");
    wash.addColorStop(0.5, "rgba(6, 14, 20, 0.18)");
    wash.addColorStop(1, "rgba(8, 18, 22, 0.24)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#1f3329");
    gradient.addColorStop(0.42, "#16281f");
    gradient.addColorStop(1, "#101c16");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = 0.08;
    for (let x = 0; x <= canvas.width; x += 96) {
      ctx.fillStyle = x % 192 === 0 ? "#8db36f" : "#74935d";
      ctx.fillRect(x, 0, 2, canvas.height);
    }
    for (let y = 0; y <= canvas.height; y += 96) {
      ctx.fillStyle = y % 192 === 0 ? "#8db36f" : "#74935d";
      ctx.fillRect(0, y, canvas.width, 2);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    map.buildings.forEach((building) => {
      const fill = building.height >= 120
        ? "rgba(210, 230, 255, 0.18)"
        : building.height >= 60
          ? "rgba(176, 196, 214, 0.14)"
          : "rgba(128, 146, 160, 0.12)";
      drawPolygon(ctx, canvas, building.points, fill);
    });
    ctx.restore();

    ctx.save();
    ctx.shadowBlur = 34;
    ctx.shadowColor = "rgba(58, 164, 255, 0.42)";
    map.waterPolygons.forEach((polygon) => {
      drawPolygon(ctx, canvas, polygon, "rgba(38, 92, 174, 0.96)");
    });
    map.waterPolygons.forEach((polygon) => {
      drawPolygon(ctx, canvas, polygon, "rgba(114, 194, 255, 0.38)");
    });
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 30;
    ctx.shadowColor = "rgba(118, 198, 255, 0.32)";
    map.waterLines.forEach((line) => {
      drawProjectedLine(ctx, canvas, line, 44, "rgba(76, 171, 255, 0.52)");
    });
    ctx.restore();

    drawProjectedFeatureSet(ctx, canvas, map.roads.secondary, 5, "rgba(255, 226, 163, 0.1)");
    drawProjectedFeatureSet(ctx, canvas, map.roads.primary, 9, "rgba(253, 228, 172, 0.18)");
    drawProjectedFeatureSet(ctx, canvas, map.roads.trunk, 13, "rgba(255, 210, 138, 0.28)");
  }

  ctx.save();
  ctx.shadowBlur = 18;
  ctx.shadowColor = "rgba(255, 247, 214, 0.2)";
  bridgeDefs.forEach((bridge) => {
    const point = worldToTexture(bridge.x, bridge.z, canvas);
    ctx.fillStyle = "rgba(241, 238, 220, 0.34)";
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(bridge.rotation + Math.PI / 2);
    ctx.fillRect(-4, -bridge.length * 0.34, 8, bridge.length * 0.68);
    ctx.restore();
  });
  ctx.restore();

  if (!runtime.rasterMapImage) {
    ctx.fillStyle = "rgba(186, 238, 255, 0.95)";
    ctx.font = '700 64px "Orbitron", sans-serif';
    ctx.fillText("SEOUL AIR TOUR", 86, 110);
  }

  ctx.fillStyle = "rgba(225, 242, 251, 0.62)";
  ctx.font = '700 44px "IBM Plex Sans KR", sans-serif';
  landmarkDefs.forEach((landmark) => {
    placeLabel(ctx, canvas, landmark.label.toUpperCase(), landmark.x, landmark.z - 84);
  });
  const riverMid = riverPath[Math.floor(riverPath.length * 0.52)];
  if (riverMid) {
    placeLabel(ctx, canvas, "HAN RIVER", riverMid.x, riverMid.y, "rgba(220, 249, 255, 0.78)");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = runtime.renderer.capabilities.getMaxAnisotropy();
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createRiverMesh(width = riverWidth, y = 1.2, color = 0x2f72ca, opacity = 0.9) {
  const curve = new THREE.SplineCurve(riverPath);
  const points = curve.getPoints(140);
  const positions = [];
  const uvs = [];
  const indices = [];
  const samples = [];
  let total = 0;
  const lengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    total += points[index].distanceTo(points[index - 1]);
    lengths.push(total);
  }

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[Math.max(index - 1, 0)];
    const next = points[Math.min(index + 1, points.length - 1)];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x).normalize();
    const left = point.clone().add(normal.clone().multiplyScalar(width * 0.5));
    const right = point.clone().add(normal.clone().multiplyScalar(-width * 0.5));

    positions.push(left.x, y, left.y, right.x, y, right.y);
    uvs.push(0, lengths[index] / Math.max(total, 1), 1, lengths[index] / Math.max(total, 1));
    samples.push(point.clone());

    if (index < points.length - 1) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  if (width === riverWidth) {
    runtime.riverSamples = samples;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity,
      roughness: 0.18,
      metalness: 0.12,
      clearcoat: 0.9,
      emissive: 0x144e89,
      emissiveIntensity: width === riverWidth ? 0.38 : 0.56,
      side: THREE.DoubleSide,
    }),
  );
}

function createMountains(scene) {
  hillDefs.forEach((hill, hillIndex) => {
    const rng = mulberry32(600 + hillIndex * 19);
    for (let index = 0; index < 7; index += 1) {
      const radius = hill.radius * (0.32 + rng() * 0.28);
      const height = hill.height * (0.34 + rng() * 0.42);
      const geometry = new THREE.ConeGeometry(radius, height, 20);
      const material = new THREE.MeshStandardMaterial({
        color: hill.color,
        roughness: 1,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        hill.x + (rng() - 0.5) * hill.radius * 0.78,
        height * 0.5,
        hill.z + (rng() - 0.5) * hill.radius * 0.78,
      );
      mesh.rotation.y = rng() * Math.PI;
      scene.add(mesh);
    }
  });
}

function createBoundarySkyline(scene) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x45596c,
    roughness: 0.78,
    metalness: 0.08,
    transparent: true,
    opacity: 0.82,
  });

  const rng = mulberry32(911);
  for (let index = 0; index < 96; index += 1) {
    const edge = index % 4;
    const mesh = new THREE.Mesh(shared.box, material);
    const width = 30 + rng() * 60;
    const depth = 30 + rng() * 60;
    const height = 80 + rng() * 280;
    mesh.scale.set(width, height, depth);

    if (edge === 0) {
      mesh.position.set(-world.width * 0.5 - 120 + rng() * 60, height * 0.5, -world.depth * 0.5 + rng() * world.depth);
    } else if (edge === 1) {
      mesh.position.set(world.width * 0.5 + 120 - rng() * 60, height * 0.5, -world.depth * 0.5 + rng() * world.depth);
    } else if (edge === 2) {
      mesh.position.set(-world.width * 0.5 + rng() * world.width, height * 0.5, -world.depth * 0.5 - 100 + rng() * 60);
    } else {
      mesh.position.set(-world.width * 0.5 + rng() * world.width, height * 0.5, world.depth * 0.5 + 100 - rng() * 60);
    }

    scene.add(mesh);
  }
}

function createActualBuildings(scene) {
  const city = new THREE.Group();
  const candidates = [];
  const instancedBuckets = {
    residential: [],
    commercial: [],
    mixed: [],
  };

  runtime.projectedMap.buildings.forEach((building) => {
    if (isInsideLandmarkClearance(building) || isBuildingOnWater(building)) {
      return;
    }

    candidates.push({
      building,
      terrainHeight: getTerrainHeight(building.x, building.z),
      detailScore: getBuildingDetailScore(building),
    });
  });

  candidates.sort((left, right) => right.detailScore - left.detailScore);
  const detailLimit = getDetailBuildingLimit(candidates.length);

  candidates.forEach((candidate, index) => {
    const shouldUseDetailedMesh = index < detailLimit
      && candidate.building.points.length <= 52
      && candidate.building.footprintArea >= 80;

    if (shouldUseDetailedMesh) {
      const mesh = createBuildingMesh(candidate.building, candidate.terrainHeight);
      if (mesh) {
        city.add(mesh);
        return;
      }
    }

    enqueueInstancedBuilding(instancedBuckets, candidate);
  });

  createInstancedBuildingGroups(city, instancedBuckets);
  scene.add(city);
}

function getBuildingDetailScore(building) {
  const heightFactor = 1 + building.height * 0.012;
  const areaFactor = Math.max(building.footprintArea, 40);
  const kindFactor = (
    building.kind === "apartments" || building.kind === "residential" || building.kind === "house"
      ? 1.1
      : building.kind === "office" || building.kind === "commercial"
        ? 1.14
        : 1
  );
  return areaFactor * heightFactor * kindFactor;
}

function getDetailBuildingLimit(totalBuildings) {
  if (totalBuildings >= 90000) {
    return 1200;
  }
  if (totalBuildings >= 60000) {
    return 1450;
  }
  if (totalBuildings >= 30000) {
    return 1800;
  }
  return 2200;
}

function enqueueInstancedBuilding(buckets, candidate) {
  const { building, terrainHeight } = candidate;
  const width = THREE.MathUtils.clamp(building.footprintWidth * 0.94, 5, 210);
  const depth = THREE.MathUtils.clamp(building.footprintDepth * 0.94, 5, 210);
  const height = THREE.MathUtils.clamp(building.height, 6, 320);

  const key = building.kind === "apartments" || building.kind === "residential" || building.kind === "house"
    ? "residential"
    : building.kind === "office" || building.kind === "commercial" || building.kind === "hotel"
      ? "commercial"
      : "mixed";

  buckets[key].push({
    x: building.x,
    y: terrainHeight + height * 0.5,
    z: building.z,
    width,
    depth,
    height,
  });
}

function createInstancedBuildingGroups(group, buckets) {
  const materials = {
    residential: new THREE.MeshStandardMaterial({
      color: 0xbcc7d3,
      roughness: 0.84,
      metalness: 0.12,
      emissive: 0x122133,
      emissiveIntensity: 0.09,
    }),
    commercial: new THREE.MeshStandardMaterial({
      color: 0xa7bdd0,
      roughness: 0.56,
      metalness: 0.34,
      emissive: 0x152843,
      emissiveIntensity: 0.16,
    }),
    mixed: new THREE.MeshStandardMaterial({
      color: 0xa3b0be,
      roughness: 0.7,
      metalness: 0.18,
      emissive: 0x141f2e,
      emissiveIntensity: 0.11,
    }),
  };

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  Object.entries(buckets).forEach(([key, buildings]) => {
    if (!buildings.length) {
      return;
    }

    const mesh = new THREE.InstancedMesh(shared.box, materials[key], buildings.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    buildings.forEach((item, index) => {
      position.set(item.x, item.y, item.z);
      scale.set(item.width, item.height, item.depth);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
}

function createBuildingMesh(building, terrainHeight) {
  const shape = new THREE.Shape();
  building.points.forEach(([x, z], index) => {
    const localX = x - building.x;
    const localZ = z - building.z;
    if (index === 0) {
      shape.moveTo(localX, -localZ);
    } else {
      shape.lineTo(localX, -localZ);
    }
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: building.height,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, pickBuildingMaterial(building));
  mesh.position.set(building.x, terrainHeight, building.z);
  return mesh;
}

function pickBuildingMaterial(building) {
  if (building.height >= 120 || building.kind === "office" || building.kind === "commercial") {
    return buildingMaterials[1];
  }
  if (building.kind === "apartments" || building.kind === "residential" || building.kind === "house") {
    return buildingMaterials[0];
  }
  return buildingMaterials[2];
}

function createLandmarks(scene) {
  landmarkDefs.forEach((landmark) => {
    const terrainHeight = getTerrainHeight(landmark.x, landmark.z);
    const group = landmark.create(terrainHeight);
    group.position.set(landmark.x, 0, landmark.z);
    scene.add(group);

    const label = createLabelSprite(landmark.label, "#dcf5ff");
    label.position.set(landmark.x, terrainHeight + landmark.height + 32, landmark.z);
    scene.add(label);
  });
}

function createBridges(scene) {
  bridgeDefs.forEach((bridge) => {
    const group = new THREE.Group();

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(14, 7, bridge.length),
      new THREE.MeshStandardMaterial({
        color: 0xd1d5d9,
        roughness: 0.5,
        metalness: 0.48,
      }),
    );
    deck.position.y = 12;
    group.add(deck);

    const towerMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f2f5,
      roughness: 0.42,
      metalness: 0.42,
    });

    [-bridge.length * 0.24, bridge.length * 0.24].forEach((offset) => {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(12, 44, 12), towerMaterial);
      tower.position.set(0, 32, offset);
      group.add(tower);
    });

    group.position.set(bridge.x, 0, bridge.z);
    group.rotation.y = bridge.rotation;
    scene.add(group);
  });
}

function createCheckpoints(scene) {
  void scene;
  runtime.checkpointGroups = [];
}

function createClouds(scene) {
  const rng = mulberry32(4096);
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    transparent: true,
    opacity: 0.85,
  });

  for (let index = 0; index < 26; index += 1) {
    const cloud = new THREE.Group();
    const puffCount = 3 + Math.floor(rng() * 4);

    for (let puff = 0; puff < puffCount; puff += 1) {
      const geometry = new THREE.SphereGeometry(1, 14, 14);
      const mesh = new THREE.Mesh(geometry, cloudMaterial);
      const scale = 26 + rng() * 48;
      mesh.scale.set(scale * 1.4, scale, scale);
      mesh.position.set((rng() - 0.5) * 72, rng() * 14, (rng() - 0.5) * 42);
      cloud.add(mesh);
    }

    cloud.position.set(
      -world.width * 0.5 + rng() * world.width,
      320 + rng() * 230,
      -world.depth * 0.5 + rng() * world.depth,
    );
    cloud.userData.speed = 4 + rng() * 9;
    runtime.clouds.push(cloud);
    scene.add(cloud);
  }
}

function create63Building(terrainHeight) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xc5a56f,
    roughness: 0.28,
    metalness: 0.62,
    emissive: 0x3b2410,
    emissiveIntensity: 0.2,
  });

  const body = new THREE.Mesh(shared.box, material);
  body.scale.set(54, 250, 34);
  body.position.y = terrainHeight + 125;
  group.add(body);

  const crown = new THREE.Mesh(new THREE.BoxGeometry(46, 20, 28), material);
  crown.position.y = terrainHeight + 260;
  group.add(crown);

  return group;
}

function createSeoulTower(terrainHeight) {
  const group = new THREE.Group();

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 11, 160, 20),
    new THREE.MeshStandardMaterial({ color: 0xe6edf3, roughness: 0.3, metalness: 0.44 }),
  );
  shaft.position.y = terrainHeight + 80;
  group.add(shaft);

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(28, 36, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xe0edf8, roughness: 0.28, metalness: 0.52 }),
  );
  deck.position.y = terrainHeight + 150;
  group.add(deck);

  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 26, 18, 24),
    new THREE.MeshStandardMaterial({ color: 0x98d6ff, roughness: 0.22, metalness: 0.52, emissive: 0x1a3044, emissiveIntensity: 0.32 }),
  );
  head.position.y = terrainHeight + 174;
  group.add(head);

  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.4, 74, 10),
    new THREE.MeshStandardMaterial({ color: 0xffdf92, roughness: 0.34, metalness: 0.48 }),
  );
  antenna.position.y = terrainHeight + 220;
  group.add(antenna);

  return group;
}

function createGyeongbokgung(terrainHeight) {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xbfa98a, roughness: 0.9, metalness: 0.02 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x38584c, roughness: 0.72, metalness: 0.08 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x9b5039, roughness: 0.82, metalness: 0.02 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(118, 5, 94), stone);
  base.position.y = terrainHeight + 2.5;
  group.add(base);

  [
    { x: 0, z: 0, sx: 64, sy: 18, sz: 40 },
    { x: -38, z: 30, sx: 28, sy: 12, sz: 22 },
    { x: 38, z: 30, sx: 28, sy: 12, sz: 22 },
    { x: 0, z: -30, sx: 32, sy: 12, sz: 18 },
  ].forEach((building) => {
    const hall = new THREE.Mesh(shared.box, wall);
    hall.scale.set(building.sx, building.sy, building.sz);
    hall.position.set(building.x, terrainHeight + building.sy * 0.5 + 5, building.z);
    group.add(hall);

    const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(building.sx * 0.72, 10, 4), roof);
    roofMesh.position.set(building.x, terrainHeight + building.sy + 10, building.z);
    roofMesh.rotation.y = Math.PI * 0.25;
    roofMesh.scale.z = building.sz / building.sx;
    group.add(roofMesh);
  });

  return group;
}

function createCoexTower(terrainHeight) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    shared.box,
    new THREE.MeshStandardMaterial({
      color: 0x8cc4eb,
      roughness: 0.24,
      metalness: 0.72,
      emissive: 0x14314d,
      emissiveIntensity: 0.22,
    }),
  );
  body.scale.set(42, 212, 42);
  body.position.y = terrainHeight + 106;
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(44, 12, 44),
    new THREE.MeshStandardMaterial({ color: 0xb8d6ea, roughness: 0.3, metalness: 0.62 }),
  );
  cap.position.y = terrainHeight + 218;
  group.add(cap);

  const lowWing = new THREE.Mesh(
    shared.box,
    new THREE.MeshStandardMaterial({ color: 0x6f8498, roughness: 0.46, metalness: 0.38 }),
  );
  lowWing.scale.set(74, 22, 48);
  lowWing.position.set(-48, terrainHeight + 11, 12);
  group.add(lowWing);

  return group;
}

function createLotteTower(terrainHeight) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xb8d3eb,
    roughness: 0.22,
    metalness: 0.78,
    emissive: 0x102236,
    emissiveIntensity: 0.28,
  });

  const lower = new THREE.Mesh(shared.box, material);
  lower.scale.set(64, 240, 64);
  lower.position.y = terrainHeight + 120;
  group.add(lower);

  const mid = new THREE.Mesh(shared.box, material);
  mid.scale.set(48, 180, 48);
  mid.position.y = terrainHeight + 330;
  group.add(mid);

  const upper = new THREE.Mesh(shared.box, material);
  upper.scale.set(34, 110, 34);
  upper.position.y = terrainHeight + 475;
  group.add(upper);

  const spire = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 5.2, 70, 12),
    new THREE.MeshStandardMaterial({ color: 0xe7f2fb, roughness: 0.26, metalness: 0.84 }),
  );
  spire.position.y = terrainHeight + 566;
  group.add(spire);

  return group;
}

function createLabelSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "rgba(4, 10, 16, 0.62)";
  roundRect(ctx, 20, 20, 472, 88, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(134, 229, 255, 0.44)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = '700 48px "IBM Plex Sans KR", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(124, 31, 1);
  return sprite;
}

function bindEvents() {
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("pointerlockchange", handlePointerLockChange);
  document.addEventListener("mousemove", handleMouseMove);

  dom.startBtn.addEventListener("click", () => {
    startGame();
    requestFlightPointerLock();
  });

  dom.restartBtn.addEventListener("click", () => {
    resetFlight();
    startGame();
    requestFlightPointerLock();
  });

  runtime.renderer.domElement.addEventListener("click", () => {
    if (state.mode === "running") {
      requestFlightPointerLock();
    }
  });

  dom.touchButtons.forEach((button) => {
    const control = button.dataset.control;
    const activate = (event) => {
      event.preventDefault();
      input[control] = true;
      button.classList.add("active");
    };
    const deactivate = (event) => {
      event.preventDefault();
      input[control] = false;
      button.classList.remove("active");
    };

    button.addEventListener("pointerdown", activate);
    button.addEventListener("pointerup", deactivate);
    button.addEventListener("pointerleave", deactivate);
    button.addEventListener("pointercancel", deactivate);
  });
}

function requestFlightPointerLock() {
  if (runtime.renderer?.domElement && document.pointerLockElement !== runtime.renderer.domElement) {
    runtime.renderer.domElement.requestPointerLock?.();
  }
}

function handlePointerLockChange() {
  runtime.pointerLocked = document.pointerLockElement === runtime.renderer?.domElement;
}

function handleMouseMove(event) {
  if (!runtime.pointerLocked || state.mode !== "running") {
    return;
  }

  state.yaw -= event.movementX * 0.0022;
  state.pitch -= event.movementY * 0.0016;
  state.pitch = THREE.MathUtils.clamp(state.pitch, -0.48, 0.58);
  runtime.lookRollVelocity = THREE.MathUtils.clamp(event.movementX * 0.0026, -0.45, 0.45);
}

function onResize() {
  runtime.camera.aspect = window.innerWidth / window.innerHeight;
  runtime.camera.updateProjectionMatrix();
  runtime.renderer.setSize(window.innerWidth, window.innerHeight);
}

function handleKeyDown(event) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }

  if (event.repeat) {
    return;
  }

  if (event.code === "KeyR") {
    const shouldResume = state.mode !== "intro";
    resetFlight();
    if (shouldResume) {
      startGame();
    }
    return;
  }

  if (event.code === "Enter" && state.mode === "intro") {
    startGame();
  }

  setInputByCode(event.code, true);
}

function handleKeyUp(event) {
  setInputByCode(event.code, false);
}

function setInputByCode(code, active) {
  if (code === "KeyW" || code === "ArrowUp") {
    input.pitchUp = active;
  } else if (code === "KeyS" || code === "ArrowDown") {
    input.pitchDown = active;
  } else if (code === "KeyA" || code === "ArrowLeft") {
    input.bankLeft = active;
  } else if (code === "KeyD" || code === "ArrowRight") {
    input.bankRight = active;
  } else if (code === "KeyQ") {
    input.yawLeft = active;
  } else if (code === "KeyE") {
    input.yawRight = active;
  } else if (code === "ShiftLeft" || code === "ShiftRight") {
    input.boost = active;
  } else if (code === "Space") {
    input.level = active;
  }
}

function resetFlight() {
  clearInputs();
  document.exitPointerLock?.();
  runtime.pointerLocked = false;
  const firstCheckpoint = checkpointDefs[0];
  const startX = firstCheckpoint.x - 360;
  const startZ = firstCheckpoint.z + 36;
  state.mode = "intro";
  state.position.set(startX, 236, startZ);
  state.yaw = Math.atan2(firstCheckpoint.x - startX, -(firstCheckpoint.z - startZ));
  state.pitch = -0.18;
  state.roll = 0;
  state.speed = 68;
  state.elapsedMs = 0;
  state.startedAt = 0;
  state.checkpointIndex = 0;

  runtime.currentStatus = "서울 상공 뷰 준비 완료. 시작하면 바로 이동합니다.";
  dom.startPanel.classList.remove("hidden");
  dom.messagePanel.classList.add("hidden");
  updateCheckpointVisuals();
  updateCamera(0);
  updateHud();
}

function startGame() {
  if (state.mode === "running") {
    return;
  }

  state.mode = "running";
  state.startedAt = performance.now() - state.elapsedMs;
  dom.startPanel.classList.add("hidden");
  dom.messagePanel.classList.add("hidden");
  runtime.currentStatus = checkpointDefs[state.checkpointIndex].note;
}

function loop(now) {
  const delta = Math.min((now - runtime.lastTime) / 1000, 0.05);
  runtime.lastTime = now;

  if (state.mode === "running") {
    state.elapsedMs = now - state.startedAt;
    updateFlight(delta);
    updateClouds(delta);
    if (state.mode === "running") {
      updateCheckpoints(now);
    }
  } else {
    updateIdleCamera(delta, now);
    updateClouds(delta);
  }

  updateHud();
  runtime.renderer.render(runtime.scene, runtime.camera);
  requestAnimationFrame(loop);
}

function updateFlight(delta) {
  const pitchInput = Number(input.pitchUp) - Number(input.pitchDown);
  const bankInput = Number(input.bankRight) - Number(input.bankLeft);
  const yawInput = Number(input.yawRight) - Number(input.yawLeft);

  const targetSpeed = input.boost ? 116 : 74;
  state.speed = THREE.MathUtils.damp(state.speed, targetSpeed, 2.1, delta);

  const pitchSpeed = input.level ? 0.16 : 0.82;
  const pitchDamp = input.level ? 3.2 : 1.3;
  state.pitch += pitchInput * pitchSpeed * delta;
  state.yaw += yawInput * 0.86 * delta;

  if (input.level) {
    state.pitch = THREE.MathUtils.damp(state.pitch, -0.08, 3.4, delta);
  }

  if (!runtime.pointerLocked && !pitchInput && !input.level) {
    state.pitch = THREE.MathUtils.damp(state.pitch, -0.02, pitchDamp, delta);
  }

  const targetRoll = THREE.MathUtils.clamp(
    runtime.lookRollVelocity * 1.8 + bankInput * 0.34 + yawInput * 0.18,
    -0.72,
    0.72,
  );
  state.roll = THREE.MathUtils.damp(state.roll, targetRoll, input.level ? 4.2 : 3.2, delta);
  runtime.lookRollVelocity = THREE.MathUtils.damp(runtime.lookRollVelocity, 0, 4.8, delta);

  state.pitch = THREE.MathUtils.clamp(state.pitch, -0.48, 0.58);
  state.roll = THREE.MathUtils.clamp(state.roll, -1.15, 1.15);

  const euler = new THREE.Euler(state.pitch, state.yaw, state.roll, "YXZ");
  state.forward.set(0, 0, -1).applyEuler(euler).normalize();
  state.position.addScaledVector(state.forward, state.speed * delta);

  const terrainHeight = getTerrainHeight(state.position.x, state.position.z);
  const floor = terrainHeight + 18;

  if (state.position.y < floor) {
    state.position.y = floor;
    state.pitch = Math.max(state.pitch, 0.05);
    state.roll = THREE.MathUtils.damp(state.roll, 0, 5.4, delta);
    runtime.currentStatus = "저고도. 자동으로 지면 위로 복귀 중.";
  }

  if (state.position.y > world.ceiling) {
    state.position.y = world.ceiling;
    state.pitch = Math.min(state.pitch, 0.04);
  }

  enforceBoundary(delta);
  updateCamera(delta);
}

function updateIdleCamera(delta, now) {
  state.yaw += delta * 0.16;
  state.roll = Math.sin(now * 0.0004) * 0.08;
  state.pitch = -0.2 + Math.sin(now * 0.0003) * 0.04;
  updateCamera(delta);
}

function updateCamera(delta) {
  const euler = new THREE.Euler(state.pitch, state.yaw, state.roll, "YXZ");
  state.forward.set(0, 0, -1).applyEuler(euler).normalize();
  const cockpitOffset = new THREE.Vector3(0, 0, 0);
  const drift = new THREE.Vector3(0, Math.sin(performance.now() * 0.008) * 0.55, 0).multiplyScalar(state.mode === "running" ? 1 : 0.3);
  runtime.camera.position.copy(state.position).add(cockpitOffset).add(drift);
  runtime.camera.quaternion.setFromEuler(euler);

  const velocityTilt = Math.sin(performance.now() * 0.012) * (input.boost ? 0.002 : 0.001);
  runtime.camera.rotateZ(velocityTilt);
  runtime.cockpitLight.intensity = THREE.MathUtils.damp(runtime.cockpitLight.intensity, input.boost ? 0.65 : 0.48, 3, Math.max(delta, 0.016));
}

function updateClouds(delta) {
  runtime.clouds.forEach((cloud) => {
    cloud.position.x += cloud.userData.speed * delta;
    if (cloud.position.x > world.width * 0.5 + 140) {
      cloud.position.x = -world.width * 0.5 - 140;
    }
  });
}

function updateCheckpoints(now) {
  const current = checkpointDefs[state.checkpointIndex];
  if (!current) {
    return;
  }

  const distance = horizontalDistance(state.position.x, state.position.z, current.x, current.z);
  const altitudeDelta = Math.abs(state.position.y - current.y);

  if (distance < current.radius * 0.98 && altitudeDelta < 120) {
    state.checkpointIndex += 1;
    updateCheckpointVisuals();

    if (state.checkpointIndex >= checkpointDefs.length) {
      finishRun();
      return;
    }

    runtime.currentStatus = `${checkpointDefs[state.checkpointIndex].name} 방향으로 이동 중.`;
  } else {
    const relative = getRelativeBearing(current);
    if (!runtime.pointerLocked && window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches) {
      runtime.currentStatus = "화면 클릭 후 마우스로 방향 조종";
    } else if (state.position.y < getTerrainHeight(state.position.x, state.position.z) + 56) {
      runtime.currentStatus = "저고도 경고. 기수를 올리세요.";
    } else if (Math.abs(relative) > 65) {
      runtime.currentStatus = "다음 랜드마크 방향으로 이동 중.";
    } else if (input.boost) {
      runtime.currentStatus = "부스트 사용 중. 고도 유지에 주의하세요.";
    } else {
      runtime.currentStatus = current.note;
    }
  }

  runtime.checkpointGroups.forEach((item) => {
    const pulse = 0.78 + Math.sin(now * 0.004 + item.index) * 0.1;
    if (item.index === state.checkpointIndex) {
      item.ring.rotation.z += 0.028;
      item.ring.material.emissiveIntensity = 1.4 * pulse;
      item.beam.material.opacity = 0.26 + Math.sin(now * 0.004 + item.index) * 0.05;
      item.glow.intensity = 1.9 * pulse;
    } else if (item.index < state.checkpointIndex) {
      item.ring.material.emissiveIntensity = 0.22;
      item.beam.material.opacity = 0.06;
      item.glow.intensity = 0.32;
    } else {
      item.ring.material.emissiveIntensity = 0.56;
      item.beam.material.opacity = 0.12;
      item.glow.intensity = 0.76;
    }
  });
}

function updateCheckpointVisuals() {
  runtime.checkpointGroups.forEach((item) => {
    if (item.index < state.checkpointIndex) {
      item.ring.material.color.setHex(0x88f2a1);
      item.ring.material.opacity = 0.55;
      item.beam.material.color.setHex(0x88f2a1);
      item.label.material.opacity = 0.82;
    } else if (item.index === state.checkpointIndex) {
      item.ring.material.color.setHex(0xb6f2ff);
      item.ring.material.opacity = 0.95;
      item.beam.material.color.setHex(0xb6f2ff);
      item.label.material.opacity = 1;
    } else {
      item.ring.material.color.setHex(0x8ceeff);
      item.ring.material.opacity = 0.74;
      item.beam.material.color.setHex(0x8ceeff);
      item.label.material.opacity = 0.78;
    }
  });
}

function updateHud() {
  const headingDegrees = normalizeDegrees(THREE.MathUtils.radToDeg(getHeadingRadians()));
  const current = checkpointDefs[Math.min(state.checkpointIndex, checkpointDefs.length - 1)];
  const distance = current ? horizontalDistance(state.position.x, state.position.z, current.x, current.z) : 0;
  const relativeBearing = current ? getRelativeBearing(current) : 0;

  dom.speedValue.textContent = String(Math.round(state.speed)).padStart(3, "0");
  dom.altitudeValue.textContent = String(Math.max(0, Math.round(state.position.y))).padStart(3, "0");
  dom.headingValue.textContent = String(Math.round(headingDegrees)).padStart(3, "0");
  dom.headingCardinal.textContent = getCardinal(headingDegrees);
  dom.timerValue.textContent = formatTime(state.elapsedMs);
  dom.targetName.textContent = current ? current.name : "서울 상공";
  dom.distanceValue.textContent = `${Math.round(distance)}m`;
  dom.bearingValue.textContent = `${Math.round(relativeBearing)}°`;
  dom.statusText.textContent = runtime.currentStatus;
  dom.horizonInner.style.transform = `translateY(${state.pitch * 120}px) rotate(${(-state.roll * 180) / Math.PI}deg)`;
  drawMiniMap();
}

function finishRun() {
  state.checkpointIndex = checkpointDefs.length - 1;
  runtime.currentStatus = "주요 랜드마크 안내를 모두 지났습니다.";
}

function enforceBoundary(delta) {
  const limitX = world.width * 0.5 - world.boundaryPadding;
  const limitZ = world.depth * 0.5 - world.boundaryPadding;
  const outsideX = Math.abs(state.position.x) > limitX;
  const outsideZ = Math.abs(state.position.z) > limitZ;

  if (!outsideX && !outsideZ) {
    return;
  }

  state.position.x = THREE.MathUtils.clamp(state.position.x, -limitX, limitX);
  state.position.z = THREE.MathUtils.clamp(state.position.z, -limitZ, limitZ);

  const desired = Math.atan2(-state.position.x, state.position.z);
  const deltaAngle = shortestAngle(state.yaw, desired);
  state.yaw += deltaAngle * Math.min(1, delta * 1.8);
  runtime.currentStatus = "서울 지도 경계 접근. 지도 안쪽으로 복귀 중.";
}

function getTerrainHeight(x, z) {
  let height = 0;
  hillDefs.forEach((hill) => {
    const distance = horizontalDistance(x, z, hill.x, hill.z);
    if (distance < hill.radius) {
      const ratio = 1 - distance / hill.radius;
      height += hill.height * ratio * ratio;
    }
  });
  return height;
}

function isInsideLandmarkClearance(building) {
  return landmarkDefs.some((landmark) => (
    horizontalDistance(building.x, building.z, landmark.x, landmark.z) < Math.max(22, landmark.colliderRadius * 0.72)
  ));
}

function isBuildingOnWater(building) {
  const margin = 2;
  for (const water of runtime.waterMasks) {
    if (!rectanglesOverlap(
      building.footprintMinX,
      building.footprintMaxX,
      building.footprintMinZ,
      building.footprintMaxZ,
      water.minX,
      water.maxX,
      water.minZ,
      water.maxZ,
      margin,
    )) {
      continue;
    }

    if (isPointInPolygon(building.x, building.z, water.points)) {
      return true;
    }

    const step = Math.max(1, Math.floor(building.points.length / 7));
    for (let index = 0; index < building.points.length; index += step) {
      const [x, z] = building.points[index];
      if (isPointInPolygon(x, z, water.points)) {
        return true;
      }
    }

    if (isPointInPolygon(water.anchorX, water.anchorZ, building.points)) {
      return true;
    }
  }
  return false;
}

function isPointInPolygon(x, z, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [currentX, currentZ] = points[index];
    const [previousX, previousZ] = points[previous];
    const intersects = ((currentZ > z) !== (previousZ > z))
      && (x < ((previousX - currentX) * (z - currentZ)) / (previousZ - currentZ) + currentX);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function rectanglesOverlap(minX1, maxX1, minZ1, maxZ1, minX2, maxX2, minZ2, maxZ2, margin = 0) {
  return !(
    maxX1 < minX2 - margin
    || minX1 > maxX2 + margin
    || maxZ1 < minZ2 - margin
    || minZ1 > maxZ2 + margin
  );
}

function getRelativeBearing(target) {
  const heading = getHeadingRadians();
  const bearing = Math.atan2(target.x - state.position.x, -(target.z - state.position.z));
  return THREE.MathUtils.radToDeg(shortestAngle(heading, bearing));
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getCardinal(deg) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(deg / 45) % 8];
}

function worldToTexture(x, z, canvas) {
  return {
    x: ((x + world.width * 0.5) / world.width) * canvas.width,
    y: ((z + world.depth * 0.5) / world.depth) * canvas.height,
  };
}

function placeLabel(ctx, canvas, text, x, z, color = "rgba(225, 242, 251, 0.62)") {
  const position = worldToTexture(x, z, canvas);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, position.x, position.y);
}

function drawProjectedLine(ctx, canvas, points, width, color) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const position = worldToTexture(point[0], point[1], canvas);
    if (index === 0) {
      ctx.moveTo(position.x, position.y);
    } else {
      ctx.lineTo(position.x, position.y);
    }
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawProjectedFeatureSet(ctx, canvas, features, width, color) {
  ctx.save();
  features.forEach((feature) => {
    drawProjectedLine(ctx, canvas, feature, width, color);
  });
  ctx.restore();
}

function drawPolygon(ctx, canvas, points, color) {
  if (points.length < 3) {
    return;
  }
  ctx.beginPath();
  points.forEach((point, index) => {
    const position = worldToTexture(point[0], point[1], canvas);
    if (index === 0) {
      ctx.moveTo(position.x, position.y);
    } else {
      ctx.lineTo(position.x, position.y);
    }
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawMiniMapLine(ctx, canvas, points, width, color) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const position = worldToTexture(point[0], point[1], canvas);
    if (index === 0) {
      ctx.moveTo(position.x, position.y);
    } else {
      ctx.lineTo(position.x, position.y);
    }
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawMiniMapPolygon(ctx, canvas, points, color) {
  if (points.length < 3) {
    return;
  }
  ctx.beginPath();
  points.forEach((point, index) => {
    const position = worldToTexture(point[0], point[1], canvas);
    if (index === 0) {
      ctx.moveTo(position.x, position.y);
    } else {
      ctx.lineTo(position.x, position.y);
    }
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawMiniMap() {
  const ctx = dom.miniMap.getContext("2d");
  if (!runtime.miniMapBase || !ctx) {
    return;
  }

  ctx.clearRect(0, 0, dom.miniMap.width, dom.miniMap.height);
  ctx.drawImage(runtime.miniMapBase, 0, 0);

  const player = worldToTexture(state.position.x, state.position.z, dom.miniMap);
  const heading = getHeadingRadians();
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(heading + Math.PI * 0.5);
  ctx.fillStyle = "#ff8d64";
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function projectLine(points, project) {
  return points.map(([lon, lat]) => {
    const projected = project(lon, lat);
    return [projected.x, projected.z];
  });
}

function projectBuilding(building, project) {
  if (!Array.isArray(building.points) || building.points.length < 3) {
    return null;
  }

  const points = [];
  building.points.forEach(([lon, lat]) => {
    const projected = project(lon, lat);
    const next = [projected.x, projected.z];
    const previous = points[points.length - 1];
    if (!previous || horizontalDistance(previous[0], previous[1], next[0], next[1]) > 1) {
      points.push(next);
    }
  });

  if (points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (horizontalDistance(first[0], first[1], last[0], last[1]) <= 1) {
      points.pop();
    }
  }

  if (points.length < 3) {
    return null;
  }

  const signedArea = polygonSignedArea(points);
  if (Math.abs(signedArea) < 10) {
    return null;
  }

  const centroid = polygonCentroid(points, signedArea);
  const footprintArea = Math.abs(signedArea);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let radius = 0;
  points.forEach(([x, z]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    radius = Math.max(radius, horizontalDistance(x, z, centroid.x, centroid.z));
  });

  return {
    ...building,
    points,
    height: normalizeBuildingHeight(building),
    footprintArea,
    footprintWidth: Math.max(4, maxX - minX),
    footprintDepth: Math.max(4, maxZ - minZ),
    footprintMinX: minX,
    footprintMaxX: maxX,
    footprintMinZ: minZ,
    footprintMaxZ: maxZ,
    x: centroid.x,
    z: centroid.z,
    radius: Math.max(radius, 10),
  };
}

function normalizeBuildingHeight(building) {
  const explicitHeight = Number(building.height);
  if (Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return THREE.MathUtils.clamp(explicitHeight, 8, 320);
  }

  const footprintArea = Math.max(0, Number(building.area) || 0);
  return THREE.MathUtils.clamp(10 + Math.sqrt(footprintArea) * 0.24, 8, 180);
}

function sampleRoutePoints(points, step = 1) {
  if (!points.length) {
    return [];
  }

  const sampled = [];
  for (let index = 0; index < points.length; index += step) {
    sampled.push(points[index]);
  }

  const last = points[points.length - 1];
  const sampledLast = sampled[sampled.length - 1];
  if (!sampledLast || sampledLast[0] !== last[0] || sampledLast[1] !== last[1]) {
    sampled.push(last);
  }

  return sampled;
}

function pickLongestLine(lines) {
  return lines.reduce((best, current) => {
    const bestLength = polylineLength(best);
    const currentLength = polylineLength(current);
    return currentLength > bestLength ? current : best;
  }, []);
}

function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += horizontalDistance(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1]);
  }
  return total;
}

function polygonSignedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    area += x1 * z2 - x2 * z1;
  }
  return area * 0.5;
}

function polygonBounds(points) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  points.forEach(([x, z]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  });

  return { minX, maxX, minZ, maxZ };
}

function polygonCentroid(points, signedArea = polygonSignedArea(points)) {
  if (Math.abs(signedArea) < 1e-5) {
    const total = points.reduce((accumulator, [x, z]) => {
      accumulator.x += x;
      accumulator.z += z;
      return accumulator;
    }, { x: 0, z: 0 });
    return {
      x: total.x / points.length,
      z: total.z / points.length,
    };
  }

  let centroidX = 0;
  let centroidZ = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    const cross = x1 * z2 - x2 * z1;
    centroidX += (x1 + x2) * cross;
    centroidZ += (z1 + z2) * cross;
  }

  const factor = 1 / (6 * signedArea);
  return {
    x: centroidX * factor,
    z: centroidZ * factor,
  };
}

function mercatorX(lon) {
  return THREE.MathUtils.degToRad(lon);
}

function mercatorY(lat) {
  const radians = THREE.MathUtils.degToRad(lat);
  return Math.log(Math.tan(Math.PI * 0.25 + radians * 0.5));
}

function makeDistrict(project, name, lon, lat, width, depth, density, maxHeight, seed, palette) {
  const point = project(lon, lat);
  return { name, width, depth, density, maxHeight, seed, palette, x: point.x, z: point.z };
}

function makeHill(project, lon, lat, radius, height, color) {
  const point = project(lon, lat);
  return { radius, height, color, x: point.x, z: point.z };
}

function makeBridge(project, name, lon, lat, length, rotation) {
  const point = project(lon, lat);
  return { name, length, rotation, x: point.x, z: point.z };
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function horizontalDistance(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function getHeadingRadians() {
  if (state.forward.lengthSq() > 0.0001) {
    return Math.atan2(state.forward.x, -state.forward.z);
  }
  return state.yaw;
}

function shortestAngle(from, to) {
  let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

function clearInputs() {
  Object.keys(input).forEach((key) => {
    input[key] = false;
  });
  dom.touchButtons.forEach((button) => {
    button.classList.remove("active");
  });
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), t | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
