import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { FirestoreOp, UndoStep, ejecutarOperacionesFirestore } from '../services/undoService';

interface UndoToast {
  id: string;
  message: string;
  onUndo?: () => Promise<void>;
  durationMs: number;
}

interface UndoContextType {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  pushAction: (params: {
    label: string;
    undoOps: FirestoreOp[];
    redoOps: FirestoreOp[];
    showToast?: boolean;
    toastMessage?: string;
  }) => void;
  showToast: (message: string, onUndo?: () => Promise<void>, durationMs?: number) => void;
  activeToast: UndoToast | null;
  closeToast: () => void;
  onStateChangedListeners: Set<() => void>;
  registerChangeListener: (fn: () => void) => () => void;
}

const UndoContext = createContext<UndoContextType>({} as UndoContextType);

const MAX_STEPS = 15;

export const UndoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);
  const [redoStack, setRedoStack] = useState<UndoStep[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [activeToast, setActiveToast] = useState<UndoToast | null>(null);
  const [listeners] = useState<Set<() => void>>(new Set());

  const registerChangeListener = useCallback((fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [listeners]);

  const notifyChange = useCallback(() => {
    listeners.forEach(fn => {
      try { fn(); } catch (e) { }
    });
  }, [listeners]);

  const closeToast = useCallback(() => {
    setActiveToast(null);
  }, []);

  const showToast = useCallback((message: string, onUndo?: () => Promise<void>, durationMs = 7000) => {
    const id = Date.now().toString();
    setActiveToast({ id, message, onUndo, durationMs });
  }, []);

  const undo = useCallback(async () => {
    if (isBusy || undoStack.length === 0) return;
    setIsBusy(true);

    const step = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);

    try {
      await ejecutarOperacionesFirestore(step.undoOps);
      setUndoStack(newUndoStack);
      setRedoStack(prev => [...prev.slice(-(MAX_STEPS - 1)), step]);
      showToast(`↩ Deshecho: ${step.label}`, undefined, 3000);
      notifyChange();
    } catch (err: any) {
      console.error("Error al deshacer:", err);
      showToast(`Error al deshacer: ${err?.message || 'Error desconocido'}`, undefined, 4000);
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, undoStack, showToast, notifyChange]);

  const redo = useCallback(async () => {
    if (isBusy || redoStack.length === 0) return;
    setIsBusy(true);

    const step = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);

    try {
      await ejecutarOperacionesFirestore(step.redoOps);
      setRedoStack(newRedoStack);
      setUndoStack(prev => [...prev.slice(-(MAX_STEPS - 1)), step]);
      showToast(`↪ Rehecho: ${step.label}`, undefined, 3000);
      notifyChange();
    } catch (err: any) {
      console.error("Error al rehacer:", err);
      showToast(`Error al rehacer: ${err?.message || 'Error desconocido'}`, undefined, 4000);
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, redoStack, showToast, notifyChange]);

  const pushAction = useCallback(({
    label,
    undoOps,
    redoOps,
    showToast: launchToast = false,
    toastMessage
  }: {
    label: string;
    undoOps: FirestoreOp[];
    redoOps: FirestoreOp[];
    showToast?: boolean;
    toastMessage?: string;
  }) => {
    const entry: UndoStep = {
      label: label || 'Cambio',
      undoOps,
      redoOps,
      timestamp: Date.now()
    };

    setUndoStack(prev => [...prev.slice(-(MAX_STEPS - 1)), entry]);
    setRedoStack([]);

    if (launchToast) {
      showToast(toastMessage || `✓ ${entry.label}`, async () => {
        await ejecutarOperacionesFirestore(entry.undoOps);
        setUndoStack(prev => prev.slice(0, -1));
        setRedoStack(prev => [...prev.slice(-(MAX_STEPS - 1)), entry]);
        notifyChange();
      });
    }
  }, [showToast, notifyChange]);

  // Global Ctrl+Z / Ctrl+Y keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (!isCtrlOrCmd) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return (
    <UndoContext.Provider
      value={{
        canUndo: undoStack.length > 0 && !isBusy,
        canRedo: redoStack.length > 0 && !isBusy,
        undoCount: undoStack.length,
        undo,
        redo,
        pushAction,
        showToast,
        activeToast,
        closeToast,
        onStateChangedListeners: listeners,
        registerChangeListener
      }}
    >
      {children}
    </UndoContext.Provider>
  );
};

export const useUndo = () => useContext(UndoContext);
