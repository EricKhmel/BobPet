# Bob Pet

A pixel-art desktop pet that acts out what IBM Bob is doing.

![Bob Pet reacting as Bob thinks, runs a command, reads a file and finishes](https://raw.githubusercontent.com/EricKhmel/BobPet/main/docs/media/bobpet.gif)

It hammers while Bob runs commands, reads at a laptop while Bob searches your code, thinks
between steps, and throws confetti when Bob finishes. It tells you what Bob is on — "Running
npm test", "Editing index.ts" — and, when Bob is waiting for you to approve something, it
says so. Click it to bring Bob back to the front.

**Windows only for now.** IBM Bob also runs on macOS and Linux; the pet does not yet.

## Installing

Install the extension and answer **Set up Bob Pet**. That single answer covers the two
things it needs your permission for:

1. **Downloading the pet itself** — about 110MB, once. It comes from this project's GitHub
   releases and is checked against a fingerprint built into the extension before it runs; a
   file that does not match is discarded. It lands in the extension's own storage folder, so
   nothing is installed system-wide and no administrator rights are needed.
2. **Hooks in Bob's settings** (`~/.bob/settings/settings.json`) — this is how the pet learns
   what Bob is doing. The hooks print nothing and always exit 0, so they cannot change or
   block anything Bob does.

Decline and nothing is touched. Uninstalling the extension removes both again.

## While it is running

- **Drag** the pet anywhere; it remembers where you left it.
- **Right-click** for its state, size (five, from 48px to 192px), pause and quit.
- **Click** it to bring IBM Bob to the front.
- The speech bubble shows the step Bob is on, with a timer once a step runs long, and a
  summary when Bob finishes: "All done in 4m 12s: 12 steps, 3 files changed, 2 commands run".

## What it does with your things

- Everything stays on your computer. There is no telemetry, no analytics and no account.
  Nothing you type, and nothing Bob reads or writes, leaves the machine.
- The pet and this extension talk over a loopback connection on your own machine, with a
  secret generated fresh each time the pet starts.
- The pet reads one thing from Bob: its record of approvals it is waiting on, so it can tell
  you when Bob needs you. It is read-only and nothing else in Bob is touched.
- The one time anything is downloaded is the companion itself, as described above.

## Commands

| Command | What it does |
| --- | --- |
| Bob Pet: Start Pet / Stop Pet | Runs or closes the pet |
| Bob Pet: Focus Bob | Brings IBM Bob to the front |
| Bob Pet: Set Pet State | Forces a state, for a look at each animation |
| Bob Pet: Connect / Disconnect from IBM Bob | Adds or removes the hooks in Bob's settings |
| Bob Pet: Open Settings | This extension's settings |

## Settings

| Setting | Default | What it is for |
| --- | --- | --- |
| `bobPet.autoStart` | `true` | Start the pet when Bob opens |
| `bobPet.companionPath` | empty | Use a companion you installed yourself instead of the downloaded one |
| `bobPet.ipcPort` | `48173` | The loopback port to ask for; if it is taken, the pet takes a free one |

## Not an IBM product

Bob Pet is an independent side project. It is not affiliated with, endorsed by, or supported
by IBM, and compatibility with any particular build of IBM Bob is not guaranteed. It never
modifies IBM Bob's files: it uses Bob's own documented hooks and nothing else.

Source, issues and releases: https://github.com/EricKhmel/BobPet
