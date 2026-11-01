# Builds a folder of FAKE projects for screenshots and demos. Safe to re-run: it deletes and rebuilds $Root.
# Usage: powershell -NoProfile -File tests\demo\make-demo.ps1 [-Root D:\DevDemo]
param([string]$Root = "D:\DevDemo")
$ErrorActionPreference = "Continue"
$git = if (Get-Command git -ErrorAction SilentlyContinue) { "git" } else { "C:\Program Files\Git\cmd\git.exe" }

if (Test-Path $Root) { Remove-Item -Recurse -Force $Root }
$proj = Join-Path $Root "projects"
$remotes = Join-Path $Root "remotes"
New-Item -ItemType Directory -Force $proj, $remotes | Out-Null

function G([string]$dir, [string[]]$a, [string]$when = "") {
  $env:GIT_TERMINAL_PROMPT = "0"
  if ($when) { $env:GIT_AUTHOR_DATE = $when; $env:GIT_COMMITTER_DATE = $when } else { Remove-Item Env:GIT_AUTHOR_DATE, Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }
  & $git -C $dir -c user.name="Demo Dev" -c user.email="demo@example.com" -c commit.gpgsign=false -c init.defaultBranch=main @a 2>&1 | Out-Null
}
function Iso([int]$daysAgo) { (Get-Date).AddDays(-$daysAgo).ToString("yyyy-MM-ddTHH:mm:ss") }
function W([string]$path, [string]$text) {
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  Set-Content -Path $path -Value $text -Encoding UTF8
}
function Bulk([string]$dir, [int]$files, [int]$kb) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  $buf = New-Object byte[] ($kb * 1024)
  (New-Object Random 7).NextBytes($buf)
  for ($i = 0; $i -lt $files; $i++) { [IO.File]::WriteAllBytes((Join-Path $dir "chunk$i.bin"), $buf) }
}
function Age([string]$dir, [double]$days) {
  $t = (Get-Date).AddDays(-$days)
  Get-ChildItem $dir -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\\.git(\\|$)" } | ForEach-Object { $_.LastWriteTime = $t }
  (Get-Item $dir).LastWriteTime = $t
}
# repo with an optional bare remote; $pushed = push main upstream
function Repo([string]$dir, [int]$daysAgo, [bool]$remote) {
  G $dir @("init", "-b", "main")
  G $dir @("add", "-A")
  G $dir @("commit", "-m", "Initial commit") (Iso ($daysAgo + 20))
  if ($remote) {
    $bare = Join-Path $remotes ((Split-Path $dir -Leaf) + ".git")
    & $git init --bare -b main $bare 2>&1 | Out-Null
    G $dir @("remote", "add", "origin", $bare)
    G $dir @("commit", "--allow-empty", "-m", "Polish and fix tests") (Iso $daysAgo)
    G $dir @("push", "-u", "origin", "main")
  } else {
    G $dir @("commit", "--allow-empty", "-m", "Polish and fix tests") (Iso $daysAgo)
  }
}
function Pkg([string]$dir, [string]$name, [string]$deps) {
  W "$dir\package.json" "{`n  `"name`": `"$name`",`n  `"version`": `"0.3.0`",`n  `"scripts`": { `"dev`": `"vite`", `"build`": `"tsc && vite build`", `"test`": `"vitest`", `"lint`": `"eslint .`" },`n  `"dependencies`": { $deps }`n}"
}
function Readme([string]$dir, [string]$text) { W "$dir\README.md" "# $(Split-Path $dir -Leaf)`n`n$text" }

# ---------- 1 storefront-web: Next.js + React + TS, dirty, pushed ----------
$d = "$proj\storefront-web"
Pkg $d "storefront-web" '"next": "14.2.0", "react": "18.3.0"'
W "$d\tsconfig.json" "{}"; W "$d\src\app\page.tsx" "export default function Home() { return <main>Storefront</main>; }"
W "$d\src\cart.ts" "export const total = (items: number[]) => items.reduce((a, b) => a + b, 0);"
Readme $d "Online shop front end."
Bulk "$d\node_modules\.cache" 40 220; Bulk "$d\.next" 12 300
Repo $d 1 $true
W "$d\src\checkout.tsx" "export const Checkout = () => null;"; W "$d\src\cart.ts" "// TODO coupons`nexport const total = 0;"
W "$d\src\app\layout.tsx" "export default function L() { return null; }"; W "$d\notes.txt" "wip"; W "$d\src\promo.ts" "export {};"
Age $d 0.1

# ---------- 2 pulse-api: Go + Docker, 2 unpushed commits ----------
$d = "$proj\pulse-api"
W "$d\go.mod" "module example.com/pulse`n`ngo 1.22"; W "$d\main.go" "package main`n`nfunc main() {}"; W "$d\Dockerfile" "FROM golang:1.22"
Readme $d "Metrics ingestion service."
Repo $d 4 $true
W "$d\handler.go" "package main"; G $d @("add", "-A"); G $d @("commit", "-m", "Add ingest handler") (Iso 3)
W "$d\limits.go" "package main"; G $d @("add", "-A"); G $d @("commit", "-m", "Rate limits") (Iso 2)
Age $d 2

# ---------- 3 budget-tracker: Tauri + React, clean ----------
$d = "$proj\budget-tracker"
Pkg $d "budget-tracker" '"react": "19.1.0", "@tauri-apps/api": "^2"'
W "$d\src-tauri\Cargo.toml" "[package]`nname = `"budget`""; W "$d\src-tauri\src\main.rs" "fn main() {}"; W "$d\tsconfig.json" "{}"
W "$d\src\App.tsx" "export default () => null;"; Readme $d "Desktop budget app."
Bulk "$d\node_modules\.cache" 25 200; Bulk "$d\src-tauri\target\debug" 20 400
Repo $d 12 $true
Age $d 12

# ---------- 4 mobile-notes: React Native, branch not pushed ----------
$d = "$proj\mobile-notes"
Pkg $d "mobile-notes" '"react-native": "0.74.0", "react": "18.2.0"'
W "$d\App.tsx" "export default () => null;"; Readme $d "Notes app with offline sync (unfinished)."
Repo $d 40 $true
G $d @("checkout", "-b", "feature/sync"); W "$d\sync.ts" "export {};"; G $d @("add", "-A"); G $d @("commit", "-m", "Start sync engine") (Iso 40)
Age $d 40

# ---------- 5 ml-playground: Python, venv, no git ----------
$d = "$proj\ml-playground"
W "$d\pyproject.toml" "[project]`nname = `"ml-playground`""; W "$d\requirements.txt" "numpy`npandas"; W "$d\train.py" "print('training')"
Readme $d "Experiments with small models."
W "$d\.venv\pyvenv.cfg" "home = C:\Python312"; Bulk "$d\.venv\Lib" 60 250
Age $d 75

# ---------- 6 portfolio-site: Vue, done ----------
$d = "$proj\portfolio-site"
Pkg $d "portfolio-site" '"vue": "3.4.0"'
W "$d\src\App.vue" "<template><h1>Hi</h1></template>"; Readme $d "Personal site."
Bulk "$d\dist" 6 120
Repo $d 100 $true
Age $d 100

# ---------- 7 game-jam-2024: Unity, abandoned ----------
$d = "$proj\game-jam-2024"
W "$d\ProjectSettings\ProjectVersion.txt" "m_EditorVersion: 2022.3"; W "$d\Assets\Player.cs" "class Player {}"; Readme $d "48-hour jam game."
Age $d 400

# ---------- 8 blog-engine: Ruby, behind remote by 3 ----------
$d = "$proj\blog-engine"
W "$d\Gemfile" "source 'https://rubygems.org'"; W "$d\app.rb" "puts 'blog'"; Readme $d "Tiny static blog generator."
Repo $d 20 $true
$bare = Join-Path $remotes "blog-engine.git"; $other = Join-Path $Root "tmp-clone"
& $git clone $bare $other 2>&1 | Out-Null
1..3 | ForEach-Object { G $other @("commit", "--allow-empty", "-m", "Upstream change $_") (Iso 5); }
G $other @("push", "origin", "main"); Remove-Item -Recurse -Force $other
G $d @("fetch", "--all")
Age $d 20

# ---------- 9 cli-tools: Rust, done ----------
$d = "$proj\cli-tools"
W "$d\Cargo.toml" "[package]`nname = `"cli-tools`""; W "$d\src\main.rs" "fn main() {}"; Readme $d "Small command line helpers."
Bulk "$d\target\debug" 35 500
Repo $d 6 $true
Age $d 6

# ---------- 10 dotnet-inventory: .NET, abandoned ----------
$d = "$proj\dotnet-inventory"
W "$d\Inventory.sln" ""; W "$d\Inventory.csproj" "<Project />"; W "$d\Program.cs" "System.Console.WriteLine();"; Readme $d "Warehouse inventory API."
Bulk "$d\bin\Debug" 10 300; Bulk "$d\obj" 8 200
Age $d 200

# ---------- 11 wp-theme: WordPress, idea ----------
$d = "$proj\wp-theme"
W "$d\wp-content\themes\mine\style.css" "/* Theme */"; W "$d\functions.php" "<?php"; Readme $d "Custom WordPress theme."
Age $d 30

# ---------- 12 firebase-chat: Firebase + React, dirty ----------
$d = "$proj\firebase-chat"
Pkg $d "firebase-chat" '"react": "18.3.0", "firebase": "10.0.0"'
W "$d\firebase.json" "{}"; W "$d\src\Chat.tsx" "export const Chat = () => null;"; Readme $d "Realtime chat."
Bulk "$d\node_modules\.cache" 30 200
Repo $d 15 $true
W "$d\src\Chat.tsx" "export const Chat = () => 1;"; W "$d\src\Room.tsx" "export {};"
Age $d 15

# ---------- 13 ideas-scratch: plain notes ----------
$d = "$proj\ideas-scratch"
W "$d\notes.md" "# Ideas`n- habit tracker`n- recipe box"; W "$d\sketch.txt" "todo"
Age $d 5

# ---------- 14 data-pipeline: Python + Docker, unfinished ----------
$d = "$proj\data-pipeline"
W "$d\pyproject.toml" "[project]`nname = `"pipeline`""; W "$d\etl.py" "print('etl')"; W "$d\docker-compose.yml" "services: {}"; Readme $d "Nightly ETL."
Repo $d 55 $false
Age $d 55

# a reference folder with ordinary documents (for pinned-folder and browsing screenshots)
$ref = "$Root\Documents"
W "$ref\Meeting notes.md" "# Notes"; W "$ref\invoice-2026-10.pdf" "pdf"; W "$ref\budget.xlsx" "xlsx"; W "$ref\design\mockup.png" "png"; W "$ref\design\logo.svg" "<svg/>"
Age $ref 9

Write-Host "Demo projects ready in $proj"
