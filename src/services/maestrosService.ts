import { db } from '../firebase';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import { CatalogoPermiso, MatrizPermisos, PermisoAccion, UsuarioApp } from '../types';

const CACHE_KEY = 'gym_maestros_doc_map_v5';

export const ESTRUCTURA_MAESTROS: Record<string, string[]> = {
  "Ejercicios": [
    "Niveles",
    "Bloques",
    "Grupos de Ejercicios",
    "Materiales",
    "Subcategorías",
    "Zona / Articulación",
    "Posición",
    "Patrón Motor",
    "Series y Repeticiones"
  ],
  "Sesiones": [
    "Tipo de Sesión"
  ],
  "Clientes": [
    "Estado",
    "Tipo de Cliente"
  ],
  "Agenda": [
    "Horarios Sesiones Individuales",
    "Horarios Small Groups",
    "Días de la semana",
    "Ocupación máxima"
  ],
  "Gestión de Perfiles": [
    "Roles",
    "Permisos"
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
  return String(clave)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
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
    const clv = d.clave;
    const valoresObj = d.valores || {};

    if (!sec || !clv) return;
    if (!mapa[sec]) mapa[sec] = {};
    if (!mapa[sec][clv]) mapa[sec][clv] = [];

    for (const [itemId, itemData] of Object.entries(valoresObj as Record<string, any>)) {
      mapa[sec][clv].push({
        id: itemId,
        valor: String(itemData.valor).trim(),
        orden: Number(itemData.orden ?? 99)
      });
    }

    mapa[sec][clv].sort((a, b) => {
      if (a.orden !== b.orden) return a.orden - b.orden;
      return a.valor.localeCompare(b.valor);
    });
  });

  if (!mapa["Agenda"]) mapa["Agenda"] = {};
  if (!mapa["Agenda"]["Ocupación máxima"] || mapa["Agenda"]["Ocupación máxima"].length === 0) {
    mapa["Agenda"]["Ocupación máxima"] = [{ id: "6", valor: "6", orden: 1 }];
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

export async function guardarValorMaestro(
  seccion: string,
  clave: string,
  valor: string,
  orden: number | null = null,
  editId: string | null = null
): Promise<void> {
  const valLimpio = String(valor).trim();
  if (!valLimpio) return;

  const docKey = limpiarNombreDoc(clave);
  const itemId = generarIdItem(valLimpio);
  const docRef = doc(db, "maestros", docKey);

  let ordenFinal = orden !== null && orden !== undefined ? Number(orden) : null;

  if (ordenFinal === null || (editId && editId !== itemId)) {
    const snap = await getDoc(docRef);
    const valoresActuales = snap.exists() ? (snap.data().valores || {}) : {};

    if (editId && valoresActuales[editId]) {
      if (ordenFinal === null) {
        ordenFinal = Number(valoresActuales[editId].orden ?? (Object.keys(valoresActuales).length));
      }
      if (editId !== itemId) {
        await updateDoc(docRef, {
          [`valores.${editId}`]: deleteField()
        });
      }
    } else if (ordenFinal === null) {
      const ordenes = Object.values(valoresActuales as Record<string, any>)
        .map(x => Number(x.orden))
        .filter(n => !isNaN(n) && n !== 99);
      const maxOrden = ordenes.length > 0 ? Math.max(...ordenes) : Object.keys(valoresActuales).length;
      ordenFinal = maxOrden + 1;
    }
  }

  await setDoc(docRef, {
    seccion,
    clave,
    valores: {
      [itemId]: {
        seccion,
        clave,
        valor: valLimpio,
        orden: Number(ordenFinal)
      }
    }
  }, { merge: true });

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
    const valLimpio = String(item.valor).trim();
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

export async function eliminarValorMaestro(clave: string, itemId: string): Promise<void> {
  const docKey = limpiarNombreDoc(clave);
  const docRef = doc(db, "maestros", docKey);
  await updateDoc(docRef, {
    [`valores.${itemId}`]: deleteField()
  });
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
  const isLectura = rNorm === 'recepcion' || rNorm === 'consulta' || rNorm === 'lectura';

  const mapa: Record<string, PermisoAccion> = {};
  CATALOGO_PERMISOS_APP.forEach(p => {
    if (isAdmin) {
      mapa[p.id] = { ver: true, editar: true, crear: true, borrar: true };
    } else if (isProyector) {
      mapa[p.id] = { ver: p.id === 'pantalla_sala', editar: false, crear: false, borrar: false };
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
    // Asegurar valor por defecto "6" para "Ocupación máxima" en Agenda si no existe el documento en Firestore
    try {
      const ocupacionDocKey = limpiarNombreDoc("Ocupación máxima");
      const ocupacionSnap = await getDoc(doc(db, "maestros", ocupacionDocKey));
      if (!ocupacionSnap.exists() || !ocupacionSnap.data()?.valores || Object.keys(ocupacionSnap.data().valores).length === 0) {
        await guardarValorMaestro("Agenda", "Ocupación máxima", "6", 1);
      }
    } catch (errOcup) {
      console.warn("No se pudo asegurar Ocupación máxima por defecto:", errOcup);
    }

    const rolesExistentes = await getValoresMaestro("Gestión de Perfiles", "Roles");
    const rolesSet = new Set(['admin', 'programador', 'Proyector Sala', ...rolesExistentes]);

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
    const defaultRoles = ['admin', 'programador', 'Proyector Sala'];
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
    for (const [rol, mapaRol] of Object.entries(rolesRaw as Record<string, any>)) {
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
  'Grupo muscular': ['Grupos de Ejercicios'],
  'Material sugerido': ['Materiales'],
  'Subcategoría': ['Subcategorías'],
  'Patrón de movimiento': ['Patrón Motor'],
  'Estado Cliente': ['Estado'],
  'Estado cliente': ['Estado'],
  'Horarios Small Group': ['Horarios Small Groups'],
  'Ocupacion maxima': ['Ocupación máxima'],
  'Ocupación Máxima': ['Ocupación máxima']
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

