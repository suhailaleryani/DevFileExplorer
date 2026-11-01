import { useEffect, useMemo, useRef, useState } from "react";
import { STACKS, stackLabel } from "./stacks";
import { baseName, parentOf } from "./util";

export interface JumpItem {
  path: string;
  name: string;
  pinned: boolean;
}

/** 0 = no match; higher is better. Prefix beats substring beats loose letters-in-order. */
function score(name: string, q: string): number {
  if (!q) return 1;
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 4;
  const i = n.indexOf(q);
  if (i >= 0) return n[i - 1] === " " || n[i - 1] === "-" || n[i - 1] === "_" ? 3.5 : 3;
  let k = 0;
  for (const ch of n) if (ch === q[k]) k++;
  return k === q.length ? 2 : 0;
}

/** Ctrl+K: type part of a project name, Enter opens it, Ctrl+Enter opens it in a new tab. */
export function QuickJump(props: {
  items: JumpItem[];
  stacks: Record<string, string[]>;
  onGo: (path: string, newTab: boolean) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return props.items
      .map((it) => ({ it, s: score(it.name, ql) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || Number(b.it.pinned) - Number(a.it.pinned) || a.it.name.localeCompare(b.it.name))
      .slice(0, 50)
      .map((x) => x.it);
  }, [q, props.items]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".qj-row.on")?.scrollIntoView({ block: "nearest" });
  }, [idx, results]);

  return (
    <div className="qj-back" onMouseDown={props.onClose}>
      <div className="qj" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Jump to project…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") props.onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[idx]) {
              props.onGo(results[idx].path, e.ctrlKey || e.metaKey);
            }
          }}
        />
        <div className="qj-list" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.path}
              className={"qj-row" + (i === idx ? " on" : "")}
              onMouseMove={() => setIdx(i)}
              onClick={(e) => props.onGo(r.path, e.ctrlKey || e.metaKey)}
              onAuxClick={(e) => e.button === 1 && props.onGo(r.path, true)}
              title={r.path}
            >
              <span className="qj-name">{r.name}</span>
              {r.pinned && <span className="qj-pin">pinned</span>}
              <span className="chips">
                {(props.stacks[r.path] ?? []).slice(0, 3).map((id) => (
                  <span key={id} className="chip" style={{ ["--c" as string]: STACKS[id]?.color }}>
                    {stackLabel(id)}
                  </span>
                ))}
              </span>
              <span className="qj-sub">{baseName(parentOf(r.path))}</span>
            </div>
          ))}
          {results.length === 0 && <div className="hint">No match.</div>}
        </div>
        <div className="qj-foot">↑↓ choose · Enter open · Ctrl+Enter new tab · Esc close</div>
      </div>
    </div>
  );
}
