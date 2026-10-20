/**
 * Fonctions utilitaires pour mTRANSLATOR macOS
 * - Détection et validation des balises Bethesda (<Alias>, %s, \r\n, <font>)
 * - Calcul des statistiques de traduction
 * - Calcul de correspondance floue (Fuzzy Match)
 * - Import / Export aux formats SST, TXT, CSV, JSON
 */

import { ModRecord, TranslationStats } from '../types';

/**
 * Extrait toutes les balises critiques d'un texte Bethesda
 * Gère notamment les balises Papyrus <Alias>, les spécificateurs %s,
 * les retours à la ligne littéraux, et le saut de page critique des livres : [pagebreak].
 */
export function extractBethesdaTags(text: string): string[] {
  if (!text) return [];
  const tags: string[] = [];

  // Saut de page des livres Bethesda : [pagebreak], [Pagebreak], [PAGEBREAK], <pagebreak>
  const pagebreakRegex = /\[\s*pagebreak\s*\]|<pagebreak>/gi;
  let pbMatch;
  while ((pbMatch = pagebreakRegex.exec(text)) !== null) {
    tags.push(pbMatch[0]);
  }

  // Balises XML/Papyrus <Alias=...>, <font...>, etc.
  const angleTagRegex = /<[^>]+>/g;
  let match;
  while ((match = angleTagRegex.exec(text)) !== null) {
    // Si c'est déjà un <pagebreak>, éviter les doublons
    if (!tags.includes(match[0])) {
      tags.push(match[0]);
    }
  }

  // Spécificateurs de format C/Papyrus (%s, %d, %i, %.1f, %u, %%)
  const formatRegex = /%[0-9.]*[sdifu%]/g;
  while ((match = formatRegex.exec(text)) !== null) {
    tags.push(match[0]);
  }

  // Note: Les retours à la ligne (\r\n, \n) sont des séparateurs de mise en page
  // et ne doivent PAS être traités comme des balises statiques strictes afin d'éviter
  // les faux positifs lorsque l'utilisateur tape normalement Entrée dans l'éditeur.

  return tags;
}

/**
 * Nettoie et rétablit les balises sensibles qui auraient pu être traduites par erreur
 * (Exemple crucial : rétablir [pagebreak] si l'IA ou l'utilisateur a écrit [saut de page])
 */
export function sanitizeBethesdaTranslation(target: string, source?: string): string {
  if (!target) return target;

  let cleaned = target;

  // Si l'original contenait [pagebreak] ou s'il y a des tentatives de traduction de saut de page
  const hasPagebreakInSource = source ? /\[\s*pagebreak\s*\]|<pagebreak>/i.test(source) : false;

  // Remplacements automatiques des variantes traduites en français
  const translatedPagebreakRegex = /\[\s*(?:saut\s*de\s*page|sautdepage|saut-de-page|changement\s*de\s*page|coupure\s*de\s*page|page\s*break|page_break)\s*\]/gi;
  cleaned = cleaned.replace(translatedPagebreakRegex, '[pagebreak]');

  // Si la source avait [pagebreak] et que la cible a écrit "pagebreak" sans crochets
  if (hasPagebreakInSource && !/\[\s*pagebreak\s*\]/i.test(cleaned)) {
    // Remplacer les occurrences nues isolées
    cleaned = cleaned.replace(/\bpagebreak\b/gi, '[pagebreak]');
  }

  return cleaned;
}

/**
 * Valide l'intégrité des balises entre la source et la cible
 */
export function validateTags(source: string, target: string): string[] {
  if (!source || !target) return [];

  const warnings: string[] = [];
  const sourceTags = extractBethesdaTags(source);
  const targetTags = extractBethesdaTags(target);

  // Vérification dédiée prioritaire pour [pagebreak] dans les livres
  const sourceHasPagebreak = /\[\s*pagebreak\s*\]|<pagebreak>/i.test(source);
  const targetHasPagebreak = /\[\s*pagebreak\s*\]|<pagebreak>/i.test(target);

  if (sourceHasPagebreak && !targetHasPagebreak) {
    // Vérifier si traduit accidentellement
    if (/saut\s*de\s*page|sautdepage/i.test(target)) {
      warnings.push('Attention : [pagebreak] a été traduit en français ! Rétablissez le mot-clé [pagebreak] exact.');
    } else {
      warnings.push('Saut de page de livre manquant : "[pagebreak]" doit être conservé tel quel.');
    }
  }

  // Vérifie si chaque balise présente dans la source est également présente dans la cible
  sourceTags.forEach((tag) => {
    // Cas spécial pour pagebreak déjà géré
    if (/pagebreak/i.test(tag)) return;
    // Ignorer toute forme de saut de ligne ou artefact d'échappement
    if (/^\\?[rn](\\?[rn])?$/i.test(tag)) return;

    if (!target.includes(tag)) {
      warnings.push(`Balise ou format manquant dans la traduction : "${tag}"`);
    }
  });

  // Vérifie si la cible n'a pas introduit des balises orphelines
  targetTags.forEach((tag) => {
    if (/pagebreak/i.test(tag) && sourceHasPagebreak) return;
    if (/^\\?[rn](\\?[rn])?$/i.test(tag)) return;

    if (!source.includes(tag)) {
      warnings.push(`Balise non présente dans l'original : "${tag}"`);
    }
  });

  return warnings;
}

/**
 * Compteur rapide de mots sans allocation d'objets ou tableaux
 */
export function fastCountWords(str: string): number {
  if (!str) return 0;
  let count = 0;
  let inWord = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Espaces, retours ligne, tabulations (\t=9, \n=10, \r=13, space=32)
    if (code <= 32) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

/**
 * Calcule les statistiques globales du projet
 */
export function calculateStats(records: ModRecord[]): TranslationStats {
  const total = records.length;
  let translated = 0;
  let untranslated = 0;
  let partial = 0;
  let identical = 0;
  let wordCountSource = 0;
  let wordCountTarget = 0;
  let warningsCount = 0;

  for (let i = 0; i < total; i++) {
    const r = records[i];
    if (r.status === 'translated') translated++;
    else if (r.status === 'untranslated') untranslated++;
    else if (r.status === 'partial') partial++;
    else if (r.status === 'identical') identical++;

    if (r.tagWarnings && r.tagWarnings.length > 0) {
      warningsCount++;
    }

    wordCountSource += fastCountWords(r.source);
    wordCountTarget += fastCountWords(r.target);
  }

  const percentage = total > 0 ? Math.round((translated / total) * 100) : 0;

  return {
    total,
    translated,
    untranslated,
    partial,
    identical,
    wordCountSource,
    wordCountTarget,
    warningsCount,
    percentage,
  };
}

/**
 * Calcule une similarité simple entre deux chaînes (0 - 100)
 */
export function calculateSimilarity(s1: string, s2: string): number {
  const str1 = s1.toLowerCase().trim();
  const str2 = s2.toLowerCase().trim();
  if (str1 === str2) return 100;
  if (!str1 || !str2) return 0;

  // Si l'une des chaînes est beaucoup plus longue que l'autre, la similarité est forcément faible
  const lenRatio = str1.length / str2.length;
  if (lenRatio > 3 || lenRatio < 0.33) return 0;

  const words1 = new Set(str1.split(/\s+/).filter(Boolean));
  const words2 = new Set(str2.split(/\s+/).filter(Boolean));

  let intersection = 0;
  words1.forEach((w) => {
    if (words2.has(w)) intersection++;
  });

  const union = new Set([...words1, ...words2]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

/**
 * Génère le contenu d'un dictionnaire SST (format XML mTRANSLATOR / SST)
 */
export function exportToSST(
  records: ModRecord[], 
  game: string,
  sourceLang: string = 'English',
  targetLang: string = 'Français'
): string {
  const header = `<?xml version="1.0" encoding="utf-8"?>\n<!-- mTRANSLATOR Dictionary / SST Export (${sourceLang} -> ${targetLang}) - macOS Edition -->\n<SSTDictionary game="${game}" source="${escapeXml(sourceLang)}" target="${escapeXml(targetLang)}" count="${records.length}">\n`;
  const items = records
    .map((r) => {
      const formIdAttr = r.formId ? ` formid="${r.formId}"` : '';
      const edidAttr = r.edid ? ` edid="${escapeXml(r.edid)}"` : '';
      const typeAttr = r.recordType ? ` type="${r.recordType}"` : '';
      return `  <entry${formIdAttr}${edidAttr}${typeAttr}>\n    <source>${escapeXml(r.source)}</source>\n    <dest>${escapeXml(r.target || r.source)}</dest>\n  </entry>`;
    })
    .join('\n');
  const footer = '\n</SSTDictionary>';
  return header + items + footer;
}

/**
 * Génère un fichier de traduction TXT Bethesda (format MCM / mTRANSLATOR tab-separated)
 */
export function exportToTranslationTxt(records: ModRecord[]): string {
  return records
    .map((r) => {
      let text = r.target || r.source;
      // Pour les fichiers MCM Bethesda qui stockent les retours à la ligne sous forme de \r\n littéral sur une ligne unique :
      if (r.source.includes('\\r\\n') && !text.includes('\\r\\n') && text.includes('\n')) {
        text = text.replace(/\r?\n/g, '\\r\\n');
      } else if (r.source.includes('\\n') && !text.includes('\\n') && text.includes('\n')) {
        text = text.replace(/\r?\n/g, '\\n');
      }
      return `${r.formId || r.edid || r.id}\t${text}`;
    })
    .join('\n');
}

/**
 * Génère un export CSV structuré
 */
export function exportToCSV(records: ModRecord[]): string {
  const headers = ['FormID', 'EditorID', 'Type', 'Statut', 'Source (VO)', 'Traduction (VF)', 'Avertissements'];
  const rows = records.map((r) => [
    `"${r.formId || ''}"`,
    `"${(r.edid || '').replace(/"/g, '""')}"`,
    `"${r.recordType || ''}"`,
    `"${r.status}"`,
    `"${r.source.replace(/"/g, '""')}"`,
    `"${r.target.replace(/"/g, '""')}"`,
    `"${(r.tagWarnings || []).join('; ').replace(/"/g, '""')}"`,
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Télécharge un fichier dans le navigateur macOS
 */
export function triggerFileDownload(content: string, filename: string, mimeType: string) {
  // Dans l'app (pywebview), un lien <a download> remplace la page par le fichier : on enregistre
  // par le serveur Python (sélecteur natif). Hors de l'app, téléchargement classique.
  fetch('/api/save-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-mTRANSLATOR': '1' },
    body: JSON.stringify({ content, defaultName: filename, title: `Exporter ${filename}` }),
  })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
    })
    .catch(() => browserDownload(content, filename, mimeType));
}

/** Équivalent binaire de triggerFileDownload (plugin, archive .zip). */
export async function triggerBlobDownload(blob: Blob, filename: string) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const r = await fetch('/api/save-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-mTRANSLATOR': '1' },
      body: JSON.stringify({ base64: btoa(bin), defaultName: filename, title: `Enregistrer ${filename}` }),
    });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

function browserDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
