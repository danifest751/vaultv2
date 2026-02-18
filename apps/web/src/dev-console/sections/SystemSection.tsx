import { Badge, Button, Card, Code, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { SnapshotPointerDto, ToolsHealthDto } from "../types";

export interface SystemSectionProps {
  toolsHealth: ToolsHealthDto | null;
  snapshotPointer: SnapshotPointerDto | null;
  systemLoading: boolean;
  onReload: () => void;
  onCreateSnapshot: () => void;
  formatDate: (value?: number) => string;
}

export function SystemSection({
  toolsHealth,
  snapshotPointer,
  systemLoading,
  onReload,
  onCreateSnapshot,
  formatDate
}: SystemSectionProps) {
  return (
    <Stack gap="md">
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={4}>Tools health</Title>
          <Group>
            {systemLoading ? <Loader size="sm" /> : null}
            <Button variant="light" onClick={onReload}>
              Reload
            </Button>
          </Group>
        </Group>
        {toolsHealth ? (
          <Stack gap="xs">
            <Text>
              checkedAt: <Code>{formatDate(toolsHealth.checkedAt)}</Code>
            </Text>
            <Group>
              <Badge color={toolsHealth.tools.exiftool ? "green" : "red"}>
                exiftool: {String(toolsHealth.tools.exiftool)}
              </Badge>
              <Badge color={toolsHealth.tools.ffprobe ? "green" : "red"}>
                ffprobe: {String(toolsHealth.tools.ffprobe)}
              </Badge>
              <Badge color={toolsHealth.tools.ffmpeg ? "green" : "red"}>
                ffmpeg: {String(toolsHealth.tools.ffmpeg)}
              </Badge>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed">No tools health data.</Text>
        )}
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={4}>Snapshots</Title>
          <Button onClick={onCreateSnapshot}>Create snapshot</Button>
        </Group>
        {snapshotPointer ? (
          <Stack gap="xs">
            <Text>
              walSeq: <Code>{snapshotPointer.walSeq}</Code>
            </Text>
            <Text>
              path: <Code>{snapshotPointer.snapshotPath}</Code>
            </Text>
          </Stack>
        ) : (
          <Text c="dimmed">Snapshot pointer not found yet.</Text>
        )}
      </Card>
    </Stack>
  );
}
