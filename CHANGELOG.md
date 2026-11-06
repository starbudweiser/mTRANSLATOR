# Changelog — mTRANSLATOR

Notes de version / release notes (EN + FR). Translations in IT and ES: see the Nexus Mods page.

## 1.4.0

**English**

- The macOS app is now native Swift (AppKit + WebKit) instead of a packaged Python program, so antivirus scanners no longer flag it. Same interface, same dictionaries, same machine translation (Google, Gemini), same menus and languages.
- The local dictionary is much lighter on disk (existing dictionaries are migrated automatically on first launch).
- Dictionaries window: header on one line, tabs no longer wrap, maintenance actions moved to a separate bar.
- Automatic translation window: the batch size menu no longer overflows its card.
- Local base: warning that xTranslator's .sst files are binary and must not be scanned there; set their folder in the editor's Suggestions panel instead (README updated).

**Français**

- L'appli macOS est maintenant native en Swift (AppKit + WebKit) au lieu d'un programme Python empaqueté, ce qui évite les fausses alertes antivirus. Même interface, mêmes dictionnaires, même traduction automatique (Google, Gemini), mêmes menus et langues.
- Le dictionnaire local est beaucoup plus léger sur le disque (les dictionnaires existants sont migrés automatiquement au premier lancement).
- Fenêtre Dictionnaires : en-tête sur une ligne, onglets sans retour à la ligne, actions de maintenance sur une barre à part.
- Fenêtre de traduction automatique : le menu de taille des lots ne déborde plus de sa carte.
- Base locale : avertissement indiquant que les .sst d'xTranslator sont binaires et ne doivent pas y être scannés ; indiquez plutôt leur dossier dans le panneau Suggestions de l'éditeur (README mis à jour).

## 1.3.1

**English**

- The counter of unsaved changes is now translated in English, Spanish and Italian.

**Français**

- Le compteur de modifications non enregistrées est maintenant traduit en anglais, espagnol et italien.

## 1.3.0

**English**

- Signed with a Developer ID and notarized by Apple: macOS now opens the app without a security warning.
- The app's launcher is now compiled from source when the app is built, instead of using PyInstaller's generic prebuilt launcher, which antivirus scanners tend to flag. No change in features.
- New animated splash screen at launch.
- The first letter of the app's name now uses the colour of its logo everywhere it appears.
- About window: credits updated.
- Version number aligned across the Skyrim Mac Toolkit.

**Français**

- Signée avec un certificat Developer ID et notarisée par Apple : macOS ouvre désormais l'appli sans avertissement de sécurité.
- Le lanceur de l'appli est maintenant compilé depuis les sources à la construction de l'appli, au lieu du lanceur générique précompilé de PyInstaller, souvent signalé par les antivirus. Aucun changement de fonctionnalités.
- Nouvel écran de lancement animé.
- La première lettre du nom de l'appli prend la couleur de son logo partout où il est écrit.
- Fenêtre À propos : crédits mis à jour.
- Numéro de version commun à tout le Skyrim Mac Toolkit.

<!-- gen_changelogs : entrées ci-dessous conservées -->

## 1.0.0

First public release. / Première version publique.
