# mTRANSLATOR — Éditions macOS & Web

**mTRANSLATOR** est une suite d'outils dédiée à la traduction de mods Bethesda (*Skyrim Special Edition*, *Fallout 4*, *Starfield*) spécialement conçue pour macOS et diffusable en version Web universelle.

Le projet dispose de **deux versions complémentaires** :
1. **La version Web universelle** (React + Vite + Express + Gemini AI + Glossaire SST local)
2. **L'application macOS native** (Python + pywebview, affiche l'interface Web compilée)

---

## 1. Version Web Universelle (Recommandée)

Interface moderne "Flat Fusion" issue de Google AI Studio avec édition en direct, validation des balises, intégration Gemini et parsing binaire complet.

### Lancement sur Mac :
- **Méthode 1-clic :** Double-cliquez sur `scripts/mtranslator_web.command` dans le Finder. Votre navigateur s'ouvre automatiquement sur `http://localhost:3000`.
- **Méthode Terminal :**
  ```bash
  cd web && npm install
  npm run dev
  ```
  *(Ou `scripts/start_web.sh`)*

### Configuration Gemini (Optionnelle) :
- Vous pouvez renseigner votre clé API Gemini dans le fichier `web/.env` (`GEMINI_API_KEY=...`) ou directement dans l'interface Web (modale IA).
- Si aucune clé n'est fournie, mTRANSLATOR bascule de façon transparente en mode hors-ligne via son glossaire SST local Bethesda.

### Installation dans le Dock macOS :
- **Dans Safari :** Allez dans le menu **Fichier > Ajouter au Dock...**
- **Dans Chrome / Brave :** Cliquez sur l'icône **Installer mTRANSLATOR** dans la barre d'adresses.

---

## 2. Application macOS native

Fenêtre native macOS (Python 3 + pywebview) qui affiche l'interface Web compilée (`dist/`), sans Node.js.

### Lancement direct :
- **Méthode 1-clic :** Double-cliquez sur `python_app/mtranslator.command` dans le Finder.
- **Méthode Terminal :**
  ```bash
  python3 python_app/mtranslator_app.py
  ```

### Compilation en application macOS `.app` :
```bash
./build_app.sh
```
L'application compilée `mTRANSLATOR.app` sera générée à la racine du projet et peut être déplacée dans `/Applications`.

---

## Fonctionnalités communes et moteurs

- **Formats supportés :** Plugins Bethesda (`.esp`, `.esm`, `.esl`), dictionnaires SST (`.sst` XML / binaire), tables MCM / chaînes (`.strings`, `.dlstrings`, `.ilstrings`, `.txt`, `.csv`, `.json`).
- **Validation stricte des balises :** Préservation intégrale de `[pagebreak]`, `<Alias=...>`, `%d`, `%s`, retours à la ligne `\r\n`.
- **Sauvegarde chirurgicale :** Écrasement in-place avec création automatique de backups horodatés.
- **Dictionnaires et mémoires :** Auto-alimentation de la base locale lors de chaque traduction validée.
