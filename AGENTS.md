# Bob Pet — Engineering Instructions

## Mission

Build **Bob Pet**, a self-contained desktop companion for people using IBM Bob IDE. It is an optional companion application and optional IDE extension—not a modification of IBM Bob. The repository must produce an independently installable Windows companion and a VSIX package that users can install through Bob’s standard Extensions UI when compatible.

## Non-negotiable integration boundary

1. Never edit, patch, inject into, unpack, or replace IBM Bob files or processes.
2. Do not rely on undocumented IBM Bob APIs. Treat a Bob/VS Code-compatible VSIX as an integration hypothesis that must be manually tested and recorded.
   **One sanctioned exception, approved by the project owner:** the companion may read IBM Bob's `task_pending_approvals` table in `~/.bob/db/bob.db` to learn whether Bob is waiting on the user for an approval. Read-only, one short query per poll with no connection held open, only while a tool is in flight, and any failure means "unknown" and the pet says nothing. Nothing is written, and no other table is read.
3. The companion must remain useful without the VSIX: it can idle, animate, be dragged/resized, and make a best-effort user-initiated request to focus a configured Bob window.
4. The VSIX is an optional integration layer. It offers commands and can exchange only predefined pet-state messages over a loopback/named-pipe connection. It must never run arbitrary commands received from the companion.
5. Do not collect source code, workspace paths, prompt contents, screen captures, analytics, or telemetry. Do not make runtime network calls.

## Repository layout

```text
apps/
  companion/                 # Electron/Tauri host and React renderer
packages/
  extension/                 # VSIX extension source and manifest
  shared/                    # Protocol schemas, state types, test fixtures
assets/
  pet/                       # Original pixel-art source frames only
docs/
  INSTALL.md
  INTEGRATION.md
  TESTING.md
scripts/
dist/                        # Generated installer and VSIX; never hand-edit
```

Keep renderer code separate from privileged host code. The renderer may access native capabilities only through a narrow, typed preload/command bridge.

## Desktop window behavior

- Create a transparent, frameless, always-on-top, skip-taskbar overlay with a minimal hit region. It must not steal focus merely by being visible.
- Save location, selected scale, mute, animation preference, and configured Bob executable path locally. On launch, clamp the saved position to an attached display.
- Use OS-specific adapters for always-on-top, workspace visibility, and focusing. Do not expose raw OS window handles to renderer code.
- A user click/double-click can invoke `focusMainApp()`. First ask the extension to focus Bob through documented extension commands if connected; otherwise locate only the configured Bob process/window and make one best-effort foreground request. If it fails, show a nonintrusive tooltip such as “Select IBM Bob to continue.”
- Do not use elevation, global input hooks, keyboard simulation, process injection, or focus-stealing workarounds.

## Protocol

The desktop companion and extension may use a named pipe (preferred on Windows) or a localhost endpoint bound solely to `127.0.0.1`. Generate an ephemeral secret on companion launch and require it during a versioned handshake.

Bob spawns each hook as a short-lived process that cannot be handed the secret in memory, so
the companion publishes the port and that launch's secret to `session.json` inside its own
user-data directory, with owner-only permissions, and removes it on quit. The secret is still
regenerated every launch and is never logged.

Allowed payloads are only:

```ts
type PetState = 'IDLE' | 'WORKING' | 'THINKING' | 'CELEBRATING' | 'SLEEPING' | 'FOCUS';
type Message =
  | { version: 1; type: 'hello'; secret: string }
  | { version: 1; type: 'set-state'; state: PetState }
  | { version: 1; type: 'focus-request' }
  | { version: 1; type: 'request-focus-ide' }
  | { version: 1; type: 'ping' };
```

Validate all messages at both ends. Reject unknown versions, fields, states, origins, or untrusted clients. Never bind a service to `0.0.0.0` or a LAN address.

## Visual direction

Create original pixel art inspired by the user’s supplied reference: a small white rounded robot, blue-to-purple cap, friendly black eyes, and a `</>` chest. Do not copy or bundle IBM-owned artwork unless explicit licensing is present. Keep the character asset and product name replaceable in configuration.

Use a fixed logical canvas and nearest-neighbor scaling. Standard size is 64px. The character is designed on a 64×64 grid, with 4 clear rows of headroom above it so a jump or a drag never clips the hard hat; the window is therefore the listed width by 68/64 of it tall. Provide these exact choices:

| Name | Scale | Display size |
| --- | ---: | ---: |
| Mini | 0.75× | 48px |
| Standard | 1× | 64px |
| Medium | 1.5× | 96px |
| Large | 2× | 128px |
| XL | 3× | 192px |

Use `image-rendering: pixelated` for bitmap presentation and integer canvas coordinates for particles. Honor reduced motion and high-contrast settings.

### Palette

- Normal visor: `#0f62fe`
- Alert visor: `#da1e28`
- Success visor: `#24a148`
- Dark background: `#161616`
- Dark panel: `#262626`
- Light background: `#f4f4f4`
- Light panel: `#ffffff`

## Animation state machine

Keep rendering and state transitions deterministic and separately testable.

- `IDLE`: intermittent blink every 4–6 seconds; gentle hover.
- `WORKING`: exactly a three-frame hammer down-swing, pixel anvil/gear, bounded spark particles, optional muted-by-default synthetic clink.
- `THINKING`: visor sweep and slight forward lean.
- `CELEBRATING`: jump, confetti, sparkle eyes.
- `SLEEPING`: slumped pose, dim/closed eyes, `Zzz` after configurable idle timeout.
- `FOCUS`: mini-laptop and typing animation.

Do not infer pet state from code, prompts, files, or user activity. Pet state comes from a
direct menu selection, or from IBM Bob's own documented hook events relayed over the
authenticated protocol.

Bob exposes `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop` as
command hooks configured in its `settings.json`. That is the only sanctioned source of
activity, and installing the hooks is the user's explicit opt-in: it happens solely through
the `Bob Pet: Connect to IBM Bob` command, which shows exactly what will be written and
requires confirmation. `Bob Pet: Disconnect from IBM Bob` removes them and leaves any other
hooks untouched. Never watch the workspace, the file system, the editor or the terminal to
guess what Bob is doing. Reading Bob's own record of a pending approval is not a guess, and
is the one exception.

Because Bob injects a hook's stdout into the model's context on `SessionStart` and
`UserPromptSubmit`, the hook command must never print to stdout. The pet must never put
words in the model's mouth.

The hook always exits 0 and never blocks or delays the agent. Bob treats exit code 2 as
"block this tool call"; the pet must not use it. The pet reports on Bob, it does not
police Bob, and a pet that is closed, slow or broken must make no difference to Bob at all.

The pet says what Bob is doing in a speech bubble under the character. The text is derived
from the hook payload - a verb and one short target, such as "Running npm test" - and the
target is reproduced exactly, never re-cased, so the line always names the thing Bob is
really acting on. It is rendered on the user's own screen only: never stored, logged or
transmitted, and the protocol carries no field capable of returning it.

The pet cannot answer Bob's approval prompts, and must not pretend otherwise. Bob only
re-checks a pending approval when its own internal event fires, and nothing outside Bob can
raise that; the only other route would be driving Bob's webview, which is injection.

The pet says Bob needs you only when Bob has recorded that it does: a row in
`task_pending_approvals` (the exception under the integration boundary above) created after
the current step began. No hook event carries this, and elapsed time never implies it - a
slow build is silent in exactly the same way as a blocked tool. Without a readable record
the pet may say a step is still going, and nothing about why.

## Build, security, and quality gates

- TypeScript strict mode; no `any` except narrowly justified platform bindings.
- Vite development server: `host: '127.0.0.1'`, `port: 5173`.
- No CDN assets, web fonts, third-party telemetry, or runtime downloads. Use Web Audio oscillators only; default to muted.

  **One sanctioned exception, approved by the project owner:** so that installing the
  extension is all a user has to do, the extension may download the companion once, from
  this project's own GitHub release, and only after the user agrees in a prompt that says
  what it will download and what it will add to Bob's settings. The SHA-256 of the exact
  published file is built into the extension at release time; a download that does not
  match is deleted, never run. It is unpacked into the extension's own storage folder,
  needs no elevation, and is removed when the extension is uninstalled. The companion
  itself still makes no network calls at runtime, and neither does the extension once the
  companion is in place.
- Keep permissions minimal. Never transmit secrets, and do not log protocol secrets.
- Add tests for state transitions, animation timing, scaling, position clamping, protocol schemas, auth failure, and extension cleanup.
- Test transparent-window lifecycle and focus behavior behind platform adapters/mocks. Manual tests must cover all five scales, drag, restart persistence, reduced motion, mute, clicking the pet, Bob unavailable, extension unavailable, and extension shutdown.
- Package the VSIX and Windows installer into `dist/`. Include SHA-256 checksums and version metadata.

## Documentation requirements

Maintain:

- `README.md`: purpose, feature overview, supported platforms, local development.
- `docs/INSTALL.md`: independent companion install, extension install from VSIX, uninstall, and troubleshooting.
- `docs/INTEGRATION.md`: what is officially supported, exact Bob version tested, extension compatibility result, protocol boundary, and known focus limitations.
- `SECURITY.md`: local IPC threat model, privacy behavior, vulnerability reporting path.
- `CHANGELOG.md`: user-visible changes.

Never claim official IBM affiliation, endorsement, or guaranteed compatibility. The final report must identify exact build artifacts, commands/tests run, tested IBM Bob version, and any unverified integration path.
