export type SharedCacheKey =
  | 'gym_maestros_doc_map_v8'
  | 'gym_modulos_activos_cache_v1'
  | 'gym_programadores_cache_v1'
  | 'gym_config_usuarios_app_v1'
  | 'gym_matriz_permisos_cache_v1'
  | string;

export interface SharedCacheChangeEvent {
  key: SharedCacheKey;
  newValue: any;
  source: 'local' | 'external_tab';
}

type CacheChangeListener = (event: SharedCacheChangeEvent) => void;

export const SHARED_CACHE_SYNC_TICK_KEY = 'gym_shared_maestros_sync_tick_v1';

export const SHARED_MAESTROS_CACHE_KEYS = new Set<string>([
  'gym_maestros_doc_map_v8',
  'gym_modulos_activos_cache_v1',
  'gym_programadores_cache_v1',
  'gym_config_usuarios_app_v1',
  'gym_matriz_permisos_cache_v1',
  SHARED_CACHE_SYNC_TICK_KEY
]);

const memoryCache = new Map<string, any>();
const listeners = new Set<CacheChangeListener>();
let storageListenerInitialized = false;

function notifyListeners(event: SharedCacheChangeEvent): void {
  listeners.forEach(listener => {
    try {
      listener(event);
    } catch (err) {
      console.warn('Error en listener de sharedCacheService:', err);
    }
  });
}

function initCrossTabStorageListener(): void {
  if (storageListenerInitialized || typeof window === 'undefined') return;
  storageListenerInitialized = true;

  // Limpiar posibles restos antiguos en sessionStorage para evitar lecturas aisladas
  try {
    SHARED_MAESTROS_CACHE_KEYS.forEach(k => {
      sessionStorage.removeItem(k);
    });
  } catch {
    // ignore
  }

  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.storageArea && e.storageArea !== window.localStorage) return;

    // Si se limpió todo el localStorage desde otra pestaña
    if (e.key === null) {
      memoryCache.clear();
      notifyListeners({
        key: SHARED_CACHE_SYNC_TICK_KEY,
        newValue: null,
        source: 'external_tab'
      });
      return;
    }

    if (!SHARED_MAESTROS_CACHE_KEYS.has(e.key)) return;

    if (e.newValue === null) {
      memoryCache.delete(e.key);
      notifyListeners({
        key: e.key,
        newValue: null,
        source: 'external_tab'
      });
      return;
    }

    let parsedValue: any = null;
    try {
      parsedValue = JSON.parse(e.newValue);
      memoryCache.set(e.key, parsedValue);
    } catch {
      parsedValue = e.newValue;
      memoryCache.set(e.key, parsedValue);
    }

    // Si es un tick de invalidación o actualización desde otra pestaña
    if (e.key === SHARED_CACHE_SYNC_TICK_KEY && parsedValue && typeof parsedValue === 'object') {
      const targetKey = parsedValue.targetKey as string | undefined;
      if (targetKey && parsedValue.action === 'remove') {
        memoryCache.delete(targetKey);
      }
    }

    notifyListeners({
      key: e.key,
      newValue: parsedValue,
      source: 'external_tab'
    });
  });
}

// Inicializar inmediatamente al cargar el módulo en el navegador
initCrossTabStorageListener();

export function getSharedCache<T = any>(key: SharedCacheKey): T | null {
  initCrossTabStorageListener();

  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as T;
      memoryCache.set(key, parsed);
      return parsed;
    }
    memoryCache.delete(key);
  } catch {
    if (memoryCache.has(key)) {
      return memoryCache.get(key) as T;
    }
  }
  return null;
}

export function setSharedCache<T = any>(
  key: SharedCacheKey,
  value: T,
  emitLocalNotification = false
): void {
  initCrossTabStorageListener();
  memoryCache.set(key, value);

  try {
    const serialized = JSON.stringify(value);
    const previous = localStorage.getItem(key);
    localStorage.setItem(key, serialized);

    // Si el contenido era idéntico pero se forzó recarga, emitir un tick para que otras pestañas se enteren si estaban desincronizadas
    if (previous === serialized && emitLocalNotification) {
      localStorage.setItem(
        SHARED_CACHE_SYNC_TICK_KEY,
        JSON.stringify({
          targetKey: key,
          action: 'set',
          ts: Date.now(),
          rand: Math.random()
        })
      );
    }
  } catch {
    // ignore quota or storage errors
  }

  if (emitLocalNotification) {
    notifyListeners({
      key,
      newValue: value,
      source: 'local'
    });
  }
}

export function removeSharedCache(
  key: SharedCacheKey,
  emitNotification = true
): void {
  initCrossTabStorageListener();
  memoryCache.delete(key);

  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    if (emitNotification) {
      localStorage.setItem(
        SHARED_CACHE_SYNC_TICK_KEY,
        JSON.stringify({
          targetKey: key,
          action: 'remove',
          ts: Date.now(),
          rand: Math.random()
        })
      );
    }
  } catch {
    // ignore storage errors
  }

  if (emitNotification) {
    notifyListeners({
      key,
      newValue: null,
      source: 'local'
    });
  }
}

export function subscribeSharedCache(listener: CacheChangeListener): () => void {
  initCrossTabStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
