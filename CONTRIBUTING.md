# Contributing to DevFileExplorer

Thanks for helping. Contributions of every size are welcome: bug reports, feature ideas, docs, tests and code. macOS and Linux testers are especially needed (see "Platform status" in the README).

## Ask for a feature or report a bug

Open an issue and pick a template:

- **Feature request**: describe the problem first, then the idea. Small, focused ideas get built fastest.
- **Bug report**: steps, expected result, your OS. The History panel shows failed operations with their error text; paste it.

Not sure yet? Open an issue anyway and say so. A conversation before code saves everyone time.

## How to send a change (step by step)

1. **Fork** https://github.com/suhailaleryani/DevFileExplorer and clone your fork.
2. Create a branch from `main`: `git switch -c feat/short-description`.
3. Set up (below) and make your change. Add or update a test.
4. Run `npx tsc --noEmit` and `npm test`; both must be clean.
5. Commit in focused steps with messages like `feat(history): ...`, `fix(search): ...`, `docs: ...`.
6. Push the branch to your fork and open a **pull request** against `main`. Fill in the checklist, add a screenshot for UI changes, and link the issue (`Fixes #12`).
7. CI runs on Windows, Ubuntu and macOS. Reply to review comments by pushing more commits; they are squashed or merged when approved.

For anything larger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

## License

The project is MIT licensed (see `LICENSE`). By submitting a pull request you agree that your contribution is released under the same license.

## Set up

```
npm install
npm run tauri dev        # first build is slow
```

You need Node 22+, stable Rust and, on Windows, the Visual Studio C++ Build Tools. On Linux install the Tauri system libraries first (see `.github/workflows/ci.yml` for the exact list).

## Releases and the update key

Only maintainers publish releases (see "Publishing a release" in the README). The updater signing key lives in the git-ignored `.vip-keys` folder: never commit it, paste it in an issue or share it. Contributors do not need it; `npm run tauri dev` works without it.

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
