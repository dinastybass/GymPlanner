// utils.js - Funciones auxiliares, iconos SVG y utilidades de UI compartidas

/**
 * Normaliza un texto eliminando tildes/diacríticos y convirtiéndolo a minúsculas
 * para búsquedas y comparaciones insensibles a acentos.
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

