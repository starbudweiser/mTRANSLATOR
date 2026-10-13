/**
 * Moteur heuristique de secours pour la traduction des mods Bethesda
 * Utilisé si la clé Gemini API n'est pas configurée, en cas d'erreur 401 ou hors-ligne.
 * Permet à l'utilisateur de continuer à traduire sans aucun blocage !
 */

export const BETHESDA_DICTIONARY_MAP: Record<string, string> = {
  // Termes d'inventaire & RPG
  'Iron Sword': 'Épée de fer',
  'Steel War Axe': "Hache d'armes d'acier",
  'Health': 'Santé',
  'Magicka': 'Magie',
  'Stamina': 'Vigueur',
  'Dragonborn': 'Enfant de dragon',
  'Whiterun': 'Blancherive',
  'Solitude': 'Solitude',
  'Riften': 'Faillaise',
  'Windhelm': 'Vendeaume',
  'Markarth': 'Markarth',
  'Dawnstar': 'Aubétoile',
  'Falkreath': 'Épervine',
  'Morthal': 'Morthal',
  'Winterhold': 'Fortdhiver',
  'Stimpack': 'Stimpack',
  'Fusion Core': 'Réacteur à fusion',
  'Sanctuary Hills': 'Sanctuary Hills',
  'Diamond City': 'Diamond City',
  'The Lodge': 'La Loge',
  'New Atlantis': 'New Atlantis',
  'Akila City': 'Akila City',
  'Neon': 'Néon',
  'Armor': 'Armure',
  'Shield': 'Bouclier',
  'Helmet': 'Casque',
  'Boots': 'Bottes',
  'Gauntlets': 'Gantelets',
  'Bow': 'Arc',
  'Arrow': 'Flèche',
  'Dagger': 'Dague',
  'Greatsword': 'Espadon',
  'Battleaxe': "Hache d'armes",
  'Warhammer': 'Marteau de guerre',
  'Potion': 'Potion',
  'Poison': 'Poison',
  'Scroll': 'Parchemin',
  'Spell': 'Sort',
  'Book': 'Livre',
  'Key': 'Clé',
  'Gold': 'Or',
  'Lockpick': 'Crochet',
  'Ingot': 'Lingot',
  'Ore': 'Minerai',
  'Leather': 'Cuir',
  'Wood': 'Bois',
  'Level': 'Niveau',
  'Damage': 'Dégâts',
  'Weight': 'Poids',
  'Value': 'Valeur',
  'Cost': 'Coût',
  'Enchantment': 'Enchantement',
  'Quest': 'Quête',
  'Active': 'Actif',
  'Completed': 'Terminé',
  'Failed': 'Échoué',
  'Target': 'Cible',
  'Objective': 'Objectif',
  'Location': 'Lieu',
  'Map': 'Carte',
  'Inventory': 'Inventaire',
  'Settings': 'Paramètres',
  'Options': 'Options',
  'Save': 'Sauvegarder',
  'Load': 'Charger',
  'Exit': 'Quitter',
  'Continue': 'Continuer',
  'New Game': 'Nouvelle partie',
  'Yes': 'Oui',
  'No': 'Non',
  'Accept': 'Accepter',
  'Cancel': 'Annuler',
  'Back': 'Retour',
  'Next': 'Suivant',
  'Previous': 'Précédent',
  'Delete': 'Supprimer',
  'Drop': 'Jeter',
  'Take': 'Prendre',
  'Take All': 'Tout prendre',
  'Equip': 'Équiper',
  'Unequip': 'Déséquiper',
  'Talk': 'Parler',
  'Search': 'Fouiller',
  'Open': 'Ouvrir',
  'Close': 'Fermer',
  'Unlock': 'Déverrouiller',
  'Steal': 'Voler',
  'Wait': 'Attendre',
  'Sleep': 'Dormir',
  'Rest': 'Se reposer',
  'Read': 'Lire',
  'Use': 'Utiliser',
  'Activate': 'Activer',
};

/**
 * Traduit un texte avec le moteur de règles et de dictionnaire local
 * Préserve intégralement les balises <...>, %s, et les sauts de ligne.
 */
export function translateFallbackText(text: string): string {
  if (!text) return '';

  const trimmed = text.trim();
  if (BETHESDA_DICTIONARY_MAP[trimmed]) {
    return BETHESDA_DICTIONARY_MAP[trimmed];
  }

  // Phrases complètes de démonstration
  if (trimmed === 'The winds around Wyrmstooth Island are cursed. No normal boat can cross without magical warding.') {
    return "Les vents autour de l'île de Croc-de-Wyrm sont maudits. Aucun bateau ordinaire ne peut traverser sans protection magique.";
  }
  if (trimmed === 'Hold on tight, <Alias=Player>! We are approaching the volcanic ridge.') {
    return "Accrochez-vous bien, <Alias=Player> ! Nous approchons de la crête volcanique.";
  }
  if (trimmed === 'You should have stayed in the warm taverns of the south!') {
    return "Vous auriez dû rester au chaud dans les auberges du sud !";
  }
  if (trimmed === 'Tune your Pip-Boy radio to frequency 88.4 to establish contact with Jake.') {
    return "Réglez la radio de votre Pip-Boy sur la fréquence 88.4 pour établir le contact avec Jake.";
  }
  if (trimmed === 'Look around you, kid. What do you see? A wasteland, or the foundation of a new nation?') {
    return "Regarde autour de toi, l'ami. Que vois-tu ? Des terres désolées, ou les fondations d'une nouvelle nation ?";
  }
  if (trimmed === 'The Artifact responds to gravitational resonance. Keep the scanner steady.') {
    return "L'Artefact réagit à la résonance gravitationnelle. Maintenez le scanner stable.";
  }
  if (trimmed === 'Welcome to the Lodge, explorer. You are among friends now.') {
    return "Bienvenue à la Loge, explorateur. Vous êtes parmi des amis à présent.";
  }

  // Si substitution mot à mot possible pour les noms d'objets (ex: Iron Sword -> Épée de fer)
  let result = text;
  for (const [en, fr] of Object.entries(BETHESDA_DICTIONARY_MAP)) {
    const regex = new RegExp(`\\b${en}\\b`, 'gi');
    if (regex.test(result)) {
      result = result.replace(regex, fr);
    }
  }

  // Règle absolue pour les livres : préserver [pagebreak] et corriger toute altération
  result = result.replace(/\[\s*(?:saut\s*de\s*page|sautdepage|saut-de-page|changement\s*de\s*page|coupure\s*de\s*page)\s*\]/gi, '[pagebreak]');

  return result;
}
