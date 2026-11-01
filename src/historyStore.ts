// Shared in-memory store for the operation history, saved to history.json (separate from state.json).
import { useSyncExternalStore } from "react";
import { loadHistory, saveHistory } from "./api";
import { type HEntry, type HInput, makeEntry, mergeHistory, parseHistory, pruneHistory } from "./historyLog.ts";

let entries: HEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

const emit = () => listeners.forEach((l) => l());

function scheduleSave() {
  if (!loaded) return; // never overwrite the file before it has been read
  clearTimeout(timer);
  timer = setTimeout(() => {
    entries = pruneHistory(entries); // old entries also leave the file
    saveHistory(JSON.stringify({ version: 1, entries })).catch(() => {});
  }, 500);
}

export async function initHistory() {
  let saved: HEntry[] = [];
  try {
    saved = parseHistory(await loadHistory());
  } catch {
    /* no file yet */
  }
  entries = mergeHistory(saved, entries);
  loaded = true;
  emit();
  scheduleSave(); // writes the pruned list back
}

/** Record an operation. Safe to call from anywhere, any time. */
export function logOp(input: HInput) {
  entries = pruneHistory([makeEntry(input), ...entries]);
  emit();
  scheduleSave();
}

/** Change one entry in place (used by Undo). */
export function updateEntry(id: string, patch: Partial<HEntry>) {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  emit();
  scheduleSave();
}

export function clearHistory() {
  entries = [];
  emit();
  scheduleSave();
}

export function useHistory(): HEntry[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => entries,
  );
}
