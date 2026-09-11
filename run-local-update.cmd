@echo off
REM Entry point for Windows Task Scheduler -- launched by run-hidden.vbs so that no
REM console window is ever shown. Do not point the task at this file directly: the
REM extraction step can take minutes and a visible window invites someone to close
REM it, which kills the run mid-way (exit code 0xC000013A). Lesson from nedrug-gmp.
REM ASCII only on purpose: cmd.exe reads .cmd in the OEM codepage (CP949 here), so
REM non-ASCII comment lines get mis-parsed and executed as commands.
cd /d "%~dp0"
node scripts\run-local-update.mjs
exit /b %ERRORLEVEL%
