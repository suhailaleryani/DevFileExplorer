// Operation history: pure logic (kinds, summaries, pruning, filtering, grouping). No Tauri imports, so it is unit-testable in Node.
import { baseName, parentOf } from "./util.ts";

export const HISTORY_DAYS = 30;
/** Safety cap so a runaway loop can never grow the file without bound. */
export const HISTORY_MAX = 20_000;
const DAY = 86_400_000;

export type HKind =
  | "create"
  | "rename"
  | "move"
  | "copy"
  | "delete"
  | "delete-permanent"
  | "restore"
  | "cleanup"
  | "pin"
  | "unpin"
  | "status"
  | "note"
  | "root"
  | "git"
  | "script";

export const KINDS: Record<HKind, { label: string; icon: string; group: "files" | "projects" | "tools" }> = {
  create: { label: "Created", icon: "＋", group: "files" },
  rename: { label: "Renamed", icon: "✎", group: "files" },
  move: { label: "Moved", icon: "➜", group: "files" },
  copy: { label: "Copied", icon: "⧉", group: "files" },
  delete: { label: "Recycled", icon: "♻", group: "files" },
  "delete-permanent": { label: "Deleted permanently", icon: "⚫", group: "files" },
  restore: { label: "Restored", icon: "↩", group: "files" },
  cleanup: { label: "Disk cleanup", icon: "🧹", group: "tools" },
  pin: { label: "Pinned", icon: "📌", group: "projects" },
  unpin: { label: "Unpinned", icon: "✕", group: "projects" },
  status: { label: "Status changed", icon: "●", group: "projects" },
  note: { label: "Note edited", icon: "✎", group: "projects" },
  root: { label: "Projects folder changed", icon: "📁", group: "projects" },
  git: { label: "Git", icon: "⎇", group: "tools" },
  script: { label: "Script run", icon: "▶", group: "tools" },
};

export interface HItem {
  path: string;
  name: string;
  isDir?: boolean;
}

export interface HEntry {
  id: string;
  /** milliseconds since epoch */
  ts: number;
  kind: HKind;
  ok: boolean;
  summary: string;
  items: HItem[];
  /** where it happened: destination, or the parent folder of the first item */
  folder: string;
  error?: string;
  /** set (ms) once a recycled entry has been restored with Undo */
  undone?: number;
}

export interface HInput {
  kind: HKind;
  /** paths affected (or project path for projects/git/script) */
  paths: string[];
  /** isDir lookup for icons; optional */
  isDir?: (p: string) => boolean | undefined;
  dest?: string;
  /** rename: the new name; status/note: the label or text */
  to?: string;
  from?: string;
  /** extra words for the summary, e.g. "fetch", "switched to main" */
  text?: string;
  ok?: boolean;
  error?: string;
  ts?: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function what(items: HItem[]): string {
  if (items.length === 1) return `${items[0].isDir ? "folder" : items[0].isDir === false ? "file" : "item"} “${items[0].name}”`;
  const dirs = items.filter((i) => i.isDir).length;
  const files = items.filter((i) => i.isDir === false).length;
  if (dirs === items.length) return plural(items.length, "folder");
  if (files === items.length) return plural(items.length, "file");
  return plural(items.length, "item");
}

export function summarize(i: HInput, items: HItem[]): string {
  const w = what(items);
  const dest = i.dest ? ` ${i.kind === "move" || i.kind === "copy" ? "to" : "in"} “${baseName(i.dest)}”` : "";
  switch (i.kind) {
    case "create":
      return `Created ${w}${dest}`;
    case "rename":
      return `Renamed “${i.from ?? items[0]?.name}” to “${i.to ?? items[0]?.name}”`;
    case "move":
      return `Moved ${w}${dest}`;
    case "copy":
      return `Copied ${w}${dest}`;
    case "delete":
      return `Moved ${w} to the Recycle Bin`;
    case "delete-permanent":
      return `Permanently deleted ${w}`;
    case "restore":
      return `Restored ${w} from the Recycle Bin`;
    case "cleanup":
      return i.text ?? `Cleaned up ${w}`;
    case "pin":
      return `Pinned ${w}`;
    case "unpin":
      return `Unpinned ${w}`;
    case "status":
      return `Set status of “${items[0]?.name}” to ${i.to ?? "none"}`;
    case "note":
      return i.to ? `Edited note of “${items[0]?.name}”` : `Cleared note of “${items[0]?.name}”`;
    case "root":
      return `Projects folder set to “${items[0]?.name}”`;
    case "git":
      return `Git ${i.text ?? "action"} in ${items.length === 1 ? `“${items[0].name}”` : plural(items.length, "project")}`;
    case "script":
      return `Ran ${i.text ?? "script"} in “${items[0]?.name}”`;
  }
}

/** For these the "folder" is where the item lived; for project-level operations it is the project itself. */
const PARENT_KINDS = new Set<HKind>(["create", "rename", "delete", "delete-permanent", "restore", "cleanup"]);

let seq = 0;
/** Build a history entry from an operation description. */
export function makeEntry(i: HInput, now = Date.now()): HEntry {
  const items: HItem[] = i.paths.map((p) => ({ path: p, name: baseName(p), isDir: i.isDir?.(p) }));
  const first = items[0]?.path;
  const folder =
    i.dest ?? (PARENT_KINDS.has(i.kind) ? (first ? parentOf(first) : "") : first ?? "");
  const ok = i.ok !== false;
  const e: HEntry = {
    id: `${i.ts ?? now}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: i.ts ?? now,
    kind: i.kind,
    ok,
    summary: summarize(i, items),
    items,
    folder,
  };
  if (!ok) {
    e.summary = "Failed: " + e.summary;
    e.error = i.error;
  }
  return e;
}

/** Drop entries older than the retention window, keep newest first, and cap the size. */
export function pruneHistory(list: HEntry[], now = Date.now(), days = HISTORY_DAYS): HEntry[] {
  const cutoff = now - days * DAY;
  return list
    .filter((e) => e && typeof e.ts === "number" && e.ts >= cutoff && e.ts <= now + DAY)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, HISTORY_MAX);
}

/** Parse the saved file defensively: anything malformed is dropped rather than crashing the app. */
export function parseHistory(raw: string, now = Date.now()): HEntry[] {
  try {
    const v = JSON.parse(raw);
    const arr: unknown[] = Array.isArray(v) ? v : Array.isArray(v?.entries) ? v.entries : [];
    const ok = arr.filter(
      (e): e is HEntry =>
        !!e &&
        typeof (e as HEntry).id === "string" &&
        typeof (e as HEntry).ts === "number" &&
        (e as HEntry).kind in KINDS &&
        typeof (e as HEntry).summary === "string" &&
        Array.isArray((e as HEntry).items),
    );
    return pruneHistory(ok, now);
  } catch {
    return [];
  }
}

/** Merge two lists by id (used when operations were logged before the saved file finished loading). */
export function mergeHistory(a: HEntry[], b: HEntry[], now = Date.now()): HEntry[] {
  const m = new Map<string, HEntry>();
  for (const e of [...a, ...b]) m.set(e.id, e);
  return pruneHistory([...m.values()], now);
}

export type Range = "all" | "today" | "7d" | "24h";

export interface HFilter {
  q: string;
  kinds: ReadonlySet<HKind>;
  range: Range;
  failedOnly: boolean;
}

export const NO_FILTER: HFilter = { q: "", kinds: new Set(), range: "all", failedOnly: false };

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** All search words must appear somewhere in the summary, item paths, kind label, folder or error. */
export function filterHistory(list: HEntry[], f: HFilter, now = Date.now()): HEntry[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const since = f.range === "today" ? startOfDay(now) : f.range === "7d" ? now - 7 * DAY : f.range === "24h" ? now - DAY : 0;
  return list.filter((e) => {
    if (e.ts < since) return false;
    if (f.kinds.size && !f.kinds.has(e.kind)) return false;
    if (f.failedOnly && e.ok) return false;
    if (!words.length) return true;
    const hay = [e.summary, KINDS[e.kind].label, e.folder, e.error ?? "", ...e.items.map((i) => i.path)].join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type GroupBy = "day" | "kind" | "folder" | "none";

export interface HGroup {
  key: string;
  label: string;
  entries: HEntry[];
}

export function dayLabel(ts: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** Groups keep entries newest first. Day groups are newest first; type and folder groups are largest first, then alphabetical. */
export function groupHistory(list: HEntry[], by: GroupBy, now = Date.now()): HGroup[] {
  if (by === "none") return list.length ? [{ key: "all", label: "All operations", entries: list }] : [];
  const map = new Map<string, HGroup>();
  for (const e of list) {
    let key: string;
    let label: string;
    if (by === "day") {
      key = String(startOfDay(e.ts));
      label = dayLabel(e.ts, now);
    } else if (by === "kind") {
      key = e.kind;
      label = KINDS[e.kind].label;
    } else {
      key = e.folder.toLowerCase();
      label = e.folder || "(no folder)";
    }
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, label, entries: [] }));
    g.entries.push(e);
  }
  const groups = [...map.values()];
  if (by === "day") groups.sort((a, b) => Number(b.key) - Number(a.key));
  else groups.sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
  return groups;
}

export function countByKind(list: HEntry[]): Partial<Record<HKind, number>> {
  const c: Partial<Record<HKind, number>> = {};
  for (const e of list) c[e.kind] = (c[e.kind] ?? 0) + 1;
  return c;
}

export function timeLabel(ts: number, now = Date.now()): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (startOfDay(ts) === startOfDay(now)) return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
