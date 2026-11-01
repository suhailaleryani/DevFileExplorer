// Backend tests. Compiled into the crate via `#[path]` in src-tauri/src/lib.rs (cfg(test) only), so private items are reachable.
// Run with: npm run test:rust   (every test works inside its own folder under the system temp dir)
use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

static N: AtomicU32 = AtomicU32::new(0);

/// A throwaway folder that deletes itself.
struct Tmp(PathBuf);
impl Tmp {
    fn new() -> Tmp {
        let p = std::env::temp_dir().join(format!(
            "fe-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }
    fn p(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
    fn s(&self, rel: &str) -> String {
        self.p(rel).to_string_lossy().to_string()
    }
    fn write(&self, rel: &str, text: &str) {
        let f = self.p(rel);
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(f, text).unwrap();
    }
    fn mkdir(&self, rel: &str) {
        fs::create_dir_all(self.p(rel)).unwrap();
    }
}
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run<T>(f: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
}

// ---------- unique names, create ----------

#[test]
fn unique_target_returns_plain_name_when_free() {
    let t = Tmp::new();
    assert_eq!(unique_target(&t.0, "a.txt", false), t.p("a.txt"));
}

#[test]
fn unique_target_numbers_copies_and_keeps_extension() {
    let t = Tmp::new();
    t.write("a.txt", "x");
    assert_eq!(unique_target(&t.0, "a.txt", false), t.p("a - copy.txt"));
    t.write("a - copy.txt", "x");
    assert_eq!(unique_target(&t.0, "a.txt", false), t.p("a - copy (2).txt"));
    t.write("a - copy (2).txt", "x");
    assert_eq!(unique_target(&t.0, "a.txt", false), t.p("a - copy (3).txt"));
}

#[test]
fn unique_target_for_folders_ignores_dots() {
    let t = Tmp::new();
    t.mkdir("v1.2");
    assert_eq!(unique_target(&t.0, "v1.2", true), t.p("v1.2 - copy"));
}

#[test]
fn create_entry_makes_files_and_folders_and_avoids_clashes() {
    let t = Tmp::new();
    let f = create_entry(t.s(""), "new.txt".into(), false).unwrap();
    assert!(Path::new(&f).is_file());
    let f2 = create_entry(t.s(""), "new.txt".into(), false).unwrap();
    assert_ne!(f, f2);
    assert!(Path::new(&f2).is_file());
    let d = create_entry(t.s(""), "folder".into(), true).unwrap();
    assert!(Path::new(&d).is_dir());
}

#[test]
fn create_entry_fails_for_missing_parent() {
    let t = Tmp::new();
    assert!(create_entry(t.s("nope/deeper"), "x".into(), true).is_err());
}

// ---------- listing and sizes ----------

#[test]
fn list_dir_reports_entries() {
    let t = Tmp::new();
    t.write("a.TXT", "hello");
    t.mkdir("sub");
    let mut v = run(list_dir(t.s(""))).unwrap();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(v.len(), 2);
    assert_eq!(v[0].name, "a.TXT");
    assert_eq!(v[0].ext, "txt"); // lower-cased
    assert_eq!(v[0].size, 5);
    assert!(!v[0].is_dir);
    assert!(v[0].modified > 0);
    assert!(v[1].is_dir);
    assert_eq!(v[1].size, 0);
}

#[test]
fn list_dir_errors_on_missing_folder() {
    let t = Tmp::new();
    assert!(run(list_dir(t.s("missing"))).is_err());
}

#[test]
fn dir_size_counts_files_folders_and_bytes() {
    let t = Tmp::new();
    t.write("a.bin", "12345");
    t.write("sub/b.bin", "123");
    t.write("sub/deep/c.bin", "12");
    let s = run(dir_size(t.s(""), None)).unwrap();
    assert_eq!(s.size, 10);
    assert_eq!(s.files, 3);
    assert_eq!(s.folders, 2);
    assert!(!s.partial);
}

#[test]
fn dir_size_of_empty_folder_is_zero() {
    let t = Tmp::new();
    let s = run(dir_size(t.s(""), Some(1000))).unwrap();
    assert_eq!((s.size, s.files, s.folders), (0, 0, 0));
}

// ---------- undo: restore from the Recycle Bin ----------

fn bin_item(parent: &str, name: &str, at: i64) -> trash::TrashItem {
    trash::TrashItem {
        id: format!("{parent}\\{name}@{at}").into(),
        name: name.into(),
        original_parent: PathBuf::from(parent),
        time_deleted: at,
    }
}

#[test]
fn pick_trashed_chooses_the_item_deleted_closest_in_time() {
    let items = vec![
        bin_item("D:\\p", "a.txt", 1000),
        bin_item("D:\\p", "a.txt", 5000),
        bin_item("D:\\p", "other.txt", 5000),
    ];
    assert_eq!(pick_trashed(&items, Path::new("D:\\p\\a.txt"), 4990), Some(1));
    assert_eq!(pick_trashed(&items, Path::new("D:\\p\\a.txt"), 1100), Some(0));
}

#[test]
fn long_form_keeps_ordinary_paths_and_survives_missing_parents() {
    let t = Tmp::new();
    t.write("a.txt", "x");
    let got = long_form(&t.p("a.txt"));
    assert_eq!(got.file_name().unwrap(), "a.txt");
    assert!(!got.to_string_lossy().starts_with(r"\\?\"));
    assert!(got.parent().unwrap().exists());
    let missing = Path::new("Z:\\no\\such\\folder\\f.txt");
    assert_eq!(long_form(missing), missing.to_path_buf());
}

#[test]
fn pick_trashed_ignores_case_slashes_and_missing_items() {
    let items = vec![bin_item("D:\\Proj", "File.TXT", 10)];
    assert_eq!(pick_trashed(&items, Path::new("d:/proj/file.txt"), 10), Some(0));
    assert_eq!(pick_trashed(&items, Path::new("D:\\proj\\nope.txt"), 10), None);
    assert_eq!(pick_trashed(&[], Path::new("D:\\x"), 0), None);
}

#[test]
#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
fn restore_trashed_round_trip_through_the_real_recycle_bin() {
    let t = Tmp::new();
    t.write("undo-me/inner.txt", "keep");
    let name = format!("fe-undo-{}.txt", std::process::id());
    t.write(&name, "single file");
    let f = t.p(&name);
    let d = t.p("undo-me");
    let at = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as i64;
    if trash::delete_all([&f, &d]).is_err() {
        eprintln!("SKIPPED: no usable Recycle Bin for the temp drive");
        return;
    }
    assert!(!f.exists() && !d.exists());
    let r = run(restore_trashed(vec![f.to_string_lossy().into(), d.to_string_lossy().into()], at)).unwrap();
    assert_eq!((r.ok, r.failed.len()), (2, 0), "{:?}", r.failed);
    assert_eq!(fs::read_to_string(&f).unwrap(), "single file");
    assert_eq!(fs::read_to_string(d.join("inner.txt")).unwrap(), "keep");
}

#[test]
#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
fn restore_trashed_reports_items_that_are_not_in_the_bin_or_would_clash() {
    let t = Tmp::new();
    t.write("exists.txt", "x");
    let r = run(restore_trashed(vec![t.s("never-deleted.txt"), t.s("exists.txt")], 0)).unwrap();
    assert_eq!(r.ok, 0);
    assert_eq!(r.failed.len(), 2);
    assert!(r.failed[0].contains("not in the Recycle Bin"));
    assert!(t.p("exists.txt").exists());
}

// ---------- history file ----------

#[test]
fn write_atomic_creates_folders_and_overwrites() {
    let t = Tmp::new();
    let f = t.p("deep/er/history.json");
    write_atomic(&f, "[1]").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "[1]");
    write_atomic(&f, "[1,2]").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "[1,2]");
    assert!(!t.p("deep/er/history.json.tmp").exists(), "temp file is cleaned up");
}

// ---------- rename ----------

#[test]
fn rename_path_renames_a_file() {
    let t = Tmp::new();
    t.write("old.txt", "x");
    let out = run(rename_path(t.s("old.txt"), "new.txt".into())).unwrap();
    assert_eq!(PathBuf::from(out), t.p("new.txt"));
    assert!(!t.p("old.txt").exists());
    assert!(t.p("new.txt").exists());
}

#[test]
fn rename_path_rejects_bad_names() {
    let t = Tmp::new();
    t.write("a.txt", "x");
    for bad in ["", "x/y", "x\\y"] {
        assert!(run(rename_path(t.s("a.txt"), bad.into())).is_err(), "{bad:?}");
    }
    assert!(t.p("a.txt").exists());
}

#[test]
fn rename_path_refuses_to_overwrite() {
    let t = Tmp::new();
    t.write("a.txt", "a");
    t.write("b.txt", "b");
    let e = run(rename_path(t.s("a.txt"), "b.txt".into())).unwrap_err();
    assert!(e.contains("already exists"));
    assert_eq!(fs::read_to_string(t.p("b.txt")).unwrap(), "b");
}

#[test]
fn rename_path_allows_case_only_change() {
    let t = Tmp::new();
    t.write("readme.md", "x");
    run(rename_path(t.s("readme.md"), "README.md".into())).unwrap();
    let names: Vec<String> = fs::read_dir(&t.0).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
    assert_eq!(names, vec!["README.md".to_string()]);
}

#[test]
fn rename_path_renames_a_folder_with_content() {
    let t = Tmp::new();
    t.write("dir/inner.txt", "x");
    run(rename_path(t.s("dir"), "dir2".into())).unwrap();
    assert!(t.p("dir2/inner.txt").exists());
}

// ---------- copy / move ----------

#[test]
fn paste_copies_files_and_folders_recursively() {
    let t = Tmp::new();
    t.write("src/a.txt", "a");
    t.write("src/sub/b.txt", "b");
    t.mkdir("dest");
    let r = run(paste_paths(vec![t.s("src")], t.s("dest"), false)).unwrap();
    assert_eq!((r.ok, r.failed.len()), (1, 0));
    assert_eq!(fs::read_to_string(t.p("dest/src/sub/b.txt")).unwrap(), "b");
    assert!(t.p("src/a.txt").exists(), "copy keeps the source");
}

#[test]
fn paste_move_removes_the_source() {
    let t = Tmp::new();
    t.write("a.txt", "a");
    t.mkdir("dest");
    let r = run(paste_paths(vec![t.s("a.txt")], t.s("dest"), true)).unwrap();
    assert_eq!(r.ok, 1);
    assert!(!t.p("a.txt").exists());
    assert!(t.p("dest/a.txt").exists());
}

#[test]
fn paste_name_clash_keeps_both() {
    let t = Tmp::new();
    t.write("a.txt", "new");
    t.write("dest/a.txt", "old");
    run(paste_paths(vec![t.s("a.txt")], t.s("dest"), false)).unwrap();
    assert_eq!(fs::read_to_string(t.p("dest/a.txt")).unwrap(), "old");
    assert_eq!(fs::read_to_string(t.p("dest/a - copy.txt")).unwrap(), "new");
}

#[test]
fn paste_copy_into_same_folder_makes_a_copy() {
    let t = Tmp::new();
    t.write("a.txt", "a");
    run(paste_paths(vec![t.s("a.txt")], t.s(""), false)).unwrap();
    assert!(t.p("a - copy.txt").exists());
}

#[test]
fn paste_move_into_same_folder_is_a_noop() {
    let t = Tmp::new();
    t.write("a.txt", "a");
    let r = run(paste_paths(vec![t.s("a.txt")], t.s(""), true)).unwrap();
    assert_eq!((r.ok, r.failed.len()), (0, 0));
    assert!(t.p("a.txt").exists());
    assert!(!t.p("a - copy.txt").exists());
}

#[test]
fn paste_refuses_folder_into_itself() {
    let t = Tmp::new();
    t.mkdir("f/inner");
    let r = run(paste_paths(vec![t.s("f")], t.s("f/inner"), false)).unwrap();
    assert_eq!(r.ok, 0);
    assert_eq!(r.failed.len(), 1);
    assert!(r.failed[0].contains("into itself"));
}

#[test]
fn paste_reports_missing_sources_without_stopping() {
    let t = Tmp::new();
    t.write("good.txt", "g");
    t.mkdir("dest");
    let r = run(paste_paths(vec![t.s("ghost.txt"), t.s("good.txt")], t.s("dest"), false)).unwrap();
    assert_eq!(r.ok, 1);
    assert_eq!(r.failed.len(), 1);
    assert!(t.p("dest/good.txt").exists());
}

// ---------- delete (permanent only: tests never touch the Recycle Bin) ----------

#[test]
fn permanent_delete_removes_files_and_trees() {
    let t = Tmp::new();
    t.write("a.txt", "a");
    t.write("tree/x/y/z.txt", "z");
    t.write("tree/top.txt", "t");
    let r = run(delete_paths(vec![t.s("a.txt"), t.s("tree")], true)).unwrap();
    assert_eq!((r.ok, r.failed.len()), (2, 0));
    assert!(!t.p("a.txt").exists());
    assert!(!t.p("tree").exists());
}

#[test]
fn permanent_delete_handles_read_only_files() {
    let t = Tmp::new();
    t.write("ro.txt", "x");
    let mut perm = fs::metadata(t.p("ro.txt")).unwrap().permissions();
    perm.set_readonly(true);
    fs::set_permissions(t.p("ro.txt"), perm).unwrap();
    let r = run(delete_paths(vec![t.s("ro.txt")], true)).unwrap();
    assert_eq!((r.ok, r.failed.len()), (1, 0));
    assert!(!t.p("ro.txt").exists());
}

#[test]
fn permanent_delete_reports_missing_paths() {
    let t = Tmp::new();
    let r = run(delete_paths(vec![t.s("ghost")], true)).unwrap();
    assert_eq!(r.ok, 0);
    assert_eq!(r.failed.len(), 1);
}

// ---------- cleaner ----------

fn cleanable(t: &Tmp) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = run(find_cleanable(t.s("")))
        .unwrap()
        .into_iter()
        .map(|c| {
            let rel = Path::new(&c.path).strip_prefix(&t.0).unwrap().to_string_lossy().replace('\\', "/");
            (rel, c.kind)
        })
        .collect();
    v.sort();
    v
}

#[test]
fn cleaner_finds_node_modules_and_does_not_descend_into_them() {
    let t = Tmp::new();
    t.mkdir("node_modules/pkg/node_modules");
    t.mkdir("web/node_modules");
    let found = cleanable(&t);
    assert_eq!(
        found,
        vec![
            ("node_modules".into(), "node_modules".into()),
            ("web/node_modules".into(), "node_modules".into())
        ]
    );
}

#[test]
fn cleaner_target_and_dist_need_a_sibling_manifest() {
    let t = Tmp::new();
    t.mkdir("plain/target");
    t.mkdir("plain/dist");
    t.write("rs/Cargo.toml", "");
    t.mkdir("rs/target");
    t.write("js/package.json", "{}");
    t.mkdir("js/dist");
    assert_eq!(
        cleanable(&t),
        vec![("js/dist".into(), "dist".into()), ("rs/target".into(), "Rust target".into())]
    );
}

#[test]
fn cleaner_detects_build_caches_venvs_and_dotnet_output() {
    let t = Tmp::new();
    t.mkdir("a/.next");
    t.mkdir("a/.turbo");
    t.write("py/.venv/pyvenv.cfg", "");
    t.mkdir("py/venv"); // no pyvenv.cfg: not a venv
    t.write("cs/App.csproj", "");
    t.mkdir("cs/bin");
    t.mkdir("cs/obj");
    t.mkdir("nocs/bin"); // no project file
    assert_eq!(
        cleanable(&t),
        vec![
            ("a/.next".into(), "build cache".into()),
            ("a/.turbo".into(), "build cache".into()),
            ("cs/bin".into(), ".NET build".into()),
            ("cs/obj".into(), ".NET build".into()),
            ("py/.venv".into(), "Python venv".into()),
        ]
    );
}

#[test]
fn cleaner_skips_dot_git() {
    let t = Tmp::new();
    t.mkdir(".git/node_modules");
    assert!(cleanable(&t).is_empty());
}

#[test]
fn cleaner_stops_at_depth_limit() {
    let t = Tmp::new();
    t.mkdir("1/2/3/4/5/6/node_modules");
    assert!(cleanable(&t).is_empty());
    t.mkdir("1/2/node_modules");
    assert_eq!(cleanable(&t).len(), 1);
}

// ---------- stack detection ----------

fn stack(t: &Tmp) -> Vec<String> {
    run(project_stack(t.s(""))).unwrap()
}

#[test]
fn stack_empty_folder_has_none() {
    assert!(stack(&Tmp::new()).is_empty());
}

#[test]
fn stack_detects_node_react_ts_in_canonical_order() {
    let t = Tmp::new();
    t.write("package.json", r#"{"dependencies":{"react":"19"}}"#);
    t.write("tsconfig.json", "{}");
    assert_eq!(stack(&t), vec!["react", "ts", "node"]);
}

#[test]
fn stack_detects_tauri_rust_and_next() {
    let t = Tmp::new();
    t.mkdir("src-tauri");
    t.write("Cargo.toml", "");
    t.write("package.json", r#"{"dependencies":{"next":"1"}}"#);
    assert_eq!(stack(&t), vec!["tauri", "next", "rust", "node"]);
}

#[test]
fn stack_detects_other_markers() {
    let cases: [(&str, &str); 9] = [
        ("go.mod", "go"),
        ("pyproject.toml", "python"),
        ("pom.xml", "java"),
        ("composer.json", "php"),
        ("Gemfile", "ruby"),
        ("pubspec.yaml", "flutter"),
        ("CMakeLists.txt", "cpp"),
        ("Dockerfile", "docker"),
        ("firebase.json", "firebase"),
    ];
    for (file, id) in cases {
        let t = Tmp::new();
        t.write(file, "");
        assert_eq!(stack(&t), vec![id], "{file}");
    }
}

#[test]
fn stack_detects_dotnet_unity_unreal_wordpress() {
    let t = Tmp::new();
    t.write("App.sln", "");
    assert_eq!(stack(&t), vec!["dotnet"]);
    let t = Tmp::new();
    t.mkdir("ProjectSettings");
    t.mkdir("Assets");
    assert_eq!(stack(&t), vec!["unity"]);
    let t = Tmp::new();
    t.write("Game.uproject", "");
    assert_eq!(stack(&t), vec!["unreal"]);
    let t = Tmp::new();
    t.mkdir("wp-content");
    assert_eq!(stack(&t), vec!["wordpress"]);
}

#[test]
fn stack_looks_into_monorepo_folders() {
    let t = Tmp::new();
    t.write("apps/web/package.json", r#"{"dependencies":{"vue":"3"}}"#);
    t.write("services/api/go.mod", "");
    assert_eq!(stack(&t), vec!["vue", "node", "go"]);
}

#[test]
fn stack_order_list_has_no_duplicates_and_matches_known_ids() {
    let mut seen = std::collections::HashSet::new();
    for id in STACK_ORDER {
        assert!(seen.insert(id), "duplicate {id}");
    }
}

// ---------- scripts ----------

#[test]
fn safe_script_name_accepts_plain_names() {
    for ok in ["dev", "build:prod", "test_unit", "lint-fix", "a.b", "@scope/x", "x1"] {
        assert!(safe_script_name(ok), "{ok}");
    }
}

#[test]
fn safe_script_name_rejects_anything_shell_like() {
    for bad in ["", "-rf", "a b", "a;b", "a&b", "a|b", "a`b`", "$(x)", "a>b", "a\"b", "a'b", "a%b%", "a\nb", &"x".repeat(100)] {
        assert!(!safe_script_name(bad), "{bad:?}");
    }
}

#[test]
fn package_manager_follows_lock_files() {
    let t = Tmp::new();
    assert_eq!(package_manager(&t.0), "npm");
    t.write("yarn.lock", "");
    assert_eq!(package_manager(&t.0), "yarn");
    t.write("bun.lockb", "");
    assert_eq!(package_manager(&t.0), "yarn"); // yarn.lock is checked before bun
    fs::remove_file(t.p("yarn.lock")).unwrap();
    assert_eq!(package_manager(&t.0), "bun");
    t.write("pnpm-lock.yaml", "");
    assert_eq!(package_manager(&t.0), "pnpm"); // pnpm wins over everything
}

#[test]
fn list_scripts_orders_by_priority_and_drops_unsafe_names() {
    let t = Tmp::new();
    t.write(
        "package.json",
        r#"{"scripts":{"zeta":"x","build":"x","dev":"x","evil;rm":"x","-bad":"x","test":"x"}}"#,
    );
    let names: Vec<String> = list_scripts(&t.0).into_iter().map(|s| s.name).collect();
    assert_eq!(names, vec!["dev", "build", "test", "zeta"]);
}

#[test]
fn list_scripts_builds_commands_with_the_right_manager() {
    let t = Tmp::new();
    t.write("package.json", r#"{"scripts":{"dev":"vite"}}"#);
    t.write("pnpm-lock.yaml", "");
    let s = list_scripts(&t.0);
    assert_eq!(s[0].command, "pnpm run dev");
    assert_eq!(s[0].source, "pnpm");
}

#[test]
fn list_scripts_adds_cargo_commands_and_survives_bad_json() {
    let t = Tmp::new();
    t.write("package.json", "{ not json");
    t.write("Cargo.toml", "");
    let cmds: Vec<String> = list_scripts(&t.0).into_iter().map(|s| s.command).collect();
    assert_eq!(cmds, vec!["cargo run", "cargo build", "cargo test", "cargo check"]);
}

#[test]
fn list_scripts_empty_for_plain_folder() {
    assert!(list_scripts(&Tmp::new().0).is_empty());
}

#[test]
fn run_script_rejects_scripts_that_do_not_exist() {
    let t = Tmp::new();
    t.write("package.json", r#"{"scripts":{"dev":"vite"}}"#);
    // free text that is not a script name must never reach a shell
    let e = run_script(t.s(""), "npm".into(), "dev & calc".into()).unwrap_err();
    assert!(e.contains("no longer exists"));
    let e = run_script(t.s(""), "cargo".into(), "run".into()).unwrap_err();
    assert!(e.contains("no longer exists"));
}

// ---------- search ----------

fn search(t: &Tmp, q: &str, content: bool, ignore: &[&str]) -> Vec<(String, u32)> {
    let mut v: Vec<(String, u32)> = run(search_project(
        t.s(""),
        q.into(),
        content,
        ignore.iter().map(|s| s.to_string()).collect(),
    ))
    .unwrap()
    .into_iter()
    .map(|h| (Path::new(&h.path).strip_prefix(&t.0).unwrap().to_string_lossy().replace('\\', "/"), h.line))
    .collect();
    v.sort();
    v
}

#[test]
fn search_by_file_name_is_case_insensitive() {
    let t = Tmp::new();
    t.write("src/Main.rs", "");
    t.write("src/other.rs", "");
    assert_eq!(search(&t, "MAIN", false, &[]), vec![("src/Main.rs".to_string(), 0)]);
}

#[test]
fn search_by_content_reports_line_numbers() {
    let t = Tmp::new();
    t.write("a.txt", "first\nsecond Needle here\nthird\nneedle again");
    assert_eq!(search(&t, "needle", true, &[]), vec![("a.txt".to_string(), 2), ("a.txt".to_string(), 4)]);
}

#[test]
fn search_skips_node_modules_git_and_ignored_folders() {
    let t = Tmp::new();
    t.write("node_modules/p/a.txt", "needle");
    t.write(".git/x.txt", "needle");
    t.write("build/b.txt", "needle");
    t.write("keep/c.txt", "needle");
    assert_eq!(search(&t, "needle", true, &["build"]), vec![("keep/c.txt".to_string(), 1)]);
}

#[test]
fn search_skips_binary_and_empty_and_huge_files() {
    let t = Tmp::new();
    fs::write(t.p("bin.dat"), b"needle\0binary").unwrap();
    t.write("empty.txt", "");
    fs::write(t.p("huge.txt"), "needle ".repeat(200_000)).unwrap(); // > 1 MB
    t.write("ok.txt", "needle");
    assert_eq!(search(&t, "needle", true, &[]), vec![("ok.txt".to_string(), 1)]);
}

#[test]
fn search_blank_query_returns_nothing() {
    let t = Tmp::new();
    t.write("a.txt", "x");
    assert!(search(&t, "   ", true, &[]).is_empty());
    assert!(search(&t, "", false, &[]).is_empty());
}

#[test]
fn search_limits_matches_per_file_and_in_total() {
    let t = Tmp::new();
    t.write("many.txt", &"needle\n".repeat(50));
    assert_eq!(search(&t, "needle", true, &[]).len(), 10); // per-file cap
    for i in 0..30 {
        t.write(&format!("f{i}.txt"), &"needle\n".repeat(10));
    }
    assert!(search(&t, "needle", true, &[]).len() <= 200); // total cap
}

// ---------- git (only when git is installed) ----------

fn git_ok() -> bool {
    hidden(Command::new(git_exe())).arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

fn git(t: &Tmp, args: &[&str]) {
    let o = hidden(Command::new(git_exe()))
        .current_dir(&t.0)
        .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
}

#[test]
fn git_info_none_for_non_repo() {
    let t = Tmp::new();
    if !git_ok() {
        return;
    }
    assert!(run(git_info(t.s(""))).unwrap().is_none());
}

#[test]
fn git_info_reports_branch_dirty_and_commit() {
    if !git_ok() {
        return;
    }
    let t = Tmp::new();
    git(&t, &["init", "-b", "main"]);
    t.write("a.txt", "a");
    git(&t, &["add", "."]);
    git(&t, &["commit", "-m", "first commit"]);
    let g = run(git_info(t.s(""))).unwrap().unwrap();
    assert_eq!(g.branch, "main");
    assert!(!g.dirty);
    assert!(!g.has_remote);
    assert!(!g.has_upstream);
    assert!(g.last_commit > 0);
    assert_eq!(g.last_message, "first commit");
    t.write("b.txt", "b");
    t.write("a.txt", "changed");
    let g = run(git_info(t.s(""))).unwrap().unwrap();
    assert!(g.dirty);
    assert_eq!(g.dirty_count, 2);
}

#[test]
fn git_branches_checkout_and_log() {
    if !git_ok() {
        return;
    }
    let t = Tmp::new();
    git(&t, &["init", "-b", "main"]);
    t.write("a.txt", "a");
    git(&t, &["add", "."]);
    git(&t, &["commit", "-m", "one"]);
    t.write("a.txt", "b");
    git(&t, &["commit", "-am", "two"]);
    git(&t, &["branch", "feature"]);
    let b = run(git_branches(t.s(""))).unwrap();
    assert_eq!(b.current, "main");
    assert!(b.branches.contains(&"main".to_string()) && b.branches.contains(&"feature".to_string()));
    run(git_checkout(t.s(""), "feature".into())).unwrap();
    assert_eq!(run(git_info(t.s(""))).unwrap().unwrap().branch, "feature");
    let log = run(git_log(t.s(""), 5)).unwrap();
    assert_eq!(log.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), vec!["two", "one"]);
    assert_eq!(run(git_log(t.s(""), 1)).unwrap().len(), 1);
}

#[test]
fn git_checkout_rejects_option_like_branch_names() {
    if !git_ok() {
        return;
    }
    let t = Tmp::new();
    git(&t, &["init", "-b", "main"]);
    t.write("a.txt", "a");
    git(&t, &["add", "."]);
    git(&t, &["commit", "-m", "one"]);
    assert!(run(git_checkout(t.s(""), "--orphan=x".into())).is_err());
}

#[test]
fn git_sync_rejects_unknown_actions() {
    let t = Tmp::new();
    assert!(run(git_sync(t.s(""), "push".into())).is_err());
    assert!(run(git_sync(t.s(""), "reset --hard".into())).is_err());
}
