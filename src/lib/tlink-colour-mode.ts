export type TLinkColourMode = "day" | "night";

export const TLINK_COLOUR_MODE_STORAGE_KEY = "tlink-colour-mode";

type ColourModeReader = Pick<Storage, "getItem"> | null | undefined;
type ColourModeWriter = Pick<Storage, "setItem"> | null | undefined;

export function readTLinkColourMode(
  storage: ColourModeReader,
): TLinkColourMode {
  try {
    return storage?.getItem(TLINK_COLOUR_MODE_STORAGE_KEY) === "night"
      ? "night"
      : "day";
  } catch {
    return "day";
  }
}

export function writeTLinkColourMode(
  storage: ColourModeWriter,
  mode: TLinkColourMode,
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(TLINK_COLOUR_MODE_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
