export function renderDevConsoleHtml(): string {
  return `<!doctype html>
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
      .auth-inline { display: flex; gap: 6px; align-items: center; }
      .auth-inline input { width: 170px; }
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
      .list.tiles-mode { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
      .list.table-mode .item { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; }
      .item { border: 1px solid #1f2937; border-radius: 6px; padding: 8px; cursor: pointer; transition: all 0.15s; }
      .item:hover { border-color: #3b82f6; background: #0f1318; }
      .item.active { border-color: #2563eb; background: #0f1318; }
      .item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .item-id { font-size: 11px; color: #93c5fd; font-weight: 600; }
      .item-badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: #374151; color: #e5e7eb; }
      .item-meta { font-size: 11px; color: #6b7280; }
      .media-icon { font-size: 14px; }
      .media-thumb-frame { position: relative; width: 100%; min-height: 58px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
      .media-thumb-real { width: 100%; max-height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid #374151; opacity: 0; visibility: hidden; }
      .media-thumb-real.is-ready { opacity: 1; visibility: visible; }
      .media-glyph { display: inline-flex; align-items: center; justify-content: center; width: 74px; height: 46px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.18); background: linear-gradient(140deg, hsl(var(--glyph-hue) 70% 38%), hsl(var(--glyph-hue-2) 75% 52%)); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 2px 10px rgba(0, 0, 0, 0.2); }
      .media-glyph.small { width: 24px; height: 18px; border-radius: 5px; margin-right: 4px; vertical-align: middle; }
      .media-glyph-symbol { font-size: 14px; line-height: 1; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35)); }
      .media-glyph.small .media-glyph-symbol { font-size: 10px; }
      .view-controls { display: flex; gap: 4px; margin-bottom: 8px; }
      .pagination-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
      .pagination-info { font-size: 11px; color: #9ca3af; }

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
      .album-help { font-size: 10px; color: #9ca3af; }
      .album-editor { display: flex; flex-direction: column; gap: 10px; }
      .album-media-section { background: #0f1318; border-radius: 6px; padding: 8px; border: 1px solid #1f2937; }
      .album-media-title { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
      .album-media-selected { display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto; }
      .album-media-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; background: #1f2937; border: 1px solid #374151; font-size: 10px; }
      .album-media-picker { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; margin-top: 6px; }
      .album-media-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px; border-radius: 4px; border: 1px solid #1f2937; }
      .album-media-row:hover { border-color: #3b82f6; }
      .album-media-row-meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .album-media-row-id { font-size: 10px; color: #e5e7eb; word-break: break-all; }
      .album-media-row-size { font-size: 10px; color: #9ca3af; white-space: nowrap; }
      input, select { background: #0f1318; color: #e5e7eb; border: 1px solid #374151; border-radius: 5px; padding: 7px 10px; font-size: 11px; font-family: inherit; }
      input.grow { flex: 1; }
      select { cursor: pointer; }

      .source-card { border: 1px solid #1f2937; border-radius: 6px; padding: 8px; cursor: pointer; margin-bottom: 6px; transition: all 0.15s; }
      .source-card:hover { border-color: #3b82f6; }
      .source-card.active { border-color: #2563eb; background: #0f1318; }
      .source-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
      .source-path { font-size: 11px; color: #93c5fd; font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .source-id { font-size: 10px; color: #6b7280; }
      .icon-button { min-width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }

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
      .list-limit-note { margin-bottom: 8px; padding: 8px 10px; border: 1px solid #374151; border-radius: 6px; font-size: 11px; color: #9ca3af; background: #0f1318; }

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
        <div class="auth-inline">
          <input id="auth-token" placeholder="API token" />
          <button id="auth-token-save" class="secondary small" type="button">Set Token</button>
        </div>
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
          <span>⚙️ Job Queue</span>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button id="job-queue-toggle" class="secondary small" type="button">Hide</button>
            <div class="live" id="job-live"></div>
          </div>
        </div>
        <div id="job-queue" class="job-queue"></div>
      </section>

      <section class="panel">
        <div class="tabs">
          <button id="tab-media" class="tab active">📷 Media</button>
          <button id="tab-albums" class="tab">📚 Albums</button>
          <button id="tab-quarantine" class="tab">⚠️ Quarantine</button>
          <button id="tab-duplicates" class="tab">🔗 Duplicates</button>
        </div>
        <div id="media-view-controls" class="view-controls">
          <button id="view-tiles" class="tab small active" type="button">Tiles</button>
          <button id="view-list" class="tab small" type="button">List</button>
          <button id="view-table" class="tab small" type="button">Table</button>
        </div>
        <div id="media-pagination-controls" class="pagination-controls">
          <button id="media-page-prev" class="secondary small" type="button">← Prev</button>
          <div id="media-page-info" class="pagination-info">Page 1 / 1</div>
          <button id="media-page-next" class="secondary small" type="button">Next →</button>
        </div>
        <select id="quarantine-filter" class="hidden" style="margin-bottom: 8px;">
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <div id="albums-controls" class="controls hidden" style="margin-bottom: 8px;">
          <div class="control-row">
            <input id="album-name" class="grow" placeholder="Album name" />
            <button id="album-create" class="secondary" type="button">+ Create</button>
          </div>
          <div class="control-row">
            <input id="album-media-ids" class="grow" placeholder="Media IDs (comma-separated, optional)" />
          </div>
          <div class="album-help">Tip: open Media tab and copy mediaId values for album mediaIds.</div>
        </div>
        <div id="list" class="list"></div>
      </section>

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

      const listEl = document.getElementById("list");
      const detailViewEl = document.getElementById("detail-view");
      const detailPanelTitle = document.getElementById("detail-panel-title");
      const tabMedia = document.getElementById("tab-media");
      const tabAlbums = document.getElementById("tab-albums");
      const tabQuarantine = document.getElementById("tab-quarantine");
      const tabDuplicates = document.getElementById("tab-duplicates");
      const quarantineFilter = document.getElementById("quarantine-filter");
      const albumsControls = document.getElementById("albums-controls");
      const albumNameInput = document.getElementById("album-name");
      const albumMediaIdsInput = document.getElementById("album-media-ids");
      const albumCreateBtn = document.getElementById("album-create");
      const sourcePathEl = document.getElementById("source-path");
      const sourceAddBtn = document.getElementById("source-add");
      const sourceBrowseBtn = document.getElementById("source-browse");
      const sourceScanBtn = document.getElementById("source-scan");
      const snapshotCreateBtn = document.getElementById("snapshot-create");
      const refreshAllBtn = document.getElementById("refresh-all");
      const sourcesListEl = document.getElementById("sources-list");
      const jobQueueEl = document.getElementById("job-queue");
      const jobLiveEl = document.getElementById("job-live");
      const jobQueueToggleBtn = document.getElementById("job-queue-toggle");
      const mediaViewControls = document.getElementById("media-view-controls");
      const viewTilesBtn = document.getElementById("view-tiles");
      const viewListBtn = document.getElementById("view-list");
      const viewTableBtn = document.getElementById("view-table");
      const mediaPaginationControls = document.getElementById("media-pagination-controls");
      const mediaPagePrevBtn = document.getElementById("media-page-prev");
      const mediaPageNextBtn = document.getElementById("media-page-next");
      const mediaPageInfo = document.getElementById("media-page-info");
      const authTokenInput = document.getElementById("auth-token");
      const authTokenSaveBtn = document.getElementById("auth-token-save");

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
      let albums = [];
      let selectedAlbumId = "";
      let albumMediaCatalog = [];
      let albumMediaCatalogTotal = 0;
      let selectedSourceId = "";
      let startTime = Date.now();
      let pollInterval = null;
      let isJobQueueCollapsed = false;
      let mediaViewMode = "tiles";
      let activeJobCount = 0;
      let mediaDetailRequestSeq = 0;
      let assetToken = "";
      let assetTokenExpiresAt = 0;
      const mediaDetailCache = new Map();
      let mediaThumbObserver = null;
      let mediaPageOffset = 0;
      let mediaPageTotal = 0;
      const AUTH_STORAGE_KEY = "fmv_api_token";
      const queryToken = new URLSearchParams(window.location.search).get("token");
      if (queryToken) {
        localStorage.setItem(AUTH_STORAGE_KEY, queryToken);
      }
      let authToken = localStorage.getItem(AUTH_STORAGE_KEY) || "";
      if (authTokenInput) {
        authTokenInput.value = authToken;
      }

      const MAX_ITEMS_PER_VIEW = {
        media: {
          tiles: 120,
          list: 300,
          table: 300
        },
        albums: 300,
        quarantine: 300,
        duplicates: 300
      };

      const getMediaPageLimit = () => MAX_ITEMS_PER_VIEW.media[mediaViewMode] || MAX_ITEMS_PER_VIEW.media.list;

      const fmtBytes = (value) => {
        if (!Number.isFinite(value)) return "-";
        if (value < 1024) return value + " B";
        const units = ["KB", "MB", "GB", "TB"];
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

      const parseMediaIdsInput = (raw) => {
        if (typeof raw !== "string") {
          return [];
        }
        const values = raw
          .split(/[\\n,]/)
          .map((value) => value.trim())
          .filter(Boolean);
        const seen = new Set();
        const mediaIds = [];
        for (const value of values) {
          if (seen.has(value)) {
            continue;
          }
          seen.add(value);
          mediaIds.push(value);
        }
        return mediaIds;
      };

      const uniqueMediaIds = (values) => {
        const seen = new Set();
        const result = [];
        for (const value of values) {
          const normalized = typeof value === "string" ? value.trim() : "";
          if (!normalized || seen.has(normalized)) {
            continue;
          }
          seen.add(normalized);
          result.push(normalized);
        }
        return result;
      };

      const escapeHtml = (value) =>
        String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const hueFromMediaId = (mediaId) => {
        let hash = 0;
        for (let idx = 0; idx < mediaId.length; idx++) {
          hash = (hash * 31 + mediaId.charCodeAt(idx)) | 0;
        }
        return Math.abs(hash) % 360;
      };

      const renderMediaGlyph = (mediaId, variant) => {
        const hue = hueFromMediaId(mediaId);
        const hue2 = (hue + 48) % 360;
        const className = variant === "small" ? "media-glyph small" : "media-glyph";
        return '<span class="' + className + '" style="--glyph-hue:' + hue + '; --glyph-hue-2:' + hue2 + ';"><span class="media-glyph-symbol">🖼</span></span>';
      };

      const clearMediaThumbObserver = () => {
        if (!mediaThumbObserver) {
          return;
        }
        mediaThumbObserver.disconnect();
        mediaThumbObserver = null;
      };

      const setupMediaThumbnails = () => {
        clearMediaThumbObserver();
        if (currentTab !== "media" || mediaViewMode !== "tiles") {
          return;
        }
        const images = Array.from(listEl.querySelectorAll('img[data-thumb-src]'));
        if (images.length === 0) {
          return;
        }

        const startLoad = async (img) => {
          if (img.dataset.loaded === "1") {
            return;
          }
          const src = img.getAttribute("data-thumb-src");
          if (!src) {
            return;
          }
          img.dataset.loaded = "1";
          const frame = img.closest("[data-thumb-frame]");
          const glyph = frame ? frame.querySelector(".media-glyph") : null;
          img.addEventListener(
            "load",
            () => {
              img.classList.add("is-ready");
              if (glyph) {
                glyph.classList.add("hidden");
              }
            },
            { once: true }
          );
          img.addEventListener(
            "error",
            () => {
              const fallback = img.getAttribute("data-fallback-src");
              if (fallback && img.dataset.fallbackTried !== "1") {
                img.dataset.fallbackTried = "1";
                img.dataset.loaded = "0";
                img.setAttribute("data-thumb-src", fallback);
                void startLoad(img);
                return;
              }
              img.remove();
            },
            { once: true }
          );
          const signedSrc = await toAssetUrl(src);
          img.src = signedSrc;
        };

        if (typeof IntersectionObserver === "undefined") {
          images.forEach((img) => {
            void startLoad(img);
          });
          return;
        }

        mediaThumbObserver = new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }
              const img = entry.target;
              observer.unobserve(img);
              void startLoad(img);
            });
          },
          {
            root: listEl,
            rootMargin: "120px"
          }
        );

        images.forEach((img) => mediaThumbObserver.observe(img));
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
          const res = await authFetch(url);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      };

      const ensureAlbumMediaCatalog = async (forceReload = false) => {
        if (!forceReload && albumMediaCatalog.length > 0) {
          return albumMediaCatalog;
        }
        const data = await fetchData("/media?limit=500&offset=0");
        albumMediaCatalog = Array.isArray(data?.media) ? data.media : [];
        albumMediaCatalogTotal = typeof data?.total === "number" ? data.total : albumMediaCatalog.length;
        return albumMediaCatalog;
      };

      const createAlbum = async () => {
        const name = albumNameInput ? albumNameInput.value.trim() : "";
        if (!name) {
          alert("Album name is required");
          return;
        }

        const mediaIds = parseMediaIdsInput(albumMediaIdsInput ? albumMediaIdsInput.value : "");
        if (albumCreateBtn) {
          albumCreateBtn.disabled = true;
          albumCreateBtn.textContent = "Creating...";
        }

        try {
          const resp = await authFetch("/albums", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, mediaIds })
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: "unknown" }));
            alert("Failed to create album: " + (err.error || "unknown"));
            return;
          }

          const payload = await resp.json().catch(() => null);
          if (payload && payload.album && payload.album.albumId) {
            selectedAlbumId = payload.album.albumId;
          }

          if (albumNameInput) {
            albumNameInput.value = "";
          }
          if (albumMediaIdsInput) {
            albumMediaIdsInput.value = "";
          }

          await loadAllData();
          await loadTab("albums");
        } finally {
          if (albumCreateBtn) {
            albumCreateBtn.disabled = false;
            albumCreateBtn.textContent = "+ Create";
          }
        }
      };

      const updateAlbum = async (albumId, options = {}) => {
        const nameInput = document.getElementById("album-edit-name");
        const mediaIdsInput = document.getElementById("album-edit-media-ids");
        const fallbackName = nameInput ? nameInput.value.trim() : "";
        const name = typeof options.name === "string" ? options.name.trim() : fallbackName;
        if (!name) {
          alert("Album name is required");
          return;
        }
        const fallbackMediaIds = parseMediaIdsInput(mediaIdsInput ? mediaIdsInput.value : "");
        const mediaIds = Array.isArray(options.mediaIds)
          ? uniqueMediaIds(options.mediaIds)
          : fallbackMediaIds;
        const resp = await authFetch("/albums/" + encodeURIComponent(albumId), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, mediaIds })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "unknown" }));
          alert("Failed to update album: " + (err.error || "unknown"));
          return;
        }

        selectedAlbumId = albumId;
        await loadAllData();
        await loadTab("albums");
      };

      const removeAlbum = async (albumId, albumName) => {
        if (!confirm("Delete album?\\n" + (albumName || albumId))) {
          return;
        }
        const resp = await authFetch("/albums/" + encodeURIComponent(albumId), {
          method: "DELETE"
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "unknown" }));
          alert("Failed to delete album: " + (err.error || "unknown"));
          return;
        }

        if (selectedAlbumId === albumId) {
          selectedAlbumId = "";
        }
        clearDetail();
        await loadAllData();
        await loadTab("albums");
      };

      const viewAlbum = async (album) => {
        if (!album) {
          clearDetail();
          return;
        }

        currentItem = album;
        selectedAlbumId = album.albumId;

        await ensureAlbumMediaCatalog();
        let draftMediaIds = uniqueMediaIds(Array.isArray(album.mediaIds) ? album.mediaIds : []);
        detailViewEl.innerHTML =
          renderDetailKV("📚 Album", [
            ["albumId", album.albumId],
            ["name", album.name || "-"],
            ["mediaCount", draftMediaIds.length],
            ["createdAt", fmtTime(album.createdAt)],
            ["updatedAt", fmtTime(album.updatedAt)]
          ]) +
          '<div class="album-editor">' +
          '<div class="quarantine-actions">' +
          '<input id="album-edit-name" placeholder="Album name" style="flex:1;" value="' + escapeHtml(album.name || "") + '" />' +
          '<button id="album-save-btn" class="small">Save</button>' +
          '<button id="album-delete-btn" class="small danger">Delete</button>' +
          '</div>' +
          '<div class="album-media-section">' +
          '<div class="album-media-title">Selected media</div>' +
          '<div id="album-selected-media" class="album-media-selected"></div>' +
          '</div>' +
          '<div class="album-media-section">' +
          '<div class="album-media-title">Add media from vault</div>' +
          '<div class="control-row">' +
          '<input id="album-media-search" class="grow" placeholder="Search by mediaId / sha256" />' +
          '<button id="album-media-reload" class="secondary small" type="button">↻</button>' +
          '</div>' +
          '<div id="album-media-picker" class="album-media-picker"></div>' +
          '<div class="album-help" id="album-media-hint"></div>' +
          '</div>' +
          '</div>';

        const selectedContainer = document.getElementById("album-selected-media");
        const pickerContainer = document.getElementById("album-media-picker");
        const searchInput = document.getElementById("album-media-search");
        const reloadBtn = document.getElementById("album-media-reload");
        const hintEl = document.getElementById("album-media-hint");

        const renderSelectedMedia = () => {
          if (!selectedContainer) {
            return;
          }
          if (draftMediaIds.length === 0) {
            selectedContainer.innerHTML = '<div class="empty" style="padding:8px;">No media in album</div>';
            return;
          }
          selectedContainer.innerHTML = draftMediaIds
            .map(
              (mediaId) =>
                '<div class="album-media-chip">' +
                '<span>' + escapeHtml(mediaId) + '</span>' +
                '<button class="danger small" type="button" data-remove-media-id="' + escapeHtml(mediaId) + '">×</button>' +
                '</div>'
            )
            .join("");
        };

        const renderMediaPicker = () => {
          if (!pickerContainer) {
            return;
          }
          const query = (searchInput?.value ?? "").trim().toLowerCase();
          const selectedSet = new Set(draftMediaIds);
          const candidates = albumMediaCatalog.filter((item) => {
            if (selectedSet.has(item.mediaId)) {
              return false;
            }
            if (!query) {
              return true;
            }
            return item.mediaId.toLowerCase().includes(query) || item.sha256.toLowerCase().includes(query);
          });
          const visible = candidates.slice(0, 120);
          if (visible.length === 0) {
            pickerContainer.innerHTML = '<div class="empty" style="padding:8px;">No media matches filter</div>';
          } else {
            pickerContainer.innerHTML = visible
              .map(
                (item) =>
                  '<div class="album-media-row">' +
                  '<div class="album-media-row-meta">' +
                  renderMediaGlyph(item.mediaId, "small") +
                  '<div>' +
                  '<div class="album-media-row-id">' + escapeHtml(item.mediaId) + '</div>' +
                  '<div class="album-media-row-size">' + fmtBytes(item.size) + ' • ' + escapeHtml(item.sha256.slice(0, 8)) + '...</div>' +
                  '</div>' +
                  '</div>' +
                  '<button class="small secondary" type="button" data-add-media-id="' + escapeHtml(item.mediaId) + '">Add</button>' +
                  '</div>'
              )
              .join("");
          }
          if (hintEl) {
            hintEl.textContent =
              'Loaded ' + albumMediaCatalog.length +
              ' media items' +
              (albumMediaCatalogTotal > albumMediaCatalog.length ? ' of ' + albumMediaCatalogTotal : '') +
              '.';
          }
        };

        renderSelectedMedia();
        renderMediaPicker();

        selectedContainer?.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }
          const mediaId = target.getAttribute("data-remove-media-id");
          if (!mediaId) {
            return;
          }
          draftMediaIds = draftMediaIds.filter((id) => id !== mediaId);
          renderSelectedMedia();
          renderMediaPicker();
        });

        pickerContainer?.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }
          const mediaId = target.getAttribute("data-add-media-id");
          if (!mediaId) {
            return;
          }
          draftMediaIds = uniqueMediaIds([...draftMediaIds, mediaId]);
          renderSelectedMedia();
          renderMediaPicker();
        });

        searchInput?.addEventListener("input", () => {
          renderMediaPicker();
        });

        reloadBtn?.addEventListener("click", async () => {
          await ensureAlbumMediaCatalog(true);
          renderMediaPicker();
        });

        setTimeout(() => {
          const saveBtn = document.getElementById("album-save-btn");
          const deleteBtn = document.getElementById("album-delete-btn");
          const nameInput = document.getElementById("album-edit-name");
          if (saveBtn) {
            saveBtn.addEventListener("click", () => {
              updateAlbum(album.albumId, {
                name: nameInput ? nameInput.value : album.name,
                mediaIds: draftMediaIds
              });
            });
          }
          if (deleteBtn) {
            deleteBtn.addEventListener("click", () => {
              removeAlbum(album.albumId, album.name);
            });
          }
        }, 0);
      };

      const buildHeaders = (extraHeaders) => {
        const headers = { ...(extraHeaders || {}) };
        if (authToken) {
          headers.authorization = "Bearer " + authToken;
        }
        return headers;
      };

      const getAssetToken = async () => {
        if (!authToken) {
          return "";
        }
        const now = Date.now();
        if (assetToken && now + 5000 < assetTokenExpiresAt) {
          return assetToken;
        }
        const resp = await authFetch("/auth/asset-token", { method: "POST" });
        if (!resp.ok) {
          return "";
        }
        const body = await resp.json().catch(() => null);
        if (!body || typeof body.token !== "string" || typeof body.expiresAt !== "number") {
          return "";
        }
        assetToken = body.token;
        assetTokenExpiresAt = body.expiresAt;
        return assetToken;
      };

      const toAssetUrl = async (url) => {
        const token = await getAssetToken();
        if (!token) {
          return url;
        }
        return url + (url.includes("?") ? "&" : "?") + "sat=" + encodeURIComponent(token);
      };

      const authFetch = (url, init = {}) => {
        const requestInit = {
          ...init,
          headers: buildHeaders(init.headers)
        };
        return fetch(url, requestInit);
      };

      const loadAllData = async () => {
        const [sourcesData, albumsData, mediaData, entriesData, quarantineData, duplicateData, jobsData] = await Promise.all([
          fetchData("/sources"),
          fetchData("/albums"),
          fetchData("/media?limit=1&offset=0"),
          fetchData("/entries"),
          fetchData("/quarantine"),
          fetchData("/duplicate-links"),
          fetchData("/jobs")
        ]);

        sources = sourcesData?.sources ?? [];
        albums = albumsData?.albums ?? [];
        if (selectedAlbumId && !albums.some((album) => album.albumId === selectedAlbumId)) {
          selectedAlbumId = "";
        }
        const jobs = jobsData?.jobs ?? [];
        const activeJobs = jobs.filter(j => j.status === "queued" || j.status === "running");
        activeJobCount = activeJobs.length;

        updateMetrics({
          sources: sources.length,
          media: typeof mediaData?.total === "number" ? mediaData.total : mediaData?.media?.length ?? 0,
          entries: entriesData?.entries?.length ?? 0,
          quarantine: quarantineData?.items?.filter(i => i.status === "pending").length ?? 0,
          duplicates: duplicateData?.links?.length ?? 0,
          jobs: activeJobCount
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
          '<div class="source-header">' +
          '<div class="source-path">' + source.path + '</div>' +
          '<button class="icon-button small danger" type="button" title="Delete source" data-delete-source-id="' + source.sourceId + '">🗑</button>' +
          '</div>' +
          '<div class="source-id">' + source.sourceId + '</div>' +
          '</div>'
        ).join('');
      };

      const selectSource = (sourceId) => {
        selectedSourceId = sourceId;
        sourceScanBtn.disabled = false;
        renderSources();
      };

      const deleteSource = async (sourceId) => {
        const source = sources.find((item) => item.sourceId === sourceId);
        const sourceLabel = source ? source.path : sourceId;
        if (!confirm('Delete source?\\n' + sourceLabel)) {
          return;
        }
        try {
          const resp = await authFetch('/sources/' + sourceId, { method: 'DELETE' });
          if (!resp.ok) {
            alert('Failed to delete source');
            return;
          }
          if (selectedSourceId === sourceId) {
            selectedSourceId = '';
          }
          await loadAllData();
          if (currentTab) {
            await loadTab(currentTab);
          }
        } catch (error) {
          alert('Delete failed: ' + (error && error.message ? error.message : String(error)));
        }
      };

      sourcesListEl.addEventListener('click', (e) => {
        const deleteButton = e.target.closest('[data-delete-source-id]');
        if (deleteButton) {
          e.stopPropagation();
          const sourceId = deleteButton.getAttribute('data-delete-source-id');
          if (sourceId) {
            deleteSource(sourceId);
          }
          return;
        }
        const card = e.target.closest('.source-card');
        if (card) {
          const sourceId = card.getAttribute('data-source-id');
          if (sourceId) selectSource(sourceId);
        }
      });

      const renderJobQueue = (jobs) => {
        jobQueueEl.classList.toggle('hidden', isJobQueueCollapsed);
        if (jobQueueToggleBtn) {
          jobQueueToggleBtn.textContent = isJobQueueCollapsed ? 'Show' : 'Hide';
        }
        if (isJobQueueCollapsed) {
          jobLiveEl.style.display = 'none';
          return;
        }
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

          const resp = await authFetch("/sources", {
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

          const resp = await authFetch("/jobs/scan", {
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

          const resp = await authFetch("/snapshots", { method: "POST" });
          if (resp.ok) {
            await resp.json();
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
          const resp = await authFetch("/fs/dialog");
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

      const renderMediaViewControls = () => {
        if (!viewTilesBtn || !viewListBtn || !viewTableBtn) {
          return;
        }
        viewTilesBtn.classList.toggle('active', mediaViewMode === 'tiles');
        viewListBtn.classList.toggle('active', mediaViewMode === 'list');
        viewTableBtn.classList.toggle('active', mediaViewMode === 'table');
      };

      const renderMediaPaginationControls = () => {
        if (!mediaPaginationControls || !mediaPagePrevBtn || !mediaPageNextBtn || !mediaPageInfo) {
          return;
        }
        mediaPaginationControls.classList.toggle('hidden', currentTab !== 'media');
        if (currentTab !== 'media') {
          return;
        }
        const pageLimit = getMediaPageLimit();
        const currentPage = Math.floor(mediaPageOffset / pageLimit) + 1;
        const totalPages = Math.max(1, Math.ceil(mediaPageTotal / pageLimit));
        mediaPageInfo.textContent = 'Page ' + currentPage + ' / ' + totalPages + ' (' + mediaPageTotal + ')';
        mediaPagePrevBtn.disabled = mediaPageOffset <= 0;
        mediaPageNextBtn.disabled = mediaPageOffset + pageLimit >= mediaPageTotal;
      };

      const loadTab = async (tab) => {
        clearMediaThumbObserver();
        if (mediaViewControls) {
          mediaViewControls.classList.toggle('hidden', tab !== 'media');
        }
        const mediaPageLimit = getMediaPageLimit();
        const data = await fetchData(
          tab === "media"
            ? "/media?limit=" + mediaPageLimit + "&offset=" + mediaPageOffset
            : tab === "quarantine"
              ? "/quarantine" + (quarantineFilter.value ? "?status=" + quarantineFilter.value : "")
              : tab === "duplicates"
                ? "/duplicate-links"
                : "/albums"
        );

        if (!data) {
          renderEmpty("Error loading data");
          return;
        }

        const items = data.media || data.items || data.links || data.albums || [];
        if (tab === "media") {
          mediaPageTotal = typeof data.total === "number" ? data.total : items.length;
          renderMediaPaginationControls();
        }
        if (items.length === 0) {
          if (tab === "albums") {
            renderEmpty("No albums. Create one with form above.");
          } else {
            renderEmpty("No data. Add source and run scan.");
          }
          return;
        }

        let visibleItems = items;
        let limitNotice = "";

        if (tab === "media") {
          if (mediaPageOffset >= mediaPageTotal && mediaPageTotal > 0) {
            mediaPageOffset = Math.max(0, Math.floor((mediaPageTotal - 1) / mediaPageLimit) * mediaPageLimit);
            await loadTab(tab);
            return;
          }
          renderMediaPaginationControls();
        } else {
          let maxItemsToRender = MAX_ITEMS_PER_VIEW.duplicates;
          if (tab === "quarantine") {
            maxItemsToRender = MAX_ITEMS_PER_VIEW.quarantine;
          } else if (tab === "albums") {
            maxItemsToRender = MAX_ITEMS_PER_VIEW.albums;
          }
          visibleItems = items.length > maxItemsToRender ? items.slice(0, maxItemsToRender) : items;
          limitNotice =
            items.length > maxItemsToRender
              ? '<div class="list-limit-note">Showing first ' + maxItemsToRender + ' of ' + items.length + ' items. Use filters or open details for a specific ID.</div>'
              : '';
        }

        if (tab !== "media") {
          if (mediaPaginationControls) {
            mediaPaginationControls.classList.add("hidden");
          }
        }

        listEl.classList.remove('tiles-mode', 'table-mode');
        if (tab === 'media') {
          if (mediaViewMode === 'tiles') {
            listEl.classList.add('tiles-mode');
          }
          if (mediaViewMode === 'table') {
            listEl.classList.add('table-mode');
          }
        }

        listEl.innerHTML = limitNotice + visibleItems.map(item => {
          if (tab === "media") {
            const mediaId = item.mediaId;
            const shaText = item.sha256.substring(0, 16) + '...';
            if (mediaViewMode === 'table') {
              return '<div class="item" data-media-id="' + mediaId + '">' +
                renderMediaGlyph(mediaId, 'small') +
                '<span class="item-id">' + mediaId + '</span>' +
                '<span class="item-badge">' + fmtBytes(item.size) + '</span>' +
                '</div>';
            }
            if (mediaViewMode === 'list') {
              return '<div class="item" data-media-id="' + mediaId + '">' +
                '<div class="item-header"><span class="item-id">' + renderMediaGlyph(mediaId, 'small') + ' ' + mediaId + '</span>' +
                '<span class="item-badge">' + fmtBytes(item.size) + '</span></div>' +
                '<div class="item-meta">' + shaText + '</div></div>';
            }
            return '<div class="item" data-media-id="' + item.mediaId + '">' +
              '<div class="media-thumb-frame" data-thumb-frame="1">' +
              renderMediaGlyph(mediaId) +
              '<img class="media-thumb-real" loading="lazy" decoding="async" alt="media thumbnail" data-thumb-src="/derived/' + mediaId + '/thumb" data-fallback-src="/media/' + mediaId + '/file" />' +
              '</div>' +
              '<div class="item-header"><span class="item-id">' + item.mediaId + '</span>' +
              '<span class="item-badge">' + fmtBytes(item.size) + '</span></div>' +
              '<div class="item-meta">' + item.sha256.substring(0, 16) + '...</div></div>';
          } else if (tab === "quarantine") {
            const candidates = (item.candidateMediaIds || []).length;
            return '<div class="item" data-quarantine-id="' + item.quarantineId + '">' +
              '<div class="item-header"><span class="item-id">' + item.quarantineId + '</span>' +
              '<span class="item-badge">' + item.status + '</span></div>' +
              '<div class="item-meta">' + candidates + ' candidates | ' + item.sourceEntryId + '</div></div>';
          } else if (tab === "albums") {
            const mediaCount = Array.isArray(item.mediaIds) ? item.mediaIds.length : 0;
            const activeClass = item.albumId === selectedAlbumId ? ' active' : '';
            return '<div class="item' + activeClass + '" data-album-data="' + encodeURIComponent(JSON.stringify(item)) + '">' +
              '<div class="item-header"><span class="item-id">' + (item.name || item.albumId) + '</span>' +
              '<span class="item-badge">' + mediaCount + ' media</span></div>' +
              '<div class="item-meta">' + item.albumId + '</div></div>';
          }
          return '<div class="item" data-duplicate-id="' + item.duplicateLinkId + '" data-duplicate-data="' + encodeURIComponent(JSON.stringify(item)) + '">' +
            '<div class="item-header"><span class="item-id">' + item.duplicateLinkId + '</span>' +
            '<span class="item-badge">' + item.level + '</span></div>' +
            '<div class="item-meta">' + item.mediaId + '</div></div>';
        }).join('');

        listEl.onclick = async (e) => {
          const itemEl = e.target.closest('.item');
          if (!itemEl) return;

          const mediaId = itemEl.getAttribute('data-media-id');
          const quarantineId = itemEl.getAttribute('data-quarantine-id');
          const duplicateData = itemEl.getAttribute('data-duplicate-data');
          const albumData = itemEl.getAttribute('data-album-data');

          if (mediaId) {
            await viewMedia(mediaId);
          } else if (quarantineId) {
            await viewQuarantine(quarantineId);
          } else if (albumData) {
            const album = JSON.parse(decodeURIComponent(albumData));
            selectedAlbumId = album.albumId;
            await loadTab("albums");
            await viewAlbum(album);
          } else if (duplicateData) {
            viewDuplicate(JSON.parse(decodeURIComponent(duplicateData)));
          }
        };

        setupMediaThumbnails();
      };

      const viewMedia = async (mediaId) => {
        const requestSeq = ++mediaDetailRequestSeq;
        detailPanelTitle.textContent = "📷 Media";
        detailViewEl.innerHTML = '<div class="empty">Loading media...</div>';

        const cached = mediaDetailCache.get(mediaId);
        if (cached) {
          if (requestSeq !== mediaDetailRequestSeq) {
            return;
          }
          const media = cached.media;
          const metadata = cached.metadata;
          const fileUrl = await toAssetUrl("/media/" + mediaId + "/file");
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
          return;
        }

        const data = await fetchData("/media/" + mediaId);
        if (requestSeq !== mediaDetailRequestSeq) {
          return;
        }
        if (!data || !data.media) {
          clearDetail();
          return;
        }
        mediaDetailCache.set(mediaId, data);
        const media = data.media;
        const metadata = data.metadata;
        const fileUrl = await toAssetUrl("/media/" + mediaId + "/file");
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
        detailViewEl.innerHTML = renderDetailKV("🔗 Duplicate Link", [
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

        const resp = await authFetch("/quarantine/" + currentItem.quarantineId + "/accept", {
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

        const resp = await authFetch("/quarantine/" + currentItem.quarantineId + "/reject", {
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
        tabAlbums.classList.toggle("active", tab === "albums");
        tabQuarantine.classList.toggle("active", tab === "quarantine");
        tabDuplicates.classList.toggle("active", tab === "duplicates");
        quarantineFilter.classList.toggle("hidden", tab !== "quarantine");
        albumsControls.classList.toggle("hidden", tab !== "albums");
        renderMediaViewControls();
        renderMediaPaginationControls();
        clearDetail();
        loadTab(tab);
      };

      const startPolling = () => {
        if (pollInterval) return;
        pollInterval = setInterval(async () => {
          if (currentTab === "media" && activeJobCount === 0) {
            updateDebugInfo();
            return;
          }
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
      if (tabAlbums) tabAlbums.addEventListener("click", () => {
        console.log("Tab Albums clicked");
        setTab("albums");
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
      if (authTokenSaveBtn) {
        authTokenSaveBtn.addEventListener("click", async () => {
          authToken = authTokenInput ? authTokenInput.value.trim() : "";
          assetToken = "";
          assetTokenExpiresAt = 0;
          if (authToken) {
            localStorage.setItem(AUTH_STORAGE_KEY, authToken);
          } else {
            localStorage.removeItem(AUTH_STORAGE_KEY);
          }
          await loadAllData();
          if (currentTab) {
            await loadTab(currentTab);
          }
        });
      }
      if (sourceAddBtn) {
        console.log("sourceAddBtn event listener attached");
        sourceAddBtn.addEventListener("click", () => {
          console.log("sourceAddBtn CLICKED!");
          createSource();
        });
      } else {
        console.error("sourceAddBtn is NULL!");
      }
      if (albumCreateBtn) {
        albumCreateBtn.addEventListener("click", () => {
          createAlbum();
        });
      }
      if (albumNameInput) {
        albumNameInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            createAlbum();
          }
        });
      }
      sourceScanBtn.addEventListener("click", scanSource);
      sourceBrowseBtn.addEventListener("click", pickSourcePath);
      snapshotCreateBtn.addEventListener("click", createSnapshot);
      if (jobQueueToggleBtn) {
        jobQueueToggleBtn.addEventListener("click", () => {
          isJobQueueCollapsed = !isJobQueueCollapsed;
          renderJobQueue([]);
          loadAllData();
        });
      }
      if (viewTilesBtn) {
        viewTilesBtn.addEventListener("click", () => {
          mediaViewMode = "tiles";
          mediaPageOffset = 0;
          renderMediaViewControls();
          if (currentTab === "media") {
            loadTab("media");
          }
        });
      }
      if (viewListBtn) {
        viewListBtn.addEventListener("click", () => {
          mediaViewMode = "list";
          mediaPageOffset = 0;
          renderMediaViewControls();
          if (currentTab === "media") {
            loadTab("media");
          }
        });
      }
      if (viewTableBtn) {
        viewTableBtn.addEventListener("click", () => {
          mediaViewMode = "table";
          mediaPageOffset = 0;
          renderMediaViewControls();
          if (currentTab === "media") {
            loadTab("media");
          }
        });
      }
      if (mediaPagePrevBtn) {
        mediaPagePrevBtn.addEventListener("click", () => {
          if (currentTab !== "media") {
            return;
          }
          const pageLimit = getMediaPageLimit();
          mediaPageOffset = Math.max(0, mediaPageOffset - pageLimit);
          loadTab("media");
        });
      }
      if (mediaPageNextBtn) {
        mediaPageNextBtn.addEventListener("click", () => {
          if (currentTab !== "media") {
            return;
          }
          const pageLimit = getMediaPageLimit();
          const nextOffset = mediaPageOffset + pageLimit;
          if (nextOffset >= mediaPageTotal) {
            return;
          }
          mediaPageOffset = nextOffset;
          loadTab("media");
        });
      }

      console.log("Starting initialization...");
      loadAllData().then(() => console.log("loadAllData complete"));
      setTab("media");
      startPolling();
      updateDebugInfo();
      setInterval(updateDebugInfo, 1000);
      console.log("=== UI Initialization Complete ===");
      document.title = "FMV UI [Ready]";
    </script>
  </body>
</html>`;
}
