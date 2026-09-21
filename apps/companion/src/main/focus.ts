import { basename, extname } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type FocusResult = { ok: boolean; message: string };
export type FocusTarget = { path?: string; excludePids?: number[]; excludeWindowHandle?: bigint };
export interface FocusAdapter {
  focusConfiguredApp(target?: FocusTarget): Promise<FocusResult>;
}

const TAB = '\t';
const REQUEST_TIMEOUT_MS = 6000;

/**
 * Win32 helper, loaded once into a warm PowerShell host.
 *
 * Deliberate differences from a naive EnumWindows grab:
 * - `FindMainWindow` rejects excluded pids (Bob Pet itself), invisible windows,
 *   owned popups, tool windows and untitled shells. Accepting those is what made
 *   the pet raise its own always-on-top overlay and report success.
 * - `Activate` verifies `GetForegroundWindow()` rather than assuming success.
 * - No synthetic keyboard input, no elevation, no injection.
 */
const WIN32_SOURCE = `
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class BobPetFocus {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool fAltTab);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

    const uint GW_OWNER = 4;
    const uint GA_ROOT = 2;
    const int GWL_EXSTYLE = -20;
    const long WS_EX_TOOLWINDOW = 0x00000080L;
    const int SW_MINIMIZE = 6;
    const int SW_RESTORE = 9;

    static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowTextW(h, s, 512); return s.ToString(); }

    public static IntPtr FindMainWindow(int[] pids, int[] excludePids, IntPtr excludeHwnd) {
        var wanted = new HashSet<int>(pids);
        var banned = new HashSet<int>(excludePids);
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            uint procId;
            GetWindowThreadProcessId(hWnd, out procId);
            int pid = (int)procId;
            if (!wanted.Contains(pid) || banned.Contains(pid)) return true;
            if (hWnd == excludeHwnd) return true;
            if (!IsWindowVisible(hWnd)) return true;
            if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return true;
            if (GetAncestor(hWnd, GA_ROOT) != hWnd) return true;
            if (((long)GetWindowLongPtr(hWnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
            if (Title(hWnd).Length == 0) return true;
            found = hWnd;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    public static bool Activate(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return false;

        uint targetPid;
        uint targetThread = GetWindowThreadProcessId(hWnd, out targetPid);
        AllowSetForegroundWindow((int)targetPid);

        if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);

        IntPtr fg = GetForegroundWindow();
        uint fgPid;
        uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
        uint thisThread = GetCurrentThreadId();

        bool attachedFg = fgThread != 0 && fgThread != thisThread && AttachThreadInput(thisThread, fgThread, true);
        bool attachedTarget = targetThread != 0 && targetThread != thisThread && targetThread != fgThread && AttachThreadInput(thisThread, targetThread, true);
        try {
            BringWindowToTop(hWnd);
            SetForegroundWindow(hWnd);
        } finally {
            if (attachedFg) AttachThreadInput(thisThread, fgThread, false);
            if (attachedTarget) AttachThreadInput(thisThread, targetThread, false);
        }
        if (GetForegroundWindow() == hWnd) return true;

        SwitchToThisWindow(hWnd, true);
        if (GetForegroundWindow() == hWnd) return true;

        ShowWindow(hWnd, SW_MINIMIZE);
        ShowWindow(hWnd, SW_RESTORE);
        return GetForegroundWindow() == hWnd;
    }

    public static string Describe(IntPtr h) { return Title(h); }
}
`;

/** Command loop: one tab-separated request per line in, one response line out. */
const HOST_SCRIPT = `
# Reading MainWindowTitle on protected system processes raises access errors that
# must not abort the scan, so failures stay non-terminating and are filtered below.
$ErrorActionPreference = 'Continue'
Add-Type @"${WIN32_SOURCE}"@
$TAB = [char]9
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $parts = $line.Split($TAB)
  $id = $parts[0]
  $target = $parts[1]
  $ex = $parts[2]
  $exH = $parts[3]
  try {
    # An 'if' statement returning an empty array collapses to $null in PowerShell,
    # which the [int[]] parameter then rejects; assign the empty array directly.
    $exclude = [int[]]::new(0)
    if ($ex) { $exclude = [int[]]@($ex -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ }) }
    $excludeHandle = [IntPtr]([int64]$exH)
    if ($target) {
      $procs = @(Get-Process -Name $target -ErrorAction SilentlyContinue)
    } else {
      $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -eq 'IBM Bob' -or $_.ProcessName -eq 'Bob' -or
        ($_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '* - IBM Bob')
      })
    }
    $procs = @($procs | Where-Object { $exclude -notcontains $_.Id })
    if ($procs.Count -eq 0) {
      [Console]::Out.WriteLine(($id, 'NOT_FOUND', '') -join $TAB)
    } else {
      $pids = [int[]]@($procs | ForEach-Object { $_.Id })
      $hwnd = [BobPetFocus]::FindMainWindow($pids, $exclude, $excludeHandle)
      if ($hwnd -eq [IntPtr]::Zero) {
        [Console]::Out.WriteLine(($id, 'NOT_FOUND', '') -join $TAB)
      } else {
        $desc = [BobPetFocus]::Describe($hwnd)
        $status = if ([BobPetFocus]::Activate($hwnd)) { 'SUCCESS' } else { 'NOT_FOREGROUND' }
        [Console]::Out.WriteLine(($id, $status, $desc) -join $TAB)
      }
    }
  } catch {
    [Console]::Out.WriteLine(($id, 'ERROR', $_.Exception.Message) -join $TAB)
  }
  [Console]::Out.Flush()
}
`;

/** `Get-Process -Name` accepts wildcards; keep only characters a real exe stem can contain. */
export function sanitizeProcessName(path?: string): string {
  if (!path || extname(path).toLowerCase() !== '.exe') return '';
  return basename(path, '.exe').replace(/[^A-Za-z0-9 ._-]/g, '');
}

export class WindowsFocusAdapter implements FocusAdapter {
  private host?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private buffer = '';
  private sequence = 0;
  private readonly pending = new Map<string, (parts: string[]) => void>();
  private disposed = false;

  /** Pays the one-off PowerShell + JIT cost at launch so a click costs tens of ms. */
  warmUp(): void {
    if (process.platform !== 'win32') return;
    void this.ensureHost().catch(() => undefined);
  }

  private ensureHost(): Promise<void> {
    if (this.host && !this.host.killed && this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        const encoded = Buffer.from(HOST_SCRIPT, 'utf16le').toString('base64');
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (error) {
        return reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.host = child;
      this.buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === 'READY') {
            resolve();
            continue;
          }
          const parts = line.split(TAB);
          const waiter = this.pending.get(parts[0]);
          if (waiter) {
            this.pending.delete(parts[0]);
            waiter(parts);
          }
        }
      });
      // PowerShell writes a CLIXML banner to stderr; it is not an error signal.
      child.stderr.resume();
      child.on('error', reject);
      child.on('exit', () => {
        this.host = undefined;
        this.ready = undefined;
        for (const [id, waiter] of [...this.pending]) {
          this.pending.delete(id);
          waiter(['', 'ERROR', 'focus helper stopped']);
        }
        reject(new Error('focus helper exited'));
      });
    });
    return this.ready;
  }

  async focusConfiguredApp(target: FocusTarget = {}): Promise<FocusResult> {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'Focusing IBM Bob is supported on Windows only.' };
    }
    if (this.disposed) return { ok: false, message: 'Unable to activate IBM Bob window.' };

    let parts: string[];
    try {
      await this.ensureHost();
      parts = await this.request(target);
    } catch {
      return { ok: false, message: 'Unable to activate IBM Bob window.' };
    }

    const status = parts[1] ?? 'ERROR';
    const detail = parts[2] ?? '';
    if (status !== 'SUCCESS') console.warn(`[focus] ${status}: ${detail}`);
    if (status === 'SUCCESS') return { ok: true, message: detail ? `Focused ${detail}` : 'Focused IBM Bob' };
    if (status === 'NOT_FOUND') return { ok: false, message: 'IBM Bob window not found. Please ensure IBM Bob is running.' };
    if (status === 'NOT_FOREGROUND') return { ok: false, message: 'Select IBM Bob to continue.' };
    return { ok: false, message: 'Unable to activate IBM Bob window.' };
  }

  private request(target: FocusTarget): Promise<string[]> {
    const host = this.host;
    if (!host) return Promise.reject(new Error('focus helper unavailable'));
    const id = String(++this.sequence);
    const name = sanitizeProcessName(target.path);
    const exclude = (target.excludePids ?? []).filter((pid) => Number.isInteger(pid) && pid > 0).join(',');
    const handle = (target.excludeWindowHandle ?? 0n).toString();
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A wedged host never recovers; drop it so the next click respawns a clean one.
        this.host?.kill();
        reject(new Error('focus helper timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, (parts) => {
        clearTimeout(timer);
        resolve(parts);
      });
      host.stdin.write(`${id}${TAB}${name}${TAB}${exclude}${TAB}${handle}\n`);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.host?.stdin.end();
    this.host?.kill();
    this.host = undefined;
    this.ready = undefined;
  }
}
