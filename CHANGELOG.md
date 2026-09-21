# Changelog

## Unreleased — 2026-09-17

Artifact names stay at `0.1.0`; reinstall over the existing companion to pick this up.

### Added

- A timer in the speech bubble. Once a step has run for 12 seconds the line reads, for
  example, "Still going — Running npm test · 14s", and it counts up every second.
- A wrap-up when Bob finishes: "All done in 4m 12s: 12 steps, 3 files changed, 2 commands
  run" instead of just "All done". It is counted from the lines the hooks already send, so
  the protocol is unchanged, and it is kept in memory only.
- In IBM Bob, the status bar button goes back to "Start Bob Pet" 5 seconds after it says
  "Bob Pet stopped".

### Fixed

- Changing animation no longer blinks. The window used to resize and shift every time the
  speech bubble appeared, changed length or went away, and Windows shows a transparent
  window's stale frame for a moment while it catches up. The window is now one fixed size
  with room for the bubble, and its empty parts let the mouse through to whatever is
  behind. Each state now dissolves into the next over about a quarter of a second, and the
  bubble fades in, out and between lines. Positions are saved for the pet itself, so it
  stays put when its size changes.
- The pet now launches at the size it says it is. The window opened at the saved scale,
  but the pet inside it drew at 64px in the top-left corner until the first speech bubble
  arrived, because a bubble update was the only thing that told it its size. It now sizes
  itself from the saved settings as soon as it loads. Checked at all five scales.


- A hook the pet refused now gives up at once instead of hanging for 2.3 seconds. The pet
  closes a connection without a word when the handshake fails - for instance when the hook
  read a stale `session.json` - and the hook only listened for an idle timeout that such a
  close never triggers. It now treats the close as the end, and its connect deadline is a
  plain timer, which also covers a connection that is silently dropped.
- `BOB_PET_HOOK_DEBUG=1` now stamps each step with elapsed milliseconds and says where
  delivery stopped (connected, acknowledged, closed by the pet, no answer). The pet has a
  matching opt-in trace, `BOB_PET_IPC_DEBUG=1`, recording each connection and why it was
  refused. Neither ever logs the session secret.


- Clicking the pet now actually restores and foregrounds IBM Bob. The window search
  matched any process named like `*Bob*` and accepted hidden shell windows, so the
  always-on-top overlay matched itself, raised its own window, and still reported
  success. The search now excludes the companion's own process and window handle and
  requires a visible, unowned, titled, non-tool window.
- Focus results are truthful: activation is confirmed against `GetForegroundWindow()`
  instead of being assumed, so a failure is reported as a failure.
- A single press no longer fires the focus action up to three times; the overlay has one
  click surface and the host collapses concurrent requests into one activation.
- Dragging the pet works again without breaking click-to-focus. The click surface was a
  full-size `no-drag` region layered over the draggable one, and a draggable region never
  receives mouse events, so the two could not share pixels. The window is now moved from
  the main process and a press resolves by intent: under 4px of travel is a click, beyond
  it is a drag, and a drag never focuses IBM Bob.
- Dragging no longer grows the pet. `setPosition` re-derives the window size on every
  call and rounds it outward on a fractional-scale display, widening the window a few
  pixels per frame; the drag now sets explicit bounds, and the window is pinned by
  `min == max` size from creation rather than only after a scale change.
- Settings now live in `%APPDATA%\Bob Pet` instead of `%APPDATA%\@bob-pet\companion`.
  Electron derives the user-data directory from the application name and the companion
  never set one, so it fell back to the package name. An existing configuration is
  adopted on first launch and the legacy file retired; a configuration already present
  at the new path is never overwritten, and a malformed legacy file is left alone so the
  app falls back to defaults rather than carrying corruption forward.
- `npm run package` builds the VSIX again (the script referenced a workspace name,
  `@bob-pet/extension`, that does not exist; the package is named `bob-pet`).

### Added

- A speech bubble under the pet saying what Bob is doing: "Running npm test", "Reading
  index.ts", "Thinking about that…". The window grows downwards, and sideways at the
  smaller scales, to make room; the pet stays anchored on screen while it does, so he
  never appears to jump when a line arrives or leaves. The tail sits under his mouth so
  the line reads as his. A line stays up until the next event replaces it, and clears
  when he finishes or dozes off.

  The bubble is outside the drag surface: he is dragged by his body only, so the text
  stays selectable and the buttons stay clickable.

- The pet says when Bob looks like it is waiting on you. A tool Bob auto-approves is
  followed promptly by PostToolUse, which replaces the line; one that needs a decision sits
  there, and after a grace period the pet says so and raises a notification. The wording is
  hedged because a slow command is indistinguishable from a pending one through a hook.

  The pet does not answer approvals and does not try to. Bob only re-checks a pending
  request when its own internal event fires, emitted solely when you answer in Bob's UI;
  writing Bob's settings from outside only updates its webview display. Anything further
  would mean driving Bob's webview, which is injection. Decisions stay in Bob.

- The pet now reacts to what IBM Bob is actually doing, through Bob's own documented
  hook events rather than by watching the file system:


  | Bob event | Pet |
  | --- | --- |
  | `UserPromptSubmit` | `THINKING` - you sent a message |
  | `PreToolUse`, tool that runs or edits | `WORKING` - hammering |
  | `PreToolUse`, tool that reads or searches | `FOCUS` - at the laptop |
  | `PostToolUse` | `THINKING` - reasoning between tools |
  | `Stop` | `CELEBRATING` for ~3s, then `IDLE` |
  | `SessionStart` | `IDLE`; quiet for `idleMinutes` then `SLEEPING` |

  Tools are classified from the `tool_name` in Bob's payload rather than through `matcher`
  regexes, so the mapping survives Bob renaming or adding tools.

  `Bob Pet: Connect to IBM Bob` installs the hooks into `~/.bob/settings/settings.json`
  after showing exactly what it will write; `Bob Pet: Disconnect from IBM Bob` removes
  them and leaves anyone else's hooks alone. Bob injects a hook's stdout into the model's
  context and treats exit code 2 as "block", so the hook prints nothing and always exits
  0 under every input, including malformed payloads, and gives up after 700ms rather than
  ever delaying the agent.

- The hook path was silently corrupt. `resolveCompanion` built it from a template literal
  containing single backslashes, so the `resources`, `app.asar`, `dist` and `main` path
  segments were read as escape sequences - the one before `resources` became a carriage
  return - and the resulting path could never exist. Paths are now assembled with `join`,
  which has no escaping to get wrong.
- The hook is invoked as an inline `cmd` command instead of a generated `.cmd` shim. Bob
  runs hooks through `exec`, and cmd in the extension host refused to run the shim file
  at all, reporting the quoted path as not recognized, even though the file existed and
  `PATHEXT` contained `.CMD`. Chaining builtins with `&` needs no file resolution, and
  builtins were verified to work in that environment.
- The connect dialog is short. Putting the full command in its detail made the modal
  taller than the screen, pushing its buttons out of reach; the command goes to the
  output channel instead.
- The hook command clears `ELECTRON_NO_ASAR`. IBM Bob's extension host exports it and runs
  hooks through `exec`, which passes it down; with it set, `app.asar` stops behaving as a
  directory, so requiring the hook out of the archive failed at module load, before any
  error handling in the hook could run. The shim's `exit /b 0` then reported success, so
  the failure was completely invisible: hooks fired, the agent saw exit 0, and the pet
  never moved. The companion already cleared this variable when spawning; the shim now
  does too.
- The hook sends stdout to `nul` and stderr to a single overwritten
  `hook-last-error.log`, so a failing hook can never reach the agent's context and can
  still be diagnosed afterwards.
- `Connect` runs the hook once itself, exactly as an agent would, and reports a non-zero
  exit or unexpected stdout instead of leaving a silently dead pet.

- `BOB_PET_HOOK_DEBUG=1` makes the hook explain itself on stderr, which Bob ignores on
  exit 0. Off by default, because the normal path must stay silent.

- A carry animation while the pet is being dragged. One smoothed velocity vector drives
  every part so they read as a single character: the body leans into the direction of
  travel, shearing rows further from the feet by more; the hard hat lifts clear of the
  head and tilts so the trailing edge rises, as though the wind were getting under the
  brim; the eyes look where he is going; and releasing him plays a squash, a slight
  overshoot into a stretch, then a settle. Dropping the body during a carry is what
  buys the hat its headroom, since there are only three spare rows above the crown.
  Reduced motion and a paused pet keep the resting pose, and the size chip hides for
  the duration of the drag.

### Removed

- The workspace file watcher and the editor, task, terminal and debug listeners that used
  to drive pet state. They fired on any disk write, including one made by an unrelated
  tool, described editing activity rather than agent activity, and inferred state from
  file and user activity, which AGENTS.md forbids without explicit opt-in.

### Changed

- The hard hat is now traced from the reference rather than drawn by eye: the reference's
  head width scaled onto the pet's, and mirrored about the centre column. That showed the
  shape had been misread - the reference's two vertical lines are the edges of a raised
  centre crest whose flat top is the crown, with the shell's shoulders meeting it a few
  rows down, a line across the front that dips at both ends, and a flared brim. Its colour
  is the reference's diagonal gradient, `#0f62fe` top left to `#a56eff` bottom right, fitted
  to 440 sampled cells, where it used to run straight across. The brim sits three rows
  above the eyes, as in the reference.
- Four rows of headroom above the pet, so the taller hat is never clipped at the top of
  its jump or while being dragged. The window is the same width and 68/64 as tall.
- The celebration after Bob finishes lasts twice as long, 6.4 seconds.


- "Bob needs your OK" now means Bob needs your OK. It used to be "Bob may need you" on a
  12-second timer with no knowledge of Bob's state, so every long build raised a false
  alarm. The pet now reads Bob's own record of pending approval requests
  (`task_pending_approvals`, read-only, only while a tool is running) and speaks up -
  bubble plus one notification - only when Bob has actually asked. A step that is merely
  slow gets "Still going - <what it is doing>" and no notification. This relies on an
  undocumented Bob internal, adopted as an explicit exception in `AGENTS.md`.


- Hard hat: the two crest ridges are now placed off measurements taken from the
  reference rather than by eye - a shade under a third of the way out from the centre
  line instead of nearly touching it - and the accessory band sits low on the shell just
  above the brim, curving down at its ends the way a level ring around a dome does from
  the front. The shell also carries a hard-hat profile, flat across the crown and
  near-vertical at the flanks, rather than a plain ellipse.
- The hammer is a hammer: the head is a clawed back end, a neck, and a flared striking
  face with a hardened steel plate, and it turns with the swing - laid flat at the top of
  the wind-up, stood on end through the drop and the strike - instead of being the same
  axis-aligned rectangle in all three frames. The haft carries a highlight and starts at
  the pet's hand, which now rises with the shoulder on the backswing.

- Polished every animation state, keeping the same pixel idiom:
  - `IDLE` bounces noticeably faster (a 1.7s cycle rather than 4.5s), blinks through a
    lid that dips, closes and reopens instead of snapping shut, and glances left then
    right every few seconds.
  - `WORKING` now belongs to the character: the anvil stands in front of the pet rather
    than clipped into the corner, the hammer's handle runs back to the pet's own hand,
    its shoulder rises on the backswing, the whole body recoils on the strike, and the
    anvil face flashes under the sparks. The anvil is kept clear of the `</>` so the
    swing never cuts the glyph.
  - `THINKING` grows three thought dots in sequence, each fading out, and the eyes look up.
  - `CELEBRATING` raises both arms, opens a round mouth, sparkles the eyes as tapered
    four-point stars rather than plus signs, and drops mixed-shape confetti that falls
    and sways instead of drifting.
  - `SLEEPING` breathes, closes its eyes with curved lids, and floats three `Z`s that
    rise, swell and fade on their own stagger. The smallest `Z` is 4px, below which the
    diagonal has no room and the letter reads as an `I`.
  - `FOCUS` gets a real laptop: code lines scrolling up a screen, lit keys, alternating
    shoulders while typing, the eyes cast down, and the screen's glow spilling on the chin.

- Redrew the pixel character against the reference: an elliptical hard-hat dome with
  twin crest grooves replacing the stair-stepped pyramid, the blue-to-violet gradient
  running left to right rather than top to bottom, a rounded head with 7px eyes and
  inset highlights, a small curved smile in place of the wide bar, ear nubs, and a
  `</>` plaque flanked by shoulder blobs. Proportions follow the reference: the dome is
  0.95x and the brim 1.11x the head width. Shapes are generated from rounded-rect, dome
  and chevron helpers, so curves stay smooth at every scale.
- The Win32 helper is hosted in one warm PowerShell process started at launch, so a click
  costs tens of milliseconds instead of re-compiling the helper on every press.
- Removed the synthetic `keybd_event` Alt press used to work around the foreground lock,
  matching the documented "no simulated input" boundary.
- Added a "Set IBM Bob Location…" context-menu item so `bobExecutablePath` can be
  configured, which skips process discovery entirely.

## 0.1.0 — 2026-09-16

- Initial Windows-first independent companion and optional VSIX.
- Added original pixel robot with six deterministic animation states and exact Mini through XL scales.
- Added authenticated loopback protocol, local settings, privacy/security boundary, packaging configuration, and smoke-test documentation.
