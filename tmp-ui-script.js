
      document.title = "FMV UI [JS Loading...]";
      console.log("=== Family Media Vault UI Loading ===");

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
      const jobQueueToggleBtn = document.getElementById("job-queue-toggle");
      const mediaViewControls = document.getElementById("media-view-controls");
      const viewTilesBtn = document.getElementById("view-tiles");
      const viewListBtn = document.getElementById("view-list");
      const viewTableBtn = document.getElementById("view-table");

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
      let isJobQueueCollapsed = false;
      let mediaViewMode = "tiles";

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
        if (!confirm('Delete source?\n' + sourceLabel)) {
          return;
        }
        try {
          const resp = await fetch('/sources/' + sourceId, { method: 'DELETE' });
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

      const renderMediaViewControls = () => {
        if (!viewTilesBtn || !viewListBtn || !viewTableBtn) {
          return;
        }
        viewTilesBtn.classList.toggle('active', mediaViewMode === 'tiles');
        viewListBtn.classList.toggle('active', mediaViewMode === 'list');
        viewTableBtn.classList.toggle('active', mediaViewMode === 'table');
      };

      const loadTab = async (tab) => {
        clearDetail();
        if (mediaViewControls) {
          mediaViewControls.classList.toggle('hidden', tab !== 'media');
        }
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

        listEl.classList.remove('tiles-mode', 'table-mode');
        if (tab === 'media') {
          if (mediaViewMode === 'tiles') {
            listEl.classList.add('tiles-mode');
          }
          if (mediaViewMode === 'table') {
            listEl.classList.add('table-mode');
          }
        }

        listEl.innerHTML = items.map(item => {
          if (tab === "media") {
            const mediaId = item.mediaId;
            const mediaIcon = "🖼️";
            const shaText = item.sha256.substring(0, 16) + '...';
            if (mediaViewMode === 'table') {
              return '<div class="item" data-media-id="' + mediaId + '">' +
                '<span class="media-icon">' + mediaIcon + '</span>' +
                '<span class="item-id">' + mediaId + '</span>' +
                '<span class="item-badge">' + fmtBytes(item.size) + '</span>' +
                '</div>';
            }
            if (mediaViewMode === 'list') {
              return '<div class="item" data-media-id="' + mediaId + '">' +
                '<div class="item-header"><span class="item-id"><span class="media-icon">' + mediaIcon + '</span> ' + mediaId + '</span>' +
                '<span class="item-badge">' + fmtBytes(item.size) + '</span></div>' +
                '<div class="item-meta">' + shaText + '</div></div>';
            }
            return '<div class="item" data-media-id="' + item.mediaId + '">' +
              '<img class="media-thumb" loading="lazy" src="/media/' + mediaId + '/file" alt="media" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';" />' +
              '<div class="media-icon" style="display:none; margin-bottom: 6px;">🖼️</div>' +
              '<div class="item-header"><span class="item-id">' + item.mediaId + '</span>' +
              '<span class="item-badge">' + fmtBytes(item.size) + '</span></div>' +
              '<div class="item-meta">' + item.sha256.substring(0, 16) + '...</div></div>';
          } else if (tab === "quarantine") {
            const candidates = (item.candidateMediaIds || []).length;
            return '<div class="item" data-quarantine-id="' + item.quarantineId + '">' +
              '<div class="item-header"><span class="item-id">' + item.quarantineId + '</span>' +
              '<span class="item-badge">' + item.status + '</span></div>' +
              '<div class="item-meta">' + candidates + ' candidates | ' + item.sourceEntryId + '</div></div>';
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
        const media = data.media;
        const metadata = data.metadata;
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
        renderMediaViewControls();
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
          renderMediaViewControls();
          if (currentTab === "media") {
            loadTab("media");
          }
        });
      }
      if (viewListBtn) {
        viewListBtn.addEventListener("click", () => {
          mediaViewMode = "list";
          renderMediaViewControls();
          if (currentTab === "media") {
            loadTab("media");
          }
        });
      }
      if (viewTableBtn) {
        viewTableBtn.addEventListener("click", () => {
          mediaViewMode = "table";
          renderMediaViewControls();
          if (currentTab === "media") {
            loadTab("media");
          }
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
    