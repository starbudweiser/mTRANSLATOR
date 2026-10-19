# xtcore — cœur de traduction de mTRANSLATOR

Portage Rust des formats et de l'heuristique de [xTranslator](https://github.com/MGuffin/xTranslator)
(McGuffin, MPL‑2.0), pour Skyrim LE/SE, Fallout 4 et Starfield. Les fichiers de `src/` et `data/`
restent sous **MPL‑2.0** (voir `data/LICENSE-xTranslator-MPL2.txt`).

## Modules (`src/`)

| Module | Rôle |
|---|---|
| `io` | lecteur binaire borné (petit/gros boutiste) |
| `text` | codepages (UTF‑8 + repli ANSI), hachage FNV compatible xTranslator |
| `game` | jeux, `_recorddefs.txt` (champs traduisibles et procédures spéciales) |
| `strings` | `.strings` / `.dlstrings` / `.ilstrings` |
| `esp` | plugins ESP/ESM/ESL, réécriture à l'octet près, compression zlib, `XXXX` |
| `extract` | extraction des chaînes (index, hachage EDID, FormID normalisé) et réinjection |
| `sst` | SST de xTranslator, lecture v1→v8, écriture v8 identique |
| `dict` | dictionnaire global (dossier de SST), correspondance exacte |
| `heuristic` | recherche approchante (distance de mots), index inversé sans perte, rayon |
| `archive` | BSA v103/104/105 (zlib/LZ4) et BA2 GNRL v1/2/3/7/8 |
| `pex` | scripts Papyrus : analyse du bytecode, littéraux traduisibles, réécriture de la table |

## Ligne de commande (sorties JSON)

```bash
cargo build --release
target/release/xtcore extract Plugin.esp --lang french
target/release/xtcore translate Plugin.esp --dict UserDictionaries/SkyrimSE --sst out.sst --out Plugin_fr.esp
target/release/xtcore apply Plugin.esp --sst traduction.sst --out Plugin_fr.esp
target/release/xtcore search --dict UserDictionaries/SkyrimSE --text "Iron Sword"
target/release/xtcore archive-list Mod.bsa
target/release/xtcore pex script.pex
```

Le jeu est détecté d'après l'en-tête du plugin (`--game` pour forcer).

## Tests

```bash
cargo test --release                                   # tests unitaires
XT_REAL=1 cargo test --release --test real_files -- --nocapture   # vrais fichiers du disque SKYRIM
```

Résultats de référence (20/10/2026) :
- 1 500 plugins relus/réécrits à l'identique ; 1 635 SST réécrits à l'identique ;
- extraction conforme aux SST de xTranslator (≈96 % des clés, le reste = versions de mods différentes) ;
- Skyrim.esm localisé : 67 181 chaînes en 0,6 s ;
- heuristique : 105 436 requêtes contre 377 693 entrées en ≈1 s (46× plus rapide que le parcours
  exhaustif, résultats identiques) ;
- 60 BSA (13 985 fichiers) et 3 000 scripts PEX sans erreur.

## Écarts volontaires avec xTranslator

- La correspondance « identique » de l'heuristique vérifie le texte en plus du hachage 32 bits
  (xTranslator acceptait les collisions FNV).
