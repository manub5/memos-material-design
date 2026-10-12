# Memo Reorder Interactions Implementation Plan

> **For agentic workers:** Use `dispatching-parallel-agents` for the two independent interaction domains, then integrate and run one fresh whole-change review. The user explicitly requests continuous execution and automatic recommended decisions; no approval handoffs.

**Goal:** Reorder owned memo cards and Markdown list entries with dedicated mouse/touch handles while preserving edits, pagination and synchronization.

**Architecture:** Use Pointer Events without new dependencies. Memo reordering lives in PagedMemoList and preserves stable name keys; a handle supplied to MemoView is hidden while editing. Markdown reordering is a CodeMirror extension backed by structural Markdown ranges and one undoable document transaction. The two domains share only translated strings, maintained by the coordinator.

**Tech Stack:** React 19, React Query 5, CodeMirror 6, existing Markdown parsers, Base UI, Tailwind 4.

**Spec:** The approved `docs/superpowers/specs/2026-10-09-material-doux-memos-design.md` in the original checkout, especially sections Interactions des cartes and Déplacement des listes et tâches Markdown.

## Global Constraints

- Preserve single-column/grid, light/dark/paper/system, compact density, mobile and RTL.
- Only unfiltered all-Spaces authenticated owner timelines expose memo handles; only loaded memos are targets.
- Reuse `useMoveMemo({name,before?,after?})`; never rewrite dates, pinned flags or entire rank sets on the client.
- Reject ambiguous or malformed Markdown operations; preserve nested content, indentation, task markers, line endings and undo history.
- No new dependencies, auth changes or Docker/release changes. The user's subsequent instruction authorizes commits on the feature branch; no pushes or merges.
- Ordinary scrolling, links, editing and text selection outside dedicated handles remain unaffected.

## Review Focus

- A new page or SSE update arrives while dragging: cancel safely rather than save stale neighbors (Task 1).
- A card has an open editor or focused modal: moving other cards must not remount it or trap its focus (Task 1).
- Pointer cancel, Escape, resize, unmount or rejected mutation: restore server order and release capture/listeners (Task 1).
- Markdown parents contain loose paragraphs, nested tasks, fenced code or a missing final newline: move the whole structural block without merging entries (Task 2).
- Another edit occurs during a Markdown gesture: cancel rather than apply stale offsets (Task 2).

## Task 1: Owner memo pointer reordering

**Files:** `web/src/components/PagedMemoList/PagedMemoList.tsx`, new focused reordering hook/geometry files beside it, `web/src/components/MemoView/MemoView.tsx`, `web/src/components/MemoView/types.ts`, `web/src/pages/Home.tsx`, targeted tests in `web/tests/`.

**Interfaces:** Consume loaded `Memo[]`, `orderBy === "manual"`, and `useMoveMemo`. Extend renderer options with an optional ReactNode handle, passed to MemoView as an optional `dragHandle`; chronological consumers need no changes. Expose translated handle name/state/position and a visible destination indicator.

- [x] Write failing tests for mouse/touch movement, correct anchors at first/interior/last loaded destinations, cancel/no-op/no API calls, failure rollback, foreign/chronological absence and stable mounted card identity.
- [x] Run targeted Vitest; expect new interaction assertions to fail before implementation.
- [x] Implement pointer capture on the handle only, movement threshold, measured target geometry independent of RTL DOM order, optimistic preview preserving name keys, auto-scroll, Escape/cancel/resize/data-change cleanup, disabled pending state and recoverable error toast. Do not assume the last loaded item is the global end: anchor to it explicitly.
- [x] Run targeted tests and Biome on owned files; expect pass. Report any translation keys without modifying locales.

## Task 2: Structural Markdown list pointer reordering

**Files:** focused new `web/src/components/MemoEditor/Editor/listReorder.ts` and `listReorderExtension.ts`, `extensions.ts`, `editor.css` if necessary; targeted tests in `web/tests/`.

**Interfaces:** Produce a pure operation returning a CodeMirror-compatible text change or null for unsupported moves; range identification must come from the existing Markdown syntax parser. Install a list-entry gutter/widget handle in `buildEditorExtensions`; use the existing `onChange` and save flow, with one document transaction per drop.

- [x] Write failing pure and editor tests: bullets/numbered/tasks, parent plus children, same-parent restriction, excluded code/quotes/ordinary paragraphs, malformed input, CRLF/final newline, undo and cancelled/stale gestures.
- [x] Run targeted Vitest; expect missing-operation/interaction failures.
- [x] Implement same-list sibling moves with structural ranges. Preserve separators and bytes except the moved blocks; reject self/descendant/cross-list moves and ambiguous boundaries. Provide dedicated pointer mouse/touch handles, target indicator and editor auto-scroll; cancel on doc change, Escape, pointercancel and destroy. Do not emit document edits while dragging.
- [x] Run targeted tests and Biome on owned files; expect pass. Report translation keys to coordinator.

## Task 3: Accessible palette, localization and real browser validation

**Files:** `web/src/components/MemoActionMenu/MemoActionMenu.tsx`, relevant tests, `web/src/locales/*.json`; temporary browser scripts outside the checkout.

- [x] Test the selected non-neutral palette color has `menuitemradio` checked state; run and observe failure.
- [x] Use existing DropdownMenuRadioGroup/RadioItem for all seven choices, preserving owner-only visibility and color mutation mask.
- [x] Add every interaction label to all locales, with natural English/French and readable fallback elsewhere. Reuse existing generic error strings.
- [x] Run lint/tests/build under an available isolated Node 24 toolchain. Validate real mouse/touch interactions and desktop/mobile/RTL/themes in Playwright against a local dev server with deterministic mocked RPCs; no account changes or external service mutations.

## Task 4: Integration and completion

- [x] Review all agent diffs, integrate without overwriting preceding uncommitted backend/frontend work.
- [x] Run `pnpm lint && pnpm test && pnpm build` and `git diff --check`; expect all green.
- [x] Dispatch one fresh read-only review of the interactions and their integration with existing manual order. Fix important findings with a failing regression test first and rerun relevant checks. Keep a ledger of decisions and deferred minor findings.
- [x] Record exact browser and automated results in `2026-10-12-memo-reorder-verification.md`; modifications stay in `feat/material-doux-foundations`, with commits authorized by the user's subsequent instruction.

Self-review: card and Markdown files do not overlap; shared translation edits belong to Task 3. Existing API/store contracts require no changes. Approved spec supplies design intent; the user's latest instruction waives further confirmation gates and selects recommended decisions.
