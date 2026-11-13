import { db } from '../firebase';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  deleteField,
} from 'firebase/firestore';
import { setDoc, updateDoc } from './offlineSyncService';
import { CatalogoPermiso, MatrizPermisos, PermisoAccion, UsuarioApp } from '../types';

const CACHE_KEY = 'gym_maestros_doc_map_v8';

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
    nombre: "Planificación Diaria",
    descripcion: "Panel diario de sesiones de mañana, tarde y Small Groups, y cambio de estado de sesión."
  },
  {
    id: "pantalla_sala",
    categoria: "Programación y Sala",
    nombre: "Pantalla Sala (TV)",
    descripcion: "Proyección en tiempo real de las sesiones y entrenamientos de la sala."
  },
  {
    id: "programar_sesiones",
    categoria: "Programación y Sala",
    nombre: "Programación de Sesiones",
    descripcion: "Configurar bloques, subgrupos y ejercicios de una sesión, enviar/clonar rutinas y cargar plantillas."
  },
  {
    id: "programaciones_pendientes",
    categoria: "Programación y Sala",
    nombre: "Programaciones Pendientes",
    descripcion: "Consulta y acceso rápido a las sesiones próximas pendientes de programar."
  },
  {
    id: "agenda",
    categoria: "Agenda y Calendario",
    nombre: "Agenda y Calendario",
    descripcion: "Calendario de citas individuales y Small Groups, alta de planificaciones, reprogramación y bajas."
  },
  {
    id: "clientes",
    categoria: "Clientes",
    nombre: "Directorio y Fichas de Clientes",
    descripcion: "Gestión de clientes, datos personales, estado, tipo, entrenador asignado, objetivos y lesiones."
  },
  {
    id: "progreso_pr",
    categoria: "Clientes",
    nombre: "Progreso y Marcas Personales (PR)",
    descripcion: "Visualización y registro de pesos máximos levantados (PR) de cada cliente."
  },
  {
    id: "ejercicios",
    categoria: "Catálogo y Plantillas",
    nombre: "Catálogo de Ejercicios",
    descripcion: "Base de datos de ejercicios, categorización técnica, vídeos y configuración de marcas PR."
  },
  {
    id: "plantillas",
    categoria: "Catálogo y Plantillas",
    nombre: "Plantillas de Entrenamiento",
    descripcion: "Catálogo de plantillas predefinidas por tipo de sesión, nivel e intensidad."
  },
  {
    id: "maestros",
    categoria: "Administración y Configuración",
    nombre: "Gestión de Maestros",
    descripcion: "Configuración de desplegables y valores maestros de Ejercicios, Sesiones, Clientes y Agenda."
  },
  {
    id: "perfiles_roles",
    categoria: "Administración y Configuración",
    nombre: "Gestión de Perfiles (Roles y Permisos)",
    descripcion: "Administración de roles del sistema, asignación a usuarios y matriz de permisos por rol."
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
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch (e) {
    // ignore
  }
}

export async function cargarTodosLosMaestros(forzar = false): Promise<Record<string, Record<string, { id: string; valor: string; orden: number }[]>>> {
  if (!forzar) {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (e) { }
  }

  const snap = await getDocs(collection(db, "maestros"));
  const mapa: Record<string, Record<string, { id: string; valor: string; orden: number }[]>> = {};

  snap.forEach(docSnap => {
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
      const rawValStr = String(itemData.valor).trim();
      const valStr =
        sec === 'Agenda' && clv === 'Horarios Small Groups'
          ? parsearHorarioSmallGroup(rawValStr).formateado
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

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(mapa));
  } catch (e) { }

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

export function esRolAdmin(nombreRol: string): boolean {
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
  return rNorm === 'proyector sala' || rNorm === 'proyector_sala' || rNorm === 'proyector' || rNorm === 'invitado';
}

export function esRolBasico(nombreRol: string): boolean {
  const rNorm = String(nombreRol || '')
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return rNorm === 'basico' || rNorm === 'rol basico';
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
      // Rol Básico: solo ver la planificación de Hoy y marcar sesiones como completadas
      if (p.id === 'planificacion') {
        mapa[p.id] = { ver: true, editar: true, crear: false, borrar: false };
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
      } else if (p.id === 'planificacion' || p.id === 'programaciones_pendientes') {
        mapa[p.id] = { ver: true, editar: true, crear: true, borrar: false };
      } else if (p.id === 'clientes') {
        mapa[p.id] = { ver: true, editar: true, crear: false, borrar: false };
      } else if (p.id === 'maestros' || p.id === 'perfiles_roles') {
        mapa[p.id] = { ver: true, editar: false, crear: false, borrar: false };
      } else {
        mapa[p.id] = { ver: true, editar: true, crear: true, borrar: true };
      }
    }
  });
  return mapa;
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

    const rolesSet = new Set(['admin', 'programador', 'Básico', 'Proyector Sala', ...rolesExistentes]);

    const matrizRef = doc(db, "maestros", "config_permisos_roles");
    const matrizSnap = await getDoc(matrizRef);
    const esVersionActual = matrizSnap.exists() && matrizSnap.data().schema_version === 2;
    const rolesExistentesMatriz = esVersionActual ? (matrizSnap.data().roles || {}) : {};
    const matrizLimpia: MatrizPermisos = {};

    Array.from(rolesSet).forEach(rol => {
      const defaultsRol = PermisosPorDefectoParaRol(rol);
      const prevRol = rolesExistentesMatriz[rol] || {};
      matrizLimpia[rol] = {};
      CATALOGO_PERMISOS_APP.forEach(p => {
        matrizLimpia[rol][p.id] = normalizarPermisosAccion(prevRol[p.id], defaultsRol[p.id]);
      });
    });

    return { roles: Array.from(rolesSet), matriz: matrizLimpia };
  } catch (e) {
    console.warn("Error en asegurarRolesYPermisosIniciales:", e);
    const defaultRoles = ['admin', 'programador', 'Básico', 'Proyector Sala'];
    const defaultMatriz: MatrizPermisos = {};
    defaultRoles.forEach(r => defaultMatriz[r] = PermisosPorDefectoParaRol(r));
    return { roles: defaultRoles, matriz: defaultMatriz };
  }
}

export async function cargarMatrizPermisos(): Promise<MatrizPermisos> {
  try {
    const matrizRef = doc(db, "maestros", "config_permisos_roles");
    const snap = await getDoc(matrizRef);
    if (!snap.exists() || snap.data().schema_version !== 2) {
      const init = await asegurarRolesYPermisosIniciales();
      return init.matriz;
    }
    const rolesRaw = snap.data().roles || {};
    const rolesNormalizados: MatrizPermisos = {};
    const todosLosRoles = new Set(['admin', 'programador', 'Básico', 'Proyector Sala', ...Object.keys(rolesRaw)]);
    for (const rol of todosLosRoles) {
      const mapaRol = rolesRaw[rol];
      const defaultsRol = PermisosPorDefectoParaRol(rol);
      rolesNormalizados[rol] = {};
      CATALOGO_PERMISOS_APP.forEach(p => {
        rolesNormalizados[rol][p.id] = normalizarPermisosAccion(mapaRol ? mapaRol[p.id] : undefined, defaultsRol[p.id]);
      });
    }
    return rolesNormalizados;
  } catch (e) {
    const init = await asegurarRolesYPermisosIniciales();
    return init.matriz;
  }
}

export async function guardarMatrizPermisos(nuevaMatriz: MatrizPermisos): Promise<void> {
  const matrizRef = doc(db, "maestros", "config_permisos_roles");
  await setDoc(matrizRef, {
    schema_version: 2,
    roles: nuevaMatriz,
    updated_at: new Date().toISOString()
  });
}

export async function cargarUsuariosAutenticacion(): Promise<UsuarioApp[]> {
  try {
    const snap = await getDocs(collection(db, "usuarios_app"));
    const lista: UsuarioApp[] = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      lista.push({
        id: docSnap.id,
        email: d.email || (docSnap.id.includes('@') ? docSnap.id : ''),
        nombre: d.nombre || d.alias || d.nombre_corto || docSnap.id,
        alias: d.alias || d.nombre_corto || d.nombre || '',
        rol: d.rol || 'Sin asignar',
        es_programador: d.es_programador !== false
      });
    });
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    return lista;
  } catch (e) {
    console.warn("Error cargando usuarios_app:", e);
    return [];
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
  'Meses reprogramacion': ['Meses de margen para reprogramar']
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

const PROGRAMADORES_CACHE_KEY = 'gym_programadores_cache_v1';

export async function getListaProgramadores(forzar = false): Promise<string[]> {
  if (!forzar) {
    try {
      const cached = sessionStorage.getItem(PROGRAMADORES_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
  }

  try {
    const snap = await getDocs(collection(db, 'usuarios_app'));
    const vistos = new Set<string>();
    const lista: string[] = [];

    snap.forEach(docSnap => {
      const d = docSnap.data();
      if (d.es_programador === false) return;
      if (esRolProyectorSala(d.rol || '')) return;
      if (String(d.email || docSnap.id || '').trim().toLowerCase() === 'invitado@goandtrain.com') {
        return;
      }
      const nombre = String(d.alias || d.nombre_corto || d.nombre || '').trim();
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
    try {
      sessionStorage.setItem(PROGRAMADORES_CACHE_KEY, JSON.stringify(finalLista));
    } catch (e) {}
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

