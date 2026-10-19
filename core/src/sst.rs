// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Fichiers SST de xTranslator (traduction en cours + statuts), versions 1 à 8.
//! Lecture de toutes les versions, écriture en v8 (« SSU9 ») comme xTranslator 1.6.

use crate::io::{put_u32, Reader};
use crate::text::{to_utf16le, utf16le};
use crate::{sig_str, Sig};
use anyhow::{bail, Result};
use serde::Serialize;

/// Bits de `sStrParams`.
pub mod params {
    pub const TRANSLATED: u8 = 1 << 0;
    pub const LOCKED: u8 = 1 << 1;
    pub const INCOMPLETE: u8 = 1 << 2;
    pub const VALIDATED: u8 = 1 << 3;
    pub const DEPRECATED: u8 = (1 << 4) | (1 << 5);
    pub const OLD_DATA: u8 = 1 << 6;
    pub const PENDING: u8 = 1 << 7;
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Entry {
    pub list: u8,
    pub str_id: i32,
    pub form_id: u32,
    #[serde(serialize_with = "ser_sig")]
    pub rec: Sig,
    #[serde(serialize_with = "ser_sig")]
    pub field: Sig,
    pub index: u16,
    pub index_max: u16,
    pub rhash: u32,
    pub colab_id: u8,
    pub params: u8,
    pub source: String,
    pub dest: String,
}

fn ser_sig<S: serde::Serializer>(s: &Sig, z: S) -> Result<S::Ok, S::Error> {
    z.serialize_str(&sig_str(s))
}

impl Entry {
    /// Traduction complète : le bit « validé » n'étant jamais enregistré, une entrée
    /// sauvegardée sans statut partiel ni en attente est une traduction validée.
    pub fn is_validated(&self) -> bool {
        self.params & (params::PENDING | params::INCOMPLETE) == 0
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Sst {
    pub version: u8,
    pub flag: u8,
    pub masters: Vec<String>,
    pub colab: Vec<(i32, String)>,
    pub entries: Vec<Entry>,
}

const MAGIC: u32 = 0x3255_5353; // « SSU2 » = v1 … « SSU9 » = v8

fn wstr(r: &mut Reader) -> Result<String> {
    let n = r.i32()?;
    if n < 0 || n as usize > r.remaining() {
        bail!("longueur de chaîne SST invalide ({n}) à {}", r.pos);
    }
    Ok(utf16le(r.take(n as usize)?))
}

fn put_wstr(out: &mut Vec<u8>, s: &str) {
    let b = to_utf16le(s);
    put_u32(out, b.len() as u32);
    out.extend(b);
}

impl Sst {
    pub fn parse(buf: &[u8]) -> Result<Self> {
        let mut r = Reader::new(buf);
        let magic = r.u32()?;
        let version = (magic >> 24).wrapping_sub(MAGIC >> 24).wrapping_add(1);
        if !(1..=8).contains(&version) || magic & 0x00FF_FFFF != MAGIC & 0x00FF_FFFF {
            bail!("en-tête SST inconnu ({magic:#010x})");
        }
        let v = version as u8;
        let mut sst = Sst { version: v, ..Default::default() };
        if v > 3 {
            sst.flag = r.u8()?;
        }
        if v > 7 {
            for _ in 0..r.i32()?.max(0) {
                sst.masters.push(wstr(&mut r)?);
            }
        }
        if v > 6 {
            for _ in 0..r.i32()?.max(0) {
                let id = r.i32()?;
                sst.colab.push((id, wstr(&mut r)?));
            }
        }
        while !r.eof() {
            let mut e = Entry { list: r.u8()?, ..Default::default() };
            if v > 1 {
                e.str_id = r.i32()?;
                e.form_id = r.u32()?;
                if v > 4 {
                    e.rec = r.sig()?;
                }
                e.field = r.sig()?;
                if v > 2 {
                    e.index = r.u16()?;
                }
                if v > 3 {
                    e.index_max = r.u16()?;
                    e.rhash = r.u32()?;
                }
                if v > 5 {
                    e.colab_id = r.u8()?;
                }
            }
            e.params = r.u8()?;
            if v < 4 {
                e.params &= !(params::LOCKED | params::DEPRECATED);
            }
            e.source = wstr(&mut r)?;
            e.dest = wstr(&mut r)?;
            sst.entries.push(e);
        }
        Ok(sst)
    }

    pub fn load(path: &std::path::Path) -> Result<Self> {
        Self::parse(&std::fs::read(path)?).map_err(|e| e.context(path.display().to_string()))
    }

    /// Écriture v8 ; le bit « validé » n'est jamais enregistré (comme xTranslator).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut o = Vec::new();
        put_u32(&mut o, MAGIC + (7 << 24));
        o.push(self.flag);
        put_u32(&mut o, self.masters.len() as u32);
        self.masters.iter().for_each(|m| put_wstr(&mut o, m));
        put_u32(&mut o, self.colab.len() as u32);
        for (id, l) in &self.colab {
            put_u32(&mut o, *id as u32);
            put_wstr(&mut o, l);
        }
        for e in &self.entries {
            o.push(e.list);
            put_u32(&mut o, e.str_id as u32);
            put_u32(&mut o, e.form_id);
            o.extend_from_slice(&e.rec);
            o.extend_from_slice(&e.field);
            o.extend_from_slice(&e.index.to_le_bytes());
            o.extend_from_slice(&e.index_max.to_le_bytes());
            put_u32(&mut o, e.rhash);
            o.push(e.colab_id);
            o.push(e.params & !params::VALIDATED);
            put_wstr(&mut o, &e.source);
            put_wstr(&mut o, &e.dest);
        }
        o
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Sst {
        Sst {
            version: 8,
            flag: 0,
            masters: vec!["Skyrim.esm".into()],
            colab: vec![(1, "Moi".into())],
            entries: vec![Entry {
                list: 0, str_id: 5, form_id: 0x0100_0800, rec: *b"WEAP", field: *b"FULL",
                index: 0, index_max: 0, rhash: 42, colab_id: 1, params: params::TRANSLATED,
                source: "Iron Sword".into(), dest: "Épée en fer".into(),
            }],
        }
    }

    #[test]
    fn roundtrip_v8() {
        let s = sample();
        let b = s.to_bytes();
        assert_eq!(&b[..4], b"SSU9");
        assert_eq!(Sst::parse(&b).unwrap(), s);
    }

    #[test]
    fn reads_v1() {
        let mut b = b"SSU2".to_vec();
        b.push(2); // list
        b.push(params::TRANSLATED | params::LOCKED);
        put_wstr(&mut b, "Hello");
        put_wstr(&mut b, "Bonjour");
        let s = Sst::parse(&b).unwrap();
        assert_eq!(s.version, 1);
        assert_eq!(s.entries[0].params, params::TRANSLATED);
        assert_eq!(s.entries[0].dest, "Bonjour");
    }
}
