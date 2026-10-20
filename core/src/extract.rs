// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Extraction des chaînes traduisibles d'un plugin et réinjection des traductions.
//! Reprend `islstringRecord`, `Compute_FieldIndex` et le hachage EDID de xTranslator.

use crate::esp::{Field, Plugin};
use crate::game::{Proc, RecordDef};
use crate::strings::StringsSet;
use crate::text::{ansi, string_hash, Codepage};
use crate::vmad;
use crate::{sig_str, Sig};
use anyhow::{bail, Result};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
pub struct EspString {
    pub id: usize,
    pub rec_idx: usize,
    pub field_idx: usize,
    pub form_id: u32,
    pub rec: String,
    pub field: String,
    pub edid: String,
    pub rhash: u32,
    pub index: u16,
    pub index_max: u16,
    pub list: u8,
    pub str_id: u32,
    pub not_null: bool,
    pub text: String,
    /// Chaîne d'une propriété de script (champ `VMAD`) : verrouillée par défaut dans xTranslator.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vmad: Option<VmadRef>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VmadRef {
    pub off: usize,
    pub script: String,
    pub prop: String,
}

/// `sanitizeFormID` : neutralise l'index de chargement (y compris ESL/ESH de Starfield).
pub fn sanitize_form_id(id: u32) -> u32 {
    let hi = (id >> 24) as u8;
    match hi {
        0 => id,
        0xFE => if (id >> 12) as u8 == 0 { id } else { (id & !(0xFFF << 12)) | (1 << 12) },
        0xFD => if (id >> 16) as u8 == 0 { id } else { (id & !(0xFF << 16)) | (1 << 16) },
        _ => (id & 0x00FF_FFFF) | (1 << 24),
    }
}

/// Nom EDID formaté (`[XXXXXXXX]` si absent) et son hachage `rHash`.
pub fn edid_and_hash(fields: &[Field], form_id: u32) -> (String, u32) {
    let edid = fields
        .iter()
        .find(|f| &f.sig == b"EDID" && !f.data.is_empty())
        .map(|f| ansi(&f.data[..f.data.len() - 1]))
        .unwrap_or_default();
    let name = if edid.is_empty() { format!("[{:08X}]", sanitize_form_id(form_id)) } else { edid.clone() };
    (edid, string_hash(&name))
}

fn proc_ok(proc: Proc, fields: &[Field], i: usize) -> bool {
    let after = |val: u8, span: usize| {
        fields.iter().enumerate().any(|(z, f)| &f.sig == b"EPFT" && f.data == [val] && i > z && i <= z + span)
    };
    match proc {
        Proc::All => true,
        Proc::Gmst => fields.iter().find(|f| &f.sig == b"EDID" && !f.data.is_empty()).is_some_and(|f| f.data[0] == b's'),
        Proc::Perk => after(7, 3),
        Proc::Perk2 => after(4, 2),
        Proc::Note => fields.iter().any(|f| &f.sig == b"DATA" && f.data.len() == 1 && f.data[0] != 3),
        Proc::DoorCnam => {
            for j in (i.saturating_sub(3)..=i).rev() {
                match &fields[j].sig {
                    b"BFCB" => return false,
                    b"BFCE" => break,
                    _ => {}
                }
            }
            true
        }
    }
}

/// Définition applicable au champ `i` (première qui correspond, `None` si ignoré).
pub fn match_def<'a>(defs: &'a [RecordDef], rec: &Sig, fields: &[Field], i: usize) -> Option<&'a RecordDef> {
    let f = &fields[i].sig;
    let d = defs.iter().find(|d| &d.field == f && d.record.map_or(true, |r| &r == rec && proc_ok(d.proc, fields, i)))?;
    (!d.ignored).then_some(d)
}

/// Index des champs homonymes (`Compute_FieldIndex`, reproduit tel quel).
fn field_indexes(fields: &[Field], is_str: &[bool]) -> Vec<(u16, u16)> {
    let mut ix = vec![(0u16, 0u16); fields.len()];
    for i in 0..fields.len() {
        if !is_str[i] {
            continue;
        }
        let mut max = 0u16;
        for j in (0..i).rev() {
            if fields[j].sig == fields[i].sig {
                if max == 0 {
                    ix[i].0 = ix[j].0 + 1;
                    max = ix[i].0;
                }
                ix[i].1 = max;
                ix[j].1 = max;
            }
        }
    }
    ix
}

static TES4_DEF: RecordDef = RecordDef { field: *b"CNAM", record: None, list: 0, not_null: false, no_zero: false, ignored: false, proc: Proc::All };

pub struct Context<'a> {
    pub defs: &'a [RecordDef],
    pub cp: Codepage,
    pub strings: Option<&'a StringsSet>,
}

pub fn extract(plugin: &Plugin, ctx: &Context) -> Result<Vec<EspString>> {
    let localized = plugin.is_localized();
    if localized && ctx.strings.is_none() {
        bail!("plugin localisé : fichiers .strings requis");
    }
    let recs = plugin.records();
    let per_rec: Vec<Vec<EspString>> = recs
        .par_iter()
        .enumerate()
        .map(|(ri, r)| -> Result<Vec<EspString>> {
            let fields = r.fields()?;
            // En-tête : auteur (CNAM) et description (SNAM), toujours en clair (`forceTES4`).
            let tes4 = ri == 0;
            let defs: Vec<Option<&RecordDef>> = (0..fields.len())
                .map(|i| if tes4 { matches!(&fields[i].sig, b"CNAM" | b"SNAM").then_some(&TES4_DEF) } else { match_def(ctx.defs, &r.sig, &fields, i) })
                .collect();
            let has_vmad = !tes4 && fields.iter().any(|f| &f.sig == b"VMAD" && !f.data.is_empty());
            if defs.iter().all(Option::is_none) && !has_vmad {
                return Ok(Vec::new());
            }
            let is_str: Vec<bool> = defs.iter().map(Option::is_some).collect();
            let ix = field_indexes(&fields, &is_str);
            let (edid, rhash) = edid_and_hash(&fields, r.form_id);
            let mut out = Vec::new();
            for (fi, d) in defs.iter().enumerate() {
                let Some(d) = d else { continue };
                let data = &fields[fi].data;
                let (str_id, bytes) = if localized && !tes4 {
                    if data.len() != 4 {
                        continue;
                    }
                    let id = u32::from_le_bytes(data[..4].try_into().unwrap());
                    match ctx.strings.and_then(|s| s.get(d.list, id)) {
                        Some(b) if id != 0 => (id, b),
                        _ => continue,
                    }
                } else {
                    (0, data.strip_suffix(&[0]).unwrap_or(data))
                };
                if bytes.is_empty() {
                    continue;
                }
                out.push(EspString {
                    id: 0,
                    rec_idx: ri,
                    field_idx: fi,
                    form_id: r.form_id,
                    rec: sig_str(&r.sig),
                    field: sig_str(&fields[fi].sig),
                    edid: edid.clone(),
                    rhash,
                    index: ix[fi].0,
                    index_max: ix[fi].1,
                    list: d.list,
                    str_id,
                    not_null: d.not_null,
                    text: ctx.cp.decode(bytes),
                    vmad: None,
                });
            }
            if has_vmad {
                out.extend(vmad_strings(r.form_id, &r.sig, ri, &fields, &edid));
            }
            Ok(out)
        })
        .collect::<Result<_>>()?;
    let mut all: Vec<EspString> = per_rec.into_iter().flatten().collect();
    for (i, s) in all.iter_mut().enumerate() {
        s.id = i;
    }
    Ok(all)
}

/// Chaînes des champs VMAD (`GetVMADStrings`) : clé = nom EDID + « _ » + propriété.
fn vmad_strings(form_id: u32, rec: &Sig, ri: usize, fields: &[Field], edid: &str) -> Vec<EspString> {
    let name = if edid.is_empty() { format!("[{:08X}]", sanitize_form_id(form_id)) } else { edid.to_owned() };
    let mut out = Vec::new();
    for (fi, f) in fields.iter().enumerate().filter(|(_, f)| &f.sig == b"VMAD" && !f.data.is_empty()) {
        for v in vmad::decode(&f.data, rec).unwrap_or_default() {
            if v.bytes.is_empty() {
                continue;
            }
            out.push(EspString {
                id: 0,
                rec_idx: ri,
                field_idx: fi,
                form_id,
                rec: sig_str(rec),
                field: "VMAD".into(),
                edid: edid.to_owned(),
                rhash: string_hash(&format!("{name}_{}", v.prop)),
                index: 0,
                index_max: 0,
                list: 0,
                str_id: 0,
                not_null: false,
                text: String::from_utf8_lossy(&v.bytes).into_owned(),
                vmad: Some(VmadRef { off: v.off, script: v.script, prop: v.prop }),
            });
        }
    }
    out
}

/// Réinjecte des traductions. Plugin localisé : modifie les tables `strings` ;
/// sinon réécrit les champs (enregistrements recompressés si besoin).
pub fn apply(plugin: &mut Plugin, strings: Option<&mut StringsSet>, items: &[(&EspString, &str)], cp: &Codepage) -> Result<usize> {
    let encode = |s: &EspString, t: &str| {
        let t = if t.is_empty() && s.not_null { " " } else { t };
        cp.encode(t)
    };
    let localized = plugin.is_localized();
    let (scripts, items): (Vec<_>, Vec<_>) = items.iter().partition(|(s, _)| s.vmad.is_some());
    let (loc, inline): (Vec<_>, Vec<_>) = items.into_iter().partition(|(s, _)| localized && s.rec_idx != 0);
    if !loc.is_empty() {
        let Some(set) = strings else { bail!("plugin localisé : fichiers .strings requis") };
        for (s, t) in &loc {
            set.files[s.list.min(2) as usize].set(s.str_id, encode(s, t));
        }
    }
    let mut by_rec: BTreeMap<usize, (Vec<(usize, Vec<u8>)>, BTreeMap<usize, Vec<(usize, &str)>>)> = BTreeMap::new();
    for (s, t) in &inline {
        let mut b = encode(s, t);
        b.push(0);
        by_rec.entry(s.rec_idx).or_default().0.push((s.field_idx, b));
    }
    for (s, t) in &scripts {
        let off = s.vmad.as_ref().map_or(0, |v| v.off);
        by_rec.entry(s.rec_idx).or_default().1.entry(s.field_idx).or_default().push((off, *t));
    }
    let mut recs = plugin.records_mut();
    for (ri, (changes, vmads)) in by_rec {
        let r = recs.get_mut(ri).ok_or_else(|| anyhow::anyhow!("enregistrement {ri} introuvable"))?;
        let mut fields = r.fields()?;
        for (fi, data) in changes {
            fields.get_mut(fi).ok_or_else(|| anyhow::anyhow!("champ {fi} introuvable"))?.data = data;
        }
        for (fi, ch) in vmads {
            let f = fields.get_mut(fi).ok_or_else(|| anyhow::anyhow!("champ {fi} introuvable"))?;
            f.data = vmad::rewrite(&f.data, &ch)?;
        }
        r.set_fields(fields);
    }
    Ok(inline.len() + loc.len() + scripts.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::esp::tests::{field, sample};
    use crate::game::Game;
    use crate::strings::Kind;

    #[test]
    fn sanitize() {
        assert_eq!(sanitize_form_id(0x0001_2345), 0x0001_2345);
        assert_eq!(sanitize_form_id(0x0312_3456), 0x0112_3456);
        assert_eq!(sanitize_form_id(0xFE00_0801), 0xFE00_0801);
        assert_eq!(sanitize_form_id(0xFE12_3801), 0xFE00_1801);
    }

    #[test]
    fn extract_and_apply_inline() {
        let defs = Game::SkyrimSE.record_defs();
        let ctx = Context { defs: &defs, cp: Game::SkyrimSE.codepage("french"), strings: None };
        let mut p = sample(false);
        let s = extract(&p, &ctx).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].field.as_str(), s[0].text.as_str()), ("FULL", "Lame"));
        assert_eq!(s[1].list, 1); // DESC -> dlstrings
        assert_eq!(s[0].rhash, string_hash("MyBlade"));
        let tr = [(&s[0], "Épée"), (&s[1], "")];
        apply(&mut p, None, &tr, &ctx.cp).unwrap();
        let q = Plugin::parse(&p.to_bytes()).unwrap();
        let s2 = extract(&q, &ctx).unwrap();
        assert_eq!(s2[0].text, "Épée");
        assert_eq!(s2.len(), 1); // DESC vide n'est plus listé
    }

    #[test]
    fn extract_and_apply_localized() {
        let defs = Game::SkyrimSE.record_defs();
        let mut set = StringsSet::default();
        set.files[Kind::Strings as usize].set(1, b"Blade".to_vec());
        set.files[Kind::DlStrings as usize].set(2, b"A blade.".to_vec());
        let p = sample(true);
        let s = extract(&p, &Context { defs: &defs, cp: Codepage::default(), strings: Some(&set) }).unwrap();
        assert_eq!(s.iter().map(|x| (x.str_id, x.text.as_str())).collect::<Vec<_>>(), vec![(1, "Blade"), (2, "A blade.")]);
        let mut p2 = p.clone();
        let mut set2 = set.clone();
        apply(&mut p2, Some(&mut set2), &[(&s[1], "Une lame.")], &Codepage::default()).unwrap();
        assert_eq!(set2.get(1, 2).unwrap(), b"Une lame.");
        assert_eq!(p2.to_bytes(), p.to_bytes()); // plugin inchangé
    }

    #[test]
    fn tes4_header_inline_even_localized() {
        let defs = Game::SkyrimSE.record_defs();
        let mut p = sample(true);
        if let crate::esp::Node::Record(r) = &mut p.nodes[0] {
            let mut f = r.fields().unwrap();
            f.push(field("CNAM", b"Auteur\0"));
            r.set_fields(f);
        }
        let mut set = StringsSet::default();
        set.files[0].set(1, b"Blade".to_vec());
        let orig = set.clone();
        let ctx = Context { defs: &defs, cp: Codepage::default(), strings: Some(&orig) };
        let s = extract(&p, &ctx).unwrap();
        assert_eq!((s[0].rec.as_str(), s[0].text.as_str(), s[0].str_id), ("TES4", "Auteur", 0));
        apply(&mut p, Some(&mut set), &[(&s[0], "Moi"), (&s[1], "Lame")], &ctx.cp).unwrap();
        let s2 = extract(&Plugin::parse(&p.to_bytes()).unwrap(), &Context { strings: Some(&set), ..ctx }).unwrap();
        assert_eq!((s2[0].text.as_str(), s2[1].text.as_str()), ("Moi", "Lame"));
    }

    #[test]
    fn vmad_extract_and_apply() {
        let defs = Game::SkyrimSE.record_defs();
        let ctx = Context { defs: &defs, cp: Codepage::default(), strings: None };
        let mut p = sample(false);
        if let crate::esp::Node::Group(g) = &mut p.nodes[1] {
            if let crate::esp::Node::Record(r) = &mut g.children[0] {
                let mut f = r.fields().unwrap();
                f.push(field("VMAD", &crate::vmad::tests::sample()));
                r.set_fields(f);
            }
        }
        let s = extract(&p, &ctx).unwrap();
        let v: Vec<_> = s.iter().filter(|x| x.vmad.is_some()).collect();
        assert_eq!(v.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(), vec!["Hello there", "One"]); // WEAP : pas de fragments
        assert_eq!(v[0].rhash, string_hash("MyBlade_Greeting"));
        assert_eq!(v[0].field, "VMAD");
        apply(&mut p, None, &[(v[0], "Bonjour"), (&s[0], "Épée")], &ctx.cp).unwrap();
        let s2 = extract(&Plugin::parse(&p.to_bytes()).unwrap(), &ctx).unwrap();
        let t: Vec<_> = s2.iter().map(|x| x.text.as_str()).collect();
        assert_eq!(t, vec!["Épée", "Une lame.", "Bonjour", "One"]);
    }

    #[test]
    fn procs_and_indexes() {
        let defs = Game::SkyrimSE.record_defs();
        let gm = |edid: &[u8]| vec![field("EDID", edid), field("DATA", b"x\0")];
        assert!(match_def(&defs, b"GMST", &gm(b"sName\0"), 1).is_some());
        assert!(match_def(&defs, b"GMST", &gm(b"iCount\0"), 1).is_none());
        let perk = vec![field("EPFT", &[7]), field("EPF2", b"a\0"), field("EPFD", b"b\0")];
        assert!(match_def(&defs, b"PERK", &perk, 2).is_some());
        let perk_bad = vec![field("EPFT", &[1]), field("EPFD", b"b\0")];
        assert!(match_def(&defs, b"PERK", &perk_bad, 1).is_none());
        let f = vec![field("FULL", b"a\0"), field("DATA", &[0]), field("FULL", b"b\0"), field("FULL", b"c\0")];
        assert_eq!(field_indexes(&f, &[true, false, true, true]), vec![(0, 2), (0, 0), (1, 2), (2, 2)]);
    }
}
