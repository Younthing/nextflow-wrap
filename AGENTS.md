# Repository Guidelines

## Project Structure & Module Organization

This is a Next.js 16 App Router application for composing and running Nextflow workflows from notebook-published modules. Routes and global styling live in `src/app/`; run history is in `src/app/runs/`. Keep product code in `src/features/<domain>/` (such as `workflow`, `editor`, `project`, and `runs`). Put primitives in `src/components/ui/`, shell components in `src/components/layout/`, and shared helpers in `src/lib/`.

Mock API behavior belongs in `src/mocks/`; the product's example project (notebooks, modules, workflow, data) is `src/features/notebook/examples.ts`, seeded by the server and the mock backend alike; tests and stories share fixtures in `src/features/workflow/fixture-modules.ts`, `fixture-workflows.ts` and `src/features/notebook/test-fixtures.ts`. Component examples belong beside their area in `stories/` directories.

## Build, Test, and Development Commands

```bash
pnpm install                 # install dependencies
pnpm dev                     # start Next.js/Turbopack at localhost:3000
pnpm storybook               # preview UI components at localhost:6006
pnpm typecheck               # generate Next types and run TypeScript checks
pnpm lint                    # run ESLint and Next.js rules
pnpm test                    # run Vitest unit tests
pnpm build                   # create a production build
pnpm build-storybook         # verify Storybook production output
pnpm build-server            # standalone Linux server package (docs/server.md)
```

Before a PR, run `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm build-storybook`.

Cloud Agent machines install the [CodeGraph](https://github.com/colbymchenry/codegraph) CLI on `PATH` and index this repository during setup. Use `codegraph explore <query>` for symbol source and call paths. The index stays in `.codegraph/` and is not committed. Cursor is wired to `codegraph serve --mcp`.

## Coding Style & Naming Conventions

Write TypeScript and use the `@/` alias for imports from `src/`. Follow the existing two-space indentation and double-quote style. Use `kebab-case` filenames such as `workflow-canvas.tsx`; use `PascalCase` components and `camelCase` functions, values, and Zustand actions. Add `"use client"` only to modules that require browser state or hooks.

Use theme variables and `glass` utility classes from `src/app/globals.css`; do not hard-code colors. Keep non-React domain logic separate from UI components. Fetch API data through feature `queries.ts` hooks, not direct `fetch` calls in components.

## Testing Guidelines

Vitest runs `src/**/*.test.ts` in Node. Name tests next to the logic they cover (for example, `ports.test.ts` for `ports.ts`) and keep the simulator deterministic. Run one file with `pnpm vitest run src/features/workflow/ports.test.ts` or filter with `-t "description"`. Add or update a Storybook story for reusable UI changes.

`src/features/project/patterns.test.ts` spawns a real `nextflow` binary. They are not skipped when it is missing; the run fails. Install the pinned official release with `bash scripts/install-nextflow.sh` (Java 17–26 must already be on `PATH`; the script does not install a JDK). GitHub Actions runs that script after Temurin 21. This Cloud Agent environment is dashboard-managed (`environment.json` is not in the repo) and its image already has OpenJDK 21. Its `install` command must run the same script, or keep the equivalent launcher from `https://github.com/nextflow-io/nextflow/releases/download/v26.10.4/nextflow` on `PATH`, so later agents do not lose the binary. `~/.nextflow` is filled on the first `nextflow -version`.

`src/features/notebook/server/kernels.test.ts` starts a real Jupyter kernel through `python3`. It needs `python3 -m pip install ipykernel matplotlib` and fails when they are missing. CI installs both; this Cloud Agent environment's `install` command should do the same. The notebook editor runs Python cells in one persistent kernel per notebook (`src/features/notebook/server/kernels.ts`); without `jupyter_client` it falls back to a fresh process from the top. `NEXTFLOW_STUDIO_JUPYTER_PYTHON` picks another interpreter. `src/features/notebook/examples.test.ts` runs the example project's scripts and needs `pandas` and `scipy` as well (`python3 -m pip install pandas scipy`); CI installs them.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative English subjects, often scoped by delivery step (for example, `Step 4a: track runs live and browse their results`). Keep commits focused. PRs should describe behavior, note checks run, link issues when available, and include screenshots or Storybook evidence for visual changes. Do not commit `.env.local` or API keys.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
