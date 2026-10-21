/**
 * Diagnostic intelligent des enregistrements Bethesda pour mTRANSLATOR macOS
 * Analyse chaque ligne pour expliquer à l'utilisateur pourquoi elle n'est pas traduite,
 * ou quelle correspondance SST / IA est disponible.
 */

import { ModRecord, DictionaryEntry } from '../types';
import { calculateSimilarity } from './translatorUtils';
import { localDictStore } from './localDictionaryStore';
import { L } from '../i18n/L';

export type DiagnosticReason =
  | 'SST_EXACT_AVAILABLE'
  | 'SST_FUZZY_AVAILABLE'
  | 'UNSEEN_MOD_TEXT'
  | 'TAG_MISMATCH'
  | 'MANUAL_DRAFT'
  | 'IDENTICAL_LORE'
  | 'TRANSLATED_VALID';

export interface RecordDiagnostic {
  reason: DiagnosticReason;
  shortLabel: string;
  badgeClass: string;
  dotColor: string;
  detailedReason: string;
  suggestion?: string;
  score?: number;
  canQuickApply: boolean;
  isLocalLearned?: boolean;
}

// Cache rapide des diagnostics par record ID + version pour éviter les calculs redondants
const diagnosticCache = new Map<string, { key: string; diag: RecordDiagnostic }>();

/**
 * Prépare une Map d'accès direct O(1) pour les dictionnaires en mémoire
 */
export function buildDictionaryLookup(dictionaries: DictionaryEntry[]): Map<string, DictionaryEntry> {
  const map = new Map<string, DictionaryEntry>();
  for (let i = 0; i < dictionaries.length; i++) {
    const d = dictionaries[i];
    const key = d.source.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, d);
    }
  }
  return map;
}

/**
 * Analyse une ligne par rapport à la base de dictionnaires SST chargée et au dictionnaire local prioritaire
 */
export function getRecordDiagnostic(
  record: ModRecord,
  dictionaries: DictionaryEntry[],
  dictMap?: Map<string, DictionaryEntry>
): RecordDiagnostic {
  // Clé de cache rapide (ID + source + target + status + warnings)
  const cacheKey = `${record.id}_${record.status}_${record.target}_${record.tagWarnings?.length || 0}`;
  const cached = diagnosticCache.get(record.id);
  if (cached && cached.key === cacheKey) {
    return cached.diag;
  }

  const res = computeRecordDiagnostic(record, dictionaries, dictMap);
  diagnosticCache.set(record.id, { key: cacheKey, diag: res });
  return res;
}

function computeRecordDiagnostic(
  record: ModRecord,
  dictionaries: DictionaryEntry[],
  dictMap?: Map<string, DictionaryEntry>
): RecordDiagnostic {
  const hasTarget = Boolean(record.target && record.target.trim().length > 0);
  const hasWarnings = Boolean(record.tagWarnings && record.tagWarnings.length > 0);

  // 1. Déjà traduit et validé
  if (record.status === 'translated' && hasTarget && !hasWarnings) {
    return {
      reason: 'TRANSLATED_VALID',
      shortLabel: L("Traduit & validé"),
      badgeClass: 'bg-[#262626] text-[#4ade80] border-[#22c55e]',
      dotColor: '#22c55e',
      detailedReason: L("Cette ligne est entièrement traduite, validée et conforme aux balises du jeu."),
      canQuickApply: false,
    };
  }

  // 2. Erreur ou divergence de balises
  if (hasWarnings) {
    const warn = record.tagWarnings![0];
    return {
      reason: 'TAG_MISMATCH',
      shortLabel: 'Alerte balise',
      badgeClass: 'bg-[#3f2a0c] text-[#fbbf24] border-[#f59e0b]',
      dotColor: '#f59e0b',
      detailedReason: L("Anomalie de balise détectée : {warn}. Le moteur de jeu risque d'afficher des erreurs.", { warn }),
      canQuickApply: false,
    };
  }

  // 3. Marqué identique (nom propre / lore)
  if (record.status === 'identical') {
    return {
      reason: 'IDENTICAL_LORE',
      shortLabel: 'Nom propre / Lore',
      badgeClass: 'bg-[#0c3a52] text-[#38bdf8] border-[#0369a1]',
      dotColor: '#38bdf8',
      detailedReason: L("Cette chaîne a été volontairement conservée identique à l'original VO (terme lore ou nom propre)."),
      canQuickApply: false,
    };
  }

  // 4. Brouillon manuel ou partiel
  if (hasTarget && record.status === 'partial') {
    return {
      reason: 'MANUAL_DRAFT',
      shortLabel: 'En cours',
      badgeClass: 'bg-[#0c3a52] text-[#38bdf8] border-[#0369a1]',
      dotColor: '#0ea5e9',
      detailedReason: L("Texte en cours de révision ou partiellement renseigné."),
      canQuickApply: false,
    };
  }

  // 5. Ligne NON TRADUITE (Cible vide) -> SCAN EN PREMIER DANS LE DICTIONNAIRE LOCAL AUTO-ALIMENTÉ
  const localSearch = localDictStore.findExactTranslation(record.source);
  if (localSearch) {
    return {
      reason: 'SST_EXACT_AVAILABLE',
      shortLabel: localSearch.isLocalLearned ? L("Mémoire locale 100%") : 'SST 100% dispo',
      badgeClass: localSearch.isLocalLearned ? 'bg-[#2c2c2c] text-[#38bdf8] border-[#0ea5e9]' : 'bg-[#14391f] text-[#4ade80] border-[#22c55e]',
      dotColor: localSearch.isLocalLearned ? '#0ea5e9' : '#22c55e',
      detailedReason: localSearch.isLocalLearned
        ? L("Trouvé dans votre dictionnaire local auto-alimenté (« {target} »). Cliquez sur ⚡ pour l'appliquer.", { target: localSearch.match.target })
        : L("Une traduction officielle existe dans la Database SST (« {target} »). Cliquez sur ⚡ pour l'appliquer.", { target: localSearch.match.target }),
      suggestion: localSearch.match.target,
      score: 100,
      canQuickApply: true,
      isLocalLearned: localSearch.isLocalLearned,
    };
  }

  const trimmedSource = record.source.trim().toLowerCase();

  // Recherche rapide O(1) de correspondance 100% exacte
  const exactEntry = dictMap ? dictMap.get(trimmedSource) : dictionaries.find(
    (d) => d.source.trim().toLowerCase() === trimmedSource
  );

  if (exactEntry) {
    return {
      reason: 'SST_EXACT_AVAILABLE',
      shortLabel: 'SST 100% dispo',
      badgeClass: 'bg-[#14391f] text-[#4ade80] border-[#22c55e]',
      dotColor: '#22c55e',
      detailedReason: L("Une traduction officielle existe dans la Database SST (« {target} »). Cliquez sur ⚡ pour l'appliquer.", { target: exactEntry.target }),
      suggestion: exactEntry.target,
      score: 100,
      canQuickApply: true,
    };
  }

  // Recherche de correspondance partielle (Fuzzy match)
  // OPTIMISATION CRUCIALE : Pour les textes longs (> 120 caractères, ex: livres ou longs dialogues),
  // le fuzzy matching sur des dictionnaires généraux est inutile et bloque le processeur.
  let bestScore = record.fuzzyMatch || 0;
  let bestSuggestion = record.dictionaryMatch;

  if ((!bestSuggestion || bestScore < 70) && trimmedSource.length > 3 && trimmedSource.length <= 120) {
    const maxScan = Math.min(dictionaries.length, 100);
    for (let i = 0; i < maxScan; i++) {
      const d = dictionaries[i];
      if (Math.abs(d.source.length - record.source.length) > 30) continue;
      const score = calculateSimilarity(d.source, record.source);
      if (score > bestScore && score >= 70) {
        bestScore = score;
        bestSuggestion = d.target;
      }
    }
  }

  if (bestScore >= 70 && bestSuggestion) {
    return {
      reason: 'SST_FUZZY_AVAILABLE',
      shortLabel: `Fuzzy ${bestScore}%`,
      badgeClass: 'bg-[#3f2a0c] text-[#fde68a] border-[#f59e0b]',
      dotColor: '#f59e0b',
      detailedReason: L("Le dictionnaire contient une phrase proche ({bestScore}% de similarité). Non appliquée par défaut pour éviter les contresens. Cliquez sur ⚡ pour tester.", { bestScore }),
      suggestion: bestSuggestion,
      score: bestScore,
      canQuickApply: true,
    };
  }

  // 6. Aucun résultat dictionnaire -> Texte exclusif au mod (Inédit)
  return {
    reason: 'UNSEEN_MOD_TEXT',
    shortLabel: L("Inédit mod (0% SST)"),
    badgeClass: 'bg-[#1e1e1e] text-[#38bdf8] border-[#0369a1]',
    dotColor: '#0ea5e9',
    detailedReason: L("Ce texte est exclusif à ce mod (création originale de l'auteur). Absent de la Database SST de base. Traduction IA ou manuelle requise."),
    canQuickApply: false,
  };
}
