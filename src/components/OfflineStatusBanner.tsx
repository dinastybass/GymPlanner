import React, { useEffect, useState } from 'react';
import {
  getOfflineSyncStatus,
  OfflineSyncStatus,
  sincronizarCambiosPendientesAhora,
  subscribeOfflineSyncStatus
} from '../services/offlineSyncService';

export const OfflineStatusBanner: React.FC = () => {
  const [status, setStatus] = useState<OfflineSyncStatus>(() => getOfflineSyncStatus());

  useEffect(() => {
    return subscribeOfflineSyncStatus(next => {
      setStatus(next);
    });
  }, []);

  const { isOnline, pendingCount, isSyncing, justSynced } = status;

  // Cuando hay conexión normal y no hay cambios pendientes ni recién sincronizados, no mostrar nada
  if (isOnline && !isSyncing && pendingCount === 0 && !justSynced) {
    return null;
  }

  if (!isOnline) {
    return (
      <div className="offline-top-banner offline-mode" role="status" aria-live="polite">
        <div className="offline-banner-inner">
          <span className="offline-banner-text">
            📡 Sin conexión · Guardando cambios en el dispositivo
          </span>
          {pendingCount > 0 && (
            <span className="offline-pending-counter">
              {pendingCount} {pendingCount === 1 ? 'cambio pendiente' : 'cambios pendientes'}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (isSyncing || pendingCount > 0) {
    return (
      <div
        className="offline-top-banner syncing-mode"
        role="status"
        aria-live="polite"
        onClick={() => sincronizarCambiosPendientesAhora()}
        title="Haz clic para forzar la sincronización ahora"
        style={{ cursor: 'pointer' }}
      >
        <div className="offline-banner-inner">
          <span className="offline-banner-text">
            🔄 Sincronizando cambios con la nube...
          </span>
          {pendingCount > 0 && (
            <span className="offline-pending-counter">
              {pendingCount} {pendingCount === 1 ? 'pendiente' : 'pendientes'}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (justSynced) {
    return (
      <div className="offline-top-banner synced-mode" role="status" aria-live="polite">
        <div className="offline-banner-inner">
          <span className="offline-banner-text">✓ Cambios sincronizados</span>
        </div>
      </div>
    );
  }

  return null;
};
