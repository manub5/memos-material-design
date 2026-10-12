# Memo reorder verification — 2026-10-12

## Decisions and reviewed fixes

- Owner-only manual ordering is enabled only on the unfiltered all-Spaces owner timeline. Shared, foreign, filtered and Space feeds keep chronological sorting. The sidebar reflects the same scope.
- Stable memo-name keys preserve other cards' inline editors during preview and persistence. Changes to source data, scope, direction or measured card size cancel an active gesture rather than submit stale neighbors.
- A failed background refresh retains cached cards, their unsaved drafts and focus, displays a recoverable list error, and pauses further moves until retry succeeds. A successful save followed by a failed refresh reports a loading error rather than claiming the move was rejected. A real QueryClient/RPC regression reproduced the former draft loss before the fix.
- Markdown selection anchor/head positions are remapped by their source blocks and separator slots; undo restores both text and selection. This addresses the review's selection-loss finding.
- Markdown preview reuses one immutable document index and validates a destination once per gesture. Pointer/scroll frames reuse that result; drop validates against a fresh index. This addresses repeated parsing at pointer cadence without weakening structural safety.
- Virtualized list-entry boundaries use CodeMirror line-block geometry when coordinates are unavailable, including sibling candidates and source/descendant hit testing. Large nested-entry before/after moves, source-subtree rejection and undo have regressions.
- A pending automatic pagination check now stops on unmount. A new regression first demonstrated an unwanted request after unmount, then passed with cleanup. This also removes the observed asynchronous `document is not defined` test-teardown failure.
- The palette uses seven radio menu entries. Six new interaction strings exist in all 46 locales; English/French are localized, other locales use readable English fallback.
- The frontend commit hook flagged a dynamically constructed code-fence regular expression. It now uses a literal expression followed by marker/length comparisons; the existing fenced-code and malformed-input regressions cover the behavior. No security hook is disabled.

## Automated checks

Toolchains: Node 24.21.0 / pnpm 11.0.1; Go 1.27 in the existing Docker toolchain.

- Backend: `go test -p 2 -race ./server/... ./core/... ./store/...` passed, including SQLite, MySQL and PostgreSQL integration/migration tests.
- Follow-up parameterized SQL fixture changes: `go test -p 2 -race -run "TestMoveMemo|TestMemoOrderRevision|TestDanglingPlacement|TestMemoReadFailsClosed" ./store/test ./server/api/test` passed on all three store drivers.
- `pnpm lint` passed: TypeScript and Biome, 708 files.
- `pnpm test --maxWorkers=2` passed: 203 files, 1,879 tests, no unhandled errors. Reduced concurrency prevents contention with the expensive locale-resource scan; test timeouts are unchanged.
- `pnpm build` passed. Existing non-blocking optimizer warnings remain for `::highlight` and large chunks.
- `git diff --check` passed. Commit hooks include Semgrep, Gitleaks and the existing personal-path check. The local worktree received the unchanged hook configuration from the original checkout because it was missing locally; that local configuration is not part of the feature commit.
- Backend commit: `09629fd62` (`fix(api): preserve memo colors and consistent manual pagination`). SQL fixture values were parameterized to satisfy Semgrep, including two existing affected-file fixtures; no hook was skipped.

## Real browser checks

Visible Chromium, native mouse events and trusted CDP touch events; real Home, MemoView and CodeMirror with deterministic intercepted Connect RPCs. Final full browser run: **48 PASS / 0 FAIL**, no JavaScript page errors.

- Exact move anchors and authoritative final order, grid/flow/mobile, real Arabic RTL.
- Stable card DOM and focused inline editor when moving another card.
- Escape, pointer cancellation, no-op, window resize and native editor-height change: no mutation and restored order.
- Aborted conflict, rollback and successful manual retry; palette selected state and color-only mutation mask.
- Guest/foreign/filter/Space/editing restrictions, parent/nested-task/numbered Markdown moves, one document update at drop, whole-document undo, existing save flow, excluded syntax and stale/cross-list/descendant rejection.
- Default, dark, paper and system themes at 1440/390 pixels and LTR/RTL: no major horizontal overflow.

The initial rapid combined scenario had one unexplained cancellation. Final orchestration waits for five consecutive animation frames of identical geometry, no pending RPCs and enabled handles before pointerdown. The same combined scenario then emits the exact interior-anchor RPC and preserves focus. A separate native editor-height-change scenario verifies that geometry changes during a gesture cancel safely. The original transient cancellation's exact cause is not asserted.

Temporary artifacts are outside the checkout under `/tmp/user/1000/opencode/`: `playwright-test-memos.js`, `memos-browser-complete-final.json` and screenshots. No browser-only scripts or dependencies are added to the repository.

## Performance and limits

Local 1,000-entry benchmark with a real EditorView and deterministic jsdom coordinates: initial index 83.09 ms; first validation 78.03 ms; repeated pointer events averaged 1.01 ms, scrolling frames 0.71 ms; fresh validation/drop 212.30 ms. These are local observations, not timing assertions or a browser/mobile performance guarantee. First visits to new destinations still require structural validation.

Browser RPC interception does not validate live backend persistence; separate Go integration tests cover that surface. Browser coverage is Chromium/CDP, not physical touch devices or Safari/Firefox. Browser collection size is four cards; pagination/SSE and CRLF/virtualization edge cases are covered by automated tests rather than this browser run.

Side effects: every memo UPDATE can invalidate a manual-pagination token; stale pages reload from the start. The existing global mutation retry can repeat a rejected move; backend tests verify replay idempotence and no revision changes for rejected/no-op moves. Markdown drop is one isolated undoable transaction; ordinary content gestures do not trigger moves. No new dependency or security finding remains in the committed backend hook scan.
