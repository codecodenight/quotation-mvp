export type ProductDetailsIssue = "special-character" | "dirty-pattern" | "too-short" | "empty-with-size";

export type ProductDetailsCleanupCandidate = {
  id?: string;
  modelNo?: string | null;
  remark: string | null;
  size: string | null;
};

export function classifyProductDetailsIssue(candidate: ProductDetailsCleanupCandidate): ProductDetailsIssue[] {
  const remark = candidate.remark ?? "";
  const issues: ProductDetailsIssue[] = [];

  if (/[¢©®âÃ]/i.test(remark)) {
    issues.push("special-character");
  }
  if (/[¢Â]/.test(remark)) {
    issues.push("dirty-pattern");
  }
  if (remark.length > 0 && remark.length < 5) {
    issues.push("too-short");
  }
  if (remark.trim().length === 0 && candidate.size?.trim()) {
    issues.push("empty-with-size");
  }

  return issues;
}

export function cleanProductDetailsText(remark: string | null, size?: string | null): string | null {
  const raw = remark ?? "";
  if (raw.trim().length === 0) {
    return size?.trim() || null;
  }

  return raw
    .replace(/Â+/g, "")
    .replace(/¢(?=\d)/g, "φ")
    .trim();
}
