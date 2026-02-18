import { Button, Card, Code, Group, Loader, Select, Stack, Table, Title } from "@mantine/core";
import { normalizeDuplicateLevelFilter } from "../duplicates/duplicate-filter-utils";
import { DuplicateLevelFilter, DuplicateLinkDto } from "../types";

export interface DuplicatesSectionProps {
  duplicateLevelFilter: DuplicateLevelFilter;
  duplicateLinks: DuplicateLinkDto[];
  duplicatesLoading: boolean;
  onDuplicateLevelChange: (value: DuplicateLevelFilter) => void;
  onReload: () => void;
}

export function DuplicatesSection({
  duplicateLevelFilter,
  duplicateLinks,
  duplicatesLoading,
  onDuplicateLevelChange,
  onReload
}: DuplicatesSectionProps) {
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>Duplicate links</Title>
          {duplicatesLoading ? <Loader size="sm" /> : null}
        </Group>
        <Group>
          <Select
            label="Level"
            data={[
              { value: "exact", label: "exact" },
              { value: "strong", label: "strong" },
              { value: "probable", label: "probable" }
            ]}
            value={duplicateLevelFilter || null}
            onChange={(value) => onDuplicateLevelChange(normalizeDuplicateLevelFilter(value))}
            clearable
            w={220}
          />
          <Button mt={24} variant="light" onClick={onReload}>
            Reload
          </Button>
        </Group>

        <Table withTableBorder withColumnBorders striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>duplicateLinkId</Table.Th>
              <Table.Th>level</Table.Th>
              <Table.Th>mediaId</Table.Th>
              <Table.Th>sourceEntryId</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {duplicateLinks.map((link) => (
              <Table.Tr key={link.duplicateLinkId}>
                <Table.Td>
                  <Code>{link.duplicateLinkId}</Code>
                </Table.Td>
                <Table.Td>{link.level}</Table.Td>
                <Table.Td>
                  <Code>{link.mediaId}</Code>
                </Table.Td>
                <Table.Td>
                  <Code>{link.sourceEntryId}</Code>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}
