import React, { useEffect, useState } from 'react';
import { useUndo } from '../context/UndoContext';

export const ToastNotification: React.FC = () => {
  const { activeToast, closeToast } = useUndo();
  const [progressWidth, setProgressWidth] = useState(100);

  useEffect(() => {
    if (!activeToast) return;
    setProgressWidth(100);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / activeToast.durationMs) * 100);
      setProgressWidth(remaining);

      if (elapsed >= activeToast.durationMs) {
        clearInterval(interval);
        closeToast();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [activeToast, closeToast]);

  if (!activeToast) return null;

  return (
    <div className="undo-toast-container" style={{ position: 'fixed', bottom: 25, right: 25, zIndex: 9999 }}>
      <div className="undo-toast" style={{
        background: '#1e293b',
        color: '#ffffff',
        padding: '12px 18px',
        borderRadius: '8px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: '15px',
        position: 'relative',
        overflow: 'hidden',
        minWidth: '280px',
        maxWidth: '420px'
      }}>
        <div className="undo-toast-msg" style={{ flexGrow: 1, fontSize: '0.9rem', fontWeight: 500 }}>
          {activeToast.message}
        </div>
        <div className="undo-toast-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeToast.onUndo && (
            <button
              type="button"
              className="undo-toast-btn"
              onClick={async () => {
                const fn = activeToast.onUndo;
                closeToast();
                if (fn) await fn();
              }}
              style={{
                background: '#0d7488',
                color: '#ffffff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                lineHeight: 1.2
              }}
            >
              <span className="ui-icon">↩</span>
              <span>Deshacer</span>
            </button>
          )}
          <button
            type="button"
            className="undo-toast-close"
            onClick={closeToast}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '1.2rem',
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>
        {activeToast.onUndo && (
          <div
            className="undo-toast-progress"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: '3px',
              background: '#0d7488',
              width: `${progressWidth}%`,
              transition: 'width 0.05s linear'
            }}
          />
        )}
      </div>
    </div>
  );
};
