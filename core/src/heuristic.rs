// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! Recherche heuristique (« LD ») : distance de Levenshtein sur des mots hachés,
//! reprise de `getWordsMatchHash` / `doFindHeuristicFocus`, parallélisée avec rayon.
//! Plus le score est bas, meilleure est la correspondance.

use crate::text::string_hash;
use crate::Sig;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

const WORD_THRESHOLD: usize = 1000;
const LD_WORD_SEARCH_MAX: usize = 10;
const LD_MAX_BREAK: usize = 25;
const PROXY_RATIO: f32 = 0.05;

/// Chaîne préparée pour la recherche.
#[derive(Clone, Debug)]
pub struct Item {
    pub source: String,
    pub dest: String,
    pub rec: Sig,
    pub field: Sig,
    pub hash: u32,
    pub words: Vec<u32>,
    pub min_word: usize,
    pub proxy: f32,
    lower: Vec<u16>,
    len: usize,
}

impl Item {
    pub fn new(source: &str, dest: &str, rec: Sig, field: Sig) -> Self {
        let source = source.trim_end_matches('\0');
        let words = words(source);
        let lower: Vec<u16> = source.to_lowercase().encode_utf16().collect();
        Self {
            hash: string_hash(source),
            min_word: words.len().saturating_sub(threshold(words.len()) + 1).max(1),
            proxy: proxy(source, dest) as f32,
            len: source.encode_utf16().count(),
            words,
            lower,
            source: source.to_owned(),
            dest: dest.to_owned(),
            rec,
            field,
        }
    }
}

fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || c.is_numeric() || c == '_' || c == '-'
}

/// Mots de 3 caractères ou plus (`[\p{L}\p{N}_\-]{3,}`), hachés en minuscules.
pub fn words(s: &str) -> Vec<u32> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut n = 0;
    for c in s.chars().chain(std::iter::once(' ')) {
        if is_word_char(c) {
            cur.push(c);
            n += 1;
        } else {
            if n >= 3 && out.len() <= WORD_THRESHOLD {
                out.push(string_hash(&cur.to_lowercase()));
            }
            cur.clear();
            n = 0;
        }
    }
    out
}

/// `defineHeuristicThreshold`.
pub fn threshold(n: usize) -> usize {
    match n {
        0 => 0,
        1 => 1,
        _ => (n.div_ceil(3) + 1).min(LD_MAX_BREAK),
    }
}

/// `adjustHeuristicResult`.
fn adjust(n: usize, ld: f32) -> f32 {
    if ld == 0.0 {
        return 0.0;
    }
    if ld <= (n / 15) as f32 { 0.55 + ld / 10.0 } else { ld }
}

fn is_punct(c: u16) -> bool {
    matches!(c, 0..=31 | 33..=47 | 58..=64 | 91..=96 | 123..=127)
}

/// `GetStringProxy` : 0 (formes identiques) à 3 (casse, chiffres et ponctuation différents).
pub fn proxy(gs: &str, gtrans: &str) -> i32 {
    let mut r = 3;
    if (gtrans.to_uppercase() == gtrans) == (gs.to_uppercase() == gs) {
        r -= 1;
    }
    let scan = |s: &str| {
        let (mut num, mut punc) = (false, false);
        for c in s.encode_utf16() {
            num |= (b'0' as u16..=b'9' as u16).contains(&c);
            punc |= is_punct(c);
            if num && punc {
                break;
            }
        }
        (num, punc)
    };
    let (n1, p1) = scan(gs);
    let (n2, p2) = scan(gtrans);
    if n1 == n2 {
        r -= 1;
    }
    if p1 == p2 {
        r -= 1;
    }
    r
}

fn levenshtein<T: PartialEq>(a: &[T], b: &[T]) -> usize {
    if a.is_empty() {
        return b.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, x) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + usize::from(x != y));
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

fn common_prefix(a: &[u16], b: &[u16]) -> usize {
    a.iter().zip(b).take_while(|(x, y)| x == y).count()
}

fn longest_common_substring(a: &[u16], b: &[u16]) -> usize {
    let mut best = 0;
    let mut prev = vec![0usize; b.len() + 1];
    let mut cur = vec![0usize; b.len() + 1];
    for x in a {
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = if x == y { prev[j] + 1 } else { 0 };
            best = best.max(cur[j + 1]);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    best
}

fn sub_threshold_inc(l: usize) -> usize {
    match l { 0..=3 => 0, 4..=5 => 1, 6..=8 => 2, 9..=12 => 3, _ => 4 }
}

fn sub_threshold_dec(l: usize) -> usize {
    match l { 0..=4 => 0, 5..=6 => 1, 7..=8 => 2, _ => 3 }
}

/// `getSubStringMatch` (chaînes d'un seul mot).
fn substring_match(q: &Item, c: &Item) -> Option<f32> {
    let l = if q.len < 8 { common_prefix(&q.lower, &c.lower) } else { longest_common_substring(&q.lower, &c.lower) };
    if q.len.saturating_sub(l) <= sub_threshold_dec(q.len) && c.len.abs_diff(q.len) <= sub_threshold_inc(q.len) {
        let s = q.len.max(c.len) - l;
        Some(s as f32 * 0.1 + if s == 0 { 0.1 } else { 0.55 } + proxy(&q.source, &c.dest) as f32 * PROXY_RATIO)
    } else {
        None
    }
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Match(f32),
    NoMatch,
    /// Le candidat a trop de mots : tous les suivants (triés) aussi.
    Break,
}

/// `getWordsMatchHash`.
pub fn score(q: &Item, c: &Item) -> Outcome {
    use Outcome::*;
    // xTranslator ne compare que le hachage 32 bits : on vérifie le texte pour écarter les collisions.
    if c.hash == q.hash && c.source == q.source {
        return Match(0.01 + c.proxy * 0.05);
    }
    if q.len == c.len && q.lower == c.lower {
        return Match(0.3 + proxy(&q.source, &c.dest) as f32 * PROXY_RATIO);
    }
    let (n1, n2) = (q.words.len(), c.words.len());
    if n1 == 1 && n2 == 1 {
        return substring_match(q, c).map_or(NoMatch, Match);
    }
    let thr = threshold(n1);
    if n2.saturating_sub(n1) > thr {
        return Break;
    }
    let mut misses = 0;
    for (i, w) in q.words.iter().enumerate() {
        let lo = i.saturating_sub(thr + 1);
        let hi = (i + thr + 1).min(n2.saturating_sub(1));
        if !(lo <= hi && n2 > 0 && c.words[lo..=hi].contains(w)) {
            misses += 1;
        }
        if misses >= thr {
            return NoMatch;
        }
    }
    let mut ld = 99.9f32;
    if misses < LD_WORD_SEARCH_MAX.min(thr + 1) {
        ld = levenshtein(&q.words, &c.words) as f32;
    }
    if ld > thr as f32 {
        return NoMatch;
    }
    ld = adjust(n1, ld);
    if ld == 0.0 {
        ld = 0.5;
    }
    if ld < (thr + 1) as f32 {
        ld += proxy(&q.source, &c.dest) as f32 * PROXY_RATIO;
    }
    if ld <= thr as f32 { Match(ld) } else { NoMatch }
}

#[derive(Clone, Debug, Serialize)]
pub struct Hit {
    pub idx: usize,
    pub ld: f32,
}

/// Dictionnaire indexé : tri par nombre de mots + index inversé des mots.
///
/// Filtre sans perte : un candidat ne peut correspondre que s'il contient au moins un des
/// `threshold(n)` mots les plus rares de la requête (sinon il manque trop de mots), ou,
/// pour une requête d'un seul mot, s'il fait lui-même un seul mot de longueur voisine.
pub struct Index {
    pub items: Vec<Item>,
    postings: HashMap<u32, Vec<u32>>,
    one_word_by_len: BTreeMap<usize, Vec<u32>>,
}

impl Index {
    pub fn new(mut items: Vec<Item>) -> Self {
        items.retain(|i| !i.words.is_empty());
        items.sort_by_key(|i| (i.words.len(), i.words[0]));
        let mut postings: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut one_word_by_len: BTreeMap<usize, Vec<u32>> = BTreeMap::new();
        for (k, it) in items.iter().enumerate() {
            let mut w = it.words.clone();
            w.sort_unstable();
            w.dedup();
            for h in w {
                postings.entry(h).or_default().push(k as u32);
            }
            if it.words.len() == 1 {
                one_word_by_len.entry(it.len).or_default().push(k as u32);
            }
        }
        Self { items, postings, one_word_by_len }
    }

    /// Candidats possibles, triés par index croissant.
    fn candidates(&self, q: &Item) -> Vec<u32> {
        let n = q.words.len();
        let thr = threshold(n);
        let (lo, hi) = (q.min_word, n + thr);
        let mut distinct = q.words.clone();
        distinct.sort_unstable();
        distinct.dedup();
        let mut lists: Vec<&Vec<u32>> = distinct.iter().filter_map(|w| self.postings.get(w)).collect();
        lists.sort_by_key(|l| l.len());
        let mut out: Vec<u32> = Vec::new();
        for l in lists.into_iter().take(thr.max(1)) {
            out.extend(l.iter().copied().filter(|&k| (lo..=hi).contains(&self.items[k as usize].words.len())));
        }
        if n == 1 {
            let inc = sub_threshold_inc(q.len);
            for v in self.one_word_by_len.range(q.len.saturating_sub(inc)..=q.len + inc).map(|(_, v)| v) {
                out.extend_from_slice(v);
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// Tous les candidats retenus pour `q`, du meilleur au moins bon.
    /// `same_ref` : limiter aux chaînes du même couple enregistrement/champ.
    pub fn search(&self, q: &Item, same_ref: bool) -> Vec<Hit> {
        if q.words.is_empty() {
            return Vec::new();
        }
        let mut hits: Vec<Hit> = self
            .candidates(q)
            .par_iter()
            .filter_map(|&k| {
                let c = &self.items[k as usize];
                if same_ref && (c.rec != q.rec || c.field != q.field) {
                    return None;
                }
                match score(q, c) {
                    Outcome::Match(ld) => Some(Hit { idx: k as usize, ld }),
                    _ => None,
                }
            })
            .collect();
        hits.sort_by(|a, b| a.ld.total_cmp(&b.ld).then(a.idx.cmp(&b.idx)));
        hits
    }

    /// Meilleur candidat pour chaque requête (traduction automatique d'un plugin entier).
    pub fn best_batch(&self, queries: &[Item], same_ref: bool) -> Vec<Option<Hit>> {
        queries.par_iter().map(|q| self.best(q, same_ref)).collect()
    }

    pub fn best(&self, q: &Item, same_ref: bool) -> Option<Hit> {
        if q.words.is_empty() {
            return None;
        }
        let mut best: Option<Hit> = None;
        for k in self.candidates(q) {
            let c = &self.items[k as usize];
            if same_ref && (c.rec != q.rec || c.field != q.field) {
                continue;
            }
            if let Outcome::Match(ld) = score(q, c) {
                if best.as_ref().map_or(true, |b| ld < b.ld) {
                    best = Some(Hit { idx: k as usize, ld });
                }
            }
        }
        best
    }

    /// Parcours exhaustif de référence (tests d'équivalence du filtre).
    #[doc(hidden)]
    pub fn best_brute(&self, q: &Item) -> Option<Hit> {
        let mut best: Option<Hit> = None;
        for (k, c) in self.items.iter().enumerate() {
            if let Outcome::Match(ld) = score(q, c) {
                if best.as_ref().map_or(true, |b| ld < b.ld) {
                    best = Some(Hit { idx: k, ld });
                }
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn it(s: &str, d: &str) -> Item {
        Item::new(s, d, *b"WEAP", *b"FULL")
    }

    #[test]
    fn helpers() {
        assert_eq!(words("an Iron sword, of the-north!").len(), 3);
        assert_eq!(words("Iron")[0], words("iron")[0]);
        assert_eq!((threshold(0), threshold(1), threshold(2), threshold(9), threshold(200)), (0, 1, 2, 4, 25));
        assert_eq!(proxy("Hello", "Bonjour"), 0);
        assert_eq!(proxy("HELLO 2!", "bonjour"), 3);
        assert_eq!(levenshtein(b"kitten", b"sitting"), 3);
        assert_eq!(longest_common_substring(&[1, 2, 3, 4], &[9, 2, 3, 4, 8]), 3);
    }

    #[test]
    fn scores() {
        let q = it("Steel Sword of Fire", "");
        assert!(matches!(score(&q, &it("Steel Sword of Fire", "Épée d'acier de feu")), Outcome::Match(x) if x < 0.2));
        assert!(matches!(score(&q, &it("steel sword of fire", "x")), Outcome::Match(x) if (0.3..0.5).contains(&x)));
        assert!(matches!(score(&q, &it("Steel Sword of Frost", "x")), Outcome::Match(x) if x < 3.0));
        assert_eq!(score(&q, &it("Completely different text here", "x")), Outcome::NoMatch);
        let long = it("one two three four five six seven eight nine ten eleven twelve", "x");
        assert_eq!(score(&it("one two", ""), &long), Outcome::Break);
        assert!(matches!(score(&it("Swords", ""), &it("Sword", "Épée")), Outcome::Match(_)));
    }

    #[test]
    fn index_search_and_batch() {
        let idx = Index::new(vec![
            it("Iron Sword", "Épée en fer"),
            it("Steel Sword", "Épée en acier"),
            it("The quick brown fox jumps", "Le renard"),
            it("Iron Dagger", "Dague en fer"),
        ]);
        let q = it("Iron Swords", "");
        let hits = idx.search(&q, true);
        assert!(!hits.is_empty());
        assert_eq!(idx.items[hits[0].idx].dest, "Épée en fer");
        let b = idx.best_batch(&[q, it("Iron Sword", ""), it("zzz yyy xxx www", "")], false);
        assert_eq!(idx.items[b[1].as_ref().unwrap().idx].dest, "Épée en fer");
        assert!(b[1].as_ref().unwrap().ld < 0.2);
        assert!(b[2].is_none());
    }

    #[test]
    fn filter_is_lossless() {
        let base = ["Iron Sword", "Steel Sword", "Swords", "Sword", "Swordz", "Iron", "iron sword", "IRON SWORD!",
            "The quick brown fox jumps over", "The quick brown dog jumps over", "A quick brown fox jumped over the lazy dog",
            "Find the stolen sword", "We need to find the Staff of Magnus.", "Ancient Nord Sword of Frost", "Daedric",
            "Daedra", "Daedric Bow", "Bow of the Hunt", "the the the", "brown fox"];
        let mut items = Vec::new();
        for (i, a) in base.iter().enumerate() {
            for b in base.iter().skip(i % 5).take(4) {
                items.push(it(&format!("{a} {b}"), "x"));
            }
            items.push(it(a, "x"));
        }
        let idx = Index::new(items);
        for q in base.iter().map(|s| it(s, "")).chain(["Ironn Swordd", "quick fox", "Daedrics", "Stolen Swords of Magnus"].iter().map(|s| it(s, ""))) {
            let (a, b) = (idx.best(&q, false), idx.best_brute(&q));
            assert_eq!(a.map(|h| (h.idx, h.ld.to_bits())), b.map(|h| (h.idx, h.ld.to_bits())), "{}", q.source);
        }
    }
}
