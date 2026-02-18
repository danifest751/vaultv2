import { Badge, Button, Card, Code, Group, Loader, Stack, Table, Title } from "@mantine/core";
import { getJobStatusColor } from "../jobs/job-status-utils";
import { JobDto } from "../types";

export interface JobsSectionProps {
  jobs: JobDto[];
  jobsLoading: boolean;
  onReload: () => void;
  formatDate: (value?: number) => string;
}

export function JobsSection({ jobs, jobsLoading, onReload, formatDate }: JobsSectionProps) {
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>Jobs</Title>
          <Group>
            {jobsLoading ? <Loader size="sm" /> : null}
            <Button variant="light" onClick={onReload}>
              Reload
            </Button>
          </Group>
        </Group>
        <Table withTableBorder withColumnBorders striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>jobId</Table.Th>
              <Table.Th>kind</Table.Th>
              <Table.Th>status</Table.Th>
              <Table.Th>attempt</Table.Th>
              <Table.Th>startedAt</Table.Th>
              <Table.Th>error</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {jobs.map((job) => (
              <Table.Tr key={job.jobId}>
                <Table.Td>
                  <Code>{job.jobId}</Code>
                </Table.Td>
                <Table.Td>{job.kind}</Table.Td>
                <Table.Td>
                  <Badge color={getJobStatusColor(job.status)} variant="light">
                    {job.status}
                  </Badge>
                </Table.Td>
                <Table.Td>{job.attempt}</Table.Td>
                <Table.Td>{formatDate(job.startedAt)}</Table.Td>
                <Table.Td>{job.error ?? "-"}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}
