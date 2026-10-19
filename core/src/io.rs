// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Lecteur binaire borné (petit ou gros boutiste).

use anyhow::{bail, Result};

pub struct Reader<'a> {
    pub buf: &'a [u8],
    pub pos: usize,
    pub big_endian: bool,
}

macro_rules! rd {
    ($name:ident, $t:ty, $n:expr) => {
        pub fn $name(&mut self) -> Result<$t> {
            let b: [u8; $n] = self.take($n)?.try_into().unwrap();
            Ok(if self.big_endian { <$t>::from_be_bytes(b) } else { <$t>::from_le_bytes(b) })
        }
    };
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0, big_endian: false }
    }

    pub fn at(buf: &'a [u8], pos: usize) -> Self {
        Self { buf, pos, big_endian: false }
    }

    pub fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }

    pub fn eof(&self) -> bool {
        self.pos >= self.buf.len()
    }

    pub fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.remaining() {
            bail!("lecture hors limites : {} octets demandés à {} (taille {})", n, self.pos, self.buf.len());
        }
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    pub fn sig(&mut self) -> Result<crate::Sig> {
        Ok(self.take(4)?.try_into().unwrap())
    }

    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    rd!(u16, u16, 2);
    rd!(u32, u32, 4);
    rd!(i32, i32, 4);
    rd!(u64, u64, 8);

    /// Chaîne terminée par un octet nul (sans le nul).
    pub fn zstr(&mut self) -> Result<&'a [u8]> {
        let rest = &self.buf[self.pos.min(self.buf.len())..];
        let n = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
        let s = &rest[..n];
        self.pos += (n + 1).min(rest.len());
        Ok(s)
    }
}

pub fn put_u16(out: &mut Vec<u8>, v: u16, be: bool) {
    out.extend_from_slice(&if be { v.to_be_bytes() } else { v.to_le_bytes() });
}

pub fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}
