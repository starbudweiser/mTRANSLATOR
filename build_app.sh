#!/bin/bash
# ==============================================================================
# Compile "mTRANSLATOR.app" à la racine du projet : interface Web (React/Vite) → dist/, cœur Rust (xtcore),
# puis l'appli Swift (macos/build_app.sh) qui embarque les deux, la signe et l'assemble.
# ==============================================================================
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"

echo "--------------------------------------------------------"
echo "  Compilation de 'mTRANSLATOR.app'"
echo "--------------------------------------------------------"

# Interface Web, recompilée à chaque build (sinon un dist/ ancien serait embarqué sans les dernières modifications).
echo "Compilation de l'interface Web..."
(cd web && { [ -d node_modules ] || npm install; } && NODE_ENV=production npx vite build) || { echo "ERREUR : build Vite."; exit 1; }
[ -f dist/index.html ] || { echo "ERREUR : dist/index.html introuvable."; exit 1; }

# Cœur Rust (xtcore), embarqué dans l'app.
if command -v cargo &>/dev/null; then
    echo "Compilation du cœur Rust (xtcore)..."
    (cd core && cargo build --release)
fi
[ -x core/target/release/xtcore ] || { echo "ERREUR : core/target/release/xtcore introuvable (installer Rust : rustup)."; exit 1; }

exec "$ROOT/macos/build_app.sh" "$@"
