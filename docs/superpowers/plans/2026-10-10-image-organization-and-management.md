# Image Organization and Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct filename-driven module organization and add safe image/game deletion, bulk deletion, and cross-module image movement.

**Architecture:** Keep filename parsing and tag derivation pure in the upload feature. Extend the repository with owner-scoped atomic Supabase RPCs for movement and deletion, backed by a persistent Storage cleanup queue. Add accessible management controls to the existing game detail page while retaining the current dark bookshelf design.

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS/PostgreSQL, Vitest, Testing Library, CSS

**Spec:** `docs/superpowers/specs/2026-10-10-image-organization-and-management.md`

## Global Constraints

- The production frontend remains a static GitHub Pages SPA using hash routing.
- The app remains single-user/private with no public signup and no frontend secret or `service_role` key.
- New behavior must work through `LibraryRepository`; demo mode stays read-only.
- Original filenames and image metadata are preserved unless the user explicitly edits them.
- Every owner-scoped database mutation is atomic and protected by existing authentication/RLS rules.
- Empty modules and custom tags are preserved after moving or deleting their last image.
- UI copy is Simplified Chinese and all management actions are keyboard accessible.

## Review Focus

- Filenames containing multiple underscores or a non-numeric final segment must keep the correct title; Task 1 owns the tests.
- Tag extraction must be deterministic when `Intl.Segmenter` is unavailable and must filter generic UI words; Task 1 owns the tests.
- Empty, duplicate, unauthorized, and cross-game move/delete inputs must not mutate another owner’s records; Task 2 owns the SQL/API review.
- Storage removal failures must return a partial result while leaving queue rows for later retry; Task 2 owns the tests.
- Same-named flows in different modules must not mix in the viewer, and touch/keyboard users must not depend on drag-and-drop; Task 3 owns the tests.

---

### Task 1: Filename parsing and automatic tags

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/domain/importParser.ts`
- Modify: `src/domain/importParser.test.ts`
- Create: `src/features/upload/deriveAutoTags.ts`
- Create: `src/features/upload/deriveAutoTags.test.ts`
- Modify: `src/features/upload/buildImportDraft.ts`
- Modify: `src/features/upload/buildImportDraft.test.ts`

**Interfaces:**
- Produces: `ParsedImportFile.flowName: string` and `deriveAutoTags(moduleName: string, title: string): string[]`.
- Consumes: existing upload draft and legacy filename behavior.

- [ ] Write focused failing tests for `公会_总部已解锁.jpg`, `公会_兑换商店界面_2.jpg`, a title with internal underscores, source-order fallback, legacy hyphen names, generic-word filtering, and the required `公会/兑换/商店` tags.
- [ ] Run `npm test -- src/domain/importParser.test.ts src/features/upload/deriveAutoTags.test.ts src/features/upload/buildImportDraft.test.ts` and verify failures are caused by the missing behavior.
- [ ] Implement underscore parsing, explicit flow names, deterministic local tag derivation, and draft tag population.
- [ ] Run the focused command and `npm test`; both must pass.
- [ ] Commit with message `feat: organize uploads from filenames`.

### Task 2: Atomic movement, deletion, and Storage cleanup

**Files:**
- Modify: `src/data/libraryRepository.ts`
- Modify: `src/data/supabaseRepository.ts`
- Modify: `src/data/supabaseRepository.test.ts`
- Create: `supabase/migrations/202610100003_image_management.sql`

**Interfaces:**
- Produces: `moveImage(imageId: string, targetModuleId: string): Promise<MutationResult>`, `deleteImages(imageIds: string[]): Promise<MutationResult>`, and `deleteGame(gameId: string): Promise<MutationResult>`.
- Produces: `MutationResult.pendingCleanup?: number` and allows status `partial`.
- Consumes: private buckets `game-ui-originals` and `game-ui-thumbnails` plus authenticated owner IDs.

- [ ] Write failing repository tests for move RPC arguments, single/batch delete RPC arguments, successful grouped Storage cleanup, partial cleanup retention, empty deletion, and non-blocking cleanup retry during snapshot load.
- [ ] Run `npm test -- src/data/supabaseRepository.test.ts` and verify the new tests fail because the methods do not exist.
- [ ] Add the repository methods and cleanup queue draining with no database metadata rollback after an object cleanup failure.
- [ ] Add one migration containing the queue table/RLS and owner-scoped `move_ui_image_to_module`, `delete_ui_images`, and `delete_game` RPCs with explicit grants.
- [ ] Run the focused test, `npm test`, and `npm run typecheck`; all must pass.
- [ ] Commit with message `feat: add safe image management mutations`.

### Task 3: Game detail management UI

**Files:**
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/pages/GameEditing.test.tsx`
- Modify: `src/components/ImageCard.tsx`
- Modify: `src/components/ImageViewer.tsx`
- Create: `src/components/MoveImageDialog.tsx`
- Create: `src/components/DeleteConfirmDialog.tsx`
- Modify: `src/styles/index.css`

**Interfaces:**
- Consumes: Task 2 repository methods and `GameModule`/`UiImage` records.
- Produces: card move menu, explicit drag handle/drop targets, single selection, multi-select bulk deletion, and typed game deletion confirmation.

- [ ] Write failing user-facing tests for single deletion, selecting and deleting multiple images, typed game deletion, dialog-based movement, same-module no-op, drop movement, preserved empty modules, and viewer grouping by module plus flow.
- [ ] Run `npm test -- src/pages/GameEditing.test.tsx src/components/ImageViewer.test.tsx` and verify the new behaviors fail.
- [ ] Implement the dialogs, selection toolbar, card controls, drag/drop state, mutation feedback, refresh/navigation behavior, and responsive styles.
- [ ] Run focused tests, `npm test`, `npm run typecheck`, and `npm run build`; all must pass.
- [ ] Commit with message `feat: manage images from game details`.

### Task 4: Live migration and deployment verification

**Files:**
- Modify only if verification exposes a tested defect.

**Interfaces:**
- Consumes: the Task 2 SQL migration and Task 3 production build.
- Produces: the upgraded Supabase schema and deployed GitHub Pages site.

- [ ] Apply `202610100003_image_management.sql` to the configured Supabase project and verify the query succeeds.
- [ ] Run the complete automated verification suite and inspect the production bundle for the new management UI.
- [ ] Push the verified commits to `origin/main`, wait for GitHub Pages deployment, and verify the live URL responds with the new bundle.
- [ ] Do not delete or move the user’s existing live records during verification.
