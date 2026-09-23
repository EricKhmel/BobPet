# Install Bob Pet

## From the extension (recommended)

1. In IBM Bob, open **Extensions** and install **Bob Pet** (or **Install from VSIX…** with
   `bob-pet-0.1.0.vsix`).
2. Answer **Set up Bob Pet** when it asks. That one answer covers both things it needs
   your permission for: a one-time download of the pet itself (about 110MB), and the hooks
   in `~/.bob/settings/settings.json` that let it see what Bob is doing.
3. The pet drops in from the top of the screen when it is ready. Right-click it for state,
   size, pause and quit; drag it anywhere; its position and preferences are saved locally.

The download comes from this project's GitHub releases and is checked against a
fingerprint built into the extension before it is run; a file that does not match is
discarded. It lands in the extension's own storage folder, so nothing is installed
system-wide and no admin rights are needed. Answering **Cancel** leaves everything alone,
and nothing is asked again until you run a Bob Pet command yourself.

After that, the pet starts whenever Bob opens. Turn that off with `bobPet.autoStart`.

## Companion on its own (no extension)

1. Obtain `bob-pet-companion-0.1.0-win-x64.exe` and verify it with `SHA256SUMS.txt`.
2. Run the installer. It is independent of IBM Bob and does not modify its files.
3. Launch **Bob Pet** from the Start menu. Without the extension the pet still idles,
   animates, drags, resizes and can make a best-effort request to focus IBM Bob; it cannot
   know what Bob is doing, since that comes from Bob's hooks.
4. If you install the companion yourself and still want the extension, point
   `bobPet.companionPath` at the executable and the extension will use it instead of
   downloading its own.

## Optional VSIX, installed by hand

1. In IBM Bob, open **Extensions**.
2. Select **Install from VSIX…** and choose `bob-pet-0.1.0.vsix`.
3. Reload the IDE if prompted.
4. Run **Bob Pet: Start Pet**, then use the status bar or command palette for states,
   focus, settings, and stop. **Bob Pet: Connect to IBM Bob** installs the hooks, and
   **Bob Pet: Disconnect from IBM Bob** removes them.

The VSIX is a generic VS Code-compatible extension. Its installation and commands must be manually verified against the exact IBM Bob build in use; it is not a claim of IBM support or endorsement.

## Uninstall

Uninstalling the extension removes its hooks from Bob's settings and deletes the pet it
downloaded; the host runs that cleanup the next time it starts. A companion you installed
yourself is removed from Windows Settings → Apps. Neither action alters IBM Bob files.
Local Bob Pet settings may remain in the app data folder and can be removed manually.

## Troubleshooting

- **VSIX rejected:** Do not alter Bob’s installation. Record the error and use the companion alone; obtain IBM’s documented extension compatibility mechanism.
- **Pet does not focus Bob:** Select IBM Bob manually. Windows may block foreground activation.
- **Extension cannot start the pet:** Confirm the installed executable path. The port does
  not need to be free: if `bobPet.ipcPort` is taken the pet takes any free port instead and
  publishes it in `session.json`, where the hooks and the extension look it up. No
  firewall/LAN configuration is required.
- **The download failed:** The notification offers **Try again**. A download that does not
  match its fingerprint is always discarded rather than run; the Bob Pet output channel
  records what was expected and what arrived. You can also install the companion yourself
  and set `bobPet.companionPath`.
