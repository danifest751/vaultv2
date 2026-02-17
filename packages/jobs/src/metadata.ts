import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { JsonObject, MediaMetadata, asMediaId, asSourceEntryId, createEvent } from "@family-media-vault/core";
import { DomainState, extractBasicMetadata } from "@family-media-vault/storage";
import { JobEngine } from "./job-engine";

const execFileAsync = promisify(execFile);

export interface CommandRunner {
  run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

const defaultCommandRunner: CommandRunner = {
  run: async (command, args) => execFileAsync(command, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
};

export interface MetadataHandlerOptions {
  state: DomainState;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
  commandRunner?: CommandRunner;
  jobEngine?: Pick<JobEngine, "enqueue" | "enqueueDeduped">;
}

export function createMetadataJobHandler(options: MetadataHandlerOptions) {
  const commandRunner = options.commandRunner ?? defaultCommandRunner;

  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const mediaIdRaw = payload.mediaId;
    const entryIdRaw = payload.sourceEntryId;
    if (typeof mediaIdRaw !== "string" || typeof entryIdRaw !== "string") {
      throw new Error("metadata job payload must include mediaId and sourceEntryId");
    }

    const mediaId = asMediaId(mediaIdRaw);
    const entryId = asSourceEntryId(entryIdRaw);
    const entry = options.state.sources.getEntry(entryId);
    if (!entry || !entry.path) {
      throw new Error(`Source entry not found: ${entryId}`);
    }

    const metadata = await extractNormalizedMetadata(entry.path, entry.mtimeMs, commandRunner);

    await options.appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId,
        sourceEntryId: entryId,
        metadata
      })
    );

    if (options.jobEngine) {
      await enqueueDerivedJob(options.jobEngine, {
        mediaId,
        kind: "thumb"
      });
      if (metadata.kind === "video") {
        await enqueueDerivedJob(options.jobEngine, {
          mediaId,
          kind: "poster"
        });
      }
    }
  };
}

async function extractNormalizedMetadata(
  filePath: string,
  entryMtimeMs: number,
  commandRunner: CommandRunner
): Promise<MediaMetadata> {
  const basic = extractBasicMetadata(filePath, entryMtimeMs);

  if (basic.kind === "photo") {
    const exifMetadata = await tryExtractPhotoMetadata(filePath, commandRunner);
    const merged = exifMetadata ? mergeMetadata(basic, exifMetadata) : basic;
    return attachPerceptualHash(merged, await tryExtractPerceptualHash(filePath, "photo"));
  }

  if (basic.kind === "video") {
    const ffprobeMetadata = await tryExtractVideoMetadata(filePath, commandRunner);
    const merged = ffprobeMetadata ? mergeMetadata(basic, ffprobeMetadata) : basic;
    return attachPerceptualHash(merged, await tryExtractPerceptualHash(filePath, "video"));
  }

  return basic;
}

async function tryExtractPerceptualHash(filePath: string, kind: "photo" | "video"): Promise<string | undefined> {
  try {
    const args =
      kind === "video"
        ? [
            "-v",
            "error",
            "-ss",
            "00:00:01.000",
            "-i",
            filePath,
            "-vf",
            "scale=9:8,format=gray",
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "pipe:1"
          ]
        : [
            "-v",
            "error",
            "-i",
            filePath,
            "-vf",
            "scale=9:8,format=gray",
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "pipe:1"
          ];

    const stdout = await execFileBuffer("ffmpeg", args);
    const hash = computeDHash64(stdout);
    return hash ?? undefined;
  } catch {
    return undefined;
  }
}

function attachPerceptualHash(metadata: MediaMetadata, perceptualHash: string | undefined): MediaMetadata {
  if (!perceptualHash) {
    return metadata;
  }

  return {
    ...metadata,
    raw: sanitizeRaw({
      ...(metadata.raw ?? {}),
      perceptualHash,
      perceptualHashAlgo: "dhash64-v1"
    })
  };
}

function computeDHash64(frameGray: Buffer): string | null {
  const width = 9;
  const height = 8;
  const expectedBytes = width * height;
  if (frameGray.length < expectedBytes) {
    return null;
  }

  const bits: string[] = [];
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width - 1; x += 1) {
      const left = frameGray[rowOffset + x] ?? 0;
      const right = frameGray[rowOffset + x + 1] ?? 0;
      bits.push(left > right ? "1" : "0");
    }
  }

  if (bits.length !== 64) {
    return null;
  }

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = bits.slice(i, i + 4).join("");
    hex += Number.parseInt(nibble, 2).toString(16);
  }
  return hex;
}

function execFileBuffer(command: string, args: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "buffer"
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout as Buffer);
      }
    );
  });
}

async function tryExtractPhotoMetadata(
  filePath: string,
  commandRunner: CommandRunner
): Promise<Partial<MediaMetadata> | null> {
  try {
    const { stdout } = await commandRunner.run("exiftool", ["-j", "-n", filePath]);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    const first = parsed[0] ?? {};

    const width = toFiniteNumber(first.ImageWidth);
    const height = toFiniteNumber(first.ImageHeight);
    const cameraModel = toNonEmptyString(first.Model);
    const takenAt = parseTakenAtMs(first.DateTimeOriginal ?? first.CreateDate ?? first.ModifyDate);
    const mimeType = toNonEmptyString(first.MIMEType);

    return {
      kind: "photo",
      width,
      height,
      cameraModel,
      takenAt,
      mimeType,
      raw: sanitizeRaw({
        extractor: "exiftool",
        imageWidth: first.ImageWidth,
        imageHeight: first.ImageHeight,
        model: first.Model,
        dateTimeOriginal: first.DateTimeOriginal,
        createDate: first.CreateDate,
        mimeType: first.MIMEType,
        ext: path.extname(filePath).toLowerCase()
      })
    };
  } catch {
    return null;
  }
}

async function tryExtractVideoMetadata(
  filePath: string,
  commandRunner: CommandRunner
): Promise<Partial<MediaMetadata> | null> {
  try {
    const { stdout } = await commandRunner.run("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath
    ]);

    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; format_name?: string; tags?: Record<string, unknown> };
      streams?: Array<Record<string, unknown>>;
    };

    const videoStream = (parsed.streams ?? []).find((stream) => stream.codec_type === "video") ?? null;
    const width = videoStream ? toFiniteNumber(videoStream.width) : undefined;
    const height = videoStream ? toFiniteNumber(videoStream.height) : undefined;
    const durationSeconds = toFiniteNumber(parsed.format?.duration);
    const durationMs = durationSeconds !== undefined ? Math.round(durationSeconds * 1000) : undefined;
    const takenAt = parseTakenAtMs(parsed.format?.tags?.creation_time);

    return {
      kind: "video",
      width,
      height,
      durationMs,
      takenAt,
      mimeType: inferVideoMimeType(parsed.format?.format_name),
      raw: sanitizeRaw({
        extractor: "ffprobe",
        formatName: parsed.format?.format_name,
        duration: parsed.format?.duration,
        creationTime: parsed.format?.tags?.creation_time,
        codecName: videoStream?.codec_name,
        ext: path.extname(filePath).toLowerCase()
      })
    };
  } catch {
    return null;
  }
}

function mergeMetadata(base: MediaMetadata, extracted: Partial<MediaMetadata>): MediaMetadata {
  return {
    kind: extracted.kind ?? base.kind,
    takenAt: extracted.takenAt ?? base.takenAt,
    width: extracted.width ?? base.width,
    height: extracted.height ?? base.height,
    durationMs: extracted.durationMs ?? base.durationMs,
    cameraModel: extracted.cameraModel ?? base.cameraModel,
    mimeType: extracted.mimeType ?? base.mimeType,
    raw: sanitizeRaw({ ...(base.raw ?? {}), ...(extracted.raw ?? {}) })
  };
}

function parseTakenAtMs(value: unknown): number | undefined {
  const text = toNonEmptyString(value);
  if (!text) {
    return undefined;
  }

  const normalized = text
    .replace(/^([0-9]{4}):([0-9]{2}):([0-9]{2}) /, "$1-$2-$3T")
    .replace(" ", "T");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

async function enqueueDerivedJob(
  jobEngine: Pick<JobEngine, "enqueue" | "enqueueDeduped">,
  payload: JsonObject
): Promise<void> {
  if (typeof jobEngine.enqueueDeduped === "function") {
    await jobEngine.enqueueDeduped("derived:generate", payload);
    return;
  }
  await jobEngine.enqueue("derived:generate", payload);
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeRaw(raw: Record<string, unknown>): JsonObject {
  const normalized: JsonObject = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function inferVideoMimeType(formatName: unknown): string | undefined {
  const text = toNonEmptyString(formatName);
  if (!text) {
    return undefined;
  }
  if (text.includes("mp4") || text.includes("mov")) {
    return "video/mp4";
  }
  if (text.includes("matroska") || text.includes("webm")) {
    return "video/webm";
  }
  return undefined;
}
