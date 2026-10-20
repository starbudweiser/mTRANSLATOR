// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Textes personnalisés (`tMcMData`) : menus MCM `Interface/Translations/*_LANGUE.txt`,
//! fichiers `.ini` « res », RFTP, descriptions, fomod, et repli ligne à ligne.
//! Les types et leurs expressions viennent de `customTxtDefinition.txt` de xTranslator.
//! Le texte hors des chaînes traduites est conservé à l'octet près (fins de ligne comprises).

use crate::text::{ansi, string_hash, to_utf16le, utf16le};
use anyhow::{bail, Result};
use fancy_regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

const DEFINITION: &str = include_str!("../data/customTxtDefinition.txt");

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16,
    Ansi,
}

pub struct Def {
    pub label: String,
    pub regex: Regex,
    /// Encodage d'enregistrement imposé par le type (`utf16` pour les MCM).
    pub encoding: Encoding,
    /// Groupe portant l'identifiant de la chaîne (0 : aucun, l'identifiant est le n° de ligne).
    pub backref: usize,
    pub suffix: bool,
    pub fallback: bool,
    pub by_line: bool,
}

fn parse_defs(src: &str) -> Vec<Def> {
    let get = |k: &str, i: usize| {
        let key = format!("{k}_{i}=");
        src.lines().find_map(|l| l.strip_prefix(&key)).map(str::trim)
    };
    let count: usize = src.lines().find_map(|l| l.strip_prefix("CustomTypeCount=")).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
    (1..=count)
        .filter_map(|i| {
            let re = get("CustomTypeRegex", i)?;
            // PCRE de xTranslator : insensible à la casse, « . » couvre les retours à la ligne
            let regex = Regex::new(&format!("(?is){re}")).ok()?;
            let yes = |k: &str| get(k, i).is_some_and(|v| v.eq_ignore_ascii_case("true"));
            let encoding = match get("CustomTypeEncoding", i).unwrap_or("utf8").to_ascii_lowercase().as_str() {
                "utf16" => Encoding::Utf16,
                "utf8" => Encoding::Utf8,
                _ => Encoding::Ansi,
            };
            Some(Def {
                label: get("CustomTypeLabel", i).unwrap_or("").to_string(),
                regex,
                encoding,
                backref: get("CustomTypeBackrefID", i).and_then(|v| v.parse().ok()).unwrap_or(0),
                suffix: yes("CustomTypeSaveLangSuffixe"),
                fallback: yes("CustomTypeIsFallback"),
                by_line: yes("CustomTypeSearchByLine"),
            })
        })
        .collect()
}

pub fn defs() -> &'static [Def] {
    static D: OnceLock<Vec<Def>> = OnceLock::new();
    D.get_or_init(|| parse_defs(DEFINITION))
}

#[derive(Clone, Debug, Serialize)]
pub struct TxtString {
    pub id: usize,
    /// N° de ligne (par ligne) ou de correspondance (texte entier) : `stringID` de xTranslator.
    pub line: usize,
    pub index: u16,
    pub index_max: u16,
    pub key: String,
    pub rhash: u32,
    pub text: String,
    #[serde(skip)]
    pub span: (usize, usize),
}

#[derive(Serialize)]
pub struct Doc {
    pub kind: String,
    pub encoding: Encoding,
    pub suffix: bool,
    #[serde(skip)]
    pub def: usize,
    #[serde(skip)]
    pub text: String,
    pub strings: Vec<TxtString>,
}

/// Décodage : BOM UTF‑16/UTF‑8, UTF‑16 sans BOM, UTF‑8, sinon ANSI.
pub fn decode(b: &[u8]) -> (String, Encoding) {
    if let Some(r) = b.strip_prefix(&[0xFF, 0xFE]) {
        return (utf16le(r), Encoding::Utf16);
    }
    if let Some(r) = b.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(r).into_owned(), Encoding::Utf8Bom);
    }
    let odd_zeros = b.iter().skip(1).step_by(2).take(512).filter(|&&c| c == 0).count();
    if b.len() >= 4 && odd_zeros * 2 > b.len().min(1024) / 2 {
        return (utf16le(b), Encoding::Utf16);
    }
    match std::str::from_utf8(b) {
        Ok(s) => (s.to_owned(), Encoding::Utf8),
        Err(_) => (ansi(b), Encoding::Ansi),
    }
}

fn encode(s: &str, e: Encoding) -> Vec<u8> {
    match e {
        Encoding::Utf16 => {
            let mut v = vec![0xFF, 0xFE];
            v.extend(to_utf16le(s));
            v
        }
        Encoding::Utf8Bom => {
            let mut v = vec![0xEF, 0xBB, 0xBF];
            v.extend(s.as_bytes());
            v
        }
        Encoding::Utf8 => s.as_bytes().to_vec(),
        Encoding::Ansi => encoding_rs::WINDOWS_1252.encode(s).0.into_owned(),
    }
}

/// Lignes sans leur fin (`\n` ou `\r\n`), avec leur position dans le texte.
fn lines(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut start = 0;
    for l in text.split_inclusive('\n') {
        let body = l.strip_suffix('\n').unwrap_or(l);
        let body = body.strip_suffix('\r').unwrap_or(body);
        out.push((start, body));
        start += l.len();
    }
    out
}

/// Chaînes d'une correspondance : identifiant (groupe `backref` ou n° en hexadécimal).
fn push_caps(def: &Def, caps: &fancy_regex::Captures, base: usize, line: usize, out: &mut Vec<TxtString>) {
    let n = caps.len().saturating_sub(1);
    let key = (def.backref > 0)
        .then(|| caps.get(def.backref).map(|m| m.as_str()).filter(|s| !s.is_empty()))
        .flatten()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{line:08X}"));
    let rhash = if def.backref > 0 { string_hash(&key) } else { 0 };
    for j in 1..=n {
        if j == def.backref {
            continue;
        }
        let Some(m) = caps.get(j).filter(|m| !m.as_str().is_empty()) else { continue };
        out.push(TxtString {
            id: 0,
            line,
            index: j as u16,
            index_max: n as u16,
            key: key.clone(),
            rhash,
            text: m.as_str().to_owned(),
            span: (base + m.start(), base + m.end()),
        });
    }
}

fn scan(def: &Def, text: &str) -> Vec<TxtString> {
    let mut out = Vec::new();
    if def.by_line {
        for (i, (start, l)) in lines(text).into_iter().enumerate() {
            if l.is_empty() {
                continue;
            }
            if let Ok(Some(c)) = def.regex.captures(l) {
                push_caps(def, &c, start, i, &mut out);
            }
        }
    } else {
        for (i, c) in def.regex.captures_iter(text).flatten().enumerate() {
            push_caps(def, &c, 0, i, &mut out);
        }
    }
    for (i, s) in out.iter_mut().enumerate() {
        s.id = i;
    }
    out
}

/// Type retenu : celui (hors repli) qui reconnaît le plus de lignes, sinon le repli.
fn decide(text: &str) -> Option<usize> {
    let d = defs();
    let mut best: Option<(usize, usize)> = None;
    for (i, def) in d.iter().enumerate().filter(|(_, d)| !d.fallback) {
        let n = if def.by_line {
            lines(text).iter().filter(|(_, l)| !l.is_empty() && def.regex.is_match(l).unwrap_or(false)).count()
        } else {
            def.regex.captures_iter(text).take(10_000).count()
        };
        if n > 0 && best.map_or(true, |b| n > b.1) {
            best = Some((i, n));
        }
    }
    best.map(|b| b.0).or_else(|| d.iter().position(|d| d.fallback))
}

pub fn parse(b: &[u8], kind: Option<&str>) -> Result<Doc> {
    let (text, encoding) = decode(b);
    let def = match kind {
        Some(k) => defs().iter().position(|d| d.label.eq_ignore_ascii_case(k)).ok_or_else(|| anyhow::anyhow!("type de texte inconnu : {k}"))?,
        None => decide(&text).ok_or_else(|| anyhow::anyhow!("aucun type de texte ne correspond"))?,
    };
    let d = &defs()[def];
    let strings = scan(d, &text);
    Ok(Doc { kind: d.label.clone(), encoding, suffix: d.suffix, def, text, strings })
}

impl Doc {
    /// Texte reconstruit, encodé comme le veut le type (UTF‑16 pour les MCM, comme xTranslator).
    pub fn rebuild(&self, tr: &[(usize, &str)]) -> Result<Vec<u8>> {
        let mut ch: Vec<((usize, usize), &str)> = Vec::with_capacity(tr.len());
        for (id, t) in tr {
            let s = self.strings.get(*id).ok_or_else(|| anyhow::anyhow!("chaîne {id} inconnue"))?;
            if self.defs_by_line() && t.contains('\n') {
                bail!("chaîne {id} : retour à la ligne interdit dans ce type de fichier");
            }
            ch.push((s.span, t));
        }
        ch.sort_by_key(|c| c.0);
        let mut out = String::with_capacity(self.text.len());
        let mut last = 0;
        for ((a, b), t) in ch {
            if a < last {
                bail!("chaînes qui se chevauchent");
            }
            out.push_str(&self.text[last..a]);
            out.push_str(t);
            last = b;
        }
        out.push_str(&self.text[last..]);
        let d = &defs()[self.def];
        let enc = match (d.encoding, self.encoding) {
            (Encoding::Utf16, _) => Encoding::Utf16,
            (Encoding::Utf8, Encoding::Utf8Bom) => Encoding::Utf8Bom,
            (Encoding::Utf8, _) => Encoding::Utf8,
            (Encoding::Ansi, e) => e,
            (e, _) => e,
        };
        Ok(encode(&out, enc))
    }

    fn defs_by_line(&self) -> bool {
        defs()[self.def].by_line
    }
}

/// Nom de sortie : `Mod_ENGLISH.txt` → `Mod_FRENCH.txt` (casse de l'original conservée).
pub fn output_name(file_name: &str, lang: &str, suffix: bool) -> String {
    const LANGS: &[&str] = &["english", "french", "german", "italian", "spanish", "russian", "polish", "japanese", "chinese", "czech", "korean", "portuguese", "turkish", "danish", "finnish", "greek", "hungarian", "norwegian", "swedish", "brazilian", "ptbr", "en", "fr", "de", "it", "es", "ru", "pl", "ja", "cn", "zhhans", "zhhant"];
    if !suffix {
        return file_name.to_owned();
    }
    let (stem, ext) = file_name.rsplit_once('.').map_or((file_name, ""), |(s, e)| (s, e));
    let dot = if ext.is_empty() { "" } else { "." };
    let fix = |w: &str| if w.chars().all(|c| !c.is_lowercase()) { lang.to_uppercase() } else { lang.to_lowercase() };
    match stem.rsplit_once('_') {
        Some((base, l)) if LANGS.contains(&l.to_lowercase().as_str()) => format!("{base}_{}{dot}{ext}", fix(l)),
        _ => format!("{stem}_{}{dot}{ext}", lang.to_uppercase()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn definitions_load() {
        let d = defs();
        assert_eq!(d.iter().map(|d| d.label.as_str()).collect::<Vec<_>>(), vec!["mcm", "res", "rftp", "descfw", "Generic", "fomod"]);
        assert!(d[0].suffix && d[0].by_line && d[0].encoding == Encoding::Utf16 && d[0].backref == 1);
        assert!(d[4].fallback);
    }

    #[test]
    fn mcm_roundtrip() {
        let src = "$MCM_Title\tMy Mod\r\n; comment\r\n\r\n$MCM_Desc\t\tEnable the thing\r\n";
        let mut b = vec![0xFF, 0xFE];
        b.extend(to_utf16le(src));
        let doc = parse(&b, None).unwrap();
        assert_eq!((doc.kind.as_str(), doc.encoding), ("mcm", Encoding::Utf16));
        let got: Vec<_> = doc.strings.iter().map(|s| (s.key.as_str(), s.text.as_str(), s.line, s.index)).collect();
        assert_eq!(got, vec![("$MCM_Title", "My Mod", 0, 2), ("$MCM_Desc", "Enable the thing", 3, 2)]);
        assert_eq!(doc.strings[0].rhash, string_hash("$MCM_Title"));
        assert_eq!(doc.rebuild(&[]).unwrap(), b);
        let out = doc.rebuild(&[(1, "Activer la chose"), (0, "Mon mod")]).unwrap();
        let (t, _) = decode(&out);
        assert_eq!(t, "$MCM_Title\tMon mod\r\n; comment\r\n\r\n$MCM_Desc\t\tActiver la chose\r\n");
        assert!(doc.rebuild(&[(0, "a\nb")]).is_err());
    }

    #[test]
    fn mcm_written_utf16_even_from_utf8() {
        let doc = parse(b"$A\tHello\n", None).unwrap();
        assert_eq!(doc.encoding, Encoding::Utf8);
        assert_eq!(doc.rebuild(&[]).unwrap()[..2], [0xFF, 0xFE]);
    }

    #[test]
    fn fallback_and_fomod() {
        let g = parse(b"first line\n\nsecond\n", None).unwrap();
        assert_eq!(g.kind, "Generic");
        assert_eq!(g.strings.iter().map(|s| (s.key.as_str(), s.text.as_str())).collect::<Vec<_>>(), vec![("00000000", "first line"), ("00000002", "second")]);
        let f = parse(b"<moduleName>Cool</moduleName>\n<description>Line 1\nLine 2</description>", None).unwrap();
        assert_eq!(f.kind, "fomod");
        assert_eq!(f.strings.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(), vec!["Cool", "Line 1\nLine 2"]);
        let out = f.rebuild(&[(1, "Ligne")]).unwrap();
        assert!(decode(&out).0.ends_with("<description>Ligne</description>"));
    }

    #[test]
    fn names() {
        assert_eq!(output_name("SkyUI_ENGLISH.txt", "french", true), "SkyUI_FRENCH.txt");
        assert_eq!(output_name("Mod_english.txt", "french", true), "Mod_french.txt");
        assert_eq!(output_name("Mod.txt", "french", true), "Mod_FRENCH.txt");
        assert_eq!(output_name("Mod.ini", "french", false), "Mod.ini");
    }
}
