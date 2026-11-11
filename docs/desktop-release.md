# Desktop CI and releases

The workflow follows [Electron Fiddle's release pattern](https://github.com/electron/fiddle/blob/main/.github/workflows/release.yml): native builds upload artifacts; one downstream job publishes after all builds succeed. This project uses electron-builder rather than Fiddle's Electron Forge.

1. Open a PR: Linux packaged-app E2E runs, then all four native packaging jobs build unsigned packages. No signing secrets are passed to PR builds.
2. Update `desktop/package.json`'s version and push a matching stable tag, for example `desktop-v0.2.1`.
3. Linux E2E builds the Linux x64 server archive. Every desktop package receives this same archive for WSL/SSH connections.
4. Windows x64 produces an NSIS `.exe`; macOS arm64 and x64 each produce `.dmg` and `.zip`; Linux x64 produces `.AppImage`. Each macOS architecture builds on its own native runner so the bundled Next.js server has matching native dependencies.
5. A single release job collects packages, blockmaps and update metadata, merges both macOS file lists and verifies referenced assets' SHA-512 hashes. Only this job has `contents: write`.
6. Upload to a draft GitHub Release, then publish when uploads finish. A failed upload leaves a draft; reruns can replace draft assets but refuse to modify a public release.

Manual runs on branches build Actions artifacts without publishing. Manual runs on a matching tag can publish. Ordinary branch pushes do not create a release. MSI, DEB and Linux/Windows arm64 packages are not configured.

## Product theme

Set `NEXT_PUBLIC_PRODUCT_THEME=fluora` before building, or in the root `.env` files. Desktop shell and server scripts use Next.js's production `.env*` precedence and inline only this public theme id. Startup screens, the web app, assistant identity, notifications and generated project attribution share the product theme. Rebuild the desktop shell and server after changing it. CI can set the variable explicitly; `.env` files and private values are not bundled into the shell.

Existing assistant messages are conversation history and keep their original text. Start a new conversation after rebuilding to verify the updated identity. Names of the Nextflow engine, executable commands, and persistent storage/package identifiers keep their technical meanings.

## Signing

Signing remains optional for beta builds; an unsigned package is not a signed production release.

- macOS: `MAC_CSC_LINK` (base64 `.p12`), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for signing and notarization.
- Windows: `WIN_CSC_LINK` (base64 `.p12`) and `WIN_CSC_KEY_PASSWORD` for certificate signing. Provision an appropriate certificate or migrate to a managed signing service if required by the certificate provider.

The Windows shell uses WSL or SSH for execution. `pnpm --dir desktop dist:win` packages the shell locally; first provide the Linux server archives under `desktop/resources/server/` (CI downloads them from the tested Linux job).

## Validation and remaining hardening

The packaged-app E2E currently runs on Linux. Windows/macOS jobs verify type checking and packaging; installation, launch, signing and auto-update still need native acceptance coverage. CI only publishes stable versions with `latest*.yml` metadata; prerelease channels need their own policy before use.

For further supply-chain hardening, pin Actions to reviewed commit SHAs and add build provenance attestations, as Fiddle does. Keep release tags protected and configure production signing credentials in GitHub.
