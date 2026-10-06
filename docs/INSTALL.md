# Install Bob Pet

Windows and macOS are supported; Linux is not ready yet. The extension is published per
platform, so a host installing it picks the right one on its own — `bob-pet-0.2.1.vsix`
for Windows, `bob-pet-darwin-arm64.vsix` or `bob-pet-darwin-x64.vsix` for macOS. On macOS
the pet is unpacked from the extension once on first run, because a `.app` cannot survive
being carried in a zip with its symlinks and executable bits intact.

**Open a folder in IBM Bob.** Bob runs each hook inside the folder you have open, and with
no folder open it uses its playground, `~/.bob/playground`, which it does not create. If
that directory is not there the hooks cannot start at all and the pet appears but reacts to
nothing. The extension warns when it sees this and names the directory; opening any folder
is the quickest fix.

## From the extension (recommended)

1. In IBM Bob, open **Extensions** and install **Bob Pet** (or **Install from VSIX…** with
   `bob-pet-0.2.1.vsix`).
2. Answer **Set up Bob Pet** when it asks. The pet itself ships inside the extension; the
   only thing it needs permission for is the hooks in `~/.bob/settings/settings.json` that
   let it see what Bob is doing.
3. The pet drops in from the top of the screen when it is ready. Right-click it for state,
   size, transparency, pause and quit; drag it anywhere; its position and preferences are
   saved locally.

Nothing is downloaded and nothing is installed system-wide, so no admin rights are needed.
Answering **Cancel** leaves everything alone, and nothing is asked again until you run a Bob
Pet command yourself.

After that, the pet starts whenever Bob opens. Turn that off with `bobPet.autoStart`.

## Companion on its own (no extension)

1. Obtain `bob-pet-companion-0.2.1-win-x64.exe` and verify it with `SHA256SUMS.txt`.
2. Run the installer. It is independent of IBM Bob and does not modify its files.
3. Launch **Bob Pet** from the Start menu. Without the extension the pet still idles,
   animates, drags, resizes and can make a best-effort request to focus IBM Bob; it cannot
   know what Bob is doing, since that comes from Bob's hooks.
4. If you install the companion yourself and still want the extension, point
   `bobPet.companionPath` at the executable and the extension will use it instead of
   downloading its own.

## Optional VSIX, installed by hand

1. In IBM Bob, open **Extensions**.
2. Select **Install from VSIX…** and choose `bob-pet-0.2.1.vsix`.
3. Reload the IDE if prompted.
4. Run **Bob Pet: Start Pet**, then use the status bar or command palette for states,
   focus, settings, and stop. **Bob Pet: Connect to IBM Bob** installs the hooks, and
   **Bob Pet: Disconnect from IBM Bob** removes them.

The VSIX is a generic VS Code-compatible extension. Its installation and commands must be manually verified against the exact IBM Bob build in use; it is not a claim of IBM support or endorsement.

## Uninstall

Uninstalling the extension removes its hooks from Bob's settings and takes the pet with it;
the host runs that cleanup the next time it starts. A companion you installed
yourself is removed from Windows Settings → Apps. Neither action alters IBM Bob files.
Local Bob Pet settings may remain in the app data folder and can be removed manually.

## Troubleshooting

- **VSIX rejected:** Do not alter Bob’s installation. Record the error and use the companion alone; obtain IBM’s documented extension compatibility mechanism.
- **The pet appears but never reacts:** Open a folder in Bob. Bob starts each hook in the
  open folder, or in `~/.bob/playground` when no folder is open — and it does not create
  that playground, so on a machine that has never used it the hooks have no directory to
  start in. IBM Bob reports this only as `[Hooks] … hook failed` in its own log. Nothing in
  the pet can change it; opening any folder fixes it, as does creating that directory.
- **Pet does not focus Bob:** Select IBM Bob manually. Windows may block foreground
  activation. On macOS the pet asks the system to activate **IBM Bob** by name, so nothing
  needs configuring unless you renamed or moved the application; if you did, point Bob
  Pet's own settings at it (right-click the pet → Settings).
- **Extension cannot start the pet:** Confirm the installed executable path. The port does
  not need to be free: if `bobPet.ipcPort` is taken the pet takes any free port instead and
  publishes it in `session.json`, where the hooks and the extension look it up. No
  firewall/LAN configuration is required.
- **The pet cannot be found:** The Bob Pet output channel says where it looked. You can
  always install the companion yourself and point `bobPet.companionPath` at it.
