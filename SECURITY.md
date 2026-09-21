# Security and privacy

## Local IPC threat model

The companion listener binds exclusively to `127.0.0.1`; it never binds to a LAN address. A new random 256-bit secret is generated for each launch (or passed once from the extension launch command), and the first protocol message must authenticate it. Each newline-delimited payload has a 4 KiB cap, exact schema validation, exact version validation, and a five-second unauthenticated timeout. Secrets are not logged. One secret per launch is written to `session.json` in the companion's
own user-data directory so that IBM Bob's short-lived hook processes can authenticate; it is
owner-only, regenerated on every launch, and deleted on quit. On Windows that directory is
already per-user, and a process running as this user could equally read the extension's memory
or drive the pet directly, so this does not widen the trust boundary.

Only `hello`, `set-state`, `focus-request`, `request-focus-ide`, and `ping` are accepted.
`set-state` may carry a short label for the speech bubble, capped in length, stripped of
control characters, and existing only to be drawn on screen. The extension has no arbitrary-command protocol and does not forward source code, workspace paths, prompts, screenshots, or telemetry.

## Focus behavior

Focus is user initiated. The host asks a documented extension command first when connected; the native fallback inspects only the configured executable name, or processes whose name or main-window title identify IBM Bob, and never the companion's own process or window. It restores a minimized window and makes one best-effort foreground request, then verifies the result rather than reporting success blindly. It uses no elevation, injection, hooks, simulated input, or handle exposure to the renderer.

The Win32 calls run in a PowerShell helper started at launch and terminated on quit. It receives no interpolated code: the configured executable name is passed as data and stripped of everything outside `A-Z a-z 0-9 . _ -` and space, so a wildcard cannot widen the process match.

## Approvals

The pet has no say in them. It cannot approve, decline or defer a tool: the hook always
exits 0, and exit code 2 - which Bob would honour as a block - is deliberately never used.
Bob's own approval settings remain the only gate, and every decision is taken in Bob.

To know when Bob is waiting on you, the companion reads one table of IBM Bob's local
database, `task_pending_approvals` in `~/.bob/db/bob.db`, read-only and only while a tool is
in flight. It counts rows and reads no other column or table; the request payloads Bob
stores there are never read, shown, logged or sent. It writes nothing, so it cannot approve,
reject or alter a request. The database is Bob's own per-user file, which any process
running as this user can already read, so this does not widen the trust boundary.

## Agent activity

Pet state comes from IBM Bob's documented hook events, installed only by explicit user
confirmation and removable at any time. The hook reads Bob's JSON payload, maps the event name
(and for tool events the tool name) to one of six states, and sends that state plus a short
label for the bubble.

The label is built from the tool name and one recognised input field, shortened to a file's
basename where it is a path, and capped in length. It is drawn on the user's own screen and
goes nowhere else: nothing is stored, logged or transmitted, and the protocol has no message
that can carry text back out. Because it does put file names and command fragments on screen,
it is visible to anyone watching that screen or a share of it.

Prompt text, tool output and file contents are read from the payload but never shown, stored
or sent. The hook never writes to stdout, so it cannot inject into the model's context.

## Reporting

Until a project security mailbox is established, report vulnerabilities privately to the project maintainer rather than opening a public issue. Do not include session secrets in reports.
