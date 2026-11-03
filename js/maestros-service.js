// js/maestros-service.js
import { db } from '../firebase-config.js';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const CACHE_KEY = 'gym_maestros_doc_map_v4';

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
export const CATALOGO_PERMISOS_APP = [
    // 1. Programación y Sesiones
    {
        id: "programar_sesiones",
        categoria: "Programación y Sesiones",
        nombre: "Programar sesiones",
        descripcion: "Añadir, editar, reordenar y quitar ejercicios, bloques o subgrupos dentro de una sesión y cargar plantillas."
    },
    {
        id: "enviar_clonar_sesiones",
        categoria: "Programación y Sesiones",
        nombre: "Enviar / Clonar sesiones",
        descripcion: "Enviar la rutina de una sesión a otra sesión de un cliente o guardarla como nueva plantilla."
    },
    {
        id: "cambiar_estado_sesion",
        categoria: "Programación y Sesiones",
        nombre: "Cambiar estado de sesión",
        descripcion: "Alternar el estado de una sesión (Completada, Pendiente, Vencida) en Planificación."
    },
    {
        id: "ver_pantalla_sala",
        categoria: "Programación y Sesiones",
        nombre: "Acceso a Pantalla Sala (TV)",
        descripcion: "Abrir y consultar la vista de Pantalla Sala en tiempo real."
    },

    // 2. Agenda y Calendario
    {
        id: "agendar_sesiones",
        categoria: "Agenda y Calendario",
        nombre: "Agendar sesiones y planificaciones",
        descripcion: "Dar de alta citas individuales, Small Groups o planificaciones recurrentes en la Agenda."
    },
    {
        id: "reprogramar_sesiones",
        categoria: "Agenda y Calendario",
        nombre: "Reprogramar sesiones",
        descripcion: "Mover fecha y hora de sesiones pendientes o vencidas y ejecutar desplazamientos en cascada."
    },
    {
        id: "eliminar_sesiones_agenda",
        categoria: "Agenda y Calendario",
        nombre: "Eliminar sesiones de la Agenda",
        descripcion: "Borrar sesiones agendadas desde el calendario de Agenda o desde la ficha del cliente."
    },

    // 3. Clientes
    {
        id: "alta_clientes",
        categoria: "Clientes",
        nombre: "Alta de Clientes",
        descripcion: "Crear nuevos clientes en el directorio de clientes."
    },
    {
        id: "edicion_clientes",
        categoria: "Clientes",
        nombre: "Edición de Clientes",
        descripcion: "Modificar ficha de cliente (datos personales, estado, tipo, entrenador asignado, Go & Kids, objetivos y salud/lesiones)."
    },
    {
        id: "borrado_clientes",
        categoria: "Clientes",
        nombre: "Borrado de Clientes",
        descripcion: "Eliminar fichas de clientes del directorio."
    },
    {
        id: "registro_progreso_pr",
        categoria: "Clientes",
        nombre: "Registro de Progreso / Marcas (PR)",
        descripcion: "Registrar y actualizar pesos máximos levantados en la pestaña de Progreso del cliente."
    },

    // 4. Catálogo de Ejercicios
    {
        id: "alta_ejercicios",
        categoria: "Catálogo de Ejercicios",
        nombre: "Alta de Ejercicios",
        descripcion: "Crear nuevos ejercicios en el catálogo general."
    },
    {
        id: "edicion_ejercicios",
        categoria: "Catálogo de Ejercicios",
        nombre: "Edición de Ejercicios",
        descripcion: "Modificar datos técnicos, categorización, enlace de vídeo y marca de progreso de un ejercicio."
    },
    {
        id: "borrado_ejercicios",
        categoria: "Catálogo de Ejercicios",
        nombre: "Borrado de Ejercicios",
        descripcion: "Eliminar ejercicios del catálogo general."
    },

    // 5. Plantillas de Entrenamiento
    {
        id: "alta_plantillas",
        categoria: "Plantillas de Entrenamiento",
        nombre: "Alta de Plantillas",
        descripcion: "Crear nuevas plantillas de sesiones o guardarlas a partir de una sesión existente."
    },
    {
        id: "edicion_plantillas",
        categoria: "Plantillas de Entrenamiento",
        nombre: "Edición de Plantillas",
        descripcion: "Modificar metadatos y ejercicios dentro de las plantillas de entrenamiento."
    },
    {
        id: "borrado_plantillas",
        categoria: "Plantillas de Entrenamiento",
        nombre: "Borrado de Plantillas",
        descripcion: "Eliminar plantillas del catálogo de plantillas."
    },

    // 6. Administración y Maestros
    {
        id: "gestion_maestros",
        categoria: "Administración y Maestros",
        nombre: "Gestión de Maestros",
        descripcion: "Añadir, editar, reordenar y eliminar valores en los maestros de Ejercicios, Sesiones, Clientes y Agenda."
    },
    {
        id: "gestion_perfiles_roles",
        categoria: "Administración y Maestros",
        nombre: "Gestión de Perfiles (Roles y Permisos)",
        descripcion: "Dar de alta roles, asignarlos a los empleados en autenticación y configurar los permisos de cada rol."
    }
];

export function PermisosPorDefectoParaRol(nombreRol) {
    const rNorm = String(nombreRol || '').trim().toLowerCase();
    const esAdmin = rNorm === 'admin' || rNorm === 'administrador' || rNorm === 'dirección' || rNorm === 'direccion';
    const esLectura = rNorm === 'recepción' || rNorm === 'recepcion' || rNorm === 'consulta' || rNorm === 'lectura';

    const mapa = {};
    CATALOGO_PERMISOS_APP.forEach(p => {
        if (esAdmin) {
            mapa[p.id] = true;
        } else if (esLectura) {
            mapa[p.id] = ['ver_pantalla_sala', 'agendar_sesiones', 'reprogramar_sesiones', 'alta_clientes', 'edicion_clientes'].includes(p.id);
        } else {
            // Por defecto para Programador / Entrenador: todas las operativas salvo borrado crítico de clientes y gestión de perfiles
            mapa[p.id] = !['borrado_clientes', 'gestion_perfiles_roles'].includes(p.id);
        }
    });
    return mapa;
}

/**
 * Garantiza que existan los roles actuales detectados en usuarios_app (y Admin / Programador)
 * dentro del maestro Gestión de Perfiles -> Roles, y que exista el documento de matriz de permisos.
 */
export async function asegurarRolesYPermisosIniciales() {
    const rolesExistentes = await getValoresMaestro("Gestión de Perfiles", "Roles");
    const snapUsers = await getDocs(collection(db, "usuarios_app"));
    const rolesDetectados = new Set(['admin', 'programador']);

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

    // Asegurar que las acciones del catálogo estén también sincronizadas en el maestro "Permisos"
    const permisosMaestro = await getValoresMaestro("Gestión de Perfiles", "Permisos");
    if (permisosMaestro.length === 0) {
        let ord = 1;
        for (const p of CATALOGO_PERMISOS_APP) {
            await guardarValorMaestro("Gestión de Perfiles", "Permisos", p.nombre, ord++);
        }
        limpiarCacheMaestros();
    }

    // Asegurar documento de configuración de matriz de permisos por rol
    const matrizRef = doc(db, "configuracion_app", "permisos_roles");
    const matrizSnap = await getDoc(matrizRef);
    const rolesFinales = await getValoresMaestro("Gestión de Perfiles", "Roles");
    let matrizData = matrizSnap.exists() ? (matrizSnap.data().roles || {}) : {};
    let matrizModificada = !matrizSnap.exists();

    rolesFinales.forEach(rol => {
        if (!matrizData[rol]) {
            matrizData[rol] = PermisosPorDefectoParaRol(rol);
            matrizModificada = true;
        } else {
            CATALOGO_PERMISOS_APP.forEach(p => {
                if (matrizData[rol][p.id] === undefined) {
                    matrizData[rol][p.id] = PermisosPorDefectoParaRol(rol)[p.id];
                    matrizModificada = true;
                }
            });
        }
    });

    if (matrizModificada) {
        await setDoc(matrizRef, { roles: matrizData, updated_at: new Date().toISOString() }, { merge: true });
    }

    return { roles: rolesFinales, matriz: matrizData };
}

export async function cargarMatrizPermisos() {
    const matrizRef = doc(db, "configuracion_app", "permisos_roles");
    const snap = await getDoc(matrizRef);
    if (!snap.exists()) {
        const init = await asegurarRolesYPermisosIniciales();
        return init.matriz;
    }
    return snap.data().roles || {};
}

export async function guardarMatrizPermisos(nuevaMatriz) {
    const matrizRef = doc(db, "configuracion_app", "permisos_roles");
    await setDoc(matrizRef, {
        roles: nuevaMatriz,
        updated_at: new Date().toISOString()
    }, { merge: true });
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
function _noopClosure() { if (false) { {
        }
    }
}