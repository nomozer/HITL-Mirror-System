@echo off
echo === HITL Mirror - Starting in Background ===
echo Backend and Frontend are starting hiddenly...
echo The processes will automatically close 30 seconds after you close the website.

:: Chạy script ẩn
cscript //nologo run_hidden.vbs

echo Services launched. opening browser...
timeout /t 5 /nobreak > nul
start http://localhost:3000

exit
