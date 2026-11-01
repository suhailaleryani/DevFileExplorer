import { useEffect, useRef, useState } from "react";
import type { Entry } from "./api";
import { FileIcon, VirtualList } from "./components";
import { dragState, formatDate, formatDateShort, formatSize, kindOf, typeLabel } from "./util";

export type SortKey = "name" | "modified" | "type" | "size";
export interface Sort {
  key: SortKey;
  asc: boolean;
}

const ROW = 30;

function RenameInput(props: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const dot = props.initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : props.initial.length);
  }, [props.initial]);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) props.onCommit(ref.current!.value.trim());
    else props.onCancel();
  };
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={props.initial}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

export function FileList(props: {
  cwd: string;
  rows: Entry[];
  selected: Set<string>;
  cutPaths: Set<string>;
  renaming: string | null;
  renameDraft: string | null;
  sort: Sort;
  error: string | null;
  folderSizes: Record<string, number>;
  sizing: Set<string>;
  onCalcSize: (e: Entry) => void;
  filterActive: boolean;
  revealIndex: number | null;
  onSort: (key: SortKey) => void;
  onSelect: (e: Entry, idx: number, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onSelectOnly: (e: Entry) => void;
  onClearSelection: () => void;
  onMarqueeStart: (additive: boolean) => void;
  onMarquee: (lo: number, hi: number) => void;
  onOpen: (e: Entry) => void;
  onOpenNewTab: (e: Entry) => void;
  onContextMenu: (ev: React.MouseEvent, e: Entry | null) => void;
  onRenameCommit: (e: Entry, name: string) => void;
  onRenameCancel: () => void;
  onDropInto: (dest: string, ev: React.DragEvent) => void;
  onDragStateChange: (dragging: boolean) => void;
}) {
  const { rows, selected, sort } = props;
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const arrow = (k: SortKey) => (sort.key === k ? (sort.asc ? " ▲" : " ▼") : "");

  const render = (i: number) => {
    const e = rows[i];
    const sel = selected.has(e.path);
    return (
      <div
        className={
          "row" +
          (sel ? " sel" : "") +
          (props.cutPaths.has(e.path) ? " cut" : "") +
          (dropTarget === e.path ? " drop" : "")
        }
        onClick={(ev) => props.onSelect(e, i, ev)}
        onDoubleClick={() => props.onOpen(e)}
        onMouseDown={(ev) => {
          if (ev.button === 1) ev.preventDefault();
          // Only the icon and name start a file drag; the rest of the row starts a selection rectangle.
          ev.currentTarget.draggable = props.renaming !== e.path && !!(ev.target as HTMLElement).closest(".name-text, .ficon");
        }}
        onAuxClick={(ev) => {
          if (ev.button === 1 && e.isDir) props.onOpenNewTab(e);
        }}
        onContextMenu={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!sel) props.onSelectOnly(e);
          props.onContextMenu(ev, e);
        }}
        onDragStart={(ev) => {
          const paths = sel ? [...selected] : [e.path];
          if (!sel) props.onSelectOnly(e);
          dragState.paths = paths;
          ev.dataTransfer.setData("text/plain", paths.join("\n"));
          ev.dataTransfer.effectAllowed = "copyMove";
          props.onDragStateChange(true);
        }}
        onDragEnd={() => {
          dragState.paths = [];
          setDropTarget(null);
          props.onDragStateChange(false);
        }}
        onDragOver={(ev) => {
          if (!e.isDir || dragState.paths.includes(e.path)) return;
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = ev.ctrlKey || ev.altKey ? "copy" : "move";
          if (dropTarget !== e.path) setDropTarget(e.path);
        }}
        onDragLeave={() => dropTarget === e.path && setDropTarget(null)}
        onDrop={(ev) => {
          if (!e.isDir) return;
          ev.stopPropagation();
          setDropTarget(null);
          props.onDropInto(e.path, ev);
        }}
      >
        <span className="c-name">
          <FileIcon kind={kindOf(e)} />
          {props.renaming === e.path ? (
            <RenameInput
              initial={props.renameDraft ?? e.name}
              onCommit={(n) => props.onRenameCommit(e, n)}
              onCancel={props.onRenameCancel}
            />
          ) : (
            <span className="name-text">{e.name}</span>
          )}
        </span>
        <span className="c-mod" title={formatDate(e.modified)}>{formatDateShort(e.modified)}</span>
        <span className="c-type">{typeLabel(e)}</span>
        <span className="c-size">
          {!e.isDir ? (
            formatSize(e.size)
          ) : props.folderSizes[e.path] !== undefined ? (
            formatSize(props.folderSizes[e.path])
          ) : props.sizing.has(e.path) ? (
            <span className="calculating">…</span>
          ) : (
            <button
              className="calc"
              title="Calculate folder size"
              onClick={(ev) => {
                ev.stopPropagation();
                props.onCalcSize(e);
              }}
            >
              <span className="dash">—</span>
              <span className="lbl">calculate</span>
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="filelist">
      <div className="head">
        <span className={"c-name" + (sort.key === "name" ? " sorted" : "")} onClick={() => props.onSort("name")}>
          Name{arrow("name")}
        </span>
        <span className={"c-mod" + (sort.key === "modified" ? " sorted" : "")} onClick={() => props.onSort("modified")}>
          Date modified{arrow("modified")}
        </span>
        <span className={"c-type" + (sort.key === "type" ? " sorted" : "")} onClick={() => props.onSort("type")}>
          Type{arrow("type")}
        </span>
        <span className={"c-size" + (sort.key === "size" ? " sorted" : "")} onClick={() => props.onSort("size")}>
          Size{arrow("size")}
        </span>
      </div>
      {props.error ? (
        <div className="empty error">{props.error}</div>
      ) : rows.length === 0 ? (
        <div
          className="empty"
          onContextMenu={(ev) => {
            ev.preventDefault();
            props.onContextMenu(ev, null);
          }}
          onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => props.onDropInto(props.cwd, ev)}
        >
          <div className="empty-icon">{props.filterActive ? "🔍" : "📭"}</div>
          {props.filterActive ? "No items match the filter" : "This folder is empty"}
          {!props.filterActive && <div className="empty-sub">Right-click to create a folder or file, or drop items here.</div>}
        </div>
      ) : (
        <VirtualList
          key={props.cwd}
          className="rows"
          count={rows.length}
          rowHeight={ROW}
          revealIndex={props.revealIndex}
          onMarqueeStart={props.onMarqueeStart}
          onMarquee={props.onMarquee}
          onEmptyClick={(additive) => !additive && props.onClearSelection()}
          keyOf={(i) => rows[i].path}
          render={render}
          onBackgroundContextMenu={(ev) => {
            ev.preventDefault();
            props.onClearSelection();
            props.onContextMenu(ev, null);
          }}
          onDragOver={(ev) => {
            ev.preventDefault();
            ev.dataTransfer.dropEffect = ev.ctrlKey || ev.altKey ? "copy" : "move";
          }}
          onDrop={(ev) => props.onDropInto(props.cwd, ev)}
        />
      )}
    </div>
  );
}
