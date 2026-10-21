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
- **Lanceur macOS 1-clic :** `python_app/mtranslator.command`
- **Lancement Terminal :**
  ```bash
  python3 python_app/mtranslator_app.py
  ```
- **Compilation .app native :** `./build_app.sh` génère `mTRANSLATOR.app` à la racine : l'interface Web (`dist/`) dans une fenêtre native, via `python_app/mtranslator_app.py`

Consultez [README_MACOS.md](docs/README_MACOS.md) pour le guide complet.
