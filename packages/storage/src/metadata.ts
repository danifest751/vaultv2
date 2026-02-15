import path from "node:path";
import { MediaKind, MediaMetadata, TimestampMs, JsonObject } from "@family-media-vault/core";

const PHOTO_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".bmp"
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".webm",
  ".m4v",
  ".3gp"
]);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
  ".3gp": "video/3gpp"
};

export function detectMediaKind(filePath: string): MediaKind {
  const ext = path.extname(filePath).toLowerCase();
  if (PHOTO_EXTENSIONS.has(ext)) {
    return "photo";
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  return "unknown";
}

export function extractBasicMetadata(
  filePath: string,
  entryMtimeMs: TimestampMs
): MediaMetadata {
  const ext = path.extname(filePath).toLowerCase();
  const kind = detectMediaKind(filePath);
  const raw: JsonObject = { ext };

  return {
    kind,
    takenAt: entryMtimeMs,
    mimeType: MIME_BY_EXT[ext],
    raw
  };
}
