import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type Entry,
  type OpResult,
  type Persisted,
  type ProjectMeta,
  type SizeInfo,
  type TabState,
  DEFAULT_IGNORE,
  createEntry,
  deletePaths,
  dirSize,
  gitAvailable,
  gitBranches,
  gitCheckout,
  gitSync,
  projectScripts,
  runScript,
  homeDir,
  listDir,
  loadState,
  openIn,
  pastePaths,
  renamePath,
  restoreTrashed,
  saveState,
} from "./api";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ConfirmModal, ContextMenu, Crumbs, type Details, DropChoiceModal, type MenuItem, type MenuState, StatusBar, TabsBar, ThemeButton } from "./components";
import { FileList, type Sort, type SortKey } from "./FileList";
import { Cleaner } from "./Cleaner";
import { CommitsModal, SearchPanel } from "./Search";
import { QuickJump } from "./QuickJump";
import { Sidebar, useProjects } from "./Sidebar";
import { baseName, crumbs, dragState, formatSize, parentOf, typeLabel } from "./util";
import { STATUSES } from "./api";
import type { HEntry, HInput, HKind } from "./historyLog.ts";
import { initHistory, logOp, updateEntry, useHistory } from "./historyStore";
import { HistoryModal } from "./History";
import "./App.css";

const DEFAULTS: Persisted = {
  root: null,
  pins: [],
  meta: {},
  tabs: [],
  activeTab: 0,
  thresholds: [7, 30, 90],
  confirmPermanent: true,
  gitBannerDismissed: false,
  ignore: DEFAULT_IGNORE,
  sidebarWidth: 340,
  theme: "system",
};

let tabCounter = 0;
const newTab = (path: string, root?: string | null): TabState => ({
  id: `t${Date.now()}-${tabCounter++}`,
  history: [path],
  idx: 0,
  ...(root ? { root } : {}),
});

export default function App() {
  const [st, setSt] = useState<Persisted | null>(null);
  const [gitOk, setGitOk] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>({ key: "name", asc: true });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropChoice, setDropChoice] = useState<{ paths: string[]; dest: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [clip, setClip] = useState<{ paths: string[]; cut: boolean } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<{ paths: string[]; total: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [details, setDetails] = useState<Details>({ files: 0, folders: 0, size: 0, pending: false, partial: false });
  const [pv, setPv] = useState(0); // bump to refresh the project dashboard
  const [lv, setLv] = useState(0); // bump to re-list the project folders only
  const [pinV, setPinV] = useState(0); // bump to refresh the pinned-folder cards
  const [filter, setFilter] = useState<string | null>(null); // null = filter box closed
  const [reveal, setReveal] = useState<number | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [addrToken, setAddrToken] = useState(0);
  const [folderSizes, setFolderSizes] = useState<Record<string, number>>({});
  const [sizing, setSizing] = useState<Set<string>>(new Set());

  const anchor = useRef<string | null>(null);
  const cursor = useRef<string | null>(null);
  const marqueeBase = useRef<Set<string>>(new Set());
  const sizeCache = useRef(new Map<string, SizeInfo>());
  const loadSeq = useRef(0);

  const history = useHistory();
  const update = useCallback((f: (s: Persisted) => Persisted) => setSt((s) => (s ? f(s) : s)), []);

  // ----- load / save persisted state -----
  useEffect(() => {
    (async () => {
      let p: Persisted = { ...DEFAULTS };
      try {
        p = { ...DEFAULTS, ...JSON.parse(await loadState()) };
      } catch {
        /* first run or unreadable file: use defaults */
      }
      if (!p.tabs.length) {
        p.tabs = [newTab(p.root ?? (await homeDir()))];
        p.activeTab = 0;
      }
      p.activeTab = Math.min(p.activeTab, p.tabs.length - 1);
      setSt(p);
      void initHistory();
      setGitOk(await gitAvailable());
    })();
  }, []);

  useEffect(() => {
    if (!st) return;
    const t = setTimeout(() => saveState(JSON.stringify(st)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [st]);

  // ----- theme (also themes the native title bar) -----
  const theme = st?.theme ?? "system";
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch(() => {});
  }, [theme]);

  const tab = st ? st.tabs[st.activeTab] : null;
  const cwd = tab ? tab.history[tab.idx] : null;
  /** The projects folder of the active tab; every tab has its own project list. */
  const root = tab?.root ?? st?.root ?? null;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
  }, []);

  // ----- navigation -----
  const navigate = useCallback(
    (path: string, inNewTab = false) =>
      update((s) => {
        // a new tab starts with the projects folder of the tab it was opened from
        if (inNewTab) return { ...s, tabs: [...s.tabs, newTab(path, s.tabs[s.activeTab]?.root ?? s.root)], activeTab: s.tabs.length };
        const t = s.tabs[s.activeTab];
        if (t.history[t.idx] === path) return s;
        const history = [...t.history.slice(0, t.idx + 1), path];
        return { ...s, tabs: s.tabs.map((x, i) => (i === s.activeTab ? { ...x, history, idx: history.length - 1 } : x)) };
      }),
    [update],
  );
  const step = useCallback(
    (d: number) =>
      update((s) => {
        const t = s.tabs[s.activeTab];
        const idx = t.idx + d;
        if (idx < 0 || idx >= t.history.length) return s;
        return { ...s, tabs: s.tabs.map((x, i) => (i === s.activeTab ? { ...x, idx } : x)) };
      }),
    [update],
  );
  const closeTab = useCallback(
    (i: number) =>
      update((s) => {
        if (s.tabs.length <= 1) return s;
        const tabs = s.tabs.filter((_, j) => j !== i);
        const activeTab = i < s.activeTab ? s.activeTab - 1 : Math.min(s.activeTab, tabs.length - 1);
        return { ...s, tabs, activeTab };
      }),
    [update],
  );

  const moveTab = useCallback(
    (from: number, to: number) =>
      update((s) => {
        const tabs = [...s.tabs];
        const [t] = tabs.splice(from, 1);
        tabs.splice(to, 0, t);
        const activeId = s.tabs[s.activeTab].id;
        return { ...s, tabs, activeTab: tabs.findIndex((x) => x.id === activeId) };
      }),
    [update],
  );

  // ----- directory listing -----
  const reload = useCallback(async () => {
    if (!cwd) return;
    const seq = ++loadSeq.current;
    sizeCache.current.clear();
    setLv((v) => v + 1); // also re-list the project folders in the sidebar
    try {
      const e = await listDir(cwd);
      if (seq !== loadSeq.current) return;
      setEntries(e);
      setError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setEntries([]);
      setError(String(err));
    }
  }, [cwd]);

  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
    setRenaming(null);
    setFilter(null);
    setReveal(null);
    setFolderSizes({});
    setSizing(new Set());
    reload();
  }, [reload]);

  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  const rows = useMemo(() => {
    const dir = sort.asc ? 1 : -1;
    const fl = filter?.trim().toLowerCase();
    const shown = fl ? entries.filter((x) => x.name.toLowerCase().includes(fl)) : entries;
    return [...shown].sort((x, y) => {
      if (x.isDir !== y.isDir) return x.isDir ? -1 : 1;
      let c = 0;
      switch (sort.key) {
        case "name":
          c = x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "modified":
          c = x.modified - y.modified;
          break;
        case "size":
          c = (folderSizes[x.path] ?? x.size) - (folderSizes[y.path] ?? y.size);
          break;
        case "type":
          c = typeLabel(x).localeCompare(typeLabel(y)) || x.name.localeCompare(y.name);
          break;
      }
      return c * dir;
    });
  }, [entries, sort, filter, folderSizes]);

  const selectedEntries = useMemo(() => rows.filter((r) => selected.has(r.path)), [rows, selected]);

  // ----- selection details (folder sizes computed in the background) -----
  useEffect(() => {
    const files = selectedEntries.filter((r) => !r.isDir);
    const dirs = selectedEntries.filter((r) => r.isDir);
    const base = files.reduce((a, r) => a + r.size, 0);
    setDetails({ files: files.length, folders: dirs.length, size: base, pending: dirs.length > 0, partial: false });
    if (!dirs.length) return;
    let cancelled = false;
    (async () => {
      const sizes = await Promise.all(
        dirs.map(async (d) => {
          let si = sizeCache.current.get(d.path);
          if (!si) {
            si = await dirSize(d.path, { budgetMs: 4000, isStale: () => cancelled }).catch(() => ({
              size: 0,
              files: 0,
              folders: 0,
            }));
            if (!cancelled) sizeCache.current.set(d.path, si);
          }
          return si;
        }),
      );
      if (!cancelled)
        setDetails((p) => ({
          ...p,
          size: base + sizes.reduce((acc, s) => acc + s.size, 0),
          partial: sizes.some((s) => s.partial),
          pending: false,
        }));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEntries]);

  const moveCursor = (idx: number, extend: boolean) => {
    if (!rows.length) return;
    const i = Math.max(0, Math.min(rows.length - 1, idx));
    const target = rows[i];
    if (extend && anchor.current) {
      const a = rows.findIndex((r) => r.path === anchor.current);
      const [lo, hi] = [Math.min(a < 0 ? i : a, i), Math.max(a < 0 ? i : a, i)];
      setSelected(new Set(rows.slice(lo, hi + 1).map((r) => r.path)));
    } else {
      setSelected(new Set([target.path]));
      anchor.current = target.path;
    }
    cursor.current = target.path;
    setReveal(i);
  };

  const selectRow = (e: Entry, idx: number, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    cursor.current = e.path;
    if (mods.shiftKey && anchor.current) {
      const a = rows.findIndex((r) => r.path === anchor.current);
      const [lo, hi] = [Math.min(a, idx), Math.max(a, idx)];
      setSelected(new Set(rows.slice(lo, hi + 1).map((r) => r.path)));
    } else if (mods.ctrlKey || mods.metaKey) {
      setSelected((prev) => {
        const n = new Set(prev);
        if (!n.delete(e.path)) n.add(e.path);
        return n;
      });
      anchor.current = e.path;
    } else {
      setSelected(new Set([e.path]));
      anchor.current = e.path;
    }
  };
  const selectOnly = (e: Entry) => {
    cursor.current = e.path;
    setSelected(new Set([e.path]));
    anchor.current = e.path;
  };

  // ----- folder sizes (on demand, so huge folders never slow browsing) -----
  const calcSize = useCallback((e: Entry) => {
    setSizing((p) => new Set(p).add(e.path));
    dirSize(e.path, { budgetMs: 20000 })
      .then((si) => setFolderSizes((m) => ({ ...m, [e.path]: si.size })))
      .catch(() => setFolderSizes((m) => ({ ...m, [e.path]: 0 })))
      .finally(() =>
        setSizing((p) => {
          const n = new Set(p);
          n.delete(e.path);
          return n;
        }),
      );
  }, []);
  const calcAllSizes = () => {
    const todo = rows.filter((r) => r.isDir && folderSizes[r.path] === undefined && !sizing.has(r.path));
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift()!;
        setSizing((p) => new Set(p).add(e.path));
        const si = await dirSize(e.path, { budgetMs: 20000 }).catch(() => ({ size: 0, files: 0, folders: 0 }));
        setFolderSizes((m) => ({ ...m, [e.path]: si.size }));
        setSizing((p) => {
          const n = new Set(p);
          n.delete(e.path);
          return n;
        });
      }
    };
    void Promise.all([worker(), worker(), worker()]);
  };

  // ----- operations -----
  const setClipboard = (paths: string[], cut: boolean) => {
    setClip({ paths, cut });
    flash(`${cut ? "Cut" : "Copied"} ${paths.length} item${paths.length === 1 ? "" : "s"} — paste with Ctrl+V`);
  };
  const inside = (p: string, base: string) => {
    const a = p.replace(/[\\/]+$/, "").toLowerCase();
    const b = base.replace(/[\\/]+$/, "").toLowerCase();
    return a === b || a.startsWith(b + "\\") || a.startsWith(b + "/");
  };
  const underRoot = (p: string) => !!root && inside(p, root);
  const afterOp = async (paths: string[]) => {
    await reload();
    const touched = cwd ? [...paths, cwd] : paths;
    if (touched.some(underRoot)) setPv((v) => v + 1);
    if (touched.some((p) => st?.pins.some((pin) => inside(p, pin)))) setPinV((v) => v + 1);
  };
  const report = (r: OpResult, verb: string) => {
    if (r.failed.length) flash(`${verb} ${r.ok}, ${r.failed.length} failed: ${r.failed[0]}`);
    else if (r.ok) flash(`${verb} ${r.ok} item${r.ok === 1 ? "" : "s"}`);
  };

  // ----- operation history -----
  const isDirOf = (p: string) =>
    entries.find((x) => x.path === p)?.isDir ?? (projects.list.some((x) => x.path === p) || st?.pins.includes(p) ? true : undefined);
  const logResult = (kind: HKind, paths: string[], r: OpResult, extra: Partial<HInput> = {}) => {
    const bad = (p: string) => r.failed.some((f) => f.startsWith(p + ":"));
    const good = paths.filter((p) => !bad(p));
    if (good.length && r.ok) logOp({ kind, paths: good, isDir: isDirOf, ...extra });
    const failed = paths.filter(bad);
    if (failed.length) logOp({ kind, paths: failed, isDir: isDirOf, ok: false, error: r.failed[0], ...extra });
  };

  /** Undo for recycled items: put them back from the Recycle Bin. */
  const undoDelete = async (e: HEntry) => {
    const paths = e.items.map((i) => i.path);
    const dirOf = (p: string) => e.items.find((i) => i.path === p)?.isDir;
    try {
      const r = await restoreTrashed(paths, e.ts);
      const bad = (p: string) => r.failed.some((f) => f.startsWith(p + ":"));
      const good = paths.filter((p) => !bad(p));
      if (good.length) logOp({ kind: "restore", paths: good, isDir: dirOf });
      if (!r.failed.length) updateEntry(e.id, { undone: Date.now() });
      else {
        // keep only what is still to restore, so Undo can be tried again for those
        updateEntry(e.id, { items: e.items.filter((i) => bad(i.path)) });
        logOp({ kind: "restore", paths: paths.filter(bad), isDir: dirOf, ok: false, error: r.failed[0] });
      }
      report(r, "Restored");
      await afterOp(paths);
    } catch (err) {
      logOp({ kind: "restore", paths, isDir: dirOf, ok: false, error: String(err) });
      flash(String(err));
    }
  };

  const runDelete = async (paths: string[], permanent: boolean) => {
    const kind: HKind = permanent ? "delete-permanent" : "delete";
    try {
      const r = await deletePaths(paths, permanent);
      logResult(kind, paths, r);
      report(r, permanent ? "Deleted" : "Recycled");
    } catch (err) {
      logOp({ kind, paths, isDir: isDirOf, ok: false, error: String(err) });
      flash(String(err));
    }
    setSelected(new Set());
    await afterOp(paths);
  };
  const doDelete = async (paths: string[], permanent: boolean) => {
    if (!paths.length) return;
    if (permanent && st?.confirmPermanent) {
      setConfirm({ paths, total: "calculating…" });
      let total = 0;
      for (const p of paths) {
        const e = entries.find((x) => x.path === p);
        if (!e) continue;
        if (!e.isDir) total += e.size;
        else {
          let si = sizeCache.current.get(p);
          if (!si) {
            si = await dirSize(p).catch(() => ({ size: 0, files: 0, folders: 0 }));
            sizeCache.current.set(p, si);
          }
          total += si.size;
        }
      }
      setConfirm((c) => (c && c.paths === paths ? { ...c, total: formatSize(total) } : c));
      return;
    }
    await runDelete(paths, permanent);
  };

  const doPaste = async (paths: string[], dest: string, cut: boolean) => {
    const kind: HKind = cut ? "move" : "copy";
    try {
      const r = await pastePaths(paths, dest, cut);
      logResult(kind, paths, r, { dest });
      report(r, cut ? "Moved" : "Copied");
    } catch (err) {
      logOp({ kind, paths, isDir: isDirOf, dest, ok: false, error: String(err) });
      flash(String(err));
    }
    if (cut) setClip(null);
    await afterOp([...paths, dest]);
  };

  const dropInto = (dest: string, ev: React.DragEvent) => {
    ev.preventDefault();
    const paths = dragState.paths.filter((p) => p !== dest);
    dragState.paths = [];
    setDragging(false);
    if (paths.length) doPaste(paths, dest, !(ev.ctrlKey || ev.altKey));
  };

  // Dropping on a pinned folder or sidebar project is easy to do by accident: ask instead of moving.
  const askDrop = (dest: string, ev: React.DragEvent) => {
    ev.preventDefault();
    const paths = dragState.paths.filter((p) => p !== dest);
    dragState.paths = [];
    setDragging(false);
    if (paths.length) setDropChoice({ paths, dest });
  };
  const isFolderPath = (p: string) => !!entries.find((e) => e.path === p)?.isDir || projects.list.some((x) => x.path === p);
  const pinDropped = (paths: string[]) => {
    const dirs = paths.filter(isFolderPath);
    if (!dirs.length && paths.length) flash("Only folders can be pinned");
    dirs.forEach(pin);
    setDragging(false);
  };

  const takeDragged = () => {
    const p = dragState.paths;
    dragState.paths = [];
    setDragging(false);
    return p;
  };

  const startRename = (e: Entry) => {
    setRenameDraft(null);
    setRenaming(e.path);
  };
  const commitRename = async (e: Entry, name: string) => {
    setRenaming(null);
    if (!name || name === e.name) return;
    try {
      const np = await renamePath(e.path, name);
      logOp({ kind: "rename", paths: [np], from: e.name, to: name, isDir: () => e.isDir });
      setRenameDraft(null);
      await afterOp([e.path]);
      setSelected(new Set([np]));
    } catch (err) {
      // keep what the user typed so a locked folder doesn't lose the edit
      logOp({ kind: "rename", paths: [e.path], from: e.name, to: name, isDir: () => e.isDir, ok: false, error: String(err) });
      flash(String(err));
      setRenameDraft(name);
      setRenaming(e.path);
    }
  };

  const createNew = async (isDir: boolean) => {
    if (!cwd) return;
    try {
      const p = await createEntry(cwd, isDir ? "New folder" : "New file.txt", isDir);
      logOp({ kind: "create", paths: [p], isDir: () => isDir });
      await afterOp([p]);
      setSelected(new Set([p]));
      setRenaming(p);
    } catch (err) {
      logOp({ kind: "create", paths: [`${cwd}\\${isDir ? "New folder" : "New file.txt"}`], isDir: () => isDir, ok: false, error: String(err) });
      flash(String(err));
    }
  };

  const openEntry = (e: Entry) => (e.isDir ? navigate(e.path) : openIn(e.path, "explorer").catch((x) => flash(String(x))));
  const launch = (path: string, kind: "explorer" | "code" | "terminal") =>
    openIn(path, kind).catch((x) => flash(kind === "code" ? "Could not start VS Code (is `code` on PATH?)" : String(x)));

  const pin = (path: string) => {
    if (!st?.pins.includes(path)) logOp({ kind: "pin", paths: [path], isDir: () => true });
    update((s) => (s.pins.includes(path) ? s : { ...s, pins: [...s.pins, path] }));
  };
  const reorderPins = (path: string, before: string | null) =>
    update((s) => {
      const pins = s.pins.filter((p) => p !== path);
      const i = before ? pins.indexOf(before) : -1;
      if (i < 0) pins.push(path);
      else pins.splice(i, 0, path);
      return { ...s, pins };
    });
  const movePin = (path: string, delta: number) =>
    update((s) => {
      const i = s.pins.indexOf(path);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= s.pins.length) return s;
      const pins = [...s.pins];
      [pins[i], pins[j]] = [pins[j], pins[i]];
      return { ...s, pins };
    });
  const unpin = (path: string) => {
    if (st?.pins.includes(path)) logOp({ kind: "unpin", paths: [path], isDir: () => true });
    update((s) => ({ ...s, pins: s.pins.filter((p) => p !== path) }));
  };
  const setMeta = (path: string, patch: ProjectMeta) => {
    const before = st?.meta[path];
    if ("status" in patch && patch.status !== before?.status)
      logOp({ kind: "status", paths: [path], isDir: () => true, to: STATUSES.find((x) => x.id === patch.status)?.label });
    if ("note" in patch && (patch.note ?? "") !== (before?.note ?? ""))
      logOp({ kind: "note", paths: [path], isDir: () => true, to: patch.note });
    update((s) => {
      const m = { ...s.meta[path], ...patch };
      if (!m.status) delete m.status;
      if (!m.note) delete m.note;
      const meta = { ...s.meta };
      if (m.status || m.note) meta[path] = m;
      else delete meta[path];
      return { ...s, meta };
    });
  };

  const chooseRoot = async () => {
    const dir = await pickFolder({ directory: true, multiple: false, title: "Choose your projects folder" });
    if (typeof dir === "string") {
      logOp({ kind: "root", paths: [dir], isDir: () => true });
      // only the active tab gets the new projects folder; the global one is just the default for tabs without their own
      update((s) => ({
        ...s,
        root: s.root ?? dir,
        tabs: s.tabs.map((x, i) => (i === s.activeTab ? { ...x, root: dir } : x)),
      }));
      navigate(dir);
    }
  };

  // ----- context menus -----
  const pathMenu = (path: string, isDir: boolean): MenuItem[] => {
    const dir = isDir ? path : parentOf(path);
    return [
      { label: "Open in Explorer", onClick: () => launch(dir, "explorer") },
      { label: "Open in VS Code", onClick: () => launch(path, "code") },
      { label: "Open terminal here", onClick: () => launch(dir, "terminal") },
    ];
  };

  const entryMenu = (ev: React.MouseEvent, e: Entry) => {
    const targets = selected.has(e.path) ? [...selected] : [e.path];
    const pinned = st?.pins.includes(e.path);
    const items: MenuItem[] = [
      { label: "Open", onClick: () => openEntry(e) },
      ...(e.isDir ? [{ label: "Open in new tab", onClick: () => navigate(e.path, true) }] : []),
      ...(e.isDir
        ? [{ label: pinned ? "Unpin from sidebar" : "Pin to sidebar", onClick: () => (pinned ? unpin(e.path) : pin(e.path)) }]
        : []),
      { sep: true },
      { label: "Cut", onClick: () => setClipboard(targets, true) },
      { label: "Copy", onClick: () => setClipboard(targets, false) },
      ...(e.isDir && clip ? [{ label: "Paste into folder", onClick: () => doPaste(clip.paths, e.path, clip.cut) }] : []),
      { sep: true },
      ...(targets.length === 1 ? [{ label: "Rename", onClick: () => startRename(e) }] : []),
      { label: "Move to recycle bin", onClick: () => doDelete(targets, false) },
      { label: "Delete permanently…", danger: true, onClick: () => doDelete(targets, true) },
      { sep: true },
      ...pathMenu(e.path, e.isDir),
    ];
    setMenu({ x: ev.clientX, y: ev.clientY, items });
  };

  const backgroundMenu = (ev: React.MouseEvent) => {
    if (!cwd) return;
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: "New folder", onClick: () => createNew(true) },
        { label: "New file", onClick: () => createNew(false) },
        ...(clip ? [{ label: "Paste", onClick: () => doPaste(clip.paths, cwd, clip.cut) }] : []),
        { sep: true },
        { label: "Calculate folder sizes", onClick: calcAllSizes },
        { label: "Refresh", onClick: reload },
        { sep: true },
        ...pathMenu(cwd, true),
      ],
    });
  };

  // ----- scripts and git -----
  const scriptsMenu = async (ev: React.MouseEvent, path: string) => {
    const x = ev.clientX;
    const y = ev.clientY;
    try {
      const list = await projectScripts(path);
      if (!list.length) return flash("No scripts found (looked for package.json scripts and Cargo.toml)");
      setMenu({
        x,
        y,
        items: list.map((s) => ({
          label: s.source === "cargo" ? `▶ cargo ${s.name}` : `▶ ${s.name}   (${s.source})`,
          onClick: () => {
            const text = s.source === "cargo" ? `cargo ${s.name}` : `${s.source} run ${s.name}`;
            runScript(path, s.source, s.name)
              .then(() => logOp({ kind: "script", paths: [path], isDir: () => true, text }))
              .catch((e) => {
                logOp({ kind: "script", paths: [path], isDir: () => true, text, ok: false, error: String(e) });
                flash(String(e));
              });
          },
        })),
      });
    } catch (e) {
      flash(String(e));
    }
  };

  const gitAction = async (path: string, action: "fetch" | "pull") => {
    const name = baseName(path);
    flash(`git ${action}: ${name}…`);
    try {
      const out = await gitSync(path, action);
      logOp({ kind: "git", paths: [path], isDir: () => true, text: action });
      flash(`${name}: ${out.split(/\r?\n/).filter(Boolean).pop() ?? "done"}`);
    } catch (e) {
      logOp({ kind: "git", paths: [path], isDir: () => true, text: action, ok: false, error: String(e).split(/\r?\n/)[0] });
      flash(`${name}: ${String(e).split(/\r?\n/)[0]}`);
    }
    void projects.refreshGit(path);
  };

  const branchMenu = async (path: string, x: number, y: number) => {
    try {
      const b = await gitBranches(path);
      setMenu({
        x,
        y,
        items: b.branches.map((n) => ({
          label: (n === b.current ? "✓ " : "\u00a0\u00a0\u00a0") + n,
          onClick: async () => {
            if (n === b.current) return;
            try {
              await gitCheckout(path, n);
              logOp({ kind: "git", paths: [path], isDir: () => true, text: `switch to ${n}` });
              flash(`${baseName(path)}: switched to ${n}`);
            } catch (e) {
              logOp({ kind: "git", paths: [path], isDir: () => true, text: `switch to ${n}`, ok: false, error: String(e).split(/\r?\n/)[0] });
              flash(String(e).split(/\r?\n/)[0]);
            }
            void projects.refreshGit(path);
          },
        })),
      });
    } catch (e) {
      flash(String(e).split(/\r?\n/)[0]);
    }
  };

  const fetchAll = async () => {
    const paths = Object.entries(projects.git)
      .filter(([, g]) => g)
      .map(([p]) => p);
    if (!paths.length) return flash("No git projects found yet");
    const queue = [...paths];
    let done = 0;
    let failed = 0;
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift()!;
        try {
          await gitSync(p, "fetch");
        } catch {
          failed++;
        }
        done++;
        flash(`Fetching… ${done}/${paths.length}`);
        await projects.refreshGit(p);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    logOp({ kind: "git", paths, isDir: () => true, text: "fetch all", ok: failed < paths.length, error: failed ? `${failed} failed (offline?)` : undefined });
    flash(`Fetched ${paths.length - failed} of ${paths.length} projects${failed ? `, ${failed} failed (offline?)` : ""}`);
  };

  const projectMenu = (ev: React.MouseEvent, path: string) => {
    const pinned = st?.pins.includes(path);
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: "Open", onClick: () => navigate(path) },
        { label: "Open in new tab", onClick: () => navigate(path, true) },
        { label: pinned ? "Unpin from sidebar" : "Pin to sidebar", onClick: () => (pinned ? unpin(path) : pin(path)) },
        ...(pinned
          ? [
              { label: "Move up", onClick: () => movePin(path, -1) },
              { label: "Move down", onClick: () => movePin(path, 1) },
            ]
          : []),
        { sep: true },
        { label: "Run script…", onClick: () => void scriptsMenu(ev, path) },
        ...(gitOk
          ? [
              { label: "Git: fetch", onClick: () => void gitAction(path, "fetch") },
              { label: "Git: pull (fast-forward only)", onClick: () => void gitAction(path, "pull") },
              { label: "Git: switch branch…", onClick: () => void branchMenu(path, ev.clientX, ev.clientY) },
              { label: "Git: recent commits…", onClick: () => setCommitsFor(path) },
            ]
          : []),
        { sep: true },
        ...pathMenu(path, true),
      ],
    });
  };

  // ----- keyboard -----
  const [jumpOpen, setJumpOpen] = useState(false);
  const [cleanerOpen, setCleanerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [commitsFor, setCommitsFor] = useState<string | null>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setSearchOpen((o) => !o);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setJumpOpen((o) => !o);
      return;
    }
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
    const ctrl = e.ctrlKey || e.metaKey;
    const sel = [...selected];
    const cur = cursor.current ? rows.findIndex((r) => r.path === cursor.current) : -1;
    if (ctrl && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(rows.map((r) => r.path)));
    } else if ((ctrl && e.key.toLowerCase() === "l") || (e.altKey && e.key.toLowerCase() === "d")) {
      e.preventDefault();
      setAddrToken((t) => t + 1);
    } else if (ctrl && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setFilter((f) => f ?? "");
      filterRef.current?.focus();
      filterRef.current?.select();
    } else if (!ctrl && !e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      moveCursor(cur + 1, e.shiftKey);
    } else if (!ctrl && !e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      moveCursor(cur < 0 ? 0 : cur - 1, e.shiftKey);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveCursor(cur + 12, e.shiftKey);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveCursor(cur - 12, e.shiftKey);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveCursor(0, e.shiftKey);
    } else if (e.key === "End") {
      e.preventDefault();
      moveCursor(rows.length - 1, e.shiftKey);
    } else if (ctrl && e.key.toLowerCase() === "c" && sel.length) setClipboard(sel, false);
    else if (ctrl && e.key.toLowerCase() === "x" && sel.length) setClipboard(sel, true);
    else if (ctrl && e.key.toLowerCase() === "v" && clip && cwd) doPaste(clip.paths, cwd, clip.cut);
    else if (ctrl && e.key.toLowerCase() === "t" && cwd) {
      e.preventDefault();
      navigate(cwd, true);
    } else if (ctrl && e.key.toLowerCase() === "w" && st) {
      e.preventDefault();
      closeTab(st.activeTab);
    } else if (e.key === "Delete") doDelete(sel, e.shiftKey);
    else if (e.key === "F2" && selectedEntries.length === 1) startRename(selectedEntries[0]);
    else if (e.key === "F5") {
      e.preventDefault();
      reload();
    } else if (e.key === "Enter" && selectedEntries.length === 1) openEntry(selectedEntries[0]);
    else if (e.key === "Backspace" && cwd) {
      e.preventDefault();
      navigate(parentOf(cwd));
    } else if (e.altKey && e.key === "ArrowLeft") step(-1);
    else if (e.altKey && e.key === "ArrowRight") step(1);
    else if (e.key === "Escape") {
      setSelected(new Set());
      setMenu(null);
    }
  };
  // mouse "back" (button 3) and "forward" (button 4) side buttons
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault(); // stop the webview from doing its own history navigation
      if (e.type === "mouseup") step(e.button === 3 ? -1 : 1);
    };
    window.addEventListener("mousedown", h);
    window.addEventListener("mouseup", h);
    window.addEventListener("auxclick", h);
    return () => {
      window.removeEventListener("mousedown", h);
      window.removeEventListener("mouseup", h);
      window.removeEventListener("auxclick", h);
    };
  }, [step]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const projects = useProjects(root,st?.ignore ?? DEFAULT_IGNORE, gitOk, pv, lv);

  if (!st || !tab || !cwd) return <div className="loading">Loading…</div>;

  const cutPaths = new Set(clip?.cut ? clip.paths : []);
  const canUp = parentOf(cwd) !== cwd;
  const sidebarWidth = st.sidebarWidth ?? 340;

  return (
    <div className="app" onContextMenu={(e) => e.preventDefault()}>
      <TabsBar
        tabs={st.tabs}
        active={st.activeTab}
        onSelect={(i) => update((s) => ({ ...s, activeTab: i }))}
        onClose={closeTab}
        onNew={() => navigate(cwd, true)}
        onMove={moveTab}
      />
      <div className="body">
        <Sidebar
          cwd={cwd}
          width={sidebarWidth}
          root={root}
          pins={st.pins}
          pinVersion={pinV}
          meta={st.meta}
          thresholds={st.thresholds}
          ignore={st.ignore ?? DEFAULT_IGNORE}
          projects={projects}
          gitOk={gitOk}
          gitBannerDismissed={st.gitBannerDismissed}
          onOpen={(p) => navigate(p)}
          onOpenNewTab={(p) => navigate(p, true)}
          onChooseRoot={chooseRoot}
          onCleanup={() => setCleanerOpen(true)}
          onSearch={() => setSearchOpen(true)}
          onFetchAll={() => void fetchAll()}
          onScripts={(e, p) => void scriptsMenu(e, p)}
          onUnpin={unpin}
          onReorderPins={reorderPins}
          onPinContextMenu={projectMenu}
          onPinDropped={pinDropped}
          onMeta={setMeta}
          onDropInto={askDrop}
          onContextMenu={projectMenu}
          onDismissGit={() => update((s) => ({ ...s, gitBannerDismissed: true }))}
          onInstallGit={() => openUrl("https://git-scm.com/downloads").catch(() => {})}
        />
        <div
          className="splitter"
          title="Drag to resize"
          onMouseDown={(ev) => {
            ev.preventDefault();
            const startX = ev.clientX;
            const startW = sidebarWidth;
            const move = (m: MouseEvent) =>
              update((s) => ({ ...s, sidebarWidth: Math.max(240, Math.min(600, startW + m.clientX - startX)) }));
            const up = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
              document.body.classList.remove("resizing");
            };
            document.body.classList.add("resizing");
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
          onDoubleClick={() => update((s) => ({ ...s, sidebarWidth: 340 }))}
        />
        <main className="main">
          <div className="toolbar">
            <button className="tb" title="Back (Alt+←)" disabled={tab.idx === 0} onClick={() => step(-1)}>
              ←
            </button>
            <button className="tb" title="Forward (Alt+→)" disabled={tab.idx >= tab.history.length - 1} onClick={() => step(1)}>
              →
            </button>
            <button className="tb" title="Up (Backspace)" disabled={!canUp} onClick={() => navigate(parentOf(cwd))}>
              ↑
            </button>
            <button className="tb" title="Refresh (F5)" onClick={reload}>
              ⟳
            </button>
            <Crumbs path={cwd} editToken={addrToken} items={crumbs(cwd)} onGo={navigate} onGoNewTab={(p) => navigate(p, true)} />
            {filter !== null ? (
              <div className="filterbox">
                <input
                  ref={filterRef}
                  autoFocus
                  placeholder="Filter this folder…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") setFilter(null);
                    else if (e.key === "Enter" || e.key === "ArrowDown") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                      moveCursor(0, false);
                    }
                  }}
                />
                <button className="tb" title="Clear filter (Esc)" onClick={() => setFilter(null)}>
                  ×
                </button>
              </div>
            ) : (
              <button className="tb" title="Filter (Ctrl+F)" onClick={() => setFilter("")}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="M10.5 10.5L14 14" />
                </svg>
              </button>
            )}
            <span className="tb-sep" />
            <button className="tb wide" title="New folder" onClick={() => createNew(true)}>
              + Folder
            </button>
            <button className="tb wide" title="Open in VS Code" onClick={() => launch(cwd, "code")}>
              VS Code
            </button>
            <button className="tb wide" title="Open terminal here" onClick={() => launch(cwd, "terminal")}>
              Terminal
            </button>
          </div>
          <FileList
            cwd={cwd}
            rows={rows}
            selected={selected}
            cutPaths={cutPaths}
            renaming={renaming}
            renameDraft={renameDraft}
            sort={sort}
            error={error}
            folderSizes={folderSizes}
            sizing={sizing}
            onCalcSize={calcSize}
            filterActive={!!filter?.trim()}
            revealIndex={reveal}
            onSort={(key: SortKey) => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }))}
            onSelect={selectRow}
            onSelectOnly={selectOnly}
            onClearSelection={() => setSelected(new Set())}
            onMarqueeStart={(additive) => {
              marqueeBase.current = additive ? new Set(selected) : new Set();
              if (!additive) setSelected(new Set());
            }}
            onMarquee={(lo, hi) => {
              const next = new Set(marqueeBase.current);
              for (let i = lo; i <= hi; i++) if (rows[i]) next.add(rows[i].path);
              setSelected(next);
              if (rows[lo] && rows[hi]) {
                anchor.current = rows[lo].path;
                cursor.current = rows[hi].path;
              }
            }}
            onOpen={openEntry}
            onOpenNewTab={(e) => navigate(e.path, true)}
            onContextMenu={(ev, e) => (e ? entryMenu(ev, e) : backgroundMenu(ev))}
            onRenameCommit={commitRename}
            onRenameCancel={() => setRenaming(null)}
            onDropInto={dropInto}
            onDragStateChange={setDragging}
          />
        </main>
      </div>
      <StatusBar
        right={
          <>
            <button
              className="theme-btn hist-btn"
              title={`History of operations (kept ${30} days) · ${history.length} recorded`}
              onClick={() => setHistoryOpen(true)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="5.8" />
                <path d="M8 4.6V8l2.3 1.5" />
              </svg>
              History
            </button>
            <ThemeButton theme={theme} onChange={(t) => update((x) => ({ ...x, theme: t }))} />
          </>
        }
        rows={rows}
        selected={selectedEntries}
        details={details}
        dragging={dragging}
        onRecycle={() => doDelete([...selected], false)}
        onBlackHole={() => doDelete([...selected], true)}
        onDropRecycle={() => doDelete(takeDragged(), false)}
        onDropBlackHole={() => doDelete(takeDragged(), true)}
      />
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {confirm && (
        <ConfirmModal
          names={confirm.paths.map((p) => p.split(/[\\/]/).pop() ?? p)}
          total={confirm.total}
          onCancel={() => setConfirm(null)}
          onConfirm={(dontAsk) => {
            const paths = confirm.paths;
            setConfirm(null);
            if (dontAsk) update((s) => ({ ...s, confirmPermanent: false }));
            runDelete(paths, true);
          }}
        />
      )}
      {dropChoice && (
        <DropChoiceModal
          names={dropChoice.paths.map(baseName)}
          destName={baseName(dropChoice.dest)}
          canPin={dropChoice.paths.every(isFolderPath)}
          onCancel={() => setDropChoice(null)}
          onMove={() => {
            const d = dropChoice;
            setDropChoice(null);
            doPaste(d.paths, d.dest, true);
          }}
          onCopy={() => {
            const d = dropChoice;
            setDropChoice(null);
            doPaste(d.paths, d.dest, false);
          }}
          onPin={() => {
            const d = dropChoice;
            setDropChoice(null);
            pinDropped(d.paths);
          }}
        />
      )}
      {historyOpen && (
        <HistoryModal
          onClose={() => setHistoryOpen(false)}
          onUndo={undoDelete}
          onOpenFolder={(p) => {
            setHistoryOpen(false);
            navigate(p);
          }}
        />
      )}
      {cleanerOpen && (
        <Cleaner
          projects={projects.list}
          onClose={() => setCleanerOpen(false)}
          onDone={(msg) => {
            flash(msg);
            reload();
          }}
        />
      )}
      {searchOpen && (
        <SearchPanel
          projects={projects.list}
          ignore={st.ignore ?? DEFAULT_IGNORE}
          onClose={() => setSearchOpen(false)}
          onOpenFolder={(p) => navigate(p, true)}
          onError={flash}
        />
      )}
      {commitsFor && <CommitsModal path={commitsFor} name={baseName(commitsFor)} onClose={() => setCommitsFor(null)} />}
      {jumpOpen && (
        <QuickJump
          items={[
            ...st.pins.map((p) => ({ path: p, name: baseName(p), pinned: true })),
            ...projects.list.filter((p) => !st.pins.includes(p.path)).map((p) => ({ path: p.path, name: p.name, pinned: false })),
          ]}
          stacks={projects.stacks}
          onGo={(p, newTab) => {
            setJumpOpen(false);
            navigate(p, newTab);
          }}
          onClose={() => setJumpOpen(false)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
