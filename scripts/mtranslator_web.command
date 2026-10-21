#!/bin/bash
# ==============================================================================
# mTRANSLATOR Web - Lanceur universel macOS
# Double-cliquez sur ce fichier dans le Finder pour lancer l'application Web !
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR/../web"

# Inclusion automatique des chemins Homebrew et Node standard sur macOS
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "========================================================"
echo "   Lancement de mTRANSLATOR Web"
echo "   Traducteur de mods Bethesda pour macOS & Web"
echo "========================================================"

# 1. Vérification de Node.js
if ! command -v node &>/dev/null; then
    osascript -e 'display dialog "Node.js n'\''a pas été trouvé sur votre Mac.\nVeuillez installer Node.js depuis https://nodejs.org/ ou via Homebrew (brew install node)." with title "mTRANSLATOR Web" buttons {"OK"} default button "OK" with icon stop'
    echo "ERREUR : Node.js introuvable sur votre Mac."
    echo "Veuillez installer Node.js depuis https://nodejs.org/ ou avec 'brew install node'."
    exit 1
fi

echo "✓ Node.js $(node -v) détecté."

# 2. Vérification des dépendances npm
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances du projet (première exécution)..."
    npm install
fi

# 3. Création automatique de .env si absent
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
fi

# 4. Port local
PORT="${PORT:-3000}"

# 5. Ouverture automatique du navigateur par défaut
(
    sleep 2
    if command -v open &>/dev/null; then
        echo "🌐 Ouverture du navigateur sur http://localhost:${PORT}..."
        open "http://localhost:${PORT}"
    fi
) &

echo "--------------------------------------------------------"
echo "  Application accessible sur : http://localhost:${PORT}"
echo "  Pour arrêter le serveur : appuyez sur Ctrl+C"
echo "--------------------------------------------------------"

# 6. Démarrage du serveur Vite / Express
npm run dev
