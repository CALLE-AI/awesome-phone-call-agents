@echo off
REM Windows: double-click this file. Nothing to install, nothing to type.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 -u -m certa serve --open %* & goto :eof)
where python >nul 2>nul && (python -u -m certa serve --open %* & goto :eof)
echo Certa needs Python 3.11 or newer: https://www.python.org/downloads/
pause
