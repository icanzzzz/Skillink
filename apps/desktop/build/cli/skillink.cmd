@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\Skillink.exe" "%~dp0skillink.mjs" %*
exit /b %ERRORLEVEL%
