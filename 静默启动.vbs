' VeloLab silent start: run server.mjs hidden (no window)
Option Explicit
Dim fso, sh, base, node, cands, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
node = ""
cands = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe"), _
  sh.ExpandEnvironmentStrings("%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe") _
)
For i = 0 To UBound(cands)
  If fso.FileExists(cands(i)) Then
    node = cands(i)
    Exit For
  End If
Next
If node = "" Then
  On Error Resume Next
  node = sh.Exec("cmd /c where node").StdOut.ReadLine()
  Err.Clear
  On Error GoTo 0
End If
If node = "" Then WScript.Quit 1
sh.Run """" & node & """ """ & base & "\server.mjs""", 0, False
