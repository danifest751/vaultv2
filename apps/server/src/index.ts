import http, { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
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
  let state: DomainState;
  let writer: WalWriter;
  let jobStore: JobStore;

  try {
    state = await rebuildDomainState({ walDir, snapshotsDir, hmacSecret });
    writer = await WalWriter.create({ walDir, hmacSecret, fsync: true });
    jobStore = await rebuildJobStore(
      (async function* () {
        for await (const record of readWalRecords({ walDir, hmacSecret })) {
          lastWalSeq = record.seq;
          yield record.event;
        }
      })()
    );
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const walBackup = `${walDir}.corrupt.${stamp}`;
    const snapshotsBackup = `${snapshotsDir}.corrupt.${stamp}`;
    try {
      await fs.rename(walDir, walBackup);
    } catch {}
    try {
      await fs.rename(snapshotsDir, snapshotsBackup);
    } catch {}
    await ensureDir(walDir);
    await ensureDir(snapshotsDir);
    state = new DomainState();
    writer = await WalWriter.create({ walDir, hmacSecret, fsync: true });
    jobStore = new JobStore();
    lastWalSeq = 0;
  }
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
      header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
      h1 { font-size: 20px; margin: 0; }
      .muted { color: #9ca3af; font-size: 13px; }
      .layout { display: grid; grid-template-columns: 340px 1fr; gap: 16px; }
      .panel { background: #161a22; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; }
      .progress { height: 4px; background: #0b0d12; border-radius: 999px; overflow: hidden; }
      .progress .bar { height: 100%; width: 40%; background: #2563eb; animation: progress 1.2s infinite; }
      .list { display: flex; flex-direction: column; gap: 8px; max-height: 70vh; overflow: auto; }
      .item { border: 1px solid #1f2937; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
      .item:hover { border-color: #374151; }
      .id { font-size: 12px; color: #93c5fd; word-break: break-all; }
      .meta { font-size: 12px; color: #9ca3af; }
      .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .controls { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
      .controls-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .section-title { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 12px; }
      .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
      button { background: #2563eb; border: none; color: white; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
      button.secondary { background: #374151; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      button.tab { background: #1f2937; color: #e5e7eb; }
      button.tab.active { background: #2563eb; color: white; }
      .actions-right { display: flex; gap: 8px; align-items: center; }
      select { background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
      .preview { display: flex; flex-direction: column; gap: 12px; }
      .preview img, .preview video { max-width: 100%; border-radius: 8px; background: #0b0d12; }
      .kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 13px; }
      .kv div { word-break: break-all; }
      .empty { color: #9ca3af; font-size: 13px; padding: 8px; text-align: center; }
      .hidden { display: none; }
      a { color: #93c5fd; }
      .actions-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .actions-row input { background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
      .actions-row label { font-size: 12px; color: #9ca3af; }
      .grow { flex: 1; min-width: 220px; }
      .status { font-size: 12px; color: #9ca3af; display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; border: 1px solid #1f2937; background: #0b0d12; }
      .status-busy { color: #fbbf24; border-color: #92400e; background: #1f140a; }
      .status-ok { color: #34d399; border-color: #065f46; background: #0b2f24; }
      .status-error { color: #fca5a5; border-color: #7f1d1d; background: #2a0f0f; }
      .stats { display: flex; flex-wrap: wrap; gap: 8px; }
      .stat { font-size: 12px; color: #cbd5f5; border: 1px solid #1f2937; border-radius: 999px; padding: 4px 10px; background: #0b0d12; }
      .source-info { font-size: 12px; color: #9ca3af; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .source-card { border: 1px solid #1f2937; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
      .source-card.active { border-color: #2563eb; background: #111827; }
      .badge { font-size: 11px; color: #cbd5f5; border: 1px solid #1f2937; border-radius: 999px; padding: 2px 8px; background: #0b0d12; }
      .source-badges { display: flex; flex-wrap: wrap; gap: 6px; }
      @keyframes progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
    </style>
  </head>
  <body>
    <header>
      <h1>Family Media Vault</h1>
      <span class="muted">Viewer: media, quarantine, duplicate links</span>
    </header>
    <div class="layout">
      <section class="panel">
        <div id="progress" class="progress hidden"><div class="bar"></div></div>
        <div class="actions">
          <div class="tabs">
            <button id="tab-media" class="tab active">Media</button>
            <button id="tab-quarantine" class="tab">Quarantine</button>
            <button id="tab-duplicates" class="tab">Duplicate links</button>
          </div>
          <div class="actions-right">
            <select id="quarantine-filter" class="hidden">
              <option value="">Все</option>
              <option value="pending">Ожидает</option>
              <option value="accepted">Принято</option>
              <option value="rejected">Отклонено</option>
            </select>
            <button id="reload" class="secondary">Обновить</button>
          </div>
        </div>
        <div class="section-title">Sources</div>
        <div class="controls">
          <div class="controls-row">
            <input id="source-path" class="grow" placeholder="Путь к папке с медиа" />
            <button id="source-browse">Выбрать папку</button>
            <button id="source-add" class="secondary">Добавить source</button>
          </div>
          <div class="controls-row">
            <button id="source-scan" class="secondary">Scan выбранный</button>
            <button id="source-refresh" class="secondary">Обновить sources</button>
            <button id="snapshot-create" class="secondary">Snapshot</button>
            <span id="source-status" class="status hidden"></span>
          </div>
          <div id="source-details" class="source-info"></div>
          <div id="stats" class="stats"></div>
        </div>
        <div id="sources-list" class="list" aria-live="polite"></div>
        <div class="section-title">Media / Quarantine / Duplicates</div>
        <div id="list" class="list" aria-live="polite"></div>
      </section>
      <section class="panel preview">
        <div id="details-title" class="muted"></div>
        <div id="details-subtitle" class="meta"></div>
        <div id="details" class="kv"></div>
        <div id="quarantine-actions" class="actions-row hidden">
          <label>Принять:</label>
          <select id="quarantine-accept"></select>
          <button id="quarantine-accept-btn">Accept</button>
          <label>Отклонить:</label>
          <input id="quarantine-reason" placeholder="Причина" />
          <button id="quarantine-reject-btn" class="secondary">Reject</button>
        </div>
        <div id="media"></div>
      </section>
    </div>
    <script>
      const listEl = document.getElementById("list");
      const progressEl = document.getElementById("progress");
      const detailsTitleEl = document.getElementById("details-title");
      const detailsSubtitleEl = document.getElementById("details-subtitle");
      const detailsEl = document.getElementById("details");
      const mediaEl = document.getElementById("media");
      const reloadBtn = document.getElementById("reload");
      const tabMedia = document.getElementById("tab-media");
      const tabQuarantine = document.getElementById("tab-quarantine");
      const tabDuplicates = document.getElementById("tab-duplicates");
      const quarantineFilter = document.getElementById("quarantine-filter");
      const quarantineActions = document.getElementById("quarantine-actions");
      const quarantineAccept = document.getElementById("quarantine-accept");
      const quarantineAcceptBtn = document.getElementById("quarantine-accept-btn");
      const quarantineReason = document.getElementById("quarantine-reason");
      const quarantineRejectBtn = document.getElementById("quarantine-reject-btn");
      const sourcePathEl = document.getElementById("source-path");
      const sourceAddBtn = document.getElementById("source-add");
      const sourceBrowseBtn = document.getElementById("source-browse");
      const sourceScanBtn = document.getElementById("source-scan");
      const sourceRefreshBtn = document.getElementById("source-refresh");
      const snapshotCreateBtn = document.getElementById("snapshot-create");
      const sourceStatusEl = document.getElementById("source-status");
      const sourceDetailsEl = document.getElementById("source-details");
      const statsEl = document.getElementById("stats");
      const sourcesListEl = document.getElementById("sources-list");
      let currentTab = "media";
      let currentQuarantineItem = null;
      let lastQuarantineJobId = null;
      let quarantinePoll = null;
      let sources = [];
      let selectedSourceId = "";
      let busyCount = 0;
      let statusTimer = null;
      let jobPoll = null;
      let lastEntriesFetchedAt = 0;
      let cachedEntriesSummary = "";

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

      const renderEmpty = (message) => {
        listEl.innerHTML = "<div class=\\"empty\\">" + message + "</div>";
      };

      const renderKV = (rows) => {
        detailsEl.innerHTML = rows
          .map(([k, v]) => "<div class=\\"meta\\">" + k + "</div><div>" + v + "</div>")
          .join("");
      };

      const setSourceStatus = (message, tone, ttl) => {
        sourceStatusEl.textContent = message;
        sourceStatusEl.classList.toggle("hidden", !message);
        sourceStatusEl.classList.remove("status-busy", "status-ok", "status-error");
        if (tone) {
          sourceStatusEl.classList.add("status-" + tone);
        }
        if (statusTimer) {
          clearTimeout(statusTimer);
          statusTimer = null;
        }
        if (ttl) {
          statusTimer = setTimeout(() => {
            setSourceStatus("", "");
          }, ttl);
        }
      };

      const setProgress = (active) => {
        progressEl.classList.toggle("hidden", !active);
      };

      const setControlsDisabled = (disabled) => {
        sourceAddBtn.disabled = disabled;
        sourceBrowseBtn.disabled = disabled;
        sourceScanBtn.disabled = disabled || !selectedSourceId;
        sourceRefreshBtn.disabled = disabled;
        snapshotCreateBtn.disabled = disabled;
        sourcePathEl.disabled = disabled;
      };

      const beginBusy = (message) => {
        busyCount += 1;
        setProgress(true);
        setControlsDisabled(true);
        if (message) {
          setSourceStatus(message, "busy");
        }
      };

      const endBusy = () => {
        busyCount = Math.max(0, busyCount - 1);
        if (busyCount === 0) {
          setProgress(false);
          setControlsDisabled(false);
        }
      };

      const updateScanEnabled = () => {
        sourceScanBtn.disabled = !selectedSourceId;
      };

      const loadSources = async () => {
        beginBusy("Загружаю sources...");
        try {
          const res = await fetch("/sources");
          if (!res.ok) {
            setSourceStatus("Ошибка загрузки sources", "error", 4000);
            return;
          }
          const data = await res.json();
          sources = data.sources ?? [];
          if (sources.length === 0) {
            updateScanEnabled();
            sourcesListEl.innerHTML = "<div class=\\"empty\\">Нет источников</div>";
            sourceDetailsEl.textContent = "Источник не выбран";
            selectedSourceId = "";
            setSourceStatus("", "");
            return;
          }
          renderSourcesList();
          if (!selectedSourceId || !sources.some((source) => source.sourceId === selectedSourceId)) {
            selectedSourceId = sources[0].sourceId;
            cachedEntriesSummary = "";
            lastEntriesFetchedAt = 0;
          }
          renderSourcesList();
          updateScanEnabled();
          refreshSelectedSourceDetails();
          setSourceStatus("", "");
        } finally {
          endBusy();
        }
      };

      const setSelectedSource = (sourceId) => {
        selectedSourceId = sourceId;
        cachedEntriesSummary = "";
        lastEntriesFetchedAt = 0;
        renderSourcesList();
        updateScanEnabled();
        refreshSelectedSourceDetails();
      };

      const renderSourcesList = () => {
        if (sources.length === 0) {
          sourcesListEl.innerHTML = "<div class=\\"empty\\">Нет источников</div>";
          return;
        }
        sourcesListEl.innerHTML = "";
        sources.forEach((source) => {
          const card = document.createElement("div");
          card.className = "source-card" + (source.sourceId === selectedSourceId ? " active" : "");
          card.innerHTML = "<div class=\\"id\\">" + source.path + "</div>" +
            "<div class=\\"meta\\">" + source.sourceId + "</div>";
          card.addEventListener("click", () => setSelectedSource(source.sourceId));
          sourcesListEl.appendChild(card);
        });
      };

      const refreshSelectedSourceDetails = async (options) => {
        if (!selectedSourceId) {
          sourceDetailsEl.textContent = "Источник не выбран";
          return;
        }
        const source = sources.find((item) => item.sourceId === selectedSourceId);
        if (!source) {
          sourceDetailsEl.textContent = "Источник не найден";
          return;
        }
        const jobs = options?.jobs ?? (await fetchJobs());
        const activeScanJobs = jobs.filter(
          (job) =>
            job.kind === "scan:source" &&
            (job.status === "queued" || job.status === "running") &&
            job.payload &&
            job.payload.sourceId === selectedSourceId
        );
        let entriesSummary = cachedEntriesSummary;
        const now = Date.now();
        const shouldFetchEntries =
          !options?.skipEntries && (!lastEntriesFetchedAt || now - lastEntriesFetchedAt > 5000);
        if (shouldFetchEntries) {
          const entriesRes = await fetch("/entries?sourceId=" + encodeURIComponent(selectedSourceId));
          if (entriesRes.ok) {
            const data = await entriesRes.json();
            const entries = data.entries ?? [];
            const total = entries.length;
            const active = entries.filter((entry) => entry.state === "active").length;
            const missing = entries.filter((entry) => entry.state === "missing").length;
            const lastSeenAt = entries.reduce((acc, entry) => Math.max(acc, entry.lastSeenAt ?? 0), 0);
            const lastSeen = lastSeenAt ? new Date(lastSeenAt).toLocaleString() : "-";
            entriesSummary =
              "<span class=\\"badge\\">Entries: " + total + "</span>" +
              "<span class=\\"badge\\">Active: " + active + "</span>" +
              "<span class=\\"badge\\">Missing: " + missing + "</span>" +
              "<span class=\\"badge\\">Last seen: " + lastSeen + "</span>";
            cachedEntriesSummary = entriesSummary;
            lastEntriesFetchedAt = now;
          }
        }
        const scanStatus =
          activeScanJobs.length > 0
            ? "<span class=\\"badge\\">Scan: " + activeScanJobs.length + " job(ов)</span>"
            : "<span class=\\"badge\\">Scan: idle</span>";
        sourceDetailsEl.innerHTML =
          "<div class=\\"source-badges\\">" +
          "<span class=\\"badge\\">" + source.path + "</span>" +
          "<span class=\\"badge\\">id: " + source.sourceId + "</span>" +
          scanStatus +
          "</div>" +
          (entriesSummary ? "<div class=\\"source-badges\\">" + entriesSummary + "</div>" : "");
      };

      const loadStats = async () => {
        const safeFetch = async (url) => {
          try {
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
          } catch {
            return null;
          }
        };
        const [sourcesRes, entriesRes, mediaRes, quarantineRes, duplicateRes] = await Promise.all([
          safeFetch("/sources"),
          safeFetch("/entries"),
          safeFetch("/media"),
          safeFetch("/quarantine?status=pending"),
          safeFetch("/duplicate-links")
        ]);
        const sourcesCount = sourcesRes?.sources?.length ?? 0;
        const entriesCount = entriesRes?.entries?.length ?? 0;
        const mediaCount = mediaRes?.media?.length ?? 0;
        const quarantineCount = quarantineRes?.items?.length ?? 0;
        const duplicateCount = duplicateRes?.links?.length ?? 0;
        const updatedAt = new Date().toLocaleTimeString();
        statsEl.innerHTML = [
          ["Sources", sourcesCount],
          ["Entries", entriesCount],
          ["Media", mediaCount],
          ["Quarantine", quarantineCount],
          ["Duplicates", duplicateCount],
          ["Обновлено", updatedAt]
        ]
          .map(([label, value]) => "<div class=\\"stat\\">" + label + ": " + value + "</div>")
          .join("");
      };

      const fetchJobs = async () => {
        try {
          const res = await fetch("/jobs");
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data.jobs) ? data.jobs : [];
        } catch {
          return [];
        }
      };

      const startJobPolling = async () => {
        if (jobPoll) {
          return;
        }
        jobPoll = setInterval(async () => {
          const jobs = await fetchJobs();
          const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
          if (active.length === 0) {
            stopJobPolling();
            setSourceStatus("Готово", "ok", 3000);
            loadStats();
            if (currentTab === "media") {
              loadMediaList({ silent: true });
            }
            refreshSelectedSourceDetails({ jobs, skipEntries: false });
            return;
          }
          setSourceStatus("В работе: " + active.length + " job(ов)", "busy");
          loadStats();
          if (currentTab === "media") {
            loadMediaList({ silent: true });
          }
          refreshSelectedSourceDetails({ jobs, skipEntries: true });
        }, 2000);
      };

      const stopJobPolling = () => {
        if (!jobPoll) return;
        clearInterval(jobPoll);
        jobPoll = null;
      };

      const createSource = async () => {
        const path = sourcePathEl.value.trim();
        if (!path) {
          setSourceStatus("Укажи путь", "error", 3000);
          return;
        }
        beginBusy("Создаю source...");
        try {
          const resp = await fetch("/sources", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path })
          });
          if (!resp.ok) {
            setSourceStatus("Ошибка создания source", "error", 4000);
            return;
          }
          const data = await resp.json();
          setSourceStatus("Источник создан", "ok", 3000);
          sourcePathEl.value = "";
          selectedSourceId = data.source.sourceId;
          await loadSources();
          updateScanEnabled();
          loadStats();
        } finally {
          endBusy();
        }
      };

      const scanSource = async () => {
        const sourceId = selectedSourceId;
        if (!sourceId) {
          setSourceStatus("Выбери source", "error", 3000);
          return;
        }
        beginBusy("Запускаю scan...");
        try {
          const resp = await fetch("/jobs/scan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceId })
          });
          if (!resp.ok) {
            setSourceStatus("Ошибка запуска scan", "error", 4000);
            return;
          }
          const data = await resp.json();
          setSourceStatus("scan jobId: " + data.jobId, "ok", 5000);
          loadStats();
          startJobPolling();
        } finally {
          endBusy();
        }
      };

      const refreshSources = async () => {
        await loadSources();
        await refreshSelectedSourceDetails();
        await loadStats();
      };

      const createSnapshot = async () => {
        beginBusy("Создаю snapshot...");
        try {
          const resp = await fetch("/snapshots", { method: "POST" });
          if (!resp.ok) {
            setSourceStatus("Ошибка создания snapshot", "error", 4000);
            return;
          }
          setSourceStatus("Snapshot создан", "ok", 4000);
        } finally {
          endBusy();
        }
      };

      const pickSourcePath = async () => {
        beginBusy("Открываю диалог...");
        try {
          const resp = await fetch("/fs/dialog");
          if (!resp.ok) {
            setSourceStatus("Не удалось открыть диалог", "error", 4000);
            return;
          }
          const data = await resp.json();
          if (!data.path) {
            setSourceStatus("Выбор отменён", "error", 3000);
            return;
          }
          sourcePathEl.value = data.path;
          await createSource();
        } finally {
          endBusy();
        }
      };

      const renderMediaDetails = (data) => {
        if (!data || !data.media) {
          detailsEl.innerHTML = "";
          mediaEl.innerHTML = "";
          detailsTitleEl.textContent = "";
          detailsSubtitleEl.textContent = "";
          quarantineActions.classList.add("hidden");
          return;
        }
        const { media, metadata } = data;
        detailsTitleEl.textContent = "Media";
        detailsSubtitleEl.textContent = "";
        quarantineActions.classList.add("hidden");
        renderKV([
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
        ]);
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

      const renderQuarantineDetails = (item) => {
        detailsTitleEl.textContent = "Quarantine";
        detailsSubtitleEl.textContent = lastQuarantineJobId ? "jobId: " + lastQuarantineJobId : "";
        mediaEl.innerHTML = "";
        currentQuarantineItem = item ?? null;
        renderKV([
          ["quarantineId", item?.quarantineId ?? "-"],
          ["status", item?.status ?? "-"],
          ["sourceEntryId", item?.sourceEntryId ?? "-"],
          ["candidateMediaIds", Array.isArray(item?.candidateMediaIds) ? item.candidateMediaIds.join(", ") : "-"],
          ["acceptedMediaId", item?.acceptedMediaId ?? "-"],
          ["rejectedReason", item?.rejectedReason ?? "-"],
          ["createdAt", item?.createdAt ? new Date(item.createdAt).toISOString() : "-"],
          ["resolvedAt", item?.resolvedAt ? new Date(item.resolvedAt).toISOString() : "-"]
        ]);
        if (item && item.status === "pending") {
          const candidates = Array.isArray(item.candidateMediaIds) ? item.candidateMediaIds : [];
          quarantineAccept.innerHTML = candidates
            .map((id) => "<option value=\\"" + id + "\\">" + id + "</option>")
            .join("");
          quarantineReason.value = "";
          quarantineActions.classList.remove("hidden");
        } else {
          quarantineActions.classList.add("hidden");
        }
      };

      const renderDuplicateDetails = (link) => {
        detailsTitleEl.textContent = "Duplicate link";
        detailsSubtitleEl.textContent = "";
        mediaEl.innerHTML = "";
        quarantineActions.classList.add("hidden");
        renderKV([
          ["duplicateLinkId", link?.duplicateLinkId ?? "-"],
          ["level", link?.level ?? "-"],
          ["mediaId", link?.mediaId ?? "-"],
          ["sourceEntryId", link?.sourceEntryId ?? "-"],
          ["reason", link?.reason ?? "-"],
          ["createdAt", link?.createdAt ? new Date(link.createdAt).toISOString() : "-"]
        ]);
      };

      const loadMediaList = async (options) => {
        const silent = Boolean(options?.silent);
        if (!silent) {
          beginBusy("Загружаю media...");
          listEl.innerHTML = "<div class=\\"empty\\">Загрузка...</div>";
          detailsEl.innerHTML = "";
          mediaEl.innerHTML = "";
          detailsTitleEl.textContent = "";
          detailsSubtitleEl.textContent = "";
          quarantineActions.classList.add("hidden");
        }
        try {
          const res = await fetch("/media");
          if (!res.ok) {
            renderEmpty("Ошибка загрузки списка");
            if (!silent) {
              setSourceStatus("Ошибка загрузки media", "error", 4000);
            }
            return;
          }
          const data = await res.json();
          const items = data.media ?? [];
          if (items.length === 0) {
            renderEmpty("Нет данных. Добавьте source и запустите scan.");
            if (!silent) {
              setSourceStatus("", "");
            }
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
                renderMediaDetails(null);
                return;
              }
              const details = await resp.json();
              renderMediaDetails(details);
            });
            listEl.appendChild(card);
          });
          if (!silent) {
            setSourceStatus("", "");
          }
        } finally {
          if (!silent) {
            endBusy();
          }
        }
      };

      const loadQuarantineList = async () => {
        beginBusy("Загружаю quarantine...");
        listEl.innerHTML = "<div class=\\"empty\\">Загрузка...</div>";
        detailsEl.innerHTML = "";
        mediaEl.innerHTML = "";
        detailsTitleEl.textContent = "";
        detailsSubtitleEl.textContent = "";
        quarantineActions.classList.add("hidden");
        try {
          const status = quarantineFilter.value;
          const url = status ? "/quarantine?status=" + status : "/quarantine";
          const res = await fetch(url);
          if (!res.ok) {
            renderEmpty("Ошибка загрузки quarantine");
            setSourceStatus("Ошибка загрузки quarantine", "error", 4000);
            return;
          }
          const data = await res.json();
          const items = data.items ?? [];
          if (items.length === 0) {
            renderEmpty("Пусто");
            setSourceStatus("", "");
            return;
          }
          listEl.innerHTML = "";
          items.forEach((item) => {
            const card = document.createElement("div");
            card.className = "item";
            const candidateCount = Array.isArray(item.candidateMediaIds) ? item.candidateMediaIds.length : 0;
            card.innerHTML = "<div class=\\"id\\">" + item.quarantineId + "</div>" +
              "<div class=\\"meta\\">" + item.status + "</div>" +
              "<div class=\\"meta\\">" + item.sourceEntryId + "</div>" +
              "<div class=\\"meta\\">candidates: " + candidateCount + "</div>";
            card.addEventListener("click", async () => {
              const resp = await fetch("/quarantine/" + item.quarantineId);
              if (!resp.ok) {
                renderQuarantineDetails(null);
                return;
              }
              const details = await resp.json();
              renderQuarantineDetails(details.item);
            });
            listEl.appendChild(card);
          });
          setSourceStatus("", "");
        } finally {
          endBusy();
        }
      };

      const loadDuplicateLinks = async () => {
        beginBusy("Загружаю duplicate links...");
        listEl.innerHTML = "<div class=\\"empty\\">Загрузка...</div>";
        detailsEl.innerHTML = "";
        mediaEl.innerHTML = "";
        detailsTitleEl.textContent = "";
        detailsSubtitleEl.textContent = "";
        quarantineActions.classList.add("hidden");
        try {
          const res = await fetch("/duplicate-links");
          if (!res.ok) {
            renderEmpty("Ошибка загрузки duplicate links");
            setSourceStatus("Ошибка загрузки duplicate links", "error", 4000);
            return;
          }
          const data = await res.json();
          const links = data.links ?? [];
          if (links.length === 0) {
            renderEmpty("Пусто");
            setSourceStatus("", "");
            return;
          }
          listEl.innerHTML = "";
          links.forEach((link) => {
            const card = document.createElement("div");
            card.className = "item";
            card.innerHTML = "<div class=\\"id\\">" + link.duplicateLinkId + "</div>" +
              "<div class=\\"meta\\">" + link.level + "</div>" +
              "<div class=\\"meta\\">" + link.mediaId + "</div>";
            card.addEventListener("click", () => {
              renderDuplicateDetails(link);
            });
            listEl.appendChild(card);
          });
          setSourceStatus("", "");
        } finally {
          endBusy();
        }
      };

      const refreshQuarantineDetails = async () => {
        if (!currentQuarantineItem) return;
        const resp = await fetch("/quarantine/" + currentQuarantineItem.quarantineId);
        if (!resp.ok) return;
        const details = await resp.json();
        renderQuarantineDetails(details.item);
      };

      const setTab = (tab) => {
        currentTab = tab;
        tabMedia.classList.toggle("active", tab === "media");
        tabQuarantine.classList.toggle("active", tab === "quarantine");
        tabDuplicates.classList.toggle("active", tab === "duplicates");
        quarantineFilter.classList.toggle("hidden", tab !== "quarantine");
        if (tab !== "quarantine") {
          currentQuarantineItem = null;
          lastQuarantineJobId = null;
          quarantineActions.classList.add("hidden");
        }
        if (tab === "media") {
          loadMediaList();
        } else if (tab === "quarantine") {
          loadQuarantineList();
        } else {
          loadDuplicateLinks();
        }
        loadSources();
        if (quarantinePoll) {
          clearInterval(quarantinePoll);
          quarantinePoll = null;
        }
        if (tab === "quarantine") {
          quarantinePoll = setInterval(() => {
            loadQuarantineList();
            refreshQuarantineDetails();
          }, 5000);
        }
      };

      const submitQuarantine = async (action) => {
        if (!currentQuarantineItem) return;
        const url = "/quarantine/" + currentQuarantineItem.quarantineId + "/" + action;
        const payload = action === "accept"
          ? { acceptedMediaId: quarantineAccept.value }
          : { reason: quarantineReason.value.trim() || undefined };
        const resp = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          const body = await resp.json();
          lastQuarantineJobId = body.jobId ?? null;
          loadQuarantineList();
          await refreshQuarantineDetails();
        }
      };

      const checkJobsAndStartPolling = async () => {
        const jobs = await fetchJobs();
        const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
        if (active.length > 0) {
          setSourceStatus("В работе: " + active.length + " job(ов)", "busy");
          startJobPolling();
        }
        refreshSelectedSourceDetails({ jobs, skipEntries: false });
      };

      tabMedia.addEventListener("click", () => setTab("media"));
      tabQuarantine.addEventListener("click", () => setTab("quarantine"));
      tabDuplicates.addEventListener("click", () => setTab("duplicates"));
      quarantineFilter.addEventListener("change", loadQuarantineList);
      reloadBtn.addEventListener("click", () => {
        setTab(currentTab);
        refreshSources();
      });
      quarantineAcceptBtn.addEventListener("click", () => submitQuarantine("accept"));
      quarantineRejectBtn.addEventListener("click", () => submitQuarantine("reject"));
      sourceAddBtn.addEventListener("click", createSource);
      sourceScanBtn.addEventListener("click", scanSource);
      sourceBrowseBtn.addEventListener("click", pickSourcePath);
      sourceRefreshBtn.addEventListener("click", refreshSources);
      snapshotCreateBtn.addEventListener("click", createSnapshot);
      loadSources();
      loadStats();
      checkJobsAndStartPolling();
      setTab("media");
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

      if (method === "GET" && parts.length === 2 && parts[0] === "fs" && parts[1] === "dialog") {
        if (process.platform !== "win32") {
          sendJson(res, 400, { error: "unsupported_platform" });
          return;
        }
        const script = [
          "Add-Type -AssemblyName System.Windows.Forms",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          "$dialog.Description = 'Выберите папку с медиа'",
          "if ($dialog.ShowDialog() -eq 'OK') {",
          "  $dialog.SelectedPath",
          "}"
        ].join("; ");
        const pickPath = () =>
          new Promise<string>((resolve, reject) => {
            execFile(
              "powershell",
              ["-NoProfile", "-Command", script],
              { windowsHide: true },
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
