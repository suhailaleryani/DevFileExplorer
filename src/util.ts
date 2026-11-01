import type { Entry } from "./api";

export function baseName(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  return (i < 0 ? t : t.slice(i + 1)) || p;
}

export function parentOf(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  if (i < 0) return p;
  const parent = t.slice(0, i);
  if (/^[A-Za-z]:$/.test(parent)) return parent + "\\";
  return parent || "/";
}

export function crumbs(path: string): { name: string; path: string }[] {
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return [{ name: "/", path: "/" }];
  const out: { name: string; path: string }[] = [];
  let acc = "";
  parts.forEach((p, i) => {
    if (i === 0) acc = sep === "/" ? "/" + p : p + "\\";
    else acc = (acc.endsWith(sep) ? acc : acc + sep) + p;
    out.push({ name: p, path: acc });
  });
  return out;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

export function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Compact date for lists: no year when it is the current one, no time when older. */
export function formatDateShort(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const TYPE_NAMES: Record<string, string> = {
  md: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", txt: "Text", log: "Log",
  ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript React",
  py: "Python", rs: "Rust", go: "Go", java: "Java", cs: "C#", c: "C", cpp: "C++", h: "C header", php: "PHP", rb: "Ruby",
  html: "HTML", css: "CSS", scss: "SCSS", sql: "SQL", sh: "Shell script", ps1: "PowerShell", bat: "Batch file",
  pdf: "PDF document", doc: "Word document", docx: "Word document", xls: "Excel sheet", xlsx: "Excel sheet", csv: "CSV",
  png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image", gif: "GIF image", webp: "WebP image", svg: "SVG image", ico: "Icon",
  mp4: "MP4 video", mkv: "MKV video", mov: "QuickTime video", mp3: "MP3 audio", wav: "WAV audio", flac: "FLAC audio",
  zip: "ZIP archive", rar: "RAR archive", "7z": "7-Zip archive", gz: "GZ archive", tar: "TAR archive", tgz: "TGZ archive",
  exe: "Application", msi: "Installer", dll: "DLL library", lock: "Lock file", env: "Environment file",
};

export function typeLabel(e: Entry): string {
  if (e.isDir) return "Folder";
  if (!e.ext) return "File";
  return TYPE_NAMES[e.ext.toLowerCase()] ?? `${e.ext.toUpperCase()} file`;
}

const KINDS: Record<string, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"],
  video: ["mp4", "mkv", "mov", "avi", "webm"],
  audio: ["mp3", "wav", "flac", "ogg", "m4a"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz"],
  pdf: ["pdf"],
  doc: ["md", "txt", "rtf", "doc", "docx", "log"],
  sheet: ["xls", "xlsx", "csv"],
  code: ["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "cs", "html", "css", "scss", "php", "rb", "sh", "ps1", "bat", "sql"],
  config: ["json", "toml", "yaml", "yml", "xml", "ini", "env", "lock", "config"],
  exe: ["exe", "msi", "dll", "app"],
};
const KIND_BY_EXT = new Map<string, string>();
for (const [k, exts] of Object.entries(KINDS)) exts.forEach((x) => KIND_BY_EXT.set(x, k));

/** Category used to pick an icon colour: folder, image, code, pdf, … or "file". */
export function kindOf(e: Entry): string {
  if (e.isDir) return "folder";
  return KIND_BY_EXT.get(e.ext.toLowerCase()) ?? "file";
}

const DAY = 86_400_000;

export function ageClass(ms: number, t: [number, number, number]): string {
  if (!ms) return "age-none";
  const d = (Date.now() - ms) / DAY;
  if (d < t[0]) return "age-green";
  if (d < t[1]) return "age-yellow";
  if (d < t[2]) return "age-orange";
  return "age-red";
}

export function ageLabel(ms: number): string {
  if (!ms) return "—";
  const d = Math.floor((Date.now() - ms) / DAY);
  if (d < 1) return "today";
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 730) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** Paths currently being dragged. HTML5 drag data is unreadable during dragover, so keep it here. */
export const dragState: { paths: string[]; pin: string | null } = { paths: [], pin: null };
