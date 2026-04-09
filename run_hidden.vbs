Set WshShell = CreateObject("WScript.Shell")
' Chay Backend an
WshShell.Run "cmd /c cd /d backend && venv\Scripts\uvicorn.exe main:app --port 8000", 0, False
' Chay Frontend an
WshShell.Run "cmd /c cd /d frontend && npm start", 0, False
