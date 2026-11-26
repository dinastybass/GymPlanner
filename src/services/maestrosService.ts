import { db, auth } from '../firebase';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  deleteField,
  setDoc as fbSetDoc,
  deleteDoc as fbDeleteDoc,
} from 'firebase/firestore';
import { setDoc, updateDoc } from './offlineSyncService';
import { CatalogoPermiso, MatrizPermisos, PermisoAccion, UsuarioApp } from '../types';
import {
  getSharedCache,
  setSharedCache,
  removeSharedCache,
  subscribeSharedCache,
  SharedCacheChangeEvent
} from './sharedCacheService';

const CACHE_KEY = 'gym_maestros_doc_map_v8';
const PROGRAMADORES_CACHE_KEY = 'gym_programadores_cache_v1';
const MATRIZ_PERMISOS_CACHE_KEY = 'gym_matriz_permisos_cache_v3';

export function onCatalogoMaestrosChanged(
  callback: (event: SharedCacheChangeEvent) => void
): () => void {
  return subscribeSharedCache(callback);
}


export const DIAS_SEMANA_SG = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo'
];

export const HORAS_MEDIA_HORA_SG: string[] = (() => {
  const list: string[] = [];
  for (let h = 7; h <= 22; h++) {
    const hh = String(h).padStart(2, '0');
    list.push(`${hh}:00`);
    list.push(`${hh}:30`);
  }
  return list;
})();

export function parsearHorarioSmallGroup(valorRaw: string): {
  dia: string;
  hora: string;
  formateado: string;
} {
  const raw = String(valorRaw || '').trim();
  const norm = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let diaDetectado = 'Lunes';
  if (norm.includes('martes') || norm.startsWith('mar')) diaDetectado = 'Martes';
  else if (norm.includes('miercoles') || norm.startsWith('mie')) diaDetectado = 'Miércoles';
  else if (norm.includes('jueves') || norm.startsWith('jue')) diaDetectado = 'Jueves';
  else if (norm.includes('viernes') || norm.startsWith('vie')) diaDetectado = 'Viernes';
  else if (norm.includes('sabado') || norm.startsWith('sab')) diaDetectado = 'Sábado';
  else if (norm.includes('domingo') || norm.startsWith('dom')) diaDetectado = 'Domingo';
  else if (norm.includes('lunes') || norm.startsWith('lun')) diaDetectado = 'Lunes';

  let horaDetectada = '18:00';
  const matchHora = raw.match(/(\d{1,2})(?::(\d{1,2}))?/);
  if (matchHora) {
    let h = parseInt(matchHora[1], 10);
    const m = matchHora[2] !== undefined ? parseInt(matchHora[2], 10) : 0;
    if (isNaN(h)) h = 18;
    h = Math.min(22, Math.max(7, h));
    const mm = !isNaN(m) && m >= 15 && m < 45 ? '30' : '00';
    if (!isNaN(m) && m >= 45 && h < 22) {
      h += 1;
    }
    horaDetectada = `${String(h).padStart(2, '0')}:${mm}`;
  }

  return {
    dia: diaDetectado,
    hora: horaDetectada,
    formateado: `${diaDetectado} ${horaDetectada}`
  };
}

export function parsearFestivoMaestro(valorRaw: string): {
  fechaISO: string;
  motivo: string;
  formateado: string;
} | null {
  const raw = String(valorRaw || '').trim();
  if (!raw) return null;

  // Match YYYY-MM-DD optionally followed by separator and reason
  const matchISO = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s*(?:[-–—·:|]\s*|\s+)(.*))?$/);
  if (matchISO) {
    const [, y, m, d, rest] = matchISO;
    const fechaISO = `${y}-${m}-${d}`;
    const motivo = (rest || '').trim();
    const fechaES = `${d}/${m}/${y}`;
    return {
      fechaISO,
      motivo,
      formateado: motivo ? `${fechaES} · ${motivo}` : fechaES
    };
  }

  // Match DD/MM/YYYY or DD-MM-YYYY optionally followed by separator and reason
  const matchES = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s*(?:[-–—·:|]\s*|\s+)(.*))?$/);
  if (matchES) {
    const [, dRaw, mRaw, y, rest] = matchES;
    const d = dRaw.padStart(2, '0');
    const m = mRaw.padStart(2, '0');
    const fechaISO = `${y}-${m}-${d}`;
    const motivo = (rest || '').trim();
    const fechaES = `${d}/${m}/${y}`;
    return {
      fechaISO,
      motivo,
      formateado: motivo ? `${fechaES} · ${motivo}` : fechaES
    };
  }

  return null;
}

export function extraerMapaFestivos(valoresFestivos: string[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  (valoresFestivos || []).forEach(v => {
    const parsed = parsearFestivoMaestro(v);
    if (parsed) {
      mapa[parsed.fechaISO] = parsed.motivo || 'Festivo';
    }
  });
  return mapa;
}

export const ESTRUCTURA_MAESTROS: Record<string, string[]> = {
  "Ejercicios": [
    "Niveles",
    "Bloques",
    "Músculos",
    "Materiales",
    "Subcategorías",
    "Zona / Articulación",
    "Posición",
    "Patrón Motor",
    "Series y Repeticiones"
  ],
  "Sesiones": [
    "Tipo de Sesión",
    "Intensidad de la Sesión"
  ],
  "Clientes": [
    "Estado",
    "Tipo de Cliente"
  ],
  "Agenda": [
    "Horarios Sesiones Individuales",
    "Horarios Small Groups",
    "Días de la semana",
    "Festivos",
    "Ocupación máxima",
    "Meses de margen para reprogramar"
  ],
  "Gestión de Perfiles": [
    "Roles",
    "Permisos"
  ],
  "Copias de Seguridad": [
    "Copias de Seguridad"
  ]
};

export const CATALOGO_PERMISOS_APP: CatalogoPermiso[] = [
  {
    id: "planificacion",
    categoria: "Programación y Sala",
    nombre: "Hoy (Planificación Diaria y Estado de Sesión)",
    descripcion: "Ver: acceder a la pestaña Hoy y consultar tarjetas del día. Editar: marcar sesiones como Completada o Pendiente (en Hoy, menú contextual de Agenda y Ficha)."
  },
  {
    id: "pantalla_sala",
    categoria: "Programación y Sala",
    nombre: "Pantalla Sala (Modo TV / Proyector)",
    descripcion: "Ver: proyección en tiempo real de las sesiones y entrenamientos del día en la sala."
  },
  {
    id: "programar_sesiones",
    categoria: "Programación y Sala",
    nombre: "Programación de Sesiones (Rutina)",
    descripcion: "Ver: abrir 'Programación' en modo lectura (desde Hoy, Agenda o Ficha). Crear: añadir ejercicios e importar plantillas. Editar: cambiar series, peso, intensidad y orden. Borrar: quitar ejercicios."
  },
  {
    id: "enviar_programacion",
    categoria: "Programación y Sala",
    nombre: "Enviar / Clonar Programación",
    descripcion: "Ver / Crear / Editar: usar la acción 'Enviar Programación' (en menú contextual de Agenda, Small Groups, Ficha de Cliente o dentro de la sesión) para clonar una rutina a otro cliente o fecha."
  },
  {
    id: "programaciones_pendientes",
    categoria: "Programación y Sala",
    nombre: "Programaciones Pendientes (Próximas 2 Semanas)",
    descripcion: "Ver: acceder al panel de sesiones individuales y Small Groups pendientes de programar desde Agenda."
  },
  {
    id: "agenda",
    categoria: "Agenda y Calendario",
    nombre: "Agenda y Calendario de Citas",
    descripcion: "Ver: consultar calendario de citas. Crear: agendar citas (+ Planificar días, doble clic en hueco, ubicar sin fecha). Editar: opción 'Reprogramar'. Borrar: opción 'Cancelar o Eliminar'."
  },
  {
    id: "clientes",
    categoria: "Clientes",
    nombre: "Directorio y Fichas de Clientes",
    descripcion: "Ver: acceder al listado y abrir la Ficha de Cliente (incluyendo enlaces desde Hoy y Agenda). Crear: alta de nuevos clientes. Editar: modificar datos personales, entrenador, objetivos y lesiones. Borrar: eliminar clientes."
  },
  {
    id: "progreso_pr",
    categoria: "Clientes",
    nombre: "Progreso y Marcas Personales (PR)",
    descripcion: "Ver: consultar pestaña Progreso e histórico de marcas en Ficha de Cliente. Crear / Editar: registrar nuevas marcas PR (desde Hoy o desde Ficha). Borrar: eliminar marcas PR."
  },
  {
    id: "ejercicios",
    categoria: "Catálogo y Plantillas",
    nombre: "Catálogo y Fichas de Ejercicios",
    descripcion: "Ver: consultar catálogo y abrir la Ficha Técnica de un ejercicio (también al pulsarlo en Hoy o en Programación). Crear: nuevo ejercicio. Editar: modificar ejercicios y sus maestros. Borrar: eliminar ejercicios."
  },
  {
    id: "plantillas",
    categoria: "Catálogo y Plantillas",
    nombre: "Plantillas de Entrenamiento",
    descripcion: "Ver: consultar catálogo y detalle de plantillas. Crear: crear nuevas plantillas. Editar: modificar metadatos y ejercicios de la plantilla. Borrar: eliminar plantillas."
  },
  {
    id: "maestros",
    categoria: "Administración y Configuración",
    nombre: "Gestión de Maestros (Desplegables)",
    descripcion: "Ver: consultar listas de Configuración (Ejercicios, Sesiones, Clientes, Agenda). Crear: añadir valores. Editar: renombrar y reordenar valores. Borrar: eliminar valores maestros."
  },
  {
    id: "perfiles_roles",
    categoria: "Administración y Configuración",
    nombre: "Gestión de Perfiles (Roles, Usuarios y Permisos)",
    descripcion: "Ver: consultar roles, usuarios y matriz de permisos. Crear: crear roles y vincular usuarios. Editar: cambiar rol asignado y activar/desactivar casillas de permisos. Borrar: eliminar roles."
  },
  {
    id: "copias_seguridad",
    categoria: "Administración y Configuración",
    nombre: "Copias de Seguridad (Google Drive)",
    descripcion: "Ver: consultar historial de copias de seguridad. Crear: generar copia de seguridad manual. Editar: restaurar una copia o configurar la conexión con Google Drive."
  }
];

export function limpiarNombreDoc(clave: string): string {
  const norm = String(clave)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (norm === 'musculos' || norm === 'grupo_muscular') {
    return 'grupos_de_ejercicios';
  }
  return norm;
}

export function generarIdItem(valor: string): string {
  return String(valor)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function limpiarCacheMaestros(): void {
  removeSharedCache(CACHE_KEY, true);
}

export function limpiarCacheProgramadores(): void {
  removeSharedCache(PROGRAMADORES_CACHE_KEY, true);
}

export async function cargarTodosLosMaestros(forzar = false): Promise<Record<string, Record<string, { id: string; valor: string; orden: number }[]>>> {
  if (!forzar) {
    const cached = getSharedCache<Record<string, Record<string, { id: string; valor: string; orden: number }[]>>>(CACHE_KEY);
    if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
      return cached;
    }
  }

  const mapa: Record<string, Record<string, { id: string; valor: string; orden: number }[]>> = {};

  try {
    const snap = await getDocs(collection(db, "maestros"));

    snap.forEach(docSnap => {
      if (docSnap.id.startsWith('config_') || docSnap.id.startsWith('backup_')) return;
      const d = docSnap.data();
      const sec = d.seccion;
      const rawClv = d.clave;
      const valoresObj = d.valores || {};

      if (!sec || !rawClv) return;
      // Normalizar clave "Grupos de Ejercicios" -> "Músculos"
      const clv =
        sec === 'Ejercicios' &&
        (rawClv === 'Grupos de Ejercicios' || rawClv === 'Grupo muscular' || rawClv === 'Musculos')
          ? 'Músculos'
          : rawClv;

      if (!mapa[sec]) mapa[sec] = {};
      if (!mapa[sec][clv]) mapa[sec][clv] = [];

      for (const [itemId, itemData] of Object.entries(valoresObj as Record<string, any>)) {
        if (!itemData || typeof itemData !== 'object' || itemData.valor === undefined) continue;
        const rawValStr = String(itemData.valor).trim();
        if (sec === 'Gestión de Perfiles' && clv === 'Roles' && esRolSuperAdmin(rawValStr)) {
          continue;
        }
        const valStr =
          sec === 'Agenda' && clv === 'Horarios Small Groups'
            ? parsearHorarioSmallGroup(rawValStr).formateado
            : sec === 'Agenda' && clv === 'Festivos'
            ? parsearFestivoMaestro(rawValStr)?.formateado || rawValStr
            : rawValStr;
        if (!mapa[sec][clv].some(existing => existing.id === itemId)) {
          mapa[sec][clv].push({
            id: itemId,
            valor: valStr,
            orden: Number(itemData.orden ?? 99)
          });
        }
      }

      mapa[sec][clv].sort((a, b) => {
        if (a.orden !== b.orden) return a.orden - b.orden;
        return a.valor.localeCompare(b.valor);
      });

      if (sec === 'Ejercicios' && clv === 'Músculos') {
        mapa[sec]['Grupos de Ejercicios'] = mapa[sec]['Músculos'];
      }
    });
  } catch (e) {
    console.warn('Aviso al cargar colección maestros:', e);
  }

  if (!mapa["Sesiones"]) mapa["Sesiones"] = {};
  if (
    !mapa["Sesiones"]["Intensidad de la Sesión"] ||
    mapa["Sesiones"]["Intensidad de la Sesión"].length === 0
  ) {
    mapa["Sesiones"]["Intensidad de la Sesión"] = [
      { id: "low", valor: "LOW", orden: 1 },
      { id: "med", valor: "MED", orden: 2 },
      { id: "high", valor: "HIGH", orden: 3 }
    ];
  }

  if (!mapa["Agenda"]) mapa["Agenda"] = {};
  if (!mapa["Agenda"]["Ocupación máxima"] || mapa["Agenda"]["Ocupación máxima"].length === 0) {
    mapa["Agenda"]["Ocupación máxima"] = [{ id: "6", valor: "6", orden: 1 }];
  }
  if (
    !mapa["Agenda"]["Meses de margen para reprogramar"] ||
    mapa["Agenda"]["Meses de margen para reprogramar"].length === 0
  ) {
    mapa["Agenda"]["Meses de margen para reprogramar"] = [{ id: "1", valor: "1", orden: 1 }];
  }

  setSharedCache(CACHE_KEY, mapa, forzar);

  return mapa;
}

export async function getValoresMaestro(seccion: string, clave: string): Promise<string[]> {
  const mapa = await cargarTodosLosMaestros();
  return (mapa[seccion] && mapa[seccion][clave])
    ? mapa[seccion][clave].map(item => item.valor)
    : [];
}

export async function getMesesMargenReprogramacion(): Promise<number> {
  try {
    const vals = await getValoresMaestro("Agenda", "Meses de margen para reprogramar");
    if (vals.length > 0) {
      const parsed = parseInt(vals[0], 10);
      if (!isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Error leyendo Meses de margen para reprogramar:", e);
  }
  return 1;
}

export function obtenerFechaLimiteReprogramacionUTC(
  mesesMargen = 1,
  fechaReferencia = new Date()
): Date {
  const margenSeguro = !isNaN(mesesMargen) && mesesMargen >= 0 ? mesesMargen : 1;
  return new Date(
    Date.UTC(
      fechaReferencia.getFullYear(),
      fechaReferencia.getMonth() - margenSeguro,
      1,
      0,
      0,
      0,
      0
    )
  );
}

export async function guardarValorMaestro(
  seccion: string,
  clave: string,
  valor: string,
  orden: number | null = null,
  editId: string | null = null
): Promise<void> {
  const valLimpio =
    seccion === 'Agenda' && clave === 'Horarios Small Groups'
      ? parsearHorarioSmallGroup(valor).formateado
      : seccion === 'Agenda' && clave === 'Festivos'
      ? parsearFestivoMaestro(valor)?.formateado || String(valor).trim()
      : String(valor).trim();
  if (!valLimpio) return;

  const docKey = limpiarNombreDoc(clave);
  const itemId = generarIdItem(valLimpio);
  const docRef = doc(db, "maestros", docKey);

  const snap = await getDoc(docRef);
  const valoresActuales: Record<string, any> = snap.exists()
    ? { ...(snap.data().valores || {}) }
    : {};

  let ordenFinal = orden !== null && orden !== undefined ? Number(orden) : null;

  if (editId && valoresActuales[editId]) {
    if (ordenFinal === null) {
      ordenFinal = Number(valoresActuales[editId].orden ?? Object.keys(valoresActuales).length);
    }
    if (editId !== itemId) {
      delete valoresActuales[editId];
    }
  } else if (ordenFinal === null) {
    if (valoresActuales[itemId] && valoresActuales[itemId].orden !== undefined) {
      ordenFinal = Number(valoresActuales[itemId].orden);
    } else {
      const ordenes = Object.values(valoresActuales)
        .map(x => Number(x.orden))
        .filter(n => !isNaN(n) && n !== 99);
      const maxOrden = ordenes.length > 0 ? Math.max(...ordenes) : Object.keys(valoresActuales).length;
      ordenFinal = maxOrden + 1;
    }
  }

  valoresActuales[itemId] = {
    seccion,
    clave,
    valor: valLimpio,
    orden: Number(ordenFinal)
  };

  await setDoc(docRef, {
    seccion,
    clave,
    valores: valoresActuales
  });

  limpiarCacheMaestros();
}

export async function reordenarValoresMaestro(
  seccion: string,
  clave: string,
  listaItemsOrdenados: { id?: string; valor: string }[]
): Promise<void> {
  const docKey = limpiarNombreDoc(clave);
  const docRef = doc(db, "maestros", docKey);

  const nuevosValores: Record<string, any> = {};
  listaItemsOrdenados.forEach((item, index) => {
    const rawLimpio = String(item.valor).trim();
    const valLimpio =
      seccion === 'Agenda' && clave === 'Horarios Small Groups'
        ? parsearHorarioSmallGroup(rawLimpio).formateado
        : seccion === 'Agenda' && clave === 'Festivos'
        ? parsearFestivoMaestro(rawLimpio)?.formateado || rawLimpio
        : rawLimpio;
    const itemId = item.id || generarIdItem(valLimpio);
    nuevosValores[itemId] = {
      seccion,
      clave,
      valor: valLimpio,
      orden: index + 1
    };
  });

  await setDoc(docRef, {
    seccion,
    clave,
    valores: nuevosValores
  });

  limpiarCacheMaestros();
}

export async function eliminarValorMaestro(
  clave: string,
  itemId: string,
  valorTarget?: string
): Promise<void> {
  const docKey = limpiarNombreDoc(clave);
  const docRef = doc(db, "maestros", docKey);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    const data = snap.data() || {};
    const valoresActuales: Record<string, any> = { ...(data.valores || {}) };
    delete valoresActuales[itemId];
    if (valorTarget) {
      const targetNorm = String(valorTarget).trim().toLowerCase();
      for (const [k, v] of Object.entries(valoresActuales)) {
        if (String(v?.valor || '').trim().toLowerCase() === targetNorm) {
          delete valoresActuales[k];
        }
      }
    }
    const entradasOrdenadas = Object.entries(valoresActuales).sort(
      (a, b) => Number(a[1]?.orden ?? 99) - Number(b[1]?.orden ?? 99)
    );
    const nuevosValores: Record<string, any> = {};
    entradasOrdenadas.forEach(([k, v], idx) => {
      nuevosValores[k] = {
        ...v,
        orden: idx + 1
      };
    });
    await setDoc(docRef, {
      seccion: data.seccion || "Agenda",
      clave: data.clave || clave,
      valores: nuevosValores
    });
  } else {
    await updateDoc(docRef, {
      [`valores.${itemId}`]: deleteField()
    });
  }
  limpiarCacheMaestros();
}

export const SUPERADMIN_EMAIL = 'ccalvotriana@gmail.com';
export const PROYECTOR_SALA_EMAIL = 'tvsala@goandtrain.com';

export function esCorreoSuperAdmin(email?: string | null): boolean {
  return String(email || '').trim().toLowerCase() === SUPERADMIN_EMAIL;
}

export function esCorreoProyectorSala(email?: string | null): boolean {
  const e = String(email || '').trim().toLowerCase();
  return e === PROYECTOR_SALA_EMAIL || e.startsWith('tvsala@');
}

export function esRolSuperAdmin(nombreRol: string): boolean {
  const rNorm = String(nombreRol || '')
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return rNorm === 'superadmin' || rNorm === 'super_admin' || rNorm === 'superadministrador';
}

export function esRolAdmin(nombreRol: string): boolean {
  if (esRolSuperAdmin(nombreRol)) return true;
  const rNorm = String(nombreRol || '')
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return rNorm === 'admin' || rNorm === 'administrador' || rNorm === 'direccion';
}

export function esRolProyectorSala(nombreRol: string): boolean {
  const rNorm = String(nombreRol || '')
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return rNorm === 'proyector sala' || rNorm === 'proyector_sala' || rNorm === 'proyector' || rNorm === 'tvsala';
}

export function esRolBasico(nombreRol: string): boolean {
  const rNorm = String(nombreRol || '')
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return rNorm === 'basico' || rNorm === 'rol basico';
}

export type ModuloAppId = 'plantillas' | 'tv' | 'small_group' | 'go_kids';

export interface ModuloAppMeta {
  id: ModuloAppId;
  nombre: string;
  icono: string;
  descripcion: string;
  alcance: string[];
}

export const CATALOGO_MODULOS_FIJOS: {
  id: string;
  nombre: string;
  icono: string;
  descripcion: string;
}[] = [
  {
    id: 'planificacion',
    nombre: 'Hoy y Planificación',
    icono: '📅',
    descripcion: 'Panel diario de sesiones, seguimiento de entrenamientos y estados de sesión.'
  },
  {
    id: 'clientes',
    nombre: 'Clientes',
    icono: '👥',
    descripcion: 'Directorio de clientes, fichas personales, objetivos, historial de sesiones y marcas PR.'
  },
  {
    id: 'ejercicios',
    nombre: 'Ejercicios',
    icono: '🏋️',
    descripcion: 'Catálogo de ejercicios, bloques, materiales, vídeos y categorización técnica.'
  },
  {
    id: 'agenda',
    nombre: 'Agenda',
    icono: '🗓️',
    descripcion: 'Calendario semanal, planificación mensual de citas, reprogramaciones y festivos.'
  },
  {
    id: 'configuracion',
    nombre: 'Configuración',
    icono: '⚙️',
    descripcion: 'Maestros del sistema, gestión de perfiles, roles, permisos y copias de seguridad.'
  }
];

export const CATALOGO_MODULOS_APP: ModuloAppMeta[] = [
  {
    id: 'plantillas',
    nombre: 'Plantillas',
    icono: '📋',
    descripcion: 'Catálogo de plantillas predefinidas, importación en sesiones y envío como plantilla.',
    alcance: [
      'Pestaña Plantillas en la barra de navegación',
      'Botón Importar Plantilla al programar una sesión',
      'Pestaña Plantilla en Enviar Programación'
    ]
  },
  {
    id: 'tv',
    nombre: 'TV / Pantalla Sala',
    icono: '📺',
    descripcion: 'Proyección de entrenamientos en tiempo real para la pantalla de TV del gimnasio.',
    alcance: [
      'Botón Pantalla Sala en la vista Hoy',
      'Vista de proyección de TV y acceso para tvsala@goandtrain.com'
    ]
  },
  {
    id: 'small_group',
    nombre: 'Small Group',
    icono: '👟',
    descripcion: 'Gestión de horarios, reservas grupales y programación conjunta de sesiones Small Group.',
    alcance: [
      'Vista y pestaña Small Groups en Agenda y bloque Small Groups en Hoy',
      'Opción Small Group en Planificar Días del Mes y Enviar Programación',
      'Maestro Horarios Small Groups en Configuración -> Agenda'
    ]
  },
  {
    id: 'go_kids',
    nombre: 'Servicio Go&Kids',
    icono: '🧒',
    descripcion: 'Control del servicio infantil Go&Kids, niños contratados y nombres en las fichas de cliente.',
    alcance: [
      'Tarjeta Servicio Go&Kids en la Ficha de Cliente',
      'Campos de contratación y nombres de niños en alta y edición de clientes'
    ]
  }
];

export const MODULOS_ACTIVOS_DEFAULT: Record<ModuloAppId, boolean> = {
  plantillas: true,
  tv: true,
  small_group: true,
  go_kids: true
};

const MODULOS_CACHE_KEY = 'gym_modulos_activos_cache_v1';

export function limpiarCacheModulosActivos(): void {
  removeSharedCache(MODULOS_CACHE_KEY, true);
}

export async function cargarModulosActivos(
  forzar = false
): Promise<Record<ModuloAppId, boolean>> {
  if (!forzar) {
    const parsed = getSharedCache<Record<string, any>>(MODULOS_CACHE_KEY);
    if (parsed && typeof parsed === 'object') {
      return {
        plantillas: parsed.plantillas !== false,
        tv: parsed.tv !== false,
        small_group: parsed.small_group !== false,
        go_kids: parsed.go_kids !== false
      };
    }
  }

  try {
    const snap = await getDoc(doc(db, 'maestros', 'config_modulos_app'));
    if (!snap.exists()) {
      const init = { ...MODULOS_ACTIVOS_DEFAULT };
      setSharedCache(MODULOS_CACHE_KEY, init, forzar);
      return init;
    }
    const raw = snap.data()?.modulos || {};
    const result: Record<ModuloAppId, boolean> = {
      plantillas: raw.plantillas !== false,
      tv: raw.tv !== false,
      small_group: raw.small_group !== false,
      go_kids: raw.go_kids !== false
    };
    setSharedCache(MODULOS_CACHE_KEY, result, forzar);
    return result;
  } catch (e) {
    console.warn('Error cargando config_modulos_app:', e);
    return { ...MODULOS_ACTIVOS_DEFAULT };
  }
}

export async function guardarModulosActivos(
  nuevosModulos: Record<ModuloAppId, boolean>
): Promise<void> {
  const limpio: Record<ModuloAppId, boolean> = {
    plantillas: nuevosModulos.plantillas !== false,
    tv: nuevosModulos.tv !== false,
    small_group: nuevosModulos.small_group !== false,
    go_kids: nuevosModulos.go_kids !== false
  };
  await setDoc(doc(db, 'maestros', 'config_modulos_app'), {
    schema_version: 1,
    modulos: limpio,
    updated_at: new Date().toISOString()
  });
  setSharedCache(MODULOS_CACHE_KEY, limpio, true);
}

export function normalizarPermisosAccion(
  val: any,
  defaultObj: PermisoAccion = { ver: false, editar: false, crear: false, borrar: false }
): PermisoAccion {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return {
      ver: val.ver !== undefined ? Boolean(val.ver) : Boolean(defaultObj.ver),
      editar: val.editar !== undefined ? Boolean(val.editar) : Boolean(defaultObj.editar),
      crear: val.crear !== undefined ? Boolean(val.crear) : Boolean(defaultObj.crear),
      borrar: val.borrar !== undefined ? Boolean(val.borrar) : Boolean(defaultObj.borrar)
    };
  }
  return { ...defaultObj };
}

export function PermisosPorDefectoParaRol(nombreRol: string): Record<string, PermisoAccion> {
  const rNorm = String(nombreRol || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isAdmin = esRolAdmin(nombreRol);
  const isProyector = esRolProyectorSala(nombreRol);
  const isBasico = esRolBasico(nombreRol);
  const isLectura = rNorm === 'recepcion' || rNorm === 'consulta' || rNorm === 'lectura';

  const mapa: Record<string, PermisoAccion> = {};
  CATALOGO_PERMISOS_APP.forEach(p => {
    if (isAdmin) {
      mapa[p.id] = { ver: true, editar: true, crear: true, borrar: true };
    } else if (isProyector) {
      mapa[p.id] = { ver: p.id === 'pantalla_sala', editar: false, crear: false, borrar: false };
    } else if (isBasico) {
      // Rol Básico configurado en la matriz:
      // - Hoy (planificacion): Ver y Editar (marcar Completada / Pendiente)
      // - Agenda (agenda): solo Ver (sin Reprogramar, sin Agendar, sin Cancelar/Eliminar)
      // - Programación de Sesiones (programar_sesiones): solo Ver (modo lectura)
      // - Ejercicios (ejercicios): solo Ver (catálogo y ficha técnica)
      // - Todo lo demás (incluyendo Enviar Programación y Clientes): desactivado
      if (p.id === 'planificacion') {
        mapa[p.id] = { ver: true, editar: true, crear: false, borrar: false };
      } else if (p.id === 'agenda' || p.id === 'programar_sesiones' || p.id === 'ejercicios') {
        mapa[p.id] = { ver: true, editar: false, crear: false, borrar: false };
      } else {
        mapa[p.id] = { ver: false, editar: false, crear: false, borrar: false };
      }
    } else if (isLectura) {
      if (['planificacion', 'pantalla_sala', 'clientes', 'ejercicios', 'plantillas'].includes(p.id)) {
        mapa[p.id] = { ver: true, editar: false, crear: false, borrar: false };
      } else if (p.id === 'agenda') {
        mapa[p.id] = { ver: true, editar: true, crear: true, borrar: false };
      } else {
        mapa[p.id] = { ver: false, editar: false, crear: false, borrar: false };
      }
    } else {
      // Programador / Entrenador
      if (p.id === 'pantalla_sala') {
        mapa[p.id] = { ver: true, editar: false, crear: false, borrar: false };
      } else if (p.id === 'planificacion' || p.id === 'programaciones_pendientes' || p.id === 'enviar_programacion') {
        mapa[p.id] = { ver: true, editar: true, crear: true, borrar: false };
      } else if (p.id === 'clientes') {
        mapa[p.id] = { ver: true, editar: true, crear: false, borrar: false };
      } else if (p.id === 'maestros' || p.id === 'perfiles_roles') {
        mapa[p.id] = { ver: true, editar: false, crear: false, borrar: false };
      } else if (p.id === 'copias_seguridad') {
        mapa[p.id] = { ver: false, editar: false, crear: false, borrar: false };
      } else {
        mapa[p.id] = { ver: true, editar: true, crear: true, borrar: true };
      }
    }
  });
  return mapa;
}

function buscarEntradaRolEnObjeto(
  matriz: Record<string, any> | null | undefined,
  nombreRol: string
): Record<string, any> | undefined {
  if (!matriz || typeof matriz !== 'object') return undefined;
  if (matriz[nombreRol] && typeof matriz[nombreRol] === 'object') {
    return matriz[nombreRol];
  }

  const targetNorm = String(nombreRol || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const matchingKey = Object.keys(matriz).find(k => {
    const kNorm = String(k || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (kNorm === targetNorm) return true;
    if (esRolBasico(nombreRol) && esRolBasico(k)) return true;
    if (esRolAdmin(nombreRol) && esRolAdmin(k)) return true;
    if (esRolProyectorSala(nombreRol) && esRolProyectorSala(k)) return true;
    return false;
  });

  return matchingKey ? matriz[matchingKey] : undefined;
}

export function obtenerPermisosRolDesdeMatriz(
  matriz: MatrizPermisos | null | undefined,
  nombreRol: string
): Record<string, PermisoAccion> {
  const defaults = PermisosPorDefectoParaRol(nombreRol);
  const entradaRol = buscarEntradaRolEnObjeto(matriz, nombreRol);
  if (!entradaRol) {
    return defaults;
  }

  const resultado: Record<string, PermisoAccion> = {};
  CATALOGO_PERMISOS_APP.forEach(p => {
    resultado[p.id] = normalizarPermisosAccion(entradaRol?.[p.id], defaults[p.id]);
  });
  return resultado;
}

export async function asegurarRolesYPermisosIniciales(): Promise<{ roles: string[]; matriz: MatrizPermisos }> {
  try {
    // Asegurar valor por defecto "6" para "Ocupación máxima" y "1" para "Meses de margen para reprogramar" en Agenda
    try {
      const ocupacionDocKey = limpiarNombreDoc("Ocupación máxima");
      const ocupacionSnap = await getDoc(doc(db, "maestros", ocupacionDocKey));
      if (!ocupacionSnap.exists() || !ocupacionSnap.data()?.valores || Object.keys(ocupacionSnap.data().valores).length === 0) {
        await guardarValorMaestro("Agenda", "Ocupación máxima", "6", 1);
      }

      const mesesReprogDocKey = limpiarNombreDoc("Meses de margen para reprogramar");
      const mesesReprogSnap = await getDoc(doc(db, "maestros", mesesReprogDocKey));
      if (!mesesReprogSnap.exists() || !mesesReprogSnap.data()?.valores || Object.keys(mesesReprogSnap.data().valores).length === 0) {
        await guardarValorMaestro("Agenda", "Ocupación máxima", "6", 1);
        await guardarValorMaestro("Agenda", "Meses de margen para reprogramar", "1", 1);
      }

      const intSesionDocKey = limpiarNombreDoc("Intensidad de la Sesión");
      const intSesionSnap = await getDoc(doc(db, "maestros", intSesionDocKey));
      if (!intSesionSnap.exists() || !intSesionSnap.data()?.valores || Object.keys(intSesionSnap.data().valores).length === 0) {
        await reordenarValoresMaestro("Sesiones", "Intensidad de la Sesión", [
          { id: "low", valor: "LOW" },
          { id: "med", valor: "MED" },
          { id: "high", valor: "HIGH" }
        ]);
      }

      // Traducir / normalizar los valores actuales de "Horarios Small Groups" a formato <Día> <HH:MM> (media en media hora)
      const sgDocKey = limpiarNombreDoc("Horarios Small Groups");
      const sgSnap = await getDoc(doc(db, "maestros", sgDocKey));
      if (sgSnap.exists() && sgSnap.data()?.valores) {
        const valoresSG = sgSnap.data().valores as Record<string, any>;
        const entries = Object.entries(valoresSG).sort(
          (a, b) => Number(a[1]?.orden ?? 99) - Number(b[1]?.orden ?? 99)
        );
        let requiereNormalizar = false;
        const normalizados: { id: string; valor: string }[] = [];
        const vistos = new Set<string>();
        for (const [k, v] of entries) {
          const parsed = parsearHorarioSmallGroup(String(v?.valor || ''));
          const idEsperado = generarIdItem(parsed.formateado);
          if (v?.valor !== parsed.formateado || k !== idEsperado) {
            requiereNormalizar = true;
          }
          if (!vistos.has(idEsperado)) {
            vistos.add(idEsperado);
            normalizados.push({ id: idEsperado, valor: parsed.formateado });
          } else {
            requiereNormalizar = true;
          }
        }
        if (requiereNormalizar) {
          await reordenarValoresMaestro("Agenda", "Horarios Small Groups", normalizados);
        }
      }
    } catch (errOcup) {
      console.warn("No se pudo asegurar valores por defecto de Agenda/Sesiones:", errOcup);
    }

    const rolesExistentes = await getValoresMaestro("Gestión de Perfiles", "Roles");
    const tieneBasico = rolesExistentes.some(r => esRolBasico(r));
    if (!tieneBasico) {
      try {
        await guardarValorMaestro("Gestión de Perfiles", "Roles", "Básico");
      } catch (errRol) {
        console.warn("No se pudo guardar rol Básico en maestros:", errRol);
      }
    }
    const tieneProyector = rolesExistentes.some(r => esRolProyectorSala(r));
    if (!tieneProyector) {
      try {
        await guardarValorMaestro("Gestión de Perfiles", "Roles", "Proyector Sala");
      } catch (errRol) {
        console.warn("No se pudo guardar rol Proyector Sala en maestros:", errRol);
      }
    }

    const rolesSet = new Set(['admin', 'programador', 'Básico', 'Proyector Sala', ...rolesExistentes]);

    const matrizRef = doc(db, "maestros", "config_permisos_roles");
    const matrizSnap = await getDoc(matrizRef);
    const schemaVersion = matrizSnap.exists() ? Number(matrizSnap.data()?.schema_version || 0) : 0;
    const esVersion3 = schemaVersion === 3;
    const rolesExistentesMatriz = schemaVersion >= 2 ? (matrizSnap.data()?.roles || {}) : {};
    const matrizLimpia: MatrizPermisos = {};

    Array.from(rolesSet).forEach(rol => {
      const defaultsRol = PermisosPorDefectoParaRol(rol);
      // En la migración a schema_version 3, el rol Básico queda inicializado con sus permisos limpios marcados en la matriz
      if (!esVersion3 && esRolBasico(rol)) {
        matrizLimpia[rol] = { ...defaultsRol };
        return;
      }
      const prevRol = buscarEntradaRolEnObjeto(rolesExistentesMatriz, rol) || {};
      matrizLimpia[rol] = {};
      CATALOGO_PERMISOS_APP.forEach(p => {
        if (!esVersion3 && p.id === 'enviar_programacion' && prevRol[p.id] === undefined && prevRol.programar_sesiones) {
          const puedeEnviarPrev = Boolean(prevRol.programar_sesiones.editar || prevRol.programar_sesiones.crear);
          matrizLimpia[rol][p.id] = {
            ver: puedeEnviarPrev,
            editar: puedeEnviarPrev,
            crear: puedeEnviarPrev,
            borrar: false
          };
        } else {
          matrizLimpia[rol][p.id] = normalizarPermisosAccion(prevRol[p.id], defaultsRol[p.id]);
        }
      });
    });

    if (!esVersion3) {
      try {
        await setDoc(matrizRef, {
          schema_version: 3,
          roles: matrizLimpia,
          updated_at: new Date().toISOString()
        });
      } catch {
        // Silencioso si el usuario actual no tiene permisos de escritura en maestros
      }
    }

    return { roles: Array.from(rolesSet), matriz: matrizLimpia };
  } catch (e) {
    console.warn("Error en asegurarRolesYPermisosIniciales:", e);
    const defaultRoles = ['admin', 'programador', 'Básico', 'Proyector Sala'];
    const defaultMatriz: MatrizPermisos = {};
    defaultRoles.forEach(r => defaultMatriz[r] = PermisosPorDefectoParaRol(r));
    return { roles: defaultRoles, matriz: defaultMatriz };
  }
}

export async function cargarMatrizPermisos(forzar = false): Promise<MatrizPermisos> {
  if (!forzar) {
    const cached = getSharedCache<MatrizPermisos>(MATRIZ_PERMISOS_CACHE_KEY);
    if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
      return cached;
    }
  }
  try {
    const matrizRef = doc(db, "maestros", "config_permisos_roles");
    const snap = await getDoc(matrizRef);
    if (!snap.exists() || snap.data().schema_version !== 3) {
      const init = await asegurarRolesYPermisosIniciales();
      setSharedCache(MATRIZ_PERMISOS_CACHE_KEY, init.matriz, forzar);
      return init.matriz;
    }
    const rolesRaw = snap.data().roles || {};
    const rolesNormalizados: MatrizPermisos = {};
    const todosLosRoles = new Set(['admin', 'programador', 'Básico', 'Proyector Sala', ...Object.keys(rolesRaw)]);
    for (const rol of todosLosRoles) {
      const mapaRol = buscarEntradaRolEnObjeto(rolesRaw, rol);
      const defaultsRol = PermisosPorDefectoParaRol(rol);
      rolesNormalizados[rol] = {};
      CATALOGO_PERMISOS_APP.forEach(p => {
        rolesNormalizados[rol][p.id] = normalizarPermisosAccion(mapaRol ? mapaRol[p.id] : undefined, defaultsRol[p.id]);
      });
    }
    setSharedCache(MATRIZ_PERMISOS_CACHE_KEY, rolesNormalizados, forzar);
    return rolesNormalizados;
  } catch (e) {
    const init = await asegurarRolesYPermisosIniciales();
    return init.matriz;
  }
}

export async function guardarMatrizPermisos(nuevaMatriz: MatrizPermisos): Promise<void> {
  const matrizRef = doc(db, "maestros", "config_permisos_roles");
  await setDoc(matrizRef, {
    schema_version: 3,
    roles: nuevaMatriz,
    updated_at: new Date().toISOString()
  });
  setSharedCache(MATRIZ_PERMISOS_CACHE_KEY, nuevaMatriz, true);
}

const LOCAL_USUARIOS_CONFIG_KEY = 'gym_config_usuarios_app_v1';

function leerCacheLocalUsuariosConfig(): Record<string, any> {
  const parsed = getSharedCache<Record<string, any>>(LOCAL_USUARIOS_CONFIG_KEY);
  if (parsed && typeof parsed === 'object') {
    return { ...parsed };
  }
  return {};
}

function guardarCacheLocalUsuariosConfig(mapa: Record<string, any>, emitNotification = false): void {
  setSharedCache(LOCAL_USUARIOS_CONFIG_KEY, { ...mapa }, emitNotification);
}

export async function obtenerMapaUsuariosConfigurados(): Promise<Record<string, any>> {
  const localMap = leerCacheLocalUsuariosConfig();
  try {
    const cfgSnap = await getDoc(doc(db, 'maestros', 'config_usuarios_app'));
    if (cfgSnap.exists()) {
      const remoteUsuarios = cfgSnap.data()?.usuarios || {};
      const merged = {
        ...remoteUsuarios,
        ...localMap
      };
      guardarCacheLocalUsuariosConfig(merged);
      return merged;
    }
  } catch {
    // Usar caché local si falla la lectura remota
  }
  return localMap;
}

export async function guardarUsuarioAppEnFirestore(
  docId: string,
  payload: Record<string, any>
): Promise<{
  prevUserDocData: Record<string, any> | null;
  nextUserDocData: Record<string, any>;
  targetDocId: string;
}> {
  const cleanKey = String(payload.email || docId).trim().toLowerCase() || docId;
  const localPrev = leerCacheLocalUsuariosConfig();

  // Si el usuario autenticado es SuperAdmin, asegurar antes que su propio documento en usuarios_app tenga rol: 'admin' para que las reglas de Firestore autoricen la escritura
  if (esCorreoSuperAdmin(auth.currentUser?.email)) {
    try {
      const superRef = doc(db, 'usuarios_app', SUPERADMIN_EMAIL);
      const superSnap = await getDoc(superRef);
      if (superSnap.exists() && superSnap.data()?.rol !== 'admin') {
        await fbSetDoc(superRef, { rol: 'admin' }, { merge: true });
      }
    } catch {
      // ignore
    }
  }

  let targetDocId = cleanKey;
  let prevUserDocData: Record<string, any> | null = null;

  try {
    const userRefPrimary = doc(db, 'usuarios_app', docId);
    const snapPrimary = await getDoc(userRefPrimary);
    if (snapPrimary.exists()) {
      targetDocId = docId;
      prevUserDocData = JSON.parse(JSON.stringify(snapPrimary.data()));
    } else if (cleanKey !== docId) {
      const userRefClean = doc(db, 'usuarios_app', cleanKey);
      const snapClean = await getDoc(userRefClean);
      if (snapClean.exists()) {
        targetDocId = cleanKey;
        prevUserDocData = JSON.parse(JSON.stringify(snapClean.data()));
      }
    }
  } catch {
    prevUserDocData = null;
  }

  const nextUserDocData: Record<string, any> = {
    ...(prevUserDocData || {}),
    ...(localPrev[docId] || {}),
    ...(localPrev[cleanKey] || {}),
    ...payload,
    email: payload.email || (cleanKey.includes('@') ? cleanKey : prevUserDocData?.email || '')
  };

  // 1. Escribir directamente en la colección usuarios_app de Firestore
  await fbSetDoc(doc(db, 'usuarios_app', targetDocId), nextUserDocData, { merge: true });

  // 2. Actualizar caché local y espejo en maestros/config_usuarios_app
  const usuariosPrev: Record<string, any> = {
    ...localPrev,
    [cleanKey]: nextUserDocData
  };
  if (targetDocId !== cleanKey) {
    usuariosPrev[targetDocId] = nextUserDocData;
  }
  guardarCacheLocalUsuariosConfig(usuariosPrev, true);
  limpiarCacheProgramadores();

  try {
    const cfgRef = doc(db, 'maestros', 'config_usuarios_app');
    await setDoc(
      cfgRef,
      {
        schema_version: 1,
        seccion: 'Gestión de Perfiles',
        clave: 'Usuarios App',
        usuarios: usuariosPrev,
        updated_at: new Date().toISOString()
      },
      { merge: true }
    );
  } catch {
    // Silencioso si falla espejo secundario
  }

  return { prevUserDocData, nextUserDocData, targetDocId };
}

export async function asegurarUsuariosEspecialesApp(): Promise<void> {
  try {
    // 1. Si es SuperAdmin, garantizar que su documento en usuarios_app tenga rol 'admin' en Firestore para cumplir las reglas de seguridad
    if (esCorreoSuperAdmin(auth.currentUser?.email)) {
      try {
        const superRef = doc(db, 'usuarios_app', SUPERADMIN_EMAIL);
        const superSnap = await getDoc(superRef);
        if (superSnap.exists() && superSnap.data()?.rol !== 'admin') {
          await fbSetDoc(superRef, { rol: 'admin' }, { merge: true });
        }
      } catch {
        // Silencioso
      }
    }

    const actuales = await obtenerMapaUsuariosConfigurados();
    let huboCambios = false;

    // 2. Asegurar tvsala@goandtrain.com en usuarios_app de Firestore
    const tvPayload = {
      email: PROYECTOR_SALA_EMAIL,
      nombre: actuales[PROYECTOR_SALA_EMAIL]?.nombre || 'TV Sala',
      alias: actuales[PROYECTOR_SALA_EMAIL]?.alias || 'TV Sala',
      rol: 'Proyector Sala',
      es_programador: false
    };
    try {
      const tvRef = doc(db, 'usuarios_app', PROYECTOR_SALA_EMAIL);
      const tvSnap = await getDoc(tvRef);
      if (
        !tvSnap.exists() ||
        tvSnap.data()?.rol !== 'Proyector Sala' ||
        tvSnap.data()?.es_programador !== false
      ) {
        await fbSetDoc(tvRef, tvPayload, { merge: true });
      }
    } catch {
      // Silencioso si el usuario actual no tiene permisos de escritura en usuarios_app
    }
    if (!actuales[PROYECTOR_SALA_EMAIL]) {
      actuales[PROYECTOR_SALA_EMAIL] = tvPayload;
      huboCambios = true;
    }

    // 3. Asegurar invitado@goandtrain.com en usuarios_app de Firestore
    const invitadoPrev = actuales['invitado@goandtrain.com'];
    const invitadoPayload = {
      email: 'invitado@goandtrain.com',
      nombre: invitadoPrev?.nombre || 'Básico',
      alias: invitadoPrev?.alias || invitadoPrev?.nombre || 'Básico',
      rol: invitadoPrev?.rol || 'Básico',
      es_programador:
        invitadoPrev?.rol && !esRolBasico(invitadoPrev.rol) && !esRolProyectorSala(invitadoPrev.rol)
          ? invitadoPrev.es_programador !== false
          : false
    };
    try {
      const invRef = doc(db, 'usuarios_app', 'invitado@goandtrain.com');
      const invSnap = await getDoc(invRef);
      if (!invSnap.exists()) {
        await fbSetDoc(invRef, invitadoPayload, { merge: true });
      }
    } catch {
      // Silencioso si el usuario actual no tiene permisos de escritura en usuarios_app
    }
    if (!actuales['invitado@goandtrain.com']) {
      actuales['invitado@goandtrain.com'] = invitadoPayload;
      huboCambios = true;
    }

    // 4. Sincronizar cualquier otro usuario vinculado en config_usuarios_app que aún no exista en usuarios_app de Firestore
    for (const [keyId, rawUser] of Object.entries(actuales)) {
      if (!rawUser || typeof rawUser !== 'object') continue;
      const emailU = String(rawUser.email || (keyId.includes('@') ? keyId : '')).trim().toLowerCase();
      if (!emailU || esCorreoSuperAdmin(emailU)) continue;
      try {
        const uRef = doc(db, 'usuarios_app', emailU);
        const uSnap = await getDoc(uRef);
        if (!uSnap.exists()) {
          await fbSetDoc(
            uRef,
            {
              email: emailU,
              nombre: rawUser.nombre || rawUser.alias || emailU,
              alias: rawUser.alias || rawUser.nombre || emailU,
              rol: rawUser.rol || 'Básico',
              es_programador: Boolean(rawUser.es_programador)
            },
            { merge: true }
          );
        }
      } catch {
        // Silencioso
      }
    }

    if (huboCambios) {
      guardarCacheLocalUsuariosConfig(actuales);
      try {
        await setDoc(
          doc(db, 'maestros', 'config_usuarios_app'),
          {
            schema_version: 1,
            seccion: 'Gestión de Perfiles',
            clave: 'Usuarios App',
            usuarios: actuales,
            updated_at: new Date().toISOString()
          },
          { merge: true }
        );
      } catch {
        // Silencioso
      }
    }
  } catch {
    // Silencioso en segundo plano
  }
}

export async function cargarUsuariosAutenticacion(): Promise<UsuarioApp[]> {
  try {
    await asegurarUsuariosEspecialesApp();

    const mapaUsuarios = new Map<string, UsuarioApp>();

    try {
      const snap = await getDocs(collection(db, "usuarios_app"));
      snap.forEach(docSnap => {
        const d = docSnap.data();
        const emailDoc = String(d.email || (docSnap.id.includes('@') ? docSnap.id : '')).trim();
        const emailLower = emailDoc.toLowerCase();
        // Ocultar al usuario SuperAdmin y el rol SuperAdmin para que nunca aparezca como admin ni como otro rol
        if (
          esCorreoSuperAdmin(emailLower) ||
          esCorreoSuperAdmin(docSnap.id) ||
          esRolSuperAdmin(d.rol || '')
        ) {
          return;
        }
        if (esCorreoProyectorSala(emailLower)) {
          mapaUsuarios.set(PROYECTOR_SALA_EMAIL, {
            id: PROYECTOR_SALA_EMAIL,
            email: PROYECTOR_SALA_EMAIL,
            nombre: d.nombre && d.nombre.toLowerCase() !== 'tvsala' ? d.nombre : 'TV Sala',
            alias: d.alias || 'TV Sala',
            rol: 'Proyector Sala',
            es_programador: false
          });
          return;
        }
        const keyMap = emailLower || docSnap.id;
        mapaUsuarios.set(keyMap, {
          id: keyMap,
          email: emailDoc,
          nombre: d.nombre || d.alias || d.nombre_corto || docSnap.id,
          alias: d.alias || d.nombre_corto || d.nombre || '',
          rol: d.rol || 'Sin asignar',
          es_programador:
            d.es_programador !== false &&
            !esRolBasico(d.rol || '') &&
            !esRolProyectorSala(d.rol || '')
        });
      });
    } catch (e) {
      console.warn("Aviso leyendo colección usuarios_app:", e);
    }

    const usuariosCfg = await obtenerMapaUsuariosConfigurados();
    for (const [docId, rawU] of Object.entries(usuariosCfg)) {
      if (!rawU || typeof rawU !== 'object') continue;
      const emailDoc = String(rawU.email || (docId.includes('@') ? docId : '')).trim();
      const emailLower = emailDoc.toLowerCase();
      if (
        esCorreoSuperAdmin(emailLower) ||
        esCorreoSuperAdmin(docId) ||
        esRolSuperAdmin(rawU.rol || '')
      ) {
        continue;
      }
      const keyMap = emailLower || docId;
      const existing = mapaUsuarios.get(keyMap) || mapaUsuarios.get(docId);
      if (esCorreoProyectorSala(emailLower)) {
        mapaUsuarios.set(PROYECTOR_SALA_EMAIL, {
          id: PROYECTOR_SALA_EMAIL,
          email: PROYECTOR_SALA_EMAIL,
          nombre: rawU.nombre || existing?.nombre || 'TV Sala',
          alias: rawU.alias || existing?.alias || 'TV Sala',
          rol: 'Proyector Sala',
          es_programador: false
        });
      } else {
        const rolResuelto = rawU.rol || existing?.rol || 'Básico';
        const esProgResuelto =
          esRolBasico(rolResuelto) || esRolProyectorSala(rolResuelto)
            ? false
            : rawU.es_programador !== undefined
            ? rawU.es_programador !== false
            : (existing?.es_programador ?? true);
        mapaUsuarios.set(keyMap, {
          id: keyMap,
          email: emailDoc || existing?.email || '',
          nombre: rawU.nombre || existing?.nombre || docId,
          alias: rawU.alias || existing?.alias || rawU.nombre || '',
          rol: rolResuelto,
          es_programador: esProgResuelto
        });
      }
    }

    if (!mapaUsuarios.has(PROYECTOR_SALA_EMAIL)) {
      mapaUsuarios.set(PROYECTOR_SALA_EMAIL, {
        id: PROYECTOR_SALA_EMAIL,
        email: PROYECTOR_SALA_EMAIL,
        nombre: 'TV Sala',
        alias: 'TV Sala',
        rol: 'Proyector Sala',
        es_programador: false
      });
    }

    if (!mapaUsuarios.has('invitado@goandtrain.com')) {
      mapaUsuarios.set('invitado@goandtrain.com', {
        id: 'invitado@goandtrain.com',
        email: 'invitado@goandtrain.com',
        nombre: 'Básico',
        alias: 'Básico',
        rol: 'Básico',
        es_programador: false
      });
    }

    const lista = Array.from(mapaUsuarios.values());
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    return lista;
  } catch (e) {
    console.warn("Aviso cargando usuarios de autenticación:", e);
    return [
      {
        id: 'invitado@goandtrain.com',
        email: 'invitado@goandtrain.com',
        nombre: 'Básico',
        alias: 'Básico',
        rol: 'Básico',
        es_programador: false
      },
      {
        id: PROYECTOR_SALA_EMAIL,
        email: PROYECTOR_SALA_EMAIL,
        nombre: 'TV Sala',
        alias: 'TV Sala',
        rol: 'Proyector Sala',
        es_programador: false
      }
    ];
  }
}

export async function cargarCatalogoMaestros(
  forzar = false
): Promise<Record<string, Record<string, { id: string; valor: string; orden: number }[]>>> {
  return cargarTodosLosMaestros(forzar);
}

const KEY_ALIASES: Record<string, string[]> = {
  'Bloque de la sesión en que se recomienda': ['Bloques'],
  'Bloque de recomendación': ['Bloques'],
  'Nivel de Dificultad': ['Niveles'],
  'Grupo muscular': ['Músculos', 'Grupos de Ejercicios'],
  'Grupos de Ejercicios': ['Músculos'],
  'Músculos': ['Grupos de Ejercicios'],
  'Material sugerido': ['Materiales'],
  'Subcategoría': ['Subcategorías'],
  'Patrón de movimiento': ['Patrón Motor'],
  'Intensidad de la sesión': ['Intensidad de la Sesión'],
  'Intensidad': ['Intensidad de la Sesión'],
  'Estado Cliente': ['Estado'],
  'Estado cliente': ['Estado'],
  'Horarios Small Group': ['Horarios Small Groups'],
  'Ocupacion maxima': ['Ocupación máxima'],
  'Ocupación Máxima': ['Ocupación máxima'],
  'Meses para reprogramar': ['Meses de margen para reprogramar'],
  'Meses reprogramacion': ['Meses de margen para reprogramar'],
  'Días festivos': ['Festivos'],
  'Dias festivos': ['Festivos']
};

export function extraerListaMaster(
  maestros: Record<string, Record<string, { id: string; valor: string; orden: number }[]>>,
  seccion: string,
  clavesCandidatas: string[]
): string[] {
  const secObj = maestros?.[seccion];
  if (!secObj) return [];

  const todasLasCandidatas: string[] = [];
  clavesCandidatas.forEach(c => {
    todasLasCandidatas.push(c);
    if (KEY_ALIASES[c]) {
      todasLasCandidatas.push(...KEY_ALIASES[c]);
    }
  });

  for (const c of todasLasCandidatas) {
    if (Array.isArray(secObj[c]) && secObj[c].length > 0) {
      return secObj[c].map(item => item.valor);
    }
    const foundKey = Object.keys(secObj).find(
      k => limpiarNombreDoc(k) === limpiarNombreDoc(c)
    );
    if (foundKey && Array.isArray(secObj[foundKey]) && secObj[foundKey].length > 0) {
      return secObj[foundKey].map(item => item.valor);
    }
  }
  return [];
}

export async function getListaProgramadores(forzar = false): Promise<string[]> {
  if (!forzar) {
    const parsed = getSharedCache<string[]>(PROGRAMADORES_CACHE_KEY);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  }

  try {
    const usuarios = await cargarUsuariosAutenticacion();
    const vistos = new Set<string>();
    const lista: string[] = [];

    usuarios.forEach(u => {
      if (u.es_programador === false) return;
      if (esRolProyectorSala(u.rol || '') || esRolBasico(u.rol || '')) return;
      if (esCorreoProyectorSala(u.email || u.id)) {
        return;
      }
      const nombre = String(u.alias || u.nombre || '').trim();
      const norm = limpiarNombreDoc(nombre);
      if (nombre && !vistos.has(norm)) {
        vistos.add(norm);
        lista.push(nombre);
      }
    });

    const prioridad = ['maite', 'andres'];
    lista.sort((a, b) => {
      const idxA = prioridad.indexOf(limpiarNombreDoc(a));
      const idxB = prioridad.indexOf(limpiarNombreDoc(b));
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b, 'es');
    });

    const finalLista = lista.length > 0 ? lista : ['Maite', 'Andrés'];
    setSharedCache(PROGRAMADORES_CACHE_KEY, finalLista, forzar);
    return finalLista;
  } catch (e) {
    console.warn('Error cargando usuarios_app para programadores:', e);
    return ['Maite', 'Andrés'];
  }
}

export async function comprobarDependenciasMaestro(
  clave: string,
  valor: string
): Promise<{ coleccion: string; id: string }[]> {
  const dependenciasEncontradas: { coleccion: string; id: string }[] = [];
  const valorStr = String(valor).trim().toLowerCase();

  const camposARevisar: Record<string, { col: string; campo: string }[]> = {
    Niveles: [
      { col: 'ejercicios', campo: 'Nivel_Dificultad' },
      { col: 'ejercicios', campo: 'Nivel' },
      { col: 'plantillas_sesiones', campo: 'nivel' }
    ],
    Bloques: [
      { col: 'ejercicios', campo: 'Bloque' },
      { col: 'agenda_sesiones', campo: 'ejercicios.Bloque' },
      { col: 'plantillas_sesiones', campo: 'ejercicios.Bloque' }
    ],
    Músculos: [{ col: 'ejercicios', campo: 'Grupo_Muscular' }],
    'Grupos de Ejercicios': [{ col: 'ejercicios', campo: 'Grupo_Muscular' }],
    Materiales: [{ col: 'ejercicios', campo: 'Material' }],
    Subcategorías: [
      { col: 'ejercicios', campo: 'Subcategoría' },
      { col: 'ejercicios', campo: 'Subcategoria' }
    ],
    'Zona / Articulación': [
      { col: 'ejercicios', campo: 'Zona Articulación' },
      { col: 'ejercicios', campo: 'Zona_Articulacion' }
    ],
    Posición: [
      { col: 'ejercicios', campo: 'Posición' },
      { col: 'ejercicios', campo: 'Posicion' }
    ],
    'Patrón Motor': [
      { col: 'ejercicios', campo: 'Patron_Movimiento' },
      { col: 'ejercicios', campo: 'Patron_Motor' }
    ],
    'Series y Repeticiones': [
      { col: 'agenda_sesiones', campo: 'ejercicios.Series' },
      { col: 'plantillas_sesiones', campo: 'ejercicios.Series' }
    ],
    Estado: [{ col: 'clientes', campo: 'Estado_Cliente' }],
    'Tipo de Cliente': [{ col: 'clientes', campo: 'Tipo_Cliente' }],
    'Tipo de Sesión': [{ col: 'plantillas_sesiones', campo: 'tipo_sesion' }],
    'Intensidad de la Sesión': [
      { col: 'agenda_sesiones', campo: 'intensidad_sesion' },
      { col: 'agenda_sesiones', campo: 'intensidad' },
      { col: 'agenda_sesiones', campo: 'ejercicios.intensidad' },
      { col: 'plantillas_sesiones', campo: 'intensidad_sesion' },
      { col: 'plantillas_sesiones', campo: 'intensidad' },
      { col: 'plantillas_sesiones', campo: 'ejercicios.intensidad' }
    ],
    Roles: [{ col: 'usuarios_app', campo: 'rol' }]
  };

  const reglas = camposARevisar[clave];
  if (!reglas) return [];

  for (const regla of reglas) {
    try {
      const snap = await getDocs(collection(db, regla.col));
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (regla.campo.includes('.')) {
          const [arrayKey, propKey] = regla.campo.split('.');
          const arr = data[arrayKey];
          if (Array.isArray(arr)) {
            const match = arr.some(
              (item: any) => String(item[propKey] || '').trim().toLowerCase() === valorStr
            );
            if (match) {
              dependenciasEncontradas.push({ coleccion: regla.col, id: docSnap.id });
            }
          }
        } else {
          const rawVal = data[regla.campo];
          if (Array.isArray(rawVal)) {
            if (rawVal.some(v => String(v).trim().toLowerCase() === valorStr)) {
              dependenciasEncontradas.push({ coleccion: regla.col, id: docSnap.id });
            }
          } else {
            const valDoc = String(rawVal || '').trim().toLowerCase();
            if (
              valDoc === valorStr ||
              valDoc
                .split(/[,/]/)
                .map(s => s.trim())
                .includes(valorStr)
            ) {
              dependenciasEncontradas.push({ coleccion: regla.col, id: docSnap.id });
            }
          }
        }
      });
    } catch (e) {
      console.warn(`No se pudo revisar la colección ${regla.col}:`, e);
    }
  }

  return dependenciasEncontradas;
}

export async function reasignarOQuitarDependencia(
  clave: string,
  valorAntiguo: string,
  valorNuevo: string | null
): Promise<void> {
  const valorAntiguoStr = String(valorAntiguo).trim().toLowerCase();
  const valorNuevoStr = valorNuevo ? String(valorNuevo).trim() : '';

  const camposARevisar: Record<string, { col: string; campo: string }[]> = {
    Niveles: [
      { col: 'ejercicios', campo: 'Nivel_Dificultad' },
      { col: 'ejercicios', campo: 'Nivel' },
      { col: 'plantillas_sesiones', campo: 'nivel' }
    ],
    Bloques: [
      { col: 'ejercicios', campo: 'Bloque' },
      { col: 'agenda_sesiones', campo: 'ejercicios.Bloque' },
      { col: 'plantillas_sesiones', campo: 'ejercicios.Bloque' }
    ],
    Músculos: [{ col: 'ejercicios', campo: 'Grupo_Muscular' }],
    'Grupos de Ejercicios': [{ col: 'ejercicios', campo: 'Grupo_Muscular' }],
    Materiales: [{ col: 'ejercicios', campo: 'Material' }],
    Subcategorías: [
      { col: 'ejercicios', campo: 'Subcategoría' },
      { col: 'ejercicios', campo: 'Subcategoria' }
    ],
    'Zona / Articulación': [
      { col: 'ejercicios', campo: 'Zona Articulación' },
      { col: 'ejercicios', campo: 'Zona_Articulacion' }
    ],
    Posición: [
      { col: 'ejercicios', campo: 'Posición' },
      { col: 'ejercicios', campo: 'Posicion' }
    ],
    'Patrón Motor': [
      { col: 'ejercicios', campo: 'Patron_Movimiento' },
      { col: 'ejercicios', campo: 'Patron_Motor' }
    ],
    'Series y Repeticiones': [
      { col: 'agenda_sesiones', campo: 'ejercicios.Series' },
      { col: 'plantillas_sesiones', campo: 'ejercicios.Series' }
    ],
    Estado: [{ col: 'clientes', campo: 'Estado_Cliente' }],
    'Tipo de Cliente': [{ col: 'clientes', campo: 'Tipo_Cliente' }],
    'Tipo de Sesión': [{ col: 'plantillas_sesiones', campo: 'tipo_sesion' }],
    'Intensidad de la Sesión': [
      { col: 'agenda_sesiones', campo: 'intensidad_sesion' },
      { col: 'agenda_sesiones', campo: 'intensidad' },
      { col: 'agenda_sesiones', campo: 'ejercicios.intensidad' },
      { col: 'plantillas_sesiones', campo: 'intensidad_sesion' },
      { col: 'plantillas_sesiones', campo: 'intensidad' },
      { col: 'plantillas_sesiones', campo: 'Intensidad' },
      { col: 'plantillas_sesiones', campo: 'ejercicios.intensidad' }
    ],
    Roles: [{ col: 'usuarios_app', campo: 'rol' }]
  };

  const reglas = camposARevisar[clave];
  if (!reglas) return;

  for (const regla of reglas) {
    try {
      const snap = await getDocs(collection(db, regla.col));
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        let modificado = false;

        if (regla.campo.includes('.')) {
          const [arrayKey, propKey] = regla.campo.split('.');
          let arr = data[arrayKey];
          if (Array.isArray(arr)) {
            arr = arr.map((item: any) => {
              if (String(item[propKey] || '').trim().toLowerCase() === valorAntiguoStr) {
                modificado = true;
                return { ...item, [propKey]: valorNuevoStr };
              }
              return item;
            });
            if (modificado) {
              await setDoc(doc(db, regla.col, docSnap.id), { [arrayKey]: arr }, { merge: true });
            }
          }
        } else {
          const rawVal = data[regla.campo];
          if (Array.isArray(rawVal)) {
            const nextArr = rawVal
              .map(v =>
                String(v).trim().toLowerCase() === valorAntiguoStr ? valorNuevoStr : v
              )
              .filter(Boolean);
            if (JSON.stringify(nextArr) !== JSON.stringify(rawVal)) {
              await setDoc(
                doc(db, regla.col, docSnap.id),
                { [regla.campo]: nextArr },
                { merge: true }
              );
            }
          } else {
            const valDoc = String(rawVal || '').trim();
            if (valDoc.toLowerCase() === valorAntiguoStr) {
              await setDoc(
                doc(db, regla.col, docSnap.id),
                { [regla.campo]: valorNuevoStr },
                { merge: true }
              );
            }
          }
        }
      }
    } catch (e) {
      console.error(`Error actualizando dependencias en ${regla.col}:`, e);
    }
  }
}

