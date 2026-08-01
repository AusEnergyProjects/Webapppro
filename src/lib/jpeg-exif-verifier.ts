export type JpegExifTimestampTag =
  | "DateTimeOriginal"
  | "DateTimeDigitized"
  | "DateTime";

export type JpegExifGps = {
  latitude: number;
  longitude: number;
  latitudeRef: "N" | "S";
  longitudeRef: "E" | "W";
};

export type JpegExifVerification = {
  status: "valid" | "absent" | "invalid";
  validJpeg: boolean;
  exifPresent: boolean;
  captureTimestamp: string | null;
  captureTimestampTag: JpegExifTimestampTag | null;
  gps: JpegExifGps | null;
};

type ExifRange = {
  start: number;
  end: number;
};

type JpegInspection =
  | { valid: false; exifPresent: boolean }
  | { valid: true; exifRanges: ExifRange[] };

type TiffEntry = {
  tag: number;
  type: number;
  count: number;
  dataOffset: number;
  byteLength: number;
};

type ParsedIfd = {
  entries: TiffEntry[];
};

type TiffReader = {
  bytes: Uint8Array;
  start: number;
  end: number;
  littleEndian: boolean;
};

type ParsedExif = {
  captureTimestamp: string | null;
  captureTimestampTag: JpegExifTimestampTag | null;
  gps: JpegExifGps | null;
};

const TIFF_TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

function invalidResult(validJpeg = false, exifPresent = false): JpegExifVerification {
  return {
    status: "invalid",
    validJpeg,
    exifPresent,
    captureTimestamp: null,
    captureTimestampTag: null,
    gps: null,
  };
}

function isRangeWithin(offset: number, length: number, lower: number, upper: number) {
  return Number.isSafeInteger(offset)
    && Number.isSafeInteger(length)
    && length >= 0
    && offset >= lower
    && offset <= upper
    && length <= upper - offset;
}

function isStartOfFrame(marker: number) {
  return (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf);
}

function inspectJpeg(bytes: Uint8Array): JpegInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { valid: false, exifPresent: false };
  }

  const exifRanges: ExifRange[] = [];
  let position = 2;
  let inScan = false;
  let sawFrame = false;
  let sawScan = false;

  while (position < bytes.length) {
    if (bytes[position] !== 0xff) {
      if (inScan) {
        position += 1;
        continue;
      }
      return { valid: false, exifPresent: exifRanges.length > 0 };
    }

    const markerStart = position;
    while (position < bytes.length && bytes[position] === 0xff) {
      position += 1;
    }
    if (position >= bytes.length) {
      return { valid: false, exifPresent: exifRanges.length > 0 };
    }

    const marker = bytes[position];
    position += 1;

    if (inScan && marker === 0x00) {
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      if (!inScan) {
        return { valid: false, exifPresent: exifRanges.length > 0 };
      }
      continue;
    }
    if (marker === 0xd9) {
      const noTrailingBytes = position === bytes.length;
      return sawFrame && sawScan && noTrailingBytes
        ? { valid: true, exifRanges }
        : { valid: false, exifPresent: exifRanges.length > 0 };
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01) {
      return { valid: false, exifPresent: exifRanges.length > 0 };
    }

    inScan = false;
    if (!isRangeWithin(position, 2, 0, bytes.length)) {
      return { valid: false, exifPresent: exifRanges.length > 0 };
    }
    const segmentLength = bytes[position] * 0x100 + bytes[position + 1];
    if (segmentLength < 2) {
      return { valid: false, exifPresent: exifRanges.length > 0 };
    }
    const segmentEnd = position + segmentLength;
    if (!isRangeWithin(position, segmentLength, 0, bytes.length)) {
      return { valid: false, exifPresent: exifRanges.length > 0 };
    }
    const payloadStart = position + 2;

    if (marker === 0xe1
      && segmentEnd - payloadStart >= 6
      && bytes[payloadStart] === 0x45
      && bytes[payloadStart + 1] === 0x78
      && bytes[payloadStart + 2] === 0x69
      && bytes[payloadStart + 3] === 0x66
      && bytes[payloadStart + 4] === 0x00
      && bytes[payloadStart + 5] === 0x00) {
      exifRanges.push({ start: payloadStart + 6, end: segmentEnd });
    }

    if (isStartOfFrame(marker)) {
      const componentCountOffset = payloadStart + 5;
      if (!isRangeWithin(componentCountOffset, 1, payloadStart, segmentEnd)) {
        return { valid: false, exifPresent: exifRanges.length > 0 };
      }
      const componentCount = bytes[componentCountOffset];
      if (componentCount === 0
        || segmentLength !== 8 + componentCount * 3
        || bytes[payloadStart] === 0
        || bytes[payloadStart + 1] === 0
        && bytes[payloadStart + 2] === 0
        || bytes[payloadStart + 3] === 0
        && bytes[payloadStart + 4] === 0) {
        return { valid: false, exifPresent: exifRanges.length > 0 };
      }
      sawFrame = true;
    }

    if (marker === 0xda) {
      if (!sawFrame || segmentEnd - payloadStart < 1) {
        return { valid: false, exifPresent: exifRanges.length > 0 };
      }
      const scanComponentCount = bytes[payloadStart];
      if (scanComponentCount === 0 || segmentLength !== 6 + scanComponentCount * 2) {
        return { valid: false, exifPresent: exifRanges.length > 0 };
      }
      sawScan = true;
      inScan = true;
    }

    position = segmentEnd;
    if (position <= markerStart) {
      return { valid: false, exifPresent: exifRanges.length > 0 };
    }
  }

  return { valid: false, exifPresent: exifRanges.length > 0 };
}

function readUint16(reader: TiffReader, offset: number) {
  if (!isRangeWithin(offset, 2, reader.start, reader.end)) return null;
  const first = reader.bytes[offset];
  const second = reader.bytes[offset + 1];
  return reader.littleEndian
    ? first + second * 0x100
    : first * 0x100 + second;
}

function readUint32(reader: TiffReader, offset: number) {
  if (!isRangeWithin(offset, 4, reader.start, reader.end)) return null;
  const first = reader.bytes[offset];
  const second = reader.bytes[offset + 1];
  const third = reader.bytes[offset + 2];
  const fourth = reader.bytes[offset + 3];
  return reader.littleEndian
    ? first + second * 0x100 + third * 0x10000 + fourth * 0x1000000
    : first * 0x1000000 + second * 0x10000 + third * 0x100 + fourth;
}

function absoluteTiffOffset(reader: TiffReader, relativeOffset: number, length: number) {
  if (!Number.isSafeInteger(relativeOffset) || relativeOffset < 0) return null;
  const absoluteOffset = reader.start + relativeOffset;
  return isRangeWithin(absoluteOffset, length, reader.start, reader.end)
    ? absoluteOffset
    : null;
}

function parseIfd(reader: TiffReader, relativeOffset: number): ParsedIfd | null {
  const ifdOffset = absoluteTiffOffset(reader, relativeOffset, 2);
  if (ifdOffset === null) return null;
  const entryCount = readUint16(reader, ifdOffset);
  if (entryCount === null) return null;
  const tableByteLength = entryCount * 12;
  if (!Number.isSafeInteger(tableByteLength)) return null;
  const entriesOffset = ifdOffset + 2;
  if (!isRangeWithin(entriesOffset, tableByteLength + 4, reader.start, reader.end)) {
    return null;
  }

  const entries: TiffEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entriesOffset + index * 12;
    const tag = readUint16(reader, entryOffset);
    const type = readUint16(reader, entryOffset + 2);
    const count = readUint32(reader, entryOffset + 4);
    if (tag === null || type === null || count === null) return null;
    const typeSize = TIFF_TYPE_SIZES[type];
    if (typeSize === undefined) return null;
    const byteLength = count * typeSize;
    if (!Number.isSafeInteger(byteLength)) return null;

    let dataOffset = entryOffset + 8;
    if (byteLength > 4) {
      const relativeDataOffset = readUint32(reader, entryOffset + 8);
      if (relativeDataOffset === null) return null;
      const externalDataOffset = absoluteTiffOffset(reader, relativeDataOffset, byteLength);
      if (externalDataOffset === null) return null;
      dataOffset = externalDataOffset;
    } else if (!isRangeWithin(dataOffset, byteLength, reader.start, reader.end)) {
      return null;
    }

    entries.push({ tag, type, count, dataOffset, byteLength });
  }

  return { entries };
}

function findUniqueEntry(entries: TiffEntry[], tag: number): TiffEntry | null | false {
  const matches = entries.filter((entry) => entry.tag === tag);
  if (matches.length > 1) return false;
  return matches[0] ?? null;
}

function pointerFromEntry(reader: TiffReader, entry: TiffEntry | null | false) {
  if (entry === false) return false;
  if (entry === null) return null;
  if (entry.type !== 4 || entry.count !== 1 || entry.byteLength !== 4) return false;
  return readUint32(reader, entry.dataOffset) ?? false;
}

function readExifTimestamp(reader: TiffReader, entry: TiffEntry | null | false) {
  if (entry === false) return false;
  if (entry === null) return null;
  if (entry.type !== 2 || entry.count !== 20 || entry.byteLength !== 20) return false;
  if (!isRangeWithin(entry.dataOffset, 20, reader.start, reader.end)) return false;
  if (reader.bytes[entry.dataOffset + 19] !== 0x00) return false;

  let value = "";
  for (let index = 0; index < 19; index += 1) {
    const byte = reader.bytes[entry.dataOffset + index];
    if (byte < 0x20 || byte > 0x7e) return false;
    value += String.fromCharCode(byte);
  }
  if (!/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]
    || hour > 23
    || minute > 59
    || second > 59) {
    return false;
  }
  return value;
}

function readGpsRef<T extends string>(
  reader: TiffReader,
  entry: TiffEntry | null | false,
  allowed: readonly T[],
): T | null | false {
  if (entry === false) return false;
  if (entry === null) return null;
  if (entry.type !== 2 || entry.count !== 2 || entry.byteLength !== 2) return false;
  const value = String.fromCharCode(reader.bytes[entry.dataOffset]);
  if (reader.bytes[entry.dataOffset + 1] !== 0x00 || !allowed.includes(value as T)) return false;
  return value as T;
}

function readGpsCoordinate(reader: TiffReader, entry: TiffEntry | null | false) {
  if (entry === false) return false;
  if (entry === null) return null;
  if (entry.type !== 5 || entry.count !== 3 || entry.byteLength !== 24) return false;

  const values: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const numerator = readUint32(reader, entry.dataOffset + index * 8);
    const denominator = readUint32(reader, entry.dataOffset + index * 8 + 4);
    if (numerator === null || denominator === null || denominator === 0) return false;
    values.push(numerator / denominator);
  }
  const [degrees, minutes, seconds] = values;
  if (!Number.isFinite(degrees)
    || !Number.isFinite(minutes)
    || !Number.isFinite(seconds)
    || minutes >= 60
    || seconds >= 60) {
    return false;
  }
  return degrees + minutes / 60 + seconds / 3600;
}

function parseGps(reader: TiffReader, gpsIfd: ParsedIfd): JpegExifGps | null | false {
  const latitudeRef = readGpsRef(reader, findUniqueEntry(gpsIfd.entries, 0x0001), ["N", "S"]);
  const latitudeValue = readGpsCoordinate(reader, findUniqueEntry(gpsIfd.entries, 0x0002));
  const longitudeRef = readGpsRef(reader, findUniqueEntry(gpsIfd.entries, 0x0003), ["E", "W"]);
  const longitudeValue = readGpsCoordinate(reader, findUniqueEntry(gpsIfd.entries, 0x0004));
  if (latitudeRef === false
    || latitudeValue === false
    || longitudeRef === false
    || longitudeValue === false) {
    return false;
  }

  if (latitudeRef === null
    && latitudeValue === null
    && longitudeRef === null
    && longitudeValue === null) {
    return null;
  }
  if (latitudeRef === null
    || latitudeValue === null
    || longitudeRef === null
    || longitudeValue === null
    || latitudeValue > 90
    || longitudeValue > 180
    || latitudeValue === 90 && latitudeValue % 1 !== 0
    || longitudeValue === 180 && longitudeValue % 1 !== 0) {
    return false;
  }

  const signedLatitude = latitudeRef === "S" ? -latitudeValue : latitudeValue;
  const signedLongitude = longitudeRef === "W" ? -longitudeValue : longitudeValue;
  return {
    latitude: Object.is(signedLatitude, -0) ? 0 : signedLatitude,
    longitude: Object.is(signedLongitude, -0) ? 0 : signedLongitude,
    latitudeRef,
    longitudeRef,
  };
}

function parseExif(bytes: Uint8Array, range: ExifRange): ParsedExif | null {
  if (!isRangeWithin(range.start, range.end - range.start, 0, bytes.length)
    || range.end - range.start < 8) {
    return null;
  }
  const byteOrderFirst = bytes[range.start];
  const byteOrderSecond = bytes[range.start + 1];
  const littleEndian = byteOrderFirst === 0x49 && byteOrderSecond === 0x49;
  const bigEndian = byteOrderFirst === 0x4d && byteOrderSecond === 0x4d;
  if (!littleEndian && !bigEndian) return null;

  const reader: TiffReader = {
    bytes,
    start: range.start,
    end: range.end,
    littleEndian,
  };
  if (readUint16(reader, range.start + 2) !== 42) return null;
  const ifd0RelativeOffset = readUint32(reader, range.start + 4);
  if (ifd0RelativeOffset === null) return null;
  const ifd0 = parseIfd(reader, ifd0RelativeOffset);
  if (ifd0 === null) return null;

  const exifPointer = pointerFromEntry(reader, findUniqueEntry(ifd0.entries, 0x8769));
  const gpsPointer = pointerFromEntry(reader, findUniqueEntry(ifd0.entries, 0x8825));
  if (exifPointer === false || gpsPointer === false) return null;

  let originalTimestamp: string | null = null;
  let digitizedTimestamp: string | null = null;
  if (exifPointer !== null) {
    const exifIfd = parseIfd(reader, exifPointer);
    if (exifIfd === null) return null;
    const original = readExifTimestamp(reader, findUniqueEntry(exifIfd.entries, 0x9003));
    const digitized = readExifTimestamp(reader, findUniqueEntry(exifIfd.entries, 0x9004));
    if (original === false || digitized === false) return null;
    originalTimestamp = original;
    digitizedTimestamp = digitized;
  }

  const generalTimestamp = readExifTimestamp(reader, findUniqueEntry(ifd0.entries, 0x0132));
  if (generalTimestamp === false) return null;

  let gps: JpegExifGps | null = null;
  if (gpsPointer !== null) {
    const gpsIfd = parseIfd(reader, gpsPointer);
    if (gpsIfd === null) return null;
    const parsedGps = parseGps(reader, gpsIfd);
    if (parsedGps === false) return null;
    gps = parsedGps;
  }

  if (originalTimestamp !== null) {
    return {
      captureTimestamp: originalTimestamp,
      captureTimestampTag: "DateTimeOriginal",
      gps,
    };
  }
  if (digitizedTimestamp !== null) {
    return {
      captureTimestamp: digitizedTimestamp,
      captureTimestampTag: "DateTimeDigitized",
      gps,
    };
  }
  return {
    captureTimestamp: generalTimestamp,
    captureTimestampTag: generalTimestamp === null ? null : "DateTime",
    gps,
  };
}

export function verifyJpegExif(bytes: Uint8Array): JpegExifVerification {
  try {
    const jpeg = inspectJpeg(bytes);
    if (!jpeg.valid) return invalidResult(false, jpeg.exifPresent);
    if (jpeg.exifRanges.length === 0) {
      return {
        status: "absent",
        validJpeg: true,
        exifPresent: false,
        captureTimestamp: null,
        captureTimestampTag: null,
        gps: null,
      };
    }
    if (jpeg.exifRanges.length !== 1) return invalidResult(true, true);
    const parsedExif = parseExif(bytes, jpeg.exifRanges[0]);
    if (parsedExif === null) return invalidResult(true, true);
    return {
      status: "valid",
      validJpeg: true,
      exifPresent: true,
      ...parsedExif,
    };
  } catch {
    return invalidResult();
  }
}
