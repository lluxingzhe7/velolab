' VeloLab 静默启动：不开窗口，把 server.mjs 放到后台跑
Option Explicit
Dim fso, sh, base, node, cands, i, c
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
  On Error GoTo 0
End If
If node = "" Then
  WScript.Quit 1
End If
sh.Environment("PROCESS")("CODE") = "7577"
sh.Run """" & node & """ """ & base & "\server.mjs""", 0, False
