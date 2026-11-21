' VeloLab one-click: ensure the local server runs hidden, then open the page
Option Explicit
Dim fso, sh, base, node, cands, i, url, quiet, waited
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
url = "http://127.0.0.1:4173/"
quiet = False
For i = 0 To WScript.Arguments.Count - 1
  If LCase(WScript.Arguments(i)) = "/nobrowser" Then quiet = True
Next
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
If node = "" And Not fso.FileExists(node) Then
  If Not quiet Then
    MsgBox "Node.js not found. Install the LTS version from https://nodejs.org and click this shortcut again.", 48, "VeloLab"
  End If
  WScript.Quit 1
End If
If Not ServerUp(url) Then
  sh.Run """" & node & """ """ & base & "\server.mjs""", 0, False
  waited = 0
  Do While Not ServerUp(url) And waited < 40
    WScript.Sleep 500
    waited = waited + 1
  Loop
End If
If Not quiet Then
  If ServerUp(url) Then
    sh.Run url, 1, False
  Else
    MsgBox "Server did not start. Run server.mjs in a console to see the error.", 48, "VeloLab"
  End If
End If

Function ServerUp(u)
  Dim http, ok
  ok = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP.6.0")
  If Err.Number = 0 Then
    http.Open "GET", u & "api/info", False
    http.Send
    If Err.Number = 0 Then
      If http.Status = 200 Then ok = True
    End If
  End If
  Err.Clear
  On Error GoTo 0
  ServerUp = ok
End Function
