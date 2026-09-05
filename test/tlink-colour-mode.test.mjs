import assert from "node:assert/strict";
import test from "node:test";
import {
  readTLinkColourMode,
  TLINK_COLOUR_MODE_STORAGE_KEY,
  writeTLinkColourMode,
} from "../src/lib/tlink-colour-mode.ts";

test("TLink colour mode reads only the exact persisted values", () => {
  assert.equal(TLINK_COLOUR_MODE_STORAGE_KEY, "tlink-colour-mode");

  for (const mode of ["day", "night"]) {
    const storage = {
      getItem(key) {
        assert.equal(key, TLINK_COLOUR_MODE_STORAGE_KEY);
        return mode;
      },
    };

    assert.equal(readTLinkColourMode(storage), mode);
  }
});

test("TLink colour mode defaults to day for missing or invalid values", () => {
  for (const value of [null, "", "dark", "NIGHT", " night "]) {
    assert.equal(readTLinkColourMode({ getItem: () => value }), "day");
  }

  assert.equal(readTLinkColourMode(undefined), "day");
  assert.equal(readTLinkColourMode(null), "day");
});

test("TLink colour mode defaults to day when storage reads fail", () => {
  const storage = {
    getItem() {
      throw new Error("Storage unavailable");
    },
  };

  assert.equal(readTLinkColourMode(storage), "day");
});

test("TLink colour mode writes valid values with the stable key", () => {
  const writes = [];
  const storage = {
    setItem(key, value) {
      writes.push([key, value]);
    },
  };

  assert.equal(writeTLinkColourMode(storage, "night"), true);
  assert.equal(writeTLinkColourMode(storage, "day"), true);
  assert.deepEqual(writes, [
    [TLINK_COLOUR_MODE_STORAGE_KEY, "night"],
    [TLINK_COLOUR_MODE_STORAGE_KEY, "day"],
  ]);
});

test("TLink colour mode writes fail safely", () => {
  const storage = {
    setItem() {
      throw new Error("Storage unavailable");
    },
  };

  assert.equal(writeTLinkColourMode(storage, "night"), false);
  assert.equal(writeTLinkColourMode(undefined, "day"), false);
  assert.equal(writeTLinkColourMode(null, "day"), false);
});
