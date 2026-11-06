# mTRANSLATOR — Universal Web & macOS Edition

Suite logicielle de traduction pour mods Bethesda (*Skyrim Special Edition*, *Fallout 4*, *Starfield*) développée à partir de Google AI Studio et optimisée pour macOS & Web.

## Deux versions prêtes à l'emploi :

### 1. Version Web Universelle
- **Lanceur macOS 1-clic :** `scripts/mtranslator_web.command`
- **Lancement Terminal :**
  ```bash
  cd web && npm install
  npm run dev
  ```
  Accessible sur `http://localhost:3000`.
- **Mode IA & Hors-ligne :** Supporte l'API Gemini (via `.env` ou interface graphique) et le moteur de glossaire local SST Bethesda hors-ligne.

### 2. Application macOS native
- **Compilation .app native :** `./build_app.sh` compile `web/` (Vite) et `core/` (cargo), puis l'appli Swift (`macos/`, AppKit + WKWebView) et génère `mTRANSLATOR.app` à la racine, avec `dist/` et `xtcore` embarqués. Tests : `swift test --package-path macos` (comparaison avec les sorties de référence de l'ancien moteur Python : `macos/Tests/gen_reference.py`).
- **Serveur seul :** `mTRANSLATOR.app/Contents/MacOS/mTRANSLATOR --serve [--port N]`

Consultez [README_MACOS.md](docs/README_MACOS.md) pour le guide complet.
