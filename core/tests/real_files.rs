//! Tests sur les vrais fichiers du disque SKYRIM (ignorés si absents).
//! Lancer : `XT_REAL=1 cargo test --release --test real_files -- --nocapture`

use rayon::prelude::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use xtcore::esp::Plugin;
use xtcore::extract::{self, Context};
use xtcore::game::Game;
use xtcore::sst::Sst;
use xtcore::text::string_hash;

const DICT: &str = "/Volumes/SKYRIM/TOOLS/WINDOWS/_xTranslator/UserDictionaries/SkyrimSE";
const MODS: &str = "/Volumes/SKYRIM/MODS COLLECTION";

fn enabled() -> bool {
    std::env::var("XT_REAL").is_ok() && Path::new(DICT).is_dir()
}

fn files(dir: &Path, exts: &[&str], out: &mut Vec<PathBuf>, limit: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if out.len() >= limit {
            return;
        }
        let p = e.path();
        if p.is_dir() {
            files(&p, exts, out, limit);
        } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| exts.iter().any(|e| x.eq_ignore_ascii_case(e))) {
            out.push(p);
        }
    }
}

#[test]
fn sst_roundtrip_all() {
    if !enabled() {
        return;
    }
    let mut v = Vec::new();
    files(Path::new(DICT), &["sst"], &mut v, usize::MAX);
    let bad: Vec<String> = v
        .par_iter()
        .filter_map(|p| {
            let b = std::fs::read(p).ok()?;
            match Sst::parse(&b) {
                Ok(s) if s.version == 8 && s.to_bytes() != b => Some(format!("diff {}", p.display())),
                Ok(_) => None,
                Err(e) => Some(format!("{}: {e}", p.display())),
            }
        })
        .collect();
    println!("SST : {} fichiers, {} problèmes", v.len(), bad.len());
    bad.iter().take(10).for_each(|b| println!("  {b}"));
    assert!(bad.is_empty());
}

#[test]
fn esp_roundtrip_sample() {
    if !enabled() {
        return;
    }
    let mut v = Vec::new();
    files(Path::new(MODS), &["esp", "esm", "esl"], &mut v, 1500);
    let bad: Vec<String> = v
        .par_iter()
        .filter_map(|p| {
            let b = std::fs::read(p).ok()?;
            if b.get(..4) != Some(b"TES4") {
                return None;
            }
            match Plugin::parse(&b) {
                Ok(pl) if pl.to_bytes() != b => Some(format!("diff {}", p.display())),
                Ok(pl) => {
                    let g = Game::SkyrimSE;
                    let defs = g.record_defs();
                    if !pl.is_localized() {
                        if let Err(e) = extract::extract(&pl, &Context { defs: &defs, cp: g.codepage("french"), strings: None }) {
                            return Some(format!("extract {}: {e:#}", p.display()));
                        }
                    }
                    None
                }
                Err(e) => Some(format!("{}: {e:#}", p.display())),
            }
        })
        .collect();
    println!("ESP : {} fichiers, {} problèmes", v.len(), bad.len());
    bad.iter().take(10).for_each(|b| println!("  {b}"));
    assert!(bad.is_empty());
}

/// Compare l'extraction aux SST produits par xTranslator pour les mêmes plugins :
/// FormID, champ, index et hachage EDID doivent correspondre.
#[test]
fn extraction_matches_xtranslator() {
    if !enabled() {
        return;
    }
    let mut ssts = Vec::new();
    files(Path::new(DICT), &["sst"], &mut ssts, usize::MAX);
    let by_name: HashMap<String, PathBuf> = ssts
        .into_iter()
        .filter_map(|p| {
            let n = p.file_name()?.to_str()?.to_lowercase();
            Some((n.strip_suffix("_english_french.sst")?.to_string(), p))
        })
        .collect();
    let mut esps = Vec::new();
    files(Path::new(MODS), &["esp", "esm", "esl"], &mut esps, usize::MAX);
    let g = Game::SkyrimSE;
    let defs = g.record_defs();
    let mut tested = 0;
    let (mut total, mut found_key, mut found_src) = (0usize, 0usize, 0usize);
    let mut worst: Vec<(f64, String)> = Vec::new();
    for p in esps {
        let stem = p.file_stem().unwrap().to_string_lossy().to_lowercase();
        let Some(sp) = by_name.get(&stem) else { continue };
        let Ok(pl) = Plugin::load(&p) else { continue };
        if pl.is_localized() {
            continue;
        }
        let Ok(sst) = Sst::load(sp) else { continue };
        let Ok(items) = extract::extract(&pl, &Context { defs: &defs, cp: g.codepage("french"), strings: None }) else { continue };
        let keys: std::collections::HashSet<_> = items.iter().map(|s| (extract::sanitize_form_id(s.form_id), s.field.clone(), s.index, s.rhash)).collect();
        let srcs: std::collections::HashSet<_> = items.iter().map(|s| (s.field.clone(), string_hash(&s.text))).collect();
        let es: Vec<_> = sst.entries.iter().filter(|e| &e.field != b"VMAD" && e.params & xtcore::sst::params::OLD_DATA == 0).collect();
        if es.is_empty() {
            continue;
        }
        let fk = es.iter().filter(|e| keys.contains(&(extract::sanitize_form_id(e.form_id), xtcore::sig_str(&e.field), e.index, e.rhash))).count();
        let fs = es.iter().filter(|e| srcs.contains(&(xtcore::sig_str(&e.field), string_hash(&e.source)))).count();
        total += es.len();
        found_key += fk;
        found_src += fs;
        tested += 1;
        worst.push((fk as f64 / es.len() as f64, format!("{} ({}/{})", p.display(), fk, es.len())));
        if tested >= 150 {
            break;
        }
    }
    worst.sort_by(|a, b| a.0.total_cmp(&b.0));
    println!("Comparaison xTranslator : {tested} plugins, {total} entrées SST, clé exacte {found_key}, texte source {found_src}");
    worst.iter().take(8).for_each(|w| println!("  {:.2} {}", w.0, w.1));
    if total > 0 {
        assert!(found_key as f64 / total as f64 > 0.95, "taux de correspondance trop faible");
    }
}

/// Banc « leave-one-out » : les sources d'un gros SST sont traduites avec le reste du dictionnaire.
#[test]
fn heuristic_benchmark() {
    if !enabled() {
        return;
    }
    use xtcore::dict::Dictionary;
    use xtcore::heuristic::Item;
    let mut ssts = Vec::new();
    files(Path::new(DICT), &["sst"], &mut ssts, usize::MAX);
    ssts.sort_by_key(|p| std::cmp::Reverse(std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)));
    let target = ssts.iter().find(|p| p.to_string_lossy().contains("english_french")).unwrap().clone();
    let tmp = std::env::temp_dir().join(format!("xt_bench_{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    for p in ssts.iter().filter(|p| **p != target) {
        let _ = std::os::unix::fs::symlink(p, tmp.join(p.file_name().unwrap()));
    }
    let t = std::time::Instant::now();
    let (d, st) = Dictionary::load_dir(&tmp, Some("english_french")).unwrap();
    let load = t.elapsed();
    let sst = Sst::load(&target).unwrap();
    let qs: Vec<(Item, String)> = sst
        .entries
        .iter()
        .filter(|e| !e.source.is_empty() && !e.dest.is_empty())
        .map(|e| (Item::new(&e.source, "", e.rec, e.field), e.dest.clone()))
        .collect();
    let queries: Vec<Item> = qs.iter().map(|q| q.0.clone()).collect();
    let t = std::time::Instant::now();
    let exact: Vec<_> = queries.iter().map(|q| d.exact(q).map(|c| c.dest.clone())).collect();
    let best = d.index.best_batch(&queries, false);
    let search = t.elapsed();
    let ex_ok = exact.iter().zip(&qs).filter(|(e, q)| e.as_deref() == Some(q.1.as_str())).count();
    let n_ex = exact.iter().flatten().count();
    let mut n_h = 0;
    let mut h_ok = 0;
    for ((b, e), q) in best.iter().zip(&exact).zip(&qs) {
        if e.is_none() {
            if let Some(h) = b.as_ref().filter(|h| h.ld <= 1.0) {
                n_h += 1;
                h_ok += usize::from(d.index.items[h.idx].dest == q.1);
            }
        }
    }
    println!(
        "Banc : dico {} entrées ({} fichiers) chargé en {:?} ; {} requêtes ({}) en {:?}\n  exactes {} (dont {} identiques à la vraie traduction), heuristiques LD<=1 {} (dont {} identiques)",
        st.entries, st.files, load, qs.len(), target.file_name().unwrap().to_string_lossy(), search, n_ex, ex_ok, n_h, h_ok
    );
    if std::env::var("XT_BRUTE").is_ok() {
        let diffs: Vec<usize> = (0..queries.len())
            .into_par_iter()
            .filter(|&i| {
                let a = best[i].as_ref().map(|h| (h.idx, h.ld.to_bits()));
                let b = d.index.best_brute(&queries[i]).map(|h| (h.idx, h.ld.to_bits()));
                a != b
            })
            .collect();
        println!("  écarts filtre/exhaustif : {}", diffs.len());
        for &i in diffs.iter().take(5) {
            let b = d.index.best_brute(&queries[i]).unwrap();
            let c = &d.index.items[b.idx];
            println!("  Q {:?} ({} mots) -> {:?} ({} mots, ld {}) ; filtre : {:?}", queries[i].source, queries[i].words.len(), c.source, c.words.len(), b.ld, best[i].as_ref().map(|h| (&d.index.items[h.idx].source, h.ld)));
        }
    }
    std::fs::remove_dir_all(tmp).ok();
}

#[test]
fn archives_and_pex_sample() {
    if !enabled() {
        return;
    }
    use xtcore::archive::Archive;
    use xtcore::pex::{no_trans_list, Pex};
    let mut bsas = Vec::new();
    files(Path::new(MODS), &["bsa", "ba2"], &mut bsas, 60);
    let mut n_files = 0;
    let mut n_pex_in_bsa = 0;
    let mut errs = Vec::new();
    for p in &bsas {
        match Archive::open(p) {
            Ok(a) => {
                for e in a.entries.iter().take(400) {
                    match a.read(e) {
                        Ok(d) if d.len() as u64 == e.size => {
                            n_files += 1;
                            n_pex_in_bsa += usize::from(e.path.to_lowercase().ends_with(".pex"));
                        }
                        Ok(d) => errs.push(format!("{} {}: taille {} != {}", p.display(), e.path, d.len(), e.size)),
                        Err(x) => errs.push(format!("{} {}: {x:#}", p.display(), e.path)),
                    }
                }
            }
            Err(x) => errs.push(format!("{}: {x:#}", p.display())),
        }
    }
    println!("Archives : {} ouvertes, {} fichiers lus ({} .pex), {} erreurs", bsas.len(), n_files, n_pex_in_bsa, errs.len());
    errs.iter().take(5).for_each(|e| println!("  {e}"));
    assert!(errs.is_empty());

    let nt = no_trans_list(include_str!("../data/pexNoTrans/SkyrimSE.txt"));
    let cp = Game::SkyrimSE.codepage("french");
    let mut pexs = Vec::new();
    files(Path::new(MODS), &["pex"], &mut pexs, 3000);
    let res: Vec<Result<(usize, usize), String>> = pexs
        .par_iter()
        .map(|p| {
            let b = std::fs::read(p).map_err(|e| e.to_string())?;
            let x = Pex::parse(&b, &cp, &nt).map_err(|e| format!("{}: {e:#}", p.display()))?;
            if x.to_bytes() != b {
                return Err(format!("diff {}", p.display()));
            }
            Ok((x.strings.len(), x.strings.iter().filter(|s| s.translatable).count()))
        })
        .collect();
    let bad: Vec<_> = res.iter().filter_map(|r| r.as_ref().err()).collect();
    let (tot, tr) = res.iter().flatten().fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
    println!("PEX : {} scripts, {} chaînes dont {} traduisibles, {} erreurs", pexs.len(), tot, tr, bad.len());
    bad.iter().take(5).for_each(|e| println!("  {e}"));
    assert!(bad.is_empty());
}
