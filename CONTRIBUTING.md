# Contributing to DevFileExplorer

Thanks for helping. Contributions of every size are welcome: bug reports, feature ideas, docs, tests and code. macOS and Linux testers are especially needed (see "Platform status" in the README).

## Ask for a feature or report a bug

Open an issue and pick a template:

- **Feature request**: describe the problem first, then the idea. Small, focused ideas get built fastest.
- **Bug report**: steps, expected result, your OS. The History panel shows failed operations with their error text; paste it.

Not sure yet? Open an issue anyway and say so. A conversation before code saves everyone time.

## Set up

```
npm install
npm run tauri dev        # first build is slow
```

You need Node 22+, stable Rust and, on Windows, the Visual Studio C++ Build Tools. On Linux install the Tauri system libraries first (see `.github/workflows/ci.yml` for the exact list).

## Before you open a pull request

```
npx tsc --noEmit         # must print nothing
npm test                 # JS unit/contract tests, then Rust tests
```

- Add a test for the behaviour you change. Pure logic belongs in `src/*.ts` with a test in `tests/unit`; backend behaviour gets a test in `tests/rust/commands.rs`.
- **Never test on real project folders.** Use a throwaway folder; `tests/demo/make-demo.ps1` builds a safe set of fake projects.
- Keep commits focused and grouped by functionality (`feat(history): ...`, `fix(search): ...`, `docs: ...`).
- UI changes: include a screenshot in the pull request.

## Where things live

| Area | Files |
| --- | --- |
| App state, shortcuts, wiring | `src/App.tsx` |
| Project dashboard, pins, filters | `src/Sidebar.tsx`, `src/attention.ts`, `src/stacks.ts` |
| History and undo | `src/historyLog.ts` (pure logic), `src/historyStore.ts`, `src/History.tsx` |
| Cleaner, search, quick jump | `src/Cleaner.tsx`, `src/Search.tsx`, `src/QuickJump.tsx` |
| Rust commands | `src-tauri/src/lib.rs` |
| Styles | `src/App.css` (new rules go at the end; later rules win) |

## Good first contributions

- Run the app and the Rust tests on macOS or Linux and report what breaks.
- Open a terminal and run scripts on macOS and Linux (currently Windows only).
- Live file watching (the `notify` crate) instead of refresh on focus.
- Keyboard control of context menus.
- Anything from the roadmap in the README.

## Code of conduct

Be kind and assume good intent. Critique code, not people.
