export const TEAM_MEMBER_FILE_MAX_BYTES = 12 * 1024 * 1024;
export const TEAM_MEMBER_FILE_LIMIT = 40;
export const TEAM_MEMBER_FILE_CATEGORIES = new Set(["id", "licence", "compliance", "training", "insurance", "other"]);
export const TEAM_MEMBER_FILE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export class TeamMemberFileError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export function safeTeamMemberFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "team-member-file";
}

function hasFileSignature(bytes: Uint8Array, contentType: string) {
  if (contentType === "application/pdf") {
    return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50
      && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  return false;
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function inspectTeamMemberFile(file: File) {
  if (!file.name) throw new TeamMemberFileError("FILE_REQUIRED", "Choose a team member file.");
  if (!TEAM_MEMBER_FILE_CONTENT_TYPES.has(file.type)) {
    throw new TeamMemberFileError("FILE_TYPE_INVALID", "Upload a PDF, JPEG or PNG file.");
  }
  if (file.size <= 0 || file.size > TEAM_MEMBER_FILE_MAX_BYTES) {
    throw new TeamMemberFileError("FILE_SIZE_INVALID", "The file must be no larger than 12 MB.");
  }
  const value = await file.arrayBuffer();
  const bytes = new Uint8Array(value);
  if (bytes.byteLength !== file.size || !hasFileSignature(bytes, file.type)) {
    throw new TeamMemberFileError("FILE_SIGNATURE_INVALID", "The file contents do not match the selected file type.");
  }
  const sha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
  return {
    value,
    sha256,
    fileName: safeTeamMemberFileName(file.name),
    contentType: file.type,
    sizeBytes: file.size,
  };
}
