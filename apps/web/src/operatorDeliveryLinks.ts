const LINK_ROUTER = "http://mbp21.tailec334b.ts.net:8129/v/vault/r/";
const LEGACY_LINK_ROUTER = "https://obsidian-links.kennethchristensen.me/v/vault/r/";
const ABSOLUTE_PATH =
  /\/Users\/Admin\/(?:core-root|\.(?:claude|codex|cowork))\/[^\s`"'<>()[\]{}]+/g;
const FENCED_CODE = /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3(?=\n|$)/g;

export interface OperatorDeliveryLinkSettings {
  enabled: boolean;
}

export function operatorLinkRouterUrl(absolutePath: string): string | null {
  if (absolutePath.includes("/worktrees/")) return null;
  if (absolutePath.startsWith("/Users/Admin/core-root/vault/")) {
    return `${LINK_ROUTER}${absolutePath.slice("/Users/Admin/core-root/vault/".length)}`;
  }
  if (absolutePath.startsWith("/Users/Admin/core-root/")) {
    return `${LINK_ROUTER}_repo/${absolutePath.slice("/Users/Admin/core-root/".length)}`;
  }
  for (const root of ["claude", "codex", "cowork"] as const) {
    const prefix = `/Users/Admin/.${root}/`;
    if (absolutePath.startsWith(prefix))
      return `${LINK_ROUTER}__/${root}/${absolutePath.slice(prefix.length)}`;
  }
  return null;
}

export function absolutePathForOperatorLink(url: string): string | null {
  if (!url.startsWith(LINK_ROUTER)) return null;
  const relative = url.slice(LINK_ROUTER.length);
  if (relative.startsWith("_repo/"))
    return `/Users/Admin/core-root/${relative.slice("_repo/".length)}`;
  for (const root of ["claude", "codex", "cowork"] as const) {
    const prefix = `__/${root}/`;
    if (relative.startsWith(prefix))
      return `/Users/Admin/.${root}/${relative.slice(prefix.length)}`;
  }
  return `/Users/Admin/core-root/vault/${relative}`;
}

function trimPath(raw: string): string {
  return raw.replace(/[.,;:!?]+$/u, "");
}

function looksLikeFile(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return !path.endsWith("/") && name.includes(".");
}

function renderTextSegment(segment: string): string {
  const normalized = segment.split(LEGACY_LINK_ROUTER).join(LINK_ROUTER);
  const original = normalized;
  const additions = new Map<number, string[]>();
  const lines = normalized.split("\n");

  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(ABSOLUTE_PATH)) {
      const absolutePath = trimPath(match[0]);
      if (!looksLikeFile(absolutePath)) continue;
      const url = operatorLinkRouterUrl(absolutePath);
      if (!url || original.includes(url)) continue;
      const companion = `📄 [${absolutePath.split("/").at(-1)}](${url})`;
      const current = additions.get(lineIndex) ?? [];
      if (!current.includes(companion)) current.push(companion);
      additions.set(lineIndex, current);
    }
  });

  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(
      new RegExp(`${LINK_ROUTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\s)]+`, "g"),
    )) {
      const url = trimPath(match[0]);
      const absolutePath = absolutePathForOperatorLink(url);
      if (!absolutePath || original.includes(absolutePath)) continue;
      const current = additions.get(lineIndex - 1) ?? [];
      if (!current.includes(absolutePath)) current.push(absolutePath);
      additions.set(Math.max(-1, lineIndex - 1), current);
    }
  });

  if (additions.size === 0) return segment;
  const output: string[] = [];
  output.push(...(additions.get(-1) ?? []));
  lines.forEach((line, lineIndex) => {
    output.push(line);
    output.push(...(additions.get(lineIndex) ?? []));
  });
  return output.join("\n");
}

/** Adds only derived link lines; persisted assistant bytes remain untouched. */
export function renderOperatorDeliveryLinks(
  text: string,
  settings: OperatorDeliveryLinkSettings,
): string {
  if (!settings.enabled) return text;
  let output = "";
  let cursor = 0;
  for (const match of text.matchAll(FENCED_CODE)) {
    const index = match.index ?? 0;
    output += renderTextSegment(text.slice(cursor, index));
    output += match[0];
    cursor = index + match[0].length;
  }
  output += renderTextSegment(text.slice(cursor));
  return output;
}
