export function normalizarTextoBusqueda(val: any): string {
  if (!val) return '';
  return String(val)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function coincideBusqueda(texto: any, terminoBusqueda: any): boolean {
  const term = normalizarTextoBusqueda(terminoBusqueda);
  if (!term) return true;
  const target = normalizarTextoBusqueda(texto);
  return target.includes(term);
}

export const DEFAULT_INTENSIDADES_SESION = ['LOW', 'MED', 'HIGH'];

export function normalizarIntensidad(val: any): string {
  const raw = String(val ?? '').trim();
  if (!raw) return 'MED';
  const s = raw.toUpperCase();
  if (s === 'LOW' || s === 'BAJA' || s === '🟢 LOW (BAJA)' || s === 'LOW (BAJA)') return 'LOW';
  if (s === 'MED' || s === 'MEDIA' || s === '🟡 MED (MEDIA)' || s === 'MED (MEDIA)') return 'MED';
  if (s === 'HIGH' || s === 'ALTA' || s === '🔴 HIGH (ALTA)' || s === 'HIGH (ALTA)') return 'HIGH';
  return raw;
}

export function getIntensityBadgeClass(intensidadRaw: any): string {
  const val = normalizarIntensidad(intensidadRaw).toUpperCase();
  if (val === 'LOW' || val === 'BAJA' || val.startsWith('LOW ')) return 'int-low';
  if (val === 'MED' || val === 'MEDIA' || val.startsWith('MED ')) return 'int-med';
  if (val === 'HIGH' || val === 'ALTA' || val.startsWith('HIGH ')) return 'int-high';
  if (
    val.includes('MAX') ||
    val.includes('MÁX') ||
    val.includes('VERY') ||
    val.includes('MUY') ||
    val.includes('EXTREM') ||
    val.includes('PLUS') ||
    val.includes('+')
  ) {
    return 'int-max';
  }
  return 'int-custom';
}

export function formatIntensityOptionLabel(valRaw: string): string {
  const val = normalizarIntensidad(valRaw);
  const upper = val.toUpperCase();
  if (upper === 'LOW') return '🟢 LOW (Baja)';
  if (upper === 'MED') return '🟡 MED (Media)';
  if (upper === 'HIGH') return '🔴 HIGH (Alta)';
  // Si el usuario ya incluyó un emoji al principio, respetarlo tal cual
  if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(val)) {
    return val;
  }
  const cls = getIntensityBadgeClass(val);
  if (cls === 'int-max') return `🟣 ${val}`;
  return `🟠 ${val}`;
}

export function renderIntensityBadge(
  intensidadRaw: any,
  opts?: { prefix?: string; compact?: boolean }
): string {
  const val = normalizarIntensidad(intensidadRaw);
  const cls = getIntensityBadgeClass(val);
  const rawPrefix = opts?.prefix !== undefined ? opts.prefix : '⚡ ';
  const iconClean = rawPrefix.trim();
  const innerHtml = iconClean
    ? `<span class="ui-icon">${iconClean}</span><span>${val}</span>`
    : `<span>${val}</span>`;
  const styleExtra = opts?.compact ? 'style="font-size:0.68rem;padding:2px 7px;"' : '';
  return `<span class="intensity-badge ${cls}" ${styleExtra} title="Intensidad: ${val}">${innerHtml}</span>`;
}

export function esSesionCompletada(data: any): boolean {
  if (!data) return false;
  const est1 = String(data.estado || '').trim().toLowerCase();
  const est2 = String(data.estado_sesion || '').trim().toLowerCase();
  const asist = String(data.asistencia || '').trim().toLowerCase();
  return (
    est1 === 'completada' ||
    est2 === 'completada' ||
    asist === 'completada' ||
    asist === 'asistio' ||
    asist === 'asistió' ||
    data.completada === true
  );
}

export function esSesionCancelada(data: any): boolean {
  if (!data) return false;
  const est1 = String(data.estado || '').trim().toLowerCase();
  const est2 = String(data.estado_sesion || '').trim().toLowerCase();
  return est1 === 'cancelada' || est2 === 'cancelada';
}

export function parsearFechaFirestore(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  if (typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof val === 'object') {
    const secs =
      typeof val.seconds === 'number'
        ? val.seconds
        : typeof val._seconds === 'number'
        ? val._seconds
        : null;
    const nanos =
      typeof val.nanoseconds === 'number'
        ? val.nanoseconds
        : typeof val._nanoseconds === 'number'
        ? val._nanoseconds
        : 0;
    if (secs !== null) {
      const d = new Date(secs * 1000 + Math.floor(nanos / 1e6));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const MAPA_DIA_SEMANA_JS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6
};

export function getJsDayFromNombre(dia: string): number | undefined {
  return MAPA_DIA_SEMANA_JS[normalizarTextoBusqueda(dia)];
}

export function getWorkingDaysJsSet(diasSemana?: string[]): Set<number> {
  const lista =
    Array.isArray(diasSemana) && diasSemana.length > 0
      ? diasSemana
      : ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  const set = new Set<number>();
  lista.forEach(d => {
    const jsDay = getJsDayFromNombre(d);
    if (jsDay !== undefined) set.add(jsDay);
  });
  if (set.size === 0) {
    [1, 2, 3, 4, 5].forEach(n => set.add(n));
  }
  return set;
}

export function obtenerFechaOperativaEfectiva(
  diasSemana?: string[],
  nowInput: Date = new Date()
): { targetDate: Date; rolledOver: boolean } {
  const workingDays = getWorkingDaysJsSet(diasSemana);
  const target = new Date(
    nowInput.getFullYear(),
    nowInput.getMonth(),
    nowInput.getDate()
  );
  let rolledOver = false;

  // Viernes a partir de las 21:00 -> abrir ya la siguiente semana / próximo día laborable
  if (target.getDay() === 5 && nowInput.getHours() >= 21) {
    target.setDate(target.getDate() + 1);
    rolledOver = true;
  }

  // Saltar cualquier día no configurado en Maestros (Agenda -> Días de la semana)
  let guard = 0;
  while (!workingDays.has(target.getDay()) && guard < 14) {
    target.setDate(target.getDate() + 1);
    rolledOver = true;
    guard++;
  }

  return { targetDate: target, rolledOver };
}

/**
 * Devuelve el lunes (00:00:00 UTC) de la semana a la que pertenece una fecha (interpretada en UTC).
 */
export function obtenerLunesSemanaUTC(dateObj: Date): Date {
  const d = new Date(
    Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 0, 0, 0, 0)
  );
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * Determina a qué mes (year, month 0-11) pertenece una semana según la regla de mayoría:
 * Si una semana contiene más de la mitad de los días laborables (configurados en el maestro
 * "Días de la semana", por defecto lunes a viernes = 5 días) dentro de un mes, toda la semana
 * pertenece a ese mes.
 */
export function obtenerMesPropietarioSemanaUTC(
  dateInWeekUTC: Date,
  diasSemana?: string[]
): { year: number; month: number } {
  const monday = obtenerLunesSemanaUTC(dateInWeekUTC);
  const workingDays = getWorkingDaysJsSet(diasSemana);

  const counts = new Map<string, { year: number; month: number; count: number }>();

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    if (!workingDays.has(d.getUTCDay())) continue;

    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const key = `${y}-${m}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { year: y, month: m, count: 1 });
    }
  }

  let best: { year: number; month: number; count: number } = {
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth(),
    count: -1
  };

  counts.forEach(entry => {
    // Si tiene más días laborables (o en caso de empate par, prioriza el mes entrante)
    if (entry.count > best.count || (entry.count === best.count && (entry.year > best.year || (entry.year === best.year && entry.month > best.month)))) {
      best = entry;
    }
  });

  return { year: best.year, month: best.month };
}

/**
 * Devuelve todas las semanas completas que pertenecen operativamente a un mes (year, month 0-11)
 * según la regla de mayoría de días del maestro "Días de la semana".
 */
export function obtenerSemanasDelMesOperativo(
  year: number,
  month: number,
  diasSemana?: string[]
): { weekNum: number; mondayDate: Date }[] {
  const firstDayOfMonth = new Date(Date.UTC(year, month, 1));
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0));

  // Empezar desde el lunes de la semana del día 1 del mes
  const cursorMonday = obtenerLunesSemanaUTC(firstDayOfMonth);
  // Límite hasta el lunes de la semana posterior al último día del mes
  const limitMonday = obtenerLunesSemanaUTC(lastDayOfMonth);
  limitMonday.setUTCDate(limitMonday.getUTCDate() + 7);

  const weeks: { weekNum: number; mondayDate: Date }[] = [];
  let wNum = 1;

  while (cursorMonday <= limitMonday) {
    const owner = obtenerMesPropietarioSemanaUTC(cursorMonday, diasSemana);
    if (owner.year === year && owner.month === month) {
      weeks.push({
        weekNum: wNum++,
        mondayDate: new Date(cursorMonday)
      });
    }
    cursorMonday.setUTCDate(cursorMonday.getUTCDate() + 7);
  }

  return weeks;
}

/**
 * Devuelve la lista de ejercicios en el mismo orden visual en que se muestra en pantalla:
 * - Si `ordenCustomizado` es true, respeta exactamente el orden del array.
 * - Si `ordenCustomizado` es false/undefined, ordena por `ordenBloques` manteniendo el orden
 *   relativo de los ejercicios dentro de cada bloque.
 */
export function ordenarEjerciciosSesionVisualmente(
  ejerciciosRaw: any[],
  ordenBloques: string[],
  ordenCustomizado?: boolean
): any[] {
  if (!Array.isArray(ejerciciosRaw)) return [];
  const copia = [...ejerciciosRaw];
  if (ordenCustomizado || !Array.isArray(ordenBloques) || ordenBloques.length === 0) {
    return copia;
  }

  return copia
    .map((ej, idx) => ({ ej, idx }))
    .sort((a, b) => {
      const bA = a.ej?.Bloque || 'General';
      const bB = b.ej?.Bloque || 'General';
      const idxA = ordenBloques.indexOf(bA);
      const idxB = ordenBloques.indexOf(bB);
      if (idxA !== -1 && idxB !== -1) {
        return idxA !== idxB ? idxA - idxB : a.idx - b.idx;
      }
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      const cmp = bA.localeCompare(bB);
      return cmp !== 0 ? cmp : a.idx - b.idx;
    })
    .map(item => item.ej);
}



