import React, { useState, useEffect, useCallback } from 'react';
import { db, auth } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { getValoresMaestro } from '../services/maestrosService';
import { CustomDropdown } from '../components/CustomDropdown';
import { SendRoutineModal } from '../components/SendRoutineModal';
import { useUndo } from '../context/UndoContext';
import { FirestoreOp } from '../services/undoService';

interface AgendaViewProps {
  onNavigate: (tab: string, param?: string) => void;
}

const MES_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const MES_NAMES_REPROG = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

const MAPA_DIA_JS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6
};

const DIAS_SEMANA_MAPA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function normalizarTexto(texto: any): string {
  if (!texto) return '';
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function countClients(nameStr?: string): number {
  if (!nameStr) return 1;
  const str = nameStr.replace(/ y /gi, ',').replace(/ e /gi, ',');
  const count = str.split(',').filter(n => n.trim() !== '').length;
  return count > 0 ? count : 1;
}

function obtenerLunesUTC(dateObj: Date): Date {
  const d = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 0, 0, 0, 0));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function obtenerSiguienteDiaHabilUTC(fechaBase: Date): Date {
  const sig = new Date(fechaBase.getTime());
  sig.setUTCDate(sig.getUTCDate() + 1);
  while (sig.getUTCDay() === 0 || sig.getUTCDay() === 6) {
    sig.setUTCDate(sig.getUTCDate() + 1);
  }
  return sig;
}

function obtenerAccionesDisponiblesSesion(sesionRaw: any = {}) {
  const isSinFecha = Boolean(
    sesionRaw.sin_fecha ||
    sesionRaw.estado === 'Sin fecha' ||
    (!sesionRaw.fechaObj && !sesionRaw.fecha_hora_inicio)
  );

  const d: Date | null = isSinFecha
    ? null
    : sesionRaw.fechaObj instanceof Date
      ? sesionRaw.fechaObj
      : sesionRaw.fecha_hora_inicio?.toDate
        ? sesionRaw.fecha_hora_inicio.toDate()
        : new Date(sesionRaw.fecha_hora_inicio || Date.now());

  const now = new Date();
  const nowNominalUTC = new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds()
  ));

  let estado = 'Pendiente';
  if (isSinFecha) {
    estado = 'Sin fecha';
  } else if (sesionRaw.estado === 'Completada') {
    estado = 'Completada';
  } else if ((d && d < nowNominalUTC) || sesionRaw.estado === 'Vencida') {
    estado = 'Vencida';
  }

  const limiteReprogramar = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0));
  const tipoSesion = sesionRaw.tipo_sesion || sesionRaw.Tipo || 'Individual';
  const isSG = tipoSesion === 'Small Group' || tipoSesion === 'SG';
  const ejercicios = Array.isArray(sesionRaw.ejercicios) ? sesionRaw.ejercicios : [];

  const puedeProgramar = !isSG && (estado === 'Pendiente' || isSinFecha);
  const puedeReprogramar = !isSG && (isSinFecha || estado === 'Pendiente' || (estado === 'Vencida' && d && d >= limiteReprogramar));
  const puedeCancelarSinFecha = !isSG && !isSinFecha && estado !== 'Completada';
  const puedeEnviar = ejercicios.length > 0;
  const puedeEliminar = true;

  return {
    fechaObj: d,
    sin_fecha: isSinFecha,
    estado,
    isSG,
    tipo_sesion: isSG ? 'Small Group' : 'Individual',
    ejercicios,
    puedeProgramar,
    puedeReprogramar,
    puedeCancelarSinFecha,
    puedeEnviar,
    puedeEliminar
  };
}

function formatearSesionAgenda(id: string, data: any = {}) {
  const info = obtenerAccionesDisponiblesSesion(data);
  const d = info.fechaObj;
  const isSinFecha = info.sin_fecha;
  const dAnt = data.fecha_hora_anterior?.toDate ? data.fecha_hora_anterior.toDate() : null;

  return {
    id,
    sin_fecha: isSinFecha,
    fechaObj: d,
    fechaStr: isSinFecha || !d
      ? 'Sin fecha'
      : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }),
    diaStr: isSinFecha || !d
      ? (dAnt ? `Orig: ${dAnt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })}` : 'Sin fecha asignada')
      : d.toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'UTC' }).replace(/^\w/, c => c.toUpperCase()),
    horaStr: isSinFecha || !d
      ? (dAnt ? `Antes: ${dAnt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}` : 'Pendiente de ubicar')
      : `${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} - ${new Date(d.getTime() + 60 * 60000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`,
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

export const AgendaView: React.FC<AgendaViewProps> = ({ onNavigate }) => {
  const { pushAction, registerChangeListener } = useUndo();

  const [currentView, setCurrentView] = useState<'individuales' | 'sg'>('individuales');
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });

  // Master data
  const [diasSemana, setDiasSemana] = useState<string[]>(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
  const [timeSlots, setTimeSlots] = useState<string[]>([
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'
  ]);
  const [sgTimeSlotsRaw, setSgTimeSlotsRaw] = useState<string[]>(['Lunes 18:00', 'Martes 17:00']);
  const [ocupacionMaxima, setOcupacionMaxima] = useState<number>(6);

  // Clients & Sessions
  const [globalClientes, setGlobalClientes] = useState<{ id: string; alias: string; nombre: string }[]>([]);
  const [sesionesRaw, setSesionesRaw] = useState<Record<string, { id: string; docData: any; idCliente: string; nombreCliente: string }>>({});
  const [loading, setLoading] = useState(true);

  // Expanded weeks state
  const [expandedWeeks, setExpandedWeeks] = useState<Record<number, boolean>>({});

  // Floating session action menu
  const [activeMenu, setActiveMenu] = useState<{
    idSesion: string;
    idCliente: string;
    nombreCliente: string;
    sFmt: any;
    acciones: any;
    left: number;
    top: number;
  } | null>(null);

  // Choice modal ("Crear nueva sesión" vs "Asignar sesión existente")
  const [choiceModalOpen, setChoiceModalOpen] = useState(false);
  const [slotContext, setSlotContext] = useState<{
    modo: 'general' | 'slot';
    dateStrID: string;
    timeKey: string;
    tipoPlan: 'Individual' | 'Small Group';
  }>({ modo: 'general', dateStrID: '', timeKey: '', tipoPlan: 'Individual' });

  // Planificar Días Modal
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planStep, setPlanStep] = useState<1 | 2>(1);
  const [planTipo, setPlanTipo] = useState<'Individual' | 'Small Group'>('Individual');
  const [planClienteId, setPlanClienteId] = useState('');
  const [planSelectedDays, setPlanSelectedDays] = useState<number[]>([]);
  const [planMes, setPlanMes] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });
  const [planSelectedWeeks, setPlanSelectedWeeks] = useState<number[]>([1, 2, 3, 4, 5]);
  const [planHoraIni, setPlanHoraIni] = useState('17:00');
  const [planHoraFin, setPlanHoraFin] = useState('18:00');
  const [planHoraSG, setPlanHoraSG] = useState('');
  const [pendingCreationData, setPendingCreationData] = useState<any>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  // Asignar Sesión Existente Modal
  const [asigModalOpen, setAsigModalOpen] = useState(false);
  const [asigClienteId, setAsigClienteId] = useState('');
  const [asigFecha, setAsigFecha] = useState('');
  const [asigHora, setAsigHora] = useState('');
  const [asigMostrarConFecha, setAsigMostrarConFecha] = useState(false);
  const [asigSessionsLoaded, setAsigSessionsLoaded] = useState<any[]>([]);
  const [asigSelectedSessionId, setAsigSelectedSessionId] = useState<string | null>(null);
  const [asigLoadingSessions, setAsigLoadingSessions] = useState(false);
  const [conteoSinFechaMap, setConteoSinFechaMap] = useState<Record<string, number>>({});
  const [savingAsig, setSavingAsig] = useState(false);

  // Reprogramar Modal (Interactive Weekly Calendar)
  const [reprogModalOpen, setReprogModalOpen] = useState(false);
  const [reprogStep, setReprogStep] = useState<1 | 2>(1);
  const [reprogSourceSessionId, setReprogSourceSessionId] = useState<string | null>(null);
  const [reprogIdCliente, setReprogIdCliente] = useState<string>('');
  const [reprogNombreCliente, setReprogNombreCliente] = useState<string>('');
  const [reprogAllSessions, setReprogAllSessions] = useState<any[]>([]);
  const [reprogOriginMonday, setReprogOriginMonday] = useState<Date>(() => obtenerLunesUTC(new Date()));
  const [reprogCurrentMonday, setReprogCurrentMonday] = useState<Date>(() => obtenerLunesUTC(new Date()));
  const [reprogPendingData, setReprogPendingData] = useState<any>(null);

  // Send Routine Modal
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendEjercicios, setSendEjercicios] = useState<any[]>([]);
  const [sendTipoSesion, setSendTipoSesion] = useState<string>('Individual');
  const [sendIntensidad, setSendIntensidad] = useState<'LOW' | 'MED' | 'HIGH'>('MED');

  // Compute timeToRowMap and separatorRow
  const mananaSlots = timeSlots.filter(t => parseInt(t.split(':')[0], 10) < 14);
  const tardeSlots = timeSlots.filter(t => parseInt(t.split(':')[0], 10) >= 14);
  const timeToRowMap: Record<string, number> = {};
  let rCounter = 2;
  mananaSlots.forEach(t => { timeToRowMap[t] = rCounter++; });
  const separatorRow = rCounter++;
  tardeSlots.forEach(t => { timeToRowMap[t] = rCounter++; });

  // Compute weeks of currentMonthDate
  const getWeeksForMonth = useCallback((monthDate: Date) => {
    const firstDayOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
    const lastDayOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0));

    const startCalendar = new Date(firstDayOfMonth);
    startCalendar.setUTCDate(startCalendar.getUTCDate() - startCalendar.getUTCDay() + (startCalendar.getUTCDay() === 0 ? -6 : 1));

    const fridayOfStartWeek = new Date(startCalendar);
    fridayOfStartWeek.setUTCDate(fridayOfStartWeek.getUTCDate() + 4);
    if (fridayOfStartWeek < firstDayOfMonth) {
      startCalendar.setUTCDate(startCalendar.getUTCDate() + 7);
    }

    const weeks: { weekNum: number; mondayDate: Date; isCurrentWeek: boolean; title: string }[] = [];
    const tempMon = new Date(startCalendar);
    let w = 1;
    const nowReal = new Date();
    const hoyReal = new Date(Date.UTC(nowReal.getFullYear(), nowReal.getMonth(), nowReal.getDate(), 0, 0, 0, 0));

    while (tempMon <= lastDayOfMonth) {
      const mDate = new Date(tempMon);
      const weekEnd = new Date(tempMon);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const isCurrentWeek = hoyReal >= mDate && hoyReal < weekEnd;
      weeks.push({
        weekNum: w,
        mondayDate: mDate,
        isCurrentWeek,
        title: `Semana ${w}`
      });
      tempMon.setUTCDate(tempMon.getUTCDate() + 7);
      w++;
    }

    // Extra week (Semana 1 - Next Month)
    const mDateExtra = new Date(tempMon);
    const weekEndExtra = new Date(tempMon);
    weekEndExtra.setUTCDate(weekEndExtra.getUTCDate() + 7);
    const isCurrentWeekExtra = hoyReal >= mDateExtra && hoyReal < weekEndExtra;
    weeks.push({
      weekNum: w,
      mondayDate: mDateExtra,
      isCurrentWeek: isCurrentWeekExtra,
      title: `Semana 1 - ${MES_NAMES[mDateExtra.getUTCMonth()]}`
    });

    return weeks;
  }, []);

  const weeksList = getWeeksForMonth(currentMonthDate);

  // Initialize default expanded state when month changes
  useEffect(() => {
    const wList = getWeeksForMonth(currentMonthDate);
    const initialExpanded: Record<number, boolean> = {};
    const anyCurrent = wList.some(w => w.isCurrentWeek);
    wList.forEach((w, idx) => {
      initialExpanded[w.weekNum] = anyCurrent ? w.isCurrentWeek : idx === 0;
    });
    setExpandedWeeks(initialExpanded);
  }, [currentMonthDate, getWeeksForMonth]);

  const loadAgenda = useCallback(async () => {
    setLoading(true);
    try {
      const [diasDB, horasIndDB, horasSGDB, ocupacionDB] = await Promise.all([
        getValoresMaestro('Agenda', 'Días de la semana'),
        getValoresMaestro('Agenda', 'Horarios Sesiones Individuales'),
        getValoresMaestro('Agenda', 'Horarios Small Groups'),
        getValoresMaestro('Agenda', 'Ocupación máxima')
      ]);

      if (diasDB.length > 0) setDiasSemana(diasDB);
      if (horasIndDB.length > 0) setTimeSlots(horasIndDB);
      if (horasSGDB.length > 0) setSgTimeSlotsRaw(horasSGDB);
      if (ocupacionDB.length > 0) {
        const parsedOcup = parseInt(String(ocupacionDB[0]).trim(), 10);
        if (!isNaN(parsedOcup) && parsedOcup > 0) {
          setOcupacionMaxima(parsedOcup);
        }
      }

      const clientesMap: Record<string, string> = {};
      const cliArr: { id: string; alias: string; nombre: string }[] = [];
      const clientesSnap = await getDocs(collection(db, "clientes"));
      clientesSnap.forEach(d => {
        const c = d.data();
        const code = c.ID_Cliente || d.id;
        const alias = (c.Alias && c.Alias.trim() !== '') ? c.Alias : (c.Nombre_Cliente || code);
        clientesMap[code] = alias;
        clientesMap[d.id] = alias;
        cliArr.push({ id: code, alias, nombre: c.Nombre_Cliente || alias });
      });
      setGlobalClientes(cliArr);

      const wList = getWeeksForMonth(currentMonthDate);
      const startDate = new Date(wList[0].mondayDate);
      startDate.setUTCHours(0, 0, 0, 0);
      const lastMonday = wList[wList.length - 1].mondayDate;
      const endDate = new Date(lastMonday);
      endDate.setUTCDate(endDate.getUTCDate() + 6);
      endDate.setUTCHours(23, 59, 59, 999);

      const q = query(
        collection(db, "agenda_sesiones"),
        where("fecha_hora_inicio", ">=", startDate),
        where("fecha_hora_inicio", "<=", endDate)
      );
      const querySnapshot = await getDocs(q);

      const mapSes: Record<string, { id: string; docData: any; idCliente: string; nombreCliente: string }> = {};
      querySnapshot.forEach(docSnap => {
        const data = docSnap.data();
        let idCliente = data.id_cliente || data.ID_Cliente || '';
        const nombreMostrar = (idCliente && clientesMap[idCliente])
          ? clientesMap[idCliente]
          : (data.Alias || data.alias || data.Nombre_Cliente || data.nombre_cliente || 'Sin nombre');
        if (!idCliente) {
          const found = cliArr.find(
            gc => normalizarTexto(gc.alias) === normalizarTexto(nombreMostrar) ||
                  normalizarTexto(gc.nombre) === normalizarTexto(nombreMostrar)
          );
          if (found) idCliente = found.id;
        }
        mapSes[docSnap.id] = {
          id: docSnap.id,
          docData: data,
          idCliente,
          nombreCliente: nombreMostrar
        };
      });

      setSesionesRaw(mapSes);
    } catch (error) {
      console.error("Error cargando agenda:", error);
    } finally {
      setLoading(false);
    }
  }, [currentMonthDate, getWeeksForMonth]);

  useEffect(() => {
    loadAgenda();
  }, [loadAgenda]);

  useEffect(() => {
    const unregister = registerChangeListener(() => {
      loadAgenda();
    });
    return unregister;
  }, [registerChangeListener, loadAgenda]);

  // Close floating menu on click outside
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.session-action-menu') && !target.closest('[data-session-menu-trigger]')) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  // Build capacity & events for Individuales
  const aforoGlobalPorFila: Record<string, number> = {};
  const dayEventsMap: Record<string, {
    weekNum: number;
    col: number;
    row: number;
    clientes: { nombre: string; idSesion: string; isPending: boolean }[];
    dateStrID: string;
    position?: 'left' | 'right';
    isOverlapping?: boolean;
  }[]> = {};

  const startDateCalendar = new Date(weeksList[0].mondayDate);
  startDateCalendar.setUTCHours(0, 0, 0, 0);

  Object.values(sesionesRaw).forEach(info => {
    const data = info.docData;
    if (data.tipo_sesion === 'Small Group') return;
    if (!data.fecha_hora_inicio?.toDate) return;

    const fecha: Date = data.fecha_hora_inicio.toDate();
    const timeStr = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const dateStrID = fecha.toISOString().split('T')[0];

    const row1 = timeToRowMap[timeStr];
    if (row1) {
      const numClientes = countClients(data.alias || data.nombre_cliente);
      aforoGlobalPorFila[`${dateStrID}-${row1}`] = (aforoGlobalPorFila[`${dateStrID}-${row1}`] || 0) + numClientes;
      const row2 = row1 + 1;
      if (row2 !== separatorRow) {
        aforoGlobalPorFila[`${dateStrID}-${row2}`] = (aforoGlobalPorFila[`${dateStrID}-${row2}`] || 0) + numClientes;
      }
    }
  });

  Object.values(sesionesRaw).forEach(info => {
    const data = info.docData;
    if (data.tipo_sesion === 'Small Group') return;
    if (!data.fecha_hora_inicio?.toDate) return;

    const isPending = !data.ejercicios || data.ejercicios.length === 0;
    const fecha: Date = data.fecha_hora_inicio.toDate();
    const timeStr = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const diffDays = Math.floor(Math.abs(fecha.getTime() - startDateCalendar.getTime()) / (1000 * 60 * 60 * 24));
    const weekNum = Math.floor(diffDays / 7) + 1;
    const dayIndex = fecha.getUTCDay();

    if (dayIndex >= 1 && dayIndex <= diasSemana.length) {
      const col = dayIndex + 1;
      const row = timeToRowMap[timeStr];
      if (row) {
        const dayKey = `w${weekNum}-c${col}`;
        if (!dayEventsMap[dayKey]) dayEventsMap[dayKey] = [];

        const existingSlot = dayEventsMap[dayKey].find(e => e.row === row);
        if (existingSlot) {
          existingSlot.clientes.push({
            nombre: info.nombreCliente,
            idSesion: info.id,
            isPending
          });
        } else {
          dayEventsMap[dayKey].push({
            weekNum,
            col,
            row,
            clientes: [{ nombre: info.nombreCliente, idSesion: info.id, isPending }],
            dateStrID: fecha.toISOString().split('T')[0]
          });
        }
      }
    }
  });

  for (const dayKey in dayEventsMap) {
    const events = dayEventsMap[dayKey];
    events.sort((a, b) => a.row - b.row);
    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      evt.position = 'left';
      if (i > 0 && events[i - 1].row + 2 > evt.row) {
        evt.position = events[i - 1].position === 'left' ? 'right' : 'left';
        evt.isOverlapping = true;
        events[i - 1].isOverlapping = true;
      }
    }
  }

  // Build Small Groups map
  const sgSlotsMap: Record<string, {
    clientes: { idSesion: string; nombre: string }[];
    firstId: string;
    isPending: boolean;
  }> = {};

  Object.values(sesionesRaw).forEach(info => {
    const data = info.docData;
    if (data.tipo_sesion !== 'Small Group') return;
    if (!data.fecha_hora_inicio?.toDate) return;

    const fecha: Date = data.fecha_hora_inicio.toDate();
    const dateStrID = fecha.toISOString().split('T')[0];
    const timeStr = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const keyHora = timeStr.replace(':', '');
    const slotKey = `${dateStrID}-${keyHora}`;

    if (!sgSlotsMap[slotKey]) {
      sgSlotsMap[slotKey] = {
        clientes: [],
        firstId: info.id,
        isPending: !data.ejercicios || data.ejercicios.length === 0
      };
    } else if (data.ejercicios && data.ejercicios.length > 0) {
      sgSlotsMap[slotKey].isPending = false;
      sgSlotsMap[slotKey].firstId = info.id;
    }

    sgSlotsMap[slotKey].clientes.push({
      idSesion: info.id,
      nombre: info.nombreCliente
    });
  });

  // Floating Action Menu Handler
  const handleOpenSessionMenu = (e: React.MouseEvent, idSesion: string) => {
    e.preventDefault();
    e.stopPropagation();
    const info = sesionesRaw[idSesion];
    if (!info) return;

    const sFmt = formatearSesionAgenda(idSesion, info.docData);
    const acciones = obtenerAccionesDisponiblesSesion(info.docData);

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + 260 > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - 272);
    }
    if (top + 260 > window.innerHeight - 12) {
      top = Math.max(12, rect.top - 240);
    }

    setActiveMenu({
      idSesion,
      idCliente: info.idCliente,
      nombreCliente: info.nombreCliente,
      sFmt,
      acciones,
      left,
      top
    });
  };

  // Cancelar sin fecha with Undo
  const handleCancelarSinFecha = async (idSesion: string, sFmt: any) => {
    setActiveMenu(null);
    try {
      const backupData = sFmt.docData;
      const autor = localStorage.getItem('gym_user_name') || 'Usuario';
      const nombreCli = sFmt.alias || sFmt.nombre_cliente || 'Cliente';
      const fechaLabel = sFmt.sin_fecha ? 'sin fecha' : `${sFmt.fechaStr} (${sFmt.horaStr.split(' - ')[0]})`;

      const updateData = {
        sin_fecha: true,
        fecha_hora_inicio: null,
        fecha_hora_anterior: backupData.fecha_hora_inicio || backupData.fecha_hora_anterior || null,
        estado: 'Sin fecha',
        ultimo_modificado_por: autor,
        fecha_modificacion: new Date()
      };

      await setDoc(doc(db, "agenda_sesiones", idSesion), updateData, { merge: true });
      await loadAgenda();

      pushAction({
        label: `Cancelar sin fecha (${nombreCli} · ${fechaLabel})`,
        undoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesion, data: backupData, merge: false }],
        redoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesion, data: updateData, merge: true }],
        showToast: true,
        toastMessage: `📌 Sesión de ${nombreCli} pasada a "Sin fecha"`
      });
    } catch (err) {
      console.error("Error al cancelar sesión sin fecha:", err);
      alert("No se pudo cancelar la sesión sin fecha.");
    }
  };

  // Eliminar sesión with Undo
  const handleEliminarSesion = async (idSesion: string, sFmt: any) => {
    setActiveMenu(null);
    if (!window.confirm("¿Estás seguro de que quieres eliminar esta sesión de la agenda?")) return;

    try {
      const backupData = sFmt.docData;
      const fechaLabel = sFmt.sin_fecha ? 'sin fecha' : `${sFmt.fechaStr} (${sFmt.horaStr.split(' - ')[0]})`;

      await deleteDoc(doc(db, "agenda_sesiones", idSesion));
      await loadAgenda();

      pushAction({
        label: `Eliminar sesión ${fechaLabel}`,
        undoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesion, data: backupData, merge: false }],
        redoOps: [{ type: 'delete', collection: 'agenda_sesiones', id: idSesion }],
        showToast: true,
        toastMessage: `🗑️ Sesión ${fechaLabel} eliminada`
      });
    } catch (err) {
      console.error("Error al borrar sesión:", err);
      alert("No se pudo borrar la sesión.");
    }
  };

  // Open Interactive Weekly Reschedule Modal
  const handleOpenReprogramar = async (idSesion: string, idCliente: string, nombreCliente: string) => {
    setActiveMenu(null);
    try {
      let idCliFinal = idCliente;
      let nombreCliFinal = nombreCliente;

      if (!idCliFinal) {
        const snapSes = await getDoc(doc(db, "agenda_sesiones", idSesion));
        if (snapSes.exists()) {
          const dSes = snapSes.data();
          idCliFinal = dSes.id_cliente || dSes.ID_Cliente || '';
          nombreCliFinal = nombreCliFinal || dSes.alias || dSes.nombre_cliente || '';
        }
      }

      const listaSesiones: any[] = [];
      if (idCliFinal) {
        const q = query(collection(db, "agenda_sesiones"), where("id_cliente", "==", idCliFinal));
        const snap = await getDocs(q);
        snap.forEach(d => {
          listaSesiones.push(formatearSesionAgenda(d.id, d.data()));
        });
      }

      const s = listaSesiones.find(x => x.id === idSesion) ||
        (sesionesRaw[idSesion] ? formatearSesionAgenda(idSesion, sesionesRaw[idSesion].docData) : null);

      if (!s) {
        alert("No se encontró la sesión a reprogramar.");
        return;
      }

      const now = new Date();
      const hoyUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const refFechaLunes = (!s.sin_fecha && s.fechaObj) ? s.fechaObj : hoyUTC;
      const monday = obtenerLunesUTC(refFechaLunes);

      setReprogSourceSessionId(idSesion);
      setReprogIdCliente(idCliFinal);
      setReprogNombreCliente(nombreCliFinal || s.alias);
      setReprogAllSessions(listaSesiones);
      setReprogOriginMonday(new Date(monday));
      setReprogCurrentMonday(new Date(monday));
      setReprogPendingData(null);
      setReprogStep(1);
      setReprogModalOpen(true);
    } catch (err) {
      console.error("Error abriendo reprogramar:", err);
    }
  };

  const handleSeleccionarHuecoReprogramar = (fechaStr: string, horaStr: string) => {
    if (!reprogSourceSessionId) return;
    const [y, m, d] = fechaStr.split('-');
    const [h, min] = horaStr.split(':');
    const targetFechaStr = `${d}/${m}/${y}`;
    const nuevaFechaObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), 0));

    const sourceSession = reprogAllSessions.find(x => x.id === reprogSourceSessionId);
    if (!sourceSession) return;

    const sesionesDestino = reprogAllSessions.filter(
      s => !s.sin_fecha && s.fechaStr === targetFechaStr && s.id !== reprogSourceSessionId
    );
    if (sesionesDestino.some(s => s.estado === 'Completada')) {
      alert("Operación bloqueada: No puedes reprogramar una sesión en un día que ya tiene una sesión completada.");
      return;
    }

    const targetSession = sesionesDestino[0] || null;
    const sessionsToPull = reprogAllSessions
      .filter(s => !s.sin_fecha && s.fechaObj && s.fechaObj > nuevaFechaObj && s.id !== reprogSourceSessionId)
      .sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());
    const autor = localStorage.getItem('gym_user_name') || 'Usuario';

    const diaDestinoNombre = nuevaFechaObj
      .toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'UTC' })
      .replace(/^\w/, c => c.toUpperCase());

    setReprogPendingData({
      sourceSession,
      targetSession,
      sessionsToPull,
      autor,
      nuevaFechaObj,
      targetFechaStr,
      horaStr,
      diaDestinoNombre
    });
    setReprogStep(2);
  };

  const handleEjecutarSustitucion = async () => {
    if (!reprogPendingData) return;
    const { sourceSession, targetSession, autor, nuevaFechaObj } = reprogPendingData;
    try {
      const undoOps: FirestoreOp[] = [
        { type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: sourceSession.docData, merge: false }
      ];
      const redoOps: FirestoreOp[] = [];

      if (targetSession) {
        undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: targetSession.id, data: targetSession.docData, merge: false });
        const newTargetData = {
          ejercicios: sourceSession.ejercicios || [],
          fecha_hora_inicio: nuevaFechaObj,
          sin_fecha: false,
          estado: "Pendiente",
          ultimo_modificado_por: autor,
          fecha_modificacion: new Date(),
          utc_migrado: true
        };
        await setDoc(doc(db, "agenda_sesiones", targetSession.id), newTargetData, { merge: true });
        await deleteDoc(doc(db, "agenda_sesiones", sourceSession.id));

        redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: targetSession.id, data: newTargetData, merge: true });
        redoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: sourceSession.id });
      } else {
        const newSourceData = {
          fecha_hora_inicio: nuevaFechaObj,
          sin_fecha: false,
          estado: "Pendiente",
          ultimo_modificado_por: autor,
          fecha_modificacion: new Date(),
          utc_migrado: true
        };
        await setDoc(doc(db, "agenda_sesiones", sourceSession.id), newSourceData, { merge: true });
        redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: newSourceData, merge: true });
      }

      setReprogModalOpen(false);
      await loadAgenda();

      pushAction({
        label: sourceSession.sin_fecha ? `Asignar fecha a sesión` : `Reprogramar sesión (${sourceSession.fechaStr})`,
        undoOps,
        redoOps,
        showToast: true,
        toastMessage: sourceSession.sin_fecha ? `📅 Fecha asignada a la sesión` : `📅 Sesión reprogramada`
      });
    } catch (err) {
      console.error(err);
      alert("Error al sustituir la rutina.");
    }
  };

  const handleEjecutarDesplazamiento = async () => {
    if (!reprogPendingData) return;
    const { sourceSession, targetSession, autor, nuevaFechaObj } = reprogPendingData;
    try {
      const batch = writeBatch(db);
      let prevExercises = sourceSession.ejercicios || [];
      let lastAffectedSession: any = null;
      const undoOps: FirestoreOp[] = [
        { type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: sourceSession.docData, merge: false }
      ];
      const redoOps: FirestoreOp[] = [];

      if (targetSession) {
        const futureAndTarget = reprogAllSessions
          .filter(s => !s.sin_fecha && s.fechaObj && s.fechaObj >= targetSession.fechaObj && s.id !== sourceSession.id)
          .sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());

        for (let i = 0; i < futureAndTarget.length; i++) {
          const s = futureAndTarget[i];
          undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: s.id, data: s.docData, merge: false });
          const currentExercises = s.ejercicios || [];
          const sUpdate: any = {
            ejercicios: prevExercises,
            ultimo_modificado_por: autor,
            fecha_modificacion: new Date(),
            ...(s.id === targetSession.id ? { fecha_hora_inicio: nuevaFechaObj, sin_fecha: false, estado: "Pendiente", utc_migrado: true } : {})
          };
          batch.update(doc(db, "agenda_sesiones", s.id), sUpdate);
          redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: s.id, data: sUpdate, merge: true });
          prevExercises = currentExercises;
          lastAffectedSession = s;
        }

        batch.delete(doc(db, "agenda_sesiones", sourceSession.id));
        redoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: sourceSession.id });
      } else {
        const futureSessions = reprogAllSessions
          .filter(s => !s.sin_fecha && s.fechaObj && s.fechaObj > nuevaFechaObj && s.id !== sourceSession.id)
          .sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());

        const sourceUpdate = {
          fecha_hora_inicio: nuevaFechaObj,
          sin_fecha: false,
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
        const nuevaFechaExtra = obtenerSiguienteDiaHabilUTC(fechaUltima);

        const newDocId = `SES-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const codeCli = reprogIdCliente || sourceSession.docData?.id_cliente || sourceSession.docData?.ID_Cliente || '';
        const aliasCli = reprogNombreCliente || sourceSession.docData?.alias || sourceSession.docData?.nombre_cliente || 'Sin nombre';

        const extraDocData = {
          id_sesion_global: newDocId,
          id_cliente: codeCli,
          alias: aliasCli,
          nombre_cliente: sourceSession.docData?.nombre_cliente || aliasCli,
          estado: "Pendiente",
          sin_fecha: false,
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
      setReprogModalOpen(false);
      await loadAgenda();

      pushAction({
        label: "Reprogramación en cascada (adelante)",
        undoOps,
        redoOps,
        showToast: true,
        toastMessage: "📅 Rutinas desplazadas hacia adelante"
      });
    } catch (err) {
      console.error(err);
      alert("Error al desplazar las rutinas en cascada.");
    }
  };

  const handleEjecutarRecogidaCascada = async () => {
    if (!reprogPendingData) return;
    const { sourceSession, targetSession, sessionsToPull, autor, nuevaFechaObj } = reprogPendingData;
    try {
      const batch = writeBatch(db);
      let anchorSessionId = sourceSession.id;
      const undoOps: FirestoreOp[] = [
        { type: 'set', collection: 'agenda_sesiones', id: sourceSession.id, data: sourceSession.docData, merge: false }
      ];
      const redoOps: FirestoreOp[] = [];

      if (targetSession) {
        undoOps.push({ type: 'set', collection: 'agenda_sesiones', id: targetSession.id, data: targetSession.docData, merge: false });
        anchorSessionId = targetSession.id;
        batch.delete(doc(db, "agenda_sesiones", sourceSession.id));
        redoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: sourceSession.id });
      }

      const anchorUpdate = {
        fecha_hora_inicio: nuevaFechaObj,
        sin_fecha: false,
        estado: "Pendiente",
        ultimo_modificado_por: autor,
        fecha_modificacion: new Date(),
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
          ultimo_modificado_por: autor,
          fecha_modificacion: new Date()
        };
        batch.set(doc(db, "agenda_sesiones", currentSess.id), pullUpdate, { merge: true });
        redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: currentSess.id, data: pullUpdate, merge: true });
      }

      await batch.commit();
      setReprogModalOpen(false);
      await loadAgenda();

      pushAction({
        label: "Reprogramación en cascada (atrás)",
        undoOps,
        redoOps,
        showToast: true,
        toastMessage: "📅 Rutinas recogidas en cascada"
      });
    } catch (err) {
      console.error(err);
      alert("Error al recoger las rutinas en cascada.");
    }
  };

  // Choice modal & Slot double-click handlers
  const handleAbrirModalPlanificarGeneral = () => {
    setSlotContext({ modo: 'general', dateStrID: '', timeKey: '', tipoPlan: 'Individual' });
    setChoiceModalOpen(true);
  };

  const handlePrepararModalAgendarSlot = (dateStrID: string, timeKey: string, tipoPlan: 'Individual' | 'Small Group') => {
    setSlotContext({ modo: 'slot', dateStrID, timeKey, tipoPlan });
    setChoiceModalOpen(true);
  };

  const handleConfirmarCrearNuevaSesion = () => {
    setChoiceModalOpen(false);
    setPlanStep(1);
    setPendingCreationData(null);

    if (slotContext.modo === 'slot') {
      const [y, m, d] = slotContext.dateStrID.split('-');
      const dateObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)));
      setPlanMes(`${y}-${m}`);

      const dayOfWeek = dateObj.getUTCDay();
      setPlanSelectedDays([dayOfWeek]);

      const nthWeek = Math.ceil(dateObj.getUTCDate() / 7);
      setPlanSelectedWeeks([nthWeek]);

      setPlanTipo(slotContext.tipoPlan);
      if (slotContext.tipoPlan === 'Individual') {
        setPlanHoraIni(slotContext.timeKey);
        const [hh, mm] = slotContext.timeKey.split(':');
        setPlanHoraFin(`${String(parseInt(hh, 10) + 1).padStart(2, '0')}:${mm}`);
      } else {
        const nombreDiaClick = DIAS_SEMANA_MAPA[dayOfWeek];
        const targetValue = `${nombreDiaClick} ${slotContext.timeKey}`;
        const matched = sgTimeSlotsRaw.find(o => normalizarTexto(o) === normalizarTexto(targetValue));
        if (matched) setPlanHoraSG(matched);
      }
    } else {
      const today = new Date();
      setPlanMes(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
      setPlanSelectedDays([]);
      setPlanSelectedWeeks([1, 2, 3, 4, 5]);
      setPlanTipo('Individual');
      const defIni = timeSlots.includes('17:00') ? '17:00' : (timeSlots[0] || '08:00');
      setPlanHoraIni(defIni);
      const [hh, mm] = defIni.split(':');
      setPlanHoraFin(`${String(parseInt(hh, 10) + 1).padStart(2, '0')}:${mm}`);
      setPlanHoraSG('');
    }

    setPlanModalOpen(true);
  };

  const handleConfirmarAsignarSesionExistente = async () => {
    setChoiceModalOpen(false);
    setAsigClienteId('');
    setAsigMostrarConFecha(false);
    setAsigSessionsLoaded([]);
    setAsigSelectedSessionId(null);

    if (slotContext.dateStrID) {
      setAsigFecha(slotContext.dateStrID);
    } else {
      const now = new Date();
      setAsigFecha(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    }

    setAsigHora(slotContext.timeKey || timeSlots[0] || '08:00');

    // Pre-count sin_fecha per client
    try {
      const qSinFecha = query(collection(db, "agenda_sesiones"), where("sin_fecha", "==", true));
      const snapSinFecha = await getDocs(qSinFecha);
      const counts: Record<string, number> = {};
      snapSinFecha.forEach(d => {
        const data = d.data();
        const cId = data.id_cliente || data.ID_Cliente;
        if (cId) counts[cId] = (counts[cId] || 0) + 1;
      });
      setConteoSinFechaMap(counts);
    } catch (e) {
      console.warn("Error contando sesiones sin fecha:", e);
    }

    setAsigModalOpen(true);
  };

  // Load sessions for selected client in Asignar Sesión Existente modal
  useEffect(() => {
    if (!asigModalOpen || !asigClienteId) {
      setAsigSessionsLoaded([]);
      setAsigSelectedSessionId(null);
      return;
    }

    setAsigLoadingSessions(true);
    const q = query(collection(db, "agenda_sesiones"), where("id_cliente", "==", asigClienteId));
    getDocs(q)
      .then(snap => {
        const sessions: any[] = [];
        snap.forEach(d => {
          sessions.push(formatearSesionAgenda(d.id, d.data()));
        });
        sessions.sort((a, b) => {
          if (a.sin_fecha && !b.sin_fecha) return -1;
          if (!a.sin_fecha && b.sin_fecha) return 1;
          if (!a.fechaObj && !b.fechaObj) return 0;
          return (b.fechaObj?.getTime() || 0) - (a.fechaObj?.getTime() || 0);
        });
        setAsigSessionsLoaded(sessions);
        const sinFecha = sessions.filter(s => s.sin_fecha);
        if (sinFecha.length > 0) {
          setAsigSelectedSessionId(sinFecha[0].id);
        } else {
          setAsigSelectedSessionId(null);
        }
      })
      .finally(() => setAsigLoadingSessions(false));
  }, [asigClienteId, asigModalOpen]);

  const handleSubmitAsignarExistente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asigClienteId) {
      alert("Por favor, selecciona un cliente.");
      return;
    }
    if (!asigFecha || !asigHora) {
      alert("Por favor, indica la fecha y hora de destino.");
      return;
    }
    if (!asigSelectedSessionId) {
      alert("Por favor, selecciona una sesión de la lista para asignarla.");
      return;
    }

    const sesionElegida = asigSessionsLoaded.find(s => s.id === asigSelectedSessionId);
    if (!sesionElegida) return;

    const [y, m, d] = asigFecha.split('-');
    const [h, min] = asigHora.split(':');
    const nuevaFechaObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), 0));
    const autor = localStorage.getItem('gym_user_name') || 'Usuario';

    setSavingAsig(true);
    try {
      const undoOps: FirestoreOp[] = [
        { type: 'set', collection: 'agenda_sesiones', id: sesionElegida.id, data: sesionElegida.docData, merge: false }
      ];
      const updatedSourceData = {
        fecha_hora_inicio: nuevaFechaObj,
        sin_fecha: false,
        estado: "Pendiente",
        ultimo_modificado_por: autor,
        fecha_modificacion: new Date(),
        utc_migrado: true
      };

      await setDoc(doc(db, "agenda_sesiones", sesionElegida.id), updatedSourceData, { merge: true });
      const redoOps: FirestoreOp[] = [
        { type: 'set', collection: 'agenda_sesiones', id: sesionElegida.id, data: updatedSourceData, merge: true }
      ];

      setAsigModalOpen(false);
      await loadAgenda();

      pushAction({
        label: `Asignar sesión existente (${d}/${m}/${y} ${asigHora})`,
        undoOps,
        redoOps,
        showToast: true,
        toastMessage: `📌 Sesión asignada al ${d}/${m}/${y} a las ${asigHora}`
      });
    } catch (error) {
      console.error("Error asignando sesión existente:", error);
      alert("Hubo un error al asignar la sesión.");
    } finally {
      setSavingAsig(false);
    }
  };

  // Calculate dates for Planificar Días modal
  const calcularFechasGeneradas = useCallback((): Date[] => {
    if (!planMes) return [];
    const [yearStr, monthStr] = planMes.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1;
    const isSG = planTipo === 'Small Group';
    const fechas: Date[] = [];

    if (isSG) {
      if (!planHoraSG) return [];
      const diaTxt = planHoraSG.split(' ')[0];
      const diaNum = MAPA_DIA_JS[normalizarTexto(diaTxt)];
      if (diaNum === undefined) return [];

      const date = new Date(Date.UTC(year, month, 1));
      while (date.getUTCMonth() === month) {
        if (date.getUTCDay() === diaNum) {
          fechas.push(new Date(date));
        }
        date.setUTCDate(date.getUTCDate() + 1);
      }
    } else {
      if (planSelectedDays.length === 0) return [];
      const date = new Date(Date.UTC(year, month, 1));
      while (date.getUTCMonth() === month) {
        if (planSelectedDays.includes(date.getUTCDay())) {
          const nth = Math.ceil(date.getUTCDate() / 7);
          if (planSelectedWeeks.includes(nth)) {
            fechas.push(new Date(date));
          }
        }
        date.setUTCDate(date.getUTCDate() + 1);
      }
    }
    return fechas;
  }, [planMes, planTipo, planHoraSG, planSelectedDays, planSelectedWeeks]);

  const fechasPlanCalculadas = calcularFechasGeneradas();

  // Check overbooking in Planificar modal
  let hasOverbooking = false;
  if (planTipo === 'Individual') {
    fechasPlanCalculadas.forEach(f => {
      const dateStrID = f.toISOString().split('T')[0];
      const row1 = timeToRowMap[planHoraIni];
      if (row1) {
        if ((aforoGlobalPorFila[`${dateStrID}-${row1}`] || 0) >= ocupacionMaxima) hasOverbooking = true;
        const row2 = row1 + 1;
        if (row2 !== separatorRow && (aforoGlobalPorFila[`${dateStrID}-${row2}`] || 0) >= ocupacionMaxima) {
          hasOverbooking = true;
        }
      }
    });
  }

  const ejecutarGuardadoNormal = async (
    fechas: Date[],
    isSG: boolean,
    emailAutor: string,
    idCliente: string,
    nombreCli: string,
    horaIni: string
  ) => {
    const batch = writeBatch(db);
    const undoOps: FirestoreOp[] = [];
    const redoOps: FirestoreOp[] = [];

    for (let i = 0; i < fechas.length; i++) {
      const fechaGuardar = new Date(fechas[i]);
      const [h, m] = horaIni.split(':');
      fechaGuardar.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);

      const idDoc = `SES-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`;
      const dataToSave = {
        id_sesion_global: idDoc,
        id_cliente: idCliente,
        alias: nombreCli,
        nombre_cliente: nombreCli,
        estado: "Pendiente",
        tipo_sesion: isSG ? "Small Group" : "Individual",
        fecha_hora_inicio: fechaGuardar,
        ejercicios: [],
        creado_por: emailAutor,
        fecha_creacion: new Date(),
        utc_migrado: true
      };
      batch.set(doc(db, "agenda_sesiones", idDoc), dataToSave);
      undoOps.push({ type: 'delete', collection: 'agenda_sesiones', id: idDoc });
      redoOps.push({ type: 'set', collection: 'agenda_sesiones', id: idDoc, data: dataToSave, merge: false });
    }
    await batch.commit();

    const numCitas = fechas.length;
    const labelAccion = numCitas === 1
      ? `Agendar sesión de ${nombreCli} (${horaIni})`
      : `Planificar ${numCitas} sesiones de ${nombreCli}`;

    pushAction({
      label: labelAccion,
      undoOps,
      redoOps,
      showToast: true,
      toastMessage: `📅 ${labelAccion}`
    });
  };

  const handleSubmitPlanificar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fechasPlanCalculadas.length === 0) {
      alert("Debes seleccionar opciones que devuelvan al menos un día válido en el mes.");
      return;
    }
    if (!planClienteId) {
      alert("Por favor, selecciona un cliente.");
      return;
    }

    const isSG = planTipo === 'Small Group';
    const emailAutor = auth.currentUser?.email || localStorage.getItem('gym_user_name') || 'Usuario';
    const cliObj = globalClientes.find(c => c.id === planClienteId);
    const nombreCli = cliObj ? cliObj.alias : 'Cliente';
    const horaIni = isSG ? planHoraSG.split(' ')[1] : planHoraIni;

    setSavingPlan(true);

    // If inserting 1 single Individual day, check if client has future sessions to offer cascade
    if (fechasPlanCalculadas.length === 1 && !isSG) {
      const f = new Date(fechasPlanCalculadas[0]);
      const [h, m] = horaIni.split(':');
      f.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);

      try {
        const qFuture = query(
          collection(db, "agenda_sesiones"),
          where("id_cliente", "==", planClienteId),
          where("fecha_hora_inicio", ">", f)
        );
        const futureSnap = await getDocs(qFuture);
        const futureSessions: { id: string; fechaObj: Date; data: any }[] = [];
        futureSnap.forEach(d => {
          const data = d.data();
          if (data.tipo_sesion !== 'Small Group' && data.fecha_hora_inicio?.toDate) {
            futureSessions.push({ id: d.id, fechaObj: data.fecha_hora_inicio.toDate(), data });
          }
        });
        futureSessions.sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());

        if (futureSessions.length > 0) {
          setPendingCreationData({
            fechas: [f],
            isSG: false,
            emailAutor,
            idCliente: planClienteId,
            nombreCli,
            horaIni,
            futureSessions
          });
          setPlanStep(2);
          setSavingPlan(false);
          return;
        }
      } catch (err) {
        console.error("Error comprobando sesiones futuras:", err);
      }
    }

    try {
      await ejecutarGuardadoNormal(fechasPlanCalculadas, isSG, emailAutor, planClienteId, nombreCli, horaIni);
      setPlanModalOpen(false);
      await loadAgenda();
    } catch (error) {
      console.error(error);
      alert("Hubo un error al generar las citas.");
    } finally {
      setSavingPlan(false);
    }
  };

  const handleEjecutarCreacionIndependiente = async () => {
    if (!pendingCreationData) return;
    const { fechas, isSG, emailAutor, idCliente, nombreCli, horaIni } = pendingCreationData;
    try {
      await ejecutarGuardadoNormal(fechas, isSG, emailAutor, idCliente, nombreCli, horaIni);
      setPlanModalOpen(false);
      await loadAgenda();
    } catch (e) {
      console.error(e);
      alert("Error al guardar la sesión.");
    }
    setPendingCreationData(null);
  };

  const handleEjecutarCreacionCascada = async () => {
    if (!pendingCreationData) return;
    const { fechas, emailAutor, idCliente, nombreCli, horaIni, futureSessions } = pendingCreationData;
    try {
      const batch = writeBatch(db);
      const f = new Date(fechas[0]);
      const [h, m] = horaIni.split(':');
      f.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);

      const newDocId = `SES-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const newDocData = {
        id_sesion_global: newDocId,
        id_cliente: idCliente,
        alias: nombreCli,
        nombre_cliente: nombreCli,
        estado: "Pendiente",
        tipo_sesion: "Individual",
        fecha_hora_inicio: f,
        ejercicios: futureSessions.length > 0 ? (futureSessions[0].data.ejercicios || []) : [],
        creado_por: emailAutor,
        fecha_creacion: new Date(),
        utc_migrado: true
      };
      batch.set(doc(db, "agenda_sesiones", newDocId), newDocData);

      const undoOps: FirestoreOp[] = [{ type: 'delete', collection: 'agenda_sesiones', id: newDocId }];
      const redoOps: FirestoreOp[] = [{ type: 'set', collection: 'agenda_sesiones', id: newDocId, data: newDocData, merge: false }];

      for (let i = 0; i < futureSessions.length; i++) {
        const currentSess = futureSessions[i];
        const nextSess = futureSessions[i + 1];

        undoOps.push({
          type: 'set',
          collection: 'agenda_sesiones',
          id: currentSess.id,
          data: currentSess.data,
          merge: false
        });

        const updateObj = {
          ejercicios: nextSess ? (nextSess.data.ejercicios || []) : [],
          ultimo_modificado_por: emailAutor,
          fecha_modificacion: new Date()
        };
        batch.set(doc(db, "agenda_sesiones", currentSess.id), updateObj, { merge: true });
        redoOps.push({
          type: 'set',
          collection: 'agenda_sesiones',
          id: currentSess.id,
          data: updateObj,
          merge: true
        });
      }

      await batch.commit();
      setPlanModalOpen(false);
      await loadAgenda();

      pushAction({
        label: `Agendar en cascada (${nombreCli})`,
        undoOps,
        redoOps,
        showToast: true,
        toastMessage: `📅 Sesión creada de ${nombreCli} (rutinas adelantadas en cascada)`
      });
    } catch (e) {
      console.error(e);
      alert("Error al recoger las rutinas en cascada.");
    }
    setPendingCreationData(null);
  };

  // End times options for Planificar modal
  const horasFinOptions = Array.from(
    new Set([
      ...timeSlots,
      ...timeSlots.map(t => {
        const [h, m] = t.split(':');
        return `${String(parseInt(h, 10) + 1).padStart(2, '0')}:${m}`;
      })
    ])
  ).sort();

  const mesStrFormatted = currentMonthDate.toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

  // Render chevron SVG
  const renderChevron = (isExpanded: boolean) => (
    <span className="chevron-icon">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transition: 'transform 0.2s ease',
          transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'
        }}
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </span>
  );

  // Filter sessions in Asignar Existente modal
  const sinFechaListAsig = asigSessionsLoaded.filter(s => s.sin_fecha);
  const conFechaListAsig = asigSessionsLoaded.filter(s => !s.sin_fecha && s.estado !== 'Completada');
  const listToRenderAsig = asigMostrarConFecha ? [...sinFechaListAsig, ...conFechaListAsig] : sinFechaListAsig;

  return (
    <div className="container">
      <div className="page-header">
        <h1 id="page-title">Calendario de sesiones</h1>
      </div>

      {/* Filters and Top Actions */}
      <div className="filters">
        <button
          type="button"
          className={`filter-btn ${currentView === 'individuales' ? 'active' : 'inactive'}`}
          onClick={() => setCurrentView('individuales')}
        >
          Sesiones individuales
        </button>
        <button
          type="button"
          className={`filter-btn ${currentView === 'sg' ? 'active' : 'inactive'}`}
          onClick={() => setCurrentView('sg')}
        >
          Small Groups
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn-outline"
            onClick={() => onNavigate('pendientes')}
          >
            Programaciones pendientes
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleAbrirModalPlanificarGeneral}
          >
            + Planificar Días de Cliente
          </button>
        </div>
      </div>

      {/* Month Selector */}
      <div className="month-selector">
        <button
          type="button"
          className="nav-arrow"
          onClick={() => {
            const next = new Date(currentMonthDate);
            next.setUTCMonth(next.getUTCMonth() - 1);
            setCurrentMonthDate(next);
          }}
        >
          &lt;
        </button>
        <button type="button" className="calendar-icon-btn">
          📅 <span>{mesStrFormatted}</span>
        </button>
        <button
          type="button"
          className="nav-arrow"
          onClick={() => {
            const next = new Date(currentMonthDate);
            next.setUTCMonth(next.getUTCMonth() + 1);
            setCurrentMonthDate(next);
          }}
        >
          &gt;
        </button>
        <span className="month-title">{mesStrFormatted}</span>
      </div>

      {/* Calendar Container */}
      <div id="calendar-container">
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Cargando agenda...</p>
        ) : (
          weeksList.map(wInfo => {
            const isExpanded = Boolean(expandedWeeks[wInfo.weekNum]);
            const numDias = diasSemana.length;
            const endDay = new Date(wInfo.mondayDate);
            endDay.setUTCDate(endDay.getUTCDate() + (numDias - 1));
            const dateRangeText = `${wInfo.mondayDate.getUTCDate()}${MES_NAMES[wInfo.mondayDate.getUTCMonth()]} - ${endDay.getUTCDate()}${MES_NAMES[endDay.getUTCMonth()]}`;

            return (
              <div key={wInfo.weekNum} className="week-accordion">
                <div
                  className="week-header"
                  onClick={() =>
                    setExpandedWeeks(prev => ({
                      ...prev,
                      [wInfo.weekNum]: !prev[wInfo.weekNum]
                    }))
                  }
                >
                  <h3>
                    {renderChevron(isExpanded)} {wInfo.title}
                  </h3>
                  <span>{dateRangeText}</span>
                </div>

                {isExpanded && (
                  <div className="week-content">
                    {currentView === 'individuales' ? (
                      <div
                        className="calendar-grid"
                        style={{
                          gridTemplateColumns: `60px repeat(${numDias}, 1fr)`,
                          gridTemplateRows: `auto repeat(${mananaSlots.length}, 40px) 20px repeat(${tardeSlots.length}, 40px)`
                        }}
                      >
                        {/* Top-left Hora Header */}
                        <div
                          className="day-header"
                          style={{ gridColumn: 1, gridRow: 1, borderRight: '3px solid #64748b' }}
                        >
                          Hora
                        </div>

                        {/* Day Headers */}
                        {diasSemana.map((diaName, idx) => {
                          const dTemp = new Date(wInfo.mondayDate);
                          dTemp.setUTCDate(dTemp.getUTCDate() + idx);
                          return (
                            <div
                              key={diaName}
                              className="day-header"
                              style={{ gridColumn: idx + 2, gridRow: 1 }}
                            >
                              <strong>{diaName}</strong>
                              <span>
                                {dTemp.getUTCDate()}
                                {MES_NAMES[dTemp.getUTCMonth()]}
                              </span>
                            </div>
                          );
                        })}

                        {/* Time Labels and Background Cells */}
                        {timeSlots.map(time => {
                          const row = timeToRowMap[time];
                          return (
                            <React.Fragment key={time}>
                              <div
                                className="time-label"
                                style={{ gridColumn: 1, gridRow: row }}
                              >
                                {time}
                              </div>
                              {diasSemana.map((_, colIdx) => {
                                const col = colIdx + 2;
                                const dTemp = new Date(wInfo.mondayDate);
                                dTemp.setUTCDate(dTemp.getUTCDate() + colIdx);
                                const dateStrID = dTemp.toISOString().split('T')[0];

                                return (
                                  <div
                                    key={`${dateStrID}-${time}`}
                                    className="grid-bg-cell"
                                    style={{ gridColumn: col, gridRow: row }}
                                    onDoubleClick={() => handlePrepararModalAgendarSlot(dateStrID, time, 'Individual')}
                                    title="Doble clic para agendar cita rápida"
                                  />
                                );
                              })}
                            </React.Fragment>
                          );
                        })}

                        {/* Noon Separator */}
                        <div
                          className="noon-separator"
                          style={{ gridRow: separatorRow }}
                        />

                        {/* Event Cards for this week */}
                        {diasSemana.map((_, colIdx) => {
                          const col = colIdx + 2;
                          const dayKey = `w${wInfo.weekNum}-c${col}`;
                          const events = dayEventsMap[dayKey] || [];

                          return events.map((evt, eIdx) => {
                            const countH1 = aforoGlobalPorFila[`${evt.dateStrID}-${evt.row}`] || 0;
                            const countH2 = aforoGlobalPorFila[`${evt.dateStrID}-${evt.row + 1}`] || 0;

                            let extraClass = 'event-normal';
                            if (countH1 >= ocupacionMaxima && countH2 >= ocupacionMaxima) extraClass = 'event-full';
                            else if (countH1 >= ocupacionMaxima && countH2 < ocupacionMaxima) extraClass = 'event-warn-top';
                            else if (countH1 < ocupacionMaxima && countH2 >= ocupacionMaxima) extraClass = 'event-warn-bottom';

                            if (evt.isOverlapping) {
                              extraClass += evt.position === 'left' ? ' overlap-left' : ' overlap-right';
                            }

                            const timeKey = Object.keys(timeToRowMap).find(k => timeToRowMap[k] === evt.row) || '08:00';

                            return (
                              <div
                                key={`${dayKey}-${evt.row}-${eIdx}`}
                                className={`event-card ${extraClass}`}
                                style={{
                                  gridColumn: evt.col,
                                  gridRow: `${evt.row} / span 2`
                                }}
                                onDoubleClick={() => handlePrepararModalAgendarSlot(evt.dateStrID, timeKey, 'Individual')}
                                title="Doble clic para agendar otro cliente a esta hora"
                              >
                                {evt.clientes.map((c, cIdx) => (
                                  <React.Fragment key={c.idSesion}>
                                    {cIdx > 0 && ', '}
                                    <span
                                      data-session-menu-trigger="true"
                                      style={{
                                        color: c.isPending ? '#dc2626' : 'inherit',
                                        cursor: 'pointer',
                                        textDecoration: 'none',
                                        transition: 'opacity 0.2s'
                                      }}
                                      onClick={(e) => handleOpenSessionMenu(e, c.idSesion)}
                                      onMouseOver={(e) => {
                                        e.currentTarget.style.textDecoration = 'underline';
                                        e.currentTarget.style.opacity = '0.7';
                                      }}
                                      onMouseOut={(e) => {
                                        e.currentTarget.style.textDecoration = 'none';
                                        e.currentTarget.style.opacity = '1';
                                      }}
                                      title={c.isPending ? 'Pendiente de programar · Clic para opciones' : 'Clic para opciones de sesión y ficha'}
                                    >
                                      {c.nombre}
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                            );
                          });
                        })}
                      </div>
                    ) : (
                      /* Small Groups View */
                      <div
                        className="sg-week-grid"
                        style={{ gridTemplateColumns: `repeat(${numDias}, 1fr)` }}
                      >
                        {diasSemana.map((dayNameString, idx) => {
                          const dayTemp = new Date(wInfo.mondayDate);
                          dayTemp.setUTCDate(dayTemp.getUTCDate() + idx);
                          const dayNum = dayTemp.getUTCDate();
                          const monthName = MES_NAMES[dayTemp.getUTCMonth()];
                          const dateStrID = dayTemp.toISOString().split('T')[0];

                          const todaySlots = sgTimeSlotsRaw
                            .filter(t => t.toLowerCase().startsWith(dayNameString.toLowerCase()))
                            .map(t => t.split(' ')[1]);

                          return (
                            <div key={dateStrID} className="sg-day-column">
                              <div className="sg-day-header">
                                {dayNameString} <span>{dayNum}{monthName}</span>
                              </div>

                              {todaySlots.length === 0 ? (
                                <div className="sg-slot" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '15px' }}>
                                  Sin grupos
                                </div>
                              ) : (
                                todaySlots.map(t => {
                                  const [h, m] = t.split(':');
                                  const nextH = String(parseInt(h, 10) + 1).padStart(2, '0');
                                  const keyHora = t.replace(':', '');
                                  const slotKey = `${dateStrID}-${keyHora}`;
                                  const sgInfo = sgSlotsMap[slotKey];

                                  return (
                                    <div
                                      key={slotKey}
                                      className="sg-slot"
                                      onDoubleClick={() => handlePrepararModalAgendarSlot(dateStrID, t, 'Small Group')}
                                      title="Doble clic para agendar un cliente a este grupo"
                                    >
                                      <div className="sg-slot-time">
                                        {t}–{nextH}:{m}
                                      </div>
                                      <div className="sg-slot-clients">
                                        {sgInfo && sgInfo.clientes.length > 0 && (
                                          <>
                                            {sgInfo.clientes.map((c, cIdx) => (
                                              <React.Fragment key={c.idSesion}>
                                                {cIdx > 0 && <br />}
                                                <span
                                                  data-session-menu-trigger="true"
                                                  style={{ color: 'var(--text-main)', fontWeight: 500, cursor: 'pointer' }}
                                                  onClick={(e) => handleOpenSessionMenu(e, c.idSesion)}
                                                  onMouseOver={(e) => {
                                                    e.currentTarget.style.textDecoration = 'underline';
                                                    e.currentTarget.style.color = 'var(--accent)';
                                                  }}
                                                  onMouseOut={(e) => {
                                                    e.currentTarget.style.textDecoration = 'none';
                                                    e.currentTarget.style.color = 'var(--text-main)';
                                                  }}
                                                  title={`Clic para opciones y ficha de ${c.nombre}`}
                                                >
                                                  {c.nombre}
                                                </span>
                                              </React.Fragment>
                                            ))}
                                            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                                              <a
                                                href="#programar"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  onNavigate('programar_sesion', sgInfo.firstId);
                                                }}
                                                style={{
                                                  display: 'block',
                                                  textAlign: 'center',
                                                  fontSize: '0.75rem',
                                                  fontWeight: 'bold',
                                                  color: 'white',
                                                  background: sgInfo.isPending ? '#dc2626' : 'var(--accent-dark)',
                                                  padding: '4px 0',
                                                  borderRadius: 4,
                                                  textDecoration: 'none'
                                                }}
                                              >
                                                {sgInfo.isPending ? '📋 Programar SG' : '✅ Rutina SG'}
                                              </a>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* FLOATING SESSION ACTION MENU POPOVER */}
      {activeMenu && (
        <div
          className="session-action-menu"
          style={{ left: activeMenu.left, top: activeMenu.top }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="session-action-menu-header">
            <div className="session-action-menu-client">
              {activeMenu.idCliente ? (
                <a
                  href="#ficha"
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveMenu(null);
                    onNavigate('ficha_cliente', activeMenu.idCliente);
                  }}
                  title={`Ir a la ficha de ${activeMenu.nombreCliente}`}
                >
                  👤 {activeMenu.nombreCliente}
                </a>
              ) : (
                <span>👤 {activeMenu.nombreCliente}</span>
              )}
              <span
                className={`pill ${
                  activeMenu.acciones.estado === 'Completada'
                    ? 'pill-completada'
                    : activeMenu.acciones.estado === 'Vencida'
                      ? 'pill-vencida'
                      : activeMenu.acciones.estado === 'Sin fecha'
                        ? 'pill-sin-fecha'
                        : 'pill-pendiente'
                }`}
                style={{ fontSize: '0.68rem', padding: '2px 8px' }}
              >
                {activeMenu.acciones.estado}
              </span>
            </div>
            <div className="session-action-menu-meta">
              <span>
                {activeMenu.sFmt.sin_fecha
                  ? '📌 Sin fecha asignada'
                  : `📅 ${activeMenu.sFmt.fechaStr} · ${activeMenu.sFmt.horaStr.split(' - ')[0]}`}
              </span>
              <span>{activeMenu.acciones.ejercicios.length} ej.</span>
            </div>
          </div>

          <div className="session-action-menu-list">
            {(activeMenu.acciones.puedeProgramar || activeMenu.acciones.ejercicios.length > 0) && (
              <button
                type="button"
                className="session-action-item"
                onClick={() => {
                  const id = activeMenu.idSesion;
                  setActiveMenu(null);
                  onNavigate('programar_sesion', id);
                }}
              >
                <span>🏋️</span>
                <span>
                  {activeMenu.acciones.puedeProgramar
                    ? activeMenu.acciones.ejercicios.length > 0
                      ? 'Ver / Editar programación'
                      : 'Programar ejercicios'
                    : 'Ver programación'}
                </span>
              </button>
            )}

            {activeMenu.acciones.puedeReprogramar && (
              <button
                type="button"
                className="session-action-item"
                onClick={() =>
                  handleOpenReprogramar(activeMenu.idSesion, activeMenu.idCliente, activeMenu.nombreCliente)
                }
              >
                <span>📅</span>
                <span>
                  {activeMenu.acciones.sin_fecha ? 'Asignar fecha/hora' : 'Reprogramar fecha/hora'}
                </span>
              </button>
            )}

            {activeMenu.acciones.puedeCancelarSinFecha && (
              <button
                type="button"
                className="session-action-item warn"
                onClick={() => handleCancelarSinFecha(activeMenu.idSesion, activeMenu.sFmt)}
              >
                <span>📌</span>
                <span>Cancelar sin fecha</span>
              </button>
            )}

            {activeMenu.acciones.puedeEnviar && (
              <button
                type="button"
                className="session-action-item send"
                onClick={() => {
                  setSendEjercicios(activeMenu.acciones.ejercicios);
                  setSendTipoSesion(activeMenu.acciones.tipo_sesion);
                  setSendIntensidad(
                    activeMenu.sFmt.docData?.intensidad || activeMenu.sFmt.docData?.Intensidad || 'MED'
                  );
                  setActiveMenu(null);
                  setSendModalOpen(true);
                }}
              >
                <span>➡️</span>
                <span>Enviar a...</span>
              </button>
            )}

            {activeMenu.acciones.puedeEliminar && (
              <button
                type="button"
                className="session-action-item danger"
                onClick={() => handleEliminarSesion(activeMenu.idSesion, activeMenu.sFmt)}
              >
                <span>🗑️</span>
                <span>Eliminar sesión</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* MODAL SELECTOR: CREAR NUEVA SESIÓN O ASIGNAR SESIÓN EXISTENTE */}
      {choiceModalOpen && (
        <div
          className="modal-overlay"
          style={{ display: 'flex', zIndex: 2100 }}
          onClick={() => setChoiceModalOpen(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--primary)' }}>
                  📅 Generar / Ubicación de Sesión
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {slotContext.modo === 'slot'
                    ? (() => {
                        const [y, m, d] = slotContext.dateStrID.split('-');
                        return `Hueco seleccionado: ${d}/${m}/${y} a las ${slotContext.timeKey} (${slotContext.tipoPlan})`;
                      })()
                    : '¿Deseas crear una nueva planificación o asignar una sesión existente a una fecha?'}
                </p>
              </div>
              <button type="button" className="btn-close" onClick={() => setChoiceModalOpen(false)}>
                ×
              </button>
            </div>

            <div style={{ paddingTop: 6 }}>
              <button
                type="button"
                className="choice-action-card"
                onClick={handleConfirmarCrearNuevaSesion}
              >
                <div
                  className="choice-icon"
                  style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}
                >
                  ➕
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--primary)', marginBottom: 3 }}>
                    Crear nueva sesión
                  </div>
                  <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Abre el planificador habitual para generar nuevas citas individuales o de Small Group.
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="choice-action-card"
                onClick={handleConfirmarAsignarSesionExistente}
              >
                <div
                  className="choice-icon"
                  style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}
                >
                  📌
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--primary)', marginBottom: 3 }}>
                    Asignar sesión existente
                  </div>
                  <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Selecciona un cliente y asigna una de sus sesiones programadas sin fecha (o pendientes) a este hueco.
                  </div>
                </div>
              </button>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setChoiceModalOpen(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PLANIFICAR DÍAS MASIVOS / PUNTUAL */}
      {planModalOpen && (
        <div
          className="modal-overlay"
          style={{ display: 'flex' }}
          onClick={() => setPlanModalOpen(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPlanModalOpen(false)}>
              &times;
            </button>

            {planStep === 1 ? (
              <div>
                <div style={{ marginBottom: 25 }}>
                  <h2 style={{ margin: '0 0 5px 0', fontSize: '1.4rem' }}>
                    Planificar Días del Mes para Cliente
                  </h2>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Programa las asistencias de forma masiva o puntual en el calendario.
                  </p>
                </div>

                <form onSubmit={handleSubmitPlanificar}>
                  <div
                    className="form-group full"
                    style={{
                      flexDirection: 'row',
                      gap: 20,
                      marginBottom: 15,
                      padding: 15,
                      background: 'var(--hover-bg)',
                      borderRadius: 8,
                      border: '1px solid var(--border)'
                    }}
                  >
                    <label className="radio-option">
                      <input
                        type="radio"
                        name="plan_tipo"
                        value="Individual"
                        checked={planTipo === 'Individual'}
                        onChange={() => setPlanTipo('Individual')}
                      />
                      Sesión Individual
                    </label>
                    <label className="radio-option">
                      <input
                        type="radio"
                        name="plan_tipo"
                        value="Small Group"
                        checked={planTipo === 'Small Group'}
                        onChange={() => setPlanTipo('Small Group')}
                      />
                      Small Group
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label>Cliente *</label>
                      <CustomDropdown
                        options={[...globalClientes]
                          .sort((a, b) => a.alias.localeCompare(b.alias))
                          .map(c => ({
                            value: c.id,
                            label: c.alias,
                            search: `${c.alias} ${c.nombre || ''}`
                          }))}
                        value={planClienteId}
                        onChange={setPlanClienteId}
                        placeholder="Elige un cliente..."
                        searchPlaceholder="Buscar cliente por nombre o alias..."
                      />
                    </div>

                    {planTipo === 'Individual' && (
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Días de asistencia (puedes elegir varios) *</span>
                          <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>
                            {fechasPlanCalculadas.length === 1
                              ? '1 día'
                              : `${fechasPlanCalculadas.length} días`}
                          </span>
                        </label>
                        <div className="days-selector">
                          {diasSemana.map(d => {
                            const numDia = MAPA_DIA_JS[normalizarTexto(d)] ?? 1;
                            const isSelected = planSelectedDays.includes(numDia);
                            return (
                              <div
                                key={d}
                                className={`day-pill ${isSelected ? 'active' : ''}`}
                                onClick={() => {
                                  if (isSelected) {
                                    setPlanSelectedDays(planSelectedDays.filter(x => x !== numDia));
                                  } else {
                                    setPlanSelectedDays([...planSelectedDays, numDia]);
                                  }
                                }}
                              >
                                {d}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="form-group">
                      <label>Mes a programar</label>
                      <input
                        type="month"
                        required
                        value={planMes}
                        onChange={(e) => setPlanMes(e.target.value)}
                      />
                    </div>

                    {planTipo === 'Individual' && (
                      <>
                        <div className="form-group">
                          <label>Semanas a programar</label>
                          <div className="days-selector">
                            {[1, 2, 3, 4, 5].map(wNum => {
                              const active = planSelectedWeeks.includes(wNum);
                              return (
                                <div
                                  key={wNum}
                                  className={`week-pill ${active ? 'active' : ''}`}
                                  onClick={() => {
                                    if (active) {
                                      setPlanSelectedWeeks(planSelectedWeeks.filter(x => x !== wNum));
                                    } else {
                                      setPlanSelectedWeeks([...planSelectedWeeks, wNum]);
                                    }
                                  }}
                                >
                                  S{wNum}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="form-group">
                          <label>Hora de inicio</label>
                          <select
                            required
                            value={planHoraIni}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPlanHoraIni(val);
                              const [hh, mm] = val.split(':');
                              const nextTime = `${String(parseInt(hh, 10) + 1).padStart(2, '0')}:${mm}`;
                              if (horasFinOptions.includes(nextTime)) {
                                setPlanHoraFin(nextTime);
                              }
                            }}
                          >
                            {timeSlots.map(t => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Hora de fin</label>
                          <select
                            required
                            value={planHoraFin}
                            onChange={(e) => setPlanHoraFin(e.target.value)}
                          >
                            {horasFinOptions.map(t => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}

                    {planTipo === 'Small Group' && (
                      <div className="form-group full">
                        <label>Día y Horario del Small Group *</label>
                        <select
                          className="form-control"
                          required
                          value={planHoraSG}
                          onChange={(e) => setPlanHoraSG(e.target.value)}
                        >
                          <option value="">Selecciona horario y día predefinido...</option>
                          {sgTimeSlotsRaw.map(entry => (
                            <option key={entry} value={entry}>
                              {entry}
                            </option>
                          ))}
                        </select>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 5 }}>
                          Se programarán automáticamente todas las sesiones de este día de la semana en el mes seleccionado.
                        </p>
                      </div>
                    )}

                    {hasOverbooking && (
                      <div className="warning-msg" style={{ display: 'flex' }}>
                        <span>⚠️ Atención: Hay un conflicto de overbooking ({ocupacionMaxima} o más clientes).</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 30 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPlanModalOpen(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={savingPlan}
                    >
                      {savingPlan ? 'Guardando...' : `Programar ${fechasPlanCalculadas.length} Citas`}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* Step 2: Cascade Options on Injection */
              <div className="conflict-options">
                <div
                  style={{
                    background: '#f0fdfa',
                    border: '1px solid #14b8a6',
                    padding: 15,
                    borderRadius: 8,
                    marginBottom: 20
                  }}
                >
                  <h4 style={{ color: '#0f766e', margin: '0 0 5px 0' }}>
                    Opciones de Planificación (Inyección)
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#115e59' }}>
                    Has creado una sesión en un hueco y el cliente tiene futuras planificaciones. ¿Qué deseas hacer?
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  style={{
                    width: '100%',
                    marginBottom: 10,
                    textAlign: 'left',
                    padding: 12,
                    background: '#0f172a',
                    display: 'block'
                  }}
                  onClick={handleEjecutarCreacionIndependiente}
                >
                  <strong>Crear como sesión independiente</strong>
                  <br />
                  <span style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>
                    Se creará la sesión vacía y las rutinas futuras quedarán intactas.
                  </span>
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  style={{
                    width: '100%',
                    marginBottom: 10,
                    textAlign: 'left',
                    padding: 12,
                    background: '#16a34a',
                    display: 'block'
                  }}
                  onClick={handleEjecutarCreacionCascada}
                >
                  <strong>Recoger en cascada las planificaciones posteriores</strong>
                  <br />
                  <span style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>
                    Esta sesión recogerá la rutina de la siguiente sesión futura, adelantando toda su progresión. La última quedará libre.
                  </span>
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', textAlign: 'center', padding: 12 }}
                  onClick={() => {
                    setPlanStep(1);
                    setPendingCreationData(null);
                  }}
                >
                  Cancelar y Volver
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL ASIGNAR SESIÓN EXISTENTE (SIN FECHA O PENDIENTE) */}
      {asigModalOpen && (
        <div
          className="modal-overlay"
          style={{ display: 'flex', zIndex: 2250 }}
          onClick={() => setAsigModalOpen(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 680 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--primary)' }}>
                  📌 Asignar Sesión Existente
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  Selecciona un cliente y elige una de sus sesiones sin fecha (o pendientes) para asignarla al hueco seleccionado.
                </p>
              </div>
              <button type="button" className="btn-close" onClick={() => setAsigModalOpen(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleSubmitAsignarExistente}>
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <div className="form-group full">
                  <label>1. Cliente</label>
                  <CustomDropdown
                    options={[...globalClientes]
                      .map(c => {
                        const count = conteoSinFechaMap[c.id] || 0;
                        return {
                          value: c.id,
                          label: count > 0 ? `📌 ${c.alias} (${count} sin fecha)` : c.alias,
                          search: `${c.alias} ${c.nombre || ''}`,
                          _count: count,
                          _raw: c.alias
                        };
                      })
                      .sort((a, b) => {
                        if (b._count !== a._count) return b._count - a._count;
                        return a._raw.localeCompare(b._raw, 'es', { sensitivity: 'base' });
                      })}
                    value={asigClienteId}
                    onChange={setAsigClienteId}
                    placeholder="-- Selecciona un cliente --"
                    searchPlaceholder="🔍 Buscar cliente..."
                  />
                </div>

                <div className="form-group">
                  <label>2. Fecha Destino *</label>
                  <input
                    type="date"
                    required
                    value={asigFecha}
                    onChange={(e) => setAsigFecha(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>3. Hora Destino *</label>
                  <select
                    required
                    value={asigHora}
                    onChange={(e) => setAsigHora(e.target.value)}
                  >
                    {timeSlots.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                  gap: 10,
                  flexWrap: 'wrap'
                }}
              >
                <label
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    color: '#475569',
                    textTransform: 'uppercase',
                    margin: 0
                  }}
                >
                  4. Elige la sesión a asignar *
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.8rem',
                    color: '#475569',
                    cursor: 'pointer',
                    fontWeight: 600,
                    margin: 0
                  }}
                >
                  <input
                    type="checkbox"
                    checked={asigMostrarConFecha}
                    onChange={(e) => setAsigMostrarConFecha(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  Mostrar también sesiones que ya tienen fecha
                </label>
              </div>

              <div
                style={{
                  maxHeight: 300,
                  overflowY: 'auto',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  padding: 10,
                  background: '#f8fafc',
                  marginBottom: 16
                }}
              >
                {!asigClienteId ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                    Selecciona primero un cliente para ver sus sesiones disponibles.
                  </div>
                ) : asigLoadingSessions ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                    ⏳ Buscando sesiones del cliente...
                  </div>
                ) : listToRenderAsig.length === 0 ? (
                  sinFechaListAsig.length === 0 && conFechaListAsig.length > 0 && !asigMostrarConFecha ? (
                    <div style={{ padding: 18, textAlign: 'center', color: '#64748b', fontSize: '0.88rem' }}>
                      Este cliente no tiene sesiones programadas sin fecha.
                      <br />
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ marginTop: 8, padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={() => setAsigMostrarConFecha(true)}
                      >
                        Ver sus {conFechaListAsig.length} sesiones con fecha ({conFechaListAsig.length})
                      </button>
                    </div>
                  ) : (
                    <div style={{ padding: 18, textAlign: 'center', color: '#ef4444', fontSize: '0.88rem', fontWeight: 600 }}>
                      Este cliente no tiene sesiones disponibles para asignar.
                    </div>
                  )
                ) : (
                  listToRenderAsig.map(s => {
                    const isSelected = s.id === asigSelectedSessionId;
                    const numEj = s.ejercicios ? s.ejercicios.length : 0;
                    const intensidad = s.docData?.intensidad || s.docData?.Intensidad || '';
                    const nombresEj = (s.ejercicios || [])
                      .slice(0, 4)
                      .map((e: any) => e.Nombre_Ejercicio || e.nombre || e.Ejercicio || 'Ejercicio')
                      .join(', ');
                    const extraEj = numEj > 4 ? ` (+${numEj - 4} más)` : '';
                    const resumenEj = numEj > 0 ? `${nombresEj}${extraEj}` : 'Sesión sin ejercicios programados aún';

                    return (
                      <div
                        key={s.id}
                        className={`asig-session-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setAsigSelectedSessionId(s.id)}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            marginBottom: 4
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {s.sin_fecha ? (
                              <span className="pill pill-sin-fecha" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                                📌 Sin fecha
                              </span>
                            ) : (
                              <span
                                className={`pill ${s.estado === 'Vencida' ? 'pill-vencida' : 'pill-pendiente'}`}
                                style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                              >
                                📅 {s.diaStr} {s.fechaStr} · {s.horaStr.split(' - ')[0]}
                              </span>
                            )}
                            <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.85rem' }}>
                              {numEj} ejercicio{numEj === 1 ? '' : 's'}
                            </span>
                            {intensidad && (
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  color: '#475569',
                                  background: '#e2e8f0',
                                  padding: '1px 6px',
                                  borderRadius: 4
                                }}
                              >
                                Int: {intensidad}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                            {s.tipo_sesion || 'Individual'}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '0.8rem',
                            color: '#475569',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          🏋️ {resumenEj}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAsigModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingAsig}
                  style={{ background: 'var(--accent)' }}
                >
                  {savingAsig ? '⏳ Asignando...' : '📌 Asignar Sesión al Hueco'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL REPROGRAMAR SESIÓN (INTERACTIVE WEEKLY CALENDAR) */}
      {reprogModalOpen && (
        <div
          className="modal-overlay"
          style={{ display: 'flex' }}
          onClick={() => setReprogModalOpen(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 940, width: '95%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setReprogModalOpen(false)}
            >
              &times;
            </button>
            <h2 style={{ margin: '0 0 6px 0' }}>Reprogramar Sesión</h2>

            {reprogStep === 1 ? (
              <div>
                {(() => {
                  const s = reprogAllSessions.find(x => x.id === reprogSourceSessionId);
                  const numEj = s?.ejercicios?.length || 0;
                  const horaOrigen = s?.horaStr ? s.horaStr.split(' - ')[0] : '--:--';
                  return (
                    <div
                      style={{
                        background: '#fffbeb',
                        border: '1px solid #fcd34d',
                        color: '#92400e',
                        padding: '10px 14px',
                        borderRadius: 8,
                        fontSize: '0.88rem',
                        marginBottom: 12
                      }}
                    >
                      {s?.sin_fecha ? (
                        <>
                          📌 <strong>Sesión sin fecha a ubicar:</strong> <strong>{reprogNombreCliente}</strong> ·{' '}
                          <strong>Sin fecha asignada</strong> ({numEj} ejercicio{numEj === 1 ? '' : 's'}) &mdash; Haz clic en cualquier día y hora del calendario para asignarla.
                        </>
                      ) : (
                        <>
                          📍 <strong>Sesión a reprogramar:</strong> <strong>{reprogNombreCliente}</strong> ·{' '}
                          {s?.diaStr} {s?.fechaStr} a las <strong>{horaOrigen}</strong> ({numEj} ejercicio{numEj === 1 ? '' : 's'}) &mdash; Haz clic en cualquier hora del calendario para ubicarla.
                        </>
                      )}
                    </div>
                  );
                })()}

                <div className="reprog-toolbar">
                  <div className="reprog-nav-group">
                    <button
                      type="button"
                      className="reprog-nav-arrow"
                      onClick={() => {
                        const next = new Date(reprogCurrentMonday);
                        next.setUTCDate(next.getUTCDate() - 7);
                        setReprogCurrentMonday(next);
                      }}
                      title="Semana anterior"
                    >
                      &lt;
                    </button>
                    <span className="reprog-week-title">
                      {(() => {
                        const startDay = new Date(reprogCurrentMonday);
                        const endDay = new Date(reprogCurrentMonday);
                        endDay.setUTCDate(endDay.getUTCDate() + (diasSemana.length - 1));
                        return `📅 ${startDay.getUTCDate()} ${MES_NAMES_REPROG[startDay.getUTCMonth()]} - ${endDay.getUTCDate()} ${MES_NAMES_REPROG[endDay.getUTCMonth()]} ${endDay.getUTCFullYear()}`;
                      })()}
                    </span>
                    <button
                      type="button"
                      className="reprog-nav-arrow"
                      onClick={() => {
                        const next = new Date(reprogCurrentMonday);
                        next.setUTCDate(next.getUTCDate() + 7);
                        setReprogCurrentMonday(next);
                      }}
                      title="Semana siguiente"
                    >
                      &gt;
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      onClick={() => {
                        const now = new Date();
                        const hoyUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
                        setReprogCurrentMonday(obtenerLunesUTC(hoyUTC));
                      }}
                    >
                      Semana actual
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      onClick={() => setReprogCurrentMonday(new Date(reprogOriginMonday))}
                    >
                      Semana de la sesión
                    </button>
                  </div>
                </div>

                <div className="reprog-calendar-wrapper">
                  {(() => {
                    const numDias = diasSemana.length;
                    const now = new Date();
                    const hoyISO = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
                      .toISOString()
                      .split('T')[0];

                    const weekStartUTC = new Date(reprogCurrentMonday);
                    weekStartUTC.setUTCHours(0, 0, 0, 0);
                    const weekEndUTC = new Date(reprogCurrentMonday);
                    weekEndUTC.setUTCDate(weekEndUTC.getUTCDate() + numDias);
                    weekEndUTC.setUTCHours(0, 0, 0, 0);

                    const sesionesSemanaCliente = reprogAllSessions.filter(
                      s => !s.sin_fecha && s.fechaObj && s.fechaObj >= weekStartUTC && s.fechaObj < weekEndUTC
                    );

                    return (
                      <div
                        className="reprog-calendar-grid"
                        style={{
                          gridTemplateColumns: `60px repeat(${numDias}, 1fr)`,
                          gridTemplateRows: `auto repeat(${mananaSlots.length}, 32px) 14px repeat(${tardeSlots.length}, 32px)`
                        }}
                      >
                        <div
                          className="reprog-day-header"
                          style={{ gridColumn: 1, gridRow: 1, borderRight: '3px solid #64748b' }}
                        >
                          Hora
                        </div>

                        {diasSemana.map((dName, i) => {
                          const tempDay = new Date(reprogCurrentMonday);
                          tempDay.setUTCDate(tempDay.getUTCDate() + i);
                          const dateISO = tempDay.toISOString().split('T')[0];
                          const isToday = dateISO === hoyISO;

                          return (
                            <div
                              key={dName}
                              className="reprog-day-header"
                              style={{
                                gridColumn: i + 2,
                                gridRow: 1,
                                background: isToday ? '#f0fdfa' : undefined
                              }}
                            >
                              <strong>
                                {dName}
                                {isToday ? ' (Hoy)' : ''}
                              </strong>
                              <span>
                                {tempDay.getUTCDate()} {MES_NAMES_REPROG[tempDay.getUTCMonth()]}
                              </span>
                            </div>
                          );
                        })}

                        {timeSlots.map(time => {
                          const row = timeToRowMap[time];
                          return (
                            <React.Fragment key={time}>
                              <div
                                className="reprog-time-label"
                                style={{ gridColumn: 1, gridRow: row }}
                              >
                                {time}
                              </div>
                              {diasSemana.map((_, colIdx) => {
                                const col = colIdx + 2;
                                const dIter = new Date(reprogCurrentMonday);
                                dIter.setUTCDate(dIter.getUTCDate() + colIdx);
                                const dateStrID = dIter.toISOString().split('T')[0];

                                return (
                                  <div
                                    key={`${dateStrID}-${time}`}
                                    className="reprog-bg-cell"
                                    style={{ gridColumn: col, gridRow: row }}
                                    onClick={() => handleSeleccionarHuecoReprogramar(dateStrID, time)}
                                    title={`Mover sesión al ${dateStrID} a las ${time}`}
                                  />
                                );
                              })}
                            </React.Fragment>
                          );
                        })}

                        <div
                          className="reprog-noon-separator"
                          style={{ gridRow: separatorRow }}
                        />

                        {sesionesSemanaCliente.map(s => {
                          const dayIndex = s.fechaObj.getUTCDay();
                          if (dayIndex < 1 || dayIndex > numDias) return null;
                          const col = dayIndex + 1;
                          const timeStr = s.horaStr.split(' - ')[0];
                          const row = timeToRowMap[timeStr];
                          if (!row) return null;

                          const dateStrID = s.fechaObj.toISOString().split('T')[0];
                          const isOrigin = s.id === reprogSourceSessionId;
                          const isCompleted = s.estado === 'Completada';
                          const numEj = s.ejercicios ? s.ejercicios.length : 0;
                          const ejLabel = numEj > 0 ? `${numEj} ej.` : 'Vacía';

                          let cardClass = 'reprog-event-other';
                          let titleBadge = `📅 ${timeStr} (${ejLabel})`;

                          if (isOrigin) {
                            cardClass = 'reprog-event-origin';
                            titleBadge = `📍 Sesión a mover (${ejLabel})`;
                          } else if (isCompleted) {
                            cardClass = 'reprog-event-completed';
                            titleBadge = `✅ Completada (${ejLabel})`;
                          }

                          return (
                            <div
                              key={s.id}
                              className={`reprog-event-card ${cardClass}`}
                              style={{ gridColumn: col, gridRow: `${row} / span 2` }}
                              onClick={() => {
                                if (isCompleted) {
                                  alert('No puedes reprogramar sobre un día que ya tiene una sesión completada.');
                                } else {
                                  handleSeleccionarHuecoReprogramar(dateStrID, timeStr);
                                }
                              }}
                              title={`Haz clic para elegir ${dateStrID} a las ${timeStr}`}
                            >
                              <div>{titleBadge}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                <div className="reprog-legend">
                  <span className="reprog-legend-item">
                    <span
                      className="reprog-legend-box"
                      style={{ background: '#fef3c7', border: '2px dashed #d97706' }}
                    />{' '}
                    Sesión a mover
                  </span>
                  <span className="reprog-legend-item">
                    <span
                      className="reprog-legend-box"
                      style={{ background: '#e0f2fe', border: '1px solid #38bdf8' }}
                    />{' '}
                    Otras sesiones del cliente
                  </span>
                  <span className="reprog-legend-item">
                    <span
                      className="reprog-legend-box"
                      style={{ background: '#dcfce7', border: '1px solid #86efac' }}
                    />{' '}
                    Completada (bloqueada)
                  </span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--accent-dark)' }}>
                    💡 Haz clic en una hora para elegir dónde moverla
                  </span>
                </div>

                <div className="modal-footer" style={{ marginTop: 15 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setReprogModalOpen(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              /* Step 2: Reprogramar Options */
              <div className="conflict-options">
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fcd34d',
                    padding: 15,
                    borderRadius: 8,
                    marginBottom: 20
                  }}
                >
                  <h4 style={{ color: '#d97706', margin: '0 0 6px 0' }}>Opciones de Planificación</h4>
                  <p style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: '#92400e' }}>
                    {reprogPendingData?.sourceSession?.sin_fecha ? (
                      <>
                        Asignar <strong>Sesión sin fecha</strong> al{' '}
                        <strong>
                          {reprogPendingData.diaDestinoNombre} {reprogPendingData.targetFechaStr} a las{' '}
                          {reprogPendingData.horaStr}
                        </strong>
                        .
                      </>
                    ) : (
                      <>
                        Mover del{' '}
                        <strong>
                          {reprogPendingData?.sourceSession?.diaStr} {reprogPendingData?.sourceSession?.fechaStr} (
                          {reprogPendingData?.sourceSession?.horaStr?.split(' - ')[0]})
                        </strong>{' '}
                        al{' '}
                        <strong>
                          {reprogPendingData?.diaDestinoNombre} {reprogPendingData?.targetFechaStr} a las{' '}
                          {reprogPendingData?.horaStr}
                        </strong>
                        .
                      </>
                    )}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#92400e' }}>
                    ¿Cómo deseas organizar las rutinas de la línea temporal?
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  style={{
                    width: '100%',
                    marginBottom: 10,
                    textAlign: 'left',
                    padding: 12,
                    background: '#0f172a',
                    display: 'block'
                  }}
                  onClick={handleEjecutarSustitucion}
                >
                  <strong>Mantener / Sustituir rutina</strong>
                  <br />
                  <span style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>
                    Mueve la sesión a la nueva hora conservando su rutina original. Si hay otra sesión ese día, se sobrescribe.
                  </span>
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  style={{
                    width: '100%',
                    marginBottom: 10,
                    textAlign: 'left',
                    padding: 12,
                    background: '#0284c7',
                    display: 'block'
                  }}
                  onClick={handleEjecutarDesplazamiento}
                >
                  <strong>Mover rutinas hacia adelante (Cascada Adelante)</strong>
                  <br />
                  <span style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>
                    Empuja las rutinas siguientes una sesión hacia adelante y, si la última tiene programación, crea una nueva sesión el día hábil siguiente para no perderla.
                  </span>
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  style={{
                    width: '100%',
                    marginBottom: 10,
                    textAlign: 'left',
                    padding: 12,
                    background: '#16a34a',
                    display: 'block'
                  }}
                  onClick={handleEjecutarRecogidaCascada}
                >
                  <strong>Mover rutinas hacia atrás / Recoger (Cascada Atrás)</strong>
                  <br />
                  <span style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>
                    Ubica la sesión en la nueva hora y adelanta la rutina de la siguiente sesión a este hueco (la última quedará vacía).
                  </span>
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', textAlign: 'center', padding: 12 }}
                  onClick={() => setReprogStep(1)}
                >
                  ⬅️ Volver al calendario
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEND ROUTINE MODAL */}
      <SendRoutineModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        ejercicios={sendEjercicios}
        defaultIntensity={sendIntensidad}
        defaultTipoSesion={sendTipoSesion}
        onSuccess={loadAgenda}
      />
    </div>
  );
};
