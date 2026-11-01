/**
 * Socle — nom de l'appli : sa lettre minuscule, à toute place (le « m » de mORTEX, le « s » de sKYCRASH,
 * le « e » de CAREERDeSK…) prend la couleur de son logo partout où le nom est écrit dans la page.
 * La CSS Custom Highlight API colore une plage de texte sans toucher au DOM (React garde ses nœuds).
 * Recopié par sync_apps.sh dans chaque dossier « socle/ » qui en contient une copie.
 *
 *   import { startBrandHighlight } from "./socle/brand_highlight.js";
 *   startBrandHighlight({ names: ["mABBAJACK"], color: "#22d3ee" });   // renvoie une fonction d'arrêt
 */
const HIGHLIGHT = "socle-brand";
const REFRESH_MS = 250;

/** Une plage sur chaque lettre minuscule de chaque occurrence d'un des noms, hors mots, chemins et adresses. */
export function brandRanges(root, names) {
  const doc = root.ownerDocument || root;
  const specs = names
    .map((name) => ({ name, marks: [...name.matchAll(/\p{Ll}/gu)].map((m) => m.index) }))
    .filter((s) => s.marks.length > 0);
  const ranges = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      specs.some((s) => node.nodeValue && node.nodeValue.includes(s.name))
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue || "";
    for (const { name, marks } of specs) {
      for (let idx = text.indexOf(name); idx !== -1; idx = text.indexOf(name, idx + name.length)) {
        const before = text[idx - 1] || "";
        const after = text[idx + name.length] || "";
        if (/[\p{L}\p{N}./@_-]/u.test(before) || /[\p{L}\p{N}_-]/u.test(after)) continue;
        for (const mark of marks) {
          const range = doc.createRange();
          range.setStart(node, idx + mark);
          range.setEnd(node, idx + mark + 1);
          ranges.push(range);
        }
      }
    }
  }
  return ranges;
}

/** Suit les changements de la page (au plus 4 fois par seconde) ; renvoie une fonction d'arrêt. */
export function startBrandHighlight({ names, color, root = document.body }) {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") {
    return () => undefined;
  }
  const style = document.createElement("style");
  style.textContent = `::highlight(${HIGHLIGHT}) { color: ${color}; }`;
  document.head.appendChild(style);
  const highlight = new Highlight();
  CSS.highlights.set(HIGHLIGHT, highlight);

  let timer;
  const refresh = () => {
    timer = undefined;
    highlight.clear();
    for (const range of brandRanges(root, names)) highlight.add(range);
  };
  const observer = new MutationObserver(() => {
    if (timer === undefined) timer = setTimeout(refresh, REFRESH_MS);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  refresh();

  return () => {
    observer.disconnect();
    clearTimeout(timer);
    CSS.highlights.delete(HIGHLIGHT);
    style.remove();
  };
}
