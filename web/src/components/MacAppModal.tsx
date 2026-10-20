import React, { useState } from 'react';
import { 
  X, 
  Download, 
  Terminal, 
  Copy, 
  Check, 
  Laptop, 
  Play, 
  Sparkles, 
  FolderArchive,
  ArrowRight,
  ShieldCheck,
  Globe
} from 'lucide-react';
import { triggerFileDownload } from '../utils/translatorUtils';

interface MacAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MacAppModal: React.FC<MacAppModalProps> = ({ isOpen, onClose }) => {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  // Téléchargement direct du script Python
  const handleDownloadPython = async () => {
    try {
      const response = await fetch('/mtranslator_macos.py');
      if (!response.ok) throw new Error('Fichier non trouvé');
      const text = await response.text();
      triggerFileDownload(text, 'mtranslator_macos.py', 'text/x-python;charset=utf-8');
    } catch (e) {
      alert("Téléchargement du fichier mtranslator_macos.py en cours...");
      window.open('/mtranslator_macos.py', '_blank');
    }
  };

  // Téléchargement du lanceur .command
  const handleDownloadLauncher = async () => {
    try {
      const response = await fetch('/mtranslator_macos.command');
      if (!response.ok) throw new Error('Fichier non trouvé');
      const text = await response.text();
      triggerFileDownload(text, 'mtranslator_macos.command', 'text/plain;charset=utf-8');
    } catch (e) {
      window.open('/mtranslator_macos.command', '_blank');
    }
  };

  // Téléchargement du lanceur Web .command
  const handleDownloadWebLauncher = async () => {
    try {
      const response = await fetch('/mtranslator_web.command');
      if (!response.ok) throw new Error('Fichier non trouvé');
      const text = await response.text();
      triggerFileDownload(text, 'mtranslator_web.command', 'text/plain;charset=utf-8');
    } catch (e) {
      window.open('/mtranslator_web.command', '_blank');
    }
  };

  // Téléchargement du script de compilation .app
  const handleDownloadBuildScript = async () => {
    try {
      const response = await fetch('/build_macos_app.sh');
      if (!response.ok) throw new Error('Fichier non trouvé');
      const text = await response.text();
      triggerFileDownload(text, 'build_macos_app.sh', 'text/x-sh;charset=utf-8');
    } catch (e) {
      window.open('/build_macos_app.sh', '_blank');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a1a] border border-[#333333] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* En-tête macOS */}
        <div className="bg-[#262626] px-5 py-3.5 border-b border-[#333333] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#0369a1] to-[#0369a1] flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Laptop className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#ffffff] flex items-center space-x-2">
                <span>mTRANSLATOR</span>
                <span className="px-2 py-0.5 text-[10px] bg-[#0369a1]/40 border border-[#0369a1] text-[#38bdf8] rounded-full font-mono">
                  Édition Mac
                </span>
              </h2>
              <p className="text-[11px] text-[#aaaaaa]">
                Téléchargez et exécutez mTRANSLATOR nativement sur votre environnement Apple macOS.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#aaaaaa] hover:text-[#ffffff] hover:bg-[#333333] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corps modal scrollable */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-[#dddddd] custom-scrollbar">
          
          {/* Bloc 1 : Téléchargement rapide des fichiers sources */}
          <div className="bg-[#222222] border border-[#333333] rounded-lg p-4">
            <h3 className="text-xs font-semibold text-[#38bdf8] uppercase tracking-wider mb-2 flex items-center space-x-2">
              <Download className="w-4 h-4" />
              <span>Fichiers prêts pour macOS</span>
            </h3>
            <p className="text-[#aaaaaa] text-[11px] mb-4">
              Tous les scripts incluent l'interface graphique native, le moteur d'importation de dictionnaires SST (XML) et le validateur de balises Bethesda ([pagebreak], Papyrus).
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={handleDownloadWebLauncher}
                className="flex flex-col items-center text-center p-3 bg-[#181818] hover:bg-[#2c2c2c] border border-[#444444] hover:border-[#38bdf8] rounded-lg transition-all group"
              >
                <Globe className="w-5 h-5 text-[#38bdf8] mb-1.5 group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-[#ffffff] text-[11px]">mtranslator_web.command</span>
                <span className="text-[10px] text-[#aaaaaa] mt-0.5">Lanceur Web Mac (1-clic)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadLauncher}
                className="flex flex-col items-center text-center p-3 bg-[#181818] hover:bg-[#2c2c2c] border border-[#444444] hover:border-[#22c55e] rounded-lg transition-all group"
              >
                <Play className="w-5 h-5 text-[#4ade80] mb-1.5 group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-[#ffffff] text-[11px]">mtranslator_macos.command</span>
                <span className="text-[10px] text-[#aaaaaa] mt-0.5">Lanceur Python (1-clic)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPython}
                className="flex flex-col items-center text-center p-3 bg-[#181818] hover:bg-[#2c2c2c] border border-[#444444] hover:border-[#f59e0b] rounded-lg transition-all group"
              >
                <Terminal className="w-5 h-5 text-[#fbbf24] mb-1.5 group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-[#ffffff] text-[11px]">mtranslator_macos.py</span>
                <span className="text-[10px] text-[#aaaaaa] mt-0.5">Code Python 3 autonome</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadBuildScript}
                className="flex flex-col items-center text-center p-3 bg-[#181818] hover:bg-[#2c2c2c] border border-[#444444] hover:border-[#0ea5e9] rounded-lg transition-all group"
              >
                <FolderArchive className="w-5 h-5 text-[#38bdf8] mb-1.5 group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-[#ffffff] text-[11px]">build_macos_app.sh</span>
                <span className="text-[10px] text-[#aaaaaa] mt-0.5">Compilateur .app natif</span>
              </button>
            </div>
          </div>

          {/* Méthode 1 : Lancement Version Web Universelle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#ffffff] flex items-center space-x-2">
                <span className="w-5 h-5 rounded-full bg-[#0369a1] text-white flex items-center justify-center text-[10px] font-bold">1</span>
                <span>Version Web Universelle (Interface Flat Fusion + Gemini)</span>
              </span>
              <span className="text-[11px] text-[#38bdf8] font-medium">Recommandé</span>
            </div>
            <div className="bg-[#181818] border border-[#333333] rounded-lg p-3 font-mono text-[11px] text-[#38bdf8] flex items-center justify-between">
              <code>./mtranslator_web.command  # ou: npm run dev</code>
              <button
                type="button"
                onClick={() => handleCopy('./mtranslator_web.command', 'cmd_web')}
                className="p-1.5 hover:bg-[#262626] rounded text-[#aaaaaa] hover:text-[#ffffff] transition-colors"
                title="Copier la commande"
              >
                {copiedCmd === 'cmd_web' ? <Check className="w-4 h-4 text-[#4ade80]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[10px] text-[#666666]">
              Ouvre automatiquement votre navigateur par défaut sur <span className="font-mono text-[#dddddd]">http://localhost:3000</span>.
            </div>
          </div>

          {/* Méthode 2 : Lancement direct Python */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#ffffff] flex items-center space-x-2">
                <span className="w-5 h-5 rounded-full bg-[#404040] text-white flex items-center justify-center text-[10px] font-bold">2</span>
                <span>Version Python Bureau (Tkinter classique)</span>
              </span>
              <span className="text-[11px] text-[#aaaaaa]">Python 3 standard</span>
            </div>
            <div className="bg-[#181818] border border-[#333333] rounded-lg p-3 font-mono text-[11px] text-[#dddddd] flex items-center justify-between">
              <code>python3 mtranslator_macos.py</code>
              <button
                type="button"
                onClick={() => handleCopy('python3 mtranslator_macos.py', 'cmd1')}
                className="p-1.5 hover:bg-[#262626] rounded text-[#aaaaaa] hover:text-[#ffffff] transition-colors"
                title="Copier la commande"
              >
                {copiedCmd === 'cmd1' ? <Check className="w-4 h-4 text-[#4ade80]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Méthode 3 : Compilation en vraie application .app */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#ffffff] flex items-center space-x-2">
                <span className="w-5 h-5 rounded-full bg-[#404040] text-white flex items-center justify-center text-[10px] font-bold">3</span>
                <span>Compiler en véritable application "mTRANSLATOR.app"</span>
              </span>
              <span className="text-[11px] text-[#4ade80] font-medium">Pour dossier /Applications</span>
            </div>
            <p className="text-[11px] text-[#aaaaaa]">
              Exécutez cette commande pour créer le paquet macOS autonome avec PyInstaller :
            </p>
            <div className="bg-[#181818] border border-[#333333] rounded-lg p-3 font-mono text-[11px] text-[#86efac] flex items-center justify-between">
              <code>pip3 install pyinstaller && ./build_macos_app.sh</code>
              <button
                type="button"
                onClick={() => handleCopy('pip3 install pyinstaller && ./build_macos_app.sh', 'cmd2')}
                className="p-1.5 hover:bg-[#262626] rounded text-[#aaaaaa] hover:text-[#ffffff] transition-colors"
                title="Copier la commande"
              >
                {copiedCmd === 'cmd2' ? <Check className="w-4 h-4 text-[#4ade80]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[10px] text-[#666666] italic">
              L'application générée sera disponible dans <span className="font-mono text-[#dddddd]">mTRANSLATOR.app</span> et peut être glissée directement dans vos Applications !
            </div>
          </div>

          {/* Méthode 3 : Installation instantanée dans le Dock Mac (Safari / Chrome) */}
          <div className="bg-[#0c3a52]/30 border border-[#0369a1]/60 rounded-lg p-3.5 space-y-2">
            <div className="flex items-center space-x-2 text-[#38bdf8] font-semibold text-xs">
              <Sparkles className="w-4 h-4 text-[#38bdf8]" />
              <span>Astuce macOS : Ajouter directement au Dock depuis le navigateur</span>
            </div>
            <p className="text-[11px] text-[#bae6fd] leading-relaxed">
              Vous pouvez également transformer cette interface web en véritable application macOS sans taper une seule ligne de code :
            </p>
            <ul className="text-[11px] text-[#38bdf8] list-disc list-inside space-y-1 pl-1">
              <li><strong>Dans Safari :</strong> Menu <span className="underline">Fichier</span> ➔ <span className="underline">Ajouter au Dock...</span></li>
              <li><strong>Dans Google Chrome / Edge :</strong> Cliquez sur l'icône <span className="underline">Installer</span> tout à droite de la barre d'adresses.</li>
            </ul>
          </div>

          {/* Garantie de compatibilité */}
          <div className="flex items-center space-x-2 text-[11px] text-[#4ade80] bg-[#14391f]/20 border border-[#22c55e]/40 rounded-lg p-2.5">
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            <span>Compatible avec macOS Ventura, Sonoma, Sequoia et processeurs Apple Silicon (M1/M2/M3/M4) ou Intel.</span>
          </div>

        </div>

        {/* Pied de page */}
        <div className="bg-[#262626] px-5 py-3 border-t border-[#333333] flex items-center justify-between">
          <span className="text-[10px] text-[#666666]">
            Version 2.4.0 • mTRANSLATOR
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#303030] hover:bg-[#404040] text-[#ffffff] rounded text-xs font-medium transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
