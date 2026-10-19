// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Jeux pris en charge et définitions des champs traduisibles (`_recorddefs.txt`).

use crate::text::Codepage;
use crate::{sig, Sig};
use anyhow::{bail, Result};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Game {
    Skyrim,
    SkyrimSE,
    Fallout4,
    Starfield,
}

impl Game {
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s.to_ascii_lowercase().as_str() {
            "skyrim" | "tes5" | "skyrimle" => Game::Skyrim,
            "skyrimse" | "sse" | "skyrimae" => Game::SkyrimSE,
            "fallout4" | "fo4" => Game::Fallout4,
            "starfield" | "sf" | "sf1" => Game::Starfield,
            _ => bail!("jeu inconnu : {s} (skyrim, sse, fo4, starfield)"),
        })
    }

    fn data(self) -> (&'static str, &'static str) {
        match self {
            Game::Skyrim => (include_str!("../data/Skyrim/_recorddefs.txt"), include_str!("../data/Skyrim/codepage.txt")),
            Game::SkyrimSE => (include_str!("../data/SkyrimSE/_recorddefs.txt"), include_str!("../data/SkyrimSE/codepage.txt")),
            Game::Fallout4 => (include_str!("../data/Fallout4/_recorddefs.txt"), include_str!("../data/Fallout4/codepage.txt")),
            Game::Starfield => (include_str!("../data/Starfield/_recorddefs.txt"), include_str!("../data/Starfield/codepage.txt")),
        }
    }

    /// Suffixe de langue des fichiers strings (`french` pour Skyrim, `fr` pour FO4/Starfield).
    pub fn lang_code(self, lang: &str) -> String {
        let l = lang.to_ascii_lowercase();
        if matches!(self, Game::Skyrim | Game::SkyrimSE) {
            return match l.as_str() {
                "en" => "english", "fr" => "french", "de" => "german", "es" => "spanish",
                "it" => "italian", "pl" => "polish", "ru" => "russian", "ja" => "japanese",
                "cn" | "zh" => "chinese", "cs" => "czech", _ => l.as_str(),
            }
            .to_string();
        }
        match l.as_str() {
            "english" => "en", "french" => "fr", "german" => "de", "spanish" => "es",
            "italian" => "it", "polish" => "pl", "russian" => "ru", "japanese" => "ja",
            "chinese" => "cn", "czech" => "cs", _ => l.as_str(),
        }
        .to_string()
    }

    /// Codepage d'écriture/lecture pour une langue (d'après `codepage.txt`).
    pub fn codepage(self, lang: &str) -> Codepage {
        let code = self.lang_code(lang);
        self.data()
            .1
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| l.split_once('='))
            .find(|(k, _)| k.trim().eq_ignore_ascii_case(&code))
            .map(|(_, v)| Codepage::parse(v))
            .unwrap_or_default()
    }

    pub fn record_defs(self) -> Vec<RecordDef> {
        parse_defs(self.data().0)
    }
}

/// Condition supplémentaire d'une définition (`-procN` de xTranslator).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Proc {
    All,
    Gmst,     // proc1 : EDID commence par « s »
    Perk,     // proc2 : EPFD juste après EPFT = 7
    Note,     // proc3 : Fallout NV (DATA <> 3)
    Perk2,    // proc4 : EPF2 juste après EPFT = 4
    DoorCnam, // proc5 : CNAM hors composant BFCB/BFCE
}

#[derive(Clone, Debug)]
pub struct RecordDef {
    pub field: Sig,
    pub record: Option<Sig>, // None = « **** » (tous)
    pub list: u8,            // 0 strings, 1 dlstrings, 2 ilstrings
    pub not_null: bool,
    pub no_zero: bool,
    pub ignored: bool,
    pub proc: Proc,
}

fn parse_defs(txt: &str) -> Vec<RecordDef> {
    txt.lines()
        .map(str::trim)
        .filter(|l| l.len() >= 16 && l.starts_with("Def_:") && l.is_char_boundary(16))
        .map(|l| {
            let rest = &l[16..];
            let rec = &l[10..14];
            let proc = match rest.find("proc").and_then(|i| rest[i + 4..].chars().next()) {
                Some('1') => Proc::Gmst,
                Some('2') => Proc::Perk,
                Some('3') => Proc::Note,
                Some('4') => Proc::Perk2,
                Some('5') => Proc::DoorCnam,
                _ => Proc::All,
            };
            RecordDef {
                field: sig(&l[5..9]),
                record: (rec != "****").then(|| sig(rec)),
                list: l.as_bytes()[15].wrapping_sub(b'0').min(2),
                not_null: rest.starts_with('*'),
                no_zero: rest.starts_with('!'),
                ignored: rest.starts_with('?'),
                proc,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defs_parse() {
        for g in [Game::Skyrim, Game::SkyrimSE, Game::Fallout4, Game::Starfield] {
            let d = g.record_defs();
            assert!(d.len() > 20, "{g:?}");
            assert!(d.iter().any(|x| x.field == *b"FULL" && x.record.is_none()));
        }
        let d = Game::SkyrimSE.record_defs();
        let gmst = d.iter().find(|x| x.record == Some(*b"GMST")).unwrap();
        assert_eq!(gmst.proc, Proc::Gmst);
        let nam1 = d.iter().find(|x| x.field == *b"NAM1" && x.record == Some(*b"INFO")).unwrap();
        assert!(nam1.not_null && nam1.list == 2);
        assert!(Game::Starfield.record_defs().iter().any(|x| x.ignored && x.record == Some(*b"IMAD")));
    }

    #[test]
    fn codepages() {
        assert!(Game::SkyrimSE.codepage("french").utf8);
        assert_eq!(Game::Fallout4.lang_code("french"), "fr");
        assert!(!Game::Fallout4.codepage("english").utf8);
        assert_eq!(Game::SkyrimSE.codepage("polish").fallback, encoding_rs::WINDOWS_1250);
    }
}
