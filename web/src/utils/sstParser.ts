/**
 * Parser ultra-rapide, asynchrone et non-bloquant pour Dictionnaires SST et Mémoires mTRANSLATOR
 * Conçu spécifiquement pour ingérer des dizaines ou centaines de fichiers SST sans figer l'UI ("La page ne répond pas").
 *
 * Optimisations critiques :
 * 1. Tokenisation RegExp par regex rapide sans instanciation de parser XML lourd (DOMParser) qui gèle le thread principal.
 * 2. Découpage asynchrone par `yieldToMain()` (micro-tâches requestAnimationFrame/setTimeout) tous les N fichiers ou M lignes.
 * 3. Compte-rendu de progression en temps réel pour feedback visuel instantané.
 * 4. Déduplication par Map à clé normalisée pour un coût mémoire minimal.
 */

import { DictionaryEntry } from '../types';
import { L } from '../i18n/L';

export interface SSTParseResult {
  entries: DictionaryEntry[];
  game: string;
  filename: string;
  format: 'XML_SST' | 'TAB_TXT' | 'CSV' | 'JSON' | 'UNKNOWN';
  error?: string;
}

export interface BatchSSTProgress {
  processedFiles: number;
  totalFiles: number;
  currentFileName: string;
  entriesFoundSoFar: number;
  percentage: number;
}

export interface BatchSSTResult {
  allEntries: DictionaryEntry[];
  filesReport: Array<{
    filename: string;
    count: number;
    game: string;
    format: string;
  }>;
  totalEntries: number;
  newUniqueEntries: number;
  duplicateCount: number;
}

/**
 * Libère le thread principal pour permettre au navigateur de peindre le DOM
 * et traiter les événements de l'utilisateur sans déclencher "la page ne répond pas".
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Décodage express d'entités XML
 */
function fastUnescapeXml(text: string): string {
  if (!text || (!text.includes('&') && !text.includes('&#'))) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#13;&#10;/g, '\r\n')
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Détecte l'univers de jeu depuis le nom du fichier
 */
export function inferGameFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('fallout4') || lower.includes('fallout 4') || lower.includes('fo4')) {
    return 'Fallout 4';
  }
  if (lower.includes('starfield')) {
    return 'Starfield';
  }
  if (lower.includes('oblivion')) {
    return 'The Elder Scrolls IV: Oblivion';
  }
  if (lower.includes('enderal')) {
    return 'Enderal';
  }
  if (
    lower.includes('skyrim') ||
    lower.includes('tesv') ||
    lower.includes('dawnguard') ||
    lower.includes('dragonborn') ||
    lower.includes('hearthfires') ||
    lower.includes('update')
  ) {
    return 'Skyrim Special Edition';
  }
  return "Général / Importé";
}

/**
 * Extraction optimisée à haute vitesse pour les fichiers XML SST
 * Utilise un parseur par expressions régulières directes sans overhead DOMParser
 */
function parseFastXmlSST(content: string, filename: string, defaultGame: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  let detectedGame = defaultGame;

  // Détection de l'univers éventuel dans l'attribut XML
  const gameAttrMatch = content.match(/<SSTDictionary[^>]*game=["']([^"']+)["']/i);
  if (gameAttrMatch && gameAttrMatch[1]) {
    detectedGame = gameAttrMatch[1];
  }

  // Regex globale rapide capturant directement les balises source et dest dans chaque <entry>
  // Couvre <source>, <sSource>, <Source>, <dest>, <sDest>, <Dest>, <target>
  const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryRegex.exec(content)) !== null) {
    const body = entryMatch[1];

    const srcMatch = body.match(/<(?:source|sSource|Source)>([\s\S]*?)<\/(?:source|sSource|Source)>/i);
    const dstMatch = body.match(/<(?:dest|sDest|Dest|target|Target)>([\s\S]*?)<\/(?:dest|sDest|Dest|target|Target)>/i);

    if (srcMatch && dstMatch) {
      const rawSrc = fastUnescapeXml(srcMatch[1]).trim();
      const rawDst = fastUnescapeXml(dstMatch[1]).trim();

      if (rawSrc && rawDst) {
        entries.push({
          source: rawSrc,
          target: rawDst,
          game: detectedGame,
          context: filename,
        });
      }
    }
  }

  return entries;
}

/**
 * Extraction tabulée TXT / TSV Bethesda ultra-rapide
 */
function parseFastTabTxt(content: string, filename: string, defaultGame: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.charCodeAt(0) === 35 /* '#' */ || (line[0] === '/' && line[1] === '/')) continue;
    const tabIdx = line.indexOf('\t');
    if (tabIdx === -1) continue;

    const cols = line.split('\t');
    if (cols.length >= 2) {
      let src = '';
      let dst = '';
      if (cols.length >= 3 && (cols[0].startsWith('0x') || /^[0-9A-Fa-f]{8}$/.test(cols[0].trim()))) {
        src = cols[1].trim();
        dst = cols[2].trim();
      } else {
        src = cols[0].trim();
        dst = cols[1].trim();
      }

      if (src && dst) {
        entries.push({
          source: src,
          target: dst,
          game: defaultGame,
          context: filename,
        });
      }
    }
  }

  return entries;
}

/**
 * Extraction CSV rapide
 */
function parseFastCSV(content: string, filename: string, defaultGame: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const lines = content.split(/\r?\n/);
  const delimiter = content.includes(';') ? ';' : ',';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(delimiter).map((p) => p.replace(/^["']|["']$/g, '').trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      entries.push({
        source: parts[0],
        target: parts[1],
        game: defaultGame,
        context: filename,
      });
    }
  }

  return entries;
}

/**
 * Parse unitaire d'un contenu de fichier
 */
export function parseSSTFileContent(content: string, filename: string): SSTParseResult {
  const trimmed = content.trim();
  const defaultGame = inferGameFromFilename(filename);

  // 1. XML SST
  if (trimmed.startsWith('<?xml') || trimmed.includes('<SSTDictionary') || trimmed.includes('<entry>') || trimmed.includes('<entry ')) {
    const entries = parseFastXmlSST(trimmed, filename, defaultGame);
    if (entries.length > 0) {
      return {
        entries,
        game: entries[0]?.game || defaultGame,
        filename,
        format: 'XML_SST',
      };
    }
  }

  // 2. Format JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const entries: DictionaryEntry[] = [];
      const list = Array.isArray(parsed) ? parsed : (parsed.entries || parsed.records || parsed.dictionaries || []);
      if (Array.isArray(list) && list.length > 0) {
        list.forEach((item: any) => {
          const s = item.source || item.src || item.Original;
          const t = item.target || item.dest || item.dst || item.Translation;
          if (s && t) {
            entries.push({
              source: String(s).trim(),
              target: String(t).trim(),
              game: item.game || defaultGame,
              context: item.context || item.edid || filename,
            });
          }
        });
        if (entries.length > 0) {
          return { entries, game: defaultGame, filename, format: 'JSON' };
        }
      }
    } catch {}
  }

  // 3. Tabulé TXT
  const tabEntries = parseFastTabTxt(trimmed, filename, defaultGame);
  if (tabEntries.length > 0) {
    return {
      entries: tabEntries,
      game: defaultGame,
      filename,
      format: 'TAB_TXT',
    };
  }

  // 4. CSV
  const csvEntries = parseFastCSV(trimmed, filename, defaultGame);
  if (csvEntries.length > 0) {
    return {
      entries: csvEntries,
      game: defaultGame,
      filename,
      format: 'CSV',
    };
  }

  return {
    entries: [],
    game: defaultGame,
    filename,
    format: 'UNKNOWN',
    error: L("Format non reconnu."),
  };
}

/**
 * Traitement en lot non-bloquant de fichiers multiples avec rapport de progression
 * Découpe l'exécution via `yieldToMain()` pour garder l'UI à 60 FPS même avec des centaines de fichiers.
 */
export async function parseMultipleSSTFiles(
  files: File[],
  onProgress?: (progress: BatchSSTProgress) => void
): Promise<BatchSSTResult> {
  const filesReport: BatchSSTResult['filesReport'] = [];
  const seenMap = new Map<string, DictionaryEntry>();
  let totalEntriesCount = 0;
  let duplicateCount = 0;

  const totalFiles = files.length;

  for (let i = 0; i < totalFiles; i++) {
    const file = files[i];

    // Notification de progression
    if (onProgress) {
      onProgress({
        processedFiles: i,
        totalFiles,
        currentFileName: file.name,
        entriesFoundSoFar: seenMap.size,
        percentage: Math.round((i / totalFiles) * 100),
      });
    }

    // Libère le thread principal après chaque fichier pour éviter le message d'inactivité du navigateur
    await yieldToMain();

    try {
      const content = await file.text();
      const result = parseSSTFileContent(content, file.name);

      filesReport.push({
        filename: file.name,
        count: result.entries.length,
        game: result.game,
        format: result.format,
      });

      totalEntriesCount += result.entries.length;

      // Déduplication immédiate pour préserver la RAM
      for (let j = 0; j < result.entries.length; j++) {
        const entry = result.entries[j];
        const key = entry.source.trim().toLowerCase();
        if (seenMap.has(key)) {
          duplicateCount++;
        } else {
          seenMap.set(key, entry);
        }
      }
    } catch (err: any) {
      console.error(`Erreur lecture fichier ${file.name}:`, err);
      filesReport.push({
        filename: file.name,
        count: 0,
        game: 'Erreur',
        format: L("Échec de lecture"),
      });
    }
  }

  // Dernière notification 100%
  if (onProgress) {
    onProgress({
      processedFiles: totalFiles,
      totalFiles,
      currentFileName: 'Finalisation...',
      entriesFoundSoFar: seenMap.size,
      percentage: 100,
    });
  }

  await yieldToMain();

  const allEntries = Array.from(seenMap.values());

  return {
    allEntries,
    filesReport,
    totalEntries: totalEntriesCount,
    newUniqueEntries: allEntries.length,
    duplicateCount,
  };
}
