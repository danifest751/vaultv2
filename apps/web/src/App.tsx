import { useMemo, useState } from "react";
import {
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title
} from "@mantine/core";

type SourceDto = {
  sourceId: string;
  path: string;
  recursive: boolean;
  includeArchives: boolean;
  createdAt: number;
};

type MediaDto = {
  mediaId: string;
  sha256: string;
  size: number;
  sourceEntryId: string;
};

type SearchResponse = {
  media: MediaDto[];
  total: number;
  nextCursor: string | null;
};

type SearchState = {
  kind: string;
  mimeType: string;
  sourceId: string;
  duplicateLevel: string;
  cameraModel: string;
  takenDay: string;
  gpsTile: string;
  sort: "mediaId_asc" | "takenAt_desc";
};

const INITIAL_SEARCH: SearchState = {
  kind: "",
  mimeType: "",
  sourceId: "",
  duplicateLevel: "",
  cameraModel: "",
  takenDay: "",
  gpsTile: "",
  sort: "takenAt_desc"
};

function authHeaders(token: string): HeadersInit {
  if (!token.trim()) {
    return {};
  }
  return { Authorization: `Bearer ${token.trim()}` };
}

function hasAtLeastOneFilter(search: SearchState): boolean {
  return Boolean(
    search.kind ||
      search.mimeType ||
      search.sourceId ||
      search.duplicateLevel ||
      search.cameraModel ||
      search.takenDay ||
      search.gpsTile
  );
}

export default function App() {
  const [authToken, setAuthToken] = useState("");
  const [sources, setSources] = useState<SourceDto[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [search, setSearch] = useState<SearchState>(INITIAL_SEARCH);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ value: source.sourceId, label: `${source.sourceId} — ${source.path}` })),
    [sources]
  );

  async function loadSources(): Promise<void> {
    setErrorMessage("");
    setSourcesLoading(true);
    try {
      const response = await fetch("/api/sources", { headers: authHeaders(authToken) });
      const body = (await response.json()) as { sources?: SourceDto[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setSources(body.sources ?? []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "failed_to_load_sources");
    } finally {
      setSourcesLoading(false);
    }
  }

  async function runSearch(cursor?: string): Promise<void> {
    if (!hasAtLeastOneFilter(search)) {
      setErrorMessage("Укажи хотя бы один фильтр поиска");
      return;
    }

    setErrorMessage("");
    setSearchLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("limit", "25");
      query.set("sort", search.sort);
      if (cursor) {
        query.set("cursor", cursor);
      }
      if (search.kind) query.set("kind", search.kind);
      if (search.mimeType) query.set("mimeType", search.mimeType);
      if (search.sourceId) query.set("sourceId", search.sourceId);
      if (search.duplicateLevel) query.set("duplicateLevel", search.duplicateLevel);
      if (search.cameraModel) query.set("cameraModel", search.cameraModel);
      if (search.takenDay) query.set("takenDay", search.takenDay);
      if (search.gpsTile) query.set("gpsTile", search.gpsTile);

      const response = await fetch(`/api/media/search?${query.toString()}`, {
        headers: authHeaders(authToken)
      });
      const body = (await response.json()) as SearchResponse & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setSearchResult(body);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "search_failed");
    } finally {
      setSearchLoading(false);
    }
  }

  return (
    <AppShell padding="md" header={{ height: 64 }}>
      <AppShell.Header>
        <Group justify="space-between" px="md" h="100%">
          <Group gap="sm">
            <Title order={3}>Family Media Vault</Title>
            <Badge color="yellow" variant="filled">
              Mantine UI
            </Badge>
          </Group>
          <Group>
            <TextInput
              placeholder="AUTH_TOKEN"
              value={authToken}
              onChange={(event) => setAuthToken(event.currentTarget.value)}
            />
            <Button variant="light" onClick={() => void loadSources()} loading={sourcesLoading}>
              Sources
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="md">
          {errorMessage ? (
            <Card withBorder radius="md" bg="red.0">
              <Text c="red.8" fw={600}>
                {errorMessage}
              </Text>
            </Card>
          ) : null}

          <Card withBorder radius="md" shadow="sm">
            <Stack gap="sm">
              <Title order={4}>Media Search (Stage F)</Title>
              <Group grow>
                <Select
                  label="Kind"
                  placeholder="Any"
                  value={search.kind || null}
                  onChange={(value) => setSearch((prev) => ({ ...prev, kind: value ?? "" }))}
                  data={[
                    { value: "photo", label: "photo" },
                    { value: "video", label: "video" },
                    { value: "unknown", label: "unknown" }
                  ]}
                />
                <TextInput
                  label="MIME"
                  placeholder="image/jpeg"
                  value={search.mimeType}
                  onChange={(event) => setSearch((prev) => ({ ...prev, mimeType: event.currentTarget.value }))}
                />
                <Select
                  label="Source"
                  placeholder="Any"
                  value={search.sourceId || null}
                  onChange={(value) => setSearch((prev) => ({ ...prev, sourceId: value ?? "" }))}
                  data={sourceOptions}
                  searchable
                  clearable
                />
              </Group>

              <Group grow>
                <Select
                  label="Duplicate level"
                  placeholder="Any"
                  value={search.duplicateLevel || null}
                  onChange={(value) => setSearch((prev) => ({ ...prev, duplicateLevel: value ?? "" }))}
                  data={[
                    { value: "exact", label: "exact" },
                    { value: "strong", label: "strong" },
                    { value: "probable", label: "probable" }
                  ]}
                />
                <TextInput
                  label="Camera"
                  placeholder="Canon EOS R6"
                  value={search.cameraModel}
                  onChange={(event) => setSearch((prev) => ({ ...prev, cameraModel: event.currentTarget.value }))}
                />
                <TextInput
                  label="Taken day"
                  placeholder="YYYY-MM-DD"
                  value={search.takenDay}
                  onChange={(event) => setSearch((prev) => ({ ...prev, takenDay: event.currentTarget.value }))}
                />
                <TextInput
                  label="GPS tile"
                  placeholder="55.7:37.6"
                  value={search.gpsTile}
                  onChange={(event) => setSearch((prev) => ({ ...prev, gpsTile: event.currentTarget.value }))}
                />
              </Group>

              <Group justify="space-between">
                <Select
                  label="Sort"
                  value={search.sort}
                  onChange={(value) =>
                    setSearch((prev) => ({ ...prev, sort: (value as "mediaId_asc" | "takenAt_desc") ?? "takenAt_desc" }))
                  }
                  data={[
                    { value: "takenAt_desc", label: "takenAt_desc" },
                    { value: "mediaId_asc", label: "mediaId_asc" }
                  ]}
                  w={220}
                />
                <Group align="end">
                  <Button variant="default" onClick={() => setSearch(INITIAL_SEARCH)}>
                    Reset
                  </Button>
                  <Button onClick={() => void runSearch()} loading={searchLoading}>
                    Search
                  </Button>
                </Group>
              </Group>
            </Stack>
          </Card>

          <Card withBorder radius="md" shadow="sm">
            <Group justify="space-between" mb="sm">
              <Title order={5}>Results</Title>
              <Group gap="xs">
                {searchLoading ? <Loader size="sm" /> : null}
                <Badge variant="light">total: {searchResult?.total ?? 0}</Badge>
              </Group>
            </Group>

            <Box>
              <Table withTableBorder withColumnBorders striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>mediaId</Table.Th>
                    <Table.Th>sha256</Table.Th>
                    <Table.Th>size</Table.Th>
                    <Table.Th>sourceEntryId</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(searchResult?.media ?? []).map((item) => (
                    <Table.Tr key={item.mediaId}>
                      <Table.Td>
                        <Code>{item.mediaId}</Code>
                      </Table.Td>
                      <Table.Td>{item.sha256.slice(0, 16)}...</Table.Td>
                      <Table.Td>{item.size}</Table.Td>
                      <Table.Td>{item.sourceEntryId}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>

            <Group justify="flex-end" mt="md">
              <Button
                variant="light"
                onClick={() => void runSearch(searchResult?.nextCursor ?? undefined)}
                disabled={!searchResult?.nextCursor || searchLoading}
              >
                Next page
              </Button>
            </Group>
          </Card>

          <Card withBorder radius="md">
            <Text size="sm" c="dimmed">
              API proxy: <Code>/api/*</Code> - backend: <Code>http://localhost:3000</Code>
            </Text>
            <Text size="sm" c="dimmed">
              Для защищенного API укажи <Code>AUTH_TOKEN</Code> сверху.
            </Text>
          </Card>
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
