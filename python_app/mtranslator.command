#!/bin/bash
# ==============================================================================
# mTRANSLATOR - Lanceur double-cliquable pour macOS
# Double-cliquez sur ce fichier dans le Finder pour lancer l'application !
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "========================================================"
echo "   Lancement de mTRANSLATOR (v2.5.0)"
echo "   Traducteur de mods Bethesda pour macOS"
echo "========================================================"

# Vérification de Python 3
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
else
    osascript -e 'display dialog "Python 3 n'\''a pas été trouvé sur votre Mac.\nVeuillez installer Python depuis https://www.python.org/downloads/ ou via Homebrew (brew install python)." with title "mTRANSLATOR" buttons {"OK"} default button "OK" with icon stop'
    exit 1
fi

# Lancement de l'application
$PYTHON_CMD mtranslator_app.py
