# Bob Pet

Bob Pet is an independent pixel-art desktop companion for people using IBM Bob IDE. It is not an IBM product and is not affiliated with, endorsed by, or guaranteed compatible with IBM Bob.

![Bob Pet reacting as Bob thinks, runs a command, reads a file and finishes](docs/media/bobpet.gif)

**Windows and macOS.** Linux is not supported yet, and the extension says so rather than half-working if it is installed there.

**Open a folder in IBM Bob.** Bob starts each hook in the folder you have open, and with no folder open it uses its own playground, `~/.bob/playground` — a directory it does not create. On a machine that has never used the playground it is not there, and a hook cannot start in a directory that does not exist, so every hook fails and the pet reacts to nothing. This is Bob's behaviour, not something the pet can work around, so the extension warns you and names the directory.

The transparent overlay runs without an extension: it can stay above other windows, be repositioned, use five crisp pixel sizes, animate locally, and make a user-initiated, best-effort request to focus a configured Bob window. The optional VSIX adds commands and a status-bar entry to VS Code-compatible hosts. It never modifies IBM Bob.

## Privacy and safety

- No runtime network calls, telemetry, analytics, web fonts, source-code collection, prompt collection, screen capture, or workspace-path collection.
- Companion and extension exchange only a small versioned pet-state protocol on `127.0.0.1`, guarded by a fresh 256-bit secret.
- No elevation, process injection, global hooks, keyboard simulation, undocumented Bob APIs, or foreground-focus bypasses.
- Audio is synthesized locally and muted by default.

## Local development

Requires Node.js 20.11+ and npm 11.19.0. Dependencies are pinned in the package manifests. From this repository root:

```powershell
npm install
npm run build
npm test
npm run package
npm run checksums
```

Use `npm run dev --workspace=@bob-pet/companion` for the renderer. Vite is deliberately limited to `127.0.0.1:5173`.

The intended release files are `dist/bob-pet-companion-0.1.3-win-x64.exe`, `dist/bob-pet-0.1.3.vsix`, and `dist/SHA256SUMS.txt`. The installer is signing-ready, not signed; add an organization-issued certificate in the release pipeline.

See [installation](docs/INSTALL.md), [integration boundary](docs/INTEGRATION.md), [test checklist](docs/TESTING.md), and [security](SECURITY.md).
