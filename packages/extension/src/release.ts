/**
 * Which companion build this extension installs, and what it must hash to.
 *
 * Filled in at release time by `scripts/stamp-release.mjs`, which reads the zip it just
 * built. The fingerprint travels inside the extension rather than beside the download, so
 * a replaced or damaged file is rejected instead of run. Empty values mean this build was
 * not stamped: nothing is downloaded, and the companion has to be installed by hand.
 */
export const COMPANION_RELEASE = {
  version: '',
  url: '',
  sha256: '',
  bytes: 0
};
