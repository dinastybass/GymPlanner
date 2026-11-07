import { db } from '../firebase';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { confirmarDialogo } from '../utils/confirmDialog';

export interface FirestoreOp {
  type: 'set' | 'update' | 'delete';
  collection: string;
  id: string;
  data?: any;
  merge?: boolean;
}

export interface UndoStep {
  label: string;
  undoOps: FirestoreOp[];
  redoOps: FirestoreOp[];
  timestamp: number;
}

export async function ejecutarOperacionesFirestore(ops: FirestoreOp[] = []): Promise<void> {
  if (!Array.isArray(ops) || ops.length === 0) return;

  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(op => {
      if (!op || !op.collection || !op.id) return;
      const ref = doc(db, op.collection, op.id);
      if (op.type === 'delete') {
        batch.delete(ref);
      } else if (op.type === 'update') {
        batch.set(ref, op.data || {}, { merge: true });
      } else if (op.type === 'set') {
        if (op.merge) {
          batch.set(ref, op.data || {}, { merge: true });
        } else {
          batch.set(ref, op.data || {});
        }
      }
    });

    await batch.commit();
  }
}

export async function eliminarDocumentoConDeshacer({
  coleccion,
  id,
  nombreElemento = 'Elemento',
  confirmar = true,
  mensajeConfirmacion = '¿Seguro que deseas eliminar este elemento?',
  onAfterChange,
  pushUndoAction
}: {
  coleccion: string;
  id: string;
  nombreElemento?: string;
  confirmar?: boolean;
  mensajeConfirmacion?: string;
  onAfterChange?: () => Promise<void> | void;
  pushUndoAction?: (action: { label: string; undoOps: FirestoreOp[]; redoOps: FirestoreOp[]; showToast?: boolean; toastMessage?: string }) => void;
}): Promise<boolean> {
  if (confirmar && !(await confirmarDialogo(mensajeConfirmacion, { danger: true }))) {
    return false;
  }

  const ref = doc(db, coleccion, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    if (onAfterChange) await onAfterChange();
    return false;
  }

  const backupData = snap.data();

  await ejecutarOperacionesFirestore([{ type: 'delete', collection: coleccion, id }]);
  if (onAfterChange) await onAfterChange();

  if (pushUndoAction) {
    pushUndoAction({
      label: `Eliminar ${nombreElemento}`,
      undoOps: [{ type: 'set', collection: coleccion, id, data: backupData, merge: false }],
      redoOps: [{ type: 'delete', collection: coleccion, id }],
      showToast: true,
      toastMessage: `🗑️ ${nombreElemento} eliminado`
    });
  }

  return true;
}
