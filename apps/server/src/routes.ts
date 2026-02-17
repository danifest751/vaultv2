import { createReadStream, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import {
  JsonObject,
  Source,
  asMediaId,
  asQuarantineItemId,
  asSourceEntryId,
  asSourceId,
  newSourceId,
  createEvent
} from "@family-media-vault/core";
import {
  derivedPathForMedia,
  mediaPathForSha256,
  readSnapshotPointer,
  snapshotDomainState,
  writeSnapshot
} from "@family-media-vault/storage";
import { sendHtml, sendJson, readJson } from "./http-utils";
import { pruneSnapshots } from "./snapshot-retention";
import { renderDevConsoleHtml } from "./ui";
import { ServerRuntime } from "./bootstrap";

export interface RequestHandlerOptions {
  authToken?: string;
  sourcePathAllowlistRoots?: string[];
  snapshotRetentionMax?: number;
}

function cursorStartIndex(sortedMediaIds: string[], cursor: string): number {
  const index = sortedMediaIds.indexOf(cursor);
  return index < 0 ? 0 : index + 1;
}

interface ToolsHealthSnapshot {
  checkedAt: number;
  tools: {
    exiftool: boolean;
    ffprobe: boolean;
    ffmpeg: boolean;
  };
}

function inferMimeTypeFromSourceEntry(filePath: string | undefined): string {
  if (!filePath) {
    return "application/octet-stream";
  }

  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm"
  };

  return byExt[ext] ?? "application/octet-stream";
}

function normalizePathForComparison(inputPath: string): string {
  const normalized = path.resolve(inputPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSourcePathAllowed(sourcePath: string, allowlistRoots: string[]): boolean {
  if (allowlistRoots.length === 0) {
    return true;
  }

  const normalizedSourcePath = normalizePathForComparison(sourcePath);
  return allowlistRoots.some((root) => isPathWithinRoot(normalizedSourcePath, root));
}

function isAuthorizedRequest(req: IncomingMessage, configuredToken: string): boolean {
  if (!configuredToken) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token === configuredToken) {
      return true;
    }
  }

  const xAuthToken = req.headers["x-auth-token"];
  if (typeof xAuthToken === "string" && xAuthToken.trim() === configuredToken) {
    return true;
  }

  if (Array.isArray(xAuthToken) && xAuthToken.some((item) => item.trim() === configuredToken)) {
    return true;
  }

  return false;
}

function isMediaAssetRoute(method: string, parts: string[]): boolean {
  return (
    method === "GET" &&
    ((parts.length === 3 && parts[0] === "media" && parts[2] === "file") ||
      (parts.length === 3 && parts[0] === "derived" && (parts[2] === "thumb" || parts[2] === "poster")))
  );
}

function hasValidAssetAccessToken(fullUrl: URL, configuredToken: string): boolean {
  const sat = fullUrl.searchParams.get("sat");
  if (!sat) {
    return false;
  }
  return verifyAssetToken(sat, configuredToken, Date.now());
}

function createAssetToken(secret: string, nowMs: number): { token: string; expiresAt: number } {
  const ttlMs = 60_000;
  const expiresAt = nowMs + ttlMs;
  const payload = { scope: "assets", exp: expiresAt };
  const payloadBase64 = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = signValue(payloadBase64, secret);
  return { token: `${payloadBase64}.${signature}`, expiresAt };
}

function verifyAssetToken(token: string, secret: string, nowMs: number): boolean {
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex >= token.length - 1) {
    return false;
  }
  const payloadBase64 = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = signValue(payloadBase64, secret);
  if (!safeEqual(signature, expected)) {
    return false;
  }

  try {
    const payloadJson = decodeBase64Url(payloadBase64).toString("utf8");
    const payload = JSON.parse(payloadJson) as { scope?: string; exp?: number };
    if (payload.scope !== "assets") {
      return false;
    }
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return false;
    }
    return payload.exp >= nowMs;
  } catch {
    return false;
  }
}

function signValue(value: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(value).digest();
  return encodeBase64Url(digest);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function encodeBase64Url(input: Buffer): string {
  return input.toString("base64url");
}

function decodeBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function createRequestHandler(runtime: ServerRuntime, options: RequestHandlerOptions = {}) {
  const configuredToken = options.authToken?.trim() ?? "";
  const snapshotRetentionMax = Number.isFinite(options.snapshotRetentionMax)
    ? Math.max(0, Math.floor(options.snapshotRetentionMax ?? 20))
    : 20;
  const allowlistRoots = (options.sourcePathAllowlistRoots ?? [])
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .map((root) => normalizePathForComparison(root));
  let toolsHealthCache: ToolsHealthSnapshot | null = null;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const fullUrl = new URL(url, `http://${req.headers.host ?? "localhost"}`);
    const parts = fullUrl.pathname.split("/").filter(Boolean);
    const isAssetRoute = isMediaAssetRoute(method, parts);
    const hasAssetTokenAccess = configuredToken.length > 0 && isAssetRoute && hasValidAssetAccessToken(fullUrl, configuredToken);
    const isPublicRoute =
      method === "GET" &&
      ((parts.length === 1 && parts[0] === "health") ||
        (parts.length === 2 && parts[0] === "health" && parts[1] === "tools") ||
        (parts.length === 1 && parts[0] === "ui"));

    try {
      if (!isPublicRoute && !isAuthorizedRequest(req, configuredToken) && !hasAssetTokenAccess) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      if (method === "POST" && parts.length === 2 && parts[0] === "auth" && parts[1] === "asset-token") {
        if (!configuredToken) {
          sendJson(res, 400, { error: "auth_not_configured" });
          return;
        }
        const token = createAssetToken(configuredToken, Date.now());
        sendJson(res, 201, token);
        return;
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "derived") {
        const mediaId = asMediaId(parts[1] ?? "");
        const kindRaw = parts[2] ?? "";
        if (kindRaw !== "thumb" && kindRaw !== "poster") {
          sendJson(res, 400, { error: "derived_kind_invalid" });
          return;
        }

        const media = runtime.state.media.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "media_not_found" });
          return;
        }

        const derivedPath = derivedPathForMedia(runtime.derived, mediaId, kindRaw);
        try {
          const stat = await fs.stat(derivedPath);
          res.writeHead(200, {
            "content-type": "image/jpeg",
            "content-length": stat.size,
            "cache-control": "public, max-age=31536000, immutable"
          });
          createReadStream(derivedPath).pipe(res);
        } catch {
          sendJson(res, 404, { error: "derived_not_found" });
        }
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "ui") {
        sendHtml(res, 200, renderDevConsoleHtml());
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "health" && parts[1] === "tools") {
        const now = Date.now();
        const cacheTtlMs = 30_000;
        if (!toolsHealthCache || now - toolsHealthCache.checkedAt > cacheTtlMs) {
          const [exiftool, ffprobe, ffmpeg] = await Promise.all([
            checkToolAvailable("exiftool", ["-ver"]),
            checkToolAvailable("ffprobe", ["-version"]),
            checkToolAvailable("ffmpeg", ["-version"])
          ]);
          toolsHealthCache = {
            checkedAt: now,
            tools: { exiftool, ffprobe, ffmpeg }
          };
        }

        sendJson(res, 200, {
          status: "ok",
          checkedAt: toolsHealthCache.checkedAt,
          tools: toolsHealthCache.tools
        });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "fs" && parts[1] === "dialog") {
        if (process.platform !== "win32") {
          sendJson(res, 400, { error: "unsupported_platform" });
          return;
        }
        const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
        const powershellPath = systemRoot
          ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
          : "powershell";
        const script = [
          "Add-Type -AssemblyName System.Windows.Forms",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          "$dialog.Description = 'Выберите папку с медиа'",
          "$dialog.ShowNewFolderButton = $true",
          "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
          "  [Console]::Out.Write($dialog.SelectedPath)",
          "}"
        ].join("\n");

        const pickPath = () =>
          new Promise<string>((resolve, reject) => {
            execFile(
              powershellPath,
              ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
              { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
              (error, stdout) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve(stdout.trim());
              }
            );
          });
        try {
          const selected = await pickPath();
          sendJson(res, 200, { path: selected || null });
        } catch {
          sendJson(res, 500, { error: "dialog_failed" });
        }
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "sources") {
        sendJson(res, 200, { sources: runtime.state.sources.listSources() });
        return;
      }

      if (method === "POST" && parts.length === 1 && parts[0] === "sources") {
        const body = await readJson(req);
        const sourcePath = typeof body.path === "string" ? body.path : "";
        if (!sourcePath) {
          sendJson(res, 400, { error: "path_required" });
          return;
        }
        if (!isSourcePathAllowed(sourcePath, allowlistRoots)) {
          sendJson(res, 403, { error: "source_path_not_allowed" });
          return;
        }
        const source: Source = {
          sourceId: newSourceId(),
          path: sourcePath,
          recursive: body.recursive === undefined ? true : Boolean(body.recursive),
          includeArchives: body.includeArchives === undefined ? false : Boolean(body.includeArchives),
          excludeGlobs: Array.isArray(body.excludeGlobs)
            ? body.excludeGlobs.filter((item) => typeof item === "string")
            : [],
          createdAt: Date.now()
        };
        await runtime.appendEvent(createEvent("SOURCE_CREATED", { source }));
        sendJson(res, 201, { source });
        return;
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "sources" && parts[2] === "entries") {
        const sourceId = asSourceId(parts[1] ?? "");
        const source = runtime.state.sources.getSource(sourceId);
        if (!source) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        sendJson(res, 200, { entries: runtime.state.sources.listEntriesForSource(sourceId) });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "entries") {
        const sourceIdRaw = fullUrl.searchParams.get("sourceId");
        if (sourceIdRaw) {
          const sourceId = asSourceId(sourceIdRaw);
          const source = runtime.state.sources.getSource(sourceId);
          if (!source) {
            sendJson(res, 404, { error: "source_not_found" });
            return;
          }
          sendJson(res, 200, { entries: runtime.state.sources.listEntriesForSource(sourceId) });
          return;
        }
        sendJson(res, 200, { entries: runtime.state.sources.listEntries() });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "entries") {
        const entryId = asSourceEntryId(parts[1] ?? "");
        const entry = runtime.state.sources.getEntry(entryId);
        if (!entry) {
          sendJson(res, 404, { error: "entry_not_found" });
          return;
        }

        const ingest = runtime.state.ingest.getStatus(entryId);
        const media = runtime.state.media.getBySourceEntryId(entryId);
        const metadata = media ? runtime.state.metadata.get(media.mediaId) : undefined;
        const quarantine = runtime.state.quarantine.getBySourceEntryId(entryId);
        const duplicateLinks = runtime.state.duplicateLinks
          .list()
          .filter((link) => link.sourceEntryId === entryId);

        sendJson(res, 200, {
          entry,
          ingest,
          media,
          metadata,
          quarantine,
          duplicateLinks
        });
        return;
      }

      if (method === "PATCH" && parts.length === 2 && parts[0] === "sources") {
        const sourceId = asSourceId(parts[1] ?? "");
        const existing = runtime.state.sources.getSource(sourceId);
        if (!existing) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        const body = await readJson(req);
        const updated: Source = {
          sourceId,
          path: typeof body.path === "string" ? body.path : existing.path,
          recursive: body.recursive === undefined ? existing.recursive : Boolean(body.recursive),
          includeArchives:
            body.includeArchives === undefined ? existing.includeArchives : Boolean(body.includeArchives),
          excludeGlobs: Array.isArray(body.excludeGlobs)
            ? body.excludeGlobs.filter((item) => typeof item === "string")
            : existing.excludeGlobs,
          createdAt: existing.createdAt
        };
        if (!isSourcePathAllowed(updated.path, allowlistRoots)) {
          sendJson(res, 403, { error: "source_path_not_allowed" });
          return;
        }
        await runtime.appendEvent(createEvent("SOURCE_UPDATED", { source: updated }));
        sendJson(res, 200, { source: updated });
        return;
      }

      if (method === "DELETE" && parts.length === 2 && parts[0] === "sources") {
        const sourceId = asSourceId(parts[1] ?? "");
        const existing = runtime.state.sources.getSource(sourceId);
        if (!existing) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        await runtime.appendEvent(createEvent("SOURCE_REMOVED", { sourceId }));
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "media") {
        const media = runtime.state.media.list();
        const hasLimit = fullUrl.searchParams.has("limit");
        const hasOffset = fullUrl.searchParams.has("offset");

        if (!hasLimit && !hasOffset) {
          sendJson(res, 200, { media, total: media.length });
          return;
        }

        const parsedLimit = Number.parseInt(fullUrl.searchParams.get("limit") ?? "", 10);
        const parsedOffset = Number.parseInt(fullUrl.searchParams.get("offset") ?? "", 10);

        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
        const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

        const page = media.slice(offset, offset + limit);
        sendJson(res, 200, { media: page, total: media.length, limit, offset });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "media" && parts[1] === "search") {
        const sortRaw = fullUrl.searchParams.get("sort");
        const sort = sortRaw ?? "mediaId_asc";
        if (sort !== "mediaId_asc" && sort !== "takenAt_desc") {
          sendJson(res, 400, { error: "invalid_sort" });
          return;
        }

        const kindRaw = fullUrl.searchParams.get("kind");
        const kind = kindRaw === "photo" || kindRaw === "video" || kindRaw === "unknown" ? kindRaw : undefined;
        if (kindRaw !== null && !kind) {
          sendJson(res, 400, { error: "invalid_kind_filter" });
          return;
        }

        const mimeTypeRaw = fullUrl.searchParams.get("mimeType");
        const mimeType = mimeTypeRaw?.trim() ? mimeTypeRaw : undefined;
        if (mimeTypeRaw !== null && !mimeType) {
          sendJson(res, 400, { error: "invalid_mime_type_filter" });
          return;
        }

        const sourceIdRaw = fullUrl.searchParams.get("sourceId");
        const sourceId = sourceIdRaw?.trim() ? asSourceId(sourceIdRaw) : undefined;
        if (sourceIdRaw !== null && !sourceId) {
          sendJson(res, 400, { error: "invalid_source_id_filter" });
          return;
        }

        const duplicateLevelRaw = fullUrl.searchParams.get("duplicateLevel");
        const duplicateLevel =
          duplicateLevelRaw === "exact" || duplicateLevelRaw === "strong" || duplicateLevelRaw === "probable"
            ? duplicateLevelRaw
            : undefined;
        if (duplicateLevelRaw !== null && !duplicateLevel) {
          sendJson(res, 400, { error: "invalid_duplicate_level_filter" });
          return;
        }

        const cameraModelRaw = fullUrl.searchParams.get("cameraModel");
        const cameraModel = cameraModelRaw?.trim() ? cameraModelRaw.trim() : undefined;
        if (cameraModelRaw !== null && !cameraModel) {
          sendJson(res, 400, { error: "invalid_camera_model_filter" });
          return;
        }

        const takenDayRaw = fullUrl.searchParams.get("takenDay");
        const takenDay = takenDayRaw?.trim() ? takenDayRaw.trim() : undefined;
        if (takenDayRaw !== null && !takenDay) {
          sendJson(res, 400, { error: "invalid_taken_day_filter" });
          return;
        }
        if (takenDay && !/^\d{4}-\d{2}-\d{2}$/.test(takenDay)) {
          sendJson(res, 400, { error: "invalid_taken_day_filter" });
          return;
        }

        const gpsTileRaw = fullUrl.searchParams.get("gpsTile");
        const gpsTile = gpsTileRaw?.trim() ? gpsTileRaw.trim() : undefined;
        if (gpsTileRaw !== null && !gpsTile) {
          sendJson(res, 400, { error: "invalid_gps_tile_filter" });
          return;
        }

        if (!kind && !mimeType && !sourceId && !duplicateLevel && !cameraModel && !takenDay && !gpsTile) {
          sendJson(res, 400, { error: "search_filter_required" });
          return;
        }

        const parsedLimit = Number.parseInt(fullUrl.searchParams.get("limit") ?? "", 10);
        const parsedOffset = Number.parseInt(fullUrl.searchParams.get("offset") ?? "", 10);
        const hasOffset = fullUrl.searchParams.has("offset");
        const cursorRaw = fullUrl.searchParams.get("cursor");
        const cursor = cursorRaw?.trim() ? asMediaId(cursorRaw) : null;
        if (cursorRaw !== null && !cursor) {
          sendJson(res, 400, { error: "invalid_cursor" });
          return;
        }
        if (cursor && hasOffset) {
          sendJson(res, 400, { error: "invalid_pagination_params" });
          return;
        }

        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
        const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
        const useCursorMode = !hasOffset;

        const mediaIds = runtime.state.mediaSearch.query(
          {
            kind,
            mimeType,
            sourceId,
            duplicateLevel,
            cameraModel,
            takenDay,
            gpsTile
          },
          runtime.state,
          sort
        );
        const cursorStart = cursor ? cursorStartIndex(mediaIds, cursor) : 0;
        const pageMediaIds = useCursorMode
          ? mediaIds.slice(cursorStart, cursorStart + limit)
          : mediaIds.slice(offset, offset + limit);
        const media = pageMediaIds
          .map((mediaId) => runtime.state.media.get(mediaId))
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        const nextCursor = useCursorMode
          ? pageMediaIds.length === limit
            ? pageMediaIds[pageMediaIds.length - 1]
            : null
          : null;

        sendJson(res, 200, {
          media,
          total: mediaIds.length,
          limit,
          offset,
          sort,
          cursor,
          nextCursor,
          filters: {
            kind: kind ?? null,
            mimeType: mimeType ?? null,
            sourceId: sourceId ?? null,
            duplicateLevel: duplicateLevel ?? null,
            cameraModel: cameraModel ?? null,
            takenDay: takenDay ?? null,
            gpsTile: gpsTile ?? null
          }
        });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "media") {
        const mediaId = asMediaId(parts[1] ?? "");
        const media = runtime.state.media.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "media_not_found" });
          return;
        }
        const duplicateLinks = runtime.state.duplicateLinks
          .list()
          .filter((link) => link.mediaId === mediaId);
        sendJson(res, 200, { media, metadata: runtime.state.metadata.get(mediaId), duplicateLinks });
        return;
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "media" && parts[2] === "file") {
        const mediaId = asMediaId(parts[1] ?? "");
        const media = runtime.state.media.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "media_not_found" });
          return;
        }

        const filePath = mediaPathForSha256(runtime.vault, media.sha256);
        try {
          const stat = await fs.stat(filePath);
          const metadata = runtime.state.metadata.get(mediaId);
          const sourceEntry = runtime.state.sources.getEntry(media.sourceEntryId);
          const mimeType =
            metadata && typeof metadata.mimeType === "string"
              ? metadata.mimeType
              : inferMimeTypeFromSourceEntry(sourceEntry?.path);

          res.writeHead(200, {
            "content-type": mimeType,
            "content-length": stat.size
          });
          createReadStream(filePath).pipe(res);
        } catch {
          sendJson(res, 404, { error: "media_file_not_found" });
        }
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "duplicate-links") {
        const level = fullUrl.searchParams.get("level");
        const mediaIdRaw = fullUrl.searchParams.get("mediaId");
        const sourceEntryIdRaw = fullUrl.searchParams.get("sourceEntryId");

        const normalizedLevel =
          level === "exact" || level === "strong" || level === "probable" ? level : null;
        const mediaId = mediaIdRaw ? asMediaId(mediaIdRaw) : null;
        const sourceEntryId = sourceEntryIdRaw ? asSourceEntryId(sourceEntryIdRaw) : null;

        const links = runtime.state.duplicateLinks.list().filter((link) => {
          if (normalizedLevel && link.level !== normalizedLevel) {
            return false;
          }
          if (mediaId && link.mediaId !== mediaId) {
            return false;
          }
          if (sourceEntryId && link.sourceEntryId !== sourceEntryId) {
            return false;
          }
          return true;
        });

        sendJson(res, 200, { links });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "jobs") {
        sendJson(res, 200, { jobs: runtime.jobStore.list() });
        return;
      }

      if (method === "POST" && parts.length === 2 && parts[0] === "jobs" && parts[1] === "scan") {
        const body = await readJson(req);
        const sourceIdRaw = typeof body.sourceId === "string" ? body.sourceId : "";
        if (!sourceIdRaw) {
          sendJson(res, 400, { error: "sourceId_required" });
          return;
        }
        const sourceId = asSourceId(sourceIdRaw);
        const source = runtime.state.sources.getSource(sourceId);
        if (!source) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        const jobId = await runtime.jobEngine.enqueue("scan:source", { sourceId });
        sendJson(res, 202, { jobId });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "snapshots" && parts[1] === "pointer") {
        try {
          const pointer = await readSnapshotPointer(runtime.snapshotsDir);
          sendJson(res, 200, { pointer });
        } catch {
          sendJson(res, 404, { error: "snapshot_pointer_not_found" });
        }
        return;
      }

      if (method === "POST" && parts.length === 1 && parts[0] === "snapshots") {
        const pointer = await writeSnapshot({
          snapshotsDir: runtime.snapshotsDir,
          walSeq: runtime.getLastWalSeq(),
          records: snapshotDomainState(runtime.state)
        });
        await pruneSnapshots(runtime.snapshotsDir, snapshotRetentionMax, pointer.snapshotFile);
        sendJson(res, 201, { pointer });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "quarantine") {
        const status = fullUrl.searchParams.get("status");
        const items = runtime.state.quarantine.list();
        const filtered =
          status === "pending" || status === "accepted" || status === "rejected"
            ? items.filter((item) => item.status === status)
            : items;
        sendJson(res, 200, { items: filtered });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "quarantine") {
        const quarantineId = asQuarantineItemId(parts[1] ?? "");
        const item = runtime.state.quarantine.get(quarantineId);
        if (!item) {
          sendJson(res, 404, { error: "quarantine_not_found" });
          return;
        }
        sendJson(res, 200, { item });
        return;
      }

      if (
        method === "POST" &&
        parts.length === 3 &&
        parts[0] === "quarantine" &&
        (parts[2] === "accept" || parts[2] === "reject")
      ) {
        const quarantineId = asQuarantineItemId(parts[1] ?? "");
        const item = runtime.state.quarantine.get(quarantineId);
        if (!item) {
          sendJson(res, 404, { error: "quarantine_not_found" });
          return;
        }

        const body = await readJson(req);
        if (parts[2] === "accept") {
          const acceptedMediaId = typeof body.acceptedMediaId === "string" ? body.acceptedMediaId : "";
          if (!acceptedMediaId) {
            sendJson(res, 400, { error: "acceptedMediaId_required" });
            return;
          }
          const jobId = await runtime.jobEngine.enqueue("quarantine:accept", {
            quarantineId: String(quarantineId),
            acceptedMediaId
          });
          sendJson(res, 202, { jobId });
          return;
        }

        const reason = typeof body.reason === "string" ? body.reason : undefined;
        const payload: JsonObject = { quarantineId: String(quarantineId) };
        if (reason) {
          payload.reason = reason;
        }
        const jobId = await runtime.jobEngine.enqueue("quarantine:reject", payload);
        sendJson(res, 202, { jobId });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      sendJson(res, 500, { error: message });
    }
  };
}

async function checkToolAvailable(command: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout: 4000, maxBuffer: 1024 * 1024 },
      (error) => resolve(!error)
    );
  });
}
