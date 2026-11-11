import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { writeBatch } from './offlineSyncService';
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

const CAMPOS_FECHA_CONOCIDOS = new Set([
  'fecha_hora_inicio',
  'fecha_hora_anterior',
  'fecha_creacion_sin_fecha',
  'fecha_ultima_edicion',
  'fecha_modificacion',
  'fecha_creacion',
  'fecha_programacion',
  'fecha_alta',
  'fecha'
]);

/**
 * Clona profundamente un objeto preservando instancias Date y convirtiendo
 * objetos Timestamp de Firestore (o mapas {seconds, nanoseconds} serializados por JSON)
 * en instancias Date nativas para que Firestore las almacene siempre como Timestamp real.
 */
export function clonarProfundoPreservandoFechas(val: any, keyName?: string): any {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') {
    if (
      typeof val === 'string' &&
      keyName &&
      CAMPOS_FECHA_CONOCIDOS.has(keyName) &&
      /^\d{4}-\d{2}-\d{2}T/.test(val)
    ) {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return val;
  }

  if (val instanceof Date) {
    return new Date(val.getTime());
  }

  if (typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      if (d instanceof Date && !isNaN(d.getTime())) {
        return new Date(d.getTime());
      }
    } catch {
      // Fallback below
    }
  }

  const secs =
    typeof val.seconds === 'number'
      ? val.seconds
      : typeof val._seconds === 'number'
      ? val._seconds
      : null;
  const nanos =
    typeof val.nanoseconds === 'number'
      ? val.nanoseconds
      : typeof val._nanoseconds === 'number'
      ? val._nanoseconds
      : 0;

  if (secs !== null && Object.keys(val).length <= 3) {
    return new Date(secs * 1000 + Math.floor(nanos / 1e6));
  }

  if (Array.isArray(val)) {
    return val.map(item => clonarProfundoPreservandoFechas(item));
  }

  const copy: Record<string, any> = {};
  for (const k of Object.keys(val)) {
    copy[k] = clonarProfundoPreservandoFechas(val[k], k);
  }
  return copy;
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
        const sanitized = clonarProfundoPreservandoFechas(op.data || {});
        batch.set(ref, sanitized, { merge: true });
      } else if (op.type === 'set') {
        const sanitized = clonarProfundoPreservandoFechas(op.data || {});
        if (op.merge) {
          batch.set(ref, sanitized, { merge: true });
        } else {
          batch.set(ref, sanitized);
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
  pushUndoAction?: (action: {
    label: string;
    undoOps: FirestoreOp[];
    redoOps: FirestoreOp[];
    showToast?: boolean;
    toastMessage?: string;
  }) => void;
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

  const backupData = clonarProfundoPreservandoFechas(snap.data());

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
