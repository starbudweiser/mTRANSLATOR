import React from 'react';
import { useI18n } from '../i18n/LanguageContext';

/** Nom de l'appli avec son « m » initial en jaune Socle (couleur du logo livre). */
export const AppName: React.FC = () => {
  const { t } = useI18n();
  const name = t('app.title');
  return (
    <>
      <span className="text-[#fbbf24]">{name.slice(0, 1)}</span>
      {name.slice(1)}
    </>
  );
};
