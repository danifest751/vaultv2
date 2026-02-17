import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JsonObject, asMediaId } from "@family-media-vault/core";
import {
  DerivedKind,
  DerivedLayout,
  DomainState,
  VaultLayout,
  derivedPathForMedia,
  ensureDir,
  mediaPathForSha256
} from "@family-media-vault/storage";

const execFileAsync = promisify(execFile);

export interface DerivedCommandRunner {
  run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

const defaultDerivedRunner: DerivedCommandRunner = {
  run: async (command, args) => execFileAsync(command, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
};

export interface DerivedGenerateJobHandlerOptions {
  state: DomainState;
  vault: VaultLayout;
  derived: DerivedLayout;
  commandRunner?: DerivedCommandRunner;
}

export function createDerivedGenerateJobHandler(options: DerivedGenerateJobHandlerOptions) {
  const commandRunner = options.commandRunner ?? defaultDerivedRunner;

  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const mediaIdRaw = payload.mediaId;
    const kindRaw = payload.kind;
    if (typeof mediaIdRaw !== "string") {
      throw new Error("derived job payload must include mediaId");
    }
    if (kindRaw !== "thumb" && kindRaw !== "poster") {
      throw new Error("derived job payload must include kind (thumb|poster)");
    }

    const mediaId = asMediaId(mediaIdRaw);
    const kind = kindRaw as DerivedKind;
    const media = options.state.media.get(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    const outputPath = derivedPathForMedia(options.derived, mediaId, kind);
    if (await fileExists(outputPath)) {
      return;
    }

    await ensureDir(path.dirname(outputPath));
    const sourcePath = mediaPathForSha256(options.vault, media.sha256);
    const metadata = options.state.metadata.get(mediaId);
    const mimeType = metadata?.mimeType ?? "";

    const tempPath = createTempOutputPath(outputPath);
    try {
      if (kind === "thumb") {
        await generateThumb(sourcePath, tempPath, mimeType, commandRunner);
      } else {
        await generatePoster(sourcePath, tempPath, commandRunner);
      }

      if (await fileExists(outputPath)) {
        await safeUnlink(tempPath);
        return;
      }

      await fs.rename(tempPath, outputPath);
    } catch (error) {
      await safeUnlink(tempPath);
      if (await fileExists(outputPath)) {
        return;
      }
      throw error;
    }
  };
}

function createTempOutputPath(outputPath: string): string {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${outputPath}.tmp-${unique}`;
}

async function generateThumb(
  inputPath: string,
  outputPath: string,
  mimeType: string,
  commandRunner: DerivedCommandRunner
): Promise<void> {
  if (mimeType.startsWith("video/")) {
    await generatePoster(inputPath, outputPath, commandRunner);
    return;
  }

  await commandRunner.run("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale='min(320,iw)':-2",
    "-frames:v",
    "1",
    outputPath
  ]);
}

async function generatePoster(
  inputPath: string,
  outputPath: string,
  commandRunner: DerivedCommandRunner
): Promise<void> {
  await commandRunner.run("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-ss",
    "00:00:01.000",
    "-vf",
    "scale='min(640,iw)':-2",
    "-frames:v",
    "1",
    outputPath
  ]);
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function safeUnlink(targetPath: string): Promise<void> {
  try {
    await fs.unlink(targetPath);
  } catch {
    return;
  }
}
