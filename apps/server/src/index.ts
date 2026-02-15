import http, { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import {
  createEvent,
  DomainEvent,
  JsonObject,
  Source,
  asMediaId,
  asQuarantineItemId,
  asSourceEntryId,
  asSourceId,
  newSourceId
} from "@family-media-vault/core";
import {
  DomainState,
  VaultLayout,
  WalWriter,
  ensureDir,
  mediaPathForSha256,
  readSnapshotPointer,
  readWalRecords,
  rebuildDomainState,
  snapshotDomainState,
  writeSnapshot
} from "@family-media-vault/storage";
import {
  JobEngine,
  JobStore,
  createIngestJobHandler,
  createMetadataJobHandler,
  createProbableDedupJobHandler,
  createScanJobHandler,
  createQuarantineAcceptJobHandler,
  createQuarantineRejectJobHandler,
  rebuildJobStore
} from "@family-media-vault/jobs";

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const walDir = process.env.WAL_DIR ?? path.join(dataDir, "wal");
const snapshotsDir = process.env.SNAPSHOTS_DIR ?? path.join(dataDir, "snapshots");
const vaultDir = process.env.VAULT_DIR ?? path.join(dataDir, "vault");
const hmacSecret = process.env.WAL_HMAC_SECRET ?? "dev-secret";

async function readJson(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as JsonObject;
  return parsed ?? {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html)
  });
  res.end(html);
}

async function main(): Promise<void> {
  await ensureDir(walDir);
  await ensureDir(snapshotsDir);
  await ensureDir(vaultDir);

  let lastWalSeq = 0;

  const state = await rebuildDomainState({ walDir, snapshotsDir, hmacSecret });
  const writer = await WalWriter.create({ walDir, hmacSecret, fsync: true });

  const jobStore = await rebuildJobStore(
    (async function* () {
      for await (const record of readWalRecords({ walDir, hmacSecret })) {
        lastWalSeq = record.seq;
        yield record.event;
      }
    })()
  );
  const jobEngine = new JobEngine({
    store: jobStore,
    eventWriter: {
      append: async (event: DomainEvent) => {
        const record = await writer.append(event);
        lastWalSeq = record.seq;
        state.applyEvent(event);
        jobStore.applyEvent(event);
      }
    },
    concurrency: 2
  });

  const appendEvent = async (event: ReturnType<typeof createEvent>) => {
    const record = await writer.append(event as DomainEvent);
    lastWalSeq = record.seq;
    state.applyEvent(event as DomainEvent);
    jobStore.applyEvent(event as DomainEvent);
  };

  const vault: VaultLayout = { root: vaultDir };

  jobEngine.register({
    kind: "scan:source",
    handler: createScanJobHandler({
      state,
      appendEvent,
      jobEngine
    })
  });

  jobEngine.register({
    kind: "ingest:stage-a-b",
    handler: createIngestJobHandler({
      state,
      appendEvent,
      vault,
      jobEngine
    })
  });

  jobEngine.register({
    kind: "metadata:extract",
    handler: createMetadataJobHandler({
      state,
      appendEvent
    })
  });

  jobEngine.register({
    kind: "dedup:probable",
    handler: createProbableDedupJobHandler({
      state,
      appendEvent
    })
  });

  jobEngine.register({
    kind: "quarantine:accept",
    handler: createQuarantineAcceptJobHandler({
      state,
      appendEvent
    })
  });

  jobEngine.register({
    kind: "quarantine:reject",
    handler: createQuarantineRejectJobHandler({
      state,
      appendEvent
    })
  });

  jobEngine.resumePending();

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const fullUrl = new URL(url, `http://${req.headers.host ?? "localhost"}`);
    const parts = fullUrl.pathname.split("/").filter(Boolean);

    try {
      if (method === "GET" && parts.length === 1 && parts[0] === "ui") {
        sendHtml(
          res,
          200,
          `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Family Media Vault</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #0f1115; color: #e5e7eb; }
      header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 16px; }
      h1 { font-size: 20px; margin: 0; }
      .muted { color: #9ca3af; font-size: 13px; }
      .layout { display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
      .panel { background: #161a22; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; }
      .list { display: flex; flex-direction: column; gap: 8px; max-height: 70vh; overflow: auto; }
      .item { border: 1px solid #1f2937; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
      .item:hover { border-color: #374151; }
      .id { font-size: 12px; color: #93c5fd; word-break: break-all; }
      .meta { font-size: 12px; color: #9ca3af; }
      .actions { display: flex; gap: 8px; }
      button { background: #2563eb; border: none; color: white; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
      button.secondary { background: #374151; }
      .preview { display: flex; flex-direction: column; gap: 12px; }
      .preview img, .preview video { max-width: 100%; border-radius: 8px; background: #0b0d12; }
      .kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 13px; }
      .kv div { word-break: break-all; }
      .empty { color: #9ca3af; font-size: 13px; padding: 8px; text-align: center; }
      a { color: #93c5fd; }
    </style>
  </head>
  <body>
    <header>
      <h1>Family Media Vault</h1>
      <span class="muted">Минимальный viewer для /media</span>
    </header>
    <div class="layout">
      <section class="panel">
        <div class="actions">
          <button id="reload">Обновить</button>
        </div>
        <div id="list" class="list" aria-live="polite"></div>
      </section>
      <section class="panel preview">
        <div id="details" class="kv"></div>
        <div id="media"></div>
      </section>
    </div>
    <script>
      const listEl = document.getElementById("list");
      const detailsEl = document.getElementById("details");
      const mediaEl = document.getElementById("media");
      const reloadBtn = document.getElementById("reload");

      const fmtBytes = (value) => {
        if (!Number.isFinite(value)) return "-";
        if (value < 1024) return value + " B";
        const units = ["KB","MB","GB","TB"];
        let idx = -1;
        let size = value;
        while (size >= 1024 && idx < units.length - 1) {
          size /= 1024;
          idx++;
        }
        return size.toFixed(1) + " " + units[idx];
      };

      const renderEmpty = () => {
        listEl.innerHTML = "<div class=\\"empty\\">Нет данных. Добавьте source и запустите scan.</div>";
      };

      const renderDetails = (data) => {
        if (!data || !data.media) {
          detailsEl.innerHTML = "";
          mediaEl.innerHTML = "";
          return;
        }
        const { media, metadata } = data;
        detailsEl.innerHTML = [
          ["mediaId", media.mediaId],
          ["sha256", media.sha256],
          ["size", fmtBytes(media.size)],
          ["sourceEntryId", media.sourceEntryId],
          ["kind", metadata?.kind ?? "-"],
          ["mimeType", metadata?.mimeType ?? "-"],
          ["width", metadata?.width ?? "-"],
          ["height", metadata?.height ?? "-"],
          ["durationMs", metadata?.durationMs ?? "-"],
          ["takenAt", metadata?.takenAt ? new Date(metadata.takenAt).toISOString() : "-"]
        ].map(([k,v]) => "<div class=\\"meta\\">" + k + "</div><div>" + v + "</div>").join("");
        const fileUrl = "/media/" + media.mediaId + "/file";
        const mime = metadata?.mimeType ?? "";
        if (mime.startsWith("image/")) {
          mediaEl.innerHTML = "<img src=\\"" + fileUrl + "\\" alt=\\"preview\\" />";
        } else if (mime.startsWith("video/")) {
          mediaEl.innerHTML = "<video src=\\"" + fileUrl + "\\" controls></video>";
        } else {
          mediaEl.innerHTML = "<a href=\\"" + fileUrl + "\\" target=\\"_blank\\">Скачать файл</a>";
        }
      };

      const loadMedia = async () => {
        listEl.innerHTML = "<div class=\\"empty\\">Загрузка...</div>";
        detailsEl.innerHTML = "";
        mediaEl.innerHTML = "";
        const res = await fetch("/media");
        if (!res.ok) {
          listEl.innerHTML = "<div class=\\"empty\\">Ошибка загрузки списка</div>";
          return;
        }
        const data = await res.json();
        const items = data.media ?? [];
        if (items.length === 0) {
          renderEmpty();
          return;
        }
        listEl.innerHTML = "";
        items.forEach((item) => {
          const card = document.createElement("div");
          card.className = "item";
          card.innerHTML = "<div class=\\"id\\">" + item.mediaId + "</div>" +
            "<div class=\\"meta\\">" + fmtBytes(item.size) + "</div>" +
            "<div class=\\"meta\\">" + item.sha256 + "</div>";
          card.addEventListener("click", async () => {
            const resp = await fetch("/media/" + item.mediaId);
            if (!resp.ok) {
              renderDetails(null);
              return;
            }
            const details = await resp.json();
            renderDetails(details);
          });
          listEl.appendChild(card);
        });
      };

      reloadBtn.addEventListener("click", loadMedia);
      loadMedia();
    </script>
  </body>
</html>`
        );
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "sources") {
        sendJson(res, 200, { sources: state.sources.listSources() });
        return;
      }

      if (method === "POST" && parts.length === 1 && parts[0] === "sources") {
        const body = await readJson(req);
        const sourcePath = typeof body.path === "string" ? body.path : "";
        if (!sourcePath) {
          sendJson(res, 400, { error: "path_required" });
          return;
        }
        const source: Source = {
          sourceId: newSourceId(),
          path: sourcePath,
          recursive: body.recursive === undefined ? true : Boolean(body.recursive),
          includeArchives:
            body.includeArchives === undefined ? false : Boolean(body.includeArchives),
          excludeGlobs: Array.isArray(body.excludeGlobs)
            ? body.excludeGlobs.filter((item) => typeof item === "string")
            : [],
          createdAt: Date.now()
        };
        await appendEvent(createEvent("SOURCE_CREATED", { source }));
        sendJson(res, 201, { source });
        return;
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "sources" && parts[2] === "entries") {
        const sourceId = asSourceId(parts[1] ?? "");
        const source = state.sources.getSource(sourceId);
        if (!source) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        sendJson(res, 200, { entries: state.sources.listEntriesForSource(sourceId) });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "entries") {
        const sourceIdRaw = fullUrl.searchParams.get("sourceId");
        if (sourceIdRaw) {
          const sourceId = asSourceId(sourceIdRaw);
          const source = state.sources.getSource(sourceId);
          if (!source) {
            sendJson(res, 404, { error: "source_not_found" });
            return;
          }
          sendJson(res, 200, { entries: state.sources.listEntriesForSource(sourceId) });
          return;
        }
        sendJson(res, 200, { entries: state.sources.listEntries() });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "entries") {
        const entryId = asSourceEntryId(parts[1] ?? "");
        const entry = state.sources.getEntry(entryId);
        if (!entry) {
          sendJson(res, 404, { error: "entry_not_found" });
          return;
        }

        const ingest = state.ingest.getStatus(entryId);
        const media = state.media.getBySourceEntryId(entryId);
        const metadata = media ? state.metadata.get(media.mediaId) : undefined;
        const quarantine = state.quarantine.getBySourceEntryId(entryId);
        const duplicateLinks = state.duplicateLinks
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
        const existing = state.sources.getSource(sourceId);
        if (!existing) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        const body = await readJson(req);
        const updated: Source = {
          sourceId,
          path: typeof body.path === "string" ? body.path : existing.path,
          recursive:
            body.recursive === undefined ? existing.recursive : Boolean(body.recursive),
          includeArchives:
            body.includeArchives === undefined
              ? existing.includeArchives
              : Boolean(body.includeArchives),
          excludeGlobs: Array.isArray(body.excludeGlobs)
            ? body.excludeGlobs.filter((item) => typeof item === "string")
            : existing.excludeGlobs,
          createdAt: existing.createdAt
        };
        await appendEvent(createEvent("SOURCE_UPDATED", { source: updated }));
        sendJson(res, 200, { source: updated });
        return;
      }

      if (method === "DELETE" && parts.length === 2 && parts[0] === "sources") {
        const sourceId = asSourceId(parts[1] ?? "");
        const existing = state.sources.getSource(sourceId);
        if (!existing) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        await appendEvent(createEvent("SOURCE_REMOVED", { sourceId }));
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "media") {
        sendJson(res, 200, { media: state.media.list() });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "media") {
        const mediaId = asMediaId(parts[1] ?? "");
        const media = state.media.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "media_not_found" });
          return;
        }
        const duplicateLinks = state.duplicateLinks.list().filter((link) => link.mediaId === mediaId);
        sendJson(res, 200, { media, metadata: state.metadata.get(mediaId), duplicateLinks });
        return;
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "media" && parts[2] === "file") {
        const mediaId = asMediaId(parts[1] ?? "");
        const media = state.media.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "media_not_found" });
          return;
        }

        const filePath = mediaPathForSha256(vault, media.sha256);
        try {
          const stat = await fs.stat(filePath);
          const metadata = state.metadata.get(mediaId);
          const mimeType =
            metadata && typeof metadata.mimeType === "string"
              ? metadata.mimeType
              : "application/octet-stream";

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

        const links = state.duplicateLinks.list().filter((link) => {
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
        sendJson(res, 200, { jobs: jobStore.list() });
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
        const source = state.sources.getSource(sourceId);
        if (!source) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        const jobId = await jobEngine.enqueue("scan:source", { sourceId });
        sendJson(res, 202, { jobId });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "snapshots" && parts[1] === "pointer") {
        try {
          const pointer = await readSnapshotPointer(snapshotsDir);
          sendJson(res, 200, { pointer });
        } catch {
          sendJson(res, 404, { error: "snapshot_pointer_not_found" });
        }
        return;
      }

      if (method === "POST" && parts.length === 1 && parts[0] === "snapshots") {
        const pointer = await writeSnapshot({
          snapshotsDir,
          walSeq: lastWalSeq,
          records: snapshotDomainState(state)
        });
        sendJson(res, 201, { pointer });
        return;
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "quarantine") {
        const status = fullUrl.searchParams.get("status");
        const items = state.quarantine.list();
        const filtered =
          status === "pending" || status === "accepted" || status === "rejected"
            ? items.filter((item) => item.status === status)
            : items;
        sendJson(res, 200, { items: filtered });
        return;
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "quarantine") {
        const quarantineId = asQuarantineItemId(parts[1] ?? "");
        const item = state.quarantine.get(quarantineId);
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
        const item = state.quarantine.get(quarantineId);
        if (!item) {
          sendJson(res, 404, { error: "quarantine_not_found" });
          return;
        }

        const body = await readJson(req);
        if (parts[2] === "accept") {
          const acceptedMediaId =
            typeof body.acceptedMediaId === "string" ? body.acceptedMediaId : "";
          if (!acceptedMediaId) {
            sendJson(res, 400, { error: "acceptedMediaId_required" });
            return;
          }
          const jobId = await jobEngine.enqueue("quarantine:accept", {
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
        const jobId = await jobEngine.enqueue("quarantine:reject", payload);
        sendJson(res, 202, { jobId });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      sendJson(res, 500, { error: message });
    }
  });

  server.listen(port, () => {
    process.stdout.write(`server: http://localhost:${port}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
