// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Cœur de traduction des mods Bethesda (Skyrim LE/SE, Fallout 4, Starfield).
//!
//! Modules :
//! - [`io`] lecture binaire bas niveau
//! - [`text`] codepages et hachage FNV compatible xTranslator
//! - [`game`] jeux pris en charge et définitions des champs traduisibles
//! - [`strings`] fichiers `.strings` / `.dlstrings` / `.ilstrings`
//! - [`esp`] lecture/écriture des plugins ESP/ESM/ESL
//! - [`extract`] extraction et réinjection des chaînes d'un plugin
//! - [`sst`] dictionnaires SST de xTranslator (v1 à v8)
//! - [`dict`] dictionnaire global (correspondance exacte)
//! - [`heuristic`] recherche approchante par distance de mots
//! - [`archive`] archives BSA / BA2
//! - [`pex`] scripts Papyrus compilés

pub mod archive;
pub mod dict;
pub mod esp;
pub mod extract;
pub mod game;
pub mod heuristic;
pub mod io;
pub mod pex;
pub mod sst;
pub mod strings;
pub mod text;

pub type Sig = [u8; 4];

/// Signature lisible (« FULL », « NPC_ »…).
pub fn sig_str(s: &Sig) -> String {
    String::from_utf8_lossy(s).into_owned()
}

/// Signature depuis un texte de 4 octets.
pub fn sig(s: &str) -> Sig {
    let b = s.as_bytes();
    let mut out = [b' '; 4];
    out[..b.len().min(4)].copy_from_slice(&b[..b.len().min(4)]);
    out
}
