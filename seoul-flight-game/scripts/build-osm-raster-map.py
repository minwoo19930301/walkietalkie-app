#!/usr/bin/env python3

import math
import os
import urllib.request
from pathlib import Path

from PIL import Image


ZOOM = 14
MIN_LON = 126.92
MAX_LON = 127.11
MIN_LAT = 37.50
MAX_LAT = 37.59
USER_AGENT = "Codex-SeoulFlight/1.0 (local dev map stitching)"

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "assets" / "seoul-raster-map.png"
CACHE_DIR = Path("/tmp/seoul_osm_tiles_z14")


def lon_to_tile_x(lon: float, zoom: int) -> float:
    return (lon + 180.0) / 360.0 * (2**zoom)


def lat_to_tile_y(lat: float, zoom: int) -> float:
    latitude_radians = math.radians(lat)
    return (1 - math.asinh(math.tan(latitude_radians)) / math.pi) / 2 * (2**zoom)


def fetch_tile(tile_x: int, tile_y: int) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tile_path = CACHE_DIR / f"{ZOOM}-{tile_x}-{tile_y}.png"
    if tile_path.exists():
        return tile_path

    request = urllib.request.Request(
        f"https://tile.openstreetmap.org/{ZOOM}/{tile_x}/{tile_y}.png",
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=30) as response, tile_path.open("wb") as output:
        output.write(response.read())
    return tile_path


def main() -> None:
    min_tile_x = lon_to_tile_x(MIN_LON, ZOOM)
    max_tile_x = lon_to_tile_x(MAX_LON, ZOOM)
    min_tile_y = lat_to_tile_y(MAX_LAT, ZOOM)
    max_tile_y = lat_to_tile_y(MIN_LAT, ZOOM)

    tile_min_x = math.floor(min_tile_x)
    tile_max_x = math.floor(max_tile_x)
    tile_min_y = math.floor(min_tile_y)
    tile_max_y = math.floor(max_tile_y)

    width_tiles = tile_max_x - tile_min_x + 1
    height_tiles = tile_max_y - tile_min_y + 1
    stitched = Image.new("RGB", (width_tiles * 256, height_tiles * 256))

    for tile_x in range(tile_min_x, tile_max_x + 1):
        for tile_y in range(tile_min_y, tile_max_y + 1):
            tile = Image.open(fetch_tile(tile_x, tile_y)).convert("RGB")
            stitched.paste(tile, ((tile_x - tile_min_x) * 256, (tile_y - tile_min_y) * 256))

    crop_left = round((min_tile_x - tile_min_x) * 256)
    crop_top = round((min_tile_y - tile_min_y) * 256)
    crop_right = round((max_tile_x - tile_min_x) * 256)
    crop_bottom = round((max_tile_y - tile_min_y) * 256)

    cropped = stitched.crop((crop_left, crop_top, crop_right, crop_bottom))
    os.makedirs(OUTPUT_PATH.parent, exist_ok=True)
    cropped.save(OUTPUT_PATH, optimize=True)
    print(f"Wrote {OUTPUT_PATH} ({cropped.width}x{cropped.height})")


if __name__ == "__main__":
    main()
