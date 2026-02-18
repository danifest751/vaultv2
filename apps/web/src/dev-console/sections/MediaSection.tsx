import { Dispatch, SetStateAction } from "react";
import { Badge, Button, Card, Checkbox, Code, Group, Loader, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { computeMediaPageStats } from "../media/media-view-utils";
import { MediaDetailsDto, MediaDto, MediaPageResponse, MediaSearchFilters, MediaSearchResponse } from "../types";

export interface MediaSectionProps {
  mediaPage: MediaPageResponse | null;
  mediaSearchResult: MediaSearchResponse | null;
  mediaSearchFilters: MediaSearchFilters;
  sourceOptions: Array<{ value: string; label: string }>;
  selectedMediaIds: string[];
  selectedMediaIdSet: Set<string>;
  mediaDetails: MediaDetailsDto | null;
  mediaLoading: boolean;
  searchLoading: boolean;
  pageLimit: number;
  setMediaSearchFilters: Dispatch<SetStateAction<MediaSearchFilters>>;
  onLoadMediaDetails: (mediaId: string) => void;
  onMediaToggleSelection: (mediaId: string, checked: boolean) => void;
  onMediaSearch: (cursor?: string) => void;
  onMediaResetSearch: () => void;
  onRefreshPage: () => void;
  onAddSelectedMediaToAlbum: () => void;
  onMediaPageShift: (direction: -1 | 1) => void;
  formatBytes: (value: number) => string;
  formatDate: (value?: number) => string;
}

export function MediaSection({
  mediaPage,
  mediaSearchResult,
  mediaSearchFilters,
  sourceOptions,
  selectedMediaIds,
  selectedMediaIdSet,
  mediaDetails,
  mediaLoading,
  searchLoading,
  pageLimit,
  setMediaSearchFilters,
  onLoadMediaDetails,
  onMediaToggleSelection,
  onMediaSearch,
  onMediaResetSearch,
  onRefreshPage,
  onAddSelectedMediaToAlbum,
  onMediaPageShift,
  formatBytes,
  formatDate
}: MediaSectionProps) {
  const rows = mediaSearchResult?.media ?? mediaPage?.media ?? [];
  const pageOffset = mediaPage?.offset ?? 0;
  const pageTotal = mediaPage?.total ?? 0;
  const pageStats = computeMediaPageStats(pageTotal, pageOffset, pageLimit);

  return (
    <Stack gap="md">
      <Card withBorder>
        <Stack gap="sm">
          <Title order={4}>Media search</Title>
          <Group grow>
            <Select
              label="kind"
              placeholder="any"
              data={[
                { value: "photo", label: "photo" },
                { value: "video", label: "video" },
                { value: "unknown", label: "unknown" }
              ]}
              value={mediaSearchFilters.kind || null}
              onChange={(value) => setMediaSearchFilters((prev) => ({ ...prev, kind: value ?? "" }))}
              clearable
            />
            <TextInput
              label="mimeType"
              placeholder="image/jpeg"
              value={mediaSearchFilters.mimeType}
              onChange={(event) => setMediaSearchFilters((prev) => ({ ...prev, mimeType: event.currentTarget.value.trim() }))}
            />
            <Select
              label="sourceId"
              placeholder="any"
              data={sourceOptions}
              value={mediaSearchFilters.sourceId || null}
              onChange={(value) => setMediaSearchFilters((prev) => ({ ...prev, sourceId: value ?? "" }))}
              searchable
              clearable
            />
            <TextInput
              label="sha256Prefix"
              placeholder="2..64 hex"
              value={mediaSearchFilters.sha256Prefix}
              onChange={(event) =>
                setMediaSearchFilters((prev) => ({ ...prev, sha256Prefix: event.currentTarget.value.trim() }))
              }
            />
          </Group>
          <Group grow>
            <Select
              label="duplicateLevel"
              placeholder="any"
              data={[
                { value: "exact", label: "exact" },
                { value: "strong", label: "strong" },
                { value: "probable", label: "probable" }
              ]}
              value={mediaSearchFilters.duplicateLevel || null}
              onChange={(value) => setMediaSearchFilters((prev) => ({ ...prev, duplicateLevel: value ?? "" }))}
              clearable
            />
            <TextInput
              label="cameraModel"
              value={mediaSearchFilters.cameraModel}
              onChange={(event) =>
                setMediaSearchFilters((prev) => ({ ...prev, cameraModel: event.currentTarget.value.trim() }))
              }
            />
            <TextInput
              label="takenDay"
              placeholder="YYYY-MM-DD"
              value={mediaSearchFilters.takenDay}
              onChange={(event) => setMediaSearchFilters((prev) => ({ ...prev, takenDay: event.currentTarget.value.trim() }))}
            />
            <TextInput
              label="gpsTile"
              value={mediaSearchFilters.gpsTile}
              onChange={(event) => setMediaSearchFilters((prev) => ({ ...prev, gpsTile: event.currentTarget.value.trim() }))}
            />
          </Group>
          <Group justify="space-between">
            <Select
              label="sort"
              data={[
                { value: "takenAt_desc", label: "takenAt_desc" },
                { value: "mediaId_asc", label: "mediaId_asc" }
              ]}
              value={mediaSearchFilters.sort}
              onChange={(value) =>
                setMediaSearchFilters((prev) => ({
                  ...prev,
                  sort: (value as MediaSearchFilters["sort"] | null) ?? "takenAt_desc"
                }))
              }
              w={220}
            />
            <Group>
              <Button variant="default" onClick={onMediaResetSearch}>
                Reset filters
              </Button>
              <Button loading={searchLoading} onClick={() => onMediaSearch()}>
                Search
              </Button>
            </Group>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Group>
            <Text fw={600}>Media data</Text>
            <Badge variant="light">selected: {selectedMediaIds.length}</Badge>
          </Group>
          <Group>
            <Button size="xs" variant="light" onClick={onRefreshPage} loading={mediaLoading}>
              Refresh page
            </Button>
            <Button size="xs" variant="filled" onClick={onAddSelectedMediaToAlbum}>
              Add selected to album draft
            </Button>
          </Group>
        </Group>

        {mediaLoading && !rows.length ? (
          <Loader size="sm" />
        ) : (
          <Table withTableBorder withColumnBorders striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Select</Table.Th>
                <Table.Th>mediaId</Table.Th>
                <Table.Th>sha256</Table.Th>
                <Table.Th>size</Table.Th>
                <Table.Th>sourceEntryId</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((item: MediaDto) => (
                <Table.Tr key={item.mediaId} onClick={() => onLoadMediaDetails(item.mediaId)} style={{ cursor: "pointer" }}>
                  <Table.Td onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedMediaIdSet.has(item.mediaId)}
                      onChange={(event) => onMediaToggleSelection(item.mediaId, event.currentTarget.checked)}
                      aria-label={`select-media-${item.mediaId}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Code>{item.mediaId}</Code>
                  </Table.Td>
                  <Table.Td>{item.sha256.slice(0, 18)}...</Table.Td>
                  <Table.Td>{formatBytes(item.size)}</Table.Td>
                  <Table.Td>
                    <Code>{item.sourceEntryId}</Code>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Group justify="space-between" mt="md">
          <Group>
            <Text size="sm" c="dimmed">
              Page {pageStats.pageNumber}/{pageStats.pageCount} (total {pageTotal})
            </Text>
          </Group>
          {mediaSearchResult ? (
            <Button
              size="xs"
              variant="light"
              disabled={!mediaSearchResult.nextCursor || searchLoading}
              onClick={() => onMediaSearch(mediaSearchResult.nextCursor ?? undefined)}
            >
              Next search page
            </Button>
          ) : (
            <Group>
              <Button size="xs" variant="light" disabled={!pageStats.hasPrev} onClick={() => onMediaPageShift(-1)}>
                Prev
              </Button>
              <Button size="xs" variant="light" disabled={!pageStats.hasNext} onClick={() => onMediaPageShift(1)}>
                Next
              </Button>
            </Group>
          )}
        </Group>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">
          Media details
        </Title>
        {mediaDetails ? (
          <Stack gap="xs">
            <Text>
              mediaId: <Code>{mediaDetails.media.mediaId}</Code>
            </Text>
            <Text>
              size: <Code>{formatBytes(mediaDetails.media.size)}</Code>
            </Text>
            <Text>
              sourceEntryId: <Code>{mediaDetails.media.sourceEntryId}</Code>
            </Text>
            <Text>
              mime: <Code>{mediaDetails.metadata?.mimeType ?? "-"}</Code>
            </Text>
            <Text>
              takenAt: <Code>{formatDate(mediaDetails.metadata?.takenAt)}</Code>
            </Text>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Выбери строку media для деталей.
          </Text>
        )}
      </Card>
    </Stack>
  );
}
