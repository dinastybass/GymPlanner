// js/maestros-service.js
import { db } from '../firebase-config.js';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const CACHE_KEY = 'gym_maestros_doc_map_v5';

export const ESTRUCTURA_MAESTROS = {
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
        "Días de la semana"
    ],
    "Gestión de Perfiles": [
        "Roles",
        "Permisos"
    ]
};

export function limpiarNombreDoc(clave) {
    return String(clave)
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}

export function generarIdItem(valor) {
    return String(valor)
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}

export function generarIdMaestro(seccion, clave, valor) {
    return generarIdItem(valor);
}

export function limpiarCacheMaestros() {
    sessionStorage.removeItem(CACHE_KEY);
}

export async function cargarTodosLosMaestros(forzar = false) {
    if (!forzar) {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            try { return JSON.parse(cached); } catch (e) { }
        }
    }

    const snap = await getDocs(collection(db, "maestros"));
    const mapa = {};

    snap.forEach(docSnap => {
        const d = docSnap.data();
        const sec = d.seccion;
        const clv = d.clave;
        const valoresObj = d.valores || {};

        if (!sec || !clv) return;
        if (!mapa[sec]) mapa[sec] = {};
        if (!mapa[sec][clv]) mapa[sec][clv] = [];

        for (const [itemId, itemData] of Object.entries(valoresObj)) {
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

    sessionStorage.setItem(CACHE_KEY, JSON.stringify(mapa));
    return mapa;
}

export async function getValoresMaestro(seccion, clave) {
    const mapa = await cargarTodosLosMaestros();
    return (mapa[seccion] && mapa[seccion][clave])
        ? mapa[seccion][clave].map(item => item.valor)
        : [];
}

export async function getMapaOrdenMaestro(seccion, clave) {
    const mapa = await cargarTodosLosMaestros();
    const lista = (mapa[seccion] && mapa[seccion][clave]) ? mapa[seccion][clave] : [];
    const obj = {};
    lista.forEach((item, idx) => {
        obj[item.valor] = item.orden !== 99 ? item.orden : (idx + 1);
    });
    return obj;
}

export async function poblarSelect(selectIdOrEl, seccion, clave, placeholderText = null, valorPorDefecto = null) {
    const el = typeof selectIdOrEl === 'string' ? document.getElementById(selectIdOrEl) : selectIdOrEl;
    if (!el) return [];

    const valores = await getValoresMaestro(seccion, clave);
    el.innerHTML = '';

    if (placeholderText !== null) {
        const opt = document.createElement('option');
        opt.value = placeholderText === 'Todos' && el.id === 'statusFilter' ? 'Todos' : '';
        opt.textContent = placeholderText;
        el.appendChild(opt);
    }

    valores.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        el.appendChild(opt);
    });

    if (valorPorDefecto && valores.includes(valorPorDefecto)) {
        el.value = valorPorDefecto;
    }
    return valores;
}

/**
 * Guarda un valor calculando automáticamente el último puesto si no se especifica orden.
 * Si se pasa editId y cambia el nombre del ítem, conserva su orden y reemplaza la clave antigua.
 */
export async function guardarValorMaestro(seccion, clave, valor, orden = null, editId = null) {
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
            const ordenes = Object.values(valoresActuales)
                .map(x => Number(x.orden))
                .filter(n => !isNaN(n) && n !== 99);
            const maxOrden = ordenes.length > 0 ? Math.max(...ordenes) : Object.keys(valoresActuales).length;
            ordenFinal = maxOrden + 1;
        }
    }

    await setDoc(docRef, {
        seccion: seccion,
        clave: clave,
        valores: {
            [itemId]: {
                seccion: seccion,
                clave: clave,
                valor: valLimpio,
                orden: Number(ordenFinal)
            }
        }
    }, { merge: true });

    limpiarCacheMaestros();
}

/**
 * Recalcula internamente el orden (1, 2, 3...) según el array recibido tras Drag & Drop
 * y lo guarda en la colección 'maestros'.
 */
export async function reordenarValoresMaestro(seccion, clave, listaItemsOrdenados) {
    const docKey = limpiarNombreDoc(clave);
    const docRef = doc(db, "maestros", docKey);

    const nuevosValores = {};
    listaItemsOrdenados.forEach((item, index) => {
        const valLimpio = String(item.valor).trim();
        const itemId = item.id || generarIdItem(valLimpio);
        nuevosValores[itemId] = {
            seccion: seccion,
            clave: clave,
            valor: valLimpio,
            orden: index + 1
        };
    });

    await setDoc(docRef, {
        seccion: seccion,
        clave: clave,
        valores: nuevosValores
    });

    limpiarCacheMaestros();
}

export async function eliminarValorMaestro(clave, itemId) {
    const docKey = limpiarNombreDoc(clave);
    const docRef = doc(db, "maestros", docKey);
    await updateDoc(docRef, {
        [`valores.${itemId}`]: deleteField()
    });
    limpiarCacheMaestros();
}

export async function comprobarDependenciasMaestro(clave, valor) {
    const dependenciasEncontradas = [];
    const valorStr = String(valor).trim().toLowerCase();

    const camposARevisar = {
        "Niveles": [{ col: "ejercicios", campo: "Nivel_Dificultad" }, { col: "plantillas_sesiones", campo: "nivel" }],
        "Bloques": [{ col: "ejercicios", campo: "Bloque" }, { col: "agenda_sesiones", campo: "ejercicios.Bloque" }, { col: "plantillas_sesiones", campo: "ejercicios.Bloque" }],
        "Grupos de Ejercicios": [{ col: "ejercicios", campo: "Grupo_Muscular" }],
        "Materiales": [{ col: "ejercicios", campo: "Material" }],
        "Subcategorías": [{ col: "ejercicios", campo: "Subcategoría" }, { col: "ejercicios", campo: "Subcategoria" }],
        "Zona / Articulación": [{ col: "ejercicios", campo: "Zona Articulación" }, { col: "ejercicios", campo: "Zona_Articulacion" }],
        "Posición": [{ col: "ejercicios", campo: "Posición" }, { col: "ejercicios", campo: "Posicion" }],
        "Patrón Motor": [{ col: "ejercicios", campo: "Patron_Movimiento" }, { col: "ejercicios", campo: "Patron_Motor" }],
        "Series y Repeticiones": [{ col: "agenda_sesiones", campo: "ejercicios.Series" }, { col: "plantillas_sesiones", campo: "ejercicios.Series" }],
        "Estado": [{ col: "clientes", campo: "Estado_Cliente" }],
        "Tipo de Cliente": [{ col: "clientes", campo: "Tipo_Cliente" }],
        "Tipo de Sesión": [{ col: "plantillas_sesiones", campo: "tipo_sesion" }],
        "Roles": [{ col: "usuarios_app", campo: "rol" }]
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
                        const match = arr.some(item => String(item[propKey] || '').trim().toLowerCase() === valorStr);
                        if (match) {
                            dependenciasEncontradas.push({ coleccion: regla.col, id: docSnap.id });
                        }
                    }
                } else {
                    const valDoc = String(data[regla.campo] || '').trim().toLowerCase();
                    if (valDoc === valorStr || valDoc.split(/[,/]/).map(s => s.trim()).includes(valorStr)) {
                        dependenciasEncontradas.push({ coleccion: regla.col, id: docSnap.id });
                    }
                }
            });
        } catch (e) {
            console.warn(`No se pudo revisar la colección ${regla.col}:`, e);
        }
    }

    return dependenciasEncontradas;
}

export async function reasignarOQuitarDependencia(clave, valorAntiguo, valorNuevo) {
    const valorAntiguoStr = String(valorAntiguo).trim().toLowerCase();
    const valorNuevoStr = valorNuevo ? String(valorNuevo).trim() : "";

    const camposARevisar = {
        "Niveles": [{ col: "ejercicios", campo: "Nivel_Dificultad" }, { col: "plantillas_sesiones", campo: "nivel" }],
        "Bloques": [{ col: "ejercicios", campo: "Bloque" }, { col: "agenda_sesiones", campo: "ejercicios.Bloque" }, { col: "plantillas_sesiones", campo: "ejercicios.Bloque" }],
        "Grupos de Ejercicios": [{ col: "ejercicios", campo: "Grupo_Muscular" }],
        "Materiales": [{ col: "ejercicios", campo: "Material" }],
        "Subcategorías": [{ col: "ejercicios", campo: "Subcategoría" }, { col: "ejercicios", campo: "Subcategoria" }],
        "Zona / Articulación": [{ col: "ejercicios", campo: "Zona Articulación" }, { col: "ejercicios", campo: "Zona_Articulacion" }],
        "Posición": [{ col: "ejercicios", campo: "Posición" }, { col: "ejercicios", campo: "Posicion" }],
        "Patrón Motor": [{ col: "ejercicios", campo: "Patron_Movimiento" }, { col: "ejercicios", campo: "Patron_Motor" }],
        "Series y Repeticiones": [{ col: "agenda_sesiones", campo: "ejercicios.Series" }, { col: "plantillas_sesiones", campo: "ejercicios.Series" }],
        "Estado": [{ col: "clientes", campo: "Estado_Cliente" }],
        "Tipo de Cliente": [{ col: "clientes", campo: "Tipo_Cliente" }],
        "Tipo de Sesión": [{ col: "plantillas_sesiones", campo: "tipo_sesion" }],
        "Roles": [{ col: "usuarios_app", campo: "rol" }]
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
                        arr = arr.map(item => {
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
                    const valDoc = String(data[regla.campo] || '').trim();
                    if (valDoc.toLowerCase() === valorAntiguoStr) {
                        await setDoc(doc(db, regla.col, docSnap.id), { [regla.campo]: valorNuevoStr }, { merge: true });
                    }
                }
            }
        } catch (e) {
            console.error(`Error actualizando dependencias en ${regla.col}:`, e);
        }
    }
}

// ============================================================================
// CATÁLOGO DE ACCIONES / PERMISOS DE LA APLICACIÓN Y GESTIÓN DE PERFILES
// ============================================================================
export const TIPOS_OPERACION_PERMISO = ['ver', 'editar', 'crear', 'borrar'];

export const CATALOGO_PERMISOS_APP = [
    // 1. Programación y Sala
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

    // 2. Agenda y Calendario
    {
        id: "agenda",
        categoria: "Agenda y Calendario",
        nombre: "Agenda y Calendario",
        descripcion: "Calendario de citas individuales y Small Groups, alta de planificaciones, reprogramación y bajas."
    },

    // 3. Clientes
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

    // 4. Catálogo y Plantillas
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

    // 5. Administración y Configuración
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

export function esRolAdmin(nombreRol) {
    const rNorm = String(nombreRol || '')
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    return rNorm === 'admin' || rNorm === 'administrador' || rNorm === 'direccion';
}

export function esRolProyectorSala(nombreRol) {
    const rNorm = String(nombreRol || '')
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    return rNorm === 'proyector sala' || rNorm === 'proyector_sala' || rNorm === 'proyector' || rNorm === 'invitado';
}

export function normalizarPermisosAccion(val, defaultObj = { ver: false, editar: false, crear: false, borrar: false }) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
        return {
            ver: val.ver !== undefined ? Boolean(val.ver) : Boolean(defaultObj.ver),
            editar: val.editar !== undefined ? Boolean(val.editar) : Boolean(defaultObj.editar),
            crear: val.crear !== undefined ? Boolean(val.crear) : Boolean(defaultObj.crear),
            borrar: val.borrar !== undefined ? Boolean(val.borrar) : Boolean(defaultObj.borrar)
        };
    }
    if (typeof val === 'boolean') {
        return {
            ver: val ? true : Boolean(defaultObj.ver),
            editar: val ? Boolean(defaultObj.editar) : false,
            crear: val ? Boolean(defaultObj.crear) : false,
            borrar: val ? Boolean(defaultObj.borrar) : false
        };
    }
    return {
        ver: Boolean(defaultObj.ver),
        editar: Boolean(defaultObj.editar),
        crear: Boolean(defaultObj.crear),
        borrar: Boolean(defaultObj.borrar)
    };
}

export function PermisosPorDefectoParaRol(nombreRol) {
    const rNorm = String(nombreRol || '')
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const isAdmin = esRolAdmin(nombreRol);
    const isProyector = esRolProyectorSala(nombreRol);
    const isLectura = rNorm === 'recepcion' || rNorm === 'consulta' || rNorm === 'lectura';

    const mapa = {};
    CATALOGO_PERMISOS_APP.forEach(p => {
        if (isAdmin) {
            mapa[p.id] = { ver: true, editar: true, crear: true, borrar: true };
        } else if (isProyector) {
            if (p.id === 'pantalla_sala') {
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
            // Por defecto para Programador / Entrenador
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

/**
 * Garantiza que existan los roles por defecto (admin, programador, Proyector Sala) y el perfil
 * invitado@goandtrain.com, sincroniza las acciones por defecto del catálogo en el maestro "Permisos"
 * y asegura la matriz de permisos (Ver, Editar, Crear, Borrar) por rol.
 */
export async function asegurarRolesYPermisosIniciales() {
    // 1. Asegurar perfil invitado@goandtrain.com con rol "Proyector Sala" en usuarios_app
    const invitadoRef = doc(db, "usuarios_app", "invitado@goandtrain.com");
    const invitadoSnap = await getDoc(invitadoRef);
    if (
        !invitadoSnap.exists() ||
        !esRolProyectorSala(invitadoSnap.data().rol) ||
        invitadoSnap.data().es_programador !== false
    ) {
        const datosPrev = invitadoSnap.exists() ? invitadoSnap.data() : {};
        await setDoc(invitadoRef, {
            email: "invitado@goandtrain.com",
            nombre: datosPrev.nombre && datosPrev.nombre !== "invitado" ? datosPrev.nombre : "Invitado Sala",
            alias: datosPrev.alias && datosPrev.alias !== "invitado" ? datosPrev.alias : "Invitado",
            rol: "Proyector Sala",
            es_programador: false
        }, { merge: true });
    }

    // 2. Asegurar roles en Gestión de Perfiles -> Roles
    const rolesExistentes = await getValoresMaestro("Gestión de Perfiles", "Roles");
    const snapUsers = await getDocs(collection(db, "usuarios_app"));
    const rolesDetectados = new Set(['admin', 'programador', 'Proyector Sala']);

    snapUsers.forEach(d => {
        const data = d.data();
        if (data.rol && String(data.rol).trim() !== '') {
            rolesDetectados.add(String(data.rol).trim());
        }
    });

    const rolesNormExistentes = new Set(rolesExistentes.map(r => r.trim().toLowerCase()));
    let huboAltaRol = false;
    for (const r of rolesDetectados) {
        if (!rolesNormExistentes.has(r.toLowerCase())) {
            await guardarValorMaestro("Gestión de Perfiles", "Roles", r);
            rolesNormExistentes.add(r.toLowerCase());
            huboAltaRol = true;
        }
    }
    if (huboAltaRol) limpiarCacheMaestros();

    // 3. Sincronizar las acciones del catálogo oficial en el maestro "Permisos" (solo acciones del sistema)
    const permisosMaestro = await getValoresMaestro("Gestión de Perfiles", "Permisos");
    const nombresCatalogo = CATALOGO_PERMISOS_APP.map(p => p.nombre);
    const requiereSyncPermisos =
        permisosMaestro.length !== nombresCatalogo.length ||
        permisosMaestro.some((val, idx) => val !== nombresCatalogo[idx]);

    if (requiereSyncPermisos) {
        await reordenarValoresMaestro(
            "Gestión de Perfiles",
            "Permisos",
            CATALOGO_PERMISOS_APP.map((p, idx) => ({
                id: p.id,
                valor: p.nombre,
                orden: idx + 1
            }))
        );
        limpiarCacheMaestros();
    }

    // 4. Asegurar documento de configuración de matriz de permisos (Ver, Editar, Crear, Borrar) por rol
    const matrizRef = doc(db, "maestros", "config_permisos_roles");
    const matrizSnap = await getDoc(matrizRef);
    const rolesFinales = await getValoresMaestro("Gestión de Perfiles", "Roles");
    const esVersionActual = matrizSnap.exists() && matrizSnap.data().schema_version === 2;
    const rolesExistentesMatriz = esVersionActual ? (matrizSnap.data().roles || {}) : {};
    const matrizLimpia = {};
    let matrizModificada = !esVersionActual;

    rolesFinales.forEach(rol => {
        const defaultsRol = PermisosPorDefectoParaRol(rol);
        const mapaPrevio = rolesExistentesMatriz[rol];
        matrizLimpia[rol] = {};

        if (!mapaPrevio || typeof mapaPrevio !== 'object') {
            matrizLimpia[rol] = defaultsRol;
            matrizModificada = true;
        } else {
            CATALOGO_PERMISOS_APP.forEach(p => {
                const actual = mapaPrevio[p.id];
                const defAccion = defaultsRol[p.id];
                if (
                    !actual ||
                    typeof actual !== 'object' ||
                    actual.ver === undefined ||
                    actual.editar === undefined ||
                    actual.crear === undefined ||
                    actual.borrar === undefined
                ) {
                    matrizLimpia[rol][p.id] = defAccion;
                    matrizModificada = true;
                } else {
                    matrizLimpia[rol][p.id] = {
                        ver: Boolean(actual.ver),
                        editar: Boolean(actual.editar),
                        crear: Boolean(actual.crear),
                        borrar: Boolean(actual.borrar)
                    };
                }
            });
        }
    });

    if (matrizModificada) {
        await setDoc(matrizRef, {
            schema_version: 2,
            roles: matrizLimpia,
            updated_at: new Date().toISOString()
        });
    }

    return { roles: rolesFinales, matriz: matrizLimpia };
}

export async function cargarMatrizPermisos() {
    const matrizRef = doc(db, "maestros", "config_permisos_roles");
    const snap = await getDoc(matrizRef);
    if (!snap.exists() || snap.data().schema_version !== 2) {
        const init = await asegurarRolesYPermisosIniciales();
        return init.matriz;
    }
    const rolesRaw = snap.data().roles || {};
    const rolesNormalizados = {};
    for (const [rol, mapaRol] of Object.entries(rolesRaw)) {
        const defaultsRol = PermisosPorDefectoParaRol(rol);
        rolesNormalizados[rol] = {};
        CATALOGO_PERMISOS_APP.forEach(p => {
            rolesNormalizados[rol][p.id] = normalizarPermisosAccion(mapaRol ? mapaRol[p.id] : undefined, defaultsRol[p.id]);
        });
    }
    return rolesNormalizados;
}

export async function guardarMatrizPermisos(nuevaMatriz) {
    const matrizRef = doc(db, "maestros", "config_permisos_roles");
    await setDoc(matrizRef, {
        schema_version: 2,
        roles: nuevaMatriz,
        updated_at: new Date().toISOString()
    });
}

export async function cargarUsuariosAutenticacion() {
    const snap = await getDocs(collection(db, "usuarios_app"));
    const lista = [];
    snap.forEach(docSnap => {
        const d = docSnap.data();
        lista.push({
            id: docSnap.id,
            email: d.email || (docSnap.id.includes('@') ? docSnap.id : ''),
            nombre: d.nombre || d.alias || d.nombre_corto || docSnap.id,
            alias: d.alias || d.nombre_corto || d.nombre || '',
            rol: d.rol || 'Sin asignar',
            es_programador: d.es_programador !== false,
            raw: d
        });
    });
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    return lista;
}
