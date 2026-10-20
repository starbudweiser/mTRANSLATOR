#!/bin/bash
# ==============================================================================
# Compile "mTRANSLATOR.app" à la racine du projet, signe l'app,
# puis supprime tous les fichiers/dossiers temporaires.
# ==============================================================================

set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$ROOT"

APP_NAME="mTRANSLATOR"
APP_FINAL="${ROOT}/${APP_NAME}.app"
SRC="python_app/mtranslator_app.py"
WEB_DIST="dist"
ICON_PNG="assets/icon.png"
ICON_ICNS="assets/icon.icns"
BUILD_TMP="${ROOT}/.build_tmp"

export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PYINSTALLER_CONFIG_DIR="${BUILD_TMP}/cache"

cleanup() {
    # Ne pas toucher à ${ROOT}/dist : il contient le build Vite de la version Web.
    rm -rf "$BUILD_TMP" "${ROOT}/build" "${ROOT}/${APP_NAME}.spec" "${ROOT}/__pycache__" "${ROOT}/python_app/__pycache__"
}
trap cleanup EXIT

echo "--------------------------------------------------------"
echo "  Compilation de '${APP_NAME}.app'"
echo "--------------------------------------------------------"

[ -f "$SRC" ] || { echo "ERREUR : $SRC introuvable."; exit 1; }

if ! command -v pyinstaller &>/dev/null; then
    echo "Installation de PyInstaller..."
    pip3 install pyinstaller
fi

if ! python3 -c "import webview" &>/dev/null; then
    echo "Installation de pywebview (fenêtre native WebKit)..."
    pip3 install pywebview
fi

# Interface Web (React/Vite) affichée par l'app : recompilée à chaque build (sinon un dist/ ancien
# serait embarqué sans les dernières modifications).
echo "Compilation de l'interface Web..."
(cd web && { [ -d node_modules ] || npm install; } && npx vite build) || { echo "ERREUR : build Vite."; exit 1; }
[ -f "${WEB_DIST}/index.html" ] || { echo "ERREUR : ${WEB_DIST}/index.html introuvable."; exit 1; }

if [ ! -f "$ICON_ICNS" ]; then
    [ -f "$ICON_PNG" ] || { echo "ERREUR : $ICON_PNG introuvable."; exit 1; }
    echo "Création de l'icône ICNS..."
    python3 - <<PY
from PIL import Image
img = Image.open("${ICON_PNG}").convert("RGBA")
img.save("${ICON_ICNS}", format="ICNS")
PY
fi

# Cœur Rust (xtcore) embarqué dans l'app.
if command -v cargo &>/dev/null; then
    echo "Compilation du cœur Rust (xtcore)..."
    (cd core && cargo build --release)
fi
XTCORE_BIN="core/target/release/xtcore"
[ -x "$XTCORE_BIN" ] || { echo "ERREUR : $XTCORE_BIN introuvable (installer Rust : rustup)."; exit 1; }

mkdir -p "$BUILD_TMP"
rm -rf "$APP_FINAL"

pyinstaller \
    --noconfirm \
    --clean \
    --onedir \
    --windowed \
    --distpath "${BUILD_TMP}/dist" \
    --workpath "${BUILD_TMP}/work" \
    --specpath "${BUILD_TMP}" \
    --icon "${ROOT}/${ICON_ICNS}" \
    --add-data "${ROOT}/${ICON_PNG}:." \
    --add-data "${ROOT}/${WEB_DIST}:dist" \
    --add-binary "${ROOT}/${XTCORE_BIN}:." \
    --hidden-import webview \
    --osx-bundle-identifier "com.mtranslator.macos" \
    --name "$APP_NAME" \
    "${ROOT}/${SRC}"

APP_TMP="${BUILD_TMP}/dist/${APP_NAME}.app"
[ -d "$APP_TMP" ] || { echo "ERREUR : build échoué."; exit 1; }

PLIST="${APP_TMP}/Contents/Info.plist"
setkey() {
    /usr/libexec/PlistBuddy -c "Set :$1 $3" "$PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST"
}
if [ -f "$PLIST" ]; then
    setkey CFBundleDisplayName string "$APP_NAME"
    setkey CFBundleShortVersionString string "2.5.0"
    setkey NSHighResolutionCapable bool true
    setkey NSRequiresAquaSystemAppearance bool false
    setkey LSApplicationCategoryType string "public.app-category.utilities"
fi

cp -f "$ICON_ICNS" "${APP_TMP}/Contents/Resources/AppIcon.icns" 2>/dev/null || true

echo "Signature de l'application..."
"$(cd "$ROOT/.." && pwd)/_tools/sign_app.sh" "$APP_TMP"  # signature stable (_tools)

mv "$APP_TMP" "$APP_FINAL"

echo "--------------------------------------------------------"
echo "  Succès : ${APP_FINAL}"
echo "  Fichiers temporaires supprimés."
echo "--------------------------------------------------------"
