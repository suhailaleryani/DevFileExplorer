import { invoke } from "@tauri-apps/api/core";

export type Status = "active" | "unfinished" | "abandoned" | "done" | "idea";
export const STATUSES: { id: Status; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "unfinished", label: "Unfinished" },
  { id: "abandoned", label: "Abandoned" },
  { id: "done", label: "Done" },
  { id: "idea", label: "Idea" },
];

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  created: number;
  ext: string;
}
export interface SizeInfo {
  size: number;
  files: number;
  folders: number;
  /** the scan hit its time budget, so size is a lower bound */
  partial?: boolean;
}
export interface ProjectInfo {
  folderModified: number;
  contentModified: number;
}
export interface GitInfo {
  branch: string;
  dirty: boolean;
  dirtyCount: number;
  lastCommit: number;
  lastMessage: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  hasRemote: boolean;
}
export interface OpResult {
  ok: number;
  failed: string[];
}

export interface TabState {
  id: string;
  history: string[];
  idx: number;
  /** this tab's own projects folder (the sidebar list); tabs without one use the global `root` */
  root?: string | null;
}
export interface ProjectMeta {
  status?: Status;
  note?: string;
}
export interface Persisted {
  root: string | null;
  pins: string[];
  meta: Record<string, ProjectMeta>;
  tabs: TabState[];
  activeTab: number;
  /** age thresholds in days: green < a, yellow < b, orange < c, red otherwise */
  thresholds: [number, number, number];
  confirmPermanent: boolean;
  gitBannerDismissed: boolean;
  ignore: string[];
  sidebarWidth?: number;
  theme?: "system" | "light" | "dark";
}

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "bin",
  "obj",
  "dist",
  "target",
  ".next",
  "__pycache__",
  ".venv",
];

export const listDir = (path: string) => invoke<Entry[]>("list_dir", { path });
/** Folder scans are heavy: run at most two at a time, and let callers skip ones nobody waits for any more. */
let activeScans = 0;
const scanQueue: (() => void)[] = [];
export async function dirSize(path: string, opts: { budgetMs?: number; isStale?: () => boolean } = {}): Promise<SizeInfo> {
  while (activeScans >= 2) await new Promise<void>((r) => scanQueue.push(r));
  activeScans++;
  try {
    if (opts.isStale?.()) return { size: 0, files: 0, folders: 0, partial: true };
    return await invoke<SizeInfo>("dir_size", { path, budgetMs: opts.budgetMs ?? 6000 });
  } finally {
    activeScans--;
    scanQueue.shift()?.();
  }
}
export const projectInfo = (path: string, ignore: string[]) =>
  invoke<ProjectInfo>("project_info", { path, ignore });
export const gitAvailable = () => invoke<boolean>("git_available");
export const gitInfo = (path: string) => invoke<GitInfo | null>("git_info", { path });
export interface Cleanable {
  path: string;
  kind: string;
  modified: number;
}
export const findCleanable = (path: string) => invoke<Cleanable[]>("find_cleanable", { path });
export const projectStack = (path: string) => invoke<string[]>("project_stack", { path });
export const deletePaths = (paths: string[], permanent: boolean) =>
  invoke<OpResult>("delete_paths", { paths, permanent });
export const pastePaths = (paths: string[], dest: string, cut: boolean) =>
  invoke<OpResult>("paste_paths", { paths, dest, cut });
export const renamePath = (path: string, newName: string) =>
  invoke<string>("rename_path", { path, newName });
export const createEntry = (parent: string, name: string, isDir: boolean) =>
  invoke<string>("create_entry", { parent, name, isDir });
export const openIn = (path: string, kind: "explorer" | "code" | "terminal") =>
  invoke<void>("open_in", { path, kind });
export const loadState = () => invoke<string>("load_state");
export const saveState = (json: string) => invoke<void>("save_state", { json });
export const homeDir = () => invoke<string>("home_dir");
export const restoreTrashed = (paths: string[], deletedAtMs: number) =>
  invoke<OpResult>("restore_trashed", { paths, deletedAtMs });
export const loadHistory = () => invoke<string>("load_history");
export const saveHistory = (json: string) => invoke<void>("save_history", { json });

export interface ScriptItem {
  name: string;
  /** "npm" | "pnpm" | "yarn" | "bun" | "cargo" */
  source: string;
  command: string;
}
export const projectScripts = (path: string) => invoke<ScriptItem[]>("project_scripts", { path });
export const runScript = (path: string, source: string, name: string) =>
  invoke<void>("run_script", { path, source, name });

export interface BranchList {
  current: string;
  branches: string[];
}
export interface Commit {
  hash: string;
  subject: string;
  author: string;
  when: number;
}
export const gitSync = (path: string, action: "fetch" | "pull") => invoke<string>("git_sync", { path, action });
export const gitBranches = (path: string) => invoke<BranchList>("git_branches", { path });
export const gitCheckout = (path: string, branch: string) => invoke<string>("git_checkout", { path, branch });
export const gitLog = (path: string, count: number) => invoke<Commit[]>("git_log", { path, count });

export interface Hit {
  path: string;
  /** 0 for a file-name match */
  line: number;
  text: string;
}
export const searchProject = (path: string, query: string, content: boolean, ignore: string[]) =>
  invoke<Hit[]>("search_project", { path, query, content, ignore });
export const openCodeAt = (path: string, line: number) => invoke<void>("open_code_at", { path, line });
