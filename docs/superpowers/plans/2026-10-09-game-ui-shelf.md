# Game UI Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, searchable game UI image library that deploys to GitHub Pages and persists data in Supabase.

**Architecture:** A Vite React SPA uses a repository boundary so the UI can run against a read-only demo repository or an authenticated Supabase repository. Pure domain modules parse imports and search records; feature components compose the bookshelf, game detail, viewer, and upload workbench. Private Supabase tables and buckets enforce single-owner access with RLS.

**Tech Stack:** React, TypeScript, Vite, React Router, Supabase JS, Vitest, Testing Library, CSS

**Spec:** `docs/superpowers/specs/2026-10-09-game-ui-shelf-design.md`

## Global Constraints

- The production frontend must deploy as static files to GitHub Pages and use hash routing.
- The product is single-user and has no public signup, moderation, or social features.
- Original files stay private; thumbnails are WebP files generated in the browser with a 560px maximum edge.
- Search covers game name, aliases, module, image title, tags, platform, and version with all-term matching.
- UI copy is Simplified Chinese; code identifiers are English.
- The app must remain browsable in read-only demo mode without Supabase environment variables.
- No secret or `service_role` key may be placed in frontend code or GitHub Pages artifacts.

## Review Focus

- Mixed Chinese/English filenames and optional numeric prefixes must parse without losing the original filename; Task 1 owns the tests.
- Empty and multi-term queries must not accidentally hide everything or use any-term matching; Task 2 owns the tests.
- Unknown game IDs and empty modules must render useful empty states instead of crashing; Task 3 owns the tests.
- Non-image, duplicate, and over-limit files must be reported before upload; Task 4 owns the tests.
- Missing environment variables and unauthenticated sessions must select the correct repository/access state without leaking data; Task 5 owns the tests.

---

### Task 1: Project foundation and import parser

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/styles/index.css`
- Create: `src/domain/models.ts`, `src/domain/importParser.ts`
- Test: `src/domain/importParser.test.ts`

**Interfaces:**
- Produces: `parseImportFile(input: ImportFileInput): ParsedImportFile` and shared domain types.
- Consumes: none.

- [ ] Create the Node/Vite test configuration and write failing parser tests for plain modules, hyphenated steps, numeric prefixes, nested folders, unsupported extensions, and preserved filenames.
- [ ] Run `npm test -- src/domain/importParser.test.ts` and verify failure because `parseImportFile` is missing.
- [ ] Implement the parser and minimal application shell.
- [ ] Run the parser test and full suite; both must pass.
- [ ] Commit with message `feat: scaffold game ui shelf domain`.

### Task 2: Demo repository and catalog search

**Files:**
- Create: `src/data/libraryRepository.ts`, `src/data/demoData.ts`, `src/data/demoRepository.ts`
- Create: `src/features/search/searchCatalog.ts`
- Test: `src/features/search/searchCatalog.test.ts`

**Interfaces:**
- Consumes: domain types from Task 1.
- Produces: `LibraryRepository` with read APIs plus `submitImport(draft): Promise<UploadBatchResult>`, `demoRepository`, and `searchCatalog(records, query, filters)`.

- [ ] Write failing tests for empty query, Chinese/English matching, all-term semantics, tag filters, and unmatched terms.
- [ ] Run the focused test and verify it fails because search is missing.
- [ ] Implement the repository contract, realistic demo records, and pure search.
- [ ] Run focused and full tests; both must pass.
- [ ] Commit with message `feat: add searchable demo catalog`.

### Task 3: Bookshelf, game detail, and image viewer

**Files:**
- Modify: `src/app/App.tsx`, `src/styles/index.css`
- Create: `src/app/AppShell.tsx`, `src/app/LibraryContext.tsx`
- Create: `src/pages/LibraryPage.tsx`, `src/pages/GamePage.tsx`, `src/pages/SearchPage.tsx`
- Create: `src/components/GameCard.tsx`, `src/components/ImageCard.tsx`, `src/components/ImageViewer.tsx`, `src/components/SearchBox.tsx`, `src/components/FilterBar.tsx`, `src/components/EmptyState.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `LibraryRepository`, demo data, and search from Task 2.
- Produces: hash-routed browse, search, detail, and viewer experience.

- [ ] Write failing user-facing tests for the bookshelf, search navigation, known game detail, unknown game, empty module, and viewer open/close.
- [ ] Run the focused tests and verify the missing UI behavior fails.
- [ ] Implement the accessible UI and responsive visual system.
- [ ] Run focused tests, full tests, and typecheck; all must pass.
- [ ] Commit with message `feat: build bookshelf browsing experience`.

### Task 4: Folder upload workbench

**Files:**
- Create: `src/features/upload/buildImportDraft.ts`, `src/features/upload/createThumbnail.ts`, `src/features/upload/uploadTypes.ts`
- Create: `src/pages/UploadPage.tsx`, `src/components/UploadDropzone.tsx`, `src/components/ImportPreview.tsx`
- Modify: `src/app/App.tsx`, `src/app/AppShell.tsx`, `src/styles/index.css`
- Test: `src/features/upload/buildImportDraft.test.ts`, `src/pages/UploadPage.test.tsx`

**Interfaces:**
- Consumes: `parseImportFile` and `LibraryRepository.submitImport` from Task 2; demo mode reports that persistence requires Supabase.
- Produces: `buildImportDraft(files, existingFingerprints)` plus editable upload preview and progress states.

- [ ] Write failing tests for directory grouping, stable order, duplicate/non-image rejection, over-limit warnings, and preview correction.
- [ ] Run focused tests and verify they fail for missing upload behavior.
- [ ] Implement draft building, client WebP thumbnail generation, preview editing, and repository submission.
- [ ] Run focused tests, full tests, and typecheck; all must pass.
- [ ] Commit with message `feat: add folder upload workbench`.

### Task 5: Supabase authentication, persistence, and private schema

**Files:**
- Create: `src/config/runtime.ts`, `src/lib/supabase.ts`, `src/data/supabaseRepository.ts`
- Create: `src/pages/LoginPage.tsx`, `src/app/RepositoryProvider.tsx`
- Modify: `src/app/App.tsx`, `src/data/libraryRepository.ts`
- Create: `supabase/migrations/202610090001_initial_schema.sql`
- Create: `.env.example`
- Test: `src/config/runtime.test.ts`, `src/data/supabaseRepository.test.ts`

**Interfaces:**
- Consumes: `LibraryRepository` and upload drafts.
- Produces: runtime mode selection, authenticated repository, signed image URLs, CRUD/upload operations, and RLS schema.

- [ ] Write failing tests for demo fallback, valid cloud configuration, unauthenticated state, row mapping, and partial upload failure reporting.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement configuration, auth gate, Supabase adapter, private storage integration, and SQL policies.
- [ ] Run focused tests, full tests, and typecheck; all must pass.
- [ ] Commit with message `feat: connect private supabase library`.

### Task 6: Deployment, backup, documentation, and final QA

**Files:**
- Create: `.github/workflows/deploy-pages.yml`, `README.md`, `public/404.html`
- Create: `src/features/backup/exportLibrary.ts`, `src/pages/SettingsPage.tsx`
- Modify: `src/app/App.tsx`, `src/app/AppShell.tsx`, `src/styles/index.css`
- Test: `src/features/backup/exportLibrary.test.ts`

**Interfaces:**
- Consumes: repository read APIs.
- Produces: JSON export, settings screen, deploy workflow, and operator documentation.

- [ ] Write a failing export test that verifies stable versioned JSON without signed URLs.
- [ ] Run the focused test and verify it fails because export is missing.
- [ ] Implement backup export, settings UI, Pages workflow, setup guide, and operational limits.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`; all must pass.
- [ ] Start the production preview and visually verify bookshelf, search, game detail, viewer, upload preview, login fallback, and narrow layout.
- [ ] Commit with message `docs: prepare github pages deployment`.
