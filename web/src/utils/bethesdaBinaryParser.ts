/**
 * Parser universel de fichiers Bethesda pour mTRANSLATOR macOS
 * Supporte :
 * 1. Fichiers binaires .esp / .esm / .esl (Extraction des sous-champs FULL, DESC, NNAM, ONAM, RNAM, etc.)
 * 2. Fichiers binaires .strings / .dlstrings / .ilstrings (Table de FormID/StringID + offsets + strings null-terminated ou préfixées par longueur)
 * 3. Fichiers XML .sst (Dictionnaires mTRANSLATOR / SST)
 * 4. Fichiers texte MCM / Strings (.txt) avec tabulations
 * 5. Fichiers JSON et CSV
 */

import { ModRecord, ModFileMeta, GameEngine } from '../types';
import { L } from '../i18n/L';

export interface ParseResult {
  records: ModRecord[];
  meta: Partial<ModFileMeta>;
}

/**
 * Permet au moteur JavaScript de céder la main au navigateur pour garder l'UI fluide
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Décompression native asynchrone zlib / deflate pour les records compressés de Bethesda
 */
async function decompressZlibData(compressedBytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || compressedBytes.length === 0) {
    return null;
  }
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes as unknown as BufferSource);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    try {
      const dsRaw = new DecompressionStream('deflate-raw');
      const writer = dsRaw.writable.getWriter();
      writer.write(compressedBytes as unknown as BufferSource);
      writer.close();
      const buf = await new Response(dsRaw.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }
}

/**
 * Lecture rapide de 4 caractères ASCII sans allocations superflues
 */
function readAscii4(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

const utf8Decoder = new TextDecoder('utf-8');
const win1252Decoder = new TextDecoder('windows-1252', { fatal: false });

function decodeBethesdaString(bytes: Uint8Array, isLegacy: boolean = false): string {
  try {
    if (isLegacy) {
      return win1252Decoder.decode(bytes).replace(/\0+$/, '').trim();
    }
    const decoded = utf8Decoder.decode(bytes).replace(/\0+$/, '').trim();
    if (decoded.includes('\uFFFD')) {
      return win1252Decoder.decode(bytes).replace(/\0+$/, '').trim();
    }
    return decoded;
  } catch {
    return win1252Decoder.decode(bytes).replace(/\0+$/, '').trim();
  }
}

/**
 * Lit un fichier complet et extrait les chaînes selon l'extension et la signature binaire
 */
export async function parseModFile(
  file: File,
  currentGame: GameEngine,
  onProgress?: (percent: number, message: string) => void
): Promise<ParseResult> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  if (['esp', 'esm', 'esl'].includes(extension)) {
    onProgress?.(5, L("Lecture binaire de {name}...", { name: file.name }));
    const buffer = await file.arrayBuffer();
    return parsePluginBinary(buffer, file.name, currentGame, onProgress);
  }

  if (['strings', 'dlstrings', 'ilstrings'].includes(extension)) {
    onProgress?.(5, L("Lecture de la table de chaînes {name}...", { name: file.name }));
    const buffer = await file.arrayBuffer();
    return parseStringsBinary(buffer, file.name, extension, currentGame, onProgress);
  }

  // Pour les formats texte (TXT, SST, CSV, JSON)
  const text = await file.text();

  if (extension === 'sst' || text.includes('<SSTDictionary') || text.includes('<?xml')) {
    return parseSstXml(text, file.name, currentGame);
  }

  if (extension === 'json' || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      const json = JSON.parse(text);
      if (json.records && Array.isArray(json.records)) {
        return {
          records: json.records,
          meta: json.meta || { fileName: file.name, fileType: 'JSON', game: currentGame },
        };
      }
      if (Array.isArray(json)) {
        return {
          records: json,
          meta: { fileName: file.name, fileType: 'JSON', game: currentGame },
        };
      }
    } catch {
      // Si échec, on tente en texte tabulé
    }
  }

  if (extension === 'csv') {
    return parseCsv(text, file.name, currentGame);
  }

  // Par défaut : Fichier texte Bethesda (format mTRANSLATOR / MCM / Skyrim String table)
  return parseTextTable(text, file.name, currentGame);
}

/**
 * Extraction structurée et non bloquante des chaînes depuis un fichier binaire de plugin (.esp / .esm / .esl)
 * Parcourt les enregistrements GRUP et Records par sauts d'offsets sans jamais figer le navigateur.
 */
async function parsePluginBinary(
  buffer: ArrayBuffer,
  fileName: string,
  game: GameEngine,
  onProgress?: (percent: number, message: string) => void
): Promise<ParseResult> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const records: ModRecord[] = [];
  const isLegacy = game === 'Skyrim Legendary Edition' || game === 'The Elder Scrolls IV: Oblivion';
  const fileType = fileName.endsWith('.esm') ? 'ESM' : fileName.endsWith('.esl') ? 'ESL' : 'ESP';

  // Sous-enregistrements textuels fréquents dans les moteurs Bethesda
  const stringSubrecords = new Set([
    'FULL', // Nom d'affichage (Armes, Livres, Quêtes, Sorts, etc.)
    'DESC', // Description longue (Livres, Quêtes, Sorts, Messages, etc.)
    'NNAM', // Nom court / notification
    'ONAM', // Objectif de quête
    'RNAM', // Réponse de dialogue / invite
    'NAM1', // Dialogue / Sous-titre
    'CNAM', // Configuration / Contexte / Description
    'MESG', // Texte de boîte de message
    'ITXT', // Texte complet de livre / note (Skyrim Books)
    'DNAM', // Description / Nom d'affichage
    'FNAM', // Nom d'acteur / PNJ
    'TNAM', // Topic de dialogue
    'UNAM', // Texte d'aide / info utilisateur
    'SNAM', // Sous-titre sonore ou prompt
    'EPFT', // Description d'effet de Perk
    'WNAM', // Nom de région / météo
  ]);

  let lastYieldTime = performance.now();
  let offset = 0;
  const totalLength = bytes.length;

  // 1. Analyse du Header TES4 si présent
  let modAuthor = '';
  let modDescription = '';

  if (offset + 24 <= totalLength && readAscii4(bytes, 0) === 'TES4') {
    const tes4DataSize = view.getUint32(4, true);
    const tes4End = Math.min(offset + 24 + tes4DataSize, totalLength);
    let tes4SubOffset = 24;

    while (tes4SubOffset + 6 <= tes4End) {
      const subTag = readAscii4(bytes, tes4SubOffset);
      const subSize = view.getUint16(tes4SubOffset + 4, true);
      tes4SubOffset += 6;

      if (tes4SubOffset + subSize > tes4End) break;

      if (subTag === 'CNAM') {
        modAuthor = decodeBethesdaString(bytes.subarray(tes4SubOffset, tes4SubOffset + subSize), isLegacy);
      } else if (subTag === 'SNAM') {
        modDescription = decodeBethesdaString(bytes.subarray(tes4SubOffset, tes4SubOffset + subSize), isLegacy);
      }
      tes4SubOffset += subSize;
    }

    offset = tes4End;
  }

  // 2. Traitement récursif / itératif des GRUPs et Records par saut d'offsets
  // Fonction pour extraire les sous-enregistrements textuels d'un buffer de record
  const processSubrecords = (
    subBytes: Uint8Array,
    recType: string,
    formIdHex: string
  ) => {
    const subView = new DataView(subBytes.buffer, subBytes.byteOffset, subBytes.byteLength);
    let subOffset = 0;
    let currentEdid = '';
    let nextSubSizeOverride: number | null = null;

    while (subOffset + 6 <= subBytes.length) {
      const subTag = readAscii4(subBytes, subOffset);
      let subSize = subView.getUint16(subOffset + 4, true);

      if (nextSubSizeOverride !== null) {
        subSize = nextSubSizeOverride;
        nextSubSizeOverride = null;
      }

      subOffset += 6;

      if (subTag === 'XXXX') {
        // Tag Bethesda indiquant une taille de sous-enregistrement sur 32 bits (> 65535 octets)
        if (subOffset + 4 <= subBytes.length) {
          nextSubSizeOverride = subView.getUint32(subOffset, true);
          subOffset += 4;
        }
        continue;
      }

      if (subOffset + subSize > subBytes.length) break;

      if (subTag === 'EDID') {
        currentEdid = decodeBethesdaString(subBytes.subarray(subOffset, subOffset + subSize), isLegacy);
      } else if (stringSubrecords.has(subTag)) {
        const text = decodeBethesdaString(subBytes.subarray(subOffset, subOffset + subSize), isLegacy);
        // Filtrer les chaînes vides ou bruit binaire
        if (text.length > 0 && !/^[\x00-\x1F\x7F]+$/.test(text)) {
          const recCount = records.length + 1;
          records.push({
            id: `rec-${recCount}`,
            formId: formIdHex,
            edid: currentEdid || `ID_${recCount}`,
            recordType: recType,
            source: text,
            target: '',
            status: 'untranslated',
            modified: false,
            validated: false,
          });
        }
      }

      subOffset += subSize;
    }
  };

  // Traitement d'un bloc binaire (qui peut contenir des GRUPs ou des Records)
  async function parseBlock(startOffset: number, endOffset: number) {
    let curr = startOffset;

    while (curr + 24 <= endOffset) {
      // Céder la main à l'UI toutes les 15ms pour un chargement fluide
      const now = performance.now();
      if (now - lastYieldTime > 15) {
        const pct = Math.min(99, Math.round((curr / totalLength) * 100));
        onProgress?.(pct, L("Analyse du plugin binaire ({pct}%)... {toLocaleString} chaînes trouvées", { pct, toLocaleString: records.length.toLocaleString() }));
        await yieldToMain();
        lastYieldTime = performance.now();
      }

      const sig = readAscii4(bytes, curr);

      if (sig === 'GRUP') {
        const groupSize = view.getUint32(curr + 4, true);
        const groupEnd = Math.min(curr + groupSize, endOffset);

        if (groupSize >= 24 && groupEnd <= totalLength) {
          // Entrée dans le groupe
          await parseBlock(curr + 24, groupEnd);
          curr = groupEnd;
          continue;
        } else {
          // Si taille invalide, avancer
          curr += 24;
          continue;
        }
      }

      // C'est un Record Bethesda (BOOK, WEAP, ARMO, QUST, DIAL, INFO, MESG, etc.)
      const recType = sig;
      const recDataSize = view.getUint32(curr + 4, true);
      const recFlags = view.getUint32(curr + 8, true);
      const formIdNum = view.getUint32(curr + 12, true);
      const formIdHex = formIdNum.toString(16).toUpperCase().padStart(8, '0');

      const recDataStart = curr + 24;
      const recDataEnd = recDataStart + recDataSize;

      if (recDataEnd <= totalLength && recDataSize > 0) {
        const isCompressed = (recFlags & 0x00040000) !== 0;

        if (isCompressed && recDataSize > 4) {
          // Record compressé par Creation Engine (zlib)
          const compressedPayload = bytes.subarray(recDataStart + 4, recDataEnd);
          const decompressed = await decompressZlibData(compressedPayload);
          if (decompressed) {
            processSubrecords(decompressed, recType, formIdHex);
          }
        } else {
          // Record non compressé
          const recBytes = bytes.subarray(recDataStart, recDataEnd);
          processSubrecords(recBytes, recType, formIdHex);
        }

        // Saut direct à la fin du record sans passer octet par octet !
        curr = recDataEnd;
      } else {
        // En cas d'enregistrement atypique ou fin de flux
        curr += 24;
      }
    }
  }

  try {
    await parseBlock(offset, totalLength);
  } catch (err) {
    console.warn('Erreur lors du parcours structuré du plugin, tentative de récupération:', err);
  }

  // Si le parcours structuré a trouvé très peu de chaînes (par exemple format non-standard),
  // on utilise un scanner de secours non-bloquant
  if (records.length < 5) {
    onProgress?.(80, L("Scan de secours des chaînes textuelles du mod..."));
    const fallbackRecords = await extractPrintableStringsFromBinaryAsync(bytes, fileName, onProgress);
    if (fallbackRecords.length > records.length) {
      return {
        records: fallbackRecords,
        meta: {
          fileName,
          fileType,
          game,
          encoding: 'UTF-8',
          version: '1.0',
          author: modAuthor,
          description: modDescription,
        },
      };
    }
  }

  onProgress?.(100, L("Chargement terminé : {toLocaleString} enregistrements prêts", { toLocaleString: records.length.toLocaleString() }));

  return {
    records: records.length > 0 ? records : [
      {
        id: 'rec-1',
        formId: '00010001',
        edid: 'Mod_Header',
        recordType: 'TES4',
        source: fileName,
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
      }
    ],
    meta: {
      fileName,
      fileType,
      game,
      encoding: isLegacy ? 'Windows-1252' : 'UTF-8',
      version: '1.0',
      author: modAuthor,
      description: modDescription,
    },
  };
}

/**
 * Extraction asynchrone et non-bloquante depuis un fichier .strings / .dlstrings / .ilstrings de Bethesda
 */
async function parseStringsBinary(
  buffer: ArrayBuffer,
  fileName: string,
  ext: string,
  game: GameEngine,
  onProgress?: (percent: number, message: string) => void
): Promise<ParseResult> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const records: ModRecord[] = [];
  let lastYield = performance.now();

  try {
    const stringCount = view.getUint32(0, true);
    const decoder = new TextDecoder('utf-8');

    const directoryEntrySize = 8;
    const directorySize = stringCount * directoryEntrySize;
    const dataBlockStart = 8 + directorySize;

    if (stringCount > 0 && stringCount < 500000 && dataBlockStart < buffer.byteLength) {
      for (let i = 0; i < stringCount; i++) {
        if (performance.now() - lastYield > 15) {
          const pct = Math.round((i / stringCount) * 100);
          onProgress?.(pct, L("Lecture des chaînes .strings ({pct}%)...", { pct }));
          await yieldToMain();
          lastYield = performance.now();
        }

        const entryOffset = 8 + (i * 8);
        if (entryOffset + 8 > buffer.byteLength) break;

        const stringId = view.getUint32(entryOffset, true);
        const textOffset = view.getUint32(entryOffset + 4, true);
        const actualPos = dataBlockStart + textOffset;

        if (actualPos < buffer.byteLength) {
          let str = '';
          if (ext === 'dlstrings' || ext === 'ilstrings') {
            const len = view.getUint32(actualPos, true);
            const strBytes = bytes.subarray(actualPos + 4, actualPos + 4 + len);
            str = decoder.decode(strBytes).replace(/\0+$/, '');
          } else {
            let endPos = actualPos;
            while (endPos < buffer.byteLength && bytes[endPos] !== 0) {
              endPos++;
            }
            const strBytes = bytes.subarray(actualPos, endPos);
            str = decoder.decode(strBytes);
          }

          if (str.trim()) {
            records.push({
              id: `str-${i + 1}`,
              formId: stringId.toString(16).toUpperCase().padStart(8, '0'),
              edid: `StringID_${stringId}`,
              recordType: ext.toUpperCase(),
              source: str,
              target: '',
              status: 'untranslated',
              modified: false,
              validated: false,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('Erreur lecture format binaire .strings, passage au scanner brut:', err);
  }

  if (records.length === 0) {
    const fallback = await extractPrintableStringsFromBinaryAsync(bytes, fileName, onProgress);
    return {
      records: fallback,
      meta: { fileName, fileType: 'STRINGS', game, encoding: 'UTF-8' },
    };
  }

  return {
    records,
    meta: {
      fileName,
      fileType: 'STRINGS',
      game,
      encoding: 'UTF-8',
      version: '1.0',
    },
  };
}

/**
 * Scanner de secours non-bloquant pour récupérer les séquences textuelles UTF-8 dans un binaire
 */
async function extractPrintableStringsFromBinaryAsync(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: (percent: number, message: string) => void
): Promise<ModRecord[]> {
  const records: ModRecord[] = [];
  const decoder = new TextDecoder('utf-8');
  let start = -1;
  let lastYield = performance.now();

  for (let i = 0; i < bytes.length; i++) {
    if (i % 20000 === 0 && performance.now() - lastYield > 15) {
      const pct = Math.round((i / bytes.length) * 100);
      onProgress?.(pct, L("Recherche de textes ({pct}%)...", { pct }));
      await yieldToMain();
      lastYield = performance.now();
    }

    const b = bytes[i];
    const isPrintable = (b >= 32 && b <= 126) || (b >= 160 && b <= 255) || b === 9 || b === 10 || b === 13;

    if (isPrintable) {
      if (start === -1) start = i;
    } else {
      if (start !== -1) {
        const length = i - start;
        if (length >= 4 && length < 10000) {
          const slice = bytes.subarray(start, i);
          const str = decoder.decode(slice).trim();
          if (str.length >= 3 && /[a-zA-ZÀ-ÿ]{2,}/.test(str) && !/^[0-9A-Z_]{3,4}$/.test(str)) {
            const count = records.length + 1;
            records.push({
              id: `str-scan-${count}`,
              formId: (0x00010000 + count).toString(16).toUpperCase().padStart(8, '0'),
              edid: `Extracted_${count}`,
              recordType: 'STRG',
              source: str,
              target: '',
              status: 'untranslated',
              modified: false,
              validated: false,
            });
          }
        }
        start = -1;
      }
    }
    if (records.length >= 5000) break;
  }

  return records;
}

/**
 * Parser de fichier SST XML (mTRANSLATOR / SST)
 */
function parseSstXml(xmlContent: string, fileName: string, fallbackGame: GameEngine): ParseResult {
  const records: ModRecord[] = [];
  let detectedGame: GameEngine = fallbackGame;

  // Détection du jeu dans l'attribut game="..."
  const gameMatch = xmlContent.match(/game=["']([^"']+)["']/i);
  if (gameMatch && gameMatch[1]) {
    const g = gameMatch[1].toLowerCase();
    if (g.includes('skyrim') || g.includes('sse')) detectedGame = 'Skyrim Special Edition';
    else if (g.includes('fallout')) detectedGame = 'Fallout 4';
    else if (g.includes('starfield')) detectedGame = 'Starfield';
  }

  // Extraction par Regex des balises <entry...> ... <source>...</source> <dest>...</dest> </entry>
  const entryRegex = /<entry([^>]*)>([\s\S]*?)<\/entry>/gi;
  let match;
  let counter = 0;

  while ((match = entryRegex.exec(xmlContent)) !== null) {
    counter++;
    const attrs = match[1];
    const body = match[2];

    const formIdMatch = attrs.match(/formid=["']([^"']+)["']/i);
    const edidMatch = attrs.match(/edid=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/i);

    const sourceMatch = body.match(/<source>([\s\S]*?)<\/source>/i);
    const destMatch = body.match(/<dest>([\s\S]*?)<\/dest>/i);

    const source = sourceMatch ? unescapeXml(sourceMatch[1].trim()) : '';
    const target = destMatch ? unescapeXml(destMatch[1].trim()) : '';

    if (source) {
      records.push({
        id: `sst-${counter}`,
        formId: formIdMatch ? formIdMatch[1] : counter.toString(16).toUpperCase().padStart(8, '0'),
        edid: edidMatch ? edidMatch[1] : `Record_${counter}`,
        recordType: typeMatch ? typeMatch[1] : 'SST',
        source,
        target,
        status: target ? 'translated' : 'untranslated',
        modified: false,
        validated: Boolean(target),
      });
    }
  }

  return {
    records,
    meta: {
      fileName,
      fileType: 'SST',
      game: detectedGame,
      encoding: 'UTF-8',
      version: '1.0',
    },
  };
}

/**
 * Parser de fichier texte tabulé (MCM, chaînes de localisation mTRANSLATOR)
 */
function parseTextTable(text: string, fileName: string, game: GameEngine): ParseResult {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const records: ModRecord[] = [];

  lines.forEach((line, index) => {
    // Formats acceptés :
    // FormID \t Source \t Target
    // FormID \t Target (si fichier de strings traduits)
    // Source \t Target
    const parts = line.split('\t');
    const counter = index + 1;

    if (parts.length >= 3) {
      const formId = parts[0].trim();
      const source = parts[1].trim();
      const target = parts[2].trim();
      records.push({
        id: `txt-${counter}`,
        formId: formId.length <= 8 ? formId : `000${counter.toString(16).toUpperCase()}`,
        edid: `Text_${counter}`,
        recordType: 'MCM',
        source,
        target,
        status: target ? 'translated' : 'untranslated',
        modified: false,
        validated: Boolean(target),
      });
    } else if (parts.length === 2) {
      const p0 = parts[0].trim();
      const p1 = parts[1].trim();

      // Si le premier champ ressemble à un FormID ou StringID (ex: $MOD_OPTION, 00012345, 1024)
      const isIdentifier = /^(0x[0-9a-fA-F]+|[0-9a-fA-F]{6,8}|\$[a-zA-Z0-9_]+|[0-9]{1,7})$/.test(p0);

      if (isIdentifier) {
        records.push({
          id: `txt-${counter}`,
          formId: p0.startsWith('$') ? '' : p0,
          edid: p0.startsWith('$') ? p0 : `ID_${p0}`,
          recordType: p0.startsWith('$') ? 'MCM' : 'STRG',
          source: p1,
          target: '',
          status: 'untranslated',
          modified: false,
          validated: false,
        });
      } else {
        // Paire Source \t Cible
        records.push({
          id: `txt-${counter}`,
          formId: (0x00010000 + counter).toString(16).toUpperCase().padStart(8, '0'),
          edid: `Line_${counter}`,
          recordType: 'TXT',
          source: p0,
          target: p1,
          status: p1 ? 'translated' : 'untranslated',
          modified: false,
          validated: Boolean(p1),
        });
      }
    } else if (line.trim().length > 0) {
      // Ligne unique de texte brut
      records.push({
        id: `txt-${counter}`,
        formId: (0x00010000 + counter).toString(16).toUpperCase().padStart(8, '0'),
        edid: `Line_${counter}`,
        recordType: 'LINE',
        source: line.trim(),
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
      });
    }
  });

  return {
    records,
    meta: {
      fileName,
      fileType: 'TXT',
      game,
      encoding: 'UTF-8',
      version: '1.0',
    },
  };
}

/**
 * Parser de fichier CSV
 */
function parseCsv(text: string, fileName: string, game: GameEngine): ParseResult {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const records: ModRecord[] = [];

  // Ignore l'en-tête s'il contient 'source' ou 'formid'
  const startIndex = lines[0]?.toLowerCase().includes('source') ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    // Regex pour parser le CSV en respectant les guillemets
    const regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^",]*))/g;
    const cols: string[] = [];
    let m;
    while ((m = regex.exec(lines[i])) !== null) {
      cols.push((m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2] || '').trim());
    }

    if (cols.length >= 2) {
      const counter = i;
      records.push({
        id: `csv-${counter}`,
        formId: cols[0] || (0x00010000 + counter).toString(16).toUpperCase().padStart(8, '0'),
        edid: cols[1] || `CSV_${counter}`,
        recordType: cols[2] || 'CSV',
        source: cols[4] || cols[0],
        target: cols[5] || cols[1] || '',
        status: (cols[5] || cols[1]) ? 'translated' : 'untranslated',
        modified: false,
        validated: Boolean(cols[5] || cols[1]),
      });
    }
  }

  return {
    records,
    meta: {
      fileName,
      fileType: 'CSV',
      game,
      encoding: 'UTF-8',
      version: '1.0',
    },
  };
}

function unescapeXml(safe: string): string {
  return safe
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
