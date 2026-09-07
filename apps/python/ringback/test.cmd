@echo off
rem Lance la suite de tests unitaires (unittest, bibliotheque standard).
rem Choix de l'interpreteur Python, dans l'ordre :
rem   - la variable d'environnement RINGBACK_PYTHON si elle est definie ;
rem   - "python" trouve dans le PATH.
setlocal
set PYTHONUTF8=1
cd /d "%~dp0"
call :choisir_python || exit /b 1
"%PY%" -m unittest discover -s tests -v %*
set CODE=%errorlevel%
echo.
echo Appuyez sur une touche pour fermer cette fenetre.
pause >nul
exit /b %CODE%

:choisir_python
if defined RINGBACK_PYTHON (
    if exist "%RINGBACK_PYTHON%" (
        set "PY=%RINGBACK_PYTHON%"
        exit /b 0
    )
    echo [ERREUR] La variable RINGBACK_PYTHON pointe vers un fichier introuvable :
    echo          "%RINGBACK_PYTHON%"
    echo          Corrigez-la, ou supprimez-la pour laisser le lanceur chercher Python.
    exit /b 1
)
where python >nul 2>nul
if not errorlevel 1 (
    set "PY=python"
    exit /b 0
)
echo [ERREUR] Aucun interpreteur Python n'a ete trouve. Deux solutions :
echo   1. definir la variable d'environnement RINGBACK_PYTHON vers votre python.exe
echo      (exemple : set RINGBACK_PYTHON=C:\chemin\vers\python.exe)
echo   2. ou installer Python 3.12 ou plus recent et l'ajouter au PATH.
exit /b 1
