export function formatDate(value?: number): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let index = -1;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(1)} ${units[index]}`;
}
