import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, isProduction } from '../firebase';

export const BACKUP_COLLECTIONS = [
  'clientes',
  'agenda_sesiones',
  'ejercicios',
  'plantillas_sesiones',
  'progreso_clientes',
  'maestros',
  'usuarios_app',
] as const;

export type BackupCollectionName = (typeof BACKUP_COLLECTIONS)[number];

export interface BackupMetadata {
  app: string;
  environment: string;
  projectId: string;
  createdAt: string;
  date: string;
  version: string;
  totalCollections: number;
  totalDocuments: number;
  counts: Record<string, number>;
}

export interface GymPlannerBackupFile {
  metadata: BackupMetadata;
  collections: Record<string, Record<string, Record<string, any>>>;
}

export interface VersionBackupItem {
  id: string;
  createdAt: string;
  fechaFormateada: string;
  tipo: 'manual' | 'automatica';
  chunkCount: number;
  totalDocuments: number;
}

const BACKUP_INDEX_DOC_ID = 'backup_index_v1';
const CHUNK_CHAR_SIZE = 350000; // ~350 KB por fragmento (límite Firestore: 1 MB)
const MAX_STORED_VERSIONS = 30;

export function formatearFechaBackup(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio} - ${hora}:${min}`;
}

/**
 * Serializes Firestore Document data preserving Timestamps as { __datatype__: 'timestamp', value: ISOString }
 */
function serializeFirestoreValue(value: any): any {
  if (value === null || value === undefined) return value;

  if (value instanceof Timestamp) {
    return {
      __datatype__: 'timestamp',
      value: value.toDate().toISOString(),
    };
  }

  if (
    typeof value === 'object' &&
    typeof value.seconds === 'number' &&
    typeof value.nanoseconds === 'number'
  ) {
    const ms = value.seconds * 1000 + Math.floor(value.nanoseconds / 1e6);
    return {
      __datatype__: 'timestamp',
      value: new Date(ms).toISOString(),
    };
  }

  if (value instanceof Date) {
    return {
      __datatype__: 'timestamp',
      value: value.toISOString(),
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }

  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeFirestoreValue(v);
    }
    return out;
  }

  return value;
}

/**
 * Reconstructs Firestore Timestamps from { __datatype__: 'timestamp', value: ISOString }
 */
function deserializeFirestoreValue(value: any): any {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(deserializeFirestoreValue);
  }

  if (typeof value === 'object') {
    if (value.__datatype__ === 'timestamp' && typeof value.value === 'string') {
      const parsedDate = new Date(value.value);
      if (!isNaN(parsedDate.getTime())) {
        return Timestamp.fromDate(parsedDate);
      }
    }

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deserializeFirestoreValue(v);
    }
    return out;
  }

  return value;
}

/**
 * Exports all Firestore collections into a single structured object
 */
export async function generarBackupCompletoJSON(
  onProgress?: (msg: string) => void
): Promise<GymPlannerBackupFile> {
  const collectionsData: Record<string, Record<string, Record<string, any>>> = {};
  const counts: Record<string, number> = {};
  let totalDocuments = 0;

  for (const colName of BACKUP_COLLECTIONS) {
    onProgress?.('Recopilando datos actuales...');
    const snap = await getDocs(collection(db, colName));
    const colDocs: Record<string, Record<string, any>> = {};

    snap.forEach((docSnap) => {
      // No incluir los propios documentos internos de almacenamiento de copias dentro de maestros
      if (colName === 'maestros' && docSnap.id.startsWith('backup_')) {
        return;
      }
      colDocs[docSnap.id] = serializeFirestoreValue(docSnap.data());
    });

    const docCount = Object.keys(colDocs).length;
    collectionsData[colName] = colDocs;
    counts[colName] = docCount;
    totalDocuments += docCount;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const envLabel = isProduction ? 'production' : 'development';
  const projectId = isProduction ? 'gymapp-d8ae7' : 'gymplanner-dev-574ea';

  return {
    metadata: {
      app: 'GymPlanner',
      environment: envLabel,
      projectId,
      createdAt: new Date().toISOString(),
      date: todayStr,
      version: '1.0',
      totalCollections: BACKUP_COLLECTIONS.length,
      totalDocuments,
      counts,
    },
    collections: collectionsData,
  };
}

/**
 * Lists all available backup versions sorted from newest to oldest
 */
export async function listarVersionesBackup(): Promise<VersionBackupItem[]> {
  try {
    const snap = await getDoc(doc(db, 'maestros', BACKUP_INDEX_DOC_ID));
    if (!snap.exists()) return [];
    const data = snap.data();
    const versiones = Array.isArray(data?.versiones) ? data.versiones : [];
    return versiones
      .map((v: any) => ({
        id: String(v.id || ''),
        createdAt: String(v.createdAt || ''),
        fechaFormateada: v.fechaFormateada || formatearFechaBackup(String(v.createdAt || '')),
        tipo: (v.tipo === 'automatica' ? 'automatica' : 'manual') as 'manual' | 'automatica',
        chunkCount: Number(v.chunkCount || 1),
        totalDocuments: Number(v.totalDocuments || 0),
      }))
      .filter((v: VersionBackupItem) => Boolean(v.id))
      .sort((a: VersionBackupItem, b: VersionBackupItem) =>
        b.createdAt.localeCompare(a.createdAt)
      );
  } catch (e) {
    console.warn('No se pudo cargar el listado de copias de seguridad:', e);
    return [];
  }
}

/**
 * Creates a new manual backup version and stores it in the version history
 */
export async function generarCopiaManual(
  onProgress?: (msg: string) => void
): Promise<VersionBackupItem> {
  const backupData = await generarBackupCompletoJSON(onProgress);
  onProgress?.('Guardando copia de seguridad...');

  const jsonStr = JSON.stringify(backupData);
  const chunks: string[] = [];
  for (let i = 0; i < jsonStr.length; i += CHUNK_CHAR_SIZE) {
    chunks.push(jsonStr.slice(i, i + CHUNK_CHAR_SIZE));
  }
  if (chunks.length === 0) {
    chunks.push('{}');
  }

  const nowIso = new Date().toISOString();
  const backupId = `bkp_${Date.now()}`;

  for (let idx = 0; idx < chunks.length; idx++) {
    await setDoc(doc(db, 'maestros', `backup_chunk_${backupId}_${idx}`), {
      backupId,
      chunkIndex: idx,
      data: chunks[idx],
      createdAt: nowIso,
    });
  }

  const nuevaVersion: VersionBackupItem = {
    id: backupId,
    createdAt: nowIso,
    fechaFormateada: formatearFechaBackup(nowIso),
    tipo: 'manual',
    chunkCount: chunks.length,
    totalDocuments: backupData.metadata.totalDocuments,
  };

  const versionesActuales = await listarVersionesBackup();
  const todasLasVersiones = [nuevaVersion, ...versionesActuales];

  const versionesAConservar = todasLasVersiones.slice(0, MAX_STORED_VERSIONS);
  const versionesAEliminar = todasLasVersiones.slice(MAX_STORED_VERSIONS);

  // Limpiar fragmentos de versiones antiguas que superen las 30 copias
  for (const oldVer of versionesAEliminar) {
    for (let i = 0; i < oldVer.chunkCount; i++) {
      try {
        await deleteDoc(doc(db, 'maestros', `backup_chunk_${oldVer.id}_${i}`));
      } catch {
        // ignore
      }
    }
  }

  await setDoc(doc(db, 'maestros', BACKUP_INDEX_DOC_ID), {
    updatedAt: nowIso,
    versiones: versionesAConservar,
  });

  return nuevaVersion;
}

/**
 * Restores all collections from a saved backup version by ID
 */
export async function restaurarVersionPorId(
  backupId: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  onProgress?.('Cargando copia seleccionada...');
  const versiones = await listarVersionesBackup();
  const versionTarget = versiones.find((v) => v.id === backupId);
  if (!versionTarget) {
    throw new Error('No se encontró la copia de seguridad seleccionada.');
  }

  const chunkPromises = [];
  for (let idx = 0; idx < versionTarget.chunkCount; idx++) {
    chunkPromises.push(getDoc(doc(db, 'maestros', `backup_chunk_${backupId}_${idx}`)));
  }

  const chunkSnaps = await Promise.all(chunkPromises);
  let jsonCompleto = '';
  for (const snap of chunkSnaps) {
    if (!snap.exists()) {
      throw new Error('La copia de seguridad está incompleta o dañada.');
    }
    jsonCompleto += String(snap.data()?.data || '');
  }

  const parsedBackup = JSON.parse(jsonCompleto) as GymPlannerBackupFile;
  if (!parsedBackup || !parsedBackup.collections) {
    throw new Error('El formato de la copia de seguridad no es válido.');
  }

  onProgress?.('Restaurando datos...');
  const colecciones = Object.keys(parsedBackup.collections);

  for (const colName of colecciones) {
    const colDocs = parsedBackup.collections[colName];
    if (!colDocs || typeof colDocs !== 'object') continue;

    // Sincronizar colección: eliminar documentos que no existían en la copia (salvo los docs de backups en maestros)
    const currentSnap = await getDocs(collection(db, colName));
    const idsEnBackup = new Set(Object.keys(colDocs));
    const docsABorrar: string[] = [];

    currentSnap.forEach((dSnap) => {
      if (colName === 'maestros' && dSnap.id.startsWith('backup_')) return;
      if (!idsEnBackup.has(dSnap.id)) {
        docsABorrar.push(dSnap.id);
      }
    });

    const BATCH_SIZE = 400;
    for (let i = 0; i < docsABorrar.length; i += BATCH_SIZE) {
      const chunkIds = docsABorrar.slice(i, i + BATCH_SIZE);
      const delBatch = writeBatch(db);
      for (const idToDel of chunkIds) {
        delBatch.delete(doc(db, colName, idToDel));
      }
      await delBatch.commit();
    }

    const entries = Object.entries(colDocs);
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const [docId, rawData] of chunk) {
        if (colName === 'maestros' && docId.startsWith('backup_')) continue;
        const deserializedData = deserializeFirestoreValue(rawData);
        batch.set(doc(db, colName, docId), deserializedData);
      }
      await batch.commit();
    }
  }
}
