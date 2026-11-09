import { collection, doc, getDocs, Timestamp, writeBatch } from 'firebase/firestore';
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
 * Exports all Firestore collections into a single structured JSON object
 */
export async function generarBackupCompletoJSON(
  onProgress?: (msg: string) => void
): Promise<GymPlannerBackupFile> {
  const collectionsData: Record<string, Record<string, Record<string, any>>> = {};
  const counts: Record<string, number> = {};
  let totalDocuments = 0;

  for (const colName of BACKUP_COLLECTIONS) {
    onProgress?.(`Exportando colección "${colName}"...`);
    const snap = await getDocs(collection(db, colName));
    const colDocs: Record<string, Record<string, any>> = {};

    snap.forEach((docSnap) => {
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
 * Generates and triggers a browser download of the full JSON backup file
 */
export async function descargarBackupCompletoWeb(
  onProgress?: (msg: string) => void
): Promise<{ fileName: string; backup: GymPlannerBackupFile }> {
  const backup = await generarBackupCompletoJSON(onProgress);
  const envShort = isProduction ? 'prod' : 'dev';
  const fileName = `backup-gymplanner-${envShort}-${backup.metadata.date}.json`;

  const jsonString = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { fileName, backup };
}

/**
 * Validates a parsed JSON backup file before restoring
 */
export function analizarArchivoBackupJSON(rawText: string): GymPlannerBackupFile {
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('El archivo seleccionado no es un JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.collections || typeof parsed.collections !== 'object') {
    throw new Error('El archivo JSON no tiene la estructura de backup de GymPlanner (falta el nodo "collections").');
  }

  const counts: Record<string, number> = {};
  let totalDocuments = 0;
  const colNames = Object.keys(parsed.collections);

  for (const col of colNames) {
    const docsObj = parsed.collections[col] || {};
    const count = Object.keys(docsObj).length;
    counts[col] = count;
    totalDocuments += count;
  }

  const metadata: BackupMetadata = {
    app: parsed.metadata?.app || 'GymPlanner',
    environment: parsed.metadata?.environment || 'unknown',
    projectId: parsed.metadata?.projectId || 'unknown',
    createdAt: parsed.metadata?.createdAt || new Date().toISOString(),
    date: parsed.metadata?.date || new Date().toISOString().slice(0, 10),
    version: parsed.metadata?.version || '1.0',
    totalCollections: colNames.length,
    totalDocuments,
    counts,
  };

  return {
    metadata,
    collections: parsed.collections,
  };
}

/**
 * Restores selected collections from a GymPlannerBackupFile into Firestore in batches of 400
 */
export async function restaurarBackupJSON(
  backup: GymPlannerBackupFile,
  coleccionesSeleccionadas: string[],
  onProgress?: (msg: string) => void
): Promise<{ coleccionesRestauradas: number; documentosRestaurados: number }> {
  let documentosRestaurados = 0;
  let coleccionesRestauradas = 0;

  for (const colName of coleccionesSeleccionadas) {
    const colDocs = backup.collections[colName];
    if (!colDocs || typeof colDocs !== 'object') continue;

    const entries = Object.entries(colDocs);
    coleccionesRestauradas++;

    if (entries.length === 0) continue;

    const BATCH_SIZE = 400;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      onProgress?.(
        `Restaurando "${colName}" (${Math.min(i + chunk.length, entries.length)} / ${entries.length} documentos)...`
      );

      const batch = writeBatch(db);
      for (const [docId, rawData] of chunk) {
        const deserializedData = deserializeFirestoreValue(rawData);
        batch.set(doc(db, colName, docId), deserializedData);
        documentosRestaurados++;
      }
      await batch.commit();
    }
  }

  return { coleccionesRestauradas, documentosRestaurados };
}
