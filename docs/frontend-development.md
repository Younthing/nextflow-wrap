# Frontend development

The app keeps its existing glass theme and page layouts. Reusable primitives live in `src/components/ui`, shell components in `src/components/layout`, and domain components and queries in their feature folders.

## Component boundaries

- `EnvironmentForm` is controlled through `config` and `onChange`. It owns no API or persistence code. Executor selection uses a Radix radio group, including arrow-key navigation.
- `ProjectSettingsForm` edits manifest settings through the current editor session. Every mounted form gets unique field IDs.
- `StatusBadge` and `ProgressBar` are presentation components, independent of tables and queries. Progress includes accessible task counts; zero discovered tasks is indeterminate.
- `RunHeader` owns run actions and duration updates. Run detail owns data loading and tabs.
- `PanelNotice` and `PanelLoading` provide shared page feedback. Errors have an alert role and loading indicators have an accessible status.
- Components fetch through feature `queries.ts`. Editor autosave uses the same workflow mutations as the rest of the application.

## Editor ownership

`EditorProvider` creates a store and command registry for one editor session. The application mounts it above the routes so navigation retains local edits and clipboard state. Fixtures create their own provider and store, so multiple stories can render together.

Use `useEditorStore(selector)` from `editor-provider` to subscribe to state and `useEditorStoreApi()` for event handlers. Pure assistant operations receive their store through `createEditorActions(store)`. Each store also has its own save coordinator, including the request queue and acknowledged server revisions. `useEditorAutosave` captures the document at enqueue time and flushes dirty edits when the route unmounts. Existing revision/generation checks remain in force.

The standalone exports in `store.ts`, `editor-actions.ts` and `editor-save.ts` retain compatibility with non-React callers and domain tests. UI code must use the provider or explicitly inject its store. Keyboard commands run for the session most recently focused or clicked, including its portals.

## Tailwind and theme

- Tailwind 4 uses the CSS theme in `globals.css`; Next.js and Storybook import the same entry point.
- Keep full static utility names. Use CVA for component variants and `cn` to merge overrides. Do not construct utility names from runtime values.
- Preserve runtime dimensions, progress widths and graph coordinates as inline styles or CSS variables.
- Colors and repeated shadows use semantic theme variables. Syntax colors have light/dark tokens. React Flow, code viewer and assistant adapters live in `src/app/styles`.
- The reduced-motion media query shortens animations and transitions when requested by the operating system.

## Storybook and testing

Stories live alongside their owning area. Add states that apply to the component: default, disabled, invalid, long content, loading, empty and failure. Prefer typed args and controls. Use `play` for observable interactions and assertions.

Each story owns its QueryClient. Editor fixtures own their store and command registry. API fixtures in `src/mocks/story-handlers.ts` use fixed data, never the application simulator or a live AI backend. Unknown `/api/*` operations return 501; stories needing mutations must define explicit MSW handlers. Avoid mounting the application `Providers` in Storybook, since it starts a separate worker and real assistant discovery.

```bash
pnpm exec playwright install chromium  # first local browser-test run
pnpm test                             # Node domain tests
pnpm test:storybook                   # Chromium render, play and accessibility checks
pnpm build-storybook                  # production Storybook output
```

CI runs browser tests as well as typecheck, lint, unit tests and both production builds. The browser test configuration uses reduced motion so portal closing assertions do not race transitions.

Accessibility tests fail on semantic and keyboard-access violations. The `region` rule is excluded globally because isolated component stories do not constitute complete page landmarks. The existing palette has known contrast failures (for example, primary/destructive button text measures about 4.2:1 against the required 4.5:1 in light mode). `color-contrast` is excluded from this engineering-only refactor to preserve the requested appearance; a passing story suite therefore does not certify WCAG color contrast. Re-enable that rule when the palette is revised.

## CodeGraph

Use the local ignored `.codegraph` index to inspect dependencies before changes and affected callers afterward:

```bash
codegraph sync
codegraph explore useEditorStore --max-files 3
codegraph impact StatusBadge
codegraph affected src/features/editor/store.ts
```

When the CLI is not on PATH, `pnpm dlx @colbymchenry/codegraph@1.6.2` provides the same commands. The index is local and must not be committed.
