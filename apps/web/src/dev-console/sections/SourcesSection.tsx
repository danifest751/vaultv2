import { Button, Card, Checkbox, Code, Group, Loader, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { SourceDto } from "../types";

export interface SourcesSectionProps {
  sources: SourceDto[];
  sourcesLoading: boolean;
  sourcePathInput: string;
  selectedSourceId: string;
  onSourcePathChange: (value: string) => void;
  onBrowseSource: () => void;
  onAddSource: () => void;
  onScanSelected: () => void;
  onSelectSource: (sourceId: string) => void;
  onScanSource: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => void;
  formatDate: (value?: number) => string;
}

export function SourcesSection({
  sources,
  sourcesLoading,
  sourcePathInput,
  selectedSourceId,
  onSourcePathChange,
  onBrowseSource,
  onAddSource,
  onScanSelected,
  onSelectSource,
  onScanSource,
  onDeleteSource,
  formatDate
}: SourcesSectionProps) {
  return (
    <Stack gap="md">
      <Card withBorder>
        <Stack gap="sm">
          <Title order={4}>Sources</Title>
          <Group wrap="nowrap" align="end">
            <TextInput
              label="Path"
              placeholder="C:\\Photos"
              value={sourcePathInput}
              onChange={(event) => onSourcePathChange(event.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button variant="default" onClick={onBrowseSource}>
              Browse
            </Button>
            <Button onClick={onAddSource}>Add source</Button>
            <Button variant="light" onClick={onScanSelected} disabled={!selectedSourceId}>
              Scan selected
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Registered sources</Text>
          {sourcesLoading ? <Loader size="sm" /> : null}
        </Group>
        <Table withTableBorder withColumnBorders striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Use</Table.Th>
              <Table.Th>sourceId</Table.Th>
              <Table.Th>path</Table.Th>
              <Table.Th>createdAt</Table.Th>
              <Table.Th>actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sources.map((source) => (
              <Table.Tr key={source.sourceId}>
                <Table.Td>
                  <Checkbox
                    checked={selectedSourceId === source.sourceId}
                    onChange={() => onSelectSource(source.sourceId)}
                    aria-label={`select-source-${source.sourceId}`}
                  />
                </Table.Td>
                <Table.Td>
                  <Code>{source.sourceId}</Code>
                </Table.Td>
                <Table.Td>{source.path}</Table.Td>
                <Table.Td>{formatDate(source.createdAt)}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Button size="xs" variant="light" onClick={() => onScanSource(source.sourceId)}>
                      Scan
                    </Button>
                    <Button size="xs" color="red" variant="light" onClick={() => onDeleteSource(source.sourceId)}>
                      Delete
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
