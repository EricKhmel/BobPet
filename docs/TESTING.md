# Smoke-test checklist

Run these on a clean Windows test account after packaging:

- [ ] Verify installer and VSIX SHA-256 checksums; verify installer signing certificate when release signing is enabled.
- [ ] Install companion independently; confirm a transparent, borderless, always-on-top, skip-taskbar overlay appears without taking focus.
- [ ] Drag the pet, restart it, unplug/rearrange displays, and confirm safe restored placement.
- [ ] Use Mini (48px), Standard (64px), Medium (96px), Large (128px), and XL (192px), including non-100% display scaling; confirm crisp pixel edges.
- [ ] Exercise IDLE, WORKING, THINKING, CELEBRATING, SLEEPING, and FOCUS; confirm reduced motion/high contrast and pause behavior.
- [ ] Confirm clink is muted by default and no network request occurs.
- [ ] Click/double-click with Bob absent and with Bob present; confirm graceful focus success/failure behavior without input simulation.
- [ ] Install VSIX via Bob’s Extensions → Install from VSIX; record exact Bob version and result in `INTEGRATION.md`.
- [ ] Confirm Start/Stop/Focus/Set State/Open Settings commands and status bar behavior.
- [ ] Close the companion and deactivate/reload the extension; confirm process/listener cleanup and that stale secret connections fail.
