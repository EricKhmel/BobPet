# IBM Bob integration boundary

Bob Pet is an optional, standalone companion. It does not patch, inject into, unpack, replace, automate, or otherwise modify IBM Bob. It uses no undocumented IBM Bob APIs.

## Compatibility status

| Item | Status |
| --- | --- |
| Tested Environment | IBM Bob / VS Code runtime environment (tested with VS Code engine 1.102.0 / CLI 1.135.0 x64 commit `08d4889f9ec4a1685d257b9b95de036c8e1ce1e5`) |
| Generic VSIX acceptance | **Verified**: `bob-pet-0.1.0.vsix` installs cleanly via VSIX installation with zero modifications to host IDE binaries. |
| Official IBM support/endorsement | **Not claimed** — independent community companion. |
| Companion without VSIX | Fully supported standalone: transparent overlay, drag & bounds persistence, 5 scale modes (Mini to XL), 6 deterministic animation states matching refpic, synthesized audio, context menu, local settings, and best-effort foreground focus. |

The extension packages cleanly as a standard VS Code-compatible VSIX and was successfully installed and tested. If an IBM Bob distribution restricts marketplace or extension loading, standard manual VSIX installation through the **Extensions → Install from VSIX...** UI is supported without patching the IDE.

## Agent activity

Pet state comes from IBM Bob's own documented hook events: `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop`, each delivered as a JSON
object on the hook command's stdin. Configured in Bob's own `settings.json`
(`~/.bob/settings/settings.json`). Verified against IBM Bob 2.1.0 (`bob-code` 2.1.0) by
driving the desktop IDE: typing a prompt into Bob's chat moved the pet through
`THINKING`, `WORKING` and `CELEBRATING`, with no hook warnings in Bob's log.

Run **Bob Pet: Connect to IBM Bob** to install them; the command shows what it will write
and requires confirmation, then runs the hook once to prove the wiring before reporting
success. **Bob Pet: Disconnect from IBM Bob** removes them without touching anyone else's
hooks. Nothing about IBM Bob is modified: the hooks live in the user's own configuration
file, which is what that file is for.

Tools are classified from `tool_name` at runtime rather than through `matcher` regexes, so
the mapping survives Bob renaming or adding tools.

Bob injects a hook's stdout into the model's context on `SessionStart` and
`UserPromptSubmit`, and treats exit code 2 as "block the prompt or tool call". The hook
therefore prints nothing and always exits 0, and abandons delivery after 700ms rather than
delaying the agent. Set `BOB_PET_HOOK_DEBUG=1` to have it explain itself on stderr, which
Bob ignores on exit 0; a failing hook also leaves `hook-last-error.log` in the companion's
user-data directory.

## Approvals stay in Bob

The pet reports; it never decides. It cannot answer an approval prompt, and does not try to.

Bob re-reads its approval config while a request is pending, but only when its own
`_commandApprovalChange` event fires, and that is emitted from exactly one place:
`applyApprovalResponse`, when the user answers in Bob's UI. Writing Bob's settings from
outside reaches `onChangeProperty("approval.allowedExecutors")`, which only pushes the new
list to the webview for display - so an external approval shows up in Bob's chat and changes
nothing about the pending decision. Anything further would mean driving Bob's webview, which
is injection and out of bounds.

## Knowing when Bob needs you

Hooks cannot tell the pet that an approval is pending. Bob emits exactly five hook events -
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` - and none of them
means "waiting for you". `PreToolUse` fires before the approval gate, so a tool that is
merely slow produces the same silence as one that is blocked.

Bob does keep an exact record. When it raises an approval request it inserts a row into
`task_pending_approvals` in `~/.bob/db/bob.db` (stamped with `Date.now()`), and deletes it
the moment the user answers. While a tool is in flight the companion reads that table every
750ms and says "Bob needs your OK" only when a row created since the step began exists. Rows
from sessions that ended unanswered are older and never count.

**This is an undocumented internal**, adopted as a deliberate, owner-approved exception to
the integration boundary (see `AGENTS.md`). Verified against IBM Bob 2.1.0 (`bob-code`
2.1.0). It is read-only through Node's built-in `node:sqlite` with no connection held
between polls, so it cannot block Bob's writes or checkpoints. If a Bob update renames the
table, moves the database or locks it, every read returns "unknown" and the pet falls back
to saying a step is still going - it never turns an unreadable record into a claim.

Two environment details matter, both discovered against the real IDE. Bob runs hooks with
`exec`, so the command is handed to `cmd.exe`; the extension host exports
`ELECTRON_NO_ASAR`, which must be cleared or the hook cannot be loaded out of `app.asar`,
and cmd in that host would not execute a generated `.cmd` file, so the command chains
builtins with `&` instead.

## Protocol boundary

The listener is loopback-only and accepts only the version-1 messages `hello`, `set-state`, `focus-request`, and `ping`, authenticated by an ephemeral secret. State values are `IDLE`, `WORKING`, `THINKING`, `CELEBRATING`, `SLEEPING`, and `FOCUS`. The extension cannot send commands for the companion to execute.

## Known focus limitation

The extension may use its documented host command path. Native fallback checks only the configured executable’s process metadata and performs no foreground-policy workaround. Windows can reject the request; the pet shows “Select IBM Bob to continue.”
