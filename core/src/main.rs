// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. Portage Rust de xTranslator (McGuffin, MPL-2.0).

//! `xtcore` : interface en ligne de commande, sorties JSON (pour l'interface mTRANSLATOR).

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use xtcore::dict::Dictionary;
use xtcore::esp::Plugin;
use xtcore::extract::{self, sanitize_form_id, EspString};
use xtcore::game::Game;
use xtcore::heuristic::Item;
use xtcore::sst::{params, Entry, Sst};
use xtcore::strings::StringsSet;
use xtcore::text::string_hash;
use xtcore::{archive::Archive, customtxt, pex, sig};

const USAGE: &str = "xtcore <commande> [options]
  extract <plugin>                        chaînes traduisibles
  translate <plugin> --dict <dossier>     traduction auto (exacte + heuristique) -> --sst / --out
  apply <plugin> --sst <fichier> --out <plugin>   applique un SST
  write <plugin> --out <plugin> [--sst <fichier>]  écrit les traductions lues sur l'entrée standard
                                          (JSON [{id, dest}], id = celui d'extract)
  sst <fichier> [--full]                  contenu d'un SST
  search --dict <dossier> --text <texte>  recherche heuristique
  archive-list <bsa|ba2>  |  archive-extract <archive> <chemin> <sortie>
  pex <script.pex> [--set id=texte… --out <fichier>]
  txt <fichier> [--type mcm|res|…]        textes MCM (Interface/Translations) et autres textes
  txt-translate <fichier> --dict <dossier> traduction auto d'un texte (exacte + heuristique)
  txt-write <fichier> --out <fichier>     écrit un texte traduit (JSON [{id, dest}] sur l'entrée standard)
options : --game skyrim|sse|fo4|starfield  --lang french  --source english  --pair english_french
          --max-ld <score> (défaut 1.0)  --top <n>  --same-ref";

struct Args {
    pos: Vec<String>,
    opts: HashMap<String, Vec<String>>,
}

impl Args {
    fn parse() -> Self {
        let mut pos = Vec::new();
        let mut opts: HashMap<String, Vec<String>> = HashMap::new();
        let mut it = std::env::args().skip(1).peekable();
        while let Some(a) = it.next() {
            if let Some(k) = a.strip_prefix("--") {
                let v = match it.peek() {
                    Some(n) if !n.starts_with("--") => it.next().unwrap(),
                    _ => String::from("1"),
                };
                opts.entry(k.to_string()).or_default().push(v);
            } else {
                pos.push(a);
            }
        }
        Self { pos, opts }
    }
    fn get(&self, k: &str) -> Option<&str> {
        self.opts.get(k).and_then(|v| v.last()).map(String::as_str)
    }
    fn req(&self, k: &str) -> Result<&str> {
        self.get(k).with_context(|| format!("option --{k} requise"))
    }
    fn path(&self, i: usize) -> Result<PathBuf> {
        Ok(PathBuf::from(self.pos.get(i).with_context(|| format!("argument {i} manquant\n{USAGE}"))?))
    }
}

/// Jeu d'après la version HEDR du plugin (1.7 SSE, 0.94 LE, 0.95/1.0 FO4, 0.96 Starfield).
fn detect_game(p: &Plugin) -> Game {
    let v = p
        .header()
        .fields()
        .ok()
        .and_then(|f| f.into_iter().find(|f| &f.sig == b"HEDR"))
        .and_then(|f| f.data.get(..4).map(|b| f32::from_le_bytes(b.try_into().unwrap())))
        .unwrap_or(1.7);
    match (v * 100.0).round() as i32 {
        94 => Game::Skyrim,
        95 | 100 => Game::Fallout4,
        96 => Game::Starfield,
        _ => Game::SkyrimSE,
    }
}

struct Loaded {
    plugin: Plugin,
    game: Game,
    strings: Option<StringsSet>,
    items: Vec<EspString>,
}

fn load(args: &Args, path: &Path) -> Result<Loaded> {
    let plugin = Plugin::load(path)?;
    let game = match args.get("game") {
        Some(g) => Game::parse(g)?,
        None => detect_game(&plugin),
    };
    let source = game.lang_code(args.get("source").unwrap_or("english"));
    let cp = game.codepage(args.get("lang").unwrap_or("french"));
    let strings = if plugin.is_localized() {
        let (set, n) = StringsSet::load_for(path, &source)?;
        if n == 0 {
            bail!("plugin localisé : aucun fichier {}_{source}.strings trouvé", path.file_stem().unwrap_or_default().to_string_lossy());
        }
        Some(set)
    } else {
        None
    };
    let defs = game.record_defs();
    let items = extract::extract(&plugin, &extract::Context { defs: &defs, cp, strings: strings.as_ref() })?;
    Ok(Loaded { plugin, game, strings, items })
}

fn entry_for(s: &EspString, dest: &str, params: u8) -> Entry {
    Entry {
        list: s.list,
        str_id: s.str_id as i32,
        form_id: s.form_id,
        rec: sig(&s.rec),
        field: sig(&s.field),
        index: s.index,
        index_max: s.index_max,
        rhash: s.rhash,
        colab_id: 0,
        params,
        source: s.text.clone(),
        dest: dest.to_owned(),
    }
}

fn save_output(args: &Args, l: &mut Loaded, src: &Path, tr: &[(&EspString, &str)]) -> Result<Option<String>> {
    let Some(out) = args.get("out") else { return Ok(None) };
    let out = PathBuf::from(out);
    let lang = l.game.lang_code(args.get("lang").unwrap_or("french"));
    let cp = l.game.codepage(args.get("lang").unwrap_or("french"));
    extract::apply(&mut l.plugin, l.strings.as_mut(), tr, &cp)?;
    std::fs::write(&out, l.plugin.to_bytes())?;
    if let Some(set) = &l.strings {
        set.save_for(&out, &lang)?;
    }
    let _ = src;
    Ok(Some(out.display().to_string()))
}

fn cmd_extract(a: &Args) -> Result<Value> {
    let p = a.path(1)?;
    let t = Instant::now();
    let l = load(a, &p)?;
    Ok(json!({
        "game": l.game, "localized": l.plugin.is_localized(), "masters": l.plugin.masters(),
        "count": l.items.len(), "ms": t.elapsed().as_millis(), "strings": l.items,
    }))
}

fn load_dict(a: &Args) -> Result<(Dictionary, Value)> {
    let t = Instant::now();
    let (d, st) = Dictionary::load_dir(Path::new(a.req("dict")?), Some(a.get("pair").unwrap_or("english_french")))?;
    let info = json!({"files": st.files, "entries": st.entries, "errors": st.errors, "ms": t.elapsed().as_millis()});
    Ok((d, info))
}

fn cmd_translate(a: &Args) -> Result<Value> {
    let p = a.path(1)?;
    let mut l = load(a, &p)?;
    let (dict, dinfo) = load_dict(a)?;
    let max_ld: f32 = a.get("max-ld").map(str::parse).transpose()?.unwrap_or(1.0);
    let same_ref = a.get("same-ref").is_some();
    let t = Instant::now();
    // Chaînes de scripts (VMAD) : verrouillées par défaut, traduites seulement avec --vmad.
    let with_vmad = a.get("vmad").is_some();
    let queries: Vec<Item> = l.items.iter().map(|s| Item::new(&s.text, "", sig(&s.rec), sig(&s.field))).collect();
    let skip = |i: usize| l.items[i].vmad.is_some() && !with_vmad;
    let exact: Vec<Option<String>> = queries.iter().enumerate().map(|(i, q)| if skip(i) { None } else { dict.exact(q).map(|c| c.dest.clone()) }).collect();
    let todo: Vec<usize> = (0..queries.len()).filter(|&i| exact[i].is_none() && !skip(i)).collect();
    let todo_q: Vec<Item> = todo.iter().map(|&i| queries[i].clone()).collect();
    let best = dict.index.best_batch(&todo_q, same_ref);
    let mut heur: HashMap<usize, (String, f32)> = HashMap::new();
    for (k, h) in todo.iter().zip(best) {
        if let Some(h) = h.filter(|h| h.ld <= max_ld) {
            heur.insert(*k, (dict.index.items[h.idx].dest.clone(), h.ld));
        }
    }
    let ms = t.elapsed().as_millis();
    let mut sst = Sst { version: 8, masters: l.plugin.masters(), ..Default::default() };
    let mut applied: Vec<(&EspString, &str)> = Vec::new();
    let mut rows = Vec::new();
    for (i, s) in l.items.iter().enumerate() {
        if let Some(d) = &exact[i] {
            sst.entries.push(entry_for(s, d, params::TRANSLATED));
            applied.push((s, d.as_str()));
            rows.push(json!({"id": s.id, "kind": "exact", "dest": d}));
        } else if let Some((d, ld)) = heur.get(&i) {
            sst.entries.push(entry_for(s, d, params::INCOMPLETE));
            rows.push(json!({"id": s.id, "kind": "heuristic", "ld": ld, "dest": d}));
        }
    }
    if let Some(out) = a.get("sst") {
        std::fs::write(out, sst.to_bytes())?;
    }
    let items = l.items.clone();
    let applied: Vec<(&EspString, &str)> = applied.iter().map(|(s, d)| (&items[s.id], *d)).collect();
    let written = save_output(a, &mut l, &p, &applied)?;
    Ok(json!({
        "dict": dinfo, "strings": items.len(), "exact": exact.iter().flatten().count(), "heuristic": heur.len(),
        "search_ms": ms, "written": written, "results": if a.get("full").is_some() { json!(rows) } else { json!(rows.len()) },
    }))
}

fn cmd_apply(a: &Args) -> Result<Value> {
    let p = a.path(1)?;
    let mut l = load(a, &p)?;
    let sst = Sst::load(Path::new(a.req("sst")?))?;
    type Key = (u32, u32, u32, [u8; 4], u16);
    let mut strict: HashMap<Key, &str> = HashMap::new();
    let mut by_text: HashMap<(u32, [u8; 4], [u8; 4]), &str> = HashMap::new();
    for e in sst.entries.iter().filter(|e| e.params & params::PENDING == 0 && !e.dest.is_empty()) {
        let h = string_hash(&e.source);
        strict.insert((sanitize_form_id(e.form_id), e.rhash, h, e.field, e.index), &e.dest);
        by_text.entry((h, e.rec, e.field)).or_insert(&e.dest);
    }
    let items = l.items.clone();
    let (mut n_strict, mut n_text) = (0, 0);
    let mut tr: Vec<(&EspString, &str)> = Vec::new();
    for s in &items {
        let h = string_hash(&s.text);
        if let Some(d) = strict.get(&(sanitize_form_id(s.form_id), s.rhash, h, sig(&s.field), s.index)) {
            n_strict += 1;
            tr.push((s, d));
        } else if let Some(d) = by_text.get(&(h, sig(&s.rec), sig(&s.field))).filter(|_| s.vmad.is_none()) {
            n_text += 1;
            tr.push((s, d));
        }
    }
    a.req("out")?;
    let written = save_output(a, &mut l, &p, &tr)?;
    Ok(json!({"strings": items.len(), "strict": n_strict, "by_text": n_text, "written": written}))
}

/// Traductions éditées dans l'interface : copie de sauvegarde de la cible si elle existe déjà.
fn cmd_write(a: &Args) -> Result<Value> {
    #[derive(serde::Deserialize)]
    struct Row {
        id: usize,
        dest: String,
    }
    let p = a.path(1)?;
    let out = PathBuf::from(a.req("out")?);
    let rows: Vec<Row> = serde_json::from_reader(std::io::stdin()).context("JSON attendu sur l'entrée standard")?;
    let mut l = load(a, &p)?;
    let items = l.items.clone();
    let mut tr: Vec<(&EspString, &str)> = Vec::new();
    for r in &rows {
        let s = items.get(r.id).with_context(|| format!("chaîne {} inconnue", r.id))?;
        if s.text != r.dest {
            tr.push((s, r.dest.as_str()));
        }
    }
    let backup = backup(&out)?;
    if let Some(sst_out) = a.get("sst") {
        let mut sst = Sst { version: 8, masters: l.plugin.masters(), ..Default::default() };
        sst.entries = tr.iter().map(|(s, d)| entry_for(s, d, params::TRANSLATED | params::VALIDATED)).collect();
        std::fs::write(sst_out, sst.to_bytes())?;
    }
    let written = save_output(a, &mut l, &p, &tr)?;
    Ok(json!({"strings": items.len(), "written_count": tr.len(), "written": written, "backup": backup}))
}

/// SST xTranslator des traductions fournies sur l'entrée standard, sans toucher au plugin.
fn cmd_sst_export(a: &Args) -> Result<Value> {
    #[derive(serde::Deserialize)]
    struct Row {
        id: usize,
        dest: String,
        /// Texte d'origine vu par l'interface : le plugin a pu être réécrit traduit depuis.
        #[serde(default)]
        source: Option<String>,
        /// Traduction à revoir (approchante ou automatique) : non validée dans le SST.
        #[serde(default)]
        incomplete: bool,
    }
    let p = a.path(1)?;
    let out = PathBuf::from(a.req("out")?);
    let rows: Vec<Row> = serde_json::from_reader(std::io::stdin()).context("JSON attendu sur l'entrée standard")?;
    let l = load(a, &p)?;
    let mut sst = Sst { version: 8, masters: l.plugin.masters(), ..Default::default() };
    for r in &rows {
        let s = l.items.get(r.id).with_context(|| format!("chaîne {} inconnue", r.id))?;
        let flags = if r.incomplete { params::INCOMPLETE } else { params::TRANSLATED | params::VALIDATED };
        let mut e = entry_for(s, &r.dest, flags);
        if let Some(src) = &r.source {
            e.source = src.clone();
        }
        if e.source != r.dest {
            sst.entries.push(e);
        }
    }
    let backup = backup(&out)?;
    std::fs::write(&out, sst.to_bytes())?;
    Ok(json!({"entries": sst.entries.len(), "written": out.display().to_string(), "backup": backup}))
}

/// Copie de sauvegarde horodatée d'un fichier qui va être écrasé.
fn backup(out: &Path) -> Result<Option<String>> {
    if !out.exists() {
        return Ok(None);
    }
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    let b = PathBuf::from(format!("{}.{t}.bak", out.display()));
    std::fs::copy(out, &b)?;
    Ok(Some(b.display().to_string()))
}

fn load_txt(a: &Args) -> Result<(PathBuf, customtxt::Doc)> {
    let p = a.path(1)?;
    let doc = customtxt::parse(&std::fs::read(&p)?, a.get("type"))?;
    Ok((p, doc))
}

fn cmd_txt(a: &Args) -> Result<Value> {
    let (p, doc) = load_txt(a)?;
    let name = p.file_name().unwrap_or_default().to_string_lossy();
    let out = customtxt::output_name(&name, a.get("lang").unwrap_or("french"), doc.suffix);
    Ok(json!({"kind": doc.kind, "encoding": doc.encoding, "output_name": out, "count": doc.strings.len(), "strings": doc.strings}))
}

fn cmd_txt_translate(a: &Args) -> Result<Value> {
    let (_, doc) = load_txt(a)?;
    let (dict, dinfo) = load_dict(a)?;
    let max_ld: f32 = a.get("max-ld").map(str::parse).transpose()?.unwrap_or(1.0);
    let any = sig("****");
    let queries: Vec<Item> = doc.strings.iter().map(|s| Item::new(&s.text, "", any, any)).collect();
    let mut rows = Vec::new();
    let mut todo = Vec::new();
    for (i, q) in queries.iter().enumerate() {
        match dict.exact(q) {
            Some(c) => rows.push(json!({"id": i, "kind": "exact", "dest": c.dest})),
            None => todo.push(i),
        }
    }
    let todo_q: Vec<Item> = todo.iter().map(|&i| queries[i].clone()).collect();
    for (i, h) in todo.iter().zip(dict.index.best_batch(&todo_q, false)) {
        if let Some(h) = h.filter(|h| h.ld <= max_ld) {
            rows.push(json!({"id": i, "kind": "heuristic", "ld": h.ld, "dest": dict.index.items[h.idx].dest}));
        }
    }
    Ok(json!({"dict": dinfo, "strings": doc.strings.len(), "results": rows}))
}

fn cmd_txt_write(a: &Args) -> Result<Value> {
    #[derive(serde::Deserialize)]
    struct Row {
        id: usize,
        dest: String,
    }
    let (_, doc) = load_txt(a)?;
    let out = PathBuf::from(a.req("out")?);
    let rows: Vec<Row> = serde_json::from_reader(std::io::stdin()).context("JSON attendu sur l'entrée standard")?;
    let tr: Vec<(usize, &str)> = rows.iter().filter(|r| doc.strings.get(r.id).is_some_and(|s| s.text != r.dest)).map(|r| (r.id, r.dest.as_str())).collect();
    let bytes = doc.rebuild(&tr)?;
    let backup = backup(&out)?;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&out, bytes)?;
    Ok(json!({"strings": doc.strings.len(), "written_count": tr.len(), "written": out.display().to_string(), "backup": backup}))
}

fn cmd_sst(a: &Args) -> Result<Value> {
    let s = Sst::load(&a.path(1)?)?;
    let validated = s.entries.iter().filter(|e| e.is_validated()).count();
    let mut v = json!({"version": s.version, "masters": s.masters, "colab": s.colab, "entries": s.entries.len(), "validated": validated});
    if a.get("full").is_some() {
        v["items"] = json!(s.entries);
    }
    Ok(v)
}

fn cmd_search(a: &Args) -> Result<Value> {
    let (dict, dinfo) = load_dict(a)?;
    let q = Item::new(a.req("text")?, "", sig(a.get("rec").unwrap_or("****")), sig(a.get("field").unwrap_or("****")));
    let top: usize = a.get("top").map(str::parse).transpose()?.unwrap_or(10);
    let t = Instant::now();
    let hits = dict.index.search(&q, a.get("same-ref").is_some());
    let ms = t.elapsed().as_micros();
    let res: Vec<Value> = hits.iter().take(top).map(|h| {
        let c = &dict.index.items[h.idx];
        json!({"ld": h.ld, "source": c.source, "dest": c.dest, "rec": xtcore::sig_str(&c.rec), "field": xtcore::sig_str(&c.field)})
    }).collect();
    Ok(json!({"dict": dinfo, "exact": dict.exact(&q).map(|c| &c.dest), "candidates": hits.len(), "search_us": ms, "results": res}))
}

fn cmd_archive(a: &Args, extract: bool) -> Result<Value> {
    let ar = Archive::open(&a.path(1)?)?;
    if !extract {
        return Ok(json!({"kind": ar.kind, "count": ar.entries.len(), "files": ar.entries}));
    }
    let inner = a.pos.get(2).context("chemin interne manquant")?;
    let e = ar.find(inner).with_context(|| format!("{inner} absent de l'archive"))?;
    let data = ar.read(e)?;
    std::fs::write(a.path(3)?, &data)?;
    Ok(json!({"path": e.path, "size": data.len()}))
}

fn cmd_pex(a: &Args) -> Result<Value> {
    let path = a.path(1)?;
    let buf = std::fs::read(&path)?;
    let game = Game::parse(a.get("game").unwrap_or(if buf.first() == Some(&0xFA) { "sse" } else { "fo4" }))?;
    let cp = game.codepage(a.get("lang").unwrap_or("french"));
    let nt = pex::no_trans_list(match game {
        Game::Skyrim => include_str!("../data/pexNoTrans/Skyrim.txt"),
        Game::SkyrimSE => include_str!("../data/pexNoTrans/SkyrimSE.txt"),
        Game::Fallout4 => include_str!("../data/pexNoTrans/Fallout4.txt"),
        Game::Starfield => include_str!("../data/pexNoTrans/Starfield.txt"),
    });
    let mut p = pex::Pex::parse(&buf, &cp, &nt)?;
    if let Some(sets) = a.opts.get("set") {
        for s in sets {
            let (id, txt) = s.split_once('=').context("--set id=texte")?;
            p.set(id.parse()?, txt, &cp)?;
        }
        std::fs::write(a.req("out")?, p.to_bytes())?;
    }
    Ok(json!({"game": game, "strings": p.strings}))
}

fn main() {
    let a = Args::parse();
    let res = match a.pos.first().map(String::as_str) {
        Some("extract") => cmd_extract(&a),
        Some("translate") => cmd_translate(&a),
        Some("apply") => cmd_apply(&a),
        Some("write") => cmd_write(&a),
        Some("sst") => cmd_sst(&a),
        Some("sst-export") => cmd_sst_export(&a),
        Some("search") => cmd_search(&a),
        Some("archive-list") => cmd_archive(&a, false),
        Some("archive-extract") => cmd_archive(&a, true),
        Some("pex") => cmd_pex(&a),
        Some("txt") => cmd_txt(&a),
        Some("txt-translate") => cmd_txt_translate(&a),
        Some("txt-write") => cmd_txt_write(&a),
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    };
    match res {
        Ok(v) => println!("{v}"),
        Err(e) => {
            println!("{}", json!({"error": format!("{e:#}")}));
            std::process::exit(1);
        }
    }
}
