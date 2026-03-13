#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_PATH = path.resolve("assets/seoul-scene-data.json");
const DEFAULT_OSM_PATH = "/tmp/seoul_buildings_full_raw.json";
const DEFAULT_OUTPUT_PATH = path.resolve("assets/seoul-scene-data.json");

const HEIGHT_BY_KIND = {
  apartments: 28,
  residential: 16,
  house: 11,
  detached: 11,
  dormitory: 20,
  hotel: 34,
  office: 36,
  commercial: 22,
  retail: 17,
  hospital: 25,
  university: 19,
  school: 16,
  civic: 18,
  public: 18,
  warehouse: 14,
  industrial: 14,
  parking: 12,
};

const EXCLUDED_BUILDING_KINDS = new Set([
  "roof",
  "bridge",
  "construction",
  "collapsed",
  "ruins",
]);

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const basePath = path.resolve(args.base ?? DEFAULT_BASE_PATH);
const osmPath = path.resolve(args.osm ?? DEFAULT_OSM_PATH);
const outputPath = path.resolve(args.out ?? DEFAULT_OUTPUT_PATH);
const minArea = Number.isFinite(args.minArea) ? args.minArea : 10;
const pretty = Boolean(args.pretty);

const baseScene = readJson(basePath);
const osmRaw = readJson(osmPath);

if (!baseScene?.bbox) {
  throw new Error(`Invalid base scene data: missing bbox in ${basePath}`);
}
if (!Array.isArray(osmRaw?.elements)) {
  throw new Error(`Invalid OSM JSON: missing elements in ${osmPath}`);
}

const generated = generateBuildings(osmRaw.elements, baseScene.bbox, minArea);
const nextScene = {
  ...baseScene,
  buildings: generated.buildings,
};

const serialized = pretty ? JSON.stringify(nextScene, null, 2) : JSON.stringify(nextScene);
fs.writeFileSync(outputPath, `${serialized}\n`, "utf8");

const topKinds = [...generated.kindCount.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 16);

console.log(`[scene-buildings] source elements: ${osmRaw.elements.length}`);
console.log(`[scene-buildings] kept buildings: ${generated.buildings.length}`);
console.log(`[scene-buildings] skipped (not way/building): ${generated.skipped.notBuilding}`);
console.log(`[scene-buildings] skipped (excluded kind): ${generated.skipped.excludedKind}`);
console.log(`[scene-buildings] skipped (outside bbox): ${generated.skipped.outsideBbox}`);
console.log(`[scene-buildings] skipped (invalid geometry): ${generated.skipped.invalidGeometry}`);
console.log(`[scene-buildings] skipped (too small area): ${generated.skipped.tooSmall}`);
console.log("[scene-buildings] top building kinds:");
topKinds.forEach(([kind, count]) => {
  console.log(`  - ${kind}: ${count}`);
});

function generateBuildings(elements, bbox, minAreaThreshold) {
  const buildings = [];
  const kindCount = new Map();
  const skipped = {
    notBuilding: 0,
    excludedKind: 0,
    outsideBbox: 0,
    invalidGeometry: 0,
    tooSmall: 0,
  };

  const latRef = (bbox.minLat + bbox.maxLat) * 0.5;
  const lonMeters = 111320 * Math.cos((latRef * Math.PI) / 180);
  const latMeters = 110540;

  for (const element of elements) {
    if (element?.type !== "way" || !Array.isArray(element.geometry) || !element.tags?.building) {
      skipped.notBuilding += 1;
      continue;
    }

    const kind = String(element.tags.building).trim().toLowerCase();
    if (EXCLUDED_BUILDING_KINDS.has(kind)) {
      skipped.excludedKind += 1;
      continue;
    }

    const points = normalizeRing(element.geometry);
    if (!points) {
      skipped.invalidGeometry += 1;
      continue;
    }

    if (!ringIntersectsBBox(points, bbox)) {
      skipped.outsideBbox += 1;
      continue;
    }

    const area = polygonAreaSquareMeters(points, lonMeters, latMeters);
    if (area < minAreaThreshold) {
      skipped.tooSmall += 1;
      continue;
    }

    const height = estimateHeight(element.tags, kind, area);
    const name = pickName(element.tags);
    const building = {
      id: element.id,
      kind,
      ...(name ? { name } : {}),
      height: Math.round(height * 10) / 10,
      area: Math.round(area),
      points: points.map(([lon, lat]) => [
        roundFixed(lon, 6),
        roundFixed(lat, 6),
      ]),
    };

    buildings.push(building);
    kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1);
  }

  buildings.sort((left, right) => right.area - left.area);

  return { buildings, kindCount, skipped };
}

function estimateHeight(tags, kind, area) {
  const directHeight = parseMeters(tags.height);
  if (Number.isFinite(directHeight) && directHeight > 0) {
    return clamp(directHeight, 6, 380);
  }

  const levelValue = parseNumber(tags["building:levels"] ?? tags.level);
  if (Number.isFinite(levelValue) && levelValue > 0) {
    const withFloors = levelValue * 3.05 + 2;
    return clamp(withFloors, 6, 320);
  }

  const baseByKind = HEIGHT_BY_KIND[kind] ?? 14;
  const inferredByArea = 7 + Math.sqrt(Math.max(0, area)) * 0.24;
  const blended = baseByKind * 0.55 + inferredByArea * 0.45;
  return clamp(blended, 6, 220);
}

function pickName(tags) {
  return String(
    tags["name:ko"]
    ?? tags.name
    ?? tags["name:en"]
    ?? "",
  ).trim();
}

function normalizeRing(geometry) {
  const points = [];

  for (const node of geometry) {
    const lon = Number(node?.lon);
    const lat = Number(node?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue;
    }

    const previous = points[points.length - 1];
    if (previous && nearlySamePoint(previous, [lon, lat], 1e-8)) {
      continue;
    }
    points.push([lon, lat]);
  }

  if (points.length > 2 && nearlySamePoint(points[0], points[points.length - 1], 1e-8)) {
    points.pop();
  }

  if (points.length < 3) {
    return null;
  }

  return points;
}

function ringIntersectsBBox(points, bbox) {
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const [lon, lat] of points) {
    if (lon < minLon) {
      minLon = lon;
    }
    if (lon > maxLon) {
      maxLon = lon;
    }
    if (lat < minLat) {
      minLat = lat;
    }
    if (lat > maxLat) {
      maxLat = lat;
    }
  }

  return !(
    maxLon < bbox.minLon
    || minLon > bbox.maxLon
    || maxLat < bbox.minLat
    || minLat > bbox.maxLat
  );
}

function polygonAreaSquareMeters(points, lonMeters, latMeters) {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const [lon1, lat1] = points[index];
    const [lon2, lat2] = points[(index + 1) % points.length];
    const x1 = lon1 * lonMeters;
    const y1 = lat1 * latMeters;
    const x2 = lon2 * lonMeters;
    const y2 = lat2 * latMeters;
    area += x1 * y2 - x2 * y1;
  }

  return Math.abs(area * 0.5);
}

function parseMeters(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return Number.NaN;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return Number.NaN;
  }

  const numericMatch = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!numericMatch) {
    return Number.NaN;
  }

  const parsed = Number(numericMatch[0]);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }

  if (normalized.includes("ft") || normalized.includes("feet")) {
    return parsed * 0.3048;
  }

  return parsed;
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return Number.NaN;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--base") {
      out.base = argv[index + 1];
      index += 1;
    } else if (arg === "--osm") {
      out.osm = argv[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out.out = argv[index + 1];
      index += 1;
    } else if (arg === "--min-area") {
      out.minArea = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--pretty") {
      out.pretty = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printHelp() {
  console.log("Rebuild Seoul scene building data from OSM raw JSON");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/rebuild-seoul-scene-buildings.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --base <path>      Base scene JSON (default: ${DEFAULT_BASE_PATH})`);
  console.log(`  --osm <path>       OSM raw JSON (default: ${DEFAULT_OSM_PATH})`);
  console.log(`  --out <path>       Output scene JSON (default: ${DEFAULT_OUTPUT_PATH})`);
  console.log("  --min-area <m2>    Minimum building footprint area to keep (default: 10)");
  console.log("  --pretty           Write pretty-printed JSON instead of minified JSON");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function roundFixed(value, digits) {
  return Number(value.toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nearlySamePoint(left, right, epsilon) {
  return Math.abs(left[0] - right[0]) <= epsilon && Math.abs(left[1] - right[1]) <= epsilon;
}
