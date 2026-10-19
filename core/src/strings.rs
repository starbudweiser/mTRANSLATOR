// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Fichiers de chaînes localisées : `.strings` (zstring) et `.dlstrings`/`.ilstrings` (longueur + zstring).

use crate::io::{put_u32, Reader};
use anyhow::{bail, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Strings = 0,
    DlStrings = 1,
    IlStrings = 2,
}

impl Kind {
    pub fn from_list(l: u8) -> Self {
        match l {
            1 => Kind::DlStrings,
            2 => Kind::IlStrings,
            _ => Kind::Strings,
        }
    }

    pub fn from_path(p: &Path) -> Option<Self> {
        match p.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "strings" => Some(Kind::Strings),
            "dlstrings" => Some(Kind::DlStrings),
            "ilstrings" => Some(Kind::IlStrings),
            _ => None,
        }
    }

    pub fn ext(self) -> &'static str {
        ["strings", "dlstrings", "ilstrings"][self as usize]
    }
}

/// Table id -> octets bruts (sans nul final), ordre d'origine conservé.
#[derive(Clone, Debug)]
pub struct StringsFile {
    pub kind: Kind,
    pub entries: Vec<(u32, Vec<u8>)>,
    index: HashMap<u32, usize>,
}

impl StringsFile {
    pub fn new(kind: Kind) -> Self {
        Self { kind, entries: Vec::new(), index: HashMap::new() }
    }

    pub fn parse(kind: Kind, buf: &[u8]) -> Result<Self> {
        let mut r = Reader::new(buf);
        let count = r.u32()? as usize;
        let _size = r.u32()?;
        let base = 8 + count * 8;
        if base > buf.len() {
            bail!("fichier strings tronqué");
        }
        let mut f = Self::new(kind);
        for _ in 0..count {
            let id = r.u32()?;
            let off = base + r.u32()? as usize;
            let mut d = Reader::at(buf, off);
            if kind != Kind::Strings {
                let _len = d.u32()?;
            }
            f.set(id, d.zstr()?.to_vec());
        }
        Ok(f)
    }

    pub fn load(path: &Path) -> Result<Self> {
        let kind = Kind::from_path(path).ok_or_else(|| anyhow::anyhow!("extension inconnue : {}", path.display()))?;
        Self::parse(kind, &std::fs::read(path)?)
    }

    pub fn get(&self, id: u32) -> Option<&[u8]> {
        self.index.get(&id).map(|&i| self.entries[i].1.as_slice())
    }

    pub fn set(&mut self, id: u32, data: Vec<u8>) {
        match self.index.get(&id) {
            Some(&i) => self.entries[i].1 = data,
            None => {
                self.index.insert(id, self.entries.len());
                self.entries.push((id, data));
            }
        }
    }

    pub fn max_id(&self) -> u32 {
        self.entries.iter().map(|e| e.0).max().unwrap_or(0)
    }

    /// Sérialise ; les textes identiques partagent le même décalage, comme dans les fichiers officiels.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut dir = Vec::with_capacity(self.entries.len() * 8);
        let mut data = Vec::new();
        let mut seen: HashMap<&[u8], u32> = HashMap::new();
        for (id, s) in &self.entries {
            let off = *seen.entry(s.as_slice()).or_insert_with(|| {
                let off = data.len() as u32;
                if self.kind != Kind::Strings {
                    put_u32(&mut data, s.len() as u32 + 1);
                }
                data.extend_from_slice(s);
                data.push(0);
                off
            });
            put_u32(&mut dir, *id);
            put_u32(&mut dir, off);
        }
        let mut out = Vec::with_capacity(8 + dir.len() + data.len());
        put_u32(&mut out, self.entries.len() as u32);
        put_u32(&mut out, data.len() as u32);
        out.extend(dir);
        out.extend(data);
        out
    }
}

/// Les trois tables d'un plugin localisé.
#[derive(Clone, Debug)]
pub struct StringsSet {
    pub files: [StringsFile; 3],
}

impl Default for StringsSet {
    fn default() -> Self {
        Self { files: [StringsFile::new(Kind::Strings), StringsFile::new(Kind::DlStrings), StringsFile::new(Kind::IlStrings)] }
    }
}

impl StringsSet {
    /// Chemin attendu : `<dossier du plugin>/Strings/<nom>_<langue>.<ext>` (casse ignorée).
    pub fn path_for(plugin: &Path, lang_code: &str, kind: Kind) -> PathBuf {
        let dir = plugin.parent().unwrap_or(Path::new("."));
        let stem = plugin.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let name = format!("{stem}_{lang_code}.{}", kind.ext());
        let sdir = find_ci(dir, "strings").unwrap_or_else(|| dir.join("Strings"));
        find_ci(&sdir, &name).unwrap_or_else(|| sdir.join(name))
    }

    /// Charge les tables présentes (les absentes restent vides).
    pub fn load_for(plugin: &Path, lang_code: &str) -> Result<(Self, usize)> {
        let mut set = Self::default();
        let mut found = 0;
        for k in [Kind::Strings, Kind::DlStrings, Kind::IlStrings] {
            let p = Self::path_for(plugin, lang_code, k);
            if p.is_file() {
                set.files[k as usize] = StringsFile::load(&p)?;
                found += 1;
            }
        }
        Ok((set, found))
    }

    pub fn save_for(&self, plugin: &Path, lang_code: &str) -> Result<()> {
        for f in &self.files {
            let p = Self::path_for(plugin, lang_code, f.kind);
            if let Some(d) = p.parent() {
                std::fs::create_dir_all(d)?;
            }
            std::fs::write(p, f.to_bytes())?;
        }
        Ok(())
    }

    pub fn get(&self, list: u8, id: u32) -> Option<&[u8]> {
        self.files[Kind::from_list(list) as usize].get(id)
    }
}

/// Recherche d'une entrée de dossier sans tenir compte de la casse.
pub fn find_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.exists() {
        return Some(direct);
    }
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name))
        .map(|e| e.path())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_kinds() {
        for k in [Kind::Strings, Kind::DlStrings, Kind::IlStrings] {
            let mut f = StringsFile::new(k);
            f.set(1, b"Bonjour".to_vec());
            f.set(7, "Épée".as_bytes().to_vec());
            f.set(9, b"Bonjour".to_vec());
            f.set(12, Vec::new());
            let bytes = f.to_bytes();
            let g = StringsFile::parse(k, &bytes).unwrap();
            assert_eq!(g.entries, f.entries);
            assert_eq!(g.to_bytes(), bytes);
        }
    }

    #[test]
    fn shared_offsets() {
        let mut f = StringsFile::new(Kind::Strings);
        f.set(1, b"x".to_vec());
        f.set(2, b"x".to_vec());
        // 8 en-tête + 16 dossier + "x\0"
        assert_eq!(f.to_bytes().len(), 8 + 16 + 2);
    }
}
