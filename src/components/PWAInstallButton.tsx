import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'navbar' | 'bottom-bar' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'navbar' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [guidePlatform, setGuidePlatform] = useState<'ios' | 'android'>('android');

  // Si ya se está ejecutando instalada como PWA (modo standalone), no hace falta mostrar el botón
  if (isInstalled) {
    return null;
  }

  const handleOpenPrompt = () => {
    if (isInstallable) {
      install();
    } else if (isIOS) {
      setGuidePlatform('ios');
      setShowGuide(true);
    } else {
      setGuidePlatform('android');
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpenPrompt}
        className={`pwa-install-btn ${variant}`}
        title="Instalar como App en este móvil o tablet"
      >
        <span className="pwa-install-icon">📲</span>
        <span className="pwa-install-label">Instalar App</span>
      </button>

      {/* Modal explicativo para instalación guiada */}
      {showGuide && (
        <div
          className="modal-overlay"
          style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowGuide(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: '440px', width: '92%', borderRadius: '16px', padding: '24px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  background: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  color: 'white',
                  flexShrink: 0
                }}
              >
                📲
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)' }}>
                  Instalar GO & train en tu dispositivo
                </h3>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Úsala a pantalla completa como una App nativa (sin barras de navegador)
                </span>
              </div>
            </div>

            {guidePlatform === 'ios' ? (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 12px 0' }}>
                  En <strong>Safari (iPhone / iPad)</strong>, puedes añadir la aplicación directamente a tu pantalla de inicio:
                </p>
                <div style={{ background: 'var(--hover-bg)', padding: '12px 14px', borderRadius: '10px', marginBottom: '12px' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>1.</strong> Pulsa el botón <strong>Compartir</strong> <span style={{ fontSize: '1.1rem' }}>⎙</span> o <span style={{ fontSize: '1.1rem' }}>⎋</span> (icono de cuadrado con flecha hacia arriba) en la barra de Safari.
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>2.</strong> Desplázate hacia abajo y selecciona <strong>«Añadir a la pantalla de inicio»</strong> ⊞.
                  </div>
                  <div>
                    <strong>3.</strong> Pulsa <strong>«Añadir»</strong> en la esquina superior derecha.
                  </div>
                </div>
                <p style={{ margin: '0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  ✨ Al pulsar el nuevo icono en tu pantalla de inicio, se abrirá a pantalla completa exactamente igual que una APK o app de la App Store.
                </p>
              </div>
            ) : (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 12px 0' }}>
                  En <strong>Chrome u otros navegadores Android / Tablet</strong>:
                </p>
                <div style={{ background: 'var(--hover-bg)', padding: '12px 14px', borderRadius: '10px', marginBottom: '12px' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>1.</strong> Pulsa el menú de <strong>tres puntos</strong> (⋮) arriba a la derecha en Chrome.
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>2.</strong> Toca en <strong>«Instalar aplicación»</strong> o <strong>«Añadir a la pantalla de inicio»</strong>.
                  </div>
                  <div>
                    <strong>3.</strong> Confirma pulsando <strong>«Instalar»</strong>.
                  </div>
                </div>
                <p style={{ margin: '0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  ✨ Se creará el acceso directo en el escritorio de tu tablet o móvil y funcionará como una APK nativa a pantalla completa.
                </p>
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn-modal-primary"
                onClick={() => setShowGuide(false)}
                style={{ padding: '8px 20px', borderRadius: '8px' }}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
