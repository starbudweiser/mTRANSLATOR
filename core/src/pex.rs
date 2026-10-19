// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Scripts Papyrus compilés (.pex) : Skyrim (gros boutiste), Fallout 4 et Starfield (petit boutiste).
//!
//! Le bytecode est parcouru en entier (comme `stringAuthProc` de xTranslator) pour
//! distinguer les littéraux affichables des identifiants. La réécriture ne touche que
//! la table des chaînes : le reste du fichier est recopié tel quel.

use crate::io::{put_u16, Reader};
use crate::text::Codepage;
use anyhow::{bail, Result};
use serde::Serialize;
use std::collections::HashSet;

/// Nombre d'arguments par opcode (dont le compteur des appels variadiques).
const OP_ARGS: [u8; 0x33] = [
    0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 1, 2, 2, 4, 3, 4, 1, 3, 3, 3, 2, 2, 3, 3, 4, 4, 3, 1, 3, 3, 5, 5, 3, 3, 1, 3, 1, 6, 1, 1, 2,
];
const EXTENDED: [u8; 6] = [0x17, 0x18, 0x19, 0x30, 0x31, 0x32];
const GET_ID: [u8; 9] = [0x0D, 0x17, 0x18, 0x19, 0x24, 0x2F, 0x30, 0x31, 0x32];

#[derive(Clone, Debug, Serialize)]
pub struct PexString {
    pub id: usize,
    pub text: String,
    /// Littéral affichable (traduisible).
    pub translatable: bool,
    /// Utilisé dans une comparaison : à traduire avec prudence.
    pub warn: bool,
}

pub struct Pex {
    pub big_endian: bool,
    pub game_id: u16,
    head: Vec<u8>,
    tail: Vec<u8>,
    raw: Vec<Vec<u8>>,
    pub strings: Vec<PexString>,
}

struct Scan<'a, 'b> {
    r: Reader<'a>,
    fo4: bool,
    starfield: bool,
    auth: Vec<bool>,
    seen: Vec<bool>,
    warn: Vec<bool>,
    lower: &'b [String],
    no_trans: &'b HashSet<String>,
    global_pairs: Vec<(u16, u16)>,
    global_idents: HashSet<u16>,
}

impl Scan<'_, '_> {
    fn id(&mut self) -> Result<u16> {
        let i = self.r.u16()?;
        if i as usize >= self.auth.len() {
            bail!("index de chaîne invalide {i} à {}", self.r.pos);
        }
        self.seen[i as usize] = true;
        Ok(i)
    }

    fn no(&mut self) -> Result<u16> {
        let i = self.id()?;
        self.auth[i as usize] = false;
        Ok(i)
    }

    fn nos(&mut self, n: usize) -> Result<()> {
        (0..n).try_for_each(|_| self.no().map(drop))
    }

    /// `checkVariableData` : renvoie (entier lu, identifiant lu).
    fn var(&mut self, ref_id: Option<u16>, get_ident: bool, cmp: bool, idents: &mut Vec<u16>) -> Result<(i32, Option<u16>)> {
        match self.r.u8()? {
            0 => {}
            1 => {
                let i = self.no()?;
                if get_ident {
                    idents.push(i);
                    return Ok((0, Some(i)));
                }
            }
            2 => {
                let i = self.id()?;
                if let Some(v) = ref_id {
                    self.global_pairs.push((v, i));
                } else if get_ident {
                    self.auth[i as usize] = false;
                }
                if cmp {
                    self.warn[i as usize] = true;
                }
            }
            3 => return Ok((self.r.i32()?, None)),
            4 => {
                self.r.u32()?;
            }
            5 => {
                self.r.u8()?;
            }
            t => bail!("type de valeur inconnu {t} à {}", self.r.pos),
        }
        Ok((0, None))
    }

    fn variable(&mut self, doc: bool) -> Result<()> {
        let name = self.no()?;
        self.no()?;
        self.r.u32()?;
        self.var(Some(name), false, false, &mut Vec::new())?;
        if self.fo4 {
            self.r.u8()?;
            if doc {
                self.no()?;
            }
        }
        Ok(())
    }

    fn instruction(&mut self) -> Result<()> {
        let op = self.r.u8()?;
        let Some(&n) = OP_ARGS.get(op as usize) else { bail!("opcode inconnu {op:#x}") };
        let get_ident = GET_ID.contains(&op);
        let cmp = (0x0F..=0x13).contains(&op);
        let mut idents = Vec::new();
        let mut assign = None;
        let mut extra = 0;
        for _ in 0..n {
            let (v, ident) = self.var(assign, get_ident, cmp, &mut idents)?;
            extra = v;
            if op == 0x0D && ident.is_some() {
                assign = ident;
            }
        }
        if EXTENDED.contains(&op) {
            let nt = idents.iter().any(|&i| self.no_trans.contains(&self.lower[i as usize]));
            for _ in 0..extra.max(0) {
                if let (_, Some(i)) = self.var(None, nt, false, &mut Vec::new())? {
                    self.global_idents.insert(i);
                }
            }
        }
        Ok(())
    }

    fn function(&mut self, named: bool) -> Result<()> {
        self.nos(if named { 3 } else { 2 })?;
        self.r.u32()?;
        self.r.u8()?;
        for _ in 0..2 {
            let n = self.r.u16()? as usize;
            self.nos(n * 2)?;
        }
        for _ in 0..self.r.u16()? {
            self.instruction()?;
        }
        Ok(())
    }

    fn run(&mut self) -> Result<()> {
        if self.r.u8()? != 0 {
            self.r.u64()?;
            for _ in 0..self.r.u16()? {
                self.nos(3)?;
                self.r.u8()?;
                let n = self.r.u16()? as usize;
                self.r.take(n * 2)?;
            }
            if self.fo4 {
                for _ in 0..self.r.u16()? {
                    self.nos(3)?;
                    self.r.u32()?;
                    let n = self.r.u16()? as usize;
                    self.nos(n)?;
                }
                for _ in 0..self.r.u16()? {
                    self.nos(2)?;
                    let n = self.r.u16()? as usize;
                    self.nos(n)?;
                }
            }
        }
        for _ in 0..self.r.u16()? {
            self.no()?;
            self.r.u8()?;
        }
        for _ in 0..self.r.u16()? {
            self.no()?;
            self.r.u32()?; // taille
            self.nos(2)?; // parent, doc
            if self.fo4 {
                self.r.u8()?;
            }
            self.r.u32()?;
            self.no()?; // état automatique
            if self.fo4 {
                for _ in 0..self.r.u16()? {
                    self.no()?;
                    for _ in 0..self.r.u16()? {
                        self.variable(true)?;
                    }
                }
            }
            for _ in 0..self.r.u16()? {
                self.variable(false)?;
            }
            if self.starfield {
                let n = self.r.u16()? as usize;
                self.nos(n)?; // gardes
            }
            for _ in 0..self.r.u16()? {
                self.nos(3)?;
                self.r.u32()?;
                let flags = self.r.u8()?;
                if flags & 4 != 0 {
                    self.no()?;
                }
                if flags & 5 == 1 {
                    self.function(false)?;
                }
                if flags & 6 == 2 {
                    self.function(false)?;
                }
            }
            for _ in 0..self.r.u16()? {
                self.no()?;
                for _ in 0..self.r.u16()? {
                    self.function(true)?;
                }
            }
        }
        // `globalNoTransCheckList` : un littéral affecté à une variable passée à une procédure exclue.
        for &(var, lit) in &self.global_pairs {
            if !self.seen[lit as usize] || self.global_idents.contains(&var) {
                self.auth[lit as usize] = false;
            }
        }
        Ok(())
    }
}

/// Procédures dont les paramètres textes ne se traduisent pas (`pexNoTransProc.txt`).
pub fn no_trans_list(txt: &str) -> HashSet<String> {
    txt.lines().map(|l| l.trim().to_lowercase()).filter(|l| !l.is_empty() && !l.starts_with('#')).collect()
}

fn wstr<'a>(r: &mut Reader<'a>) -> Result<&'a [u8]> {
    let n = r.u16()? as usize;
    r.take(n)
}

impl Pex {
    pub fn parse(buf: &[u8], cp: &Codepage, no_trans: &HashSet<String>) -> Result<Self> {
        let big_endian = match buf.get(..4) {
            Some([0xFA, 0x57, 0xC0, 0xDE]) => true,
            Some([0xDE, 0xC0, 0x57, 0xFA]) => false,
            _ => bail!("ce n'est pas un script .pex"),
        };
        let mut r = Reader::at(buf, 6);
        r.big_endian = big_endian;
        let game_id = r.u16()?;
        r.u64()?;
        for _ in 0..3 {
            wstr(&mut r)?;
        }
        let count = r.u16()? as usize;
        let head = buf[..r.pos].to_vec();
        let raw: Vec<Vec<u8>> = (0..count).map(|_| wstr(&mut r).map(<[u8]>::to_vec)).collect::<Result<_>>()?;
        let tail = buf[r.pos..].to_vec();
        let lower: Vec<String> = raw.iter().map(|s| cp.decode(s).to_lowercase()).collect();
        let mut sc = Scan {
            r: Reader::new(&tail),
            fo4: !big_endian,
            starfield: game_id == 4,
            auth: vec![true; count],
            seen: vec![false; count],
            warn: vec![false; count],
            lower: &lower,
            no_trans,
            global_pairs: Vec::new(),
            global_idents: HashSet::new(),
        };
        sc.r.big_endian = big_endian;
        sc.run()?;
        let strings = raw
            .iter()
            .enumerate()
            .map(|(i, s)| PexString { id: i, text: cp.decode(s), translatable: sc.auth[i] && sc.seen[i] && !s.is_empty(), warn: sc.warn[i] })
            .collect();
        Ok(Self { big_endian, game_id, head, tail, raw, strings })
    }

    /// Remplace des entrées de la table (id, nouveau texte).
    pub fn set(&mut self, id: usize, text: &str, cp: &Codepage) -> Result<()> {
        let b = cp.encode(text);
        if b.len() > u16::MAX as usize {
            bail!("chaîne trop longue pour un .pex");
        }
        *self.raw.get_mut(id).ok_or_else(|| anyhow::anyhow!("chaîne {id} absente"))? = b;
        self.strings[id].text = text.to_owned();
        Ok(())
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = self.head.clone();
        for s in &self.raw {
            put_u16(&mut out, s.len() as u16, self.big_endian);
            out.extend_from_slice(s);
        }
        out.extend_from_slice(&self.tail);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Script Skyrim minimal : un objet, une fonction qui appelle
    /// Debug.Notification("Bonjour") et SendModEvent("ModKey").
    fn sample() -> Vec<u8> {
        let table = ["MyScript", "", "OnInit", "None", "Notification", "Debug", "::temp", "Bonjour", "SendModEvent", "self", "ModKey", "Unused"];
        let be16 = |v: u16| v.to_be_bytes().to_vec();
        let mut o = vec![0xFA, 0x57, 0xC0, 0xDE, 3, 2];
        o.extend(be16(1));
        o.extend([0u8; 8]);
        for s in ["a.psc", "u", "m"] {
            o.extend(be16(s.len() as u16));
            o.extend(s.as_bytes());
        }
        o.extend(be16(table.len() as u16));
        for s in table {
            o.extend(be16(s.len() as u16));
            o.extend(s.as_bytes());
        }
        o.push(0); // pas de débogage
        o.extend(be16(0)); // drapeaux utilisateur
        o.extend(be16(1)); // objets
        o.extend(be16(0)); // nom
        o.extend(0u32.to_be_bytes()); // taille
        o.extend(be16(1)); // parent
        o.extend(be16(1)); // doc
        o.extend(0u32.to_be_bytes());
        o.extend(be16(1)); // état auto
        o.extend(be16(0)); // variables
        o.extend(be16(0)); // propriétés
        o.extend(be16(1)); // états
        o.extend(be16(1)); // nom d'état ""
        o.extend(be16(1)); // fonctions
        o.extend(be16(2)); // OnInit
        o.extend(be16(3)); // None
        o.extend(be16(1)); // doc
        o.extend(0u32.to_be_bytes());
        o.push(0);
        o.extend(be16(0));
        o.extend(be16(0));
        o.extend(be16(2)); // instructions
        // callstatic Debug Notification ::temp 1 "Bonjour"
        o.push(0x19);
        for id in [5u16, 4, 6] {
            o.push(1);
            o.extend(be16(id));
        }
        o.push(3);
        o.extend(1i32.to_be_bytes());
        o.push(2);
        o.extend(be16(7));
        // callmethod SendModEvent self ::temp 1 "ModKey"
        o.push(0x17);
        for id in [8u16, 9, 6] {
            o.push(1);
            o.extend(be16(id));
        }
        o.push(3);
        o.extend(1i32.to_be_bytes());
        o.push(2);
        o.extend(be16(10));
        o
    }

    #[test]
    fn auth_and_rewrite() {
        let nt = no_trans_list("#x\nsendmodevent\n");
        let cp = Codepage::default();
        let buf = sample();
        let mut p = Pex::parse(&buf, &cp, &nt).unwrap();
        assert_eq!(p.to_bytes(), buf);
        let tr: Vec<&str> = p.strings.iter().filter(|s| s.translatable).map(|s| s.text.as_str()).collect();
        assert_eq!(tr, vec!["Bonjour"]);
        p.set(7, "Salut à toi", &cp).unwrap();
        let q = Pex::parse(&p.to_bytes(), &cp, &nt).unwrap();
        assert_eq!(q.strings[7].text, "Salut à toi");
        assert!(q.strings[7].translatable);
    }
}
