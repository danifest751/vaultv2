import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Group,
  NavLink,
  Stack,
  TextInput,
  Title
} from "@mantine/core";
import {
  acceptQuarantine,
  createAlbum,
  createSnapshot,
  createSource,
  getAlbums,
  getDuplicateLinks,
  getJobs,
  getMediaDetails,
  getMediaPage,
  getQuarantine,
  getQuarantineItem,
  getSnapshotPointer,
  getSources,
  getToolsHealth,
  pickSourcePath,
  rejectQuarantine,
  removeAlbum,
  removeSource,
  scanSource,
  searchMedia,
  updateAlbum
} from "./api";
import { filterAvailableMedia, uniqueMediaIds } from "./albums/album-media-utils";
import { hasSearchFilters, toSelectedSet } from "./media/media-search-utils";
import { NAV_ITEMS, SectionKey } from "./navigation";
import { buildAppMetrics } from "./overview/metrics-utils";
import { asErrorMessage } from "./shared/error-utils";
import { formatBytes, formatDate } from "./shared/format-utils";
import {
  AlbumDto,
  DuplicateLevelFilter,
  DuplicateLinkDto,
  JobDto,
  MediaDetailsDto,
  MediaDto,
  MediaPageResponse,
  MediaSearchFilters,
  MediaSearchResponse,
  QuarantineStatusFilter,
  QuarantineItemDto,
  SnapshotPointerDto,
  SourceDto,
  ToolsHealthDto
} from "./types";
import { OverviewSection } from "./sections/OverviewSection";
import { SourcesSection } from "./sections/SourcesSection";
import { AlbumsSection } from "./sections/AlbumsSection";
import { MediaSection } from "./sections/MediaSection";
import { QuarantineSection } from "./sections/QuarantineSection";
import { DuplicatesSection } from "./sections/DuplicatesSection";
import { JobsSection } from "./sections/JobsSection";
import { SystemSection } from "./sections/SystemSection";

type MessageState = { type: "success" | "error" | "info"; text: string } | null;

const AUTH_STORAGE_KEY = "fmv_api_token";

const INITIAL_SEARCH_FILTERS: MediaSearchFilters = {
  kind: "",
  mimeType: "",
  sourceId: "",
  duplicateLevel: "",
  cameraModel: "",
  takenDay: "",
  gpsTile: "",
  sha256Prefix: "",
  sort: "takenAt_desc"
};

const MEDIA_PAGE_LIMIT = 50;
const ALBUM_CATALOG_LIMIT = 500;

export default function DevConsoleApp() {
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem(AUTH_STORAGE_KEY) ?? "");
  const [message, setMessage] = useState<MessageState>(null);

  const [sources, setSources] = useState<SourceDto[]>([]);
  const [sourcePathInput, setSourcePathInput] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourcesLoading, setSourcesLoading] = useState(false);

  const [albums, setAlbums] = useState<AlbumDto[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [selectedAlbumId, setSelectedAlbumId] = useState("");
  const [albumDraftName, setAlbumDraftName] = useState("");
  const [albumDraftMediaIds, setAlbumDraftMediaIds] = useState<string[]>([]);
  const [albumMediaCatalog, setAlbumMediaCatalog] = useState<MediaDto[]>([]);
  const [albumMediaCatalogTotal, setAlbumMediaCatalogTotal] = useState(0);
  const [albumMediaQuery, setAlbumMediaQuery] = useState("");
  const [albumCatalogLoading, setAlbumCatalogLoading] = useState(false);

  const [mediaPage, setMediaPage] = useState<MediaPageResponse | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaDetails, setMediaDetails] = useState<MediaDetailsDto | null>(null);
  const [mediaSearchFilters, setMediaSearchFilters] = useState<MediaSearchFilters>(INITIAL_SEARCH_FILTERS);
  const [mediaSearchResult, setMediaSearchResult] = useState<MediaSearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);

  const [quarantineFilter, setQuarantineFilter] = useState<QuarantineStatusFilter>("pending");
  const [quarantineItems, setQuarantineItems] = useState<QuarantineItemDto[]>([]);
  const [quarantineLoading, setQuarantineLoading] = useState(false);
  const [selectedQuarantine, setSelectedQuarantine] = useState<QuarantineItemDto | null>(null);
  const [quarantineAcceptMediaId, setQuarantineAcceptMediaId] = useState("");
  const [quarantineRejectReason, setQuarantineRejectReason] = useState("");

  const [duplicateLevelFilter, setDuplicateLevelFilter] = useState<DuplicateLevelFilter>("");
  const [duplicateLinks, setDuplicateLinks] = useState<DuplicateLinkDto[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);

  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  const [toolsHealth, setToolsHealth] = useState<ToolsHealthDto | null>(null);
  const [snapshotPointer, setSnapshotPointer] = useState<SnapshotPointerDto | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);

  useEffect(() => {
    if (authToken.trim()) {
      localStorage.setItem(AUTH_STORAGE_KEY, authToken.trim());
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [authToken]);

  const metrics = useMemo(
    () =>
      buildAppMetrics({
        sourcesCount: sources.length,
        albumsCount: albums.length,
        mediaTotal: mediaPage?.total ?? 0,
        duplicateLinksCount: duplicateLinks.length,
        quarantineItems,
        jobs
      }),
    [albums.length, duplicateLinks.length, jobs, mediaPage?.total, quarantineItems, sources.length]
  );

  const selectedAlbum = useMemo(
    () => albums.find((album) => album.albumId === selectedAlbumId) ?? null,
    [albums, selectedAlbumId]
  );

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ value: source.sourceId, label: `${source.sourceId} — ${source.path}` })),
    [sources]
  );

  const availableMediaForAlbum = useMemo(
    () => filterAvailableMedia(albumMediaCatalog, albumDraftMediaIds, albumMediaQuery, 120),
    [albumDraftMediaIds, albumMediaCatalog, albumMediaQuery]
  );

  const selectedMediaIdSet = useMemo(() => toSelectedSet(selectedMediaIds), [selectedMediaIds]);

  const clearMessage = useCallback(() => {
    setMessage(null);
  }, []);

  const showSuccess = useCallback((text: string) => setMessage({ type: "success", text }), []);
  const showError = useCallback((text: string) => setMessage({ type: "error", text }), []);

  const loadSourcesData = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const data = await getSources(authToken);
      setSources(data);
      if (data.length === 0) {
        setSelectedSourceId("");
      } else if (!selectedSourceId || !data.some((item) => item.sourceId === selectedSourceId)) {
        const firstSource = data[0];
        if (firstSource) {
          setSelectedSourceId(firstSource.sourceId);
        }
      }
    } catch (error) {
      showError(`Sources: ${asErrorMessage(error)}`);
    } finally {
      setSourcesLoading(false);
    }
  }, [authToken, selectedSourceId, showError]);

  const loadAlbumsData = useCallback(async () => {
    setAlbumsLoading(true);
    try {
      const data = await getAlbums(authToken);
      setAlbums(data);
      if (data.length === 0) {
        setSelectedAlbumId("");
        setAlbumDraftName("");
        setAlbumDraftMediaIds([]);
        return;
      }

      const selected = data.find((item) => item.albumId === selectedAlbumId) ?? data[0];
      if (selected) {
        setSelectedAlbumId(selected.albumId);
        setAlbumDraftName(selected.name);
        setAlbumDraftMediaIds(uniqueMediaIds(selected.mediaIds));
      }
    } catch (error) {
      showError(`Albums: ${asErrorMessage(error)}`);
    } finally {
      setAlbumsLoading(false);
    }
  }, [authToken, selectedAlbumId, showError]);

  const loadMediaPageData = useCallback(
    async (offset = 0) => {
      setMediaLoading(true);
      try {
        const data = await getMediaPage(authToken, MEDIA_PAGE_LIMIT, offset);
        setMediaPage(data);
        if (offset !== data.offset) {
          setMediaPage((prev) => (prev ? { ...prev, offset: data.offset } : data));
        }
      } catch (error) {
        showError(`Media: ${asErrorMessage(error)}`);
      } finally {
        setMediaLoading(false);
      }
    },
    [authToken, showError]
  );

  const loadAlbumMediaCatalog = useCallback(async () => {
    setAlbumCatalogLoading(true);
    try {
      const data = await getMediaPage(authToken, ALBUM_CATALOG_LIMIT, 0);
      setAlbumMediaCatalog(data.media);
      setAlbumMediaCatalogTotal(data.total);
    } catch (error) {
      showError(`Album media catalog: ${asErrorMessage(error)}`);
    } finally {
      setAlbumCatalogLoading(false);
    }
  }, [authToken, showError]);

  const loadJobsData = useCallback(async () => {
    setJobsLoading(true);
    try {
      const data = await getJobs(authToken);
      setJobs(data);
    } catch (error) {
      showError(`Jobs: ${asErrorMessage(error)}`);
    } finally {
      setJobsLoading(false);
    }
  }, [authToken, showError]);

  const loadQuarantineData = useCallback(async () => {
    setQuarantineLoading(true);
    try {
      const data = await getQuarantine(authToken, quarantineFilter || undefined);
      setQuarantineItems(data);
      if (data.length === 0) {
        setSelectedQuarantine(null);
      } else if (!selectedQuarantine || !data.some((item) => item.quarantineId === selectedQuarantine.quarantineId)) {
        setSelectedQuarantine(data[0] ?? null);
      }
    } catch (error) {
      showError(`Quarantine: ${asErrorMessage(error)}`);
    } finally {
      setQuarantineLoading(false);
    }
  }, [authToken, quarantineFilter, selectedQuarantine, showError]);

  const loadDuplicatesData = useCallback(async () => {
    setDuplicatesLoading(true);
    try {
      const data = await getDuplicateLinks(authToken, duplicateLevelFilter || undefined);
      setDuplicateLinks(data);
    } catch (error) {
      showError(`Duplicates: ${asErrorMessage(error)}`);
    } finally {
      setDuplicatesLoading(false);
    }
  }, [authToken, duplicateLevelFilter, showError]);

  const loadSystemData = useCallback(async () => {
    setSystemLoading(true);
    try {
      const [health, pointer] = await Promise.all([getToolsHealth(authToken), getSnapshotPointer(authToken)]);
      setToolsHealth(health);
      setSnapshotPointer(pointer);
    } catch (error) {
      showError(`System: ${asErrorMessage(error)}`);
    } finally {
      setSystemLoading(false);
    }
  }, [authToken, showError]);

  const refreshAll = useCallback(async () => {
    clearMessage();
    await Promise.all([
      loadSourcesData(),
      loadAlbumsData(),
      loadMediaPageData(0),
      loadJobsData(),
      loadQuarantineData(),
      loadDuplicatesData(),
      loadSystemData(),
      loadAlbumMediaCatalog()
    ]);
  }, [
    clearMessage,
    loadAlbumMediaCatalog,
    loadAlbumsData,
    loadDuplicatesData,
    loadJobsData,
    loadMediaPageData,
    loadQuarantineData,
    loadSourcesData,
    loadSystemData
  ]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadJobsData();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadJobsData]);

  useEffect(() => {
    if (activeSection === "albums" && albumMediaCatalog.length === 0) {
      void loadAlbumMediaCatalog();
    }
  }, [activeSection, albumMediaCatalog.length, loadAlbumMediaCatalog]);

  useEffect(() => {
    if (!selectedAlbum) {
      return;
    }
    setAlbumDraftName(selectedAlbum.name);
    setAlbumDraftMediaIds(uniqueMediaIds(selectedAlbum.mediaIds));
  }, [selectedAlbum]);

  const handleAddSource = useCallback(async () => {
    const path = sourcePathInput.trim();
    if (!path) {
      showError("Укажи путь источника");
      return;
    }
    try {
      await createSource(authToken, { path });
      setSourcePathInput("");
      showSuccess("Источник добавлен");
      await Promise.all([loadSourcesData(), loadJobsData()]);
    } catch (error) {
      showError(`Add source: ${asErrorMessage(error)}`);
    }
  }, [authToken, loadJobsData, loadSourcesData, showError, showSuccess, sourcePathInput]);

  const handleBrowseSource = useCallback(async () => {
    try {
      const selectedPath = await pickSourcePath(authToken);
      if (selectedPath) {
        setSourcePathInput(selectedPath);
      }
    } catch (error) {
      showError(`Browse source: ${asErrorMessage(error)}`);
    }
  }, [authToken, showError]);

  const handleScanSource = useCallback(async () => {
    if (!selectedSourceId) {
      showError("Выбери источник для сканирования");
      return;
    }
    try {
      await scanSource(authToken, selectedSourceId);
      showSuccess("Задача сканирования поставлена в очередь");
      await loadJobsData();
    } catch (error) {
      showError(`Scan source: ${asErrorMessage(error)}`);
    }
  }, [authToken, loadJobsData, selectedSourceId, showError, showSuccess]);

  const handleScanSourceById = useCallback(
    async (sourceId: string) => {
      try {
        await scanSource(authToken, sourceId);
        showSuccess("Задача сканирования поставлена в очередь");
        await loadJobsData();
      } catch (error) {
        showError(`Scan source: ${asErrorMessage(error)}`);
      }
    },
    [authToken, loadJobsData, showError, showSuccess]
  );

  const handleDeleteSource = useCallback(
    async (sourceId: string) => {
      const source = sources.find((item) => item.sourceId === sourceId);
      const label = source?.path ?? sourceId;
      const allowed = window.confirm(`Удалить источник?\n${label}`);
      if (!allowed) {
        return;
      }
      try {
        await removeSource(authToken, sourceId);
        showSuccess("Источник удалён");
        await Promise.all([loadSourcesData(), loadJobsData()]);
      } catch (error) {
        showError(`Delete source: ${asErrorMessage(error)}`);
      }
    },
    [authToken, loadJobsData, loadSourcesData, showError, showSuccess, sources]
  );

  const handleCreateAlbum = useCallback(async () => {
    const name = newAlbumName.trim();
    if (!name) {
      showError("Имя альбома обязательно");
      return;
    }
    try {
      const album = await createAlbum(authToken, { name, mediaIds: [] });
      setNewAlbumName("");
      showSuccess("Альбом создан");
      await loadAlbumsData();
      setSelectedAlbumId(album.albumId);
    } catch (error) {
      showError(`Create album: ${asErrorMessage(error)}`);
    }
  }, [authToken, loadAlbumsData, newAlbumName, showError, showSuccess]);

  const handleSaveAlbum = useCallback(async () => {
    if (!selectedAlbumId) {
      showError("Выбери альбом");
      return;
    }
    if (!albumDraftName.trim()) {
      showError("Имя альбома обязательно");
      return;
    }
    try {
      await updateAlbum(authToken, selectedAlbumId, {
        name: albumDraftName.trim(),
        mediaIds: uniqueMediaIds(albumDraftMediaIds)
      });
      showSuccess("Альбом обновлён");
      await loadAlbumsData();
    } catch (error) {
      showError(`Save album: ${asErrorMessage(error)}`);
    }
  }, [authToken, albumDraftMediaIds, albumDraftName, loadAlbumsData, selectedAlbumId, showError, showSuccess]);

  const handleDeleteAlbum = useCallback(async () => {
    if (!selectedAlbumId) {
      showError("Выбери альбом");
      return;
    }
    const albumName = selectedAlbum?.name ?? selectedAlbumId;
    const allowed = window.confirm(`Удалить альбом?\n${albumName}`);
    if (!allowed) {
      return;
    }
    try {
      await removeAlbum(authToken, selectedAlbumId);
      showSuccess("Альбом удалён");
      await loadAlbumsData();
    } catch (error) {
      showError(`Delete album: ${asErrorMessage(error)}`);
    }
  }, [authToken, loadAlbumsData, selectedAlbum, selectedAlbumId, showError, showSuccess]);

  const handleAlbumAddMedia = useCallback((mediaId: string) => {
    setAlbumDraftMediaIds((prev) => uniqueMediaIds([...prev, mediaId]));
  }, []);

  const handleAlbumRemoveMedia = useCallback((mediaId: string) => {
    setAlbumDraftMediaIds((prev) => prev.filter((item) => item !== mediaId));
  }, []);

  const handleMediaToggleSelection = useCallback((mediaId: string, checked: boolean) => {
    setSelectedMediaIds((prev) => {
      if (checked) {
        return uniqueMediaIds([...prev, mediaId]);
      }
      return prev.filter((item) => item !== mediaId);
    });
  }, []);

  const handleAddSelectedMediaToAlbum = useCallback(async () => {
    if (!selectedAlbumId) {
      showError("Сначала выбери альбом");
      return;
    }
    if (selectedMediaIds.length === 0) {
      showError("Выбери медиа в разделе Media");
      return;
    }
    const merged = uniqueMediaIds([...albumDraftMediaIds, ...selectedMediaIds]);
    setAlbumDraftMediaIds(merged);
    showSuccess(`Добавлено ${selectedMediaIds.length} медиа в draft альбома`);
    setActiveSection("albums");
  }, [albumDraftMediaIds, selectedAlbumId, selectedMediaIds, showError, showSuccess]);

  const handleLoadMediaDetails = useCallback(
    async (mediaId: string) => {
      try {
        const data = await getMediaDetails(authToken, mediaId);
        setMediaDetails(data);
      } catch (error) {
        showError(`Media details: ${asErrorMessage(error)}`);
      }
    },
    [authToken, showError]
  );

  const handleMediaSearch = useCallback(
    async (cursor?: string) => {
      if (!hasSearchFilters(mediaSearchFilters)) {
        showError("Добавь хотя бы один фильтр для media/search");
        return;
      }
      setSearchLoading(true);
      try {
        const data = await searchMedia(authToken, mediaSearchFilters, cursor);
        setMediaSearchResult(data);
      } catch (error) {
        showError(`Media search: ${asErrorMessage(error)}`);
      } finally {
        setSearchLoading(false);
      }
    },
    [authToken, mediaSearchFilters, showError]
  );

  const handleMediaResetSearch = useCallback(() => {
    setMediaSearchFilters(INITIAL_SEARCH_FILTERS);
    setMediaSearchResult(null);
  }, []);

  const handleMediaPageShift = useCallback(
    async (direction: -1 | 1) => {
      const total = mediaPage?.total ?? 0;
      const current = mediaPage?.offset ?? 0;
      const nextOffset = Math.max(0, current + direction * MEDIA_PAGE_LIMIT);
      if (nextOffset >= total && direction > 0) {
        return;
      }
      await loadMediaPageData(nextOffset);
    },
    [loadMediaPageData, mediaPage?.offset, mediaPage?.total]
  );

  const handleSelectQuarantine = useCallback(
    async (quarantineId: string) => {
      try {
        const data = await getQuarantineItem(authToken, quarantineId);
        setSelectedQuarantine(data);
        setQuarantineAcceptMediaId(data.candidateMediaIds[0] ?? "");
      } catch (error) {
        showError(`Quarantine details: ${asErrorMessage(error)}`);
      }
    },
    [authToken, showError]
  );

  const handleAcceptQuarantine = useCallback(async () => {
    if (!selectedQuarantine || !quarantineAcceptMediaId) {
      showError("Выбери candidate media");
      return;
    }
    try {
      await acceptQuarantine(authToken, selectedQuarantine.quarantineId, quarantineAcceptMediaId);
      showSuccess("Quarantine accepted");
      await Promise.all([loadQuarantineData(), loadJobsData()]);
      await handleSelectQuarantine(selectedQuarantine.quarantineId);
    } catch (error) {
      showError(`Accept quarantine: ${asErrorMessage(error)}`);
    }
  }, [
    authToken,
    handleSelectQuarantine,
    loadJobsData,
    loadQuarantineData,
    quarantineAcceptMediaId,
    selectedQuarantine,
    showError,
    showSuccess
  ]);

  const handleRejectQuarantine = useCallback(async () => {
    if (!selectedQuarantine) {
      showError("Выбери quarantine item");
      return;
    }
    try {
      await rejectQuarantine(authToken, selectedQuarantine.quarantineId, quarantineRejectReason || undefined);
      showSuccess("Quarantine rejected");
      setQuarantineRejectReason("");
      await Promise.all([loadQuarantineData(), loadJobsData()]);
      await handleSelectQuarantine(selectedQuarantine.quarantineId);
    } catch (error) {
      showError(`Reject quarantine: ${asErrorMessage(error)}`);
    }
  }, [
    authToken,
    handleSelectQuarantine,
    loadJobsData,
    loadQuarantineData,
    quarantineRejectReason,
    selectedQuarantine,
    showError,
    showSuccess
  ]);

  const handleCreateSnapshot = useCallback(async () => {
    try {
      const pointer = await createSnapshot(authToken);
      setSnapshotPointer(pointer);
      showSuccess(`Snapshot created at WAL seq ${pointer.walSeq}`);
    } catch (error) {
      showError(`Snapshot: ${asErrorMessage(error)}`);
    }
  }, [authToken, showError, showSuccess]);

  const renderOverview = () => (
    <OverviewSection metrics={metrics} onRefreshAll={() => void refreshAll()} />
  );

  const renderSources = () => (
    <SourcesSection
      sources={sources}
      sourcesLoading={sourcesLoading}
      sourcePathInput={sourcePathInput}
      selectedSourceId={selectedSourceId}
      onSourcePathChange={setSourcePathInput}
      onBrowseSource={() => {
        void handleBrowseSource();
      }}
      onAddSource={() => {
        void handleAddSource();
      }}
      onScanSelected={() => {
        void handleScanSource();
      }}
      onSelectSource={setSelectedSourceId}
      onScanSource={(sourceId) => {
        void handleScanSourceById(sourceId);
      }}
      onDeleteSource={(sourceId) => {
        void handleDeleteSource(sourceId);
      }}
      formatDate={formatDate}
    />
  );

  const renderMedia = () => (
    <MediaSection
      mediaPage={mediaPage}
      mediaSearchResult={mediaSearchResult}
      mediaSearchFilters={mediaSearchFilters}
      sourceOptions={sourceOptions}
      selectedMediaIds={selectedMediaIds}
      selectedMediaIdSet={selectedMediaIdSet}
      mediaDetails={mediaDetails}
      mediaLoading={mediaLoading}
      searchLoading={searchLoading}
      pageLimit={MEDIA_PAGE_LIMIT}
      setMediaSearchFilters={setMediaSearchFilters}
      onLoadMediaDetails={(mediaId) => {
        void handleLoadMediaDetails(mediaId);
      }}
      onMediaToggleSelection={handleMediaToggleSelection}
      onMediaSearch={(cursor) => {
        void handleMediaSearch(cursor);
      }}
      onMediaResetSearch={handleMediaResetSearch}
      onRefreshPage={() => {
        void loadMediaPageData(mediaPage?.offset ?? 0);
      }}
      onAddSelectedMediaToAlbum={() => {
        void handleAddSelectedMediaToAlbum();
      }}
      onMediaPageShift={(direction) => {
        void handleMediaPageShift(direction);
      }}
      formatBytes={formatBytes}
      formatDate={formatDate}
    />
  );

  const renderAlbums = () => (
    <AlbumsSection
      albums={albums}
      albumsLoading={albumsLoading}
      newAlbumName={newAlbumName}
      selectedAlbumId={selectedAlbumId}
      selectedAlbum={selectedAlbum}
      albumDraftName={albumDraftName}
      albumDraftMediaIds={albumDraftMediaIds}
      albumMediaCatalog={albumMediaCatalog}
      albumMediaCatalogTotal={albumMediaCatalogTotal}
      albumMediaQuery={albumMediaQuery}
      albumCatalogLoading={albumCatalogLoading}
      availableMediaForAlbum={availableMediaForAlbum}
      onNewAlbumNameChange={setNewAlbumName}
      onCreateAlbum={() => {
        void handleCreateAlbum();
      }}
      onSelectAlbum={setSelectedAlbumId}
      onReloadMediaCatalog={() => {
        void loadAlbumMediaCatalog();
      }}
      onSaveAlbum={() => {
        void handleSaveAlbum();
      }}
      onDeleteAlbum={() => {
        void handleDeleteAlbum();
      }}
      onAlbumDraftNameChange={setAlbumDraftName}
      onAlbumRemoveMedia={handleAlbumRemoveMedia}
      onAlbumMediaQueryChange={setAlbumMediaQuery}
      onAlbumAddMedia={handleAlbumAddMedia}
      formatBytes={formatBytes}
    />
  );

  const renderQuarantine = () => (
    <QuarantineSection
      quarantineFilter={quarantineFilter}
      quarantineItems={quarantineItems}
      quarantineLoading={quarantineLoading}
      selectedQuarantine={selectedQuarantine}
      quarantineAcceptMediaId={quarantineAcceptMediaId}
      quarantineRejectReason={quarantineRejectReason}
      onQuarantineFilterChange={setQuarantineFilter}
      onReload={() => {
        void loadQuarantineData();
      }}
      onSelectQuarantine={(quarantineId) => {
        void handleSelectQuarantine(quarantineId);
      }}
      onAcceptMediaIdChange={setQuarantineAcceptMediaId}
      onAccept={() => {
        void handleAcceptQuarantine();
      }}
      onRejectReasonChange={setQuarantineRejectReason}
      onReject={() => {
        void handleRejectQuarantine();
      }}
    />
  );

  const renderDuplicates = () => (
    <DuplicatesSection
      duplicateLevelFilter={duplicateLevelFilter}
      duplicateLinks={duplicateLinks}
      duplicatesLoading={duplicatesLoading}
      onDuplicateLevelChange={setDuplicateLevelFilter}
      onReload={() => {
        void loadDuplicatesData();
      }}
    />
  );

  const renderJobs = () => (
    <JobsSection
      jobs={jobs}
      jobsLoading={jobsLoading}
      onReload={() => {
        void loadJobsData();
      }}
      formatDate={formatDate}
    />
  );

  const renderSystem = () => (
    <SystemSection
      toolsHealth={toolsHealth}
      snapshotPointer={snapshotPointer}
      systemLoading={systemLoading}
      onReload={() => {
        void loadSystemData();
      }}
      onCreateSnapshot={() => {
        void handleCreateSnapshot();
      }}
      formatDate={formatDate}
    />
  );

  const renderCurrentSection = () => {
    switch (activeSection) {
      case "overview":
        return renderOverview();
      case "sources":
        return renderSources();
      case "media":
        return renderMedia();
      case "albums":
        return renderAlbums();
      case "quarantine":
        return renderQuarantine();
      case "duplicates":
        return renderDuplicates();
      case "jobs":
        return renderJobs();
      case "system":
        return renderSystem();
      default:
        return renderOverview();
    }
  };

  return (
    <AppShell
      padding="md"
      navbar={{ width: 240, breakpoint: "sm" }}
      header={{ height: 72 }}
    >
      <AppShell.Header>
        <Group justify="space-between" h="100%" px="md">
          <Group>
            <Title order={3}>Family Media Vault — Dev Console v2</Title>
            <Badge color="blue" variant="filled">
              Mantine
            </Badge>
          </Group>
          <Group align="end">
            <TextInput
              label="Auth token"
              placeholder="AUTH_TOKEN"
              value={authToken}
              onChange={(event) => setAuthToken(event.currentTarget.value)}
              w={280}
            />
            <Button variant="light" onClick={() => void refreshAll()}>
              Refresh all
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap="xs">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              label={item.label}
              active={activeSection === item.key}
              onClick={() => setActiveSection(item.key)}
            />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Stack gap="md">
          {message ? (
            <Alert
              color={message.type === "error" ? "red" : message.type === "success" ? "green" : "blue"}
              withCloseButton
              onClose={clearMessage}
            >
              {message.text}
            </Alert>
          ) : null}

          {renderCurrentSection()}
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
