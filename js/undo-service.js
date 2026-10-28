// js/undo-service.js
// Servicio centralizado de Deshacer / Rehacer (Opción 1: Toast + Snapshot, Opción 2: Pila de Historial 15 pasos en caché)

import { db } from '../firebase-config.js';
import { doc, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const DEFAULT_MAX_STEPS = 15;

/**
 * Convierte recursivamente objetos Date y Timestamps de Firestore a un formato JSON serializable
 * para poder almacenarlos en sessionStorage sin perder los tipos de fecha.
 */
export function serializarDatosFirestore(valor) {
    if (valor === null || valor === undefined) return valor;

    // Firestore Timestamp (.toDate())
    if (typeof valor === 'object' && typeof valor.toDate === 'function') {
        return { __gymDateISO: valor.toDate().toISOString() };
    }

    // Instancia nativa Date
    if (valor instanceof Date) {
        return { __gymDateISO: valor.toISOString() };
    }

    // Objeto tipo Timestamp serializado { seconds, nanoseconds }
    if (
        typeof valor === 'object' &&
        !Array.isArray(valor) &&
        typeof valor.seconds === 'number' &&
        typeof valor.nanoseconds === 'number' &&
        Object.keys(valor).length <= 2
    ) {
        return { __gymDateISO: new Date(valor.seconds * 1000).toISOString() };
    }

    if (Array.isArray(valor)) {
        return valor.map(item => serializarDatosFirestore(item));
    }

    if (typeof valor === 'object') {
        const copia = {};
        for (const [k, v] of Object.entries(valor)) {
            copia[k] = serializarDatosFirestore(v);
        }
        return copia;
    }

    return valor;
}

/**
 * Reconstruye objetos Date reales a partir del JSON guardado en sessionStorage
 * antes de enviarlos de vuelta a Firestore.
 */
export function deserializarDatosFirestore(valor) {
    if (valor === null || valor === undefined) return valor;

    if (typeof valor === 'object' && !Array.isArray(valor) && typeof valor.__gymDateISO === 'string') {
        return new Date(valor.__gymDateISO);
    }

    if (Array.isArray(valor)) {
        return valor.map(item => deserializarDatosFirestore(item));
    }

    if (typeof valor === 'object') {
        const copia = {};
        for (const [k, v] of Object.entries(valor)) {
            copia[k] = deserializarDatosFirestore(v);
        }
        return copia;
    }

    return valor;
}

/**
 * Ejecuta un conjunto de operaciones Firestore atómicamente en lotes (set / delete).
 * Cada operación tiene la forma:
 *   { type: 'set', collection: '...', id: '...', data: {...}, merge?: boolean }
 *   { type: 'delete', collection: '...', id: '...' }
 */
export async function ejecutarOperacionesFirestore(ops = []) {
    if (!Array.isArray(ops) || ops.length === 0) return;

    const CHUNK_SIZE = 400;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const chunk = ops.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);

        chunk.forEach(op => {
            if (!op || !op.collection || !op.id) return;
            const ref = doc(db, op.collection, op.id);
            if (op.type === 'delete') {
                batch.delete(ref);
            } else if (op.type === 'set') {
                const cleanData = deserializarDatosFirestore(op.data || {});
                if (op.merge) {
                    batch.set(ref, cleanData, { merge: true });
                } else {
                    batch.set(ref, cleanData);
                }
            }
        });

        await batch.commit();
    }
}

/**
 * Garantiza que exista el contenedor global de Toasts en el DOM.
 */
function obtenerContenedorToast() {
    let container = document.getElementById('gym-undo-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'gym-undo-toast-container';
        container.className = 'undo-toast-container';
        document.body.appendChild(container);
    }
    return container;
}

/**
 * Muestra un Toast flotante con opción de [Deshacer] y barra de progreso temporal.
 */
export function mostrarToastDeshacer(mensaje, onUndoCallback, duracionMs = 8000) {
    const container = obtenerContenedorToast();

    // Limpiar toasts previos para no acumular varios en pantalla
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    toast.innerHTML = `
        <div class="undo-toast-msg">${mensaje}</div>
        <div class="undo-toast-actions">
            <button type="button" class="undo-toast-btn">↩ Deshacer</button>
            <button type="button" class="undo-toast-close" title="Cerrar">&times;</button>
        </div>
        <div class="undo-toast-progress"></div>
    `;

    container.appendChild(toast);

    const btnUndo = toast.querySelector('.undo-toast-btn');
    const btnClose = toast.querySelector('.undo-toast-close');
    const progress = toast.querySelector('.undo-toast-progress');

    if (progress) {
        progress.style.transitionDuration = `${duracionMs}ms`;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                progress.style.transform = 'scaleX(0)';
            });
        });
    }

    let closed = false;
    const cerrar = () => {
        if (closed) return;
        closed = true;
        if ( toast.parentNode ) {
            toast.remove();
        }
    };

    const timer = setTimeout(cerrar, duracionMs);

    btnClose.addEventListener('click', () => {
        clearTimeout(timer);
        cerrar();
    });

    btnUndo.addEventListener('click', async () => {
        clearTimeout(timer);
        btnUndo.disabled = true;
        btnUndo.textContent = 'Restaurando...';
        if (progress) progress.style.display = 'none';

        try {
            await onUndoCallback();
            cerrar();
            mostrarToastInfo('✓ Acción deshecha correctamente');
        } catch (err) {
            console.error('Error al deshacer:', err);
            alert('No se pudo deshacer la acción: ' + (err.message || err));
            cerrar();
        }
    });
}

/**
 * Muestra una notificación breve informativa (sin botón).
 */
export function mostrarToastInfo(mensaje, duracionMs = 2600) {
    const container = obtenerContenedorToast();
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    toast.innerHTML = `
        <div class="undo-toast-msg">${mensaje}</div>
        <div class="undo-toast-actions">
            <button type="button" class="undo-toast-close" title="Cerrar">&times;</button>
        </div>
    `;
    container.appendChild(toast);

    const btnClose = toast.querySelector('.undo-toast-close');
    const timer = setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, duracionMs);

    btnClose.addEventListener('click', () => {
        clearTimeout(timer);
        if (toast.parentNode) toast.remove();
    });
}

/**
 * OPCIÓN 1: Función auxiliar para pantallas con borrado directo + confirmación + Toast Deshacer.
 * Lee la foto actual del documento en Firestore antes de borrarlo y permite restaurarlo con su mismo ID.
 */
export async function eliminarDocumentoConDeshacer({
    coleccion,
    id,
    nombreElemento = 'Elemento',
    mensajeConfirmacion = '¿Seguro que deseas eliminar este elemento?',
    onAfterChange = null
}) {
    if (mensajeConfirmacion && !window.confirm(mensajeConfirmacion)) {
        return false;
    }

    const ref = doc(db, coleccion, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        if (onAfterChange) await onAfterChange();
        return false;
    }

    const backupData = serializarDatosFirestore(snap.data());

    // Guardar también el último borrado en sessionStorage por seguridad
    try {
        sessionStorage.setItem(
            `gym_last_deleted_${coleccion}`,
            JSON.stringify({ coleccion, id, data: backupData, timestamp: Date.now() })
        );
    } catch (e) { /* ignore quota errors */ }

    await ejecutarOperacionesFirestore([{ type: 'delete', collection: coleccion, id }]);
    if (onAfterChange) await onAfterChange();

    mostrarToastDeshacer(`🗑️ ${nombreElemento} eliminado`, async () => {
        await ejecutarOperacionesFirestore([
            { type: 'set', collection: coleccion, id, data: backupData, merge: false }
        ]);
        if (onAfterChange) await onAfterChange();
    });

    return true;
}

/**
 * OPCIÓN 2: Gestor de Pila de Historial (Undo / Redo) hasta 15 pasos con caché en sessionStorage.
 * Ideal para las pantallas de planificación (Editar Plantilla, Programar Sesión, Ficha Cliente, Agenda, Plantillas).
 */
export function crearHistorialUndo({
    contextKey,
    maxSteps = DEFAULT_MAX_STEPS,
    containerId = null,
    onAfterApply = null
}) {
    const storageKey = `gym_undo_history_v1_${contextKey}`;
    let state = { undoStack: [], redoStack: [] };
    let isBusy = false;

    function cargarDesdeStorage() {
        try {
            const raw = sessionStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.undoStack) && Array.isArray(parsed.redoStack)) {
                    state.undoStack = parsed.undoStack.slice(-maxSteps);
                    state.redoStack = parsed.redoStack.slice(-maxSteps);
                }
            }
        } catch (e) {
            console.warn('No se pudo leer el historial de sessionStorage:', e);
        }
    }

    function guardarEnStorage() {
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(state));
        } catch (e) {
            console.warn('No se pudo guardar el historial en sessionStorage:', e);
        }
    }

    cargarDesdeStorage();

    function actualizarBotonesUI() {
        const btnUndo = document.getElementById(`btn-undo-${contextKey}`);
        const btnRedo = document.getElementById(`btn-redo-${contextKey}`);

        if (btnUndo) {
            const count = state.undoStack.length;
            const last = count > 0 ? state.undoStack[count - 1] : null;
            btnUndo.disabled = isBusy || count === 0;
            btnUndo.title = last
                ? `Deshacer: ${last.label} (Ctrl+Z)`
                : 'Nada que deshacer (Ctrl+Z)';
            btnUndo.innerHTML = `↩ Deshacer${count > 0 ? ` <span class="undo-count-badge">${count}</span>` : ''}`;
        }

        if (btnRedo) {
            const count = state.redoStack.length;
            const last = count > 0 ? state.redoStack[count - 1] : null;
            btnRedo.disabled = isBusy || count === 0;
            btnRedo.title = last
                ? `Rehacer: ${last.label} (Ctrl+Y)`
                : 'Nada que rehacer (Ctrl+Y)';
            btnRedo.innerHTML = `↪ Rehacer${count > 0 ? ` <span class="undo-count-badge">${count}</span>` : ''}`;
        }
    }

    async function undo() {
        if (isBusy || state.undoStack.length === 0) return;
        isBusy = true;
        actualizarBotonesUI();

        const step = state.undoStack.pop();
        try {
            await ejecutarOperacionesFirestore(step.undoOps);
            state.redoStack.push(step);
            if (state.redoStack.length > maxSteps) {
                state.redoStack.shift();
            }
            guardarEnStorage();
            if (onAfterApply) {
                await onAfterApply(step, 'undo');
            }
            mostrarToastInfo(`↩ Deshecho: ${step.label}`);
        } catch (err) {
            console.error('Error ejecutando Deshacer:', err);
            state.undoStack.push(step);
            alert('Hubo un error al deshacer el cambio: ' + (err.message || err));
        } finally {
            isBusy = false;
            actualizarBotonesUI();
        }
    }

    async function redo() {
        if (isBusy || state.redoStack.length === 0) return;
        isBusy = true;
        actualizarBotonesUI();

        const step = state.redoStack.pop();
        try {
            await ejecutarOperacionesFirestore(step.redoOps);
            state.undoStack.push(step);
            if (state.undoStack.length > maxSteps) {
                state.undoStack.shift();
            }
            guardarEnStorage();
            if (onAfterApply) {
                await onAfterApply(step, 'redo');
            }
            mostrarToastInfo(`↪ Rehecho: ${step.label}`);
        } catch (err) {
            console.error('Error ejecutando Rehacer:', err);
            state.redoStack.push(step);
            alert('Hubo un error al rehacer el cambio: ' + (err.message || err));
        } finally {
            isBusy = false;
            actualizarBotonesUI();
        }
    }

    /**
     * Registra un nuevo paso en el historial (máximo 15 pasos).
     * @param {Object} params
     * @param {string} params.label Descripción corta (ej. "Quitar ejercicio", "Reordenar bloques")
     * @param {Array} params.undoOps Operaciones Firestore para volver al estado previo
     * @param {Array} params.redoOps Operaciones Firestore para reaplicar el nuevo estado
     * @param {boolean} [params.showToast=false] Si true, lanza también el Toast flotante con botón [Deshacer]
     * @param {string} [params.toastMessage] Mensaje personalizado para el Toast
     */
    function pushAction({ label, undoOps = [], redoOps = [], showToast = false, toastMessage = null }) {
        const entry = {
            label: label || 'Cambio',
            undoOps: serializarDatosFirestore(undoOps),
            redoOps: serializarDatosFirestore(redoOps),
            timestamp: Date.now()
        };

        state.undoStack.push(entry);
        if (state.undoStack.length > maxSteps) {
            state.undoStack.shift();
        }
        state.redoStack = [];
        guardarEnStorage();
        actualizarBotonesUI();

        if (showToast) {
            mostrarToastDeshacer(toastMessage || `✓ ${entry.label}`, async () => {
                await undo();
            });
        }
    }

    function montarToolbar(targetId = containerId) {
        const container = typeof targetId === 'string' ? document.getElementById(targetId) : targetId;
        if (!container) return;

        container.innerHTML = `
            <div class="undo-toolbar">
                <button type="button" class="btn-undo-bar" id="btn-undo-${contextKey}" disabled>↩ Deshacer</button>
                <button type="button" class="btn-undo-bar" id="btn-redo-${contextKey}" disabled>↪ Rehacer</button>
            </div>
        `;

        const btnUndo = document.getElementById(`btn-undo-${contextKey}`);
        const btnRedo = document.getElementById(`btn-redo-${contextKey}`);

        if (btnUndo) btnUndo.addEventListener('click', undo);
        if (btnRedo) btnRedo.addEventListener('click', redo);

        actualizarBotonesUI();
    }

    // Atajos de teclado globales Ctrl+Z y Ctrl+Y / Ctrl+Shift+Z
    window.addEventListener('keydown', (e) => {
        // No interceptar si el usuario está escribiendo en un input/textarea/select
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) {
            return;
        }
        // No interceptar si hay un modal abierto en pantalla
        const modalAbierto = Array.from(document.querySelectorAll('.modal-overlay')).some(
            m => m.style.display && m.style.display !== 'none'
        );
        if (modalAbierto) return;

        const isCtrlOrCmd = e.ctrlKey || e.metaKey;
        if (!isCtrlOrCmd) return;

        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
            if (state.undoStack.length > 0) {
                e.preventDefault();
                undo();
            }
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
            if (state.redoStack.length > 0) {
                e.preventDefault();
                redo();
            }
        }
    });

    if (containerId) {
        montarToolbar(containerId);
    }

    return {
        pushAction,
        undo,
        redo,
        montarToolbar,
        actualizarBotonesUI
    };
}

