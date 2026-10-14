import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

const isStandalone = () => (
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true
);

const isIOS = () => (
  /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
  (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
);

export default function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [showIOSButton, setShowIOSButton] = useState(() => !isStandalone() && isIOS());

  useEffect(() => {
    if (isStandalone()) return undefined;

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setShowIOSButton(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) {
      setShowIOSInstructions(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstallPrompt(null);
    } catch (error) {
      console.error('Unable to show the app install prompt', error);
    }
  };

  if (!installPrompt && !showIOSButton) return null;

  return (
    <>
      <button
        type="button"
        onClick={installApp}
        className="fixed bottom-4 right-4 z-[70] flex items-center gap-2 rounded-full bg-teal-600 px-4 py-3 font-semibold text-white shadow-lg transition hover:bg-teal-500"
      >
        <Download size={18} />
        Add to Home Screen
      </button>
      {showIOSInstructions && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          role="presentation"
          onClick={() => setShowIOSInstructions(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-ios-title"
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="install-ios-title" className="text-lg font-bold">Add SV Smart Aide</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Tap Share in your browser, then choose “Add to Home Screen.”
            </p>
            <button
              type="button"
              onClick={() => setShowIOSInstructions(false)}
              className="mt-5 w-full rounded-xl bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-500"
            >
              Got it
            </button>
          </section>
        </div>
      )}
    </>
  );
}
