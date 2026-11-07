#!/bin/bash
# Compile la version Swift de mTRANSLATOR et assemble « mTRANSLATOR.app » à la racine du projet : exécutable Swift,
# interface Web (dist/), cœur Rust (xtcore), icône, identifiant de bundle habituel et signature stable (_tools/sign_app.sh).
# dist/ et core/target/release/xtcore doivent exister : le build_app.sh de la racine les compile avant d'appeler celui-ci.
# Usage : macos/build_app.sh [dossier de sortie]   (par défaut : racine du projet)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT_DIR="${1:-$ROOT}"
APP_NAME="mTRANSLATOR"
# Inchangé : le stockage de l'interface (dictionnaires, base locale) est rattaché à cet identifiant
BUNDLE_ID="com.mtranslator.macos"
VERSION="2.0.0"
ICON="$ROOT/assets/icon.icns"
APP="$OUT_DIR/$APP_NAME.app"

[[ -f "$ICON" ]] || { echo "❌ Introuvable : $ICON" >&2; exit 1; }
[[ -f "$ROOT/dist/index.html" ]] || { echo "❌ dist/index.html absent : compiler l'interface (web/) d'abord" >&2; exit 1; }
[[ -x "$ROOT/core/target/release/xtcore" ]] || { echo "❌ core/target/release/xtcore absent : cargo build --release dans core/" >&2; exit 1; }
WEB_VERSION=$(sed -n 's/^  "version": "\(.*\)",/\1/p' "$ROOT/web/package.json")
[[ "$VERSION" = "$WEB_VERSION" ]] || { echo "❌ version $VERSION (macos/build_app.sh) ≠ $WEB_VERSION (web/package.json)" >&2; exit 1; }

echo "→ Traductions"
python3 "$HERE/gen_strings.py"

echo "→ Tests"
swift test --package-path "$HERE" -q 2>&1 | tail -5

echo "→ Compilation"
swift build --package-path "$HERE" -c release -q
BIN="$(swift build --package-path "$HERE" -c release --show-bin-path)/$APP_NAME"

echo "→ Assemblage"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$APP_NAME"
cp "$ICON" "$APP/Contents/Resources/icon.icns"
cp -R "$ROOT/dist" "$APP/Contents/Resources/dist"
cp "$ROOT/core/target/release/xtcore" "$APP/Contents/Resources/xtcore"
# Langues déclarées : les panneaux système (ouvrir, enregistrer…) suivent la langue du Mac
for lang in fr en it es; do mkdir -p "$APP/Contents/Resources/$lang.lproj"; done
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundleDisplayName</key><string>$APP_NAME</string>
    <key>CFBundleExecutable</key><string>$APP_NAME</string>
    <key>CFBundleIconFile</key><string>icon.icns</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleLocalizations</key><array><string>fr</string><string>en</string><string>it</string><string>es</string></array>
    <key>LSMinimumSystemVersion</key><string>15.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# Signature stable avec _tools/sign_app.sh (certificat local) ; sans lui (compilation depuis
# le dépôt GitHub seul), signature ad hoc pour que l'appli se lance quand même.
SIGN_APP="$ROOT/../_tools/sign_app.sh"
if [ -x "$SIGN_APP" ]; then
    "$SIGN_APP" "$APP"
else
    echo "_tools/sign_app.sh absent : signature ad hoc."
    codesign --force --deep --sign - "$APP"
fi
echo "✓ Application créée : $APP"
