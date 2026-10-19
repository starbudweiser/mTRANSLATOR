// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Plugins ESP/ESM/ESL (en-têtes de 24 octets : Skyrim LE/SE, Fallout 4, Starfield).
//!
//! Les enregistrements gardent leurs octets d'origine : un plugin relu puis réécrit
//! sans modification est identique à l'octet près. Seuls les enregistrements modifiés
//! sont reconstruits (et recompressés s'ils l'étaient).

use crate::io::{put_u32, Reader};
use crate::Sig;
use anyhow::{bail, Context, Result};
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use std::io::{Read, Write};

pub const FLAG_MASTER: u32 = 0x1;
pub const FLAG_LOCALIZED: u32 = 0x80;
pub const FLAG_COMPRESSED: u32 = 0x4_0000;
const HEADER: usize = 24;

#[derive(Clone, Debug)]
pub struct Field {
    pub sig: Sig,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct Record {
    pub sig: Sig,
    pub flags: u32,
    pub form_id: u32,
    pub tail: [u8; 8],
    body: Vec<u8>,
    fields: Option<Vec<Field>>,
}

#[derive(Clone, Debug)]
pub struct Group {
    pub header: [u8; HEADER],
    pub children: Vec<Node>,
}

#[derive(Clone, Debug)]
pub enum Node {
    Record(Record),
    Group(Group),
}

#[derive(Clone, Debug)]
pub struct Plugin {
    pub nodes: Vec<Node>,
}

impl Record {
    pub fn new(sig: Sig, flags: u32, form_id: u32, fields: Vec<Field>) -> Self {
        let mut r = Self { sig, flags, form_id, tail: [0; 8], body: Vec::new(), fields: None };
        r.set_fields(fields);
        r
    }

    pub fn is_compressed(&self) -> bool {
        self.flags & FLAG_COMPRESSED != 0
    }

    /// Données décompressées des champs.
    pub fn raw_fields(&self) -> Result<std::borrow::Cow<'_, [u8]>> {
        if !self.is_compressed() {
            return Ok(std::borrow::Cow::Borrowed(&self.body));
        }
        let mut r = Reader::new(&self.body);
        let size = r.u32()? as usize;
        let mut out = Vec::with_capacity(size);
        ZlibDecoder::new(&self.body[4..]).read_to_end(&mut out).with_context(|| format!("décompression {:08X}", self.form_id))?;
        Ok(std::borrow::Cow::Owned(out))
    }

    pub fn fields(&self) -> Result<Vec<Field>> {
        if let Some(f) = &self.fields {
            return Ok(f.clone());
        }
        parse_fields(&self.raw_fields()?)
    }

    /// Remplace les champs ; le corps est reconstruit immédiatement.
    pub fn set_fields(&mut self, fields: Vec<Field>) {
        let raw = write_fields(&fields);
        self.body = if self.is_compressed() {
            let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
            e.write_all(&raw).expect("zlib en mémoire");
            let z = e.finish().expect("zlib en mémoire");
            let mut b = Vec::with_capacity(z.len() + 4);
            put_u32(&mut b, raw.len() as u32);
            b.extend(z);
            b
        } else {
            raw
        };
        self.fields = Some(fields);
    }

    fn write(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.sig);
        put_u32(out, self.body.len() as u32);
        put_u32(out, self.flags);
        put_u32(out, self.form_id);
        out.extend_from_slice(&self.tail);
        out.extend_from_slice(&self.body);
    }
}

fn parse_fields(b: &[u8]) -> Result<Vec<Field>> {
    let mut r = Reader::new(b);
    let mut out = Vec::new();
    let mut next_size = 0usize;
    while r.remaining() >= 6 {
        let sig = r.sig()?;
        let mut size = r.u16()? as usize;
        if next_size != 0 {
            size = next_size;
            next_size = 0;
        }
        let data = r.take(size)?.to_vec();
        if &sig == b"XXXX" && data.len() >= 4 {
            next_size = u32::from_le_bytes(data[..4].try_into().unwrap()) as usize;
            continue;
        }
        out.push(Field { sig, data });
    }
    Ok(out)
}

fn write_fields(fields: &[Field]) -> Vec<u8> {
    let mut out = Vec::new();
    for f in fields {
        if f.data.len() > 0xFFFF {
            out.extend_from_slice(b"XXXX");
            out.extend_from_slice(&4u16.to_le_bytes());
            put_u32(&mut out, f.data.len() as u32);
            out.extend_from_slice(&f.sig);
            out.extend_from_slice(&0u16.to_le_bytes());
        } else {
            out.extend_from_slice(&f.sig);
            out.extend_from_slice(&(f.data.len() as u16).to_le_bytes());
        }
        out.extend_from_slice(&f.data);
    }
    out
}

fn parse_nodes(r: &mut Reader, end: usize, out: &mut Vec<Node>) -> Result<()> {
    while r.pos < end {
        let start = r.pos;
        let sig = r.sig()?;
        let size = r.u32()? as usize;
        if &sig == b"GRUP" {
            let gend = start + size;
            if size < HEADER || gend > end {
                bail!("groupe invalide à {start:#x}");
            }
            let header: [u8; HEADER] = r.buf[start..start + HEADER].try_into().unwrap();
            r.pos = start + HEADER;
            let mut children = Vec::new();
            parse_nodes(r, gend, &mut children)?;
            out.push(Node::Group(Group { header, children }));
        } else {
            let flags = r.u32()?;
            let form_id = r.u32()?;
            let tail: [u8; 8] = r.take(8)?.try_into().unwrap();
            let body = r.take(size).with_context(|| format!("enregistrement {} à {start:#x}", crate::sig_str(&sig)))?.to_vec();
            out.push(Node::Record(Record { sig, flags, form_id, tail, body, fields: None }));
        }
    }
    Ok(())
}

fn write_nodes(nodes: &[Node], out: &mut Vec<u8>) {
    for n in nodes {
        match n {
            Node::Record(r) => r.write(out),
            Node::Group(g) => {
                let start = out.len();
                out.extend_from_slice(&g.header);
                write_nodes(&g.children, out);
                let size = (out.len() - start) as u32;
                out[start + 4..start + 8].copy_from_slice(&size.to_le_bytes());
            }
        }
    }
}

impl Plugin {
    pub fn parse(buf: &[u8]) -> Result<Self> {
        if buf.len() < HEADER || &buf[..4] != b"TES4" {
            bail!("ce n'est pas un plugin TES4 (Skyrim/Fallout 4/Starfield)");
        }
        let mut nodes = Vec::new();
        parse_nodes(&mut Reader::new(buf), buf.len(), &mut nodes)?;
        Ok(Self { nodes })
    }

    pub fn load(path: &std::path::Path) -> Result<Self> {
        Self::parse(&std::fs::read(path).with_context(|| path.display().to_string())?)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        write_nodes(&self.nodes, &mut out);
        out
    }

    pub fn header(&self) -> &Record {
        match &self.nodes[0] {
            Node::Record(r) => r,
            _ => unreachable!("TES4 vérifié au chargement"),
        }
    }

    pub fn is_localized(&self) -> bool {
        self.header().flags & FLAG_LOCALIZED != 0
    }

    pub fn masters(&self) -> Vec<String> {
        self.header()
            .fields()
            .unwrap_or_default()
            .iter()
            .filter(|f| &f.sig == b"MAST")
            .map(|f| crate::text::ansi(f.data.strip_suffix(&[0]).unwrap_or(&f.data)))
            .collect()
    }

    /// Enregistrements en ordre de fichier (parcours en profondeur).
    pub fn records(&self) -> Vec<&Record> {
        fn walk<'a>(n: &'a [Node], out: &mut Vec<&'a Record>) {
            for x in n {
                match x {
                    Node::Record(r) => out.push(r),
                    Node::Group(g) => walk(&g.children, out),
                }
            }
        }
        let mut out = Vec::new();
        walk(&self.nodes, &mut out);
        out
    }

    pub fn records_mut(&mut self) -> Vec<&mut Record> {
        fn walk<'a>(n: &'a mut [Node], out: &mut Vec<&'a mut Record>) {
            for x in n {
                match x {
                    Node::Record(r) => out.push(r),
                    Node::Group(g) => walk(&mut g.children, out),
                }
            }
        }
        let mut out = Vec::new();
        walk(&mut self.nodes, &mut out);
        out
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn field(sig: &str, data: &[u8]) -> Field {
        Field { sig: crate::sig(sig), data: data.to_vec() }
    }

    /// Petit plugin synthétique : TES4 + groupe WEAP (un compressé, un non) + champ XXXX.
    pub fn sample(localized: bool) -> Plugin {
        let mut tes4 = Record::new(*b"TES4", if localized { FLAG_LOCALIZED } else { 0 }, 0, vec![field("HEDR", &[0; 12]), field("MAST", b"Skyrim.esm\0")]);
        tes4.tail = [0, 0, 0, 0, 44, 0, 0, 0];
        let w1 = Record::new(*b"WEAP", 0, 0x0100_0800, vec![field("EDID", b"MyBlade\0"), field("FULL", if localized { &[1, 0, 0, 0] } else { b"Lame\0" }), field("DESC", if localized { &[2, 0, 0, 0] } else { b"Une lame.\0" })]);
        let w2 = Record::new(*b"WEAP", FLAG_COMPRESSED, 0x0100_0801, vec![field("EDID", b"Big\0"), field("DATA", &vec![7u8; 70_000])]);
        let mut gh = [0u8; HEADER];
        gh[..4].copy_from_slice(b"GRUP");
        gh[8..12].copy_from_slice(b"WEAP");
        let g = Group { header: gh, children: vec![Node::Record(w1), Node::Record(w2)] };
        Plugin { nodes: vec![Node::Record(tes4), Node::Group(g)] }
    }

    #[test]
    fn roundtrip_identical() {
        let bytes = sample(false).to_bytes();
        let p = Plugin::parse(&bytes).unwrap();
        assert_eq!(p.to_bytes(), bytes);
        let recs = p.records();
        assert_eq!(recs.len(), 3);
        assert_eq!(p.masters(), vec!["Skyrim.esm"]);
        let big = recs[2].fields().unwrap();
        assert_eq!(big[1].data.len(), 70_000); // XXXX + compression
        assert!(recs[2].is_compressed());
    }

    #[test]
    fn modify_updates_sizes() {
        let mut p = Plugin::parse(&sample(false).to_bytes()).unwrap();
        {
            let mut recs = p.records_mut();
            let mut f = recs[1].fields().unwrap();
            f[1].data = "Une très longue lame\0".as_bytes().to_vec();
            recs[1].set_fields(f);
        }
        let q = Plugin::parse(&p.to_bytes()).unwrap();
        assert_eq!(q.records()[1].fields().unwrap()[1].data, "Une très longue lame\0".as_bytes());
        assert_eq!(q.to_bytes(), p.to_bytes());
    }
}
