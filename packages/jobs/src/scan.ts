import path from "node:path";
import { promises as fs } from "node:fs";
import {
  SourceEntry,
  SourceEntryId,
  SourceId,
  createEvent,
  newSourceEntryId,
  asSourceId,
  JsonObject
} from "@family-media-vault/core";
import { hashFirst64kSha256 } from "@family-media-vault/storage";
import { DomainState } from "@family-media-vault/storage";
import { JobEngine } from "./job-engine";

export interface ScanHandlerOptions {
  state: DomainState;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
  jobEngine: JobEngine;
  now?: () => number;
}

export function createScanJobHandler(options: ScanHandlerOptions) {
  const now = options.now ?? (() => Date.now());

  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const sourceIdRaw = payload.sourceId;
    if (typeof sourceIdRaw !== "string") {
      throw new Error("scan job payload must include sourceId");
    }
    const sourceId = asSourceId(sourceIdRaw);
    const source = options.state.sources.getSource(sourceId);
    if (!source) {
      throw new Error(`Unknown source ${sourceId}`);
    }

    const scanNow = now();
    const files = await listFiles(source.path, source.recursive, source.excludeGlobs);
    const seen = new Set<SourceEntryId>();

    for (const file of files) {
      const existing = options.state.sources.getEntryByIdentity(
        sourceId,
        "file",
        file.path
      );
      const fingerprintInfo = await computeFingerprint(file.path, file.size, file.mtimeMs, existing);
      const entry: SourceEntry = {
        sourceEntryId: existing?.sourceEntryId ?? newSourceEntryId(),
        sourceId,
        kind: "file",
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        fingerprint: fingerprintInfo.fingerprint,
        lastSeenAt: scanNow,
        state: "active"
      };

      await options.appendEvent(createEvent("SOURCE_ENTRY_UPSERTED", { entry }));
      seen.add(entry.sourceEntryId);

      if (!existing || fingerprintInfo.changed) {
        await options.jobEngine.enqueue("ingest:stage-a-b", {
          sourceEntryId: entry.sourceEntryId
        });
      }
    }

    for (const entry of options.state.sources.listEntriesForSource(sourceId)) {
      if (seen.has(entry.sourceEntryId)) {
        continue;
      }
      if (entry.state === "missing") {
        continue;
      }
      await options.appendEvent(
        createEvent("SOURCE_ENTRY_MARKED_MISSING", {
          sourceEntryId: entry.sourceEntryId,
          sourceId,
          lastSeenAt: scanNow
        })
      );
    }
  };
}

interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

async function listFiles(root: string, recursive: boolean, excludeGlobs: string[]): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  const normalizedRoot = path.resolve(root);

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relative = normalizePath(path.relative(normalizedRoot, fullPath));
      if (shouldExclude(relative, excludeGlobs)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (recursive) {
          await walk(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = await fs.stat(fullPath);
      results.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };

  await walk(normalizedRoot);
  return results;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function shouldExclude(relativePath: string, excludeGlobs: string[]): boolean {
  if (!excludeGlobs || excludeGlobs.length === 0) {
    return false;
  }
  return excludeGlobs.some((glob) => globToRegExp(glob).test(relativePath));
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "@@DOUBLE_STAR@@")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/@@DOUBLE_STAR@@/g, ".*");
  return new RegExp(`^${escaped}$`);
}

async function computeFingerprint(
  filePath: string,
  size: number,
  mtimeMs: number,
  existing?: SourceEntry
): Promise<{ fingerprint: string; changed: boolean }> {
  if (existing && existing.size === size && existing.mtimeMs === mtimeMs) {
    return { fingerprint: existing.fingerprint, changed: false };
  }
  const headHash = await hashFirst64kSha256(filePath);
  return { fingerprint: `${size}:${Math.floor(mtimeMs)}:${headHash}`, changed: true };
}
