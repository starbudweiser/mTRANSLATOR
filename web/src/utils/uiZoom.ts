/**
 * Mise à l'échelle de toute l'interface (texte, marges, icônes) pour que la disposition ne change
 * jamais : à REF_WIDTH px tout tient sur une ligne ; plus étroit, l'ensemble se réduit
 * proportionnellement jusqu'à FLOOR. Les rangées marquées data-fit (barres d'outils) sont ensuite
 * mesurées : si leur contenu réel déborde (libellés traduits, compteurs, rendu WebKit), on réduit
 * encore. ⌘+ / ⌘− / ⌘0 règlent un facteur personnel (maximum visé).
 */
const REF_WIDTH = 1480;
const FLOOR = 0.8;
const USER_MIN = 0.7;
const USER_MAX = 1.5;
const STORAGE_KEY = 'mtranslator_ui_zoom';

let userZoom = 1;

function readUserZoom(): number {
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_KEY) ?? '');
    return v >= USER_MIN && v <= USER_MAX ? v : 1;
  } catch {
    return 1;
  }
}

const root = document.documentElement;
const setZoom = (z: number) => root.style.setProperty('--ui-zoom', z.toFixed(3));

function apply() {
  const floor = Math.min(userZoom, FLOOR);
  let zoom = Math.max(floor, Math.min(userZoom, window.innerWidth / REF_WIDTH));
  setZoom(zoom);
  // Débordement réel : largeur naturelle / largeur disponible, en px CSS non zoomés
  let ratio = 1;
  document.querySelectorAll<HTMLElement>('[data-fit]').forEach((el) => {
    if (el.clientWidth > 0) ratio = Math.max(ratio, el.scrollWidth / el.clientWidth);
  });
  if (ratio > 1.001) {
    zoom = Math.max(floor, zoom / ratio - 0.002);
    setZoom(zoom);
  }
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    apply();
  });
}

function setUserZoom(z: number) {
  userZoom = Math.round(Math.min(USER_MAX, Math.max(USER_MIN, z)) * 10) / 10;
  try {
    localStorage.setItem(STORAGE_KEY, String(userZoom));
  } catch {
    /* préférence non mémorisée */
  }
  apply();
}

export function initUiZoom() {
  userZoom = readUserZoom();
  apply();
  window.addEventListener('resize', schedule);
  // Contenu des barres modifié (mode Simple/Expert, fichier ouvert, compteurs, langue)
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.key === '+' || e.key === '=') setUserZoom(userZoom + 0.1);
    else if (e.key === '-') setUserZoom(userZoom - 0.1);
    else if (e.key === '0') setUserZoom(1);
    else return;
    e.preventDefault();
  });
}
