// utils.js - Funciones auxiliares, iconos SVG y utilidades de UI compartidas
import { db } from '../firebase-config.js';
import { collection, getDocs, doc, setDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { poblarSelect } from './maestros-service.js';

/**
 * Normaliza un texto eliminando tildes/diacríticos y convirtiéndolo a minúsculas
 * para búsquedas y comparaciones insensibles a acentos y mayúsculas/minúsculas.
 */
export function normalizarTexto(texto) {
    if (!texto) return "";
    return String(texto)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Iconos SVG estandarizados para toda la aplicación
 */
export const iconTrash = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

export const iconChevron = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

export const iconEdit = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;

export const iconDumbbell = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="18" y2="12"></line><rect x="4" y="8" width="2" height="8" rx="1"></rect><rect x="18" y="8" width="2" height="8" rx="1"></rect><rect x="2" y="10" width="2" height="4" rx="1"></rect><rect x="20" y="10" width="2" height="4" rx="1"></rect></svg>`;

export const iconCalendar = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;

export const iconArrowRight = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;

/**
 * Devuelve un icono chevron envuelto en .chevron-icon con rotación según su estado abierto/cerrado
 */
export function getChevronSVG(isExpanded = true, size = 18) {
    const rot = isExpanded ? '0deg' : '-90deg';
    return `<span class="chevron-icon"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease; transform: rotate(${rot});"><polyline points="6 9 12 15 18 9"></polyline></svg></span>`;
}

/**
 * Funciones estándar para abrir y cerrar modales por ID
 */
export function mostrarModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
}

export function ocultarModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
}

// ============================================================================
// CARGA DE PROGRAMADORES / ENTRENADORES DESDE usuarios_app
// ============================================================================

const PROGRAMADORES_CACHE_KEY = 'gym_programadores_cache_v1';

/**
 * Obtiene la lista de nombres de Programadores / Entrenadores desde la colección usuarios_app.
 * Filtra aquellos con es_programador === false (ej. cuentas técnicas) y prioriza el campo alias.
 */
export async function getListaProgramadores(forzar = false) {
    if (!forzar) {
        const cached = sessionStorage.getItem(PROGRAMADORES_CACHE_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            } catch (e) { }
        }
    }

    try {
        const snap = await getDocs(collection(db, "usuarios_app"));
        const vistos = new Set();
        const lista = [];

        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.es_programador === false) return;
            const nombre = String(d.alias || d.nombre_corto || d.nombre || '').trim();
            const norm = normalizarTexto(nombre);
            if (nombre && !vistos.has(norm)) {
                vistos.add(norm);
                lista.push(nombre);
            }
        });

        const prioridad = ['maite', 'andres'];
        lista.sort((a, b) => {
            const idxA = prioridad.indexOf(normalizarTexto(a));
            const idxB = prioridad.indexOf(normalizarTexto(b));
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b, 'es');
        });

        const finalLista = lista.length > 0 ? lista : ['Maite', 'Andrés'];
        sessionStorage.setItem(PROGRAMADORES_CACHE_KEY, JSON.stringify(finalLista));
        return finalLista;
    } catch (e) {
        console.warn("Error cargando usuarios_app para programadores:", e);
        return ['Maite', 'Andrés'];
    }
}

/**
 * Puebla un elemento <select> con los Programadores / Entrenadores de usuarios_app.
 */
export async function poblarSelectProgramadores(selectIdOrEl, placeholderText = 'Sin asignar', valorPorDefecto = null) {
    const el = typeof selectIdOrEl === 'string' ? document.getElementById(selectIdOrEl) : selectIdOrEl;
    if (!el) return [];

    const valores = await getListaProgramadores();
    el.innerHTML = '';

    if (placeholderText !== null) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = placeholderText;
        el.appendChild(opt);
    }

    valores.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        el.appendChild(opt);
    });

    if (valorPorDefecto) {
        const valLimpio = String(valorPorDefecto).trim();
        const match = valores.find(v => normalizarTexto(v) === normalizarTexto(valLimpio));
        if (match) {
            el.value = match;
        } else if (valLimpio) {
            const optExtra = document.createElement('option');
            optExtra.value = valLimpio;
            optExtra.textContent = valLimpio;
            el.appendChild(optExtra);
            el.value = valLimpio;
        }
    }

    return valores;
}

// ============================================================================
// SISTEMA ESTANDARIZADO DE DESPLEGABLES CON BUSCADOR (.custom-dropdown)
// ============================================================================

function getHiddenInputForDropdown(idRef, explicitInputId = null) {
    if (explicitInputId) {
        const el = document.getElementById(explicitInputId);
        if (el) return el;
    }
    const panel = document.getElementById(`panel${idRef}`);
    const fromWrapper = panel?.closest('.custom-dropdown')?.querySelector('input[type="hidden"]');
    if (fromWrapper) return fromWrapper;
    return (
        document.getElementById(`form${idRef}`) ||
        document.getElementById(`m_${idRef.toLowerCase()}_adaptacion`) ||
        document.getElementById(`m_${idRef.toLowerCase()}`)
    );
}

/**
 * Abre/cierra un panel desplegable (.dropdown-panel), cerrando los demás abiertos
 * y enfocando automáticamente su caja de búsqueda si existe.
 */
export function toggleDropdown(panelId, searchInputId = null) {
    document.querySelectorAll('.dropdown-panel.active').forEach(p => {
        if (p.id !== panelId) p.classList.remove('active');
    });
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
        const inp = searchInputId
            ? document.getElementById(searchInputId)
            : panel.querySelector('.dropdown-search-container input');
        if (inp) setTimeout(() => inp.focus(), 40);
    }
}

/**
 * Cierra un panel desplegable por su ID.
 */
export function closeDropdown(panelId) {
    document.getElementById(panelId)?.classList.remove('active');
}

/**
 * Filtra las opciones de un desplegable (#options{idRef}) de forma insensible
 * a mayúsculas/minúsculas y tildes usando normalizarTexto.
 */
export function filterDropdown(idRef, searchRaw = '') {
    const searchTxt = normalizarTexto(searchRaw);
    const container = document.getElementById(`options${idRef}`);
    if (!container) return;
    container.querySelectorAll('.dropdown-option').forEach(el => {
        if (el.getAttribute('data-empty') === 'true') return;
        const txt = el.getAttribute('data-search') || normalizarTexto(el.innerText);
        el.style.display = txt.includes(searchTxt) ? 'flex' : 'none';
    });
}

/**
 * Selecciona una opción en un desplegable de selección única, actualiza el input oculto
 * y el texto del trigger, cierra el panel y dispara el evento 'change'.
 */
export function selectSingleOption(idRef, val, labelTxt = null, inputId = null) {
    const hiddenInput = getHiddenInputForDropdown(idRef, inputId);
    const triggerText = document.getElementById(`triggerText${idRef}`);
    if (hiddenInput) hiddenInput.value = val ?? '';
    if (triggerText) triggerText.innerText = labelTxt ?? val ?? '';
    closeDropdown(`panel${idRef}`);
    if (hiddenInput) hiddenInput.dispatchEvent(new Event('change'));
}

/**
 * Renderiza opciones de selección única [{ value, label, search }] en #options{idRef}
 * con búsqueda normalizada y soporte de mensaje cuando no hay coincidencias.
 */
export function renderizarOpcionesDropdown(idRef, opciones = [], emptyMessage = 'Sin resultados coincidentes', inputId = null) {
    const container = document.getElementById(`options${idRef}`);
    if (!container) return;

    if (!opciones || opciones.length === 0) {
        container.innerHTML = `<div class="dropdown-option" data-empty="true" style="color: var(--text-muted); cursor: default;"><span>${emptyMessage}</span></div>`;
        return;
    }

    container.innerHTML = '';
    opciones.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'dropdown-option';
        div.setAttribute('data-search', normalizarTexto(opt.search || opt.label || ''));
        const span = document.createElement('span');
        span.textContent = opt.label;
        div.appendChild(span);
        div.addEventListener('click', () => {
            selectSingleOption(idRef, opt.value, opt.label, inputId);
        });
        container.appendChild(div);
    });
}

/**
 * Construye opciones simples o multiselección (checkboxes) a partir de una lista de strings.
 */
export function buildDropdownOptions(idRef, list = [], isMulti = true) {
    const container = document.getElementById(`options${idRef}`);
    if (!container) return;
    if (isMulti) {
        container.innerHTML = list.map(item => {
            const searchNorm = normalizarTexto(item).replace(/"/g, '&quot;');
            return `<label class="dropdown-option" data-search="${searchNorm}"><input type="checkbox" value="${item}" onchange="updateMultiSelection('${idRef}')"> <span>${item}</span></label>`;
        }).join('');
    } else {
        renderizarOpcionesDropdown(idRef, list.map(item => ({ value: item, label: item, search: item })));
    }
}

/**
 * Actualiza el valor oculto y el texto del trigger en un desplegable multiselección.
 */
export function updateMultiSelection(idRef) {
    const checks = document.querySelectorAll(`#options${idRef} input[type="checkbox"]:checked`);
    const vals = Array.from(checks).map(c => c.value);
    const hiddenInput = getHiddenInputForDropdown(idRef);
    const triggerText = document.getElementById(`triggerText${idRef}`);
    if (hiddenInput) hiddenInput.value = vals.join(', ');
    if (triggerText) triggerText.innerText = vals.length > 0 ? `${vals.length} seleccionado(s)` : 'Selecciona opciones';
}

/**
 * Limpia la selección (y el filtro de búsqueda) de un desplegable.
 */
export function clearDropdown(idRef, placeholder = 'Selecciona opciones') {
    document.querySelectorAll(`#options${idRef} input[type="checkbox"]`).forEach(c => { c.checked = false; });
    const hiddenInput = getHiddenInputForDropdown(idRef);
    const triggerText = document.getElementById(`triggerText${idRef}`);
    if (hiddenInput) hiddenInput.value = '';
    if (triggerText) triggerText.innerText = placeholder;
    const panel = document.getElementById(`panel${idRef}`);
    const searchInp = panel?.querySelector('.dropdown-search-container input');
    if (searchInp) searchInp.value = '';
    filterDropdown(idRef, '');
}

/**
 * Marca los valores indicados (separados por coma) en un desplegable multiselección o simple,
 * comparando de forma insensible a mayúsculas/tildes y espacios laterales.
 */
export function setDropdownValues(idRef, commaString) {
    if (!commaString) {
        clearDropdown(idRef);
        return;
    }
    const valsNorm = String(commaString).split(',').map(s => normalizarTexto(s.trim())).filter(Boolean);
    const checks = document.querySelectorAll(`#options${idRef} input[type="checkbox"]`);
    if (checks.length > 0) {
        checks.forEach(c => {
            c.checked = valsNorm.includes(normalizarTexto(c.value.trim()));
        });
        updateMultiSelection(idRef);
    } else {
        const firstVal = String(commaString).split(',')[0].trim();
        if (firstVal) selectSingleOption(idRef, firstVal, firstVal);
    }
}

// ============================================================================
// MODAL CENTRALIZADO "ENVIAR A" (A SESIÓN DE CLIENTE O GENERAR PLANTILLA)
// ============================================================================

let __enviarClientesCache = [];
let __enviarSesionesClienteCache = [];
let __enviarModoActual = 'cliente'; // 'cliente' | 'plantilla'
let __enviarContextoActual = {
    ejercicios: [],
    tipoSesionDefecto: null,
    undoHistory: null,
    onSuccess: null
};
let __enviarMaestrosCargados = false;

function normalizarEjerciciosParaPlantilla(ejercicios = []) {
    return (ejercicios || []).map(ej => {
        const clon = JSON.parse(JSON.stringify(ej));
        const nombre = clon.Nombre_Ejercicio || clon.Ejercicio_Detalle || clon.nombre_ejercicio || clon.ejercicio || clon.Nombre || 'Sin nombre';
        const acro = clon.Acrónimo ?? clon.Acronimo ?? clon.acronimo ?? clon.alias ?? clon.Alias ?? '';
        const bloque = clon.Bloque || clon.bloque || clon.Fase_Bloque || 'General';
        const sRaw = clon.Series || clon.series || '';
        const rRaw = clon.Repeticiones || clon.repeticiones || '';
        let series = clon.Volumen_Series_Reps || clon.Series_Reps || clon.series_reps || sRaw;
        if (!clon.Volumen_Series_Reps && !clon.Series_Reps && !clon.series_reps && rRaw) {
            series = sRaw ? `${sRaw} x ${rRaw}` : rRaw;
        }
        return {
            ...clon,
            ID_Ejercicio: clon.ID_Ejercicio || clon.id_ejercicio || '',
            Nombre_Ejercicio: nombre,
            Acrónimo: acro,
            Detalle: clon.Detalle || clon.detalle || '',
            Bloque: bloque,
            Series: series || '-',
            Peso: clon.Peso || clon.peso || '',
            Intensidad: clon.Intensidad || clon.intensidad || 'MED',
            Material: clon.Material || '',
            Material_Adaptacion: clon.Material_Adaptacion !== undefined ? clon.Material_Adaptacion : (clon.Material || ''),
            Subgrupo: (clon.Subgrupo || clon.subgrupo || '').trim(),
            Subgrupo_Detalle: (clon.Subgrupo_Detalle || clon.subgrupo_detalle || '').trim()
        };
    });
}

function asegurarModalEnviarDOM() {
    let modal = document.getElementById('modalEnviar');
    if (modal && modal.getAttribute('data-unified-enviar') === 'true') {
        return modal;
    }
    if (modal) {
        modal.remove();
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
    <div class="modal-overlay" id="modalEnviar" data-unified-enviar="true" style="display: none;">
        <div class="modal-content" style="max-width: 520px;">
            <button class="modal-close" type="button" onclick="cerrarModalEnviar()">&times;</button>
            <div class="modal-header" style="margin-bottom: 14px;">
                <h2 style="margin: 0 0 5px 0;">Enviar / Exportar Sesión</h2>
                <p style="margin: 0; color: var(--text-muted); font-size: 0.9rem;">Envía los ejercicios a otra sesión de un cliente o genera una plantilla predefinida.</p>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #f1f5f9; padding: 5px; border-radius: 10px; margin-bottom: 18px;">
                <button type="button" id="tabEnviarModoCliente" onclick="cambiarModoModalEnviar('cliente')"
                    style="padding: 9px 12px; border-radius: 7px; border: none; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.15s; background: var(--accent-dark); color: #ffffff;">
                    👤 Sesión de cliente
                </button>
                <button type="button" id="tabEnviarModoPlantilla" onclick="cambiarModoModalEnviar('plantilla')"
                    style="padding: 9px 12px; border-radius: 7px; border: none; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.15s; background: transparent; color: #475569;">
                    📋 Crear plantilla
                </button>
            </div>

            <form id="formEnviar">
                <!-- MODO 1: ENVIAR A SESIÓN DE CLIENTE -->
                <div id="bloqueEnviarCliente">
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label>Seleccionar Cliente Destino *</label>
                        <div class="custom-dropdown" id="dropdownEnviarCliente">
                            <div class="dropdown-trigger" onclick="toggleDropdown('panelEnviarCliente', 'searchEnviarCliente')">
                                <span id="triggerTextEnviarCliente">Elige un cliente...</span>
                                <span class="chevron-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
                            </div>
                            <div class="dropdown-panel" id="panelEnviarCliente">
                                <div class="dropdown-search-container">
                                    <input type="text" id="searchEnviarCliente" placeholder="Buscar cliente por nombre o alias..." oninput="filterDropdown('EnviarCliente', this.value)">
                                </div>
                                <div class="dropdown-options" id="optionsEnviarCliente"></div>
                            </div>
                            <input type="hidden" id="enviar_cliente" onchange="cargarSesionesClienteEnviar()">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Seleccionar Sesión Destino *</label>
                        <select id="enviar_sesion" disabled class="form-control">
                            <option value="">Primero selecciona un cliente...</option>
                        </select>
                    </div>
                </div>

                <!-- MODO 2: GENERAR PLANTILLA EN TIPO DE SESIÓN -->
                <div id="bloqueEnviarPlantilla" style="display: none;">
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label>Tipo de Sesión (Sección) *</label>
                        <select id="enviar_p_tipo" class="form-control"></select>
                    </div>
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label>Nombre de la plantilla *</label>
                        <input type="text" id="enviar_p_nombre" class="form-control" placeholder="Ej. Tren Inferior - Día 1">
                    </div>
                    <div class="form-group">
                        <label>Nivel Objetivo *</label>
                        <select id="enviar_p_nivel" class="form-control"></select>
                    </div>
                </div>

                <div class="modal-footer" style="margin-top: 20px;">
                    <button type="button" class="btn-secondary" onclick="cerrarModalEnviar()">Cancelar</button>
                    <button type="submit" class="btn-primary" id="btn-submit-enviar">Enviar Ejercicios</button>
                </div>
            </form>
        </div>
    </div>`;

    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);

    const form = modal.querySelector('#formEnviar');
    form.addEventListener('submit', manejarSubmitModalEnviar);

    return modal;
}

export function cambiarModoModalEnviar(modo = 'cliente') {
    __enviarModoActual = modo === 'plantilla' ? 'plantilla' : 'cliente';

    const btnCli = document.getElementById('tabEnviarModoCliente');
    const btnPla = document.getElementById('tabEnviarModoPlantilla');
    const bloqueCli = document.getElementById('bloqueEnviarCliente');
    const bloquePla = document.getElementById('bloqueEnviarPlantilla');
    const btnSubmit = document.getElementById('btn-submit-enviar');

    if ( btnCli && btnPla ) {
        if (__enviarModoActual === 'cliente') {
            btnCli.style.background = 'var(--accent-dark)';
            btnCli.style.color = '#ffffff';
            btnPla.style.background = 'transparent';
            btnPla.style.color = '#475569';
        } else {
            btnPla.style.background = 'var(--accent-dark)';
            btnPla.style.color = '#ffffff';
            btnCli.style.background = 'transparent';
            btnCli.style.color = '#475569';
        }
    }

    if (bloqueCli) bloqueCli.style.display = __enviarModoActual === 'cliente' ? 'block' : 'none';
    if (bloquePla) bloquePla.style.display = __enviarModoActual === 'plantilla' ? 'block' : 'none';
    if (btnSubmit) {
        btnSubmit.innerText = __enviarModoActual === 'cliente' ? 'Enviar Ejercicios' : 'Crear Plantilla';
    }

    if (__enviarModoActual === 'plantilla') {
        const inpNombre = document.getElementById('enviar_p_nombre');
        if (inpNombre) setTimeout(() => inpNombre.focus(), 40);
    }
}

export function cerrarModalEnviar() {
    const modal = document.getElementById('modalEnviar');
    if (modal) modal.style.display = 'none';
}

export async function cargarSesionesClienteEnviar() {
    const idCliente = document.getElementById('enviar_cliente')?.value;
    const selectSesion = document.getElementById('enviar_sesion');
    if (!selectSesion) return;

    if (!idCliente) {
        selectSesion.innerHTML = '<option value="">Primero selecciona un cliente...</option>';
        selectSesion.disabled = true;
        return;
    }

    selectSesion.innerHTML = '<option value="">Buscando sesiones...</option>';
    selectSesion.disabled = true;

    try {
        const q = query(collection(db, "agenda_sesiones"), where("id_cliente", "==", idCliente));
        const snap = await getDocs(q);

        __enviarSesionesClienteCache = [];
        snap.forEach(docSnap => {
            __enviarSesionesClienteCache.push({ id: docSnap.id, ...docSnap.data() });
        });

        __enviarSesionesClienteCache.sort((a, b) => b.fecha_hora_inicio.toMillis() - a.fecha_hora_inicio.toMillis());

        if (__enviarSesionesClienteCache.length === 0) {
            selectSesion.innerHTML = '<option value="">Este cliente no tiene sesiones agendadas</option>';
        } else {
            selectSesion.innerHTML = '<option value="">Elige una sesión destino...</option>';
            __enviarSesionesClienteCache.forEach(s => {
                const d = s.fecha_hora_inicio.toDate();
                const dStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
                const hStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

                const numEj = s.ejercicios ? s.ejercicios.length : 0;
                const textEj = numEj > 0 ? `(${numEj} ej. - SE SOBRESCRIBIRÁ)` : `(Vacía)`;

                selectSesion.innerHTML += `<option value="${s.id}">${dStr} a las ${hStr} ${textEj}</option>`;
            });
            selectSesion.disabled = false;
        }
    } catch (e) {
        console.error("Error cargando sesiones:", e);
        selectSesion.innerHTML = '<option value="">Error al buscar</option>';
    }
}

async function manejarSubmitModalEnviar(e) {
    e.preventDefault();
    const ejerciciosOrigen = __enviarContextoActual.ejercicios || [];
    if (!ejerciciosOrigen || ejerciciosOrigen.length === 0) {
        alert("Esta sesión no tiene ejercicios para enviar.");
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-enviar');

    if (__enviarModoActual === 'cliente') {
        const idSesionDestino = document.getElementById('enviar_sesion')?.value;
        if (!idSesionDestino) {
            alert("Por favor, selecciona un cliente y una sesión destino.");
            return;
        }

        if (btnSubmit) btnSubmit.innerText = "Enviando...";

        try {
            const autorNombre = localStorage.getItem('gym_user_name') || "Usuario desconocido";
            const sesionDestinoPrevia = __enviarSesionesClienteCache.find(s => s.id === idSesionDestino);
            const prevDestinoEjercicios = sesionDestinoPrevia ? JSON.parse(JSON.stringify(sesionDestinoPrevia.ejercicios || [])) : [];
            const nextDestinoEjercicios = JSON.parse(JSON.stringify(ejerciciosOrigen));

            await updateDoc(doc(db, "agenda_sesiones", idSesionDestino), {
                ejercicios: nextDestinoEjercicios,
                programado_por: autorNombre,
                fecha_programacion: new Date(),
                orden_customizado: true
            });

            cerrarModalEnviar();
            if (btnSubmit) btnSubmit.innerText = "Enviar Ejercicios";

            if (typeof __enviarContextoActual.onSuccess === 'function') {
                await __enviarContextoActual.onSuccess({ modo: 'cliente', idSesionDestino });
            }

            if (__enviarContextoActual.undoHistory) {
                __enviarContextoActual.undoHistory.pushAction({
                    label: "Enviar rutina a otra sesión",
                    undoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesionDestino, data: { ejercicios: prevDestinoEjercicios }, merge: true }],
                    redoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesionDestino, data: { ejercicios: nextDestinoEjercicios, orden_customizado: true }, merge: true }],
                    showToast: true,
                    toastMessage: "➡️ Rutina enviada a la sesión seleccionada"
                });
            }
        } catch (error) {
            console.error("Error al enviar la rutina:", error);
            alert("Error al enviar la rutina.");
            if (btnSubmit) btnSubmit.innerText = "Enviar Ejercicios";
        }
    } else {
        const tipoSesion = document.getElementById('enviar_p_tipo')?.value;
        const nombrePlantilla = document.getElementById('enviar_p_nombre')?.value.trim();
        const nivelPlantilla = document.getElementById('enviar_p_nivel')?.value;

        if (!tipoSesion || !nombrePlantilla || !nivelPlantilla) {
            alert("Por favor, completa el tipo de sesión, el nombre de la plantilla y el nivel.");
            return;
        }

        if (btnSubmit) btnSubmit.innerText = "Creando...";

        try {
            const idPlantilla = `PLANTILLA-${Date.now()}`;
            const ejerciciosNormalizados = normalizarEjerciciosParaPlantilla(ejerciciosOrigen);
            const newPlantillaData = {
                tipo_sesion: tipoSesion,
                nombre: nombrePlantilla,
                nivel: nivelPlantilla,
                ejercicios: ejerciciosNormalizados,
                orden_customizado: true
            };

            await setDoc(doc(db, "plantillas_sesiones", idPlantilla), newPlantillaData);

            cerrarModalEnviar();
            if (btnSubmit) btnSubmit.innerText = "Crear Plantilla";

            if (typeof __enviarContextoActual.onSuccess === 'function') {
                await __enviarContextoActual.onSuccess({ modo: 'plantilla', idPlantilla, plantilla: newPlantillaData });
            }

            if (__enviarContextoActual.undoHistory) {
                __enviarContextoActual.undoHistory.pushAction({
                    label: `Crear plantilla "${nombrePlantilla}"`,
                    undoOps: [{ type: 'delete', collection: 'plantillas_sesiones', id: idPlantilla }],
                    redoOps: [{ type: 'set', collection: 'plantillas_sesiones', id: idPlantilla, data: newPlantillaData, merge: false }],
                    showToast: true,
                    toastMessage: `📋 Plantilla "${nombrePlantilla}" creada en ${tipoSesion}`
                });
            }
        } catch (error) {
            console.error("Error al crear la plantilla:", error);
            alert("Error al generar la plantilla.");
            if (btnSubmit) btnSubmit.innerText = "Crear Plantilla";
        }
    }
}

/**
 * Abre el modal unificado "Enviar / Exportar Sesión" para copiar una rutina a otra sesión de un cliente
 * o crear una plantilla en un Tipo de Sesión a partir de los ejercicios indicados.
 */
export async function abrirModalEnviarSesion({
    ejercicios = [],
    tipoSesionDefecto = null,
    undoHistory = null,
    onSuccess = null
} = {}) {
    __enviarContextoActual = {
        ejercicios: Array.isArray(ejercicios) ? ejercicios : [],
        tipoSesionDefecto,
        undoHistory,
        onSuccess
    };

    asegurarModalEnviarDOM();
    cambiarModoModalEnviar('cliente');

    const triggerCliente = document.getElementById('triggerTextEnviarCliente');
    const selectSesion = document.getElementById('enviar_sesion');
    const inpNombre = document.getElementById('enviar_p_nombre');

    clearDropdown('EnviarCliente', 'Elige un cliente...');
    closeDropdown('panelEnviarCliente');

    if (selectSesion) {
        selectSesion.innerHTML = '<option value="">Primero selecciona un cliente...</option>';
        selectSesion.disabled = true;
    }
    if (inpNombre) inpNombre.value = '';

    document.getElementById('modalEnviar').style.display = 'flex';

    // Cargar maestros de Tipo de Sesión y Niveles para la pestaña de Plantilla
    if (!__enviarMaestrosCargados) {
        await Promise.all([
            poblarSelect('enviar_p_tipo', 'Sesiones', 'Tipo de Sesión', null),
            poblarSelect('enviar_p_nivel', 'Ejercicios', 'Niveles', null)
        ]);
        __enviarMaestrosCargados = true;
    }

    const selTipo = document.getElementById('enviar_p_tipo');
    if (selTipo && tipoSesionDefecto && selTipo.querySelector(`option[value="${tipoSesionDefecto}"]`)) {
        selTipo.value = tipoSesionDefecto;
    }

    // Cargar lista de clientes para la pestaña de Sesión de Cliente
    if (__enviarClientesCache.length === 0) {
        if (triggerCliente) triggerCliente.innerText = 'Cargando clientes...';
        try {
            const snap = await getDocs(collection(db, "clientes"));
            __enviarClientesCache = [];
            snap.forEach(docSnap => __enviarClientesCache.push({ id: docSnap.id, ...docSnap.data() }));

            __enviarClientesCache.sort((a, b) => {
                const nameA = a.Alias || a.Nombre_Cliente || a.Nombre || a.nombre || '';
                const nameB = b.Alias || b.Nombre_Cliente || b.Nombre || b.nombre || '';
                return nameA.localeCompare(nameB);
            });
        } catch (e) {
            console.error("Error cargando clientes:", e);
            if (triggerCliente) triggerCliente.innerText = 'Error al cargar clientes';
            return;
        }
    }

    if (triggerCliente) triggerCliente.innerText = 'Elige un cliente...';
    renderizarOpcionesDropdown('EnviarCliente', __enviarClientesCache.map(c => {
        const name = c.Alias || c.Nombre_Cliente || c.Nombre || c.nombre || 'Sin nombre';
        const fullName = c.Nombre_Cliente || c.Nombre || c.nombre || '';
        return { value: c.id, label: name, search: `${name} ${fullName}` };
    }), 'Sin clientes coincidentes', 'enviar_cliente');
}

// Exponer funciones en window para atributos onclick/oninput/onkeyup del HTML y cerrar al hacer clic fuera
if (typeof window !== 'undefined') {
    window.toggleDropdown = toggleDropdown;
    window.closeDropdown = closeDropdown;
    window.filterDropdown = filterDropdown;
    window.selectSingleOption = selectSingleOption;
    window.renderizarOpcionesDropdown = renderizarOpcionesDropdown;
    window.buildDropdownOptions = buildDropdownOptions;
    window.updateMultiSelection = updateMultiSelection;
    window.clearDropdown = clearDropdown;
    window.setDropdownValues = setDropdownValues;
    window.abrirModalEnviarSesion = abrirModalEnviarSesion;
    window.cerrarModalEnviar = cerrarModalEnviar;
    window.cambiarModoModalEnviar = cambiarModoModalEnviar;
    window.cargarSesionesClienteEnviar = cargarSesionesClienteEnviar;

    // Alias de compatibilidad para selectores de clientes
    window.toggleClienteDropdown = toggleDropdown;
    window.filtrarClienteDropdown = filterDropdown;
    window.seleccionarClienteDropdown = (idRef, inputId, idVal, labelTxt) =>
        selectSingleOption(idRef, idVal, labelTxt, inputId);

    if (!window.__gymDropdownOutsideClickBound) {
        window.__gymDropdownOutsideClickBound = true;
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.custom-dropdown')) {
                document.querySelectorAll('.dropdown-panel.active').forEach(p => p.classList.remove('active'));
            }
        });
    }
}
