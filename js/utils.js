// utils.js - Funciones auxiliares, iconos SVG y utilidades de UI compartidas
import { db } from '../firebase-config.js';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, writeBatch, query, where } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { poblarSelect, getValoresMaestro } from './maestros-service.js';

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
 * Devuelve una etiqueta visual (badge) para la intensidad (LOW, MED, HIGH)
 */
export function renderEtiquetaIntensidad(intensidadRaw, defaultVal = 'MED') {
    const val = String(intensidadRaw || defaultVal || '').trim().toUpperCase();
    if (!val) return '';
    const cls = val === 'LOW' ? 'int-low' : val === 'HIGH' ? 'int-high' : 'int-med';
    return `<span class="intensity-badge ${cls}" title="Intensidad: ${val}">⚡ ${val}</span>`;
}

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
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label>Nivel Objetivo *</label>
                        <select id="enviar_p_nivel" class="form-control"></select>
                    </div>
                    <div class="form-group">
                        <label>Intensidad de la Plantilla *</label>
                        <select id="enviar_p_intensidad" class="form-control">
                            <option value="LOW">LOW</option>
                            <option value="MED" selected>MED</option>
                            <option value="HIGH">HIGH</option>
                        </select>
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

            const intensOrigen = __enviarContextoActual.intensidadDefecto || 'MED';
            await updateDoc(doc(db, "agenda_sesiones", idSesionDestino), {
                ejercicios: nextDestinoEjercicios,
                intensidad: intensOrigen,
                Intensidad: intensOrigen,
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
        const intensidadPlantilla = document.getElementById('enviar_p_intensidad')?.value || __enviarContextoActual.intensidadDefecto || 'MED';

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
                intensidad: intensidadPlantilla,
                Intensidad: intensidadPlantilla,
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
    intensidadDefecto = 'MED',
    undoHistory = null,
    onSuccess = null
} = {}) {
    __enviarContextoActual = {
        ejercicios: Array.isArray(ejercicios) ? ejercicios : [],
        tipoSesionDefecto,
        intensidadDefecto: intensidadDefecto || 'MED',
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
    const selInt = document.getElementById('enviar_p_intensidad');
    if (selInt) {
        selInt.value = String(intensidadDefecto || 'MED').toUpperCase();
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

// ============================================================================
// GESTIÓN UNIFICADA DE ACCIONES DE SESIÓN (REPROGRAMAR, ELIMINAR Y MENÚ AGENDA)
// ============================================================================

export function obtenerAccionesDisponiblesSesion(sesionRaw = {}) {
    const d = sesionRaw.fechaObj instanceof Date
        ? sesionRaw.fechaObj
        : (sesionRaw.fecha_hora_inicio?.toDate ? sesionRaw.fecha_hora_inicio.toDate() : new Date(sesionRaw.fecha_hora_inicio || Date.now()));

    const now = new Date();
    const nowNominalUTC = new Date(Date.UTC(
        now.getFullYear(), now.getMonth(), now.getDate(),
        now.getHours(), now.getMinutes(), now.getSeconds()
    ));

    let estado = 'Pendiente';
    if (sesionRaw.estado === 'Completada') {
        estado = 'Completada';
    } else if (d < nowNominalUTC || sesionRaw.estado === 'Vencida') {
        estado = 'Vencida';
    }

    const limiteReprogramar = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0));
    const tipoSesion = sesionRaw.tipo_sesion || sesionRaw.Tipo || 'Individual';
    const isSG = tipoSesion === 'Small Group' || tipoSesion === 'SG';
    const ejercicios = Array.isArray(sesionRaw.ejercicios) ? sesionRaw.ejercicios : [];

    const puedeProgramar = !isSG && estado === 'Pendiente';
    const puedeReprogramar = !isSG && (estado === 'Pendiente' || (estado === 'Vencida' && d >= limiteReprogramar));
    const puedeEnviar = ejercicios.length > 0;
    const puedeEliminar = true;

    return {
        fechaObj: d,
        estado,
        isSG,
        tipo_sesion: isSG ? 'Small Group' : 'Individual',
        ejercicios,
        puedeProgramar,
        puedeReprogramar,
        puedeEnviar,
        puedeEliminar
    };
}

export function formatearSesionAgenda(id, data = {}) {
    const info = obtenerAccionesDisponiblesSesion(data);
    const d = info.fechaObj;
    return {
        id,
        fechaObj: d,
        fechaStr: d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }),
        diaStr: d.toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'UTC' }).replace(/^\w/, c => c.toUpperCase()),
        horaStr: d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' - ' + new Date(d.getTime() + 60 * 60000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
        estado: info.estado,
        tipo_sesion: info.tipo_sesion,
        ejercicios: info.ejercicios,
        orden_customizado: data.orden_customizado || false,
        id_cliente: data.id_cliente || data.ID_Cliente || '',
        alias: data.alias || data.Alias || data.nombre_cliente || data.Nombre_Cliente || 'Sin nombre',
        nombre_cliente: data.nombre_cliente || data.Nombre_Cliente || data.alias || data.Alias || 'Sin nombre',
        docData: data
    };
}

export async function eliminarSesionConDeshacer({
    idSesion,
    sesionObj = null,
    undoHistory = null,
    onSuccess = null
} = {}) {
    if (!idSesion) return false;
    if (!confirm("¿Estás seguro de que quieres eliminar esta sesión de la agenda?")) return false;

    try {
        let backupData = sesionObj?.docData || null;
        if (!backupData) {
            const snap = await getDoc(doc(db, "agenda_sesiones", idSesion));
            if (snap.exists()) backupData = snap.data();
        }
        const sesionFmt = sesionObj || (backupData ? formatearSesionAgenda(idSesion, backupData) : null);
        const fechaLabel = sesionFmt ? `${sesionFmt.fechaStr} (${sesionFmt.horaStr.split(' - ')[0]})` : idSesion;

        await deleteDoc(doc(db, "agenda_sesiones", idSesion));

        if (typeof onSuccess === 'function') {
            await onSuccess({ idSesion });
        }

        if (backupData && undoHistory) {
            undoHistory.pushAction({
                label: `Eliminar sesión ${fechaLabel}`,
                undoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesion, data: backupData, merge: false }],
                redoOps: [{ type: 'delete', collection: 'agenda_sesiones', id: idSesion }],
                showToast: true,
                toastMessage: `🗑️ Sesión del ${fechaLabel} eliminada`
            });
        }
        return true;
    } catch (e) {
        console.error("Error al borrar sesión:", e);
        alert("No se pudo borrar la sesión.");
        return false;
    }
}

let __reprogContext = {
    sourceSessionId: null,
    idCliente: null,
    nombreCliente: '',
    allSessions: [],
    currentMonday: null,
    originMonday: null,
    pendingReprogData: null,
    undoHistory: null,
    onSuccess: null
};
let __reprogDiasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
let __reprogTimeSlots = [];
let __reprogTimeToRowMap = {};
let __reprogSeparatorRow = 12;
const __mesNamesReprog = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function __obtenerLunesUTC(dateObj) {
    const d = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 0, 0, 0, 0));
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
}

function __obtenerSiguienteDiaHabilUTC(fechaBase) {
    const sig = new Date(fechaBase.getTime());
    sig.setUTCDate(sig.getUTCDate() + 1);
    while (sig.getUTCDay() === 0 || sig.getUTCDay() === 6) {
        sig.setUTCDate(sig.getUTCDate() + 1);
    }
    return sig;
}

async function __asegurarMaestrosCalendarioReprog() {
    if (__reprogTimeSlots.length > 0) return;
    const [diasDB, horasIndDB] = await Promise.all([
        getValoresMaestro('Agenda', 'Días de la semana'),
        getValoresMaestro('Agenda', 'Horarios Sesiones Individuales')
    ]);
    if (diasDB && diasDB.length > 0) __reprogDiasSemana = diasDB;
    __reprogTimeSlots = (horasIndDB && horasIndDB.length > 0) ? horasIndDB : [
        '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
        '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'
    ];

    __reprogTimeToRowMap = {};
    const manana = __reprogTimeSlots.filter(t => parseInt(t.split(':')[0], 10) < 14);
    const tarde = __reprogTimeSlots.filter(t => parseInt(t.split(':')[0], 10) >= 14);
    let r = 2;
    manana.forEach(t => { __reprogTimeToRowMap[t] = r++; });
    __reprogSeparatorRow = r++;
    tarde.forEach(t => { __reprogTimeToRowMap[t] = r++; });
}

function __asegurarModalReprogramarDOM() {
    let modal = document.getElementById('modalReprogramar');
    if (modal) return modal;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
    <div class="modal-overlay" id="modalReprogramar" data-unified-reprog="true" style="display:none;">
        <div class="modal-content" style="max-width: 940px; width: 95%;">
            <button class="modal-close" type="button" onclick="cerrarModalReprogramar()">&times;</button>
            <h2 style="margin:0 0 6px 0;">Reprogramar Sesión</h2>

            <div id="reprog-step-1">
                <div id="reprog-origin-banner"
                    style="background:#fffbeb; border:1px solid #fcd34d; color:#92400e; padding:10px 14px; border-radius:8px; font-size:0.88rem; margin-bottom:12px;">
                    Selecciona en el calendario el nuevo día y hora haciendo clic en cualquier casilla.
                </div>

                <div class="reprog-toolbar">
                    <div class="reprog-nav-group">
                        <button type="button" class="reprog-nav-arrow" onclick="window.cambiarSemanaReprog(-1)" title="Semana anterior">&lt;</button>
                        <span class="reprog-week-title" id="reprog-week-title">Cargando semana...</span>
                        <button type="button" class="reprog-nav-arrow" onclick="window.cambiarSemanaReprog(1)" title="Semana siguiente">&gt;</button>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn-secondary" style="padding:6px 12px; font-size:0.8rem;" onclick="window.irSemanaHoyReprog()">Semana actual</button>
                        <button type="button" class="btn-secondary" style="padding:6px 12px; font-size:0.8rem;" onclick="window.irSemanaOrigenReprog()">Semana de la sesión</button>
                    </div>
                </div>

                <div class="reprog-calendar-wrapper">
                    <div id="reprog-calendar-container"></div>
                </div>

                <div class="reprog-legend">
                    <span class="reprog-legend-item"><span class="reprog-legend-box" style="background:#fef3c7; border:2px dashed #d97706;"></span> Sesión a mover</span>
                    <span class="reprog-legend-item"><span class="reprog-legend-box" style="background:#e0f2fe; border:1px solid #38bdf8;"></span> Otras sesiones del cliente</span>
                    <span class="reprog-legend-item"><span class="reprog-legend-box" style="background:#dcfce7; border:1px solid #86efac;"></span> Completada (bloqueada)</span>
                    <span style="margin-left:auto; font-weight:600; color:var(--accent-dark);">💡 Haz clic en una hora para elegir dónde moverla</span>
                </div>

                <div class="modal-footer" style="margin-top: 15px;">
                    <button type="button" class="btn-secondary" onclick="cerrarModalReprogramar()">Cancelar</button>
                </div>
            </div>

            <div id="reprog-step-2" style="display:none;" class="conflict-options"></div>
        </div>
    </div>`;
    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
    return modal;
}

function __renderCalendarioReprog() {
    const container = document.getElementById('reprog-calendar-container');
    const titleEl = document.getElementById('reprog-week-title');
    if (!container || !__reprogContext.currentMonday) return;

    const numDias = __reprogDiasSemana.length;
    const startDay = new Date(__reprogContext.currentMonday);
    const endDay = new Date(__reprogContext.currentMonday);
    endDay.setUTCDate(endDay.getUTCDate() + (numDias - 1));

    if (titleEl) {
        titleEl.innerText = `📅 ${startDay.getUTCDate()} ${__mesNamesReprog[startDay.getUTCMonth()]} - ${endDay.getUTCDate()} ${__mesNamesReprog[endDay.getUTCMonth()]} ${endDay.getUTCFullYear()}`;
    }

    const mananaCount = __reprogTimeSlots.filter(t => parseInt(t.split(':')[0], 10) < 14).length;
    const tardeCount = __reprogTimeSlots.filter(t => parseInt(t.split(':')[0], 10) >= 14).length;
    const dynamicGridStyle = `grid-template-columns: 60px repeat(${numDias}, 1fr); grid-template-rows: auto repeat(${mananaCount}, 32px) 14px repeat(${tardeCount}, 32px);`;

    let headersHTML = `<div class="reprog-day-header" style="grid-column: 1; grid-row: 1; border-right: 2px solid var(--border);">Hora</div>`;
    const now = new Date();
    const hoyISO = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().split('T')[0];

    let tempDay = new Date(__reprogContext.currentMonday);
    for (let i = 0; i < numDias; i++) {
        const dateISO = tempDay.toISOString().split('T')[0];
        const isToday = dateISO === hoyISO;
        const bgHeader = isToday ? 'background:#f0fdfa;' : '';
        headersHTML += `
            <div class="reprog-day-header" style="grid-column: ${i + 2}; grid-row: 1; ${bgHeader}">
                <strong>${__reprogDiasSemana[i]}${isToday ? ' (Hoy)' : ''}</strong>
                <span>${tempDay.getUTCDate()} ${__mesNamesReprog[tempDay.getUTCMonth()]}</span>
            </div>
        `;
        tempDay.setUTCDate(tempDay.getUTCDate() + 1);
    }

    let cellsHTML = '';
    for (let i = 0; i < __reprogTimeSlots.length; i++) {
        const time = __reprogTimeSlots[i];
        const row = __reprogTimeToRowMap[time];
        cellsHTML += `<div class="reprog-time-label" style="grid-column: 1; grid-row: ${row};">${time}</div>`;

        let dIter = new Date(__reprogContext.currentMonday);
        for (let col = 2; col <= numDias + 1; col++) {
            const dateStrID = dIter.toISOString().split('T')[0];
            cellsHTML += `<div class="reprog-bg-cell" style="grid-column: ${col}; grid-row: ${row};" onclick="window.seleccionarHuecoReprogramar('${dateStrID}', '${time}')" title="Mover sesión al ${dateStrID} a las ${time}"></div>`;
            dIter.setUTCDate(dIter.getUTCDate() + 1);
        }
    }

    const weekStartUTC = new Date(__reprogContext.currentMonday);
    weekStartUTC.setUTCHours(0, 0, 0, 0);
    const weekEndUTC = new Date(__reprogContext.currentMonday);
    weekEndUTC.setUTCDate(weekEndUTC.getUTCDate() + numDias);
    weekEndUTC.setUTCHours(0, 0, 0, 0);

    const sesionesSemanaCliente = (__reprogContext.allSessions || []).filter(s => s.fechaObj >= weekStartUTC && s.fechaObj < weekEndUTC);

    let eventsHTML = '';
    sesionesSemanaCliente.forEach(s => {
        const dayIndex = s.fechaObj.getUTCDay();
        if (dayIndex < 1 || dayIndex > numDias) return;

        const col = dayIndex + 1;
        const timeStr = s.horaStr.split(' - ')[0];
        const row = __reprogTimeToRowMap[timeStr];
        if (!row) return;

        const dateStrID = s.fechaObj.toISOString().split('T')[0];
        const isOrigin = s.id === __reprogContext.sourceSessionId;
        const isCompleted = s.estado === 'Completada';
        const numEj = s.ejercicios ? s.ejercicios.length : 0;
        const ejLabel = numEj > 0 ? `${numEj} ej.` : 'Vacía';

        let cardClass = 'reprog-event-other';
        let titleBadge = `📅 ${timeStr} (${ejLabel})`;
        let clickHandler = `onclick="window.seleccionarHuecoReprogramar('${dateStrID}', '${timeStr}')"`;

        if (isOrigin) {
            cardClass = 'reprog-event-origin';
            titleBadge = `📍 Sesión a mover (${ejLabel})`;
        } else if (isCompleted) {
            cardClass = 'reprog-event-completed';
            titleBadge = `✅ Completada (${ejLabel})`;
            clickHandler = `onclick="alert('No puedes reprogramar sobre un día que ya tiene una sesión completada.')"`;
        }

        eventsHTML += `
            <div class="reprog-event-card ${cardClass}" style="grid-column: ${col}; grid-row: ${row} / span 2;" ${clickHandler} title="Haz clic para elegir ${dateStrID} a las ${timeStr}">
                <div>${titleBadge}</div>
            </div>
        `;
    });

    container.innerHTML = `
        <div class="reprog-calendar-grid" style="${dynamicGridStyle}">
            ${headersHTML}
            ${cellsHTML}
            <div class="reprog-noon-separator" style="grid-row: ${__reprogSeparatorRow};"></div>
            ${eventsHTML}
        </div>
    `;
}

export async function abrirModalReprogramarSesion({
    idSesion,
    idCliente = null,
    nombreCliente = '',
    sesionesCliente = null,
    undoHistory = null,
    onSuccess = null
} = {}) {
    if (!idSesion) return;
    __asegurarModalReprogramarDOM();
    await __asegurarMaestrosCalendarioReprog();

    let listaSesiones = Array.isArray(sesionesCliente) ? [...sesionesCliente] : null;
    let idCliFinal = idCliente;
    let nombreCliFinal = nombreCliente;

    if (!listaSesiones) {
        if (!idCliFinal) {
            const snapSes = await getDoc(doc(db, "agenda_sesiones", idSesion));
            if (snapSes.exists()) {
                const dSes = snapSes.data();
                idCliFinal = dSes.id_cliente || dSes.ID_Cliente || '';
                nombreCliFinal = nombreCliFinal || dSes.alias || dSes.nombre_cliente || '';
            }
        }
        listaSesiones = [];
        if (idCliFinal) {
            const q = query(collection(db, "agenda_sesiones"), where("id_cliente", "==", idCliFinal));
            const snap = await getDocs(q);
            snap.forEach(docSnap => {
                listaSesiones.push(formatearSesionAgenda(docSnap.id, docSnap.data()));
            });
            listaSesiones.sort((a, b) => b.fechaObj - a.fechaObj);
        }
    }

    const s = listaSesiones.find(x => x.id === idSesion);
    if (!s) {
        alert("No se encontró la sesión a reprogramar.");
        return;
    }

    if (!idCliFinal) idCliFinal = s.id_cliente || s.docData?.id_cliente || s.docData?.ID_Cliente || '';
    if (!nombreCliFinal) nombreCliFinal = s.alias || s.docData?.alias || s.docData?.nombre_cliente || 'Cliente';

    __reprogContext = {
        sourceSessionId: idSesion,
        idCliente: idCliFinal,
        nombreCliente: nombreCliFinal,
        allSessions: listaSesiones,
        originMonday: __obtenerLunesUTC(s.fechaObj),
        currentMonday: new Date(__obtenerLunesUTC(s.fechaObj)),
        pendingReprogData: null,
        undoHistory,
        onSuccess
    };

    const horaOrigen = s.horaStr.split(' - ')[0];
    const numEj = s.ejercicios ? s.ejercicios.length : 0;
    const banner = document.getElementById('reprog-origin-banner');
    if (banner) {
        const clientePrefix = nombreCliFinal ? `<strong>${nombreCliFinal}</strong> · ` : '';
        banner.innerHTML = `📍 <strong>Sesión a reprogramar:</strong> ${clientePrefix}${s.diaStr} ${s.fechaStr} a las <strong>${horaOrigen}</strong> (${numEj} ejercicio${numEj === 1 ? '' : 's'}) &mdash; Haz clic en cualquier hora del calendario para ubicarla.`;
    }

    document.getElementById('reprog-step-1').style.display = 'block';
    document.getElementById('reprog-step-2').style.display = 'none';
    document.getElementById('modalReprogramar').style.display = 'flex';

    __renderCalendarioReprog();
}

export function cerrarModalReprogramar() {
    const modal = document.getElementById('modalReprogramar');
    if (modal) modal.style.display = 'none';
    const step1 = document.getElementById('reprog-step-1');
    const step2 = document.getElementById('reprog-step-2');
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
    __reprogContext.pendingReprogData = null;
}

export function cambiarSemanaReprog(deltaSemanas) {
    if (!__reprogContext.currentMonday) return;
    __reprogContext.currentMonday.setUTCDate(__reprogContext.currentMonday.getUTCDate() + deltaSemanas * 7);
    __renderCalendarioReprog();
}

export function irSemanaHoyReprog() {
    const now = new Date();
    const hoyUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    __reprogContext.currentMonday = __obtenerLunesUTC(hoyUTC);
    __renderCalendarioReprog();
}

export function irSemanaOrigenReprog() {
    if (!__reprogContext.originMonday) return;
    __reprogContext.currentMonday = new Date(__reprogContext.originMonday);
    __renderCalendarioReprog();
}

export function volverAlCalendarioReprog() {
    const step1 = document.getElementById('reprog-step-1');
    const step2 = document.getElementById('reprog-step-2');
    if (step2) step2.style.display = 'none';
    if (step1) step1.style.display = 'block';
}

export function seleccionarHuecoReprogramar(fechaStr, horaStr) {
    const idSesion = __reprogContext.sourceSessionId;
    if (!idSesion) return;

    const [y, m, d] = fechaStr.split('-');
    const [h, min] = horaStr.split(':');
    const targetFechaStr = `${d}/${m}/${y}`;
    const nuevaFechaObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), 0));

    const allSessions = __reprogContext.allSessions || [];
    const sourceSession = allSessions.find(x => x.id === idSesion);
    if (!sourceSession) return;

    const sesionesDestino = allSessions.filter(s => s.fechaStr === targetFechaStr && s.id !== idSesion);
    if (sesionesDestino.some(s => s.estado === 'Completada')) {
        alert("Operación bloqueada: No puedes reprogramar una sesión en un día que ya tiene una sesión completada.");
        return;
    }

    const targetSession = sesionesDestino[0] || null;
    const sessionsToPull = allSessions.filter(s => s.fechaObj > nuevaFechaObj && s.id !== idSesion).sort((a, b) => a.fechaObj - b.fechaObj);
    const autor = localStorage.getItem('gym_user_name') || "Usuario desconocido";

    __reprogContext.pendingReprogData = { sourceSession, targetSession, sessionsToPull, autor, nuevaFechaObj };

    const diaDestinoNombre = nuevaFechaObj.toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'UTC' }).replace(/^\w/, c => c.toUpperCase());

    const step2 = document.getElementById('reprog-step-2');
    let menuHTML = `<div style="background:#fffbeb; border:1px solid #fcd34d; padding:15px; border-radius:8px; margin-bottom:20px;">
        <h4 style="color:#d97706; margin:0 0 6px 0;">Opciones de Planificación</h4>
        <p style="margin:0 0 6px 0; font-size:0.9rem; color:#92400e;">
            Mover del <strong>${sourceSession.diaStr} ${sourceSession.fechaStr} (${sourceSession.horaStr.split(' - ')[0]})</strong>
            al <strong>${diaDestinoNombre} ${targetFechaStr} a las ${horaStr}</strong>.
        </p>
        <p style="margin:0; font-size:0.85rem; color:#92400e;">¿Cómo deseas organizar las rutinas de la línea temporal?</p>
    </div>`;

    menuHTML += `<button type="button" class="btn-primary" style="width:100%; margin-bottom:10px; text-align:left; padding:12px; background:#0f172a;" onclick="window.ejecutarSustitucion()">
        <strong>Mantener / Sustituir rutina</strong><br><span style="font-size:0.8rem; font-weight:normal;">Mueve la sesión a la nueva hora conservando su rutina original. Si hay otra sesión ese día, se sobrescribe.</span>
    </button>`;

    menuHTML += `<button type="button" class="btn-primary" style="width:100%; margin-bottom:10px; text-align:left; padding:12px; background:#0284c7;" onclick="window.ejecutarDesplazamiento()">
        <strong>Mover rutinas hacia adelante (Cascada Adelante)</strong><br><span style="font-size:0.8rem; font-weight:normal;">Empuja las rutinas siguientes una sesión hacia adelante y, si la última tiene programación, crea una nueva sesión el día hábil siguiente para no perderla.</span>
    </button>`;

    menuHTML += `<button type="button" class="btn-primary" style="width:100%; margin-bottom:10px; text-align:left; padding:12px; background:#16a34a;" onclick="window.ejecutarRecogidaCascada()">
        <strong>Mover rutinas hacia atrás / Recoger (Cascada Atrás)</strong><br><span style="font-size:0.8rem; font-weight:normal;">Ubica la sesión en la nueva hora y adelanta la rutina de la siguiente sesión a este hueco (la última quedará vacía).</span>
    </button>`;

    menuHTML += `<button type="button" class="btn-secondary" style="width:100%; text-align:center; padding:12px;" onclick="window.volverAlCalendarioReprog()">⬅️ Volver al calendario</button>`;

    step2.innerHTML = menuHTML;
    document.getElementById('reprog-step-1').style.display = 'none';
    step2.style.display = 'block';
}

export async function ejecutarSustitucion() {
    if (!__reprogContext.pendingReprogData) return;
    const { sourceSession, targetSession, autor, nuevaFechaObj } = __reprogContext.pendingReprogData;
    const { undoHistory, onSuccess } = __reprogContext;
    try {
        const undoOps = [
            { type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: sourceSession.docData, merge: false }
        ];
        const redoOps = [];

        if (targetSession) {
            undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: targetSession.id, data: targetSession.docData, merge: false });
            const newTargetData = {
                ejercicios: sourceSession.ejercicios || [],
                fecha_hora_inicio: nuevaFechaObj,
                ultimo_modificado_por: autor, fecha_modificacion: new Date(),
                utc_migrado: true
            };
            await setDoc(doc(db, "agenda_sesiones", targetSession.id), newTargetData, { merge: true });
            await deleteDoc(doc(db, "agenda_sesiones", sourceSession.id));

            redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: targetSession.id, data: newTargetData, merge: true });
            redoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: sourceSession.id });
        } else {
            const newSourceData = {
                fecha_hora_inicio: nuevaFechaObj, estado: "Pendiente",
                ultimo_modificado_por: autor, fecha_modificacion: new Date(),
                utc_migrado: true
            };
            await setDoc(doc(db, "agenda_sesiones", sourceSession.id), newSourceData, { merge: true });
            redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: newSourceData, merge: true });
        }

        cerrarModalReprogramar();
        if (typeof onSuccess === 'function') await onSuccess();

        if (undoHistory) {
            undoHistory.pushAction({
                label: `Reprogramar sesión (${sourceSession.fechaStr})`,
                undoOps,
                redoOps,
                showToast: true,
                toastMessage: `📅 Sesión reprogramada`
            });
        }
    } catch (err) {
        console.error(err);
        alert("Error al sustituir la rutina.");
    }
}

export async function ejecutarDesplazamiento() {
    if (!__reprogContext.pendingReprogData) return;
    const { sourceSession, targetSession, autor, nuevaFechaObj } = __reprogContext.pendingReprogData;
    const { allSessions, idCliente, nombreCliente, undoHistory, onSuccess } = __reprogContext;

    try {
        const batch = writeBatch(db);
        let prevExercises = sourceSession.ejercicios || [];
        let lastAffectedSession = null;
        const undoOps = [
            { type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: sourceSession.docData, merge: false }
        ];
        const redoOps = [];

        if (targetSession) {
            const futureAndTarget = allSessions
                .filter(s => s.fechaObj >= targetSession.fechaObj && s.id !== sourceSession.id)
                .sort((a, b) => a.fechaObj - b.fechaObj);

            for (let i = 0; i < futureAndTarget.length; i++) {
                const s = futureAndTarget[i];
                undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: s.id, data: s.docData, merge: false });
                const currentExercises = s.ejercicios || [];
                const sUpdate = {
                    ejercicios: prevExercises,
                    ultimo_modificado_por: autor,
                    fecha_modificacion: new Date(),
                    ...(s.id === targetSession.id ? { fecha_hora_inicio: nuevaFechaObj, utc_migrado: true } : {})
                };
                batch.update(doc(db, "agenda_sesiones", s.id), sUpdate);
                redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: s.id, data: sUpdate, merge: true });
                prevExercises = currentExercises;
                lastAffectedSession = s;
            }

            batch.delete(doc(db, "agenda_sesiones", sourceSession.id));
            redoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: sourceSession.id });
        } else {
            const futureSessions = allSessions
                .filter(s => s.fechaObj > nuevaFechaObj && s.id !== sourceSession.id)
                .sort((a, b) => a.fechaObj - b.fechaObj);

            const sourceUpdate = {
                fecha_hora_inicio: nuevaFechaObj,
                estado: "Pendiente",
                ejercicios: futureSessions.length > 0 ? [] : prevExercises,
                ultimo_modificado_por: autor,
                fecha_modificacion: new Date(),
                utc_migrado: true
            };
            batch.set(doc(db, "agenda_sesiones", sourceSession.id), sourceUpdate, { merge: true });
            redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: sourceUpdate, merge: true });

            for (let i = 0; i < futureSessions.length; i++) {
                const s = futureSessions[i];
                undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: s.id, data: s.docData, merge: false });
                const currentExercises = s.ejercicios || [];
                const sUpdate = {
                    ejercicios: prevExercises,
                    ultimo_modificado_por: autor,
                    fecha_modificacion: new Date()
                };
                batch.update(doc(db, "agenda_sesiones", s.id), sUpdate);
                redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: s.id, data: sUpdate, merge: true });
                prevExercises = currentExercises;
                lastAffectedSession = s;
            }
        }

        if (lastAffectedSession && prevExercises && prevExercises.length > 0) {
            const fechaUltima = (targetSession && lastAffectedSession.id === targetSession.id)
                ? nuevaFechaObj
                : lastAffectedSession.fechaObj;
            const nuevaFechaExtra = __obtenerSiguienteDiaHabilUTC(fechaUltima);

            const newDocId = `SES-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const codeCli = idCliente || sourceSession.docData?.id_cliente || sourceSession.docData?.ID_Cliente || '';
            const aliasCli = nombreCliente || sourceSession.docData?.alias || sourceSession.docData?.nombre_cliente || 'Sin nombre';

            const extraDocData = {
                id_sesion_global: newDocId,
                id_cliente: codeCli,
                alias: aliasCli,
                nombre_cliente: sourceSession.docData?.nombre_cliente || aliasCli,
                estado: "Pendiente",
                tipo_sesion: lastAffectedSession.tipo_sesion || "Individual",
                fecha_hora_inicio: nuevaFechaExtra,
                ejercicios: prevExercises,
                orden_customizado: true,
                creado_por: autor,
                programado_por: autor,
                ultimo_modificado_por: autor,
                fecha_creacion: new Date(),
                fecha_modificacion: new Date(),
                utc_migrado: true
            };

            batch.set(doc(db, "agenda_sesiones", newDocId), extraDocData);
            undoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: newDocId });
            redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: newDocId, data: extraDocData, merge: false });
        }

        await batch.commit();
        cerrarModalReprogramar();
        if (typeof onSuccess === 'function') await onSuccess();

        if (undoHistory) {
            undoHistory.pushAction({
                label: "Reprogramación en cascada (adelante)",
                undoOps,
                redoOps,
                showToast: true,
                toastMessage: "📅 Rutinas desplazadas hacia adelante"
            });
        }
    } catch (err) {
        console.error(err);
        alert("Error al desplazar las rutinas en cascada.");
    }
}

export async function ejecutarRecogidaCascada() {
    if (!__reprogContext.pendingReprogData) return;
    const { sourceSession, targetSession, sessionsToPull, autor, nuevaFechaObj } = __reprogContext.pendingReprogData;
    const { undoHistory, onSuccess } = __reprogContext;

    try {
        const batch = writeBatch(db);
        let anchorSessionId = sourceSession.id;
        const undoOps = [
            { type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: sourceSession.docData, merge: false }
        ];
        const redoOps = [];

        if (targetSession) {
            undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: targetSession.id, data: targetSession.docData, merge: false });
            anchorSessionId = targetSession.id;
            batch.delete(doc(db, "agenda_sesiones", sourceSession.id));
            redoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: sourceSession.id });
        }

        const anchorUpdate = {
            fecha_hora_inicio: nuevaFechaObj, estado: "Pendiente",
            ultimo_modificado_por: autor, fecha_modificacion: new Date(),
            utc_migrado: true,
            ejercicios: sessionsToPull.length > 0 ? (sessionsToPull[0].ejercicios || []) : []
        };
        batch.set(doc(db, "agenda_sesiones", anchorSessionId), anchorUpdate, { merge: true });
        redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: anchorSessionId, data: anchorUpdate, merge: true });

        for (let i = 0; i < sessionsToPull.length; i++) {
            const currentSess = sessionsToPull[i];
            undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: currentSess.id, data: currentSess.docData, merge: false });
            const nextSess = sessionsToPull[i + 1];

            const pullUpdate = {
                ejercicios: nextSess ? (nextSess.ejercicios || []) : [],
                ultimo_modificado_por: autor, fecha_modificacion: new Date()
            };
            batch.set(doc(db, "agenda_sesiones", currentSess.id), pullUpdate, { merge: true });
            redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: currentSess.id, data: pullUpdate, merge: true });
        }

        await batch.commit();
        cerrarModalReprogramar();
        if (typeof onSuccess === 'function') await onSuccess();

        if (undoHistory) {
            undoHistory.pushAction({
                label: "Reprogramación en cascada (atrás)",
                undoOps,
                redoOps,
                showToast: true,
                toastMessage: "📅 Rutinas recogidas en cascada"
            });
        }
    } catch (err) {
        console.error(err);
        alert("Error al recoger las rutinas en cascada.");
    }
}

export function cerrarMenuAccionesSesion() {
    const existing = document.getElementById('sessionActionMenuPopover');
    if (existing) existing.remove();
}

export function abrirMenuAccionesSesion(event, sesionData, {
    undoHistory = null,
    onAfterChange = null
} = {}) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    cerrarMenuAccionesSesion();

    const idReal = sesionData?.id || sesionData?.idSesion || sesionData?.sesionObj?.id || '';
    if (!sesionData || !idReal) return;

    const undoHistoryFinal = undoHistory || sesionData.undoHistory || null;
    const onAfterChangeFinal = onAfterChange || sesionData.onAfterChange || null;
    const baseObj = sesionData.sesionObj || sesionData;
    const sFmt = baseObj.fechaStr ? baseObj : formatearSesionAgenda(idReal, baseObj.docData || baseObj);
    const acciones = obtenerAccionesDisponiblesSesion(sFmt.docData || sFmt);
    const idCliente = sesionData.idCliente || sFmt.id_cliente || '';
    const nombreCliente = sesionData.nombreCliente || sesionData.nombre || sFmt.alias || sFmt.nombre_cliente || 'Cliente';
    const horaInicio = sFmt.horaStr ? sFmt.horaStr.split(' - ')[0] : '';
    const pillClass = acciones.estado === 'Completada' ? 'pill-completada' : acciones.estado === 'Vencida' ? 'pill-vencida' : 'pill-pendiente';

    const menu = document.createElement('div');
    menu.id = 'sessionActionMenuPopover';
    menu.className = 'session-action-menu';
    menu.addEventListener('click', (ev) => ev.stopPropagation());

    const fichaHref = idCliente ? `ficha_cliente.html?id=${encodeURIComponent(idCliente)}` : '#';
    const clientHeaderHtml = idCliente
        ? `<a href="${fichaHref}" title="Ir a la ficha de ${nombreCliente}">👤 ${nombreCliente}</a>`
        : `<span>👤 ${nombreCliente}</span>`;

    let itemsHtml = '';

    if (acciones.puedeProgramar) {
        const labelProg = acciones.ejercicios.length > 0 ? 'Ver / Editar programación' : 'Programar ejercicios';
        itemsHtml += `
            <button type="button" class="session-action-item" data-action="programar" title="${labelProg}">
                ${iconDumbbell}
                <span>${labelProg}</span>
            </button>
        `;
    } else if (acciones.ejercicios && acciones.ejercicios.length > 0) {
        itemsHtml += `
            <button type="button" class="session-action-item" data-action="programar" title="Ver programación de la sesión">
                ${iconDumbbell}
                <span>Ver programación</span>
            </button>
        `;
    }

    if (acciones.puedeReprogramar) {
        itemsHtml += `
            <button type="button" class="session-action-item" data-action="reprogramar" title="Reprogramar fecha/hora">
                ${iconCalendar}
                <span>Reprogramar fecha/hora</span>
            </button>
        `;
    }

    if (acciones.puedeEnviar) {
        itemsHtml += `
            <button type="button" class="session-action-item send" data-action="enviar" title="Enviar a otra sesión o crear plantilla">
                ${iconArrowRight}
                <span>Enviar a...</span>
            </button>
        `;
    }

    if (acciones.puedeEliminar) {
        itemsHtml += `
            <button type="button" class="session-action-item danger" data-action="eliminar" title="Borrar sesión">
                ${iconTrash}
                <span>Eliminar sesión</span>
            </button>
        `;
    }

    menu.innerHTML = `
        <div class="session-action-menu-header">
            <div class="session-action-menu-client">
                ${clientHeaderHtml}
                <span class="pill ${pillClass}" style="font-size:0.68rem; padding:2px 8px;">${acciones.estado}</span>
            </div>
            <div class="session-action-menu-meta">
                <span>📅 ${sFmt.fechaStr} · ${horaInicio}</span>
                <span>${acciones.ejercicios.length} ej.</span>
            </div>
        </div>
        <div class="session-action-menu-list">
            ${itemsHtml}
        </div>
    `;

    document.body.appendChild(menu);

    const triggerRect = event?.currentTarget?.getBoundingClientRect?.() || null;
    const menuRect = menu.getBoundingClientRect();
    let left = triggerRect ? triggerRect.left : (event?.clientX || 100);
    let top = triggerRect ? (triggerRect.bottom + 6) : ((event?.clientY || 100) + 6);

    if (left + menuRect.width > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - menuRect.width - 12);
    }
    if (top + menuRect.height > window.innerHeight - 12) {
        top = triggerRect ? Math.max(12, triggerRect.top - menuRect.height - 6) : Math.max(12, window.innerHeight - menuRect.height - 12);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.querySelector('[data-action="programar"]')?.addEventListener('click', () => {
        cerrarMenuAccionesSesion();
        window.location.href = `programar_sesion.html?id_sesion=${encodeURIComponent(sFmt.id)}`;
    });

    menu.querySelector('[data-action="reprogramar"]')?.addEventListener('click', async () => {
        cerrarMenuAccionesSesion();
        await abrirModalReprogramarSesion({
            idSesion: sFmt.id,
            idCliente,
            nombreCliente,
            undoHistory: undoHistoryFinal,
            onSuccess: onAfterChangeFinal
        });
    });

    menu.querySelector('[data-action="enviar"]')?.addEventListener('click', async () => {
        cerrarMenuAccionesSesion();
        await abrirModalEnviarSesion({
            ejercicios: acciones.ejercicios,
            tipoSesionDefecto: acciones.tipo_sesion,
            intensidadDefecto: sFmt.docData?.intensidad || sFmt.docData?.Intensidad || 'MED',
            undoHistory: undoHistoryFinal,
            onSuccess: onAfterChangeFinal
        });
    });

    menu.querySelector('[data-action="eliminar"]')?.addEventListener('click', async () => {
        cerrarMenuAccionesSesion();
        await eliminarSesionConDeshacer({
            idSesion: sFmt.id,
            sesionObj: sFmt,
            undoHistory: undoHistoryFinal,
            onSuccess: onAfterChangeFinal
        });
    });

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
    window.abrirModalReprogramarSesion = abrirModalReprogramarSesion;
    window.cerrarModalReprogramar = cerrarModalReprogramar;
    window.cambiarSemanaReprog = cambiarSemanaReprog;
    window.irSemanaHoyReprog = irSemanaHoyReprog;
    window.irSemanaOrigenReprog = irSemanaOrigenReprog;
    window.volverAlCalendarioReprog = volverAlCalendarioReprog;
    window.seleccionarHuecoReprogramar = seleccionarHuecoReprogramar;
    window.ejecutarSustitucion = ejecutarSustitucion;
    window.ejecutarDesplazamiento = ejecutarDesplazamiento;
    window.ejecutarRecogidaCascada = ejecutarRecogidaCascada;
    window.abrirMenuAccionesSesion = abrirMenuAccionesSesion;
    window.cerrarMenuAccionesSesion = cerrarMenuAccionesSesion;
    window.eliminarSesionConDeshacer = eliminarSesionConDeshacer;

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
            if (!e.target.closest('.session-action-menu') && !e.target.closest('[data-session-menu-trigger]')) {
                cerrarMenuAccionesSesion();
            }
        });
    }
}
