import http, { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  createEvent,
  DomainEvent,
  JsonObject,
  Source,
  asSourceId,
  newSourceId
} from "@family-media-vault/core";
import {
  DomainState,
  VaultLayout,
  WalWriter,
  ensureDir,
  rebuildDomainState
} from "@family-media-vault/storage";
import {
  JobEngine,
  JobStore,
  createIngestJobHandler,
  createMetadataJobHandler,
  createProbableDedupJobHandler,
  createScanJobHandler
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

async function main(): Promise<void> {
  await ensureDir(walDir);
  await ensureDir(snapshotsDir);
  await ensureDir(vaultDir);

  const state = await rebuildDomainState({ walDir, snapshotsDir, hmacSecret });
  const writer = await WalWriter.create({ walDir, hmacSecret, fsync: true });
  const jobStore = new JobStore();
  const jobEngine = new JobEngine({
    store: jobStore,
    eventWriter: {
      append: async (event: DomainEvent) => {
        await writer.append(event);
        state.applyEvent(event);
      }
    },
    concurrency: 2
  });

  const appendEvent = async (event: ReturnType<typeof createEvent>) => {
    await writer.append(event as DomainEvent);
    state.applyEvent(event as DomainEvent);
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

  jobEngine.resumePending();

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const fullUrl = new URL(url, `http://${req.headers.host ?? "localhost"}`);

    try {
      if (method === "GET" && fullUrl.pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (method === "GET" && fullUrl.pathname === "/sources") {
        sendJson(res, 200, { sources: state.sources.listSources() });
        return;
      }

      if (method === "POST" && fullUrl.pathname === "/sources") {
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

      if (method === "PATCH" && fullUrl.pathname.startsWith("/sources/")) {
        const sourceId = asSourceId(fullUrl.pathname.split("/")[2] ?? "");
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

      if (method === "DELETE" && fullUrl.pathname.startsWith("/sources/")) {
        const sourceId = asSourceId(fullUrl.pathname.split("/")[2] ?? "");
        const existing = state.sources.getSource(sourceId);
        if (!existing) {
          sendJson(res, 404, { error: "source_not_found" });
          return;
        }
        await appendEvent(createEvent("SOURCE_REMOVED", { sourceId }));
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && fullUrl.pathname === "/jobs") {
        sendJson(res, 200, { jobs: jobStore.list() });
        return;
      }

      if (method === "POST" && fullUrl.pathname === "/jobs/scan") {
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
