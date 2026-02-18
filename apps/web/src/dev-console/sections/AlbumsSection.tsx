import { Badge, Box, Button, Card, Flex, Group, Loader, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { AlbumDto, MediaDto } from "../types";

export interface AlbumsSectionProps {
  albums: AlbumDto[];
  albumsLoading: boolean;
  newAlbumName: string;
  selectedAlbumId: string;
  selectedAlbum: AlbumDto | null;
  albumDraftName: string;
  albumDraftMediaIds: string[];
  albumMediaCatalog: MediaDto[];
  albumMediaCatalogTotal: number;
  albumMediaQuery: string;
  albumCatalogLoading: boolean;
  availableMediaForAlbum: MediaDto[];
  onNewAlbumNameChange: (value: string) => void;
  onCreateAlbum: () => void;
  onSelectAlbum: (albumId: string) => void;
  onReloadMediaCatalog: () => void;
  onSaveAlbum: () => void;
  onDeleteAlbum: () => void;
  onAlbumDraftNameChange: (value: string) => void;
  onAlbumRemoveMedia: (mediaId: string) => void;
  onAlbumMediaQueryChange: (value: string) => void;
  onAlbumAddMedia: (mediaId: string) => void;
  formatBytes: (value: number) => string;
}

export function AlbumsSection({
  albums,
  albumsLoading,
  newAlbumName,
  selectedAlbumId,
  selectedAlbum,
  albumDraftName,
  albumDraftMediaIds,
  albumMediaCatalog,
  albumMediaCatalogTotal,
  albumMediaQuery,
  albumCatalogLoading,
  availableMediaForAlbum,
  onNewAlbumNameChange,
  onCreateAlbum,
  onSelectAlbum,
  onReloadMediaCatalog,
  onSaveAlbum,
  onDeleteAlbum,
  onAlbumDraftNameChange,
  onAlbumRemoveMedia,
  onAlbumMediaQueryChange,
  onAlbumAddMedia,
  formatBytes
}: AlbumsSectionProps) {
  const albumOptions = albums.map((album) => ({
    value: album.albumId,
    label: `${album.name} (${album.mediaIds.length})`
  }));

  return (
    <Flex gap="md" align="flex-start" wrap="wrap">
      <Card withBorder style={{ flex: "1 1 320px", minWidth: 320 }}>
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>Albums</Title>
            {albumsLoading ? <Loader size="sm" /> : null}
          </Group>
          <Group align="end" wrap="nowrap">
            <TextInput
              label="New album"
              placeholder="Family 2025"
              value={newAlbumName}
              onChange={(event) => onNewAlbumNameChange(event.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button onClick={onCreateAlbum}>Create</Button>
          </Group>
          <Select
            label="Select album"
            data={albumOptions}
            value={selectedAlbumId || null}
            onChange={(value) => onSelectAlbum(value ?? "")}
            searchable
          />
          <Stack gap="xs">
            {albums.map((album) => (
              <Card
                key={album.albumId}
                withBorder
                padding="sm"
                style={{ cursor: "pointer", borderColor: album.albumId === selectedAlbumId ? "#228be6" : undefined }}
                onClick={() => onSelectAlbum(album.albumId)}
              >
                <Group justify="space-between">
                  <Text fw={600}>{album.name}</Text>
                  <Badge variant="light">{album.mediaIds.length}</Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {album.albumId}
                </Text>
              </Card>
            ))}
          </Stack>
        </Stack>
      </Card>

      <Card withBorder style={{ flex: "2 1 620px", minWidth: 620 }}>
        {selectedAlbum ? (
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={4}>Album editor</Title>
              <Group>
                <Button variant="light" onClick={onReloadMediaCatalog} loading={albumCatalogLoading}>
                  Reload media catalog
                </Button>
                <Button onClick={onSaveAlbum}>Save album</Button>
                <Button color="red" variant="light" onClick={onDeleteAlbum}>
                  Delete album
                </Button>
              </Group>
            </Group>

            <TextInput
              label="Album name"
              value={albumDraftName}
              onChange={(event) => onAlbumDraftNameChange(event.currentTarget.value)}
            />

            <Card withBorder>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text fw={600}>Selected media</Text>
                  <Badge variant="light">{albumDraftMediaIds.length}</Badge>
                </Group>
                <Group gap="xs">
                  {albumDraftMediaIds.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Нет выбранных медиа.
                    </Text>
                  ) : (
                    albumDraftMediaIds.map((mediaId) => (
                      <Badge
                        key={mediaId}
                        variant="filled"
                        rightSection={
                          <Box
                            component="button"
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "inherit",
                              cursor: "pointer",
                              padding: 0
                            }}
                            onClick={() => onAlbumRemoveMedia(mediaId)}
                          >
                            ×
                          </Box>
                        }
                      >
                        {mediaId}
                      </Badge>
                    ))
                  )}
                </Group>
              </Stack>
            </Card>

            <Card withBorder>
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>Add media to album</Text>
                  <Text size="xs" c="dimmed">
                    loaded {albumMediaCatalog.length}
                    {albumMediaCatalogTotal > albumMediaCatalog.length ? ` of ${albumMediaCatalogTotal}` : ""}
                  </Text>
                </Group>
                <TextInput
                  placeholder="Search mediaId or sha256"
                  value={albumMediaQuery}
                  onChange={(event) => onAlbumMediaQueryChange(event.currentTarget.value)}
                />
                <Table withTableBorder withColumnBorders striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>mediaId</Table.Th>
                      <Table.Th>sha256</Table.Th>
                      <Table.Th>size</Table.Th>
                      <Table.Th>action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {availableMediaForAlbum.map((item) => (
                      <Table.Tr key={item.mediaId}>
                        <Table.Td>{item.mediaId}</Table.Td>
                        <Table.Td>{item.sha256.slice(0, 12)}...</Table.Td>
                        <Table.Td>{formatBytes(item.size)}</Table.Td>
                        <Table.Td>
                          <Button size="xs" variant="light" onClick={() => onAlbumAddMedia(item.mediaId)}>
                            Add
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Card>
          </Stack>
        ) : (
          <Text c="dimmed">Выбери альбом для редактирования</Text>
        )}
      </Card>
    </Flex>
  );
}
