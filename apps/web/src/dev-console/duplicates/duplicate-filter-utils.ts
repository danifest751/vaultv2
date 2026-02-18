import { DuplicateLevelFilter } from "../types";

export function normalizeDuplicateLevelFilter(value: string | null | undefined): DuplicateLevelFilter {
  switch (value) {
    case "exact":
    case "strong":
    case "probable":
      return value;
    default:
      return "";
  }
}
