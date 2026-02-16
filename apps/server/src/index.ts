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
    <title>Family Media Vault — Dev Console</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body { font-family: 'SF Mono', 'Consolas', 'Monaco', monospace; margin: 0; padding: 16px; background: #0a0d12; color: #e5e7eb; font-size: 13px; }
      header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: 12px 16px; background: #161a22; border: 1px solid #1f2937; border-radius: 8px; }
      h1 { font-size: 18px; margin: 0; font-weight: 600; }
      .header-right { display: flex; gap: 12px; align-items: center; }
      .env-badge { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: #dc2626; color: white; font-weight: 600; }
      .layout { display: grid; grid-template-columns: 380px 1fr 320px; gap: 12px; }
      .panel { background: #161a22; border: 1px solid #1f2937; border-radius: 8px; padding: 12px; overflow: hidden; }
      .panel-title { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
      .panel-title .live { width: 6px; height: 6px; border-radius: 50%; background: #10b981; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      
      .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
      .metric { background: #0f1318; border: 1px solid #1f2937; border-radius: 6px; padding: 10px; text-align: center; }
      .metric-value { font-size: 24px; font-weight: 700; margin-bottom: 2px; }
      .metric-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
      .metric.green .metric-value { color: #10b981; }
      .metric.blue .metric-value { color: #3b82f6; }
      .metric.yellow .metric-value { color: #f59e0b; }
      .metric.red .metric-value { color: #ef4444; }
      .metric.purple .metric-value { color: #a78bfa; }
      
      .job-queue { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; }
      .job-item { background: #0f1318; border: 1px solid #1f2937; border-radius: 5px; padding: 8px; font-size: 11px; }
      .job-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .job-kind { font-weight: 600; color: #93c5fd; }
      .job-status { font-size: 10px; padding: 2px 6px; border-radius: 3px; }
      .job-status.queued { background: #374151; color: #e5e7eb; }
      .job-status.running { background: #fbbf24; color: #1f2937; animation: pulse 1.5s infinite; }
      .job-status.completed { background: #10b981; color: white; }
      .job-status.failed { background: #ef4444; color: white; }
      .job-meta { color: #6b7280; font-size: 10px; }
      
      .list { display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow-y: auto; }
      .item { border: 1px solid #1f2937; border-radius: 6px; padding: 8px; cursor: pointer; transition: all 0.15s; }
      .item:hover { border-color: #3b82f6; background: #0f1318; }
      .item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .item-id { font-size: 11px; color: #93c5fd; font-weight: 600; }
      .item-badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: #374151; color: #e5e7eb; }
      .item-meta { font-size: 11px; color: #6b7280; }
      
      .tabs { display: flex; gap: 4px; margin-bottom: 10px; }
      button { background: #2563eb; border: none; color: white; padding: 7px 12px; border-radius: 5px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.15s; font-family: inherit; }
      button:hover { background: #1d4ed8; }
      button:disabled { opacity: 0.4; cursor: not-allowed; }
      button.tab { background: #1f2937; color: #9ca3af; }
      button.tab.active { background: #2563eb; color: white; }
      button.secondary { background: #374151; }
      button.secondary:hover { background: #4b5563; }
      button.danger { background: #dc2626; }
      button.danger:hover { background: #b91c1c; }
      button.small { padding: 4px 8px; font-size: 10px; }
      
      .controls { display: flex; flex-direction: column; gap: 8px; }
      .control-row { display: flex; gap: 6px; align-items: center; }
      input, select { background: #0f1318; color: #e5e7eb; border: 1px solid #374151; border-radius: 5px; padding: 7px 10px; font-size: 11px; font-family: inherit; }
      input.grow { flex: 1; }
      select { cursor: pointer; }
      
      .source-card { border: 1px solid #1f2937; border-radius: 6px; padding: 8px; cursor: pointer; margin-bottom: 6px; transition: all 0.15s; }
      .source-card:hover { border-color: #3b82f6; }
      .source-card.active { border-color: #2563eb; background: #0f1318; }
      .source-path { font-size: 11px; color: #93c5fd; font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .source-id { font-size: 10px; color: #6b7280; }
      
      .detail-view { display: flex; flex-direction: column; gap: 12px; }
      .detail-header { padding: 10px; background: #0f1318; border-radius: 6px; }
      .detail-title { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
      .detail-subtitle { font-size: 10px; color: #9ca3af; }
      .kv { display: grid; grid-template-columns: 120px 1fr; gap: 6px 10px; font-size: 11px; padding: 10px; background: #0f1318; border-radius: 6px; }
      .kv-key { color: #9ca3af; }
      .kv-value { color: #e5e7eb; word-break: break-all; font-family: 'SF Mono', monospace; }
      
      .media-preview { background: #0f1318; border-radius: 6px; padding: 10px; text-align: center; }
      .media-preview img, .media-preview video { max-width: 100%; border-radius: 4px; }
      
      .event-log { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; font-size: 10px; }
      .event-item { background: #0f1318; border-left: 2px solid #374151; padding: 6px 8px; border-radius: 3px; }
      .event-type { color: #93c5fd; font-weight: 600; margin-bottom: 2px; }
      .event-time { color: #6b7280; }
      
      .debug-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; }
      .debug-item { background: #0f1318; padding: 8px; border-radius: 5px; }
      .debug-label { color: #9ca3af; font-size: 10px; margin-bottom: 2px; }
      .debug-value { color: #e5e7eb; font-weight: 600; }
      
      .quarantine-actions { display: flex; gap: 6px; margin-top: 10px; padding: 10px; background: #0f1318; border-radius: 6px; flex-wrap: wrap; }
      
      .empty { color: #6b7280; text-align: center; padding: 20px; font-size: 11px; }
      .hidden { display: none !important; }
      a { color: #93c5fd; text-decoration: none; }
      a:hover { text-decoration: underline; }
      
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: #0f1318; border-radius: 4px; }
      ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: #4b5563; }
    </style>
  </head>
  <body>
    <header>
      <h1>🗄️ Family Media Vault — Dev Console</h1>
      <div class="header-right">
        <span class="env-badge">DEVELOPMENT</span>
        <button id="refresh-all" class="secondary small">↻ Refresh All</button>
      </div>
    </header>
    
    <div class="metrics">
      <div class="metric green">
        <div class="metric-value" id="metric-sources">0</div>
        <div class="metric-label">Sources</div>
      </div>
      <div class="metric blue">
        <div class="metric-value" id="metric-media">0</div>
        <div class="metric-label">Media</div>
      </div>
      <div class="metric blue">
        <div class="metric-value" id="metric-entries">0</div>
        <div class="metric-label">Entries</div>
      </div>
      <div class="metric yellow">
        <div class="metric-value" id="metric-quarantine">0</div>
        <div class="metric-label">Quarantine</div>
      </div>
      <div class="metric purple">
        <div class="metric-value" id="metric-duplicates">0</div>
        <div class="metric-label">Duplicates</div>
      </div>
      <div class="metric red">
        <div class="metric-value" id="metric-jobs">0</div>
        <div class="metric-label">Active Jobs</div>
      </div>
    </div>
    
    <div class="layout">
      <!-- Left: Sources & Controls -->
      <section class="panel">
        <div class="panel-title">📁 Sources</div>
        <div class="controls">
          <div class="control-row">
            <input id="source-path" class="grow" placeholder="Path to media folder" />
            <button id="source-browse">📂</button>
          </div>
          <div class="control-row">
            <button id="source-add" class="secondary">+ Add Source</button>
            <button id="source-scan" disabled>▶ Scan</button>
            <button id="snapshot-create" class="secondary">💾</button>
          </div>
        </div>
        <div id="sources-list"></div>
        
        <div class="panel-title" style="margin-top: 16px;">
          ⚙️ Job Queue
          <div class="live" id="job-live"></div>
        </div>
        <div id="job-queue" class="job-queue"></div>
      </section>
      
      <!-- Center: Data View -->
      <section class="panel">
        <div class="tabs">
          <button id="tab-media" class="tab active">📷 Media</button>
          <button id="tab-quarantine" class="tab">⚠️ Quarantine</button>
          <button id="tab-duplicates" class="tab">🔗 Duplicates</button>
        </div>
        <select id="quarantine-filter" class="hidden" style="margin-bottom: 8px;">
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <div id="list" class="list"></div>
      </section>
      
      <!-- Right: Details & Debug -->
      <section class="panel">
        <div class="panel-title" id="detail-panel-title">Details</div>
        <div id="detail-view" class="detail-view">
          <div class="empty">Select an item to view details</div>
        </div>
        
        <div class="panel-title" style="margin-top: 16px;">🔍 Debug Info</div>
        <div id="debug-info" class="debug-grid">
          <div class="debug-item">
            <div class="debug-label">WAL Seq</div>
            <div class="debug-value" id="debug-wal-seq">-</div>
          </div>
          <div class="debug-item">
            <div class="debug-label">Uptime</div>
            <div class="debug-value" id="debug-uptime">-</div>
          </div>
          <div class="debug-item">
            <div class="debug-label">Last Snapshot</div>
            <div class="debug-value" id="debug-snapshot">Never</div>
          </div>
          <div class="debug-item">
            <div class="debug-label">System Time</div>
            <div class="debug-value" id="debug-time">-</div>
          </div>
        </div>
      </section>
    </div>
    <script>
      document.title = "FMV UI [JS Loading...]";
      console.log("=== Family Media Vault UI Loading ===");
      alert("JavaScript is loading...");
      
      const listEl = document.getElementById("list");
      const detailViewEl = document.getElementById("detail-view");
      const detailPanelTitle = document.getElementById("detail-panel-title");
      const tabMedia = document.getElementById("tab-media");
      const tabQuarantine = document.getElementById("tab-quarantine");
      const tabDuplicates = document.getElementById("tab-duplicates");
      const quarantineFilter = document.getElementById("quarantine-filter");
      const sourcePathEl = document.getElementById("source-path");
      const sourceAddBtn = document.getElementById("source-add");
      const sourceBrowseBtn = document.getElementById("source-browse");
      const sourceScanBtn = document.getElementById("source-scan");
      const snapshotCreateBtn = document.getElementById("snapshot-create");
      const refreshAllBtn = document.getElementById("refresh-all");
      const sourcesListEl = document.getElementById("sources-list");
      const jobQueueEl = document.getElementById("job-queue");
      const jobLiveEl = document.getElementById("job-live");
      
      const metricSources = document.getElementById("metric-sources");
      const metricMedia = document.getElementById("metric-media");
      const metricEntries = document.getElementById("metric-entries");
      const metricQuarantine = document.getElementById("metric-quarantine");
      const metricDuplicates = document.getElementById("metric-duplicates");
      const metricJobs = document.getElementById("metric-jobs");
      
      const debugWalSeq = document.getElementById("debug-wal-seq");
      const debugUptime = document.getElementById("debug-uptime");
      const debugSnapshot = document.getElementById("debug-snapshot");
      const debugTime = document.getElementById("debug-time");
      
      let currentTab = "media";
      let currentItem = null;
      let sources = [];
      let selectedSourceId = "";
      let startTime = Date.now();
      let pollInterval = null;

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
      
      const fmtDuration = (ms) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) return hours + "h " + (minutes % 60) + "m";
        if (minutes > 0) return minutes + "m " + (seconds % 60) + "s";
        return seconds + "s";
      };
      
      const fmtTime = (ts) => {
        if (!ts) return "-";
        const date = new Date(ts);
        return date.toLocaleTimeString();
      };

      const renderEmpty = (message) => {
        listEl.innerHTML = '<div class="empty">' + message + '</div>';
      };
      
      const clearDetail = () => {
        detailViewEl.innerHTML = '<div class="empty">Select an item to view details</div>';
        detailPanelTitle.textContent = "Details";
      };
      
      const renderDetailKV = (title, rows) => {
        detailPanelTitle.textContent = title;
        return '<div class="kv">' +
          rows.map(([k, v]) => '<div class="kv-key">' + k + '</div><div class="kv-value">' + v + '</div>').join('') +
          '</div>';
      };
      
      const updateMetrics = (data) => {
        metricSources.textContent = data.sources || 0;
        metricMedia.textContent = data.media || 0;
        metricEntries.textContent = data.entries || 0;
        metricQuarantine.textContent = data.quarantine || 0;
        metricDuplicates.textContent = data.duplicates || 0;
        metricJobs.textContent = data.jobs || 0;
      };
      
      const updateDebugInfo = () => {
        debugUptime.textContent = fmtDuration(Date.now() - startTime);
        debugTime.textContent = new Date().toLocaleTimeString();
      };

      const fetchData = async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      };
      
      const loadAllData = async () => {
        const [sourcesData, mediaData, entriesData, quarantineData, duplicateData, jobsData] = await Promise.all([
          fetchData("/sources"),
          fetchData("/media"),
          fetchData("/entries"),
          fetchData("/quarantine"),
          fetchData("/duplicate-links"),
          fetchData("/jobs")
        ]);
        
        sources = sourcesData?.sources ?? [];
        const jobs = jobsData?.jobs ?? [];
        const activeJobs = jobs.filter(j => j.status === "queued" || j.status === "running");
        
        updateMetrics({
          sources: sources.length,
          media: mediaData?.media?.length ?? 0,
          entries: entriesData?.entries?.length ?? 0,
          quarantine: quarantineData?.items?.filter(i => i.status === "pending").length ?? 0,
          duplicates: duplicateData?.links?.length ?? 0,
          jobs: activeJobs.length
        });
        
        renderJobQueue(jobs.slice(0, 10));
        renderSources();
        
        if (!selectedSourceId && sources.length > 0) {
          selectedSourceId = sources[0].sourceId;
        }
        sourceScanBtn.disabled = !selectedSourceId;
      };
      
      const renderSources = () => {
        if (sources.length === 0) {
          sourcesListEl.innerHTML = '<div class="empty">No sources</div>';
          return;
        }
        sourcesListEl.innerHTML = sources.map(source => 
          '<div class="source-card' + (source.sourceId === selectedSourceId ? ' active' : '') + '" data-source-id="' + source.sourceId + '">' +
          '<div class="source-path">' + source.path + '</div>' +
          '<div class="source-id">' + source.sourceId + '</div>' +
          '</div>'
        ).join('');
      };
      
      const selectSource = (sourceId) => {
        selectedSourceId = sourceId;
        sourceScanBtn.disabled = false;
        renderSources();
      };
      
      sourcesListEl.addEventListener('click', (e) => {
        const card = e.target.closest('.source-card');
        if (card) {
          const sourceId = card.getAttribute('data-source-id');
          if (sourceId) selectSource(sourceId);
        }
      });
      
      const renderJobQueue = (jobs) => {
        if (!jobs || jobs.length === 0) {
          jobQueueEl.innerHTML = '<div class="empty">No jobs</div>';
          jobLiveEl.style.display = 'none';
          return;
        }
        
        const hasActive = jobs.some(j => j.status === "running");
        jobLiveEl.style.display = hasActive ? 'block' : 'none';
        
        jobQueueEl.innerHTML = jobs.map(job => {
          const elapsed = job.startedAt ? fmtDuration(Date.now() - job.startedAt) : '-';
          return '<div class="job-item">' +
            '<div class="job-header">' +
            '<span class="job-kind">' + job.kind + '</span>' +
            '<span class="job-status ' + job.status + '">' + job.status + '</span>' +
            '</div>' +
            '<div class="job-meta">jobId: ' + job.jobId + ' | attempt: ' + job.attempt + ' | elapsed: ' + elapsed + '</div>' +
            '</div>';
        }).join('');
      };
      
      const createSource = async () => {
        try {
          const path = sourcePathEl.value.trim();
          console.log("createSource called, path:", path);
          if (!path) {
            alert("Please enter a path");
            return;
          }
          
          sourceAddBtn.disabled = true;
          sourceAddBtn.textContent = "Adding...";
          
          const resp = await fetch("/sources", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path })
          });
          
          if (resp.ok) {
            sourcePathEl.value = "";
            await loadAllData();
            alert("Source added successfully!");
          } else {
            const err = await resp.json();
            alert("Error adding source: " + (err.error || "unknown"));
          }
        } catch (error) {
          console.error("createSource error:", error);
          alert("Failed to add source: " + error.message);
        } finally {
          sourceAddBtn.disabled = false;
          sourceAddBtn.textContent = "+ Add Source";
        }
      };
      
      const scanSource = async () => {
        try {
          if (!selectedSourceId) {
            alert("Please select a source first");
            return;
          }
          
          sourceScanBtn.disabled = true;
          sourceScanBtn.textContent = "Scanning...";
          
          const resp = await fetch("/jobs/scan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceId: selectedSourceId })
          });
          
          if (resp.ok) {
            await loadAllData();
            alert("Scan job started!");
          } else {
            alert("Failed to start scan");
          }
        } catch (error) {
          console.error("scanSource error:", error);
          alert("Failed to scan: " + error.message);
        } finally {
          sourceScanBtn.disabled = !selectedSourceId;
          sourceScanBtn.textContent = "▶ Scan";
        }
      };
      
      const createSnapshot = async () => {
        try {
          snapshotCreateBtn.disabled = true;
          snapshotCreateBtn.textContent = "Creating...";
          
          const resp = await fetch("/snapshots", { method: "POST" });
          if (resp.ok) {
            const data = await resp.json();
            debugSnapshot.textContent = fmtTime(Date.now());
            alert("Snapshot created!");
          } else {
            alert("Failed to create snapshot");
          }
        } catch (error) {
          console.error("createSnapshot error:", error);
          alert("Failed to create snapshot: " + error.message);
        } finally {
          snapshotCreateBtn.disabled = false;
          snapshotCreateBtn.textContent = "💾";
        }
      };
      
      const pickSourcePath = async () => {
        try {
          console.log("pickSourcePath: requesting /fs/dialog");
          const resp = await fetch("/fs/dialog");
          console.log("pickSourcePath: status", resp.status);
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: "unknown" }));
            console.error("pickSourcePath: dialog failed", err);
            alert("Dialog failed: " + (err.error || "unknown"));
            return;
          }
          const data = await resp.json();
          console.log("pickSourcePath: response", data);
          if (data.path) {
            sourcePathEl.value = data.path;
            await createSource();
          }
        } catch (error) {
          console.error("pickSourcePath: error", error);
          alert("Dialog error: " + (error && error.message ? error.message : String(error)));
        }
      };

      const loadTab = async (tab) => {
        clearDetail();
        const data = await fetchData(
          tab === "media" ? "/media" :
          tab === "quarantine" ? "/quarantine" + (quarantineFilter.value ? "?status=" + quarantineFilter.value : "") :
          "/duplicate-links"
        );
        
        if (!data) {
          renderEmpty("Error loading data");
          return;
        }
        
        const items = data.media || data.items || data.links || [];
        if (items.length === 0) {
          renderEmpty("No data. Add source and run scan.");
          return;
        }
        
        listEl.innerHTML = items.map(item => {
          if (tab === "media") {
            return '<div class="item" data-media-id="' + item.mediaId + '">' +
              '<div class="item-header"><span class="item-id">' + item.mediaId + '</span>' +
              '<span class="item-badge">' + fmtBytes(item.size) + '</span></div>' +
              '<div class="item-meta">' + item.sha256.substring(0, 16) + '...</div></div>';
          } else if (tab === "quarantine") {
            const candidates = (item.candidateMediaIds || []).length;
            return '<div class="item" data-quarantine-id="' + item.quarantineId + '">' +
              '<div class="item-header"><span class="item-id">' + item.quarantineId + '</span>' +
              '<span class="item-badge">' + item.status + '</span></div>' +
              '<div class="item-meta">' + candidates + ' candidates | ' + item.sourceEntryId + '</div></div>';
          } else {
            return '<div class="item" data-duplicate-id="' + item.duplicateLinkId + '" data-duplicate-data="' + encodeURIComponent(JSON.stringify(item)) + '">' +
              '<div class="item-header"><span class="item-id">' + item.duplicateLinkId + '</span>' +
              '<span class="item-badge">' + item.level + '</span></div>' +
              '<div class="item-meta">' + item.mediaId + '</div></div>';
          }
        }).join('');
        
        listEl.onclick = async (e) => {
          const itemEl = e.target.closest('.item');
          if (!itemEl) return;
          
          const mediaId = itemEl.getAttribute('data-media-id');
          const quarantineId = itemEl.getAttribute('data-quarantine-id');
          const duplicateData = itemEl.getAttribute('data-duplicate-data');
          
          if (mediaId) {
            await viewMedia(mediaId);
          } else if (quarantineId) {
            await viewQuarantine(quarantineId);
          } else if (duplicateData) {
            viewDuplicate(JSON.parse(decodeURIComponent(duplicateData)));
          }
        };
      };
      
      const viewMedia = async (mediaId) => {
        const data = await fetchData("/media/" + mediaId);
        if (!data || !data.media) {
          clearDetail();
          return;
        }
        const { media, metadata } = data;
        const fileUrl = "/media/" + mediaId + "/file";
        const mime = metadata?.mimeType || "";
        const preview = mime.startsWith("image/") ? '<div class="media-preview"><img src="' + fileUrl + '" /></div>' :
          mime.startsWith("video/") ? '<div class="media-preview"><video src="' + fileUrl + '" controls></video></div>' :
          '<div class="media-preview"><a href="' + fileUrl + '" target="_blank">Download file</a></div>';
        
        detailViewEl.innerHTML = preview + 
          renderDetailKV("📷 Media", [
            ["mediaId", media.mediaId],
            ["sha256", media.sha256],
            ["size", fmtBytes(media.size)],
            ["sourceEntryId", media.sourceEntryId],
            ["kind", metadata?.kind || "-"],
            ["mimeType", metadata?.mimeType || "-"],
            ["width", metadata?.width || "-"],
            ["height", metadata?.height || "-"],
            ["durationMs", metadata?.durationMs || "-"],
            ["takenAt", metadata?.takenAt ? new Date(metadata.takenAt).toISOString() : "-"]
          ]);
      };
      
      const viewQuarantine = async (quarantineId) => {
        const data = await fetchData("/quarantine/" + quarantineId);
        if (!data || !data.item) {
          clearDetail();
          return;
        }
        const item = data.item;
        currentItem = item;
        
        let actions = '';
        if (item.status === "pending" && item.candidateMediaIds && item.candidateMediaIds.length > 0) {
          const options = item.candidateMediaIds.map(id => '<option value="' + id + '">' + id + '</option>').join('');
          actions = '<div class="quarantine-actions">' +
            '<select id="q-accept-select">' + options + '</select>' +
            '<button id="q-accept-btn" class="small">✓ Accept</button>' +
            '<input id="q-reject-reason" placeholder="Reject reason" style="flex:1;" />' +
            '<button id="q-reject-btn" class="small danger">✗ Reject</button>' +
            '</div>';
        }
        
        detailViewEl.innerHTML = 
          renderDetailKV("⚠️ Quarantine", [
            ["quarantineId", item.quarantineId],
            ["status", item.status],
            ["sourceEntryId", item.sourceEntryId],
            ["candidates", (item.candidateMediaIds || []).join(", ") || "-"],
            ["acceptedMediaId", item.acceptedMediaId || "-"],
            ["rejectedReason", item.rejectedReason || "-"],
            ["createdAt", fmtTime(item.createdAt)],
            ["resolvedAt", fmtTime(item.resolvedAt)]
          ]) + actions;
        
        if (item.status === "pending") {
          setTimeout(() => {
            const acceptBtn = document.getElementById("q-accept-btn");
            const rejectBtn = document.getElementById("q-reject-btn");
            if (acceptBtn) acceptBtn.addEventListener("click", acceptQuarantine);
            if (rejectBtn) rejectBtn.addEventListener("click", rejectQuarantine);
          }, 0);
        }
      };
      
      const viewDuplicate = (link) => {
        const data = typeof link === "string" ? null : link;
        if (!data) return;
        renderDetailKV("🔗 Duplicate Link", [
          ["duplicateLinkId", data.duplicateLinkId],
          ["level", data.level],
          ["mediaId", data.mediaId],
          ["sourceEntryId", data.sourceEntryId],
          ["reason", data.reason || "-"],
          ["createdAt", fmtTime(data.createdAt)]
        ]);
      };
      
      const acceptQuarantine = async () => {
        if (!currentItem) return;
        const select = document.getElementById("q-accept-select");
        const acceptedMediaId = select?.value;
        if (!acceptedMediaId) return;
        
        const resp = await fetch("/quarantine/" + currentItem.quarantineId + "/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ acceptedMediaId })
        });
        if (resp.ok) {
          await loadTab("quarantine");
          await loadAllData();
        }
      };
      
      const rejectQuarantine = async () => {
        if (!currentItem) return;
        const input = document.getElementById("q-reject-reason");
        const reason = input?.value.trim();
        
        const resp = await fetch("/quarantine/" + currentItem.quarantineId + "/reject", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason || undefined })
        });
        if (resp.ok) {
          await loadTab("quarantine");
          await loadAllData();
        }
      };
      
      const setTab = (tab) => {
        currentTab = tab;
        tabMedia.classList.toggle("active", tab === "media");
        tabQuarantine.classList.toggle("active", tab === "quarantine");
        tabDuplicates.classList.toggle("active", tab === "duplicates");
        quarantineFilter.classList.toggle("hidden", tab !== "quarantine");
        loadTab(tab);
      };
      
      const startPolling = () => {
        if (pollInterval) return;
        pollInterval = setInterval(async () => {
          await loadAllData();
          updateDebugInfo();
          if (currentTab) {
            await loadTab(currentTab);
          }
        }, 3000);
      };
      
      console.log("Attaching event listeners...");
      
      if (tabMedia) tabMedia.addEventListener("click", () => {
        console.log("Tab Media clicked");
        setTab("media");
      });
      if (tabQuarantine) tabQuarantine.addEventListener("click", () => {
        console.log("Tab Quarantine clicked");
        setTab("quarantine");
      });
      if (tabDuplicates) tabDuplicates.addEventListener("click", () => {
        console.log("Tab Duplicates clicked");
        setTab("duplicates");
      });
      if (quarantineFilter) quarantineFilter.addEventListener("change", () => {
        console.log("Quarantine filter changed");
        loadTab("quarantine");
      });
      if (refreshAllBtn) refreshAllBtn.addEventListener("click", async () => {
        console.log("Refresh All clicked");
        await loadAllData();
        if (currentTab) await loadTab(currentTab);
      });
      if (sourceAddBtn) {
        console.log("sourceAddBtn event listener attached");
        sourceAddBtn.addEventListener("click", () => {
          console.log("sourceAddBtn CLICKED!");
          createSource();
        });
      } else {
        console.error("sourceAddBtn is NULL!");
      }
      sourceScanBtn.addEventListener("click", scanSource);
      sourceBrowseBtn.addEventListener("click", pickSourcePath);
      snapshotCreateBtn.addEventListener("click", createSnapshot);
      
      console.log("Starting initialization...");
      loadAllData().then(() => console.log("loadAllData complete"));
      setTab("media");
      startPolling();
      updateDebugInfo();
      setInterval(updateDebugInfo, 1000);
      console.log("=== UI Initialization Complete ===");
      document.title = "FMV UI [Ready]";
      setTimeout(() => alert("UI Ready! All buttons should work now."), 500);
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
        console.log("[/fs/dialog] Request received");
        const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
        const powershellPath = systemRoot
          ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
          : "powershell";
        const script = [
          "Add-Type -AssemblyName System.Windows.Forms",
          "Add-Type -AssemblyName System.Drawing",
          "Add-Type @'",
          "using System;",
          "using System.Runtime.InteropServices;",
          "public static class Win32 {",
          "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
          "  [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr hWnd);",
          "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
          "}",
          "'@",
          "$owner = New-Object System.Windows.Forms.Form",
          "$owner.FormBorderStyle = 'None'",
          "$owner.ShowInTaskbar = $false",
          "$owner.StartPosition = 'Manual'",
          "$owner.Location = New-Object System.Drawing.Point(0, 0)",
          "$owner.Size = New-Object System.Drawing.Size(1, 1)",
          "$owner.TopMost = $true",
          "$owner.Opacity = 0.01",
          "$owner.Show()",
          "$owner.Activate()",
          "[Win32]::ShowWindow($owner.Handle, 5) | Out-Null",
          "[Win32]::BringWindowToTop($owner.Handle) | Out-Null",
          "[Win32]::SetForegroundWindow($owner.Handle) | Out-Null",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          "$dialog.Description = 'Выберите папку с медиа'",
          "$dialog.ShowNewFolderButton = $true",
          "if ($dialog.ShowDialog($owner) -eq 'OK') {",
          "  $dialog.SelectedPath",
          "}",
          "$owner.Close()",
          "$owner.Dispose()"
        ].join("; ");
        const pickPath = () =>
          new Promise<string>((resolve, reject) => {
            execFile(
              powershellPath,
              ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
              { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
              (error, stdout, stderr) => {
                if (error) {
                  console.error("[/fs/dialog] PowerShell error:", stderr || error.message);
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
        } catch (error) {
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
