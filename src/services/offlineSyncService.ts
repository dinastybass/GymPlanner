import {
  collection,
  doc,
  getDocs,
  getDocFromServer,
  query,
  where,
  setDoc as fbSetDoc,
  updateDoc as fbUpdateDoc,
  deleteDoc as fbDeleteDoc,
  writeBatch as fbWriteBatch,
  enableNetwork,
  disableNetwork,
  waitForPendingWrites,
  DocumentReference,
  CollectionReference,
  SetOptions,
  Firestore,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';

export interface PendingOfflineMutation {
  key: string; // `${collection}/${docId}`
  collection: string;
  docId: string;
  type: 'set' | 'update' | 'delete';
  merge?: boolean;
  data?: Record<string, any>;
  updatedAtMs: number;
  fieldTimestamps: Record<string, number>;
}

export interface OfflineSyncStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  justSynced: boolean;
  lastSyncedCount: number;
}

const STORAGE_KEY_PENDING_OPS = 'gym_offline_pending_ops_v1';
const TRACKED_COLLECTIONS = new Set([
  'agenda_sesiones',
  'clientes',
  'ejercicios',
  'plantillas_sesiones',
  'progreso_clientes',
  'maestros',
  'usuarios_app'
]);

let isBrowserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
let isCurrentlySyncing = false;
let justSyncedFlag = false;
let lastSyncedCountVal = 0;
let justSyncedTimer: ReturnType<typeof setTimeout> | null = null;
let cacheWarmed = false;

const statusListeners = new Set<(status: OfflineSyncStatus) => void>();

function serializeForStorage(val: any): any {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) {
    return { __offline_date__: val.toISOString() };
  }
  if (val instanceof Timestamp || (typeof val === 'object' && typeof val.toDate === 'function')) {
    try {
      return { __offline_date__: val.toDate().toISOString() };
    } catch {
      return val;
    }
  }
  if (Array.isArray(val)) {
    return val.map(serializeForStorage);
  }
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = serializeForStorage(v);
    }
    return out;
  }
  return val;
}

function deserializeFromStorage(val: any): any {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map(deserializeFromStorage);
  }
  if (typeof val === 'object') {
    if (typeof val.__offline_date__ === 'string') {
      const d = new Date(val.__offline_date__);
      return isNaN(d.getTime()) ? val.__offline_date__ : d;
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = deserializeFromStorage(v);
    }
    return out;
  }
  return val;
}

function leerColaPendiente(): Map<string, PendingOfflineMutation> {
  const map = new Map<string, PendingOfflineMutation>();
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PENDING_OPS);
    if (!raw) return map;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && item.key && item.collection && item.docId) {
          map.set(item.key, {
            ...item,
            data: item.data ? deserializeFromStorage(item.data) : undefined,
            fieldTimestamps: item.fieldTimestamps || {}
          });
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return map;
}

function guardarColaPendiente(map: Map<string, PendingOfflineMutation>) {
  try {
    const serialized = Array.from(map.values()).map(item => ({
      ...item,
      data: item.data ? serializeForStorage(item.data) : undefined
    }));
    if (serialized.length === 0) {
      localStorage.removeItem(STORAGE_KEY_PENDING_OPS);
    } else {
      localStorage.setItem(STORAGE_KEY_PENDING_OPS, JSON.stringify(serialized));
    }
  } catch {
    // ignore storage quota errors
  }
}

const pendingOpsMap = leerColaPendiente();

export function getOfflineSyncStatus(): OfflineSyncStatus {
  return {
    isOnline: isBrowserOnline,
    pendingCount: pendingOpsMap.size,
    isSyncing: isCurrentlySyncing,
    justSynced: justSyncedFlag,
    lastSyncedCount: lastSyncedCountVal
  };
}

function notifyStatusListeners() {
  const snapshot = getOfflineSyncStatus();
  statusListeners.forEach(fn => {
    try {
      fn(snapshot);
    } catch {
      // ignore listener error
    }
  });
}

export function subscribeOfflineSyncStatus(
  listener: (status: OfflineSyncStatus) => void
): () => void {
  statusListeners.add(listener);
  listener(getOfflineSyncStatus());
  return () => {
    statusListeners.delete(listener);
  };
}

function marcarSincronizadoBrevemente(count: number) {
  if (count <= 0) return;
  lastSyncedCountVal = count;
  justSyncedFlag = true;
  if (justSyncedTimer) clearTimeout(justSyncedTimer);
  justSyncedTimer = setTimeout(() => {
    justSyncedFlag = false;
    notifyStatusListeners();
  }, 3500);
}

function extraerInfoRef(ref: DocumentReference<any>): { collectionName: string; docId: string; key: string } {
  const pathParts = ref.path.split('/');
  const docId = ref.id || pathParts[pathParts.length - 1] || '';
  const collectionName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : '';
  return {
    collectionName,
    docId,
    key: `${collectionName}/${docId}`
  };
}

/**
 * Sella cada mutación con `updated_at_ms` y marcas de tiempo por campo (`_field_ts`)
 * para resolver conflictos priorizando siempre el último cambio por hora exacta.
 */
function enriquecerPayloadConTimestamps(
  collectionName: string,
  rawData: Record<string, any>
): {
  enrichedData: Record<string, any>;
  nowMs: number;
  fieldTimestamps: Record<string, number>;
} {
  const nowMs = Date.now();
  const fieldTimestamps: Record<string, number> = {};

  if (!rawData || typeof rawData !== 'object') {
    return { enrichedData: rawData, nowMs, fieldTimestamps };
  }

  for (const k of Object.keys(rawData)) {
    if (k === 'updated_at_ms' || k === '_field_ts') continue;
    fieldTimestamps[k] = nowMs;
  }

  // En colecciones de maestros internas (ej. chunks de backup) no añadimos metadatos extra
  if (
    collectionName === 'maestros' ||
    !TRACKED_COLLECTIONS.has(collectionName)
  ) {
    return { enrichedData: { ...rawData }, nowMs, fieldTimestamps };
  }

  const prevFieldTs =
    rawData._field_ts && typeof rawData._field_ts === 'object' ? rawData._field_ts : {};

  const enrichedData: Record<string, any> = {
    ...rawData,
    updated_at_ms: nowMs,
    _field_ts: {
      ...prevFieldTs,
      ...fieldTimestamps
    }
  };

  return { enrichedData, nowMs, fieldTimestamps };
}

function registrarMutacionEnCola(params: {
  collectionName: string;
  docId: string;
  type: 'set' | 'update' | 'delete';
  data?: Record<string, any>;
  merge?: boolean;
  nowMs: number;
  fieldTimestamps: Record<string, number>;
}): string {
  const { collectionName, docId, type, data, merge, nowMs, fieldTimestamps } = params;
  const key = `${collectionName}/${docId}`;
  const existing = pendingOpsMap.get(key);

  if (type === 'delete') {
    pendingOpsMap.set(key, {
      key,
      collection: collectionName,
      docId,
      type: 'delete',
      updatedAtMs: nowMs,
      fieldTimestamps: {}
    });
  } else if (existing && existing.type !== 'delete') {
    // Fusionar cambios realizados sobre la misma sesión mientras se está offline
    const mergedData = {
      ...(existing.data || {}),
      ...(data || {}),
      updated_at_ms: nowMs,
      _field_ts: {
        ...(existing.fieldTimestamps || {}),
        ...fieldTimestamps
      }
    };
    const mergedFieldTs = {
      ...(existing.fieldTimestamps || {}),
      ...fieldTimestamps
    };
    pendingOpsMap.set(key, {
      key,
      collection: collectionName,
      docId,
      type: existing.type === 'set' && !existing.merge ? 'set' : type,
      merge: existing.type === 'set' && !existing.merge ? false : Boolean(merge ?? true),
      data: mergedData,
      updatedAtMs: nowMs,
      fieldTimestamps: mergedFieldTs
    });
  } else {
    pendingOpsMap.set(key, {
      key,
      collection: collectionName,
      docId,
      type,
      merge,
      data,
      updatedAtMs: nowMs,
      fieldTimestamps
    });
  }

  guardarColaPendiente(pendingOpsMap);
  notifyStatusListeners();
  return key;
}

function confirmarMutacionSincronizada(keys: string[], timestampAtStart: number) {
  let removedCount = 0;
  for (const key of keys) {
    const current = pendingOpsMap.get(key);
    // Solo eliminar de la cola si no hubo otra edición más reciente sobre el mismo documento
    if (current && current.updatedAtMs <= timestampAtStart) {
      pendingOpsMap.delete(key);
      removedCount++;
    }
  }
  if (removedCount > 0) {
    guardarColaPendiente(pendingOpsMap);
    if (pendingOpsMap.size === 0 && isCurrentlySyncing) {
      isCurrentlySyncing = false;
      marcarSincronizadoBrevemente(removedCount);
    }
    notifyStatusListeners();
  }
}

/**
 * Ejecuta una promesa de escritura de Firestore sin bloquear la interfaz cuando no hay conexión.
 * Firestore escribe en la caché local IndexedDB inmediatamente (< 25 ms), pero la promesa original
 * no se resuelve hasta que el servidor responde. Si el dispositivo está offline (o la red tarda > 450 ms),
 * resolvemos tras persistir en local y mantenemos el seguimiento en segundo plano.
 */
async function ejecutarEscrituraNoBloqueante(
  writePromise: Promise<any>,
  keys: string[],
  timestampMs: number
): Promise<void> {
  writePromise
    .then(() => {
      if (isBrowserOnline) {
        confirmarMutacionSincronizada(keys, timestampMs);
      }
    })
    .catch(err => {
      console.warn('Error en escritura Firestore en segundo plano:', err);
    });

  if (!isBrowserOnline) {
    // Dar margen de 30ms para que Firestore actualice su caché local IndexedDB antes de refrescar la vista
    await new Promise(resolve => setTimeout(resolve, 30));
    return;
  }

  // Si estamos online pero la conexión del gimnasio es inestable o lenta (> 450ms), no bloquear la pantalla
  await Promise.race([
    writePromise,
    new Promise<void>(resolve => setTimeout(resolve, 450))
  ]);
}

// ============================================================================
// WRAPPERS COMPATIBLES CON FIREBASE/FIRESTORE
// ============================================================================

export async function updateDoc(
  ref: DocumentReference<any>,
  data: Record<string, any>
): Promise<void> {
  const { collectionName, docId } = extraerInfoRef(ref);
  const { enrichedData, nowMs, fieldTimestamps } = enriquecerPayloadConTimestamps(
    collectionName,
    data
  );
  const key = registrarMutacionEnCola({
    collectionName,
    docId,
    type: 'update',
    data: enrichedData,
    merge: true,
    nowMs,
    fieldTimestamps
  });

  // Usar setDoc con merge: true para que funcione en offline aunque el documento haya sido creado también offline
  const p = fbSetDoc(ref, enrichedData, { merge: true });
  await ejecutarEscrituraNoBloqueante(p, [key], nowMs);
}

export async function setDoc(
  ref: DocumentReference<any>,
  data: Record<string, any>,
  options?: SetOptions
): Promise<void> {
  const { collectionName, docId } = extraerInfoRef(ref);
  const isMerge = Boolean(options && ('merge' in options || 'mergeFields' in options));
  const { enrichedData, nowMs, fieldTimestamps } = enriquecerPayloadConTimestamps(
    collectionName,
    data
  );
  const key = registrarMutacionEnCola({
    collectionName,
    docId,
    type: 'set',
    data: enrichedData,
    merge: isMerge,
    nowMs,
    fieldTimestamps
  });

  const p = options ? fbSetDoc(ref, enrichedData, options) : fbSetDoc(ref, enrichedData);
  await ejecutarEscrituraNoBloqueante(p, [key], nowMs);
}

export async function addDoc(
  colRef: CollectionReference<any>,
  data: Record<string, any>
): Promise<DocumentReference<any>> {
  const newDocRef = doc(colRef);
  const { collectionName, docId } = extraerInfoRef(newDocRef);
  const { enrichedData, nowMs, fieldTimestamps } = enriquecerPayloadConTimestamps(
    collectionName,
    data
  );
  const key = registrarMutacionEnCola({
    collectionName,
    docId,
    type: 'set',
    data: enrichedData,
    merge: false,
    nowMs,
    fieldTimestamps
  });

  const p = fbSetDoc(newDocRef, enrichedData);
  await ejecutarEscrituraNoBloqueante(p, [key], nowMs);
  return newDocRef;
}

export async function deleteDoc(ref: DocumentReference<any>): Promise<void> {
  const { collectionName, docId } = extraerInfoRef(ref);
  const nowMs = Date.now();
  const key = registrarMutacionEnCola({
    collectionName,
    docId,
    type: 'delete',
    nowMs,
    fieldTimestamps: {}
  });

  const p = fbDeleteDoc(ref);
  await ejecutarEscrituraNoBloqueante(p, [key], nowMs);
}

export function writeBatch(firestoreInstance: Firestore = db) {
  const realBatch = fbWriteBatch(firestoreInstance);
  const batchKeys: string[] = [];
  let batchTimestamp = Date.now();

  return {
    set(ref: DocumentReference<any>, data: Record<string, any>, options?: SetOptions) {
      const { collectionName, docId } = extraerInfoRef(ref);
      const isMerge = Boolean(options && ('merge' in options || 'mergeFields' in options));
      const { enrichedData, nowMs, fieldTimestamps } = enriquecerPayloadConTimestamps(
        collectionName,
        data
      );
      batchTimestamp = Math.max(batchTimestamp, nowMs);
      const key = registrarMutacionEnCola({
        collectionName,
        docId,
        type: 'set',
        data: enrichedData,
        merge: isMerge,
        nowMs,
        fieldTimestamps
      });
      batchKeys.push(key);
      if (options) {
        realBatch.set(ref, enrichedData, options);
      } else {
        realBatch.set(ref, enrichedData);
      }
      return this;
    },
    update(ref: DocumentReference<any>, data: Record<string, any>) {
      const { collectionName, docId } = extraerInfoRef(ref);
      const { enrichedData, nowMs, fieldTimestamps } = enriquecerPayloadConTimestamps(
        collectionName,
        data
      );
      batchTimestamp = Math.max(batchTimestamp, nowMs);
      const key = registrarMutacionEnCola({
        collectionName,
        docId,
        type: 'update',
        data: enrichedData,
        merge: true,
        nowMs,
        fieldTimestamps
      });
      batchKeys.push(key);
      realBatch.set(ref, enrichedData, { merge: true });
      return this;
    },
    delete(ref: DocumentReference<any>) {
      const { collectionName, docId } = extraerInfoRef(ref);
      const nowMs = Date.now();
      batchTimestamp = Math.max(batchTimestamp, nowMs);
      const key = registrarMutacionEnCola({
        collectionName,
        docId,
        type: 'delete',
        nowMs,
        fieldTimestamps: {}
      });
      batchKeys.push(key);
      realBatch.delete(ref);
      return this;
    },
    async commit(): Promise<void> {
      const p = realBatch.commit();
      await ejecutarEscrituraNoBloqueante(p, batchKeys, batchTimestamp);
    }
  };
}

// ============================================================================
// RECONCILIACIÓN Y MERGE POR HORA EXACTA AL RECONECTAR
// ============================================================================

/**
 * Cuando el dispositivo vuelve a tener conexión WiFi/datos:
 * 1. Reactiva la red de Firestore (`enableNetwork`).
 * 2. Para cada documento modificado en offline, comprueba la versión del servidor:
 *    - Si otro dispositivo modificó campos distintos de la misma sesión, se fusionan ambos.
 *    - Si otro dispositivo modificó el mismo campo, gana el que tenga el `updated_at_ms` / `_field_ts`
 *      más reciente por hora exacta.
 */
export async function sincronizarCambiosPendientesAhora(): Promise<void> {
  if (!isBrowserOnline || isCurrentlySyncing) return;

  const entries = Array.from(pendingOpsMap.values());
  const countToSync = entries.length;
  if (countToSync > 0) {
    isCurrentlySyncing = true;
    notifyStatusListeners();
  }

  try {
    await enableNetwork(db);

    for (const entry of entries) {
      const docRef = doc(db, entry.collection, entry.docId);

      if (entry.type === 'delete') {
        await fbDeleteDoc(docRef);
        pendingOpsMap.delete(entry.key);
        continue;
      }

      if (!entry.data) {
        pendingOpsMap.delete(entry.key);
        continue;
      }

      // Si es actualización parcial o merge, verificar si el servidor tiene algún campo con timestamp más reciente
      if (entry.merge || entry.type === 'update') {
        try {
          const serverSnap = await getDocFromServer(docRef);
          if (serverSnap.exists()) {
            const serverData = serverSnap.data() || {};
            const serverFieldTs: Record<string, number> =
              serverData._field_ts && typeof serverData._field_ts === 'object'
                ? serverData._field_ts
                : {};
            const serverDocTs = Number(serverData.updated_at_ms || 0);

            const mergedPayload: Record<string, any> = {};
            const mergedFieldTs: Record<string, number> = { ...serverFieldTs };
            let anyLocalFieldWon = false;

            for (const [fieldKey, localVal] of Object.entries(entry.data)) {
              if (fieldKey === 'updated_at_ms' || fieldKey === '_field_ts') continue;
              const localTs = Number(entry.fieldTimestamps?.[fieldKey] || entry.updatedAtMs || 0);
              const remoteTs = Number(serverFieldTs[fieldKey] || serverDocTs || 0);

              // Priorizar siempre el último cambio por hora exacta
              if (localTs >= remoteTs) {
                mergedPayload[fieldKey] = localVal;
                mergedFieldTs[fieldKey] = localTs;
                anyLocalFieldWon = true;
              }
            }

            if (anyLocalFieldWon) {
              mergedPayload.updated_at_ms = Math.max(entry.updatedAtMs, serverDocTs);
              mergedPayload._field_ts = mergedFieldTs;
              await fbSetDoc(docRef, mergedPayload, { merge: true });
            }
          } else {
            await fbSetDoc(docRef, entry.data, { merge: true });
          }
        } catch {
          await fbSetDoc(docRef, entry.data, { merge: true });
        }
      } else {
        await fbSetDoc(docRef, entry.data);
      }

      pendingOpsMap.delete(entry.key);
      guardarColaPendiente(pendingOpsMap);
      notifyStatusListeners();
    }

    await waitForPendingWrites(db);
    guardarColaPendiente(pendingOpsMap);

    if (countToSync > 0) {
      isCurrentlySyncing = false;
      marcarSincronizadoBrevemente(countToSync);
    }
  } catch (err) {
    console.warn('Aviso durante sincronización offline:', err);
  } finally {
    isCurrentlySyncing = false;
    notifyStatusListeners();
  }
}

/**
 * Precarga silenciosamente en IndexedDB los catálogos y sesiones del trimestre activo
 * cuando hay conexión, para que todas las pantallas funcionen al instante si se corta el WiFi.
 */
export async function precargarDatosOfflineEnSegundoPlano(): Promise<void> {
  if (!isBrowserOnline || cacheWarmed) return;
  cacheWarmed = true;

  try {
    const now = new Date();
    const desde = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0));
    const hasta = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59));

    await Promise.allSettled([
      getDocs(collection(db, 'maestros')),
      getDocs(collection(db, 'clientes')),
      getDocs(collection(db, 'ejercicios')),
      getDocs(collection(db, 'plantillas_sesiones')),
      getDocs(
        query(
          collection(db, 'agenda_sesiones'),
          where('fecha_hora_inicio', '>=', desde),
          where('fecha_hora_inicio', '<=', hasta)
        )
      ),
      getDocs(query(collection(db, 'agenda_sesiones'), where('sin_fecha', '==', true)))
    ]);
  } catch {
    // Silencioso en segundo plano
  }
}

// Inicializar listeners de red del navegador
if (typeof window !== 'undefined') {
  if (!navigator.onLine) {
    isBrowserOnline = false;
    disableNetwork(db).catch(() => {});
  } else if (pendingOpsMap.size > 0) {
    setTimeout(() => {
      sincronizarCambiosPendientesAhora();
    }, 800);
  }

  window.addEventListener('offline', () => {
    isBrowserOnline = false;
    isCurrentlySyncing = false;
    disableNetwork(db).catch(() => {});
    notifyStatusListeners();
  });

  window.addEventListener('online', () => {
    isBrowserOnline = true;
    notifyStatusListeners();
    sincronizarCambiosPendientesAhora();
  });
}
