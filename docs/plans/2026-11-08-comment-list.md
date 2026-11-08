# Prototype comment list implementation plan

**Goal:** Show saved component comments on the right, allow explicit saving, and independently submit selected comments for edits, prototype generation, or documentation.

**Architecture:** Extend the commentary runtime with a page-scoped list backed by existing persisted edit metadata and explicit asynchronous hydration status. Execute explicit comment snapshots without changing the canvas selection. Batch captures compose numbered component screenshots and notes into a single request to the existing host confirmation dialogs.

**Tech stack:** React, TypeScript, commentary shadow UI, Vitest and react-test-renderer.

1. Add failing tests for explicit batch membership, independent action routing, stale targets, capture failures, and concurrent submissions in `src/vendor/axhub-commentary/comment-batch.test.ts`.
2. Implement collection and batch dispatch in `vendor/axhub-commentary/src/core/editor/comment-batch.ts`; connect to lifecycle callbacks and existing host dispatch.
3. Add a tested `CommentListView` with multi-select, select all, loading/empty/error/progress states and preserved selection between actions. Reuse `PageSkeleton` with the list layout while existing persistence restores metadata. No additional iframe is introduced.
4. Add an explicit save button to `ComponentPromptFooter`, preserve persistence failures for retry, and open the list after saving. Open the list on component selection and expose a permanent right-edge entry during component annotation.
5. Run focused commentary and bridge tests, TypeScript checks, and rebuild the vendored commentary runtime. Review the diff and generated distribution.

Validation: `pnpm exec vitest run src/vendor/axhub-commentary`; `pnpm exec tsc --noEmit -p tsconfig.json`; `pnpm vendor:build:commentary`.

## Implementation notes

- Explicit saving flushes queued writes and waits for persistence. Failures keep the note available for retry.
- Initial and route-change restoration expose loading and error states; failed reads preserve local annotations and offer retry. The edge entry is protected from selection-mode click interception.
- List submissions carry `preserveOnAutoClear` through the preview host so an AI edit does not automatically delete comments needed by the other two actions.
- Batch screenshots use a numbered PNG contact sheet, preserving each component's note and source selector in the request. Existing confirmation dialogs handle one combined request.
- The root TypeScript command is blocked by existing TS6305 missing project-reference outputs. A temporary check of the commentary dependency graph passed with ES2022 libraries and existing unused-code diagnostics disabled.
- Browser visual verification was interrupted by active user changes in Chrome; no browser acceptance or screenshot is claimed.
