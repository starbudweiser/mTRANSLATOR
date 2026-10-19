// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Lecture des archives BSA (v103/104/105) et BA2 générales (Fallout 4, Starfield v1/2/3/7/8).
//! Lecture à la demande : l'archive n'est jamais chargée entièrement en mémoire.

use crate::io::Reader;
use anyhow::{bail, Context, Result};
use flate2::read::ZlibDecoder;
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::os::unix::fs::FileExt;
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Codec {
    None,
    Zlib,
    Lz4Frame,
    Lz4Block,
}

#[derive(Clone, Debug, Serialize)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    #[serde(skip)]
    offset: u64,
    #[serde(skip)]
    stored: u64,
    #[serde(skip)]
    codec: Codec,
    #[serde(skip)]
    name_prefix: bool,
}

pub struct Archive {
    file: File,
    pub kind: String,
    pub entries: Vec<Entry>,
}

fn read_at(f: &File, off: u64, n: usize) -> Result<Vec<u8>> {
    let mut b = vec![0; n];
    f.read_exact_at(&mut b, off)?;
    Ok(b)
}

fn decompress(codec: Codec, src: &[u8], size: usize) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(size);
    match codec {
        Codec::None => return Ok(src.to_vec()),
        Codec::Zlib => {
            ZlibDecoder::new(src).read_to_end(&mut out)?;
        }
        Codec::Lz4Frame => {
            lz4_flex::frame::FrameDecoder::new(src).read_to_end(&mut out)?;
        }
        Codec::Lz4Block => out = lz4_flex::block::decompress(src, size)?,
    }
    Ok(out)
}

impl Archive {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path).with_context(|| path.display().to_string())?;
        let head = read_at(&file, 0, 4)?;
        match &head[..] {
            b"BSA\0" => Self::open_bsa(file),
            b"BTDX" => Self::open_ba2(file),
            _ => bail!("archive inconnue : {}", path.display()),
        }
    }

    fn open_bsa(file: File) -> Result<Self> {
        let h = read_at(&file, 0, 36)?;
        let mut r = Reader::at(&h, 4);
        let version = r.u32()?;
        let _off = r.u32()?;
        let flags = r.u32()?;
        let (folders, files) = (r.u32()? as usize, r.u32()? as usize);
        let (_dir_len, name_len) = (r.u32()? as usize, r.u32()? as usize);
        if !(103..=105).contains(&version) {
            bail!("version BSA non prise en charge : {version}");
        }
        let rec = if version == 105 { 24 } else { 16 };
        let folder_recs = read_at(&file, 36, folders * rec)?;
        let mut fr = Reader::new(&folder_recs);
        let mut counts = Vec::with_capacity(folders);
        for _ in 0..folders {
            fr.u64()?;
            counts.push(fr.u32()? as usize);
            fr.take(rec - 12)?;
        }
        // Blocs dossiers (nom + enregistrements fichiers), puis bloc des noms de fichiers.
        let meta_len: usize = counts.iter().map(|c| 1 + 255 + c * 16).sum::<usize>() + name_len;
        let meta_start = 36 + (folders * rec) as u64;
        let meta = {
            let len = file.metadata()?.len();
            read_at(&file, meta_start, meta_len.min((len - meta_start) as usize))?
        };
        let mut m = Reader::new(&meta);
        let mut pending = Vec::with_capacity(files);
        for &c in &counts {
            let dir = if flags & 1 != 0 {
                let l = m.u8()? as usize;
                crate::text::ansi(m.take(l)?.strip_suffix(&[0]).unwrap_or_default())
            } else {
                String::new()
            };
            for _ in 0..c {
                m.u64()?;
                let size = m.u32()?;
                let off = m.u32()?;
                pending.push((dir.clone(), size, off));
            }
        }
        let default_compressed = flags & 4 != 0;
        let embed = flags & 0x100 != 0 && version >= 104;
        let codec = if version == 105 { Codec::Lz4Frame } else { Codec::Zlib };
        let mut entries = Vec::with_capacity(files);
        for (dir, size, off) in pending {
            let name = if flags & 2 != 0 { crate::text::ansi(m.zstr()?) } else { String::new() };
            let compressed = default_compressed ^ (size & 0x4000_0000 != 0);
            let path = if dir.is_empty() { name } else { format!("{dir}\\{name}") };
            entries.push(Entry {
                path,
                size: 0,
                offset: off as u64,
                stored: (size & 0x3FFF_FFFF) as u64,
                codec: if compressed { codec } else { Codec::None },
                name_prefix: embed,
            });
        }
        let mut a = Self { file, kind: format!("BSA v{version}"), entries };
        for i in 0..a.entries.len() {
            let e = a.entries[i].clone();
            a.entries[i].size = if e.codec == Codec::None {
                e.stored - if e.name_prefix { 1 + read_at(&a.file, e.offset, 1)?[0] as u64 } else { 0 }
            } else {
                let skip = if e.name_prefix { 1 + read_at(&a.file, e.offset, 1)?[0] as u64 } else { 0 };
                u32::from_le_bytes(read_at(&a.file, e.offset + skip, 4)?.try_into().unwrap()) as u64
            };
        }
        Ok(a)
    }

    fn open_ba2(file: File) -> Result<Self> {
        let h = read_at(&file, 0, 36)?;
        let mut r = Reader::at(&h, 4);
        let version = r.u32()?;
        let kind = r.sig()?;
        let count = r.u32()? as usize;
        let names_off = r.u64()?;
        let mut header = 24u64;
        let mut codec = Codec::Zlib;
        if matches!(version, 2 | 3) {
            header += 8;
        }
        if version == 3 {
            if Reader::at(&h, 32).u32()? == 3 {
                codec = Codec::Lz4Block;
            }
            header += 4;
        }
        let mut entries = Vec::with_capacity(count);
        let len = file.metadata()?.len();
        let names = read_at(&file, names_off, (len - names_off) as usize)?;
        let mut nr = Reader::new(&names);
        if &kind == b"GNRL" {
            let recs = read_at(&file, header, count * 36)?;
            let mut rr = Reader::new(&recs);
            for _ in 0..count {
                rr.take(16)?;
                let offset = rr.u64()?;
                let packed = rr.u32()? as u64;
                let unpacked = rr.u32()? as u64;
                rr.u32()?;
                let l = nr.u16()? as usize;
                entries.push(Entry {
                    path: crate::text::ansi(nr.take(l)?),
                    size: unpacked,
                    offset,
                    stored: if packed == 0 { unpacked } else { packed },
                    codec: if packed == 0 { Codec::None } else { codec },
                    name_prefix: false,
                });
            }
        } else {
            // Textures (DX10) : noms seulement, extraction non nécessaire pour la traduction.
            for _ in 0..count {
                let l = nr.u16()? as usize;
                entries.push(Entry { path: crate::text::ansi(nr.take(l)?), size: 0, offset: 0, stored: 0, codec: Codec::None, name_prefix: false });
            }
        }
        Ok(Self { file, kind: format!("BA2 {} v{version}", crate::sig_str(&kind)), entries })
    }

    pub fn find(&self, path: &str) -> Option<&Entry> {
        let p = path.replace('/', "\\");
        self.entries.iter().find(|e| e.path.eq_ignore_ascii_case(&p))
    }

    pub fn read(&self, e: &Entry) -> Result<Vec<u8>> {
        if e.stored == 0 && e.size == 0 {
            return Ok(Vec::new());
        }
        let raw = read_at(&self.file, e.offset, e.stored as usize)?;
        let mut body = &raw[..];
        if e.name_prefix {
            body = &body[1 + body[0] as usize..];
        }
        if e.codec == Codec::None {
            return Ok(body.to_vec());
        }
        if e.codec == Codec::Lz4Frame || e.codec == Codec::Zlib && self.kind.starts_with("BSA") {
            body = &body[4..];
        }
        decompress(e.codec, body, e.size as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::ZlibEncoder, Compression};
    use std::io::Write;

    fn zlib(b: &[u8]) -> Vec<u8> {
        let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
        e.write_all(b).unwrap();
        e.finish().unwrap()
    }

    #[test]
    fn ba2_gnrl_zlib_and_raw() {
        let a = b"strings data".to_vec();
        let b = b"raw".to_vec();
        let za = zlib(&a);
        let mut out = b"BTDX".to_vec();
        out.extend(1u32.to_le_bytes());
        out.extend(b"GNRL");
        out.extend(2u32.to_le_bytes());
        let data_off = 24 + 72;
        let names_off = data_off + za.len() + b.len();
        out.extend((names_off as u64).to_le_bytes());
        for (off, packed, size) in [(data_off, za.len(), a.len()), (data_off + za.len(), 0, b.len())] {
            out.extend([0u8; 16]);
            out.extend((off as u64).to_le_bytes());
            out.extend((packed as u32).to_le_bytes());
            out.extend((size as u32).to_le_bytes());
            out.extend(0xBAAD_F00Du32.to_le_bytes());
        }
        out.extend(&za);
        out.extend(&b);
        for n in ["Strings\\a_fr.strings", "Scripts\\b.pex"] {
            out.extend((n.len() as u16).to_le_bytes());
            out.extend(n.as_bytes());
        }
        let p = std::env::temp_dir().join(format!("xt_test_{}.ba2", std::process::id()));
        std::fs::write(&p, out).unwrap();
        let ar = Archive::open(&p).unwrap();
        assert_eq!(ar.read(ar.find("strings/A_FR.strings").unwrap()).unwrap(), a);
        assert_eq!(ar.read(&ar.entries[1]).unwrap(), b);
        std::fs::remove_file(p).ok();
    }
}
