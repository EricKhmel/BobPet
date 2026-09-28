/**
 * Where the pet keeps its settings and the session file the hooks read.
 *
 * Deliberately a copy of the same function in @bob-pet/shared rather than an import of
 * it. An extension package carries no node_modules, so anything the extension requires at
 * run time has to be inside its own dist - a value imported from the shared package
 * compiles to a `require` that throws on activation, on every platform. Types are fine,
 * because they are erased; values are not.
 *
 * It mirrors Electron's own choice per platform, so the pet, the hook and the extension
 * all agree on one location.
 */
export const PET_APP_NAME = 'Bob Pet';

export function petDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = ''
): string {
  const house = home || env.HOME || env.USERPROFILE || '';
  if (platform === 'win32') {
    const roaming = env.APPDATA ?? `${house}\AppData\Roaming`;
    return `${roaming}\${PET_APP_NAME}`;
  }
  if (platform === 'darwin') return `${house}/Library/Application Support/${PET_APP_NAME}`;
  return `${env.XDG_CONFIG_HOME || `${house}/.config`}/${PET_APP_NAME}`;
}
