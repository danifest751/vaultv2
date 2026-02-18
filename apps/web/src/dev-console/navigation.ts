export type SectionKey =
  | "overview"
  | "sources"
  | "media"
  | "albums"
  | "quarantine"
  | "duplicates"
  | "jobs"
  | "system";

export const NAV_ITEMS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "sources", label: "Sources" },
  { key: "media", label: "Media" },
  { key: "albums", label: "Albums" },
  { key: "quarantine", label: "Quarantine" },
  { key: "duplicates", label: "Duplicates" },
  { key: "jobs", label: "Jobs" },
  { key: "system", label: "System" }
];
