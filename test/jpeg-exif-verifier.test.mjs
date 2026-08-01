import test from "node:test";
import assert from "node:assert/strict";
import { verifyJpegExif } from "../src/lib/jpeg-exif-verifier.ts";

function joinBytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function writeUint16(bytes, offset, value, littleEndian) {
  if (littleEndian) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = value >>> 8 & 0xff;
    return;
  }
  bytes[offset] = value >>> 8 & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeUint32(bytes, offset, value, littleEndian) {
  if (littleEndian) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = value >>> 8 & 0xff;
    bytes[offset + 2] = value >>> 16 & 0xff;
    bytes[offset + 3] = value >>> 24 & 0xff;
    return;
  }
  bytes[offset] = value >>> 24 & 0xff;
  bytes[offset + 1] = value >>> 16 & 0xff;
  bytes[offset + 2] = value >>> 8 & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeEntry(bytes, offset, tag, type, count, value, littleEndian) {
  writeUint16(bytes, offset, tag, littleEndian);
  writeUint16(bytes, offset + 2, type, littleEndian);
  writeUint32(bytes, offset + 4, count, littleEndian);
  writeUint32(bytes, offset + 8, value, littleEndian);
}

function buildTiff({ includeGps = true, littleEndian = true } = {}) {
  const ifd0Offset = 8;
  const ifd0EntryCount = includeGps ? 2 : 1;
  const ifd0ByteLength = 2 + ifd0EntryCount * 12 + 4;
  const exifIfdOffset = ifd0Offset + ifd0ByteLength;
  const exifIfdByteLength = 2 + 12 + 4;
  const timestampOffset = exifIfdOffset + exifIfdByteLength;
  const gpsIfdOffset = timestampOffset + 20;
  const gpsIfdByteLength = 2 + 4 * 12 + 4;
  const coordinatesOffset = gpsIfdOffset + gpsIfdByteLength;
  const tiffLength = includeGps ? coordinatesOffset + 48 : timestampOffset + 20;
  const bytes = new Uint8Array(tiffLength);

  bytes[0] = littleEndian ? 0x49 : 0x4d;
  bytes[1] = littleEndian ? 0x49 : 0x4d;
  writeUint16(bytes, 2, 42, littleEndian);
  writeUint32(bytes, 4, ifd0Offset, littleEndian);

  writeUint16(bytes, ifd0Offset, ifd0EntryCount, littleEndian);
  writeEntry(bytes, ifd0Offset + 2, 0x8769, 4, 1, exifIfdOffset, littleEndian);
  if (includeGps) {
    writeEntry(bytes, ifd0Offset + 14, 0x8825, 4, 1, gpsIfdOffset, littleEndian);
  }
  writeUint32(bytes, ifd0Offset + 2 + ifd0EntryCount * 12, 0, littleEndian);

  writeUint16(bytes, exifIfdOffset, 1, littleEndian);
  writeEntry(bytes, exifIfdOffset + 2, 0x9003, 2, 20, timestampOffset, littleEndian);
  writeUint32(bytes, exifIfdOffset + 14, 0, littleEndian);
  const timestamp = "2026:08:01 12:34:56";
  for (let index = 0; index < timestamp.length; index += 1) {
    bytes[timestampOffset + index] = timestamp.charCodeAt(index);
  }

  if (includeGps) {
    writeUint16(bytes, gpsIfdOffset, 4, littleEndian);
    writeEntry(bytes, gpsIfdOffset + 2, 0x0001, 2, 2, littleEndian ? 0x00000053 : 0x53000000, littleEndian);
    writeEntry(bytes, gpsIfdOffset + 14, 0x0002, 5, 3, coordinatesOffset, littleEndian);
    writeEntry(bytes, gpsIfdOffset + 26, 0x0003, 2, 2, littleEndian ? 0x00000045 : 0x45000000, littleEndian);
    writeEntry(bytes, gpsIfdOffset + 38, 0x0004, 5, 3, coordinatesOffset + 24, littleEndian);
    writeUint32(bytes, gpsIfdOffset + 50, 0, littleEndian);

    const rationals = [
      [37, 1],
      [48, 1],
      [30, 1],
      [144, 1],
      [57, 1],
      [0, 1],
    ];
    rationals.forEach(([numerator, denominator], index) => {
      writeUint32(bytes, coordinatesOffset + index * 8, numerator, littleEndian);
      writeUint32(bytes, coordinatesOffset + index * 8 + 4, denominator, littleEndian);
    });
  }

  return bytes;
}

function segment(marker, payload) {
  const length = payload.length + 2;
  return joinBytes(
    Uint8Array.from([0xff, marker, length >>> 8, length & 0xff]),
    payload,
  );
}

function buildJpeg({ includeExif = true, includeGps = true, littleEndian = true } = {}) {
  const exifSegment = includeExif
    ? segment(
      0xe1,
      joinBytes(
        Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]),
        buildTiff({ includeGps, littleEndian }),
      ),
    )
    : new Uint8Array();
  const startOfFrame = segment(
    0xc0,
    Uint8Array.from([0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
  );
  const startOfScan = segment(
    0xda,
    Uint8Array.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  );
  return joinBytes(
    Uint8Array.from([0xff, 0xd8]),
    exifSegment,
    startOfFrame,
    startOfScan,
    Uint8Array.from([0x00, 0xff, 0xd9]),
  );
}

function findExifTiffStart(bytes) {
  for (let index = 0; index <= bytes.length - 6; index += 1) {
    if (bytes[index] === 0x45
      && bytes[index + 1] === 0x78
      && bytes[index + 2] === 0x69
      && bytes[index + 3] === 0x66
      && bytes[index + 4] === 0
      && bytes[index + 5] === 0) {
      return index + 6;
    }
  }
  throw new Error("Synthetic EXIF signature not found");
}

for (const littleEndian of [true, false]) {
  test(`extracts embedded timestamp and GPS from ${littleEndian ? "little" : "big"} endian EXIF`, () => {
    const result = verifyJpegExif(buildJpeg({ littleEndian }));

    assert.equal(result.status, "valid");
    assert.equal(result.validJpeg, true);
    assert.equal(result.exifPresent, true);
    assert.equal(result.captureTimestamp, "2026:08:01 12:34:56");
    assert.equal(result.captureTimestampTag, "DateTimeOriginal");
    assert.equal(result.gps?.latitudeRef, "S");
    assert.equal(result.gps?.longitudeRef, "E");
    assert.ok(Math.abs(result.gps.latitude - -37.80833333333333) < 1e-10);
    assert.ok(Math.abs(result.gps.longitude - 144.95) < 1e-10);
  });
}

test("reports a structurally valid JPEG without EXIF as absent", () => {
  assert.deepEqual(verifyJpegExif(buildJpeg({ includeExif: false })), {
    status: "absent",
    validJpeg: true,
    exifPresent: false,
    captureTimestamp: null,
    captureTimestampTag: null,
    gps: null,
  });
});

test("returns timestamp facts but no coordinates when EXIF has no GPS IFD", () => {
  const result = verifyJpegExif(buildJpeg({ includeGps: false }));

  assert.equal(result.status, "valid");
  assert.equal(result.captureTimestamp, "2026:08:01 12:34:56");
  assert.equal(result.captureTimestampTag, "DateTimeOriginal");
  assert.equal(result.gps, null);
});

test("fails closed without throwing for malformed TIFF offsets and counts", () => {
  const invalidOffset = buildJpeg();
  const offsetTiffStart = findExifTiffStart(invalidOffset);
  invalidOffset.fill(0xff, offsetTiffStart + 18, offsetTiffStart + 22);
  assert.deepEqual(verifyJpegExif(invalidOffset), {
    status: "invalid",
    validJpeg: true,
    exifPresent: true,
    captureTimestamp: null,
    captureTimestampTag: null,
    gps: null,
  });

  const overflowingCount = buildJpeg();
  const countTiffStart = findExifTiffStart(overflowingCount);
  const exifIfdOffset = 38;
  overflowingCount.fill(0xff, countTiffStart + exifIfdOffset + 6, countTiffStart + exifIfdOffset + 10);
  assert.doesNotThrow(() => verifyJpegExif(overflowingCount));
  assert.equal(verifyJpegExif(overflowingCount).status, "invalid");
});

test("fails closed without throwing for truncated or non-JPEG input", () => {
  const truncated = buildJpeg().slice(0, -7);

  assert.doesNotThrow(() => verifyJpegExif(truncated));
  assert.equal(verifyJpegExif(truncated).status, "invalid");
  assert.equal(verifyJpegExif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])).status, "invalid");
});
