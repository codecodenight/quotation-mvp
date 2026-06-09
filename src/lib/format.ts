export function formatBytes(value: bigint | number): string {
  const bytes = typeof value === "bigint" ? Number(value) : value;
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(value);
}

export function formatMoney(value: { toString(): string } | number | string, currency: string): string {
  const raw = typeof value === "number" || typeof value === "string" ? value : value.toString();
  const numeric = Number(raw);
  const amount = Number.isFinite(numeric) ? numeric.toFixed(2) : String(raw);
  return `${amount} ${currency}`;
}
