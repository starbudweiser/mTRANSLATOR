// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Codepages et hachages compatibles xTranslator.

use encoding_rs::Encoding;

const FNV_OFFSET: u32 = 2_166_136_261;
const FNV_PRIME: u32 = 16_777_619;

/// `StringHash` de xTranslator : FNV-1a sur l'octet faible de chaque unité UTF-16.
pub fn string_hash(s: &str) -> u32 {
    s.encode_utf16()
        .fold(FNV_OFFSET, |h, c| (h ^ (c as u8) as u32).wrapping_mul(FNV_PRIME))
}

/// Codepage d'un plugin : écriture en UTF-8, lecture UTF-8 avec repli sur une page ANSI.
#[derive(Clone, Copy, Debug)]
pub struct Codepage {
    pub utf8: bool,
    pub fallback: &'static Encoding,
}

impl Default for Codepage {
    fn default() -> Self {
        Self { utf8: true, fallback: encoding_rs::WINDOWS_1252 }
    }
}

impl Codepage {
    /// Interprète une valeur de `codepage.txt` (« utf8,1252 », « 1252 », « utf8 »).
    pub fn parse(spec: &str) -> Self {
        let mut parts = spec.split(',').map(|p| p.trim().to_ascii_lowercase());
        let first = parts.next().unwrap_or_default();
        let second = parts.next();
        let utf8 = first == "utf8" || first.is_empty();
        let cp = if utf8 { second } else { Some(first) };
        let fallback = cp.and_then(|c| windows_encoding(&c)).unwrap_or(encoding_rs::WINDOWS_1252);
        Self { utf8, fallback }
    }

    pub fn decode(&self, b: &[u8]) -> String {
        if self.utf8 {
            if let Ok(s) = std::str::from_utf8(b) {
                return s.to_owned();
            }
        }
        self.fallback.decode_without_bom_handling(b).0.into_owned()
    }

    pub fn encode(&self, s: &str) -> Vec<u8> {
        if self.utf8 {
            s.as_bytes().to_vec()
        } else {
            self.fallback.encode(s).0.into_owned()
        }
    }
}

fn windows_encoding(cp: &str) -> Option<&'static Encoding> {
    use encoding_rs::*;
    Some(match cp {
        "1250" => WINDOWS_1250,
        "1251" => WINDOWS_1251,
        "1252" => WINDOWS_1252,
        "1253" => WINDOWS_1253,
        "1254" => WINDOWS_1254,
        "1256" => WINDOWS_1256,
        "1257" => WINDOWS_1257,
        "932" => SHIFT_JIS,
        _ => return None,
    })
}

/// Décodage « ANSI » (EDID, chemins) tel que Delphi le fait sous Windows occidental.
pub fn ansi(b: &[u8]) -> String {
    encoding_rs::WINDOWS_1252.decode_without_bom_handling(b).0.into_owned()
}

/// UTF-16LE (chaînes des SST).
pub fn utf16le(b: &[u8]) -> String {
    let u: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&u)
}

pub fn to_utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(|c| c.to_le_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv_matches_reference() {
        // FNV-1a 32 bits de référence : "" -> offset, "a" -> 0xe40c292c
        assert_eq!(string_hash(""), FNV_OFFSET);
        assert_eq!(string_hash("a"), 0xe40c_292c);
    }

    #[test]
    fn codepage_fallback() {
        let cp = Codepage::parse("utf8,1252");
        assert_eq!(cp.decode("épée".as_bytes()), "épée");
        assert_eq!(cp.decode(&[0xE9, b't', 0xE9]), "été");
        assert_eq!(cp.encode("é"), vec![0xC3, 0xA9]);
        let ansi_cp = Codepage::parse("1252");
        assert_eq!(ansi_cp.encode("é"), vec![0xE9]);
    }

    #[test]
    fn utf16_roundtrip() {
        assert_eq!(utf16le(&to_utf16le("Épée ꙮ")), "Épée ꙮ");
    }
}
