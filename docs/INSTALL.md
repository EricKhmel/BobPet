# Install Bob Pet

## Companion (independent)

1. Obtain `bob-pet-companion-0.1.0-win-x64.exe` and verify it with `SHA256SUMS.txt`.
2. Run the installer. It is independent of IBM Bob and does not modify its files.
3. Launch **Bob Pet** from the Start menu. Right-click the pet for state, size, pause, and quit controls. The pet can be dragged; its safe on-screen location and preferences are saved locally.
4. To use click-to-focus, configure the IBM Bob executable path in Bob Pet settings when that control is provided by your build. If Windows rejects a foreground request, manually select IBM Bob; this is expected OS behavior.

## Optional VSIX

1. In IBM Bob, open **Extensions**.
2. Select **Install from VSIX…** and choose `bob-pet-0.1.0.vsix`.
3. Reload the IDE if prompted.
4. Open Settings and set `bobPet.companionPath` to the installed companion executable.
5. Run **Bob Pet: Start Pet**, then use the status bar or command palette for states, focus, settings, and stop.

The VSIX is a generic VS Code-compatible extension. Its installation and commands must be manually verified against the exact IBM Bob build in use; it is not a claim of IBM support or endorsement.

## Uninstall

Uninstall the companion from Windows Settings → Apps. Uninstall the optional VSIX from the Extensions view. Neither action alters IBM Bob files. Local Bob Pet settings may remain in the app data folder and can be removed manually.

## Troubleshooting

- **VSIX rejected:** Do not alter Bob’s installation. Record the error and use the companion alone; obtain IBM’s documented extension compatibility mechanism.
- **Pet does not focus Bob:** Select IBM Bob manually. Windows may block foreground activation.
- **Extension cannot start the pet:** Confirm the installed executable path and that the configured loopback port is free. No firewall/LAN configuration is required.
