/**
 * Mise à l'échelle de toute l'interface (texte, marges, icônes) pour que la disposition ne change
 * jamais : à REF_WIDTH px tout tient sur une ligne ; plus étroit, l'ensemble se réduit
 * proportionnellement jusqu'à FLOOR. ⌘+ / ⌘− / ⌘0 règlent un facteur personnel (maximum visé).
 */
const REF_WIDTH = 1480;
const FLOOR = 0.85;
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

function apply() {
  const fit = window.innerWidth / REF_WIDTH;
  const zoom = Math.max(Math.min(userZoom, FLOOR), Math.min(userZoom, fit));
  document.documentElement.style.setProperty('--ui-zoom', zoom.toFixed(3));
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
  window.addEventListener('resize', apply);
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.key === '+' || e.key === '=') setUserZoom(userZoom + 0.1);
    else if (e.key === '-') setUserZoom(userZoom - 0.1);
    else if (e.key === '0') setUserZoom(1);
    else return;
    e.preventDefault();
  });
}
