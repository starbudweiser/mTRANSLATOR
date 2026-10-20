/**
 * Définition des types pour mTRANSLATOR macOS
 * Modèle de données pour les chaînes de mods Bethesda, les dictionnaires SST et les filtres.
 */

export type RecordStatus = 
  | 'translated'   // Vert (#22c55e) : Traduit et validé
  | 'untranslated' // Rouge (#ef4444) : Non traduit
  | 'partial'      // Orange (#f59e0b) : En cours / modifié
  | 'identical'    // Bleu (#3b82f6) : Identique à l'original (ex: noms propres)
  | 'locked';      // Gris (#6b7280) : Verrouillé / ignoré

export interface ModRecord {
  id: string;
  formId: string;        // ex: 0001367C ou StringID
  edid: string;          // Editor ID (ex: Skyrim_DragonArmor_Desc)
  recordType: string;    // ex: WEAP, ARMO, BOOK, QUST, DIAL, INFO, MESG, MCM, GMST, PEX
  source: string;        // Texte Original VO (anglais)
  target: string;        // Texte Traduction VF (français)
  status: RecordStatus;
  modified: boolean;
  validated: boolean;
  tagWarnings?: string[]; // Erreurs de balises détectées (<Alias>, \n, %s)
  fuzzyMatch?: number;   // Score de correspondance avec le dictionnaire (ex: 100)
  dictionaryMatch?: string; // Traduction trouvée dans le dictionnaire
  notes?: string;
  field?: string;         // Champ du record (FULL, DESC…) lu par le cœur xtcore
  xtId?: number;         // Identifiant de la chaîne dans l'extraction xtcore
  locked?: boolean;      // Chaîne de script (VMAD) : masquée tant que le filtre « scripts » est inactif
}

export type GameEngine = 
  | 'Skyrim Special Edition' 
  | 'Fallout 4' 
  | 'Starfield' 
  | 'Skyrim Legendary Edition'
  | 'Enderal'
  | 'The Elder Scrolls IV: Oblivion';

export interface ModFileMeta {
  fileName: string;
  fileType: 'ESP' | 'ESM' | 'ESL' | 'STRINGS' | 'TXT' | 'SST' | 'JSON' | 'CSV';
  game: GameEngine;
  encoding: 'UTF-8' | 'Windows-1252' | 'ISO-8859-1';
  lastSaved?: string;
  author?: string;
  description?: string;
  version?: string;
}

export interface FilterOptions {
  status: 'all' | 'untranslated' | 'translated' | 'partial' | 'identical' | 'warnings';
  recordType: string;
  searchQuery: string;
  searchField: 'all' | 'source' | 'target' | 'formId' | 'edid';
  caseSensitive: boolean;
  useRegex: boolean;
  onlyWarnings: boolean;
  /** Affiche les chaînes de scripts (VMAD), masquées et verrouillées par défaut comme dans xTranslator. */
  showScripts?: boolean;
}

export interface DictionaryEntry {
  source: string;
  target: string;
  game: string;
  context?: string;
  lang?: string;        // Code de langue cible (ex: 'fr', 'en', 'de', 'es')
  sourceLang?: string;  // Code ou nom de la langue source (ex: 'en', 'English')
}

export interface TranslationStats {
  total: number;
  translated: number;
  untranslated: number;
  partial: number;
  identical: number;
  wordCountSource: number;
  wordCountTarget: number;
  warningsCount: number;
  percentage: number;
}

export interface BatchFileItem {
  id: string;
  name: string;
  size: number;
  extension: string;
  file?: File;
  status: 'pending' | 'parsing' | 'translating' | 'completed' | 'error';
  progress: number;
  recordsCount: number;
  translatedCount: number;
  error?: string;
  records?: ModRecord[];
  meta?: Partial<ModFileMeta>;
}

