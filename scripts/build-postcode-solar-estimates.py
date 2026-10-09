"""Sample the official PVGIS 5.3 ERA5 annual PV generation GeoTIFF at postcode centres.

Uses only the Python standard library. The downloaded source stays outside the repo.
Usage: python scripts/build-postcode-solar-estimates.py SOURCE.tif
"""
import argparse
import hashlib
import json
import math
import struct
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/PVGIS/PVGIS53_annual_yeld/PVGIS53_annual_yield_optimal_era5_2005_2023.tif"


def read_grid(data):
    if data[:4] != b"II*\x00":
        raise ValueError("Expected the source's little-endian classic GeoTIFF")
    offset = struct.unpack_from("<I", data, 4)[0]
    count = struct.unpack_from("<H", data, offset)[0]
    tags = {}
    formats = {3: ("H", 2), 4: ("I", 4), 12: ("d", 8)}
    for index in range(count):
        entry = offset + 2 + index * 12
        tag, kind, length, pointer = struct.unpack_from("<HHII", data, entry)
        if kind in formats:
            code, size = formats[kind]
            tags[tag] = struct.unpack_from("<" + code * length, data, pointer if size * length > 4 else entry + 8)
    if any(tags.get(tag) != (expected,) for tag, expected in {258: 64, 259: 1, 277: 1, 339: 3}.items()):
        raise ValueError("Expected one uncompressed float64 band; do not reinterpret a changed source")
    keys = tags[34735]
    geo = {keys[index]: keys[index + 3] for index in range(4, len(keys), 4)}
    if geo.get(2048) != 4326 or geo.get(1025) != 1:
        raise ValueError("Expected WGS84 pixel-area coordinates")
    return tags


def sample(data, tags, latitude, longitude):
    scale_x, scale_y, _ = tags[33550]
    pixel_x, pixel_y, _, origin_x, origin_y, _ = tags[33922]
    column = math.floor((longitude - origin_x) / scale_x + pixel_x)
    row = math.floor((origin_y - latitude) / scale_y + pixel_y)
    width, height = tags[256][0], tags[257][0]
    if not 0 <= column < width or not 0 <= row < height:
        return None
    rows_per_strip = tags[278][0]
    position = tags[273][row // rows_per_strip] + ((row % rows_per_strip) * width + column) * 8
    value = struct.unpack_from("<d", data, position)[0]
    # Reject nodata and implausible generated kWh/kWp, never turn them into sunlight.
    return round(value) if math.isfinite(value) and 500 <= value <= 3000 else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    data = args.source.read_bytes()
    tags = read_grid(data)
    centroid_path = ROOT / "src/data/postcode-centroids.json"
    centroids = json.loads(centroid_path.read_text())
    values, missing = {}, []
    for postcode, (latitude, longitude) in sorted(centroids.items()):
        value = sample(data, tags, latitude, longitude)
        if value is None:
            missing.append(postcode)
        else:
            values[postcode] = value
    if len(values) < 2500:
        raise ValueError(f"Unexpectedly low Australian coverage: {len(values)}")
    destination = ROOT / "src/data/postcode-solar-estimates.json"
    destination.write_text(json.dumps(values, separators=(",", ":")) + "\n")
    metadata = {
        "name": "PVGIS 5.3 ERA5 average annual PV generation, optimal tilt",
        "catalogue": "https://data.jrc.ec.europa.eu/dataset/eef67979-e4a9-46f1-80f4-16fe2a266634",
        "source": SOURCE_URL,
        "period": "2005-2023",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "units": "kWh per installed kWp per year",
        "referenceSystem": "PVGIS optimally tilted reference PV system; not the customer's surveyed roof",
        "gridSpacingDegrees": tags[33550][0],
        "sourceSha256": hashlib.sha256(data).hexdigest(),
        "centroidsSha256": hashlib.sha256(centroid_path.read_bytes()).hexdigest(),
        "transformation": "Containing WGS84 grid cell at the existing postcode centre; rounded to whole kWh/kWp. No interpolation or invented values.",
        "licence": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "European Commission, Joint Research Centre, PVGIS 5.3, 2026; contains modified data.",
        "coverage": len(values),
        "missingPostcodes": missing,
        "limitations": "Climate average, not a forecast. Nearby postcodes may share cells. Roof direction, pitch, shade, installation and future weather affect actual generation. Annual localisation does not add seasonal modelling.",
    }
    (ROOT / "src/data/postcode-solar-estimates.source.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Sampled {len(values)} postcodes; {len(missing)} need the labelled regional fallback")
    print({key: values.get(key) for key in ["2000", "2830", "3000", "3500", "4000", "6000", "7000"]})


if __name__ == "__main__":
    main()
