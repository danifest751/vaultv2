import { Button, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { AppMetrics } from "../types";

export interface OverviewSectionProps {
  metrics: AppMetrics;
  onRefreshAll: () => void;
}

export function OverviewSection({ metrics, onRefreshAll }: OverviewSectionProps) {
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
        <Card withBorder>
          <Text size="xs" c="dimmed">
            Sources
          </Text>
          <Title order={3}>{metrics.sources}</Title>
        </Card>
        <Card withBorder>
          <Text size="xs" c="dimmed">
            Albums
          </Text>
          <Title order={3}>{metrics.albums}</Title>
        </Card>
        <Card withBorder>
          <Text size="xs" c="dimmed">
            Media
          </Text>
          <Title order={3}>{metrics.media}</Title>
        </Card>
        <Card withBorder>
          <Text size="xs" c="dimmed">
            Quarantine pending
          </Text>
          <Title order={3}>{metrics.quarantinePending}</Title>
        </Card>
        <Card withBorder>
          <Text size="xs" c="dimmed">
            Duplicate links
          </Text>
          <Title order={3}>{metrics.duplicates}</Title>
        </Card>
        <Card withBorder>
          <Text size="xs" c="dimmed">
            Active jobs
          </Text>
          <Title order={3}>{metrics.jobsActive}</Title>
        </Card>
      </SimpleGrid>

      <Card withBorder>
        <Group justify="space-between">
          <Text fw={600}>Quick actions</Text>
          <Button variant="light" onClick={onRefreshAll}>
            Refresh all
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
