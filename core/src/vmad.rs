// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Champs `VMAD` (scripts Papyrus attachés aux enregistrements) : chaînes des propriétés
//! de type String / tableau de String, et réécriture du champ. Reprend `TESVT_VMAD.pas` :
//! un VMAD dont la structure n'est pas reconnue est ignoré en entier (`bBreak`).

use crate::io::Reader;
use anyhow::{bail, Result};

/// Chaîne trouvée dans un VMAD : `off` pointe sur le préfixe de longueur (u16).
#[derive(Clone, Debug, PartialEq)]
pub struct VmadStr {
    pub off: usize,
    pub bytes: Vec<u8>,
    pub script: String,
    pub prop: String,
}

/// `getFragmentID` : seuls ces enregistrements portent des fragments après les scripts.
fn fragment_id(rec: &[u8; 4]) -> Option<u8> {
    match rec {
        b"PERK" => Some(0),
        b"PACK" => Some(1),
        b"SCEN" => Some(2),
        b"INFO" => Some(3),
        b"QUST" => Some(4),
        _ => None,
    }
}

struct Decoder<'a> {
    r: Reader<'a>,
    script: String,
    prop: String,
    out: Vec<VmadStr>,
}

impl<'a> Decoder<'a> {
    fn skip(&mut self, n: usize) -> Result<()> {
        self.r.take(n).map(|_| ())
    }

    fn skip_len_string(&mut self) -> Result<()> {
        let n = self.r.u16()? as usize;
        self.skip(n)
    }

    /// `getDataString` : un nom vide conserve le nom précédent.
    fn name(&mut self) -> Result<Option<String>> {
        let n = self.r.u16()? as usize;
        let b = self.r.take(n)?;
        Ok((n > 0).then(|| String::from_utf8_lossy(b).into_owned()))
    }

    fn len_string(&mut self) -> Result<()> {
        let off = self.r.pos;
        let n = self.r.u16()? as usize;
        let bytes = self.r.take(n)?.to_vec();
        self.out.push(VmadStr { off, bytes, script: self.script.clone(), prop: self.prop.clone() });
        Ok(())
    }

    fn script(&mut self, read_name: bool) -> Result<()> {
        if read_name {
            if let Some(s) = self.name()? {
                self.script = s;
            }
        }
        self.skip(1)?; // statut
        for _ in 0..self.r.u16()? {
            self.property()?;
        }
        Ok(())
    }

    fn count(&mut self) -> Result<u32> {
        self.r.u32()
    }

    fn property(&mut self) -> Result<()> {
        if let Some(p) = self.name()? {
            self.prop = p;
        }
        let kind = self.r.u8()?;
        self.skip(1)?; // statut
        match kind {
            0 => {}
            1 => self.skip(8)?,
            2 => self.len_string()?,
            3 | 4 => self.skip(4)?,
            5 => self.skip(1)?,
            7 => self.structure()?,
            11 => { let n = self.count()? as usize; self.skip(8 * n)? }
            12 => {
                for _ in 0..self.count()? {
                    self.len_string()?;
                }
            }
            13 | 14 => { let n = self.count()? as usize; self.skip(4 * n)? }
            15 => { let n = self.count()? as usize; self.skip(n)? }
            17 => {
                for _ in 0..self.count()? {
                    self.structure()?;
                }
            }
            k => bail!("type de propriété VMAD inconnu ({k})"),
        }
        Ok(())
    }

    fn structure(&mut self) -> Result<()> {
        for _ in 0..self.count()? {
            self.property()?;
        }
        Ok(())
    }

    /// Fragments (non lus) : décalage, deux chaînes.
    fn fragment_list(&mut self, n: u16) -> Result<()> {
        for _ in 0..n {
            self.skip(9)?;
            self.skip_len_string()?;
            self.skip_len_string()?;
        }
        Ok(())
    }

    fn aliases(&mut self) -> Result<()> {
        for _ in 0..self.r.u16()? {
            self.skip(12)?;
            for _ in 0..self.r.u16()? {
                self.script(true)?;
            }
        }
        Ok(())
    }

    fn fragments(&mut self, version: u16, fid: u8) -> Result<()> {
        if self.r.eof() {
            return Ok(());
        }
        match (version, fid) {
            (1..=5, 4) => {
                self.skip(1)?;
                let n = self.r.u16()?;
                self.skip_len_string()?; // fichier du script de fragments
                self.fragment_list(n)?;
                self.aliases()
            }
            (6, 0) => { self.skip(1)?; self.script(true) }
            (6, 1..=3) => { self.skip(2)?; self.script(true) }
            (6, 4) => {
                self.skip(1)?;
                let n = self.r.u16()?;
                // script de quête : ses propriétés ne sont lues que s'il est nommé
                if let Some(s) = self.name()? {
                    self.script = s;
                    self.script(false)?;
                }
                self.fragment_list(n)?;
                self.aliases()
            }
            _ => Ok(()),
        }
    }
}

/// Chaînes d'un champ VMAD ; `None` si le VMAD est illisible (ignoré, comme xTranslator).
pub fn decode(buf: &[u8], rec: &[u8; 4]) -> Option<Vec<VmadStr>> {
    let mut d = Decoder { r: Reader::new(buf), script: String::new(), prop: String::new(), out: Vec::new() };
    let res = (|| -> Result<()> {
        let version = d.r.u16()?;
        d.skip(2)?; // format des objets
        for _ in 0..d.r.u16()? {
            d.script(true)?;
        }
        if let Some(fid) = fragment_id(rec) {
            d.fragments(version, fid)?;
        }
        Ok(())
    })();
    res.ok().map(|_| d.out)
}

/// Réécrit un VMAD : chaque `(off, texte)` remplace la chaîne préfixée située à `off`
/// (UTF-8, tronquée à 65 535 octets sur une frontière de caractère).
pub fn rewrite(buf: &[u8], changes: &[(usize, &str)]) -> Result<Vec<u8>> {
    let mut ch: Vec<_> = changes.to_vec();
    ch.sort_by_key(|c| c.0);
    let mut out = Vec::with_capacity(buf.len());
    let mut last = 0;
    for (off, text) in ch {
        if off < last || off + 2 > buf.len() {
            bail!("position VMAD invalide ({off})");
        }
        let old = u16::from_le_bytes([buf[off], buf[off + 1]]) as usize;
        if off + 2 + old > buf.len() {
            bail!("chaîne VMAD hors limites ({off})");
        }
        let mut end = text.len().min(u16::MAX as usize);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        out.extend_from_slice(&buf[last..off]);
        out.extend_from_slice(&(end as u16).to_le_bytes());
        out.extend_from_slice(&text.as_bytes()[..end]);
        last = off + 2 + old;
    }
    out.extend_from_slice(&buf[last..]);
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn s(out: &mut Vec<u8>, t: &str) {
        out.extend((t.len() as u16).to_le_bytes());
        out.extend(t.as_bytes());
    }

    /// VMAD Skyrim de quête : un script (String, Int, tableau de String) + un alias scripté.
    pub fn sample() -> Vec<u8> {
        let mut b = vec![5, 0, 2, 0, 1, 0];
        s(&mut b, "MyQuestScript");
        b.push(0);
        b.extend(3u16.to_le_bytes());
        s(&mut b, "Greeting");
        b.extend([2, 1]);
        s(&mut b, "Hello there");
        s(&mut b, "Count");
        b.extend([3, 1, 7, 0, 0, 0]);
        s(&mut b, "Lines");
        b.extend([12, 1]);
        b.extend(2u32.to_le_bytes());
        s(&mut b, "One");
        s(&mut b, "");
        // fragments de quête : 1 fragment, puis 1 alias avec 1 script
        b.push(2);
        b.extend(1u16.to_le_bytes());
        s(&mut b, "QF_File");
        b.extend([0; 9]);
        s(&mut b, "QF_Script");
        s(&mut b, "Fragment_0");
        b.extend(1u16.to_le_bytes());
        b.extend([0; 12]);
        b.extend(1u16.to_le_bytes());
        s(&mut b, "AliasScript");
        b.push(0);
        b.extend(1u16.to_le_bytes());
        s(&mut b, "Msg");
        b.extend([2, 1]);
        s(&mut b, "Bye");
        b
    }

    #[test]
    fn decode_skyrim_quest() {
        let b = sample();
        let v = decode(&b, b"QUST").unwrap();
        let got: Vec<_> = v.iter().map(|x| (x.script.as_str(), x.prop.as_str(), String::from_utf8_lossy(&x.bytes).into_owned())).collect();
        assert_eq!(got, vec![
            ("MyQuestScript", "Greeting", "Hello there".into()),
            ("MyQuestScript", "Lines", "One".into()),
            ("MyQuestScript", "Lines", "".into()),
            ("AliasScript", "Msg", "Bye".into()),
        ]);
        // hors quête, les fragments ne sont pas lus
        assert_eq!(decode(&b, b"WEAP").unwrap().len(), 3);
        // type inconnu -> VMAD ignoré
        let mut bad = b.clone();
        let p = bad.windows(5).position(|w| w == b"Count").unwrap() + 5;
        bad[p] = 99;
        assert!(decode(&bad, b"QUST").is_none());
        assert!(decode(&b[..20], b"QUST").is_none());
    }

    #[test]
    fn rewrite_roundtrip() {
        let b = sample();
        let v = decode(&b, b"QUST").unwrap();
        let same: Vec<(usize, &str)> = v.iter().map(|x| (x.off, std::str::from_utf8(&x.bytes).unwrap())).collect();
        assert_eq!(rewrite(&b, &same).unwrap(), b);
        let nb = rewrite(&b, &[(v[3].off, "Au revoir"), (v[0].off, "Salut, étranger")]).unwrap();
        let w = decode(&nb, b"QUST").unwrap();
        assert_eq!(w[0].bytes, "Salut, étranger".as_bytes());
        assert_eq!(w[1].bytes, b"One");
        assert_eq!(w[3].bytes, b"Au revoir");
    }
}
