// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Dictionnaire global construit à partir des SST (`UserDictionaries/<jeu>/*.sst`).

use crate::heuristic::{Index, Item};
use crate::sst::{params, Sst};
use anyhow::Result;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub struct Dictionary {
    pub index: Index,
    exact: HashMap<u32, Vec<usize>>,
}

#[derive(Debug, Default, Serialize)]
pub struct LoadStats {
    pub files: usize,
    pub errors: Vec<String>,
    pub entries: usize,
}

impl Dictionary {
    pub fn from_items(items: Vec<Item>) -> Self {
        let index = Index::new(items);
        let mut exact: HashMap<u32, Vec<usize>> = HashMap::new();
        for (i, it) in index.items.iter().enumerate() {
            exact.entry(it.hash).or_default().push(i);
        }
        Self { index, exact }
    }

    /// Charge les SST d'un dossier ; `pair` filtre le suffixe (ex. « english_french »).
    pub fn load_dir(dir: &Path, pair: Option<&str>) -> Result<(Self, LoadStats)> {
        let suffix = pair.map(|p| format!("_{}.sst", p.to_ascii_lowercase()));
        let files: Vec<_> = std::fs::read_dir(dir)?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                let n = p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
                n.ends_with(".sst") && suffix.as_ref().map_or(true, |s| n.ends_with(s.as_str()))
            })
            .collect();
        let loaded: Vec<_> = files.par_iter().map(|p| (p, Sst::load(p))).collect();
        let mut stats = LoadStats { files: files.len(), ..Default::default() };
        let mut seen = HashSet::new();
        let mut items = Vec::new();
        for (p, r) in loaded {
            match r {
                Ok(sst) => {
                    for e in sst.entries {
                        let ok = !e.source.is_empty() && !e.dest.is_empty() && e.params & params::PENDING == 0;
                        if ok && seen.insert((e.source.clone(), e.dest.clone(), e.rec, e.field)) {
                            items.push((e.source, e.dest, e.rec, e.field));
                        }
                    }
                }
                Err(e) => stats.errors.push(format!("{}: {e:#}", p.display())),
            }
        }
        let items: Vec<Item> = items.into_par_iter().map(|(s, d, r, f)| Item::new(&s, &d, r, f)).collect();
        stats.entries = items.len();
        Ok((Self::from_items(items), stats))
    }

    pub fn len(&self) -> usize {
        self.index.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.index.items.is_empty()
    }

    /// Traduction exacte (même texte source), de préférence pour le même enregistrement/champ.
    pub fn exact(&self, q: &Item) -> Option<&Item> {
        let cands: Vec<&Item> = self.exact.get(&q.hash)?.iter().map(|&i| &self.index.items[i]).filter(|c| c.source == q.source).collect();
        cands.iter().find(|c| c.rec == q.rec && c.field == q.field).or(cands.first()).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sst::Entry;

    #[test]
    fn load_and_lookup() {
        let dir = std::env::temp_dir().join(format!("xtcore_dict_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mk = |s: &str, d: &str, rec: &[u8; 4], p: u8| Entry { source: s.into(), dest: d.into(), rec: *rec, field: *b"FULL", params: p, ..Default::default() };
        let sst = Sst {
            version: 8,
            entries: vec![
                mk("Iron Sword", "Épée en fer", b"WEAP", params::TRANSLATED),
                mk("Iron Sword", "Épée de fer", b"MISC", params::TRANSLATED),
                mk("Pending", "x", b"WEAP", params::PENDING),
            ],
            ..Default::default()
        };
        std::fs::write(dir.join("a_english_french.sst"), sst.to_bytes()).unwrap();
        std::fs::write(dir.join("b_english_german.sst"), sst.to_bytes()).unwrap();
        let (d, st) = Dictionary::load_dir(&dir, Some("english_french")).unwrap();
        assert_eq!((st.files, st.entries), (1, 2));
        let q = Item::new("Iron Sword", "", *b"MISC", *b"FULL");
        assert_eq!(d.exact(&q).unwrap().dest, "Épée de fer");
        assert!(d.exact(&Item::new("Pending", "", *b"WEAP", *b"FULL")).is_none());
        std::fs::remove_dir_all(dir).ok();
    }
}
