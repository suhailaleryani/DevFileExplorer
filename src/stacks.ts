/** Stack ids come from the Rust `project_stack` command. */
export const STACKS: Record<string, { label: string; color: string }> = {
  tauri: { label: "Tauri", color: "#e0a526" },
  next: { label: "Next.js", color: "#9aa4b2" },
  react: { label: "React", color: "#2fb8d6" },
  vue: { label: "Vue", color: "#3fb27f" },
  svelte: { label: "Svelte", color: "#ee5a2b" },
  angular: { label: "Angular", color: "#dd3040" },
  reactnative: { label: "RN", color: "#3a9bd9" },
  electron: { label: "Electron", color: "#4aa3b5" },
  flutter: { label: "Flutter", color: "#3b8fe8" },
  unity: { label: "Unity", color: "#8a8f98" },
  unreal: { label: "Unreal", color: "#6a7cd6" },
  wordpress: { label: "WordPress", color: "#3b7fb5" },
  rust: { label: "Rust", color: "#d2744a" },
  ts: { label: "TS", color: "#3b82d6" },
  node: { label: "Node", color: "#5fa84a" },
  python: { label: "Python", color: "#d4b72a" },
  dotnet: { label: ".NET", color: "#8a5cd6" },
  java: { label: "Java", color: "#d9803a" },
  go: { label: "Go", color: "#2fb5c4" },
  php: { label: "PHP", color: "#7a86c4" },
  ruby: { label: "Ruby", color: "#d04050" },
  cpp: { label: "C++", color: "#5a7fc4" },
  docker: { label: "Docker", color: "#2f90d9" },
  firebase: { label: "Firebase", color: "#e8a020" },
};

export const stackLabel = (id: string) => STACKS[id]?.label ?? id;
