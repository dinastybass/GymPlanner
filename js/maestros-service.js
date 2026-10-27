// js/maestros-service.js
import { db } from '../firebase-config.js';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const CACHE_KEY = 'gym_maestros_doc_map_v2';

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
    "Clientes": [
        "Estado"
    ],
    "Agenda": [
        "Horarios Sesiones Individuales",
        "Horarios Small Groups",
        "Días de la semana"
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
        "Estado": [{ col: "clientes", campo: "Estado_Cliente" }]
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
        "Estado": [{ col: "clientes", campo: "Estado_Cliente" }]
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