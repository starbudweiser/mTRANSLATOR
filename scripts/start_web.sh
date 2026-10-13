#!/bin/bash
# ==============================================================================
# Script de lancement CLI mTRANSLATOR Web (macOS / Linux / Serveur)
# ==============================================================================

set -e
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR/../web"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node &>/dev/null; then
    echo "ERREUR : Node.js n'est pas installé ou n'est pas dans le PATH."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installation des dépendances npm..."
    npm install
fi

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
fi

PORT="${PORT:-3000}"
export PORT

echo "Démarrage de mTRANSLATOR Web sur http://localhost:${PORT}..."
npm run dev
