import { Button, Card, Code, Flex, Group, Loader, Select, Stack, Table, Text, Textarea, Title } from "@mantine/core";
import { QuarantineItemDto, QuarantineStatusFilter } from "../types";

export interface QuarantineSectionProps {
  quarantineFilter: QuarantineStatusFilter;
  quarantineItems: QuarantineItemDto[];
  quarantineLoading: boolean;
  selectedQuarantine: QuarantineItemDto | null;
  quarantineAcceptMediaId: string;
  quarantineRejectReason: string;
  onQuarantineFilterChange: (value: QuarantineStatusFilter) => void;
  onReload: () => void;
  onSelectQuarantine: (quarantineId: string) => void;
  onAcceptMediaIdChange: (mediaId: string) => void;
  onAccept: () => void;
  onRejectReasonChange: (value: string) => void;
  onReject: () => void;
}

export function QuarantineSection({
  quarantineFilter,
  quarantineItems,
  quarantineLoading,
  selectedQuarantine,
  quarantineAcceptMediaId,
  quarantineRejectReason,
  onQuarantineFilterChange,
  onReload,
  onSelectQuarantine,
  onAcceptMediaIdChange,
  onAccept,
  onRejectReasonChange,
  onReject
}: QuarantineSectionProps) {
  return (
    <Flex gap="md" align="flex-start" wrap="wrap">
      <Card withBorder style={{ flex: "1 1 420px", minWidth: 420 }}>
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>Quarantine queue</Title>
            {quarantineLoading ? <Loader size="sm" /> : null}
          </Group>
          <Group>
            <Select
              label="Status"
              data={[
                { value: "pending", label: "pending" },
                { value: "accepted", label: "accepted" },
                { value: "rejected", label: "rejected" }
              ]}
              value={quarantineFilter || null}
              onChange={(value) => onQuarantineFilterChange((value as QuarantineStatusFilter | null) ?? "pending")}
              w={220}
            />
            <Button mt={24} variant="light" onClick={onReload}>
              Reload
            </Button>
          </Group>
          <Table withTableBorder withColumnBorders striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>quarantineId</Table.Th>
                <Table.Th>status</Table.Th>
                <Table.Th>sourceEntryId</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {quarantineItems.map((item) => (
                <Table.Tr
                  key={item.quarantineId}
                  onClick={() => onSelectQuarantine(item.quarantineId)}
                  style={{ cursor: "pointer" }}
                >
                  <Table.Td>
                    <Code>{item.quarantineId}</Code>
                  </Table.Td>
                  <Table.Td>{item.status}</Table.Td>
                  <Table.Td>
                    <Code>{item.sourceEntryId}</Code>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>

      <Card withBorder style={{ flex: "1 1 520px", minWidth: 520 }}>
        <Title order={4} mb="sm">
          Quarantine detail
        </Title>
        {selectedQuarantine ? (
          <Stack gap="sm">
            <Text>
              id: <Code>{selectedQuarantine.quarantineId}</Code>
            </Text>
            <Text>
              status: <Code>{selectedQuarantine.status}</Code>
            </Text>
            <Text>
              sourceEntryId: <Code>{selectedQuarantine.sourceEntryId}</Code>
            </Text>
            <Text>
              candidates: <Code>{selectedQuarantine.candidateMediaIds.join(", ") || "-"}</Code>
            </Text>

            {selectedQuarantine.status === "pending" ? (
              <>
                <Select
                  label="Accept as mediaId"
                  data={selectedQuarantine.candidateMediaIds.map((value) => ({ value, label: value }))}
                  value={quarantineAcceptMediaId || null}
                  onChange={(value) => onAcceptMediaIdChange(value ?? "")}
                />
                <Group>
                  <Button onClick={onAccept}>Accept</Button>
                </Group>
                <Textarea
                  label="Reject reason"
                  placeholder="optional"
                  value={quarantineRejectReason}
                  onChange={(event) => onRejectReasonChange(event.currentTarget.value)}
                />
                <Group>
                  <Button color="red" variant="light" onClick={onReject}>
                    Reject
                  </Button>
                </Group>
              </>
            ) : null}
          </Stack>
        ) : (
          <Text c="dimmed">Выбери элемент из списка.</Text>
        )}
      </Card>
    </Flex>
  );
}
