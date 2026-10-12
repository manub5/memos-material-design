# Material doux Visual Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Memos a coherent compact Material doux visual foundation across themes, shared controls, navigation, cards, editor and secondary surfaces.

**Architecture:** Keep the existing OKLCH CSS variables and Base UI/Tailwind primitives. Start with theme tokens, then shared variants and shell, then card/editor and secondary pages; preserve current interaction, layout and theme resolution. The separate, independently testable follow-up plans cover persisted memo colors/order and drag-and-drop of cards/Markdown lists.

**Tech Stack:** React 19, TypeScript 7, Tailwind CSS v4, Base UI, CVA, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-10-09-material-doux-memos-design.md`

## Global Constraints

- Desktop and mobile have equal priority; retain compact card density, measured grid layout, RTL and mobile safe areas.
- Preserve `system`, `default`, `default-dark`, and `paper` theme behavior; colors must be legible in all three resolved palettes.
- Reuse Tailwind semantic tokens, Base UI and CVA; do not add Material UI or change application APIs during this plan.
- Do not hand-edit generated proto outputs or rewrite frozen `docs/design/` documents.
- Keep existing behavior of the routes, editor, sorting and pagination until their dedicated feature plans.

## Review Focus

- User switches system light/dark while viewing an open dialog: surface and text remain readable without a reload; test in Task 1.
- Theme `paper` supplies incomplete overrides: every newly introduced semantic token has a paper value; test in Task 1.
- A 320px viewport with a long memo title: card and navigation remain contained and readable; test in Task 3.
- RTL at sidebar and memo grid boundaries: controls stay on the logical start/end side; test in Task 2.
- A focused CodeMirror editor inside an absolutely positioned grid tile: focus overlay still covers the viewport; test in Task 3.

---

### Task 1: Palette and elevation tokens

**Files:**
- Modify: `web/src/themes/default.css`, `web/src/themes/default-dark.css`, `web/src/themes/paper.css`
- Modify: `web/src/index.css` only if a common body or focus state needs a shared rule
- Test: `web/tests/theme.test.ts`

**Interfaces:**
- Consumes: existing `:root` semantic tokens and `@theme inline` mapping in `default.css`; theme resolution in `web/src/utils/theme.ts`.
- Produces: stable semantic Tailwind colors (`background`, `card`, `popover`, `sidebar`, `primary`, `accent`, `border`) and existing radius/shadow scales for Tasks 2–4. If a new shared token is essential, define it in all three themes and map it in `@theme inline` here.

- [ ] **Step 1: Write failing assertions** in `web/tests/theme.test.ts` that each resolved theme defines every token newly used by this plan; confirm the `system` preference re-resolves after `matchMedia` changes, including with an open popover surface.
- [ ] **Step 2: Run** `cd web && pnpm exec vitest run tests/theme.test.ts`; expect the new assertions to fail.
- [ ] **Step 3: Set the Material doux palette** in the three theme CSS files: warm, lightly tinted default background; softly tinted primary and sidebar; layered dark surfaces; warm paper alternative. Choose readable foreground pairs, `--radius: 0.875rem` in `default.css`, restrained `--shadow-sm`/`--shadow-float` elevation. Maintain existing public token names and variable-only dynamic themes.
- [ ] **Step 4: Run** `cd web && pnpm exec vitest run tests/theme.test.ts && pnpm lint`; expect both commands to pass.

### Task 2: Shared controls and navigation

**Files:**
- Modify: `web/src/components/ui/button.tsx`, `web/src/components/ui/input.tsx`, `web/src/components/ui/dialog.tsx`, `web/src/components/ui/sheet.tsx`, `web/src/components/ui/popover.tsx`
- Modify: `web/src/components/AppSidebar/sidebar-layout.ts`, `web/src/components/AppSidebar/SidebarRow.tsx`, `web/src/layouts/RootLayout.tsx`
- Test: `web/tests/sidebar-row-grammar.test.tsx`, `web/tests/sidebar-row-state.test.tsx`, `web/tests/root-layout-global-editor.test.tsx`

**Interfaces:**
- Consumes: semantic theme tokens from Task 1 and existing `buttonVariants({ variant, size })` API; existing sidebar `sidebarSurfaceVariants({ role })` API.
- Produces: Material doux radii, surface and feedback states using the same component props, focus outlines and named stacking layers.

- [ ] **Step 1: Add failing assertions** for current/hover sidebar selection, semantic Base UI focus states and RTL logical placement in the three named test files; retain existing prop/API expectations.
- [ ] **Step 2: Run** `cd web && pnpm exec vitest run tests/sidebar-row-grammar.test.tsx tests/sidebar-row-state.test.tsx tests/root-layout-global-editor.test.tsx`; expect the new assertions to fail.
- [ ] **Step 3: Adjust the shared primitives and navigation files** listed above: use the palette and radius scales from Task 1, keep `buttonVariants` sizes (`default`, `sm`, `lg`, `icon`, `icon-compact`, `icon-sm`) and sidebar row heights unchanged, preserve `FOCUS_VISIBLE_OUTLINE_CLASSES` and logical `start/end` spacing. Apply elevated surfaces to dialog/sheet/popover through their shared components.
- [ ] **Step 4: Run** `cd web && pnpm exec vitest run tests/sidebar-row-grammar.test.tsx tests/sidebar-row-state.test.tsx tests/root-layout-global-editor.test.tsx && pnpm lint`; expect passing tests and lint.

### Task 3: Matching memo card and editor surfaces

**Files:**
- Modify: `web/src/components/MemoView/constants.ts`, `web/src/components/MemoEditor/index.tsx`
- Modify: `web/src/components/MemoEditor/Editor/editor.css` only if existing editor text contrast needs it
- Test: `web/tests/memo-view-icons.test.tsx`, `web/tests/column-grid-untrapped.test.tsx`, `web/tests/toolbar-compact-width.test.ts`

**Interfaces:**
- Consumes: theme tokens from Task 1, control variants from Task 2, existing `MEMO_CARD_BASE_CLASSES` and `ColumnGrid` positioning contract.
- Produces: visually matching memo and editor shells, without changing Memo/Editor props or `ColumnGrid` transforms.

- [ ] **Step 1: Add failing assertions** that card and inline editor share background, border/radius and compact spacing, that a 320px layout does not overflow with long titles, and that a focused grid editor remains untrapped.
- [ ] **Step 2: Run** `cd web && pnpm exec vitest run tests/memo-view-icons.test.tsx tests/column-grid-untrapped.test.tsx tests/toolbar-compact-width.test.ts`; expect failure for new assertions.
- [ ] **Step 3: Update** `MEMO_CARD_BASE_CLASSES` and the normal-mode editor shell classes in `MemoEditor/index.tsx` together; use subdued borders, rounded surfaces, restrained interactive elevation, `px-4 py-3` compact spacing and semantic tokens. Retain comment-card joined corners and focus mode positioning.
- [ ] **Step 4: Run** the Task 3 test command followed by `cd web && pnpm lint`; expect passes.

### Task 4: Secondary application surfaces and final checks

**Files:**
- Modify: `web/src/components/Settings/SettingSection.tsx`, `web/src/components/Settings/SettingGroup.tsx`, `web/src/components/Settings/SettingList.tsx`, `web/src/components/AuthPageLayout.tsx`, `web/src/components/MemoPanel/MemoPanel.tsx`
- Inspect: `web/src/components/CalendarView/`, `web/src/components/MapView/`, `web/src/components/AttachmentLibrary/` to verify existing semantic token usage; add a targeted task to a later plan if unrelated hardcoded styling is discovered.
- Test: `web/tests/auth-page-layout.test.tsx`, `web/tests/space-settings-shell.test.ts`, `web/tests/theme.test.ts`

**Interfaces:**
- Consumes: Task 1 tokens and Task 2 shared controls.
- Produces: matching surface hierarchy on auth, settings and memo panels; route behavior remains unchanged.

- [ ] **Step 1: Add failing assertions** for auth/settings/panel surfaces sharing semantic themes, including dark and paper fallback; inspect calendar, map and attachments for any remaining hardcoded shared surface classes.
- [ ] **Step 2: Run** `cd web && pnpm exec vitest run tests/auth-page-layout.test.tsx tests/space-settings-shell.test.ts tests/theme.test.ts`; expect failure for new assertions.
- [ ] **Step 3: Apply shared surface tokens and radius/elevation variants** to the named aggregators and only the identified page-specific exceptions. Retain map full-bleed and mobile sheet, calendar breakpoint behavior, media-preview black surfaces and safe-area insets.
- [ ] **Step 4: Run** `cd web && pnpm lint && pnpm test && pnpm build` and `git diff --check`; expect all checks to pass. Inspect the resulting diff for accidental layout/RTL changes.

## Subsequent independent plans

1. **Memo color and manual order:** additive proto fields and dedicated move RPC, server/core/store rules, all three driver migrations and `LATEST.sql`, generated Go/OpenAPI/TypeScript, owner authorization, compatibility/pagination tests, frontend color picker and order feed.
2. **Pointer/touch interactions:** drag handle integrated with `ColumnGrid`, persistence via move RPC, rollback/error UI, scrolling and RTL verification; Markdown list subtree moves inside CodeMirror using content save and undo history.

These are separate reviewable deliverables from the visual foundations; they must be planned against the same approved spec before their implementation.
