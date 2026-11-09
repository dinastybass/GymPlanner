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
import { app, db, isProduction } from '../firebase';

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
  driveFileId?: string;
  fileName?: string;
  createdAt: string;
  fechaFormateada: string;
  tipo: 'manual' | 'automatica';
  origen?: 'gdrive' | 'firestore';
  chunkCount: number;
  totalDocuments: number;
}

export interface GoogleDriveBackupConfig {
  folderId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  updatedAt?: string;
}

const BACKUP_INDEX_DOC_ID = 'backup_index_v1';
const GDRIVE_CONFIG_DOC_ID = 'config_gdrive_backup';
const CHUNK_CHAR_SIZE = 350000; // ~350 KB por fragmento (límite Firestore: 1 MB)
const MAX_STORED_VERSIONS = 30;

export function extraerIdCarpetaDrive(rawInput: string): string {
  const limpio = (rawInput || '').trim();
  if (!limpio) return '';
  const matchFolder = limpio.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (matchFolder && matchFolder[1]) {
    return matchFolder[1];
  }
  const matchIdParam = limpio.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchIdParam && matchIdParam[1]) {
    return matchIdParam[1];
  }
  return limpio.split('?')[0].split('/')[0].trim();
}

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

const LOCAL_STORAGE_GDRIVE_KEY = 'gym_gdrive_config_v1';

export async function cargarConfigGoogleDrive(): Promise<GoogleDriveBackupConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'maestros', GDRIVE_CONFIG_DOC_ID));
    if (snap.exists()) {
      const data = snap.data();
      const folderId = extraerIdCarpetaDrive(String(data?.folderId || ''));
      if (folderId) {
        const cfg: GoogleDriveBackupConfig = {
          folderId,
          clientId: String(data?.clientId || '').trim(),
          clientSecret: String(data?.clientSecret || '').trim(),
          refreshToken: String(data?.refreshToken || '').trim(),
          updatedAt: String(data?.updatedAt || ''),
        };
        try {
          localStorage.setItem(LOCAL_STORAGE_GDRIVE_KEY, JSON.stringify(cfg));
        } catch {
          // ignore storage errors
        }
        return cfg;
      }
    }
  } catch (e) {
    console.warn('No se pudo leer config_gdrive_backup de Firestore:', e);
  }

  // Fallback local (por ejemplo si se cambia entre entorno DEV y PROD en el mismo navegador)
  try {
    const rawLocal = localStorage.getItem(LOCAL_STORAGE_GDRIVE_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      const folderId = extraerIdCarpetaDrive(String(parsed?.folderId || ''));
      if (folderId) {
        const cfg: GoogleDriveBackupConfig = {
          folderId,
          clientId: String(parsed?.clientId || '').trim(),
          clientSecret: String(parsed?.clientSecret || '').trim(),
          refreshToken: String(parsed?.refreshToken || '').trim(),
          updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
        };
        // Persistir automáticamente en la BBDD activa para que quede guardado para siempre
        try {
          await setDoc(doc(db, 'maestros', GDRIVE_CONFIG_DOC_ID), cfg);
        } catch {
          // ignore if readonly
        }
        return cfg;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function guardarConfigGoogleDrive(config: GoogleDriveBackupConfig): Promise<void> {
  const payload: GoogleDriveBackupConfig = {
    folderId: extraerIdCarpetaDrive(config.folderId),
    clientId: (config.clientId || '').trim(),
    clientSecret: (config.clientSecret || '').trim(),
    refreshToken: (config.refreshToken || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LOCAL_STORAGE_GDRIVE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
  await setDoc(doc(db, 'maestros', GDRIVE_CONFIG_DOC_ID), payload);
}

async function obtenerAccessTokenDrive(config: GoogleDriveBackupConfig): Promise<string | null> {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    return null;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error de autenticación con Google Drive (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.access_token || null;
}

async function listarArchivosBackupEnGoogleDrive(
  config: GoogleDriveBackupConfig
): Promise<VersionBackupItem[]> {
  const folderId = extraerIdCarpetaDrive(config.folderId);
  if (!folderId) return [];

  const token = await obtenerAccessTokenDrive(config);
  const query = `'${folderId}' in parents and trashed = false and (name contains 'backup' or mimeType = 'application/json')`;
  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('fields', 'files(id, name, createdTime, modifiedTime, size)');
  listUrl.searchParams.set('orderBy', 'createdTime desc');
  listUrl.searchParams.set('pageSize', '60');
  listUrl.searchParams.set('supportsAllDrives', 'true');
  listUrl.searchParams.set('includeItemsFromAllDrives', 'true');

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (app?.options?.apiKey) {
    listUrl.searchParams.set('key', app.options.apiKey);
  } else {
    return [];
  }

  const res = await fetch(listUrl.toString(), { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`No se pudieron listar los archivos de Google Drive (${res.status}): ${txt}`);
  }

  const data = await res.json();
  const files = Array.isArray(data.files) ? data.files : [];

  return files.map((f: any) => {
    const createdAt = String(f.modifiedTime || f.createdTime || new Date().toISOString());
    const nameStr = String(f.name || 'backup.json');
    const esManual = nameStr.toLowerCase().includes('manual');
    // Extraer fecha YYYY-MM-DD del nombre si viene en formato backup-gymplanner-prod-YYYY-MM-DD.json
    const fechaBase = formatearFechaBackup(createdAt);

    return {
      id: `gdrive:${f.id}`,
      driveFileId: String(f.id),
      fileName: nameStr,
      createdAt,
      fechaFormateada: fechaBase,
      tipo: esManual ? 'manual' : 'automatica',
      origen: 'gdrive',
      chunkCount: 1,
      totalDocuments: 0,
    };
  });
}

async function subirArchivoBackupAGoogleDrive(
  config: GoogleDriveBackupConfig,
  fileName: string,
  jsonStr: string
): Promise<{ id: string; name: string } | null> {
  const folderId = extraerIdCarpetaDrive(config.folderId);
  const token = await obtenerAccessTokenDrive(config);
  if (!folderId || !token) return null;

  const boundary = '-------GymPlannerManualBackup' + Date.now();
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [folderId],
  };

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonStr}\r\n` +
    `--${boundary}--`;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    const errTxt = await uploadRes.text();
    throw new Error(`Error subiendo copia a Google Drive (${uploadRes.status}): ${errTxt}`);
  }
  return await uploadRes.json();
}

async function descargarBackupDesdeGoogleDrive(
  config: GoogleDriveBackupConfig,
  driveFileId: string
): Promise<GymPlannerBackupFile> {
  const token = await obtenerAccessTokenDrive(config);
  const downloadUrl = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`
  );
  downloadUrl.searchParams.set('alt', 'media');
  downloadUrl.searchParams.set('supportsAllDrives', 'true');

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (app?.options?.apiKey) {
    downloadUrl.searchParams.set('key', app.options.apiKey);
  } else {
    throw new Error('Faltan las credenciales de conexión a Google Drive.');
  }

  const res = await fetch(downloadUrl.toString(), { headers });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`No se pudo descargar el archivo desde Google Drive (${res.status}): ${errTxt}`);
  }

  return (await res.json()) as GymPlannerBackupFile;
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
      // No incluir los propios documentos internos de almacenamiento de copias o credenciales Drive dentro de maestros
      if (
        colName === 'maestros' &&
        (docSnap.id.startsWith('backup_') || docSnap.id === GDRIVE_CONFIG_DOC_ID)
      ) {
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
 * Lists all available backup versions from Google Drive (and local Firestore fallback) sorted newest to oldest
 */
export async function listarVersionesBackup(): Promise<VersionBackupItem[]> {
  const versionesDrive: VersionBackupItem[] = [];
  const driveFilesIds = new Set<string>();

  try {
    const driveCfg = await cargarConfigGoogleDrive();
    if (driveCfg && driveCfg.folderId) {
      const fromDrive = await listarArchivosBackupEnGoogleDrive(driveCfg);
      for (const item of fromDrive) {
        versionesDrive.push(item);
        if (item.driveFileId) driveFilesIds.add(item.driveFileId);
      }
    }
  } catch (e) {
    console.warn('Error consultando Google Drive:', e);
  }

  const versionesLocales: VersionBackupItem[] = [];
  try {
    const snap = await getDoc(doc(db, 'maestros', BACKUP_INDEX_DOC_ID));
    if (snap.exists()) {
      const data = snap.data();
      const versiones = Array.isArray(data?.versiones) ? data.versiones : [];
      for (const v of versiones) {
        const idStr = String(v.id || '');
        if (!idStr) continue;
        if (v.driveFileId && driveFilesIds.has(String(v.driveFileId))) {
          continue;
        }
        const rawFecha = v.createdAt
          ? formatearFechaBackup(String(v.createdAt))
          : String(v.fechaFormateada || '').split('·')[0].trim();
        versionesLocales.push({
          id: idStr,
          driveFileId: v.driveFileId ? String(v.driveFileId) : undefined,
          fileName: v.fileName ? String(v.fileName) : undefined,
          createdAt: String(v.createdAt || ''),
          fechaFormateada: rawFecha,
          tipo: (v.tipo === 'automatica' ? 'automatica' : 'manual') as 'manual' | 'automatica',
          origen: v.origen || 'firestore',
          chunkCount: Number(v.chunkCount || 1),
          totalDocuments: Number(v.totalDocuments || 0),
        });
      }
    }
  } catch (e) {
    console.warn('No se pudo cargar el índice local de copias de seguridad:', e);
  }

  return [...versionesDrive, ...versionesLocales].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

/**
 * Creates a new manual backup version, uploads it to Google Drive if configured, and stores it in version history
 */
export async function generarCopiaManual(
  onProgress?: (msg: string) => void
): Promise<VersionBackupItem> {
  const backupData = await generarBackupCompletoJSON(onProgress);
  const jsonStr = JSON.stringify(backupData, null, 2);

  const now = new Date();
  const nowIso = now.toISOString();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const fileName = `backup-gymplanner-manual-${yyyy}-${mm}-${dd}-${hh}${min}.json`;

  let uploadedDriveFile: { id: string; name: string } | null = null;
  const driveCfg = await cargarConfigGoogleDrive();
  if (driveCfg && driveCfg.folderId && driveCfg.clientId && driveCfg.refreshToken) {
    onProgress?.('Subiendo copia manual a Google Drive...');
    try {
      uploadedDriveFile = await subirArchivoBackupAGoogleDrive(driveCfg, fileName, jsonStr);
    } catch (e) {
      console.warn('No se pudo subir a Google Drive, guardando copia en base de datos:', e);
    }
  }

  onProgress?.('Guardando registro de copia de seguridad...');
  const compactJsonStr = JSON.stringify(backupData);
  const chunks: string[] = [];
  for (let i = 0; i < compactJsonStr.length; i += CHUNK_CHAR_SIZE) {
    chunks.push(compactJsonStr.slice(i, i + CHUNK_CHAR_SIZE));
  }
  if (chunks.length === 0) {
    chunks.push('{}');
  }

  const backupId = `bkp_${Date.now()}`;

  for (let idx = 0; idx < chunks.length; idx++) {
    await setDoc(doc(db, 'maestros', `backup_chunk_${backupId}_${idx}`), {
      backupId,
      chunkIndex: idx,
      data: chunks[idx],
      createdAt: nowIso,
    });
  }

  const fechaTexto = formatearFechaBackup(nowIso);
  const nuevaVersion: VersionBackupItem = {
    id: uploadedDriveFile ? `gdrive:${uploadedDriveFile.id}` : backupId,
    driveFileId: uploadedDriveFile?.id,
    fileName,
    createdAt: nowIso,
    fechaFormateada: fechaTexto,
    tipo: 'manual',
    origen: uploadedDriveFile ? 'gdrive' : 'firestore',
    chunkCount: chunks.length,
    totalDocuments: backupData.metadata.totalDocuments,
  };

  // Actualizar índice local en Firestore
  const snapIndex = await getDoc(doc(db, 'maestros', BACKUP_INDEX_DOC_ID));
  const versionesPrevias: VersionBackupItem[] = snapIndex.exists() && Array.isArray(snapIndex.data()?.versiones)
    ? snapIndex.data()!.versiones
    : [];

  const versionLocalEntry: VersionBackupItem = {
    ...nuevaVersion,
    id: backupId,
  };

  const todasLasVersiones = [versionLocalEntry, ...versionesPrevias];
  const versionesAConservar = todasLasVersiones.slice(0, MAX_STORED_VERSIONS);
  const versionesAEliminar = todasLasVersiones.slice(MAX_STORED_VERSIONS);

  for (const oldVer of versionesAEliminar) {
    for (let i = 0; i < (oldVer.chunkCount || 1); i++) {
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
 * Restores all collections from a saved backup version (either from Google Drive or Firestore chunks)
 */
export async function restaurarVersionPorId(
  backupId: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  let parsedBackup: GymPlannerBackupFile | null = null;

  if (backupId.startsWith('gdrive:')) {
    const driveFileId = backupId.slice('gdrive:'.length);
    onProgress?.('Descargando copia de seguridad desde Google Drive...');
    const driveCfg = await cargarConfigGoogleDrive();
    if (!driveCfg || !driveCfg.folderId) {
      throw new Error('No se encontró la configuración de Google Drive.');
    }
    parsedBackup = await descargarBackupDesdeGoogleDrive(driveCfg, driveFileId);
  } else {
    onProgress?.('Cargando copia seleccionada...');
    const snapIndex = await getDoc(doc(db, 'maestros', BACKUP_INDEX_DOC_ID));
    const versiones: any[] =
      snapIndex.exists() && Array.isArray(snapIndex.data()?.versiones)
        ? snapIndex.data()!.versiones
        : [];
    const versionTarget = versiones.find((v) => v.id === backupId);
    if (!versionTarget) {
      throw new Error('No se encontró la copia de seguridad seleccionada.');
    }

    const chunkPromises = [];
    for (let idx = 0; idx < (versionTarget.chunkCount || 1); idx++) {
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

    parsedBackup = JSON.parse(jsonCompleto) as GymPlannerBackupFile;
  }

  if (!parsedBackup || !parsedBackup.collections) {
    throw new Error('El formato de la copia de seguridad no es válido.');
  }

  onProgress?.('Restaurando datos en la aplicación...');
  const colecciones = Object.keys(parsedBackup.collections);

  for (const colName of colecciones) {
    const colDocs = parsedBackup.collections[colName];
    if (!colDocs || typeof colDocs !== 'object') continue;

    // Sincronizar colección: eliminar documentos que no existían en la copia (salvo los docs de backups y config Drive en maestros)
    const currentSnap = await getDocs(collection(db, colName));
    const idsEnBackup = new Set(Object.keys(colDocs));
    const docsABorrar: string[] = [];

    currentSnap.forEach((dSnap) => {
      if (
        colName === 'maestros' &&
        (dSnap.id.startsWith('backup_') || dSnap.id === GDRIVE_CONFIG_DOC_ID)
      ) {
        return;
      }
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
        if (
          colName === 'maestros' &&
          (docId.startsWith('backup_') || docId === GDRIVE_CONFIG_DOC_ID)
        ) {
          continue;
        }
        const deserializedData = deserializeFirestoreValue(rawData);
        batch.set(doc(db, colName, docId), deserializedData);
      }
      await batch.commit();
    }
  }
}
