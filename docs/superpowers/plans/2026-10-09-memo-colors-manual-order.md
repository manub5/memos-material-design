# Memo Colors and Manual Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let memo owners choose a synchronized card color and maintain a synchronized manual order in their own timeline without breaking existing API sorting or access rules.

**Architecture:** Add a validated palette field to `Memo` and an owner-scoped manual order backed by indexed ranks in a separate table. Expose a dedicated atomic move RPC with neighbor identities, add `order_by=manual` for the owner's own feed, preserve all existing sort options for other clients, and migrate all three SQL drivers. The actual pointer/touch drag gestures and Markdown list reordering belong to the subsequent interaction plan.

**Tech Stack:** Go 1.27, Protocol Buffers/Connect, SQLite/MySQL/PostgreSQL, React 19, TypeScript 7, React Query, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-10-09-material-doux-memos-design.md`

## Global Constraints

- Apply migration scripts and update `LATEST.sql` for SQLite, MySQL and PostgreSQL; fresh and upgraded installations must match.
- Modify `.proto` sources and use `cd proto && buf generate && buf lint`; do not hand-edit generated outputs.
- Preserve existing `order_by` options and old clients. Keep the new authenticated RPC absent from the public-method maps in `server/api/acl_config.go` and verify that absence in an ACL test.
- Do not change authentication/token behavior or introduce heavy frontend dependencies.
- Owners may reorder only their own top-level memos; viewers of others' memos continue to see the existing chronological ordering.
- Respect desktop/mobile, light/dark/paper, RTL, empty memo collections and pagination.

## Review Focus

- A malicious caller supplies another user's memo or neighbor: the move fails without any write (Task 3).
- Two concurrent moves target the same rank gap: one atomic total order remains, and a repeated move is idempotent (Task 3).
- A filtered or archived timeline displays only a subset: moving a visible item never deletes or renumbers hidden items (Task 3).
- A page is requested after a concurrent move: repeated/skipped rows must be avoided or the request must request a fresh page (Task 4).
- An unknown palette value or absent color arrives from an old client: reject invalid writes and display a neutral card (Tasks 2 and 5).

---

### Task 1: Compatible memo API contract

**Files:**
- Modify: `proto/api/memo_service.proto`, `proto/api/common.proto` (the current unversioned paths)
- Modify: `proto/api/CHANGELOG.md` only if `buf breaking` reports an allowed break
- Generate: `proto/gen/`, `web/src/types/proto/` using `buf generate`
- Test: `server/api/test/memo_service_test.go`

**Interfaces:**
- Produces: `Memo.color` enum field (new unused field number; `UNSPECIFIED`, `LAVENDER`, `SAGE`, `SKY`, `AMBER`, `ROSE`, `PEACH`), `ListMemosRequest.order_by="manual"`, and `MoveMemoRequest { string name; optional string before; optional string after; }` / `MoveMemoResponse` containing the moved `Memo`. `MoveMemo` uses `POST /api/{name=memos/*}:move`, authenticated; add `uint64 order_revision = 3` to internal `PageToken` in `common.proto`. No existing proto field renumbering.
- Consumes: existing `Memo`, `UpdateMemoRequest.update_mask`, `ListMemosRequest.order_by`.

- [ ] **Step 1: Add a black-box service test** that creates a memo with `SAGE`, updates it to `ROSE` via `update_mask=["color"]`, and gets the same value back; add a compile-time MoveMemo request usage test.
- [ ] **Step 2: Run** `go test -run TestMemoColor ./server/api/test/...`; expect failure due to missing generated fields.
- [ ] **Step 3: Edit** the `.proto` contract as above, include `color` in supported update-mask paths, run `cd proto && buf generate` and verify `MoveMemo` remains protected by the default ACL; let the tests continue to fail until backend support is in place.
- [ ] **Step 4: Run** `cd proto && buf lint`; expect success; `go test -run TestMemoColor ./server/api/test/...` still fails on missing persistence (to be addressed in Task 2).

### Task 2: Persist validated colors in all drivers

**Files:**
- Modify: `store/memo.go`, `store/db/{sqlite,mysql,postgres}/memo.go`, `server/api/memo_service.go`, `server/api/memo_service_converters.go` and the matching create/update service files
- Create: `store/migration/{sqlite,mysql,postgres}/26.10/00__memo_colors_and_order.sql`
- Modify: `store/migration/{sqlite,mysql,postgres}/LATEST.sql`
- Test: `store/test/memo_mutation_test.go`, `server/api/test/memo_service_test.go`

**Interfaces:**
- Consumes: `Memo.color` and `update_mask=["color"]` from Task 1.
- Produces: `store.Memo.Color` and `store.UpdateMemo.Color *string`; storage values restricted to the six palette names plus empty for neutral, with a readable neutral fallback on legacy rows. Migration also creates indexed `memo_order(memo_id, rank)` with unique memo ID and FK deletion policy matching the existing schema, plus `memo_order_revision(creator_id, revision)` for page-token validation. Backfill ranks for all existing top-level memos ordered by `created_ts desc, uid desc`, in ascending increments of 1024 per creator; a rank belongs to the creator identified by the memo row.

- [ ] **Step 1: Extend driver-matrix and API tests** for colored create/update/clear, unknown palette rejection and legacy memo neutral color; check behavior across the three drivers where TestContainers is available.
- [ ] **Step 2: Run** `go test -run 'TestMemo(Color|Mutation)' ./store/test/... ./server/api/test/...`; expect new assertions to fail.
- [ ] **Step 3: Add the same schema columns/table/indexes** to each driver migration and `LATEST.sql`, backfill ranks only in upgrade migrations, assign the next leading rank on each new top-level memo insert, convert color via the existing store↔proto converters and persist it in each driver's create/list/update SQL paths. Reject invalid values at the API boundary and avoid arbitrary CSS strings; do not modify `update_time` for a rank change.
- [ ] **Step 4: Run** `go test -run 'TestMemo(Color|Mutation)' ./store/test/... ./server/api/test/...` and `go test -run 'TestSchemaVersion|TestMigration' ./store/...`; expect passes (report unavailable DB containers precisely).

### Task 3: Atomic owner-scoped repositioning

**Files:**
- Modify: `store/memo.go`, `store/driver.go`, `store/db/{sqlite,mysql,postgres}/memo.go`
- Create: `core/memoorder/` with `doc.go` or package README for order rules if rules require extraction
- Modify: `server/api/memo_service.go` or `server/api/memo_service_order.go`
- Test: `server/api/acl_config_test.go` (confirm the MoveMemo procedure is not public)
- Test: `store/test/memo_test.go`, `server/api/test/memo_service_test.go`

**Interfaces:**
- Consumes: `MoveMemoRequest` from Task 1 and `memo_order` table from Task 2.
- Produces: `store.MoveMemo(ctx context.Context, move *store.MoveMemo) error`, driver `MoveMemo` implementation, and service `MoveMemo(ctx context.Context, req *apipb.MoveMemoRequest) (*apipb.MoveMemoResponse, error)`. `store.MoveMemo` contains actor ID, memo UID and optional before/after memo UIDs. An empty before/after means move to start. Both neighbors supplied must be adjacent in the actor's active top-level set at mutation time; exactly one supplied means move beside that anchor. Repeating the same request is a no-op.

- [ ] **Step 1: Write tests** for moving start/middle/end, repeat idempotence, same-owner and active/top-level checks, foreign neighbor rejection, archived/hidden rows, rank exhaustion and two concurrent moves.
- [ ] **Step 2: Run** `go test -run 'TestMoveMemo' ./store/test/... ./server/api/test/...`; expect failure due to missing method.
- [ ] **Step 3: Implement** each driver's transaction with owner validation, rank selection with gaps of 1024, and rank rebalance within that owner's memos only when no integer gap remains. Reject stale neighbor pairs before writing; bump the owner's `memo_order_revision` only on an effective move. Map errors to gRPC `InvalidArgument`, `PermissionDenied` or `Aborted` consistently. Invalidate affected memo queries and publish the memo change SSE event after commit.
- [ ] **Step 4: Run** the Task 3 test command and `go test -v ./store/...`; expect success or a documented TestContainers limitation.

### Task 4: Stable manual feed and pagination

**Files:**
- Modify: `server/api/memo_service_query.go`, `server/api/memo_service.go`, `store/memo.go`, `store/db/{sqlite,mysql,postgres}/memo.go`
- Test: `server/api/test/memo_service_test.go`, `store/test/memo_test.go`

**Interfaces:**
- Consumes: owner ranks and move operation from Tasks 2–3.
- Produces: `store.FindMemo.OrderByManual bool`, accepted `order_by="manual"` only on authenticated own-memo feed; legacy `order_by` strings are unchanged. In manual mode, `CreatorID` is the caller, comments are excluded and the ordering is rank ASC with a deterministic created-time/UID tie-break for legacy rows.

- [ ] **Step 1: Add tests** for original chronological API behavior, initial manual timeline, after-move ordering, multi-page consistency, page token invalidation after a move, creator/space filters and archived lists.
- [ ] **Step 2: Run** `go test -run 'TestListMemos(Manual|Time)' ./server/api/test/...`; expect new assertions to fail.
- [ ] **Step 3: Add** owner-scoped manual sort in all driver queries and an order-revision in manual page tokens; reject stale tokens with `Aborted` so the frontend reloads from page one instead of silently duplicating/skipping items. Preserve the existing token format for non-manual requests.
- [ ] **Step 4: Run** `go test -v -race ./server/... ./core/...` and `go test -v ./store/...`; expect passes or report unavailable TestContainers.

### Task 5: Palette picker and synchronized owner timeline

**Files:**
- Create: `web/src/components/MemoView/memoPalette.ts` (semantic palette ID to theme-sensitive surface classes)
- Modify: `web/src/components/MemoView/MemoView.tsx`, `web/src/components/MemoActionMenu/`, `web/src/components/MemoEditor/index.tsx`, `web/src/hooks/useMemoQueries.ts`, `web/src/hooks/useMemoSorting.ts`, `web/src/components/PagedMemoList/PagedMemoList.tsx`, `web/src/components/MemoDisplaySettingMenu.tsx`, `web/src/contexts/ViewContext.tsx`
- Test: `web/tests/memo-action-menu.test.tsx`, `web/tests/paged-memo-list.test.tsx`, `web/tests/memo-display-setting-menu.test.tsx`

**Interfaces:**
- Consumes: generated `Memo.color`, `order_by=manual`, `MemoService.MoveMemo` (gestures come in a later plan).
- Produces: palette UI for owner-only editing, theme-aware colored memo and editor shell, own-feed manual order and a `useMoveMemo` React Query mutation with invalidate/reload on stale page conflict. Preserve guest/other-user feeds and archived chronology.

- [ ] **Step 1: Add failing tests** for neutral/unknown colors, saving palette with mask, owner-only picker visibility, owner feed using manual order, filtered/guest feed retaining chronology, and restoring pages after conflict.
- [ ] **Step 2: Run** `cd web && pnpm exec vitest run tests/memo-action-menu.test.tsx tests/paged-memo-list.test.tsx tests/memo-display-setting-menu.test.tsx`; expect failures on new assertions.
- [ ] **Step 3: Implement** the palette mapping through semantic CSS in all three themes; add a menu action for palette selection, preserve editor/card color through editing, remove obsolete time-sort controls only for the owner timeline, keep existing local layout/compact/link settings, and add `useMoveMemo` for the subsequent drag-and-drop plan.
- [ ] **Step 4: Run** `cd web && pnpm lint && pnpm test && pnpm build`; expect success. Inspect theme contrast and small-screen layout manually.

## Final verification

- [ ] `cd proto && buf generate && buf lint`; generated outputs included, no unrelated generated rewrites.
- [ ] `go test -v -race ./server/... ./core/...` and `go test -v ./store/...` (all three DB drivers where TestContainers is available).
- [ ] `cd web && pnpm lint && pnpm test && pnpm build`; `git diff --check`.
- [ ] Inspect color/position visibility for shared memos and verify old API chronological sorting, old theme preferences, and no credentials or secrets enter the diff.
