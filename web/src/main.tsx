import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initUiZoom } from './utils/uiZoom';
import { LanguageProvider } from './i18n/LanguageContext';
import { startBrandHighlight } from './socle/brand_highlight.js';

initUiZoom();
// « m » de mTRANSLATOR en jaune, comme le logo et le splash, partout où le nom est écrit (règle Socle « Nom de l'appli »)
startBrandHighlight({ names: ['mTRANSLATOR'], color: '#fbbf24' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
