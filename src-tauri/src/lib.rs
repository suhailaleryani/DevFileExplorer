use rayon::prelude::*;
use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant, SystemTime},
};
use tauri::Manager;

// ---------- helpers ----------

fn ms(t: io::Result<SystemTime>) -> i64 {
    t.ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Run blocking work off the async runtime so the UI never waits on disk.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[allow(unused_mut)]
fn hidden(mut c: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

// ---------- listing & sizes ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: i64,
    created: i64,
    ext: String,
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    blocking(move || {
        let rd = fs::read_dir(&path).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for e in rd.flatten() {
            let md = match e.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let p = e.path();
            let ext = p
                .extension()
                .map(|x| x.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            out.push(Entry {
                name: e.file_name().to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                is_dir: md.is_dir(),
                size: if md.is_dir() { 0 } else { md.len() },
                modified: ms(md.modified()),
                created: ms(md.created()),
                ext,
            });
        }
        Ok(out)
    })
    .await
}

#[derive(Serialize, Default)]
struct SizeInfo {
    size: u64,
    files: u64,
    folders: u64,
    /// true when the scan hit its time budget, so `size` is a lower bound
    partial: bool,
}

#[tauri::command]
async fn dir_size(path: String, budget_ms: Option<u64>) -> Result<SizeInfo, String> {
    blocking(move || {
        // Few threads and a time budget: a huge folder must never starve the rest of the app.
        let started = Instant::now();
        let budget = Duration::from_millis(budget_ms.unwrap_or(6000));
        let mut s = SizeInfo::default();
        let walker = jwalk::WalkDir::new(&path)
            .skip_hidden(false)
            .follow_links(false)
            .parallelism(jwalk::Parallelism::RayonNewPool(2));
        for (n, e) in walker.into_iter().enumerate() {
            if n % 256 == 0 && started.elapsed() > budget {
                s.partial = true;
                break;
            }
            if let Ok(e) = e {
                if e.depth() == 0 {
                    continue;
                }
                if e.file_type().is_dir() {
                    s.folders += 1;
                } else {
                    s.files += 1;
                    if let Ok(m) = e.metadata() {
                        s.size += m.len();
                    }
                }
            }
        }
        Ok(s)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInfo {
    folder_modified: i64,
    content_modified: i64,
}

/// Newest file change inside a project, skipping heavy/generated folders.
#[tauri::command]
async fn project_info(path: String, ignore: Vec<String>) -> Result<ProjectInfo, String> {
    blocking(move || {
        // Huge folders must not stall the dashboard: scan for a short time and report the newest file seen so far.
        let started = Instant::now();
        let budget = Duration::from_millis(1500);
        let mut ignore = ignore;
        for extra in ["vendor", "build", "out", ".gradle", ".cache", ".turbo", "Pods", ".idea", ".vs", "venv", "env", "site-packages", ".cargo", ".npm", ".pnpm-store"] {
            if !ignore.iter().any(|i| i == extra) {
                ignore.push(extra.to_string());
            }
        }
        let folder_modified = ms(fs::metadata(&path).and_then(|m| m.modified()));
        let walker = jwalk::WalkDir::new(&path)
            .skip_hidden(false)
            .follow_links(false)
            .parallelism(jwalk::Parallelism::RayonNewPool(2))
            .process_read_dir(move |_, _, _, children| {
                children.retain(|c| match c {
                    Ok(e) => {
                        !(e.file_type().is_dir()
                            && ignore.iter().any(|i| i.as_str() == e.file_name().to_string_lossy()))
                    }
                    Err(_) => true,
                });
            });
        let mut newest = 0i64;
        for (n, e) in walker.into_iter().flatten().enumerate() {
            if n % 256 == 0 && started.elapsed() > budget {
                break;
            }
            if e.depth() == 0 || e.file_type().is_dir() {
                continue;
            }
            if let Ok(m) = e.metadata() {
                newest = newest.max(ms(m.modified()));
            }
        }
        Ok(ProjectInfo {
            folder_modified,
            content_modified: newest,
        })
    })
    .await
}

// ---------- git (optional) ----------

/// Path to git: the usual install folders first (git is often installed but missing from PATH), else plain `git`.
fn git_exe() -> std::ffi::OsString {
    static EXE: std::sync::OnceLock<std::ffi::OsString> = std::sync::OnceLock::new();
    EXE.get_or_init(|| {
        let mut candidates: Vec<PathBuf> = Vec::new();
        for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var) {
                let base = PathBuf::from(base);
                if var == "LOCALAPPDATA" {
                    candidates.push(base.join("Programs").join("Git").join("cmd").join("git.exe"));
                } else {
                    candidates.push(base.join("Git").join("cmd").join("git.exe"));
                }
            }
        }
        let on_path = hidden(Command::new("git")).arg("--version").output().is_ok();
        if on_path {
            return std::ffi::OsString::from("git");
        }
        candidates
            .into_iter()
            .find(|p| p.is_file())
            .map(PathBuf::into_os_string)
            .unwrap_or_else(|| std::ffi::OsString::from("git"))
    })
    .clone()
}

fn git_out(dir: &str, args: &[&str]) -> Option<String> {
    let mut c = hidden(Command::new(git_exe()));
    c.args(["-C", dir]).args(args);
    let out = c.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
fn git_available() -> bool {
    hidden(Command::new(git_exe())).arg("--version").output().is_ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitInfo {
    branch: String,
    dirty: bool,
    dirty_count: u32,
    last_commit: i64,
    last_message: String,
    ahead: u32,
    behind: u32,
    /// the branch tracks a remote branch
    has_upstream: bool,
    /// the repository has at least one remote configured
    has_remote: bool,
}

#[tauri::command]
async fn git_info(path: String) -> Result<Option<GitInfo>, String> {
    blocking(move || {
        if !Path::new(&path).join(".git").exists() {
            return Ok(None);
        }
        let Some(branch) = git_out(&path, &["rev-parse", "--abbrev-ref", "HEAD"]) else {
            return Ok(None);
        };
        let dirty_count = git_out(&path, &["status", "--porcelain"])
            .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
            .unwrap_or(0);
        let last_commit = git_out(&path, &["log", "-1", "--format=%ct"])
            .and_then(|s| s.parse::<i64>().ok())
            .map(|s| s * 1000)
            .unwrap_or(0);
        let last_message = git_out(&path, &["log", "-1", "--format=%s"]).unwrap_or_default();
        let has_upstream = git_out(&path, &["rev-parse", "--abbrev-ref", "@{u}"]).is_some();
        let (ahead, behind) = if has_upstream {
            (
                git_out(&path, &["rev-list", "--count", "@{u}..HEAD"]).and_then(|s| s.parse().ok()).unwrap_or(0),
                git_out(&path, &["rev-list", "--count", "HEAD..@{u}"]).and_then(|s| s.parse().ok()).unwrap_or(0),
            )
        } else {
            (0, 0)
        };
        let has_remote = git_out(&path, &["remote"]).map(|s| !s.is_empty()).unwrap_or(false);
        Ok(Some(GitInfo {
            branch,
            dirty: dirty_count > 0,
            dirty_count,
            last_commit,
            last_message,
            ahead,
            behind,
            has_upstream,
            has_remote,
        }))
    })
    .await
}

// ---------- tech stack detection ----------

const STACK_ORDER: [&str; 24] = [
    "tauri", "next", "react", "vue", "svelte", "angular", "reactnative", "electron", "flutter", "unity", "unreal",
    "wordpress", "rust", "ts", "node", "python", "dotnet", "java", "go", "php", "ruby", "cpp", "docker", "firebase",
];

fn scan_stack(dir: &Path, found: &mut Vec<&'static str>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()).collect();
    let has = |n: &str| names.iter().any(|x| x == n);
    let has_ext = |ext: &str| names.iter().any(|x| x.ends_with(ext));
    let mut add = |id: &'static str| {
        if !found.contains(&id) {
            found.push(id);
        }
    };
    if has("src-tauri") {
        add("tauri");
    }
    if has("package.json") {
        add("node");
        if let Ok(txt) = fs::read_to_string(dir.join("package.json")) {
            if txt.len() < 1_000_000 {
                for (needle, id) in [
                    ("\"next\"", "next"),
                    ("\"react\"", "react"),
                    ("\"vue\"", "vue"),
                    ("\"svelte\"", "svelte"),
                    ("\"@angular/core\"", "angular"),
                    ("\"react-native\"", "reactnative"),
                    ("\"electron\"", "electron"),
                ] {
                    if txt.contains(needle) {
                        add(id);
                    }
                }
            }
        }
    }
    if has("tsconfig.json") {
        add("ts");
    }
    if has("cargo.toml") {
        add("rust");
    }
    if has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("pipfile") {
        add("python");
    }
    if has_ext(".sln") || has_ext(".csproj") || has_ext(".fsproj") || has_ext(".vbproj") {
        add("dotnet");
    }
    if has("pom.xml") || has("build.gradle") || has("build.gradle.kts") || has("settings.gradle") {
        add("java");
    }
    if has("go.mod") {
        add("go");
    }
    if has("composer.json") {
        add("php");
    }
    if has("gemfile") {
        add("ruby");
    }
    if has("pubspec.yaml") {
        add("flutter");
    }
    if has("cmakelists.txt") {
        add("cpp");
    }
    if has("dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml") || has("compose.yaml") {
        add("docker");
    }
    if has("firebase.json") {
        add("firebase");
    }
    if has("projectsettings") && has("assets") {
        add("unity");
    }
    if has_ext(".uproject") {
        add("unreal");
    }
    if has("wp-config.php") || has("wp-content") {
        add("wordpress");
    }
}

/// Guess a project's tech stack from marker files in its root and common monorepo folders.
#[tauri::command]
async fn project_stack(path: String) -> Result<Vec<String>, String> {
    blocking(move || {
        let root = PathBuf::from(&path);
        let mut found: Vec<&'static str> = Vec::new();
        scan_stack(&root, &mut found);
        for name in ["apps", "packages", "services", "web", "frontend", "backend", "server", "client", "api", "app", "mobile"] {
            let d = root.join(name);
            if !d.is_dir() {
                continue;
            }
            scan_stack(&d, &mut found);
            if matches!(name, "apps" | "packages" | "services") {
                if let Ok(rd) = fs::read_dir(&d) {
                    for e in rd.flatten().take(12) {
                        if e.path().is_dir() {
                            scan_stack(&e.path(), &mut found);
                        }
                    }
                }
            }
        }
        let mut out: Vec<String> = Vec::new();
        for id in STACK_ORDER {
            if found.contains(&id) {
                out.push(id.to_string());
            }
        }
        Ok(out)
    })
    .await
}

// ---------- disk space cleaner ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Cleanable {
    path: String,
    kind: String,
    modified: i64,
}

/// Which regenerable folder is `dir`/`name`, judged by its siblings (so a plain `target` or `dist` is left alone).
fn cleanable_kind(parent: &Path, name: &str, dir: &Path) -> Option<&'static str> {
    let sib = |n: &str| parent.join(n).exists();
    match name {
        "node_modules" => Some("node_modules"),
        "target" if sib("Cargo.toml") => Some("Rust target"),
        ".next" | ".nuxt" | ".svelte-kit" | ".turbo" | ".parcel-cache" => Some("build cache"),
        "dist" if sib("package.json") => Some("dist"),
        ".venv" | "venv" | "env" if dir.join("pyvenv.cfg").exists() => Some("Python venv"),
        "bin" | "obj"
            if fs::read_dir(parent)
                .map(|rd| rd.flatten().any(|e| {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    n.ends_with(".csproj") || n.ends_with(".fsproj") || n.ends_with(".vbproj")
                }))
                .unwrap_or(false) =>
        {
            Some(".NET build")
        }
        _ => None,
    }
}

fn find_cleanable_in(dir: &Path, depth: u32, out: &mut Vec<Cleanable>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path();
        if let Some(kind) = cleanable_kind(dir, &name, &p) {
            out.push(Cleanable {
                path: p.to_string_lossy().to_string(),
                kind: kind.to_string(),
                modified: ms(e.metadata().and_then(|m| m.modified())),
            });
        } else if depth < 4 && name != ".git" {
            find_cleanable_in(&p, depth + 1, out);
        }
    }
}

/// Regenerable folders (node_modules, build output, virtual environments) inside one project. No sizes: those are asked for lazily.
#[tauri::command]
async fn find_cleanable(path: String) -> Result<Vec<Cleanable>, String> {
    blocking(move || {
        let mut out = Vec::new();
        find_cleanable_in(Path::new(&path), 0, &mut out);
        Ok(out)
    })
    .await
}

// ---------- file operations ----------

#[derive(Serialize)]
struct OpResult {
    ok: u64,
    failed: Vec<String>,
}

fn remove_file_forced(p: &Path) -> io::Result<()> {
    match fs::remove_file(p) {
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            if let Ok(m) = fs::metadata(p) {
                let mut perm = m.permissions();
                perm.set_readonly(false);
                let _ = fs::set_permissions(p, perm);
            }
            fs::remove_file(p)
        }
        r => r,
    }
}

/// Parallel recursive delete: children are removed on all cores.
fn remove_tree(p: &Path) -> io::Result<()> {
    let md = fs::symlink_metadata(p)?;
    if md.is_dir() {
        let kids: Vec<PathBuf> = fs::read_dir(p)?.flatten().map(|e| e.path()).collect();
        let first_err = kids.par_iter().filter_map(|k| remove_tree(k).err()).collect::<Vec<_>>();
        if let Some(e) = first_err.into_iter().next() {
            return Err(e);
        }
        fs::remove_dir(p)
    } else {
        remove_file_forced(p)
    }
}

#[tauri::command]
async fn delete_paths(paths: Vec<String>, permanent: bool) -> Result<OpResult, String> {
    blocking(move || {
        if permanent {
            let results: Vec<(String, io::Result<()>)> = paths
                .par_iter()
                .map(|p| (p.clone(), remove_tree(Path::new(p))))
                .collect();
            let mut ok = 0;
            let mut failed = Vec::new();
            for (p, r) in results {
                match r {
                    Ok(_) => ok += 1,
                    Err(e) => failed.push(format!("{p}: {e}")),
                }
            }
            Ok(OpResult { ok, failed })
        } else {
            match trash::delete_all(&paths) {
                Ok(_) => Ok(OpResult {
                    ok: paths.len() as u64,
                    failed: vec![],
                }),
                Err(e) => Ok(OpResult {
                    ok: 0,
                    failed: paths.iter().map(|p| format!("{p}: {e}")).collect(),
                }),
            }
        }
    })
    .await
}

fn unique_target(dest: &Path, name: &str, is_dir: bool) -> PathBuf {
    let t = dest.join(name);
    if !t.exists() {
        return t;
    }
    let (stem, ext) = if is_dir {
        (name.to_string(), String::new())
    } else {
        let p = Path::new(name);
        (
            p.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| name.to_string()),
            p.extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default(),
        )
    };
    let mut i = 1;
    loop {
        let cand = if i == 1 {
            format!("{stem} - copy{ext}")
        } else {
            format!("{stem} - copy ({i}){ext}")
        };
        let t = dest.join(cand);
        if !t.exists() {
            return t;
        }
        i += 1;
    }
}

fn copy_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for e in fs::read_dir(src)?.flatten() {
            copy_recursive(&e.path(), &dst.join(e.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

/// Copy or move into `dest`. Name clashes keep both ("name - copy").
#[tauri::command]
async fn paste_paths(paths: Vec<String>, dest: String, cut: bool) -> Result<OpResult, String> {
    blocking(move || {
        let dest = PathBuf::from(&dest);
        let mut ok = 0;
        let mut failed = Vec::new();
        for p in paths {
            let src = PathBuf::from(&p);
            let Some(name) = src.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            let is_dir = src.is_dir();
            if is_dir && dest.starts_with(&src) {
                failed.push(format!("{p}: cannot copy a folder into itself"));
                continue;
            }
            if cut && src.parent() == Some(dest.as_path()) {
                continue; // moving into the same folder is a no-op
            }
            let target = unique_target(&dest, &name, is_dir);
            let res = if cut {
                rename_retry(&src, &target).or_else(|_| {
                    copy_recursive(&src, &target).and_then(|_| {
                        if is_dir {
                            fs::remove_dir_all(&src)
                        } else {
                            fs::remove_file(&src)
                        }
                    })
                })
            } else {
                copy_recursive(&src, &target)
            };
            match res {
                Ok(_) => ok += 1,
                Err(e) => failed.push(format!("{p}: {e}")),
            }
        }
        Ok(OpResult { ok, failed })
    })
    .await
}

/// Rename/move that tolerates short-lived locks (antivirus, our own background scans).
fn rename_retry(src: &Path, target: &Path) -> io::Result<()> {
    let mut last = None;
    for attempt in 0..12 {
        match fs::rename(src, target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                // 5 = access denied, 32/33 = sharing/lock violation on Windows
                let busy = e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5 | 32 | 33));
                if !busy {
                    return Err(e);
                }
                last = Some(e);
                std::thread::sleep(Duration::from_millis(150 + attempt * 20));
            }
        }
    }
    Err(last.unwrap_or_else(|| io::Error::other("rename failed")))
}

#[tauri::command]
async fn rename_path(path: String, new_name: String) -> Result<String, String> {
    blocking(move || {
        if new_name.is_empty() || new_name.contains(['/', '\\']) {
            return Err("Invalid name".to_string());
        }
        let src = PathBuf::from(&path);
        let target = src.parent().ok_or("No parent folder")?.join(&new_name);
        if target.exists() && target != src {
            // allow case-only renames on case-insensitive file systems
            let same_file = target.to_string_lossy().to_lowercase() == src.to_string_lossy().to_lowercase();
            if !same_file {
                return Err(format!("\"{new_name}\" already exists"));
            }
        }
        rename_retry(&src, &target).map_err(|e| {
            if e.kind() == io::ErrorKind::PermissionDenied {
                format!("Could not rename: the folder is in use by another program ({e})")
            } else {
                e.to_string()
            }
        })?;
        Ok(target.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
fn create_entry(parent: String, name: String, is_dir: bool) -> Result<String, String> {
    let target = unique_target(Path::new(&parent), &name, is_dir);
    if is_dir {
        fs::create_dir(&target)
    } else {
        fs::File::create(&target).map(|_| ())
    }
    .map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

// ---------- open in ----------

#[cfg(windows)]
fn open_explorer(p: &str) -> io::Result<()> {
    Command::new("explorer").arg(p).spawn().map(|_| ())
}
#[cfg(target_os = "macos")]
fn open_explorer(p: &str) -> io::Result<()> {
    Command::new("open").arg(p).spawn().map(|_| ())
}
#[cfg(all(unix, not(target_os = "macos")))]
fn open_explorer(p: &str) -> io::Result<()> {
    Command::new("xdg-open").arg(p).spawn().map(|_| ())
}

#[cfg(windows)]
fn open_code(p: &str) -> io::Result<()> {
    hidden(Command::new("cmd")).args(["/C", "code", p]).spawn().map(|_| ())
}
#[cfg(not(windows))]
fn open_code(p: &str) -> io::Result<()> {
    Command::new("code").arg(p).spawn().map(|_| ())
}

#[cfg(windows)]
fn open_terminal(p: &str) -> io::Result<()> {
    hidden(Command::new("cmd"))
        .args(["/C", "start", "", "/D", p, "cmd"])
        .spawn()
        .map(|_| ())
}
#[cfg(target_os = "macos")]
fn open_terminal(p: &str) -> io::Result<()> {
    Command::new("open").args(["-a", "Terminal", p]).spawn().map(|_| ())
}
#[cfg(all(unix, not(target_os = "macos")))]
fn open_terminal(_p: &str) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "terminal not supported on this OS yet"))
}

/// kind: "explorer" (OS default; also opens files), "code", "terminal".
#[tauri::command]
fn open_in(path: String, kind: String) -> Result<(), String> {
    match kind.as_str() {
        "explorer" => open_explorer(&path),
        "code" => open_code(&path),
        "terminal" => open_terminal(&path),
        _ => Err(io::Error::new(io::ErrorKind::InvalidInput, "unknown target")),
    }
    .map_err(|e| e.to_string())
}

// ---------- run scripts ----------

#[derive(Serialize)]
struct ScriptItem {
    name: String,
    source: String,
    command: String,
}

fn package_manager(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

/// Script names are put on a command line, so only plain characters are allowed.
fn safe_script_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() < 100
        && !n.starts_with('-')
        && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-' | '.' | '@' | '/'))
}

fn list_scripts(dir: &Path) -> Vec<ScriptItem> {
    let mut out = Vec::new();
    if let Ok(txt) = fs::read_to_string(dir.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(obj) = v.get("scripts").and_then(|s| s.as_object()) {
                let pm = package_manager(dir);
                let mut names: Vec<&String> = obj.keys().filter(|k| safe_script_name(k)).collect();
                let prio = ["dev", "start", "build", "test", "lint"];
                names.sort_by_key(|n| (prio.iter().position(|p| p == n).unwrap_or(99), (*n).clone()));
                for k in names {
                    out.push(ScriptItem {
                        name: k.clone(),
                        source: pm.to_string(),
                        command: format!("{pm} run {k}"),
                    });
                }
            }
        }
    }
    if dir.join("Cargo.toml").exists() {
        for n in ["run", "build", "test", "check"] {
            out.push(ScriptItem {
                name: n.to_string(),
                source: "cargo".to_string(),
                command: format!("cargo {n}"),
            });
        }
    }
    out
}

#[tauri::command]
async fn project_scripts(path: String) -> Result<Vec<ScriptItem>, String> {
    blocking(move || Ok(list_scripts(Path::new(&path)))).await
}

/// Run one of the project's own scripts in a new terminal window. The command is rebuilt here from a name that
/// must exist in the project, never taken from the page as free text.
#[tauri::command]
fn run_script(path: String, source: String, name: String) -> Result<(), String> {
    let item = list_scripts(Path::new(&path))
        .into_iter()
        .find(|s| s.source == source && s.name == name)
        .ok_or_else(|| "that script no longer exists".to_string())?;
    #[cfg(windows)]
    {
        hidden(Command::new("cmd"))
            .args(["/C", "start", "", "/D", &path, "cmd", "/K", &item.command])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = item;
        Err("running scripts is only supported on Windows for now".to_string())
    }
}

// ---------- git actions ----------

fn git_try(dir: &str, args: &[&str]) -> Result<String, String> {
    let mut c = hidden(Command::new(git_exe()));
    c.env("GIT_TERMINAL_PROMPT", "0").args(["-C", dir]).args(args);
    let out = c.output().map_err(|e| e.to_string())?;
    let so = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let se = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if out.status.success() {
        Ok(if so.is_empty() { se } else { so })
    } else {
        Err(if se.is_empty() { so } else { se })
    }
}

/// action: "fetch" (all remotes, pruned) or "pull" (fast-forward only, so it never makes a merge commit or conflict).
#[tauri::command]
async fn git_sync(path: String, action: String) -> Result<String, String> {
    blocking(move || match action.as_str() {
        "fetch" => git_try(&path, &["fetch", "--all", "--prune"]),
        "pull" => git_try(&path, &["pull", "--ff-only"]),
        _ => Err("unknown git action".to_string()),
    })
    .await
}

#[derive(Serialize)]
struct BranchList {
    current: String,
    branches: Vec<String>,
}

#[tauri::command]
async fn git_branches(path: String) -> Result<BranchList, String> {
    blocking(move || {
        let current = git_try(&path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        let list = git_try(&path, &["branch", "--format=%(refname:short)"])?;
        Ok(BranchList {
            current,
            branches: list.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect(),
        })
    })
    .await
}

#[tauri::command]
async fn git_checkout(path: String, branch: String) -> Result<String, String> {
    blocking(move || {
        if branch.is_empty() || branch.starts_with('-') {
            return Err("invalid branch name".to_string());
        }
        git_try(&path, &["switch", &branch])
    })
    .await
}

#[derive(Serialize)]
struct Commit {
    hash: String,
    subject: String,
    author: String,
    when: i64,
}

#[tauri::command]
async fn git_log(path: String, count: u32) -> Result<Vec<Commit>, String> {
    blocking(move || {
        let n = count.clamp(1, 50).to_string();
        let out = git_try(&path, &["log", "-n", &n, "--format=%h%x1f%s%x1f%an%x1f%ct"])?;
        Ok(out
            .lines()
            .filter_map(|l| {
                let mut p = l.split('\u{1f}');
                Some(Commit {
                    hash: p.next()?.to_string(),
                    subject: p.next()?.to_string(),
                    author: p.next()?.to_string(),
                    when: p.next()?.parse::<i64>().ok()? * 1000,
                })
            })
            .collect())
    })
    .await
}

// ---------- search across projects ----------

#[derive(Serialize)]
struct Hit {
    path: String,
    line: u32,
    text: String,
}

struct SearchCtx<'a> {
    q: &'a str,
    content: bool,
    ignore: &'a std::collections::HashSet<String>,
    deadline: Instant,
    limit: usize,
}

fn search_walk(dir: &Path, cx: &SearchCtx, depth: u32, out: &mut Vec<Hit>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if out.len() >= cx.limit || Instant::now() > cx.deadline {
            return;
        }
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            if depth < 12 && !cx.ignore.contains(&name) {
                search_walk(&e.path(), cx, depth + 1, out);
            }
            continue;
        }
        let path = e.path().to_string_lossy().to_string();
        if !cx.content {
            if name.to_lowercase().contains(cx.q) {
                out.push(Hit { path, line: 0, text: name });
            }
            continue;
        }
        let Ok(md) = e.metadata() else { continue };
        if md.len() == 0 || md.len() > 1_000_000 {
            continue;
        }
        let Ok(bytes) = fs::read(e.path()) else { continue };
        if bytes[..bytes.len().min(4096)].contains(&0) {
            continue; // binary
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut per_file = 0;
        for (i, line) in text.lines().enumerate() {
            if line.len() < 2000 && line.to_lowercase().contains(cx.q) {
                out.push(Hit {
                    path: path.clone(),
                    line: i as u32 + 1,
                    text: line.trim().chars().take(200).collect(),
                });
                per_file += 1;
                if per_file >= 10 || out.len() >= cx.limit {
                    break;
                }
            }
        }
    }
}

/// Case-insensitive search of one project, by file name or by file contents. Skips ignored folders, binary and huge files.
#[tauri::command]
async fn search_project(path: String, query: String, content: bool, ignore: Vec<String>) -> Result<Vec<Hit>, String> {
    blocking(move || {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let mut ign: std::collections::HashSet<String> = ignore.into_iter().collect();
        for n in ["node_modules", ".git"] {
            ign.insert(n.to_string());
        }
        let cx = SearchCtx {
            q: &q,
            content,
            ignore: &ign,
            deadline: Instant::now() + Duration::from_secs(8),
            limit: 200,
        };
        let mut out = Vec::new();
        search_walk(Path::new(&path), &cx, 0, &mut out);
        Ok(out)
    })
    .await
}

/// Open a file in VS Code at a line.
#[tauri::command]
fn open_code_at(path: String, line: u32) -> Result<(), String> {
    let target = format!("{path}:{}", line.max(1));
    #[cfg(windows)]
    let mut c = {
        let mut c = hidden(Command::new("cmd"));
        c.args(["/C", "code", "-g", &target]);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("code");
        c.args(["-g", &target]);
        c
    };
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------- restore from the Recycle Bin (undo) ----------

fn norm_path(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// The bin reports original locations in long form, while a path may arrive in 8.3 short form (`RUNNER~1`) or with a
/// `\\?\` prefix. The parent folder still exists after the item was recycled, so resolve that and re-attach the name.
fn long_form(p: &Path) -> PathBuf {
    if let (Some(parent), Some(name)) = (p.parent(), p.file_name()) {
        if let Ok(c) = fs::canonicalize(parent) {
            let s = c.to_string_lossy().to_string();
            let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
            return PathBuf::from(s).join(name);
        }
    }
    p.to_path_buf()
}

/// Of the bin items that came from `want`, the one deleted closest to `at_secs` (so an older file with the same name is left alone).
fn pick_trashed(items: &[trash::TrashItem], want: &Path, at_secs: i64) -> Option<usize> {
    let by_path = |w: &str| -> Vec<(usize, &trash::TrashItem)> {
        items.iter().enumerate().filter(|(_, i)| norm_path(&i.original_path()) == w).collect()
    };
    let mut pool = by_path(&norm_path(want));
    if pool.is_empty() {
        // Windows hides known extensions in the bin when "Hide extensions for known file types" is on (the default):
        // `report.pdf` is then listed as `report`.
        pool = by_path(&norm_path(&want.with_extension("")));
    }
    pool.into_iter().min_by_key(|(_, i)| (i.time_deleted - at_secs).abs()).map(|(n, _)| n)
}

/// Put recycled items back where they were. `deleted_at_ms` is when the app recycled them.
#[tauri::command]
async fn restore_trashed(paths: Vec<String>, deleted_at_ms: i64) -> Result<OpResult, String> {
    blocking(move || {
        #[cfg(any(windows, all(unix, not(target_os = "macos"))))]
        {
            let items = trash::os_limited::list().map_err(|e| e.to_string())?;
            let at = deleted_at_ms / 1000;
            let mut ok = 0;
            let mut failed = Vec::new();
            for p in paths {
                let Some(n) = pick_trashed(&items, &long_form(Path::new(&p)), at) else {
                    failed.push(format!("{p}: not in the Recycle Bin any more (emptied, or already restored)"));
                    continue;
                };
                if Path::new(&p).exists() {
                    failed.push(format!("{p}: something with that name already exists there"));
                    continue;
                }
                let restored_at = items[n].original_path();
                match trash::os_limited::restore_all([items[n].clone()]) {
                    Ok(_) => {
                        // The bin can list a file without its extension (Windows hides known extensions), and it is
                        // put back under that listed name: give it its real name again.
                        let wanted = Path::new(&p);
                        if norm_path(&restored_at) != norm_path(wanted) && restored_at.exists() && !wanted.exists() {
                            if let Err(e) = rename_retry(&restored_at, wanted) {
                                failed.push(format!("{p}: restored as \"{}\" but could not restore its extension ({e})", restored_at.display()));
                                continue;
                            }
                        }
                        ok += 1;
                    }
                    Err(e) => failed.push(format!("{p}: {e}")),
                }
            }
            Ok(OpResult { ok, failed })
        }
        #[cfg(not(any(windows, all(unix, not(target_os = "macos")))))]
        {
            let _ = (paths, deleted_at_ms);
            Err("restoring from the trash is not supported on this system".to_string())
        }
    })
    .await
}

// ---------- state ----------

/// Portable mode: if `portable.flag` sits next to the executable, keep data there.
fn state_path(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("portable.flag").exists() {
                return dir.join("fileexplorer-data.json");
            }
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("state.json")
}

/// True for the portable zip: an installer-based update would install a second copy, so the UI sends those users to Releases.
#[tauri::command]
fn is_portable() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join("portable.flag").exists()))
        .unwrap_or(false)
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> String {
    fs::read_to_string(state_path(&app)).unwrap_or_else(|_| "{}".into())
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = state_path(&app);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(p, json).map_err(|e| e.to_string())
}

/// The operation history lives next to the state file, in its own file.
fn history_path(app: &tauri::AppHandle) -> PathBuf {
    state_path(app).with_file_name("history.json")
}

/// Write to a temp file first, then rename over the target, so a crash never leaves a half-written file.
fn write_atomic(path: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path).or_else(|_| {
        // Windows refuses to rename over an existing file in some cases: replace it explicitly
        let _ = fs::remove_file(path);
        fs::rename(&tmp, path)
    })
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> String {
    fs::read_to_string(history_path(&app)).unwrap_or_else(|_| "[]".into())
}

#[tauri::command]
fn save_history(app: tauri::AppHandle, json: String) -> Result<(), String> {
    write_atomic(&history_path(&app), &json).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_dir(app: tauri::AppHandle) -> String {
    app.path()
        .home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "/".into())
}

#[cfg(test)]
#[path = "../../tests/rust/commands.rs"]
mod commands_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            is_portable,
            list_dir,
            dir_size,
            project_info,
            git_available,
            git_info,
            project_stack,
            find_cleanable,
            project_scripts,
            run_script,
            git_sync,
            git_branches,
            git_checkout,
            git_log,
            search_project,
            open_code_at,
            delete_paths,
            restore_trashed,
            paste_paths,
            rename_path,
            create_entry,
            open_in,
            load_state,
            save_state,
            load_history,
            save_history,
            home_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
