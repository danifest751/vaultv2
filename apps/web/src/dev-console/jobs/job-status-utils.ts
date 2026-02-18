import { JobDto } from "../types";

export type JobStatusColor = "green" | "red" | "yellow" | "gray";

export function getJobStatusColor(status: JobDto["status"]): JobStatusColor {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "running":
      return "yellow";
    default:
      return "gray";
  }
}
