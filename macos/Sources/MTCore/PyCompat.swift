// Équivalents Swift des primitives Python dont dépend mt_engines.py, pour un port fidèle :
// chaînes comparées point de code par point de code (pas d'équivalence canonique), strip() Unicode de Python,
// quote_plus / quote d'urllib, json.dumps, difflib.SequenceMatcher, motifs `re` traduits pour ICU.

import Foundation

/// Chaîne comparée et hachée sur ses octets UTF-8 : comme `str` de Python, « é » précomposé ≠ « é » décomposé.
public struct PyStr: Hashable, Sendable {
    public let s: String
    public init(_ s: String) { self.s = s }
    public static func == (a: PyStr, b: PyStr) -> Bool { a.s.utf8.elementsEqual(b.s.utf8) }
    public func hash(into h: inout Hasher) { for b in s.utf8 { h.combine(b) } }
}

/// Nombre de points de code (len() de Python).
@inline(__always) func pyLen(_ s: String) -> Int { s.unicodeScalars.count }

/// Caractères que str.isspace() de Python considère comme des espaces.
func isPySpace(_ c: Unicode.Scalar) -> Bool {
    switch c.value {
    case 0x09...0x0d, 0x1c...0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000...0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000: return true
    default: return false
    }
}

func pyStrip(_ s: String) -> String { pyRStrip(pyLStrip(s)) }

func pyLStrip(_ s: String) -> String {
    let u = s.unicodeScalars
    var i = u.startIndex
    while i < u.endIndex, isPySpace(u[i]) { i = u.index(after: i) }
    return String(u[i...])
}

func pyRStrip(_ s: String) -> String {
    let u = s.unicodeScalars
    var j = u.endIndex
    while j > u.startIndex {
        let p = u.index(before: j)
        if !isPySpace(u[p]) { break }
        j = p
    }
    return String(u[..<j])
}

/// `a in b` pour deux chaînes : recherche littérale (sans équivalence canonique).
func pyContains(_ hay: String, _ needle: String) -> Bool {
    if needle.isEmpty { return true }
    return (hay as NSString).range(of: needle, options: .literal).location != NSNotFound
}

/// Ordre des points de code (celui de sorted() sur des str) : l'ordre des octets UTF-8 lui est identique.
func pyLess(_ a: String, _ b: String) -> Bool { a.utf8.lexicographicallyPrecedes(b.utf8) }

// MARK: - urllib.parse

private let unreservedQuote: Set<UInt8> = Set(("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~").utf8)

/// urllib.parse.quote_plus (UTF-8).
func pyQuotePlus(_ s: String) -> String {
    var out = ""
    for b in s.utf8 {
        if unreservedQuote.contains(b) { out.unicodeScalars.append(Unicode.Scalar(b)) }
        else if b == 0x20 { out += "+" }
        else { out += String(format: "%%%02X", b) }
    }
    return out
}

/// urllib.parse.quote (UTF-8, `safe` = « / » par défaut).
func pyQuote(_ s: String, safe: String = "/") -> String {
    let keep = unreservedQuote.union(Set(safe.utf8))
    var out = ""
    for b in s.utf8 {
        if keep.contains(b) { out.unicodeScalars.append(Unicode.Scalar(b)) }
        else { out += String(format: "%%%02X", b) }
    }
    return out
}

/// urllib.parse.urlencode([('q', r), …]).
func pyURLEncode(_ pairs: [(String, String)]) -> String {
    pairs.map { pyQuotePlus($0.0) + "=" + pyQuotePlus($0.1) }.joined(separator: "&")
}

// MARK: - json.dumps

/// Chaîne JSON comme json.dumps (séparateurs par défaut) ; `ensureASCII` : \uXXXX pour tout caractère non ASCII.
func pyJSONString(_ s: String, ensureASCII: Bool) -> String {
    var out = "\""
    for c in s.unicodeScalars {
        switch c.value {
        case 0x22: out += "\\\""
        case 0x5c: out += "\\\\"
        case 0x0a: out += "\\n"
        case 0x0d: out += "\\r"
        case 0x09: out += "\\t"
        case 0x08: out += "\\b"
        case 0x0c: out += "\\f"
        case 0..<0x20: out += String(format: "\\u%04x", c.value)
        case 0x20..<0x7f, 0x7f: out.unicodeScalars.append(c)
        default:
            if !ensureASCII { out.unicodeScalars.append(c) }
            else if c.value > 0xffff {
                let v = c.value - 0x10000
                out += String(format: "\\u%04x\\u%04x", 0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
            } else { out += String(format: "\\u%04x", c.value) }
        }
    }
    return out + "\""
}

/// json.dumps d'une liste de chaînes (ensure_ascii=False) : `["a", "b"]`.
func pyJSONList(_ items: [String], ensureASCII: Bool = false) -> String {
    "[" + items.map { pyJSONString($0, ensureASCII: ensureASCII) }.joined(separator: ", ") + "]"
}

/// str(x) de Python pour une valeur issue d'un JSON.
func pyStr(_ v: Any?) -> String {
    switch v {
    case nil: return "None"
    case is NSNull: return "None"
    case let s as String: return s
    case let n as NSNumber:
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "True" : "False" }
        let d = n.doubleValue
        if CFNumberIsFloatType(n) {
            if d == d.rounded(), abs(d) < 1e16 { return String(format: "%.1f", d) }
            return "\(d)"
        }
        return n.stringValue
    default: return "\(v!)"
    }
}

// MARK: - Expressions régulières (re → ICU)

/// Fragments qui reproduisent les classes de `re` de Python 3 : \w = lettres, chiffres Unicode et « _ ».
enum RX {
    static let w = #"\p{L}\p{N}_"#          // contenu de classe pour \w
    static let letter = #"[\p{L}\p{Nl}\p{No}]"#  // [^\W\d_]
}

func compile(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
    do { return try NSRegularExpression(pattern: pattern, options: options) }
    catch { fatalError("Motif invalide : \(pattern) (\(error))") }
}

extension NSRegularExpression {
    /// Toutes les correspondances (re.finditer) : (plage UTF-16, texte).
    func all(_ s: String) -> [(range: NSRange, text: String)] {
        let ns = s as NSString
        return matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ($0.range, ns.substring(with: $0.range)) }
    }
    /// re.search(...) is not None
    func found(_ s: String) -> Bool {
        firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }
    /// re.match(...) is not None (ancré au début)
    func matchesStart(_ s: String) -> Bool {
        guard let m = firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) else { return false }
        return m.range.location == 0
    }
    /// re.sub avec une fonction de remplacement, appelée dans l'ordre du texte.
    func sub(_ s: String, _ f: (String) -> String) -> String {
        let ns = s as NSString
        var out = ""
        var pos = 0
        for m in matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: pos, length: m.range.location - pos))
            out += f(ns.substring(with: m.range))
            pos = m.range.location + m.range.length
        }
        return out + ns.substring(from: pos)
    }
}

// MARK: - difflib.SequenceMatcher (sans fonction « junk »)

/// Rapport de ressemblance de difflib.SequenceMatcher(None, a, b).ratio(), autojunk compris.
func sequenceRatio(_ a: String, _ b: String) -> Double {
    let A = a.unicodeScalars.map { $0.value }, B = b.unicodeScalars.map { $0.value }
    let total = A.count + B.count
    if total == 0 { return 1.0 }
    var b2j: [UInt32: [Int]] = [:]
    for (i, e) in B.enumerated() { b2j[e, default: []].append(i) }
    var popular = Set<UInt32>()
    let n = B.count
    if n >= 200 {
        let ntest = n / 100 + 1
        for (e, idx) in b2j where idx.count > ntest { popular.insert(e) }
        for e in popular { b2j[e] = nil }
    }

    func longest(_ alo: Int, _ ahi: Int, _ blo: Int, _ bhi: Int) -> (Int, Int, Int) {
        var besti = alo, bestj = blo, bestsize = 0
        var j2len: [Int: Int] = [:]
        if alo < ahi {
            for i in alo..<ahi {
                var newj2len: [Int: Int] = [:]
                for j in b2j[A[i]] ?? [] {
                    if j < blo { continue }
                    if j >= bhi { break }
                    let k = (j2len[j - 1] ?? 0) + 1
                    newj2len[j] = k
                    if k > bestsize { besti = i - k + 1; bestj = j - k + 1; bestsize = k }
                }
                j2len = newj2len
            }
        }
        // Prolonge la correspondance par les éléments « populaires » (retirés de b2j), comme difflib ; bjunk est vide.
        while besti > alo && bestj > blo && A[besti - 1] == B[bestj - 1] { besti -= 1; bestj -= 1; bestsize += 1 }
        while besti + bestsize < ahi && bestj + bestsize < bhi && A[besti + bestsize] == B[bestj + bestsize] { bestsize += 1 }
        return (besti, bestj, bestsize)
    }

    var queue = [(0, A.count, 0, B.count)]
    var blocks: [(Int, Int, Int)] = []
    while let (alo, ahi, blo, bhi) = queue.popLast() {
        let (i, j, k) = longest(alo, ahi, blo, bhi)
        if k > 0 {
            blocks.append((i, j, k))
            if alo < i && blo < j { queue.append((alo, i, blo, j)) }
            if i + k < ahi && j + k < bhi { queue.append((i + k, ahi, j + k, bhi)) }
        }
    }
    blocks.sort { ($0.0, $0.1, $0.2) < ($1.0, $1.1, $1.2) }
    var matched = 0
    var i1 = 0, j1 = 0, k1 = 0
    var merged: [(Int, Int, Int)] = []
    for (i2, j2, k2) in blocks {
        if i1 + k1 == i2 && j1 + k1 == j2 { k1 += k2 }
        else {
            if k1 > 0 { merged.append((i1, j1, k1)) }
            i1 = i2; j1 = j2; k1 = k2
        }
    }
    if k1 > 0 { merged.append((i1, j1, k1)) }
    for m in merged { matched += m.2 }
    return 2.0 * Double(matched) / Double(total)
}
