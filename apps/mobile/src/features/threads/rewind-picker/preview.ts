/** Display-only: the rewind command continues to restore the untouched original prompt. */
export function readableRewindPreview(text: string): string {
  return text
    .replace(/<t3_context\b[^>]*>[\s\S]*?<\/t3_context>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[Attachment: $1]")
    .trim();
}

export function rewindHistoryCoverage(page: { hasMore: boolean; loadingOlder: boolean } | null) {
  if (!page) return "unknown";
  if (page.loadingOlder) return "loading";
  return page.hasMore ? "more" : "complete";
}
