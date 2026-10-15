param([int]$procId, [string]$folder, [int]$waitSeconds = 15)
# Answers the native "Select Folder" dialog of the T8 debug pry.exe with Win32 messages:
# WM_SETTEXT on the Folder edit (id 1152), then BM_CLICK on Select Folder (id 1), twice if it only navigated.
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Dlg {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static List<IntPtr> Dialogs(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h) && Cls(h) == "#32770") r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static IntPtr Child(IntPtr dlg, int id, string cls) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dlg, (h, l) => { if (GetDlgCtrlID(h) == id && Cls(h) == cls) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
$end = (Get-Date).AddSeconds($waitSeconds)
$answered = 0
while ((Get-Date) -lt $end) {
  $d = [Dlg]::Dialogs([uint32]$procId)
  if ($d.Count -eq 0) { if ($answered) { break }; Start-Sleep -Milliseconds 300; continue }
  $dlg = $d[0]
  $edit = [Dlg]::Child($dlg, 1152, 'Edit')
  $btn = [Dlg]::Child($dlg, 1, 'Button')
  if ($edit -eq [IntPtr]::Zero -or $btn -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 300; continue }
  [void][Dlg]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $folder)   # WM_SETTEXT
  [void][Dlg]::SendMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK
  $answered++
  "pressed Select Folder ($answered)"
  Start-Sleep -Milliseconds 1200
  if ($answered -ge 3) { break }
}
"dialogs left: $(([Dlg]::Dialogs([uint32]$procId)).Count)"
