// utils.js - Funciones auxiliares, iconos SVG y utilidades de UI compartidas

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
