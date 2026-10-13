/**
 * Dictionnaires SST et mémoires de traduction pour mTRANSLATOR macOS
 * 
 * PAR DÉFAUT : Version vierge de tout dictionnaire (0 entrée).
 * Les dictionnaires de test (DEV_TEST_DICTIONARIES) ne concernent que le développement et les tests.
 */

import { DictionaryEntry } from '../types';

/**
 * Dictionnaire Vanilla de base vierge par défaut à la compilation
 */
export const VANILLA_DICTIONARY: DictionaryEntry[] = [];

/**
 * Dictionnaires de test réservés à la version de développement (chargement explicite)
 */
export const DEV_TEST_DICTIONARIES: DictionaryEntry[] = [
  // Skyrim SE
  {
    source: 'The winds around Wyrmstooth Island are cursed. No normal boat can cross without magical warding.',
    target: 'Les vents autour de l\'île de Croc-de-Wyrm sont maudits. Aucun bateau ordinaire ne peut traverser sans protection magique.',
    game: 'Skyrim Special Edition',
    context: 'Dialogue maritime',
    lang: 'fr',
  },
  {
    source: 'Hold on tight, <Alias=Player>! We are approaching the volcanic ridge.',
    target: 'Accrochez-vous bien, <Alias=Player> ! Nous approchons de la crête volcanique.',
    game: 'Skyrim Special Edition',
    context: 'Dialogue traversée',
    lang: 'fr',
  },
  {
    source: 'You should have stayed in the warm taverns of the south!',
    target: 'Vous auriez dû rester au chaud dans les auberges du sud !',
    game: 'Skyrim Special Edition',
    context: 'Combat taunt',
    lang: 'fr',
  },
  {
    source: 'Iron Sword',
    target: 'Épée de fer',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Steel War Axe',
    target: 'Hache d\'armes d\'acier',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Health',
    target: 'Santé',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Magicka',
    target: 'Magie',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Stamina',
    target: 'Vigueur',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Dragonborn',
    target: 'Enfant de dragon',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Whiterun',
    target: 'Blancherive',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Solitude',
    target: 'Solitude',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Riften',
    target: 'Faillaise',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },
  {
    source: 'Windhelm',
    target: 'Vendeaume',
    game: 'Skyrim Special Edition',
    lang: 'fr',
  },

  // Fallout 4
  {
    source: 'Tune your Pip-Boy radio to frequency 88.4 to establish contact with Jake.',
    target: 'Réglez la radio de votre Pip-Boy sur la fréquence 88.4 pour établir le contact avec Jake.',
    game: 'Fallout 4',
    context: 'Quête radio SS2',
    lang: 'fr',
  },
  {
    source: 'Look around you, kid. What do you see? A wasteland, or the foundation of a new nation?',
    target: 'Regarde autour de toi, l\'ami. Que vois-tu ? Des terres désolées, ou les fondations d\'une nouvelle nation ?',
    game: 'Fallout 4',
    context: 'Dialogue Jake',
    lang: 'fr',
  },
  {
    source: 'Stimpack',
    target: 'Stimpack',
    game: 'Fallout 4',
    lang: 'fr',
  },
  {
    source: 'Fusion Core',
    target: 'Réacteur à fusion',
    game: 'Fallout 4',
    lang: 'fr',
  },
  {
    source: 'Bottlecap',
    target: 'Capsule',
    game: 'Fallout 4',
    lang: 'fr',
  },
  {
    source: 'Power Armor Station',
    target: 'Poste d\'armure assistée',
    game: 'Fallout 4',
    lang: 'fr',
  },

  // Starfield
  {
    source: 'When I touch the artifact, the celestial music feels almost like a memory rather than an echo.',
    target: 'Quand je touche l\'artefact, cette musique céleste ressemble davantage à un souvenir qu\'à un écho.',
    game: 'Starfield',
    context: 'Dialogue Sarah Morgan',
    lang: 'fr',
  },
  {
    source: 'Grav Jump',
    target: 'Saut gravitationnel',
    game: 'Starfield',
    lang: 'fr',
  },
  {
    source: 'Starborn',
    target: 'Astral',
    game: 'Starfield',
    lang: 'fr',
  },
  {
    source: 'Lodge',
    target: 'La Loge',
    game: 'Starfield',
    lang: 'fr',
  },
];
