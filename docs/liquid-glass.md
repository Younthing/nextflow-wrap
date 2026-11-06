# Liquid glass theme

The app keeps its liquid glass identity in both light and dark mode. All routes
inherit the shared material through `glass` and `glass-strong`; avoid page-specific
color overrides. Adjust the tokens in `src/app/globals.css` to tune the entire app.

- `--glass`: translucent content panels; `--glass-strong`: legible overlays and inputs
- `--glass-sheen`: directional reflection, kept subtle behind content
- `--glass-highlight`, `--glass-border`, `--glass-shadow`: rim and elevation
- `--glass-blur`, `--glass-saturation`: shared optical treatment
- Primary color denotes actions and selection; semantic and port colors retain meaning

The assistant reserves space on desktop (1100px and wider), can float inside the
app, and can move into a native/browser child window. Its DOM host stays mounted
while moving, preserving the chat and the React context/tool bridges. Closing a
child window docks the panel again. The child follows the main window theme.
Reduced transparency and unsupported backdrop filtering use opaque surfaces.

Design review workflow: unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.
The user's liquid glass preference takes precedence over its default advice to remove glass.
