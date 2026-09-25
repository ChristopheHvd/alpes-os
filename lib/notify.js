// Native macOS notification, for news that must reach the user even with the
// dashboard's tab closed. Title and body travel as osascript arguments, never
// spliced into the script, so no text can break out of it.
import { spawn } from 'node:child_process';

export function notify(title, body) {
  if (process.platform !== 'darwin' || process.env.ALPES_OS_NO_NOTIFY === '1') return;
  try {
    spawn('osascript', [
      '-e', 'on run argv',
      '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"',
      '-e', 'end run',
      String(title), String(body ?? '').replace(/\s+/g, ' ').slice(0, 240),
    ], { stdio: 'ignore', detached: true }).unref();
  } catch (e) { /* no notification is never worth breaking the caller */ }
}
