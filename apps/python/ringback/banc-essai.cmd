@echo off
REM ============================================================================
REM  RINGBACK - BANC D'ESSAI DE BOUT EN BOUT
REM
REM  Ce que ca fait : le produit est monte en entier, dans une base JETABLE,
REM  et parcouru case par case - les 8 natures de campagne, les 19 points de
REM  depart, les 10 issues d'appel. A la fin, un rapport lisible dit ce qui
REM  passe, ce qui echoue et ce qui n'est pas couvert.
REM
REM  AUCUN APPEL REEL NE PEUT PARTIR D'ICI : tout est en simulation, et le
REM  rapport le prouve verrou par verrou (premiere section).
REM  VOS DONNEES NE SONT PAS TOUCHEES : la base reelle donnees\ringback.db
REM  n'est jamais ouverte ; le banc refuse de demarrer si on la lui designe.
REM
REM  Double-clic : ca tourne dans cette fenetre (une minute environ), puis le
REM  rapport s'affiche ici ET s'ecrit dans deux fichiers, a cote de ce
REM  lanceur : rapport-banc-essai.html (a ouvrir dans le navigateur, c'est le
REM  plus lisible) et rapport-banc-essai.txt.
REM ============================================================================
setlocal
set PYTHONUTF8=1
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title RingBack - banc d'essai de bout en bout (simulation)
call :choisir_python || goto :fin
"%PY%" "%~dp0banc_essai.py" %*
set CODE=%errorlevel%
echo.
if "%CODE%"=="0" (
    echo ============================================================
    echo   TOUT PASSE. Le rapport detaille est ici :
    echo   "%~dp0rapport-banc-essai.html"
    echo   Double-cliquez ce fichier pour l'ouvrir dans le navigateur.
    echo ============================================================
) else (
    echo ============================================================
    echo   DES CONTROLES ONT ECHOUE - la liste est ci-dessus, et dans
    echo   "%~dp0rapport-banc-essai.html"
    echo   Chaque echec dit ce qui etait attendu et ce qui s'est produit.
    echo ============================================================
)
goto :fin

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

:fin
echo.
echo Appuyez sur une touche pour fermer cette fenetre.
pause >nul
exit /b %CODE%
