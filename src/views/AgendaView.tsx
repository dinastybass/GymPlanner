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
import { getValoresMaestro, obtenerFechaLimiteReprogramacionUTC } from '../services/maestrosService';
import { CustomDropdown } from '../components/CustomDropdown';
import { SendRoutineModal } from '../components/SendRoutineModal';
import { ReprogramarSesionModal } from '../components/ReprogramarSesionModal';
import { useUndo } from '../context/UndoContext';
import { FirestoreOp } from '../services/undoService';
import { esSesionCompletada, parsearFechaFirestore } from '../utils/helpers';
import { confirmarDialogo } from '../utils/confirmDialog';
import {
  cancelarSesionConCascadaAdelante,
  asignarFechaASesionSinFechaConCascadaAtras,
  reprogramarSesionConFechaOrdenCronologico,
  buscarSesionMismoDiaCliente,
  resolverColisionSesionMismoDia,
  crearSesionesConCascadaAtras,
  revertirVencimientosAutomaticos,
  procesarCaducidadSesionesSinFechaPorMeses,
  limpiarSesionesAntiguasYEjerciciosHuerfanos
} from '../services/sessionCascadeService';

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

function obtenerAccionesDisponiblesSesion(sesionRaw: any = {}, mesesMargen = 1) {
  const parsedFecha =
    sesionRaw.fechaObj instanceof Date
      ? sesionRaw.fechaObj
      : parsearFechaFirestore(sesionRaw.fecha_hora_inicio);

  const isSinFecha = Boolean(
    sesionRaw.sin_fecha ||
    sesionRaw.estado === 'Sin fecha' ||
    !parsedFecha
  );

  const d: Date | null = isSinFecha ? null : parsedFecha;

  const now = new Date();
  const startOfTodayUTC = new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(),
    0, 0, 0, 0
  ));

  let estado = 'Pendiente';
  if (isSinFecha) {
    estado = 'Sin fecha';
  } else if (esSesionCompletada(sesionRaw)) {
    estado = 'Completada';
  } else if ((d && d < startOfTodayUTC) || sesionRaw.estado === 'Vencida') {
    estado = 'Vencida';
  }

  const limiteReprogramar = obtenerFechaLimiteReprogramacionUTC(mesesMargen, now);
  const tipoSesion = sesionRaw.tipo_sesion || sesionRaw.Tipo || 'Individual';
  const isSG = tipoSesion === 'Small Group' || tipoSesion === 'SG';
  const ejercicios = Array.isArray(sesionRaw.ejercicios) ? sesionRaw.ejercicios : [];

  const puedeProgramar = true;
  const puedeReprogramar = !isSG && (isSinFecha || estado === 'Pendiente' || (estado === 'Vencida' && d && d >= limiteReprogramar));
  const puedeCancelarSinFecha = !isSG && !isSinFecha && estado !== 'Completada' && !(estado === 'Vencida' && d && d < limiteReprogramar);
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

function formatearSesionAgenda(id: string, data: any = {}, mesesMargen = 1) {
  const info = obtenerAccionesDisponiblesSesion(data, mesesMargen);
  const d = info.fechaObj;
  const isSinFecha = info.sin_fecha;
  const dAnt = parsearFechaFirestore(data.fecha_hora_anterior);

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

  const [currentView, setCurrentView] = useState<'individuales' | 'sg'>(() => {
    try {
      const saved = sessionStorage.getItem('gym_agenda_view');
      if (saved === 'individuales' || saved === 'sg') return saved;
    } catch {
      // ignore
    }
    return 'individuales';
  });
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    try {
      const saved = sessionStorage.getItem('gym_agenda_month');
      if (saved) {
        const parsed = new Date(saved);
        if (!isNaN(parsed.getTime())) {
          return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
        }
      }
    } catch {
      // ignore
    }
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('gym_agenda_view', currentView);
      sessionStorage.setItem('gym_agenda_month', currentMonthDate.toISOString());
    } catch {
      // ignore
    }
  }, [currentView, currentMonthDate]);

  // Mobile calendar mode (Google Calendar style single-day view vs full week)
  const [mobileCalendarMode, setMobileCalendarMode] = useState<'dia' | 'semana'>('dia');
  const [mobileSelectedDayIdx, setMobileSelectedDayIdx] = useState<number>(() => {
    const now = new Date();
    const day = now.getDay(); // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat
    return day >= 1 && day <= 5 ? day - 1 : 0;
  });

  // Master data
  const [diasSemana, setDiasSemana] = useState<string[]>(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
  const [timeSlots, setTimeSlots] = useState<string[]>([
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'
  ]);
  const [sgTimeSlotsRaw, setSgTimeSlotsRaw] = useState<string[]>(['Lunes 18:00', 'Martes 17:00']);
  const [ocupacionMaxima, setOcupacionMaxima] = useState<number>(6);
  const [mesesMargenReprog, setMesesMargenReprog] = useState<number>(1);

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
  const [planCascadaAtras, setPlanCascadaAtras] = useState(true);
  const [planClientSessions, setPlanClientSessions] = useState<
    { id: string; fechaObj: Date; numEj: number }[]
  >([]);
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

  // Reprogramar Modal Unificado
  const [reprogModalOpen, setReprogModalOpen] = useState(false);
  const [reprogSourceSessionId, setReprogSourceSessionId] = useState<string>('');
  const [reprogIdCliente, setReprogIdCliente] = useState<string>('');
  const [reprogNombreCliente, setReprogNombreCliente] = useState<string>('');

  // Send Routine Modal
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendEjercicios, setSendEjercicios] = useState<any[]>([]);
  const [sendTipoSesion, setSendTipoSesion] = useState<string>('Individual');
  const [sendIntensidad, setSendIntensidad] = useState<'LOW' | 'MED' | 'HIGH'>('MED');
  const [sendClientId, setSendClientId] = useState<string>('');
  const [sendSessionId, setSendSessionId] = useState<string>('');

  // Modal Colisión de Sesión en el Mismo Día (Machacar ejercicios vs. Cascada hacia delante)
  const [colisionMismoDiaModal, setColisionMismoDiaModal] = useState<{
    open: boolean;
    idSesionOrigen?: string;
    idSesionExistenteDia: string;
    nombreCliente: string;
    nuevaFechaUTC: Date | null;
    horaExistenteStr: string;
    horaNuevaStr: string;
    fechaLabelStr: string;
    numEjExistente: number;
    numEjEntrante: number;
    ejerciciosEntrantes?: any[];
    saving: boolean;
  }>({
    open: false,
    idSesionOrigen: undefined,
    idSesionExistenteDia: '',
    nombreCliente: '',
    nuevaFechaUTC: null,
    horaExistenteStr: '',
    horaNuevaStr: '',
    fechaLabelStr: '',
    numEjExistente: 0,
    numEjEntrante: 0,
    ejerciciosEntrantes: undefined,
    saving: false
  });

  // Modal Ubicar Sesión (Con cascada vs. Sin cascada)
  const [ubicarSinFechaModal, setUbicarSinFechaModal] = useState<{
    open: boolean;
    idSesionSinFecha: string;
    esSinFecha: boolean;
    nombreCliente: string;
    nuevaFechaUTC: Date | null;
    fechaLabelStr: string;
    horaStr: string;
    numEjercicios: number;
    saving: boolean;
  }>({
    open: false,
    idSesionSinFecha: '',
    esSinFecha: true,
    nombreCliente: '',
    nuevaFechaUTC: null,
    fechaLabelStr: '',
    horaStr: '',
    numEjercicios: 0,
    saving: false
  });

  // Modal Opciones Papelera (Eliminar definitivamente vs Enviar a sin fecha), idéntico a FichaClienteView
  const [papeleraSesionModal, setPapeleraSesionModal] = useState<{
    open: boolean;
    idSesion: string;
    sFmt: any;
    fechaStr: string;
    horaStr: string;
    puedeEnviarSinFecha: boolean;
  }>({
    open: false,
    idSesion: '',
    sFmt: null,
    fechaStr: '',
    horaStr: '',
    puedeEnviarSinFecha: true
  });

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
      await revertirVencimientosAutomaticos();
      await limpiarSesionesAntiguasYEjerciciosHuerfanos();
      await procesarCaducidadSesionesSinFechaPorMeses();
      const [diasDB, horasIndDB, horasSGDB, ocupacionDB, mesesMargenDB] = await Promise.all([
        getValoresMaestro('Agenda', 'Días de la semana'),
        getValoresMaestro('Agenda', 'Horarios Sesiones Individuales'),
        getValoresMaestro('Agenda', 'Horarios Small Groups'),
        getValoresMaestro('Agenda', 'Ocupación máxima'),
        getValoresMaestro('Agenda', 'Meses de margen para reprogramar')
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
      if (mesesMargenDB.length > 0) {
        const parsedMargen = parseInt(String(mesesMargenDB[0]).trim(), 10);
        if (!isNaN(parsedMargen) && parsedMargen >= 0) {
          setMesesMargenReprog(parsedMargen);
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
        if (esSesionCompletada(data) && (data.estado !== 'Completada' || data.estado_sesion !== 'Completada')) {
          data.estado = 'Completada';
          data.estado_sesion = 'Completada';
          setDoc(doc(db, "agenda_sesiones", docSnap.id), {
            estado: 'Completada',
            estado_sesion: 'Completada'
          }, { merge: true }).catch(() => {});
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
    clientes: { nombre: string; idSesion: string; isPending: boolean; isCompleted: boolean }[];
    dateStrID: string;
    position?: 'left' | 'right';
    isOverlapping?: boolean;
  }[]> = {};

  const nowCal = new Date();
  const startOfTodayCalUTC = new Date(Date.UTC(nowCal.getFullYear(), nowCal.getMonth(), nowCal.getDate(), 0, 0, 0, 0));

  const startDateCalendar = new Date(weeksList[0].mondayDate);
  startDateCalendar.setUTCHours(0, 0, 0, 0);

  Object.values(sesionesRaw).forEach(info => {
    const data = info.docData;
    if (data.tipo_sesion === 'Small Group') return;
    const fecha = parsearFechaFirestore(data.fecha_hora_inicio);
    if (!fecha) return;

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
    const fecha = parsearFechaFirestore(data.fecha_hora_inicio);
    if (!fecha) return;
    const isCompleted = esSesionCompletada(data);
    const isPending = !isCompleted && (!data.ejercicios || data.ejercicios.length === 0);
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
            isPending,
            isCompleted
          });
        } else {
          dayEventsMap[dayKey].push({
            weekNum,
            col,
            row,
            clientes: [{ nombre: info.nombreCliente, idSesion: info.id, isPending, isCompleted }],
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
    clientes: { idSesion: string; nombre: string; isCompleted: boolean }[];
    firstId: string;
    isPending: boolean;
  }> = {};

  Object.values(sesionesRaw).forEach(info => {
    const data = info.docData;
    if (data.tipo_sesion !== 'Small Group') return;
    const fecha = parsearFechaFirestore(data.fecha_hora_inicio);
    if (!fecha) return;
    const isCompleted = esSesionCompletada(data);
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
      nombre: info.nombreCliente,
      isCompleted
    });
  });

  // Floating Action Menu Handler
  const handleOpenSessionMenu = (e: React.MouseEvent, idSesion: string) => {
    e.preventDefault();
    e.stopPropagation();
    const info = sesionesRaw[idSesion];
    if (!info) return;

    const sFmt = formatearSesionAgenda(idSesion, info.docData, mesesMargenReprog);
    const acciones = obtenerAccionesDisponiblesSesion(info.docData, mesesMargenReprog);

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

  // Cancelar sesión (cascada hacia delante + sobrante a Sin fecha)
  const handleCancelarSinFecha = async (idSesion: string, sFmt: any) => {
    setActiveMenu(null);
    const nombreCli = sFmt.alias || sFmt.nombre_cliente || 'Cliente';
    const msg =
      `¿Cancelar esta sesión de ${nombreCli}?\n\n` +
      '• Se eliminará la cita del calendario para liberar el hueco.\n' +
      '• Su programación se desplazará en cascada al siguiente día programado.\n' +
      '• La última programación se ubicará en la primera sesión vacía del bloque final (o pasará a "Sesiones programadas sin fecha" si todas están programadas).';

    if (
      !(await confirmarDialogo(msg, {
        titulo: 'Cancelar sesión',
        textoConfirmar: 'Sí, cancelar sesión',
        danger: true
      }))
    ) {
      return;
    }

    try {
      const autor = localStorage.getItem('gym_user_name') || 'Entrenador';
      const res = await cancelarSesionConCascadaAdelante({
        idSesion,
        esAutomatico: false,
        usuario: autor
      });

      await loadAgenda();

      if (res) {
        pushAction({
          label: `Cancelar sesión (${nombreCli})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }
    } catch (err) {
      console.error("Error al cancelar sesión:", err);
      alert("No se pudo cancelar la sesión.");
    }
  };

  const handleToggleCompletadaAgenda = async (idSesion: string, sFmt: any) => {
    setActiveMenu(null);
    try {
      const backupData = sFmt.docData || {};
      const isComp = sFmt.estado === 'Completada' || esSesionCompletada(backupData);
      const nextStatus = isComp ? 'Pendiente' : 'Completada';
      const prevStatus = isComp ? 'Completada' : 'Pendiente';
      const nombreCli = sFmt.alias || sFmt.nombre_cliente || 'Cliente';

      const updateData = {
        estado: nextStatus,
        estado_sesion: nextStatus,
        pendiente_manual: nextStatus === 'Pendiente'
      };

      await setDoc(doc(db, "agenda_sesiones", idSesion), updateData, { merge: true });
      await loadAgenda();

      pushAction({
        label: `Marcar sesión de ${nombreCli} como ${nextStatus}`,
        undoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesion, data: { estado: prevStatus, estado_sesion: prevStatus, pendiente_manual: prevStatus === 'Pendiente' }, merge: true }],
        redoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesion, data: updateData, merge: true }],
        showToast: true,
        toastMessage: nextStatus === 'Completada' ? `🟢 Sesión de ${nombreCli} marcada como Completada` : `⚪ Sesión de ${nombreCli} marcada como Pendiente`
      });
    } catch (err) {
      console.error("Error al cambiar estado de sesión:", err);
      alert("No se pudo cambiar el estado de la sesión.");
    }
  };

  // Abrir modal de opciones de papelera (idéntico a Ficha de Cliente)
  const handleAbrirModalPapeleraAgenda = (idSesion: string, sFmt: any, acciones: any) => {
    setActiveMenu(null);
    if (sFmt.sin_fecha) {
      handleEliminarSesion(idSesion, sFmt);
      return;
    }
    const horaStr = sFmt.horaStr ? sFmt.horaStr.split(' - ')[0] : '--:--';
    setPapeleraSesionModal({
      open: true,
      idSesion,
      sFmt,
      fechaStr: sFmt.fechaStr || '',
      horaStr,
      puedeEnviarSinFecha: Boolean(acciones?.puedeCancelarSinFecha)
    });
  };

  // Eliminar sesión with Undo
  const handleEliminarSesion = async (idSesion: string, sFmt: any) => {
    setActiveMenu(null);
    if (
      !(await confirmarDialogo(
        '¿Seguro que deseas eliminar esta sesión de la agenda?\n\nPodrás deshacer la acción con Ctrl+Z.',
        {
          titulo: 'Eliminar sesión',
          textoConfirmar: 'Sí, eliminar',
          danger: true
        }
      ))
    ) {
      return;
    }

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

  // Open Unified Weekly Reschedule Modal
  const handleOpenReprogramar = (idSesion: string, idCliente: string, nombreCliente: string) => {
    setActiveMenu(null);
    setReprogSourceSessionId(idSesion);
    setReprogIdCliente(idCliente || '');
    setReprogNombreCliente(nombreCliente || '');
    setReprogModalOpen(true);
  };

  const handleEjecutarUbicacionSinFecha = async (conCascada: boolean) => {
    if (!ubicarSinFechaModal.nuevaFechaUTC || ubicarSinFechaModal.saving) return;
    setUbicarSinFechaModal(prev => ({ ...prev, saving: true }));
    const autor = localStorage.getItem('gym_user_name') || 'Entrenador';

    try {
      const res = ubicarSinFechaModal.esSinFecha
        ? await asignarFechaASesionSinFechaConCascadaAtras({
            idSesionSinFecha: ubicarSinFechaModal.idSesionSinFecha,
            nuevaFechaUTC: ubicarSinFechaModal.nuevaFechaUTC,
            conCascada,
            usuario: autor
          })
        : await reprogramarSesionConFechaOrdenCronologico({
            idSesion: ubicarSinFechaModal.idSesionSinFecha,
            nuevaFechaUTC: ubicarSinFechaModal.nuevaFechaUTC,
            conCascada,
            usuario: autor
          });

      setUbicarSinFechaModal(prev => ({ ...prev, open: false, saving: false }));
      setReprogModalOpen(false);
      setAsigModalOpen(false);
      setSavingAsig(false);
      await loadAgenda();

      if (res) {
        pushAction({
          label: conCascada
            ? `Reprogramar sesión con cascada (${ubicarSinFechaModal.nombreCliente})`
            : `Ubicar sesión sin cascada (${ubicarSinFechaModal.nombreCliente})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }
    } catch (err) {
      console.error('Error al ubicar sesión:', err);
      alert('No se pudo ubicar la sesión.');
      setUbicarSinFechaModal(prev => ({ ...prev, saving: false }));
    }
  };

  const handleEjecutarResolucionColisionMismoDia = async (modo: 'MACHACAR' | 'CASCADA_ADELANTE') => {
    if (!colisionMismoDiaModal.nuevaFechaUTC || colisionMismoDiaModal.saving) return;
    setColisionMismoDiaModal(prev => ({ ...prev, saving: true }));
    const autor = localStorage.getItem('gym_user_name') || 'Entrenador';

    try {
      const res = await resolverColisionSesionMismoDia({
        idSesionExistenteDia: colisionMismoDiaModal.idSesionExistenteDia,
        nuevaFechaUTC: colisionMismoDiaModal.nuevaFechaUTC,
        modo,
        idSesionOrigen: colisionMismoDiaModal.idSesionOrigen,
        ejerciciosEntrantes: colisionMismoDiaModal.ejerciciosEntrantes,
        usuario: autor
      });

      setColisionMismoDiaModal(prev => ({ ...prev, open: false, saving: false }));
      setReprogModalOpen(false);
      setAsigModalOpen(false);
      setPlanModalOpen(false);
      setSavingAsig(false);
      setSavingPlan(false);
      await loadAgenda();

      if (res) {
        pushAction({
          label:
            modo === 'MACHACAR'
              ? `Machacar sesión del mismo día (${colisionMismoDiaModal.nombreCliente})`
              : `Actualizar sesión en cascada (${colisionMismoDiaModal.nombreCliente})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }
    } catch (err) {
      console.error('Error resolviendo colisión en el mismo día:', err);
      alert('No se pudo actualizar la sesión de ese día.');
      setColisionMismoDiaModal(prev => ({ ...prev, saving: false }));
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
          sessions.push(formatearSesionAgenda(d.id, d.data(), mesesMargenReprog));
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

  // Load sessions for selected client in Planificar Días modal to detect subsequent programmed sessions
  useEffect(() => {
    if (!planModalOpen || !planClienteId) {
      setPlanClientSessions([]);
      return;
    }
    const q = query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', planClienteId));
    getDocs(q)
      .then(snap => {
        const list: { id: string; fechaObj: Date; numEj: number }[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (data.sin_fecha) return;
          const tipo = String(data.tipo_sesion || '').toLowerCase();
          if (tipo.includes('small') || tipo.includes('group') || tipo === 'sg') return;
          if (esSesionCompletada(data)) return;
          const parsedF = parsearFechaFirestore(data.fecha_hora_inicio);
          if (!parsedF) return;
          const numEj = Array.isArray(data.ejercicios) ? data.ejercicios.length : 0;
          list.push({ id: d.id, fechaObj: parsedF, numEj });
        });
        list.sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());
        setPlanClientSessions(list);
      })
      .catch(() => setPlanClientSessions([]));
  }, [planModalOpen, planClienteId]);

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
      const colisionDia = await buscarSesionMismoDiaCliente({
        idCliente: asigClienteId,
        fechaUTC: nuevaFechaObj,
        excluirIdSesion: sesionElegida.id
      });

      if (colisionDia) {
        if (esSesionCompletada(colisionDia.data)) {
          alert('Operación bloqueada: El cliente ya tiene una sesión completada en ese día.');
          setSavingAsig(false);
          return;
        }
        const horaExistStr = `${String(colisionDia.fecha.getUTCHours()).padStart(2, '0')}:${String(
          colisionDia.fecha.getUTCMinutes()
        ).padStart(2, '0')}`;
        const cliObj = globalClientes.find(c => c.id === asigClienteId);
        const nombreCli = cliObj ? cliObj.alias : sesionElegida.alias || 'Cliente';

        setSavingAsig(false);
        setColisionMismoDiaModal({
          open: true,
          idSesionOrigen: sesionElegida.id,
          idSesionExistenteDia: colisionDia.id,
          nombreCliente: nombreCli,
          nuevaFechaUTC: nuevaFechaObj,
          horaExistenteStr: horaExistStr,
          horaNuevaStr: asigHora,
          fechaLabelStr: `${d}/${m}/${y}`,
          numEjExistente: Array.isArray(colisionDia.data.ejercicios) ? colisionDia.data.ejercicios.length : 0,
          numEjEntrante: Array.isArray(sesionElegida.ejercicios) ? sesionElegida.ejercicios.length : 0,
          ejerciciosEntrantes: undefined,
          saving: false
        });
        return;
      }

      const esMismoDiaOrigen =
        !sesionElegida.sin_fecha &&
        Boolean(sesionElegida.fechaObj) &&
        sesionElegida.fechaObj.getUTCFullYear() === nuevaFechaObj.getUTCFullYear() &&
        sesionElegida.fechaObj.getUTCMonth() === nuevaFechaObj.getUTCMonth() &&
        sesionElegida.fechaObj.getUTCDate() === nuevaFechaObj.getUTCDate();

      if (esMismoDiaOrigen) {
        const res = await reprogramarSesionConFechaOrdenCronologico({
          idSesion: sesionElegida.id,
          nuevaFechaUTC: nuevaFechaObj,
          conCascada: false,
          usuario: autor
        });

        setAsigModalOpen(false);
        await loadAgenda();

        if (res) {
          pushAction({
            label: `Actualizar hora de sesión (${d}/${m}/${y} ${asigHora})`,
            undoOps: res.undoOps,
            redoOps: res.redoOps,
            showToast: true,
            toastMessage: res.toastMessage
          });
        }
      } else {
        const cliObj = globalClientes.find(c => c.id === asigClienteId);
        const nombreCli = cliObj ? cliObj.alias : sesionElegida.alias || 'Cliente';
        setSavingAsig(false);
        setUbicarSinFechaModal({
          open: true,
          idSesionSinFecha: sesionElegida.id,
          esSinFecha: Boolean(sesionElegida.sin_fecha),
          nombreCliente: nombreCli,
          nuevaFechaUTC: nuevaFechaObj,
          fechaLabelStr: `${d}/${m}/${y}`,
          horaStr: asigHora,
          numEjercicios: Array.isArray(sesionElegida.ejercicios) ? sesionElegida.ejercicios.length : 0,
          saving: false
        });
        return;
      }
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

  // Detect subsequent programmed sessions of the selected client after the earliest target date
  const sesionesPosterioresProgramadas = (() => {
    if (planTipo !== 'Individual' || !planClienteId || fechasPlanCalculadas.length === 0) {
      return [];
    }
    const [hStr, mStr] = (planHoraIni || '08:00').split(':');
    const primeraFechaUTC = new Date(fechasPlanCalculadas[0]);
    primeraFechaUTC.setUTCHours(parseInt(hStr, 10) || 0, parseInt(mStr, 10) || 0, 0, 0);

    return planClientSessions.filter(
      s => s.fechaObj.getTime() > primeraFechaUTC.getTime() && s.numEj > 0
    );
  })();

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
    horaIni: string,
    conCascadaAtras = false
  ) => {
    const fechasConHora = fechas.map(fOrig => {
      const fechaGuardar = new Date(fOrig);
      const [h, m] = horaIni.split(':');
      fechaGuardar.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
      return fechaGuardar;
    });

    const res = await crearSesionesConCascadaAtras({
      idCliente,
      nombreCli,
      fechasUTC: fechasConHora,
      isSG,
      conCascadaAtras: !isSG && conCascadaAtras,
      usuario: emailAutor
    });

    if (res && res.undoOps.length > 0) {
      pushAction({
        label: res.toastMessage,
        undoOps: res.undoOps,
        redoOps: res.redoOps,
        showToast: true,
        toastMessage: res.toastMessage
      });
    }
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

    // If inserting 1 single Individual day, check if client already has a session on that same day
    if (fechasPlanCalculadas.length === 1 && !isSG) {
      const f = new Date(fechasPlanCalculadas[0]);
      const [h, m] = horaIni.split(':');
      f.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);

      try {
        const colisionMismoDia = await buscarSesionMismoDiaCliente({
          idCliente: planClienteId,
          fechaUTC: f
        });

        if (colisionMismoDia) {
          if (esSesionCompletada(colisionMismoDia.data)) {
            alert('Operación bloqueada: El cliente ya tiene una sesión completada en ese mismo día.');
            setSavingPlan(false);
            return;
          }
          const horaExistStr = `${String(colisionMismoDia.fecha.getUTCHours()).padStart(2, '0')}:${String(
            colisionMismoDia.fecha.getUTCMinutes()
          ).padStart(2, '0')}`;
          const fechaLabelStr = f.toLocaleDateString('es-ES', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'UTC'
          });

          setSavingPlan(false);
          setColisionMismoDiaModal({
            open: true,
            idSesionOrigen: undefined,
            idSesionExistenteDia: colisionMismoDia.id,
            nombreCliente: nombreCli,
            nuevaFechaUTC: f,
            horaExistenteStr: horaExistStr,
            horaNuevaStr: horaIni,
            fechaLabelStr,
            numEjExistente: Array.isArray(colisionMismoDia.data.ejercicios)
              ? colisionMismoDia.data.ejercicios.length
              : 0,
            numEjEntrante: 0,
            ejerciciosEntrantes: [],
            saving: false
          });
          return;
        }
      } catch (err) {
        console.error("Error comprobando colisión en el mismo día:", err);
      }
    }

    try {
      const aplicarCascada =
        !isSG && sesionesPosterioresProgramadas.length > 0 && planCascadaAtras;
      await ejecutarGuardadoNormal(
        fechasPlanCalculadas,
        isSG,
        emailAutor,
        planClienteId,
        nombreCli,
        horaIni,
        aplicarCascada
      );
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
        estado_sesion: "Pendiente",
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
          <span className="desktop-text">Sesiones individuales</span>
          <span className="mobile-text">Individuales</span>
        </button>
        <button
          type="button"
          className={`filter-btn ${currentView === 'sg' ? 'active' : 'inactive'}`}
          onClick={() => setCurrentView('sg')}
        >
          <span className="desktop-text">Small Groups</span>
          <span className="mobile-text">Small Groups</span>
        </button>

        <div className="filters-right-actions">
          <button
            type="button"
            className="btn-outline btn-agenda-top"
            onClick={() => onNavigate('pendientes')}
          >
            <span className="desktop-text">Programaciones pendientes</span>
            <span className="mobile-text">Pendientes</span>
          </button>
          <button
            type="button"
            className="btn-primary btn-agenda-top"
            onClick={handleAbrirModalPlanificarGeneral}
          >
            <span className="desktop-text">+ Planificar Días de Cliente</span>
            <span className="mobile-text">+ Planificar</span>
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
        <span className="month-title desktop-text">{mesStrFormatted}</span>
      </div>

      {/* Calendar Container */}
      <div id="calendar-container">
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Cargando agenda...</p>
        ) : (
          (() => {
            const now = new Date();
            const hoyISO = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
              .toISOString()
              .split('T')[0];

            return weeksList.map(wInfo => {
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
                      {/* Mobile controls: Selector de modo (Día / Semana) y tira de días */}
                      <div className="mobile-agenda-controls">
                        <div className="mobile-mode-switcher">
                          <button
                            type="button"
                            className={`mobile-mode-btn ${mobileCalendarMode === 'dia' ? 'active' : ''}`}
                            onClick={() => setMobileCalendarMode('dia')}
                          >
                            📅 Vista Día
                          </button>
                          <button
                            type="button"
                            className={`mobile-mode-btn ${mobileCalendarMode === 'semana' ? 'active' : ''}`}
                            onClick={() => setMobileCalendarMode('semana')}
                          >
                            🗓️ Vista Semana
                          </button>
                        </div>

                        {mobileCalendarMode === 'dia' && (
                          <div className="mobile-day-strip">
                            {diasSemana.map((dNom, dIdx) => {
                              const dTemp = new Date(wInfo.mondayDate);
                              dTemp.setUTCDate(dTemp.getUTCDate() + dIdx);
                              const dayNum = dTemp.getUTCDate();
                              const dateStrID = dTemp.toISOString().split('T')[0];
                              const isToday = dateStrID === hoyISO;
                              const isSelected = mobileSelectedDayIdx === dIdx;
                              const iniciales = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
                              const inicial = iniciales[dIdx] || dNom.charAt(0);

                              const col = dIdx + 2;
                              const dayKey = `w${wInfo.weekNum}-c${col}`;
                              const hasEvents = currentView === 'individuales'
                                ? (dayEventsMap[dayKey] && dayEventsMap[dayKey].length > 0)
                                : sgTimeSlotsRaw.some(t => t.toLowerCase().startsWith(dNom.toLowerCase()));

                              return (
                                <button
                                  key={dNom}
                                  type="button"
                                  className={`mobile-day-tab ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}`}
                                  onClick={() => setMobileSelectedDayIdx(dIdx)}
                                >
                                  <span className="mobile-day-letter">{inicial}</span>
                                  <span className="mobile-day-num">{dayNum}</span>
                                  {hasEvents && <span className="mobile-day-dot" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* VISTA MÓVIL DÍA ÚNICO (ESTILO GOOGLE CALENDAR) */}
                      {mobileCalendarMode === 'dia' && (
                        <div className="mobile-single-day-view">
                          {(() => {
                            const selIdx = mobileSelectedDayIdx < diasSemana.length ? mobileSelectedDayIdx : 0;
                            const selDayName = diasSemana[selIdx] || 'Lunes';
                            const selDate = new Date(wInfo.mondayDate);
                            selDate.setUTCDate(selDate.getUTCDate() + selIdx);
                            const selDateStrID = selDate.toISOString().split('T')[0];
                            const selDayNum = selDate.getUTCDate();
                            const selMonthName = MES_NAMES[selDate.getUTCMonth()];
                            const isToday = selDateStrID === hoyISO;

                            if (currentView === 'individuales') {
                              const col = selIdx + 2;
                              const dayKey = `w${wInfo.weekNum}-c${col}`;
                              const events = dayEventsMap[dayKey] || [];

                              return (
                                <div
                                  className="calendar-grid mobile-single-grid"
                                  style={{
                                    gridTemplateColumns: '55px 1fr',
                                    gridTemplateRows: `auto repeat(${mananaSlots.length}, 54px) 20px repeat(${tardeSlots.length}, 54px)`
                                  }}
                                >
                                  <div className="day-header" style={{ gridColumn: 1, gridRow: 1, borderRight: '2px solid #64748b' }}>
                                    Hora
                                  </div>
                                  <div className={`day-header ${isToday ? 'today' : ''}`} style={{ gridColumn: 2, gridRow: 1 }}>
                                    <strong>{selDayName}</strong>
                                    <span>{selDayNum} {selMonthName}</span>
                                  </div>

                                  {timeSlots.map(time => {
                                    const row = timeToRowMap[time];
                                    return (
                                      <React.Fragment key={time}>
                                        <div className="time-label" style={{ gridColumn: 1, gridRow: row }}>
                                          {time}
                                        </div>
                                        <div
                                          className={`grid-bg-cell ${isToday ? 'today-col' : ''}`}
                                          style={{ gridColumn: 2, gridRow: row }}
                                          onDoubleClick={() => handlePrepararModalAgendarSlot(selDateStrID, time, 'Individual')}
                                          title="Doble clic para agendar cita rápida"
                                        />
                                      </React.Fragment>
                                    );
                                  })}

                                  <div className="noon-separator" style={{ gridRow: separatorRow }} />

                                  {events.map((evt, eIdx) => {
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
                                        key={`mobile-evt-${evt.row}-${eIdx}`}
                                        className={`event-card ${extraClass}`}
                                        style={{
                                          gridColumn: 2,
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
                                                color: c.isCompleted ? '#15803d' : c.isPending ? '#dc2626' : 'inherit',
                                                fontWeight: c.isCompleted ? 700 : undefined,
                                                cursor: 'pointer',
                                                textDecoration: 'none',
                                                transition: 'opacity 0.2s'
                                              }}
                                              onClick={(e) => handleOpenSessionMenu(e, c.idSesion)}
                                              title={c.isCompleted ? 'Completada · Clic para opciones' : c.isPending ? 'Pendiente de programar · Clic para opciones' : 'Clic para opciones de sesión y ficha'}
                                            >
                                              {c.nombre}
                                            </span>
                                          </React.Fragment>
                                        ))}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            } else {
                              /* Small Groups single-day */
                              const todaySlots = sgTimeSlotsRaw
                                .filter(t => t.toLowerCase().startsWith(selDayName.toLowerCase()))
                                .map(t => t.split(' ')[1]);

                              return (
                                <div className="mobile-sg-single-day">
                                  <div className={`sg-day-header ${isToday ? 'today' : ''}`} style={{ marginBottom: 10, borderRadius: 8 }}>
                                    <span>{selDayName}</span> <span>{selDayNum} {selMonthName}</span>
                                  </div>

                                  {todaySlots.length === 0 ? (
                                    <div className="sg-slot" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
                                      Sin grupos configurados para este día
                                    </div>
                                  ) : (
                                    todaySlots.map(t => {
                                      const [h, m] = t.split(':');
                                      const nextH = String(parseInt(h, 10) + 1).padStart(2, '0');
                                      const keyHora = t.replace(':', '');
                                      const slotKey = `${selDateStrID}-${keyHora}`;
                                      const sgInfo = sgSlotsMap[slotKey];

                                      return (
                                        <div
                                          key={slotKey}
                                          className="sg-slot"
                                          style={{ marginBottom: 10 }}
                                          onDoubleClick={() => handlePrepararModalAgendarSlot(selDateStrID, t, 'Small Group')}
                                        >
                                          <div className="sg-slot-time">
                                            {t}–{nextH}:{m}
                                          </div>
                                          <div className="sg-slot-clients">
                                            {sgInfo && sgInfo.clientes.length > 0 ? (
                                              <>
                                                {sgInfo.clientes.map((c, cIdx) => (
                                                  <React.Fragment key={c.idSesion}>
                                                    {cIdx > 0 && <br />}
                                                    <span
                                                      data-session-menu-trigger="true"
                                                      style={{
                                                        color: c.isCompleted ? '#15803d' : 'var(--text-main)',
                                                        fontWeight: c.isCompleted ? 700 : 500,
                                                        cursor: 'pointer'
                                                      }}
                                                      onClick={(e) => handleOpenSessionMenu(e, c.idSesion)}
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
                                                      fontSize: '0.78rem',
                                                      fontWeight: 'bold',
                                                      color: 'white',
                                                      background: sgInfo.isPending ? '#dc2626' : 'var(--accent-dark)',
                                                      padding: '6px 0',
                                                      borderRadius: 6,
                                                      textDecoration: 'none'
                                                    }}
                                                  >
                                                    {sgInfo.isPending ? '📋 Programar SG' : '✅ Rutina SG'}
                                                  </a>
                                                </div>
                                              </>
                                            ) : (
                                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Sin clientes</span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              );
                            }
                          })()}
                        </div>
                      )}

                      {currentView === 'individuales' ? (
                        <div
                          className={`calendar-grid ${mobileCalendarMode === 'dia' ? 'hide-on-mobile-dia' : ''}`}
                          style={{
                            gridTemplateColumns: `60px repeat(${numDias}, 1fr)`,
                            gridTemplateRows: `auto repeat(${mananaSlots.length}, 54px) 20px repeat(${tardeSlots.length}, 54px)`
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
                            const dateStrID = dTemp.toISOString().split('T')[0];
                            const isToday = dateStrID === hoyISO;
                            return (
                              <div
                                key={diaName}
                                className={`day-header ${isToday ? 'today' : ''}`}
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
                                  const isToday = dateStrID === hoyISO;

                                  return (
                                    <div
                                      key={`${dateStrID}-${time}`}
                                      className={`grid-bg-cell ${isToday ? 'today-col' : ''}`}
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
                                        color: c.isCompleted ? '#15803d' : c.isPending ? '#dc2626' : 'inherit',
                                        fontWeight: c.isCompleted ? 700 : undefined,
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
                                      title={c.isCompleted ? 'Completada · Clic para opciones' : c.isPending ? 'Pendiente de programar · Clic para opciones' : 'Clic para opciones de sesión y ficha'}
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
                        className={`sg-week-grid ${mobileCalendarMode === 'dia' ? 'hide-on-mobile-dia' : ''}`}
                        style={{ gridTemplateColumns: `repeat(${numDias}, 1fr)` }}
                      >
                        {diasSemana.map((dayNameString, idx) => {
                          const dayTemp = new Date(wInfo.mondayDate);
                          dayTemp.setUTCDate(dayTemp.getUTCDate() + idx);
                          const dayNum = dayTemp.getUTCDate();
                          const monthName = MES_NAMES[dayTemp.getUTCMonth()];
                          const dateStrID = dayTemp.toISOString().split('T')[0];
                          const isToday = dateStrID === hoyISO;

                          const todaySlots = sgTimeSlotsRaw
                            .filter(t => t.toLowerCase().startsWith(dayNameString.toLowerCase()))
                            .map(t => t.split(' ')[1]);

                          return (
                            <div key={dateStrID} className={`sg-day-column ${isToday ? 'today' : ''}`}>
                              <div className={`sg-day-header ${isToday ? 'today' : ''}`}>
                                <span>{dayNameString}</span> <span>{dayNum}{monthName}</span>
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
                                                  style={{
                                                    color: c.isCompleted ? '#15803d' : 'var(--text-main)',
                                                    fontWeight: c.isCompleted ? 700 : 500,
                                                    cursor: 'pointer'
                                                  }}
                                                  onClick={(e) => handleOpenSessionMenu(e, c.idSesion)}
                                                  onMouseOver={(e) => {
                                                    e.currentTarget.style.textDecoration = 'underline';
                                                    e.currentTarget.style.color = 'var(--accent)';
                                                  }}
                                                  onMouseOut={(e) => {
                                                    e.currentTarget.style.textDecoration = 'none';
                                                    e.currentTarget.style.color = c.isCompleted ? '#15803d' : 'var(--text-main)';
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
          });
        })()
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
            {!activeMenu.acciones.sin_fecha && (
              <button
                type="button"
                className="session-action-item"
                onClick={() => handleToggleCompletadaAgenda(activeMenu.idSesion, activeMenu.sFmt)}
              >
                <span>{activeMenu.acciones.estado === 'Completada' ? '⚪' : '🟢'}</span>
                <span>
                  {activeMenu.acciones.estado === 'Completada'
                    ? 'Marcar Como Pendiente'
                    : 'Marcar Como Completada'}
                </span>
              </button>
            )}

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
              <span>Programación</span>
            </button>

            {activeMenu.acciones.puedeReprogramar && (
              <button
                type="button"
                className="session-action-item"
                onClick={() =>
                  handleOpenReprogramar(activeMenu.idSesion, activeMenu.idCliente, activeMenu.nombreCliente)
                }
              >
                <span>📅</span>
                <span>Reprogramar</span>
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
                    activeMenu.sFmt.docData?.intensidad_sesion ||
                      activeMenu.sFmt.docData?.intensidad ||
                      activeMenu.sFmt.docData?.Intensidad ||
                      'MED'
                  );
                  setSendClientId(activeMenu.idCliente || '');
                  setSendSessionId(activeMenu.idSesion || '');
                  setActiveMenu(null);
                  setSendModalOpen(true);
                }}
              >
                <span>➡️</span>
                <span>Enviar Programación</span>
              </button>
            )}

            {activeMenu.acciones.puedeEliminar && (
              <button
                type="button"
                className="session-action-item danger"
                onClick={() =>
                  handleAbrirModalPapeleraAgenda(
                    activeMenu.idSesion,
                    activeMenu.sFmt,
                    activeMenu.acciones
                  )
                }
              >
                <span>🗑️</span>
                <span>Cancelar o Eliminar</span>
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

                    {planTipo === 'Individual' && sesionesPosterioresProgramadas.length > 0 && (
                      <div
                        style={{
                          gridColumn: '1 / -1',
                          background: '#f0fdfa',
                          border: '1px solid #5eead4',
                          borderRadius: 10,
                          padding: '12px 14px',
                          marginTop: 4
                        }}
                      >
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            cursor: 'pointer',
                            margin: 0
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={planCascadaAtras}
                            onChange={e => setPlanCascadaAtras(e.target.checked)}
                            style={{ width: 18, height: 18, marginTop: 2, accentColor: '#0d9488' }}
                          />
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f766e' }}>
                              Hacer cascada hacia atrás de la sesión posterior a esta y siguientes
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#115e59', marginTop: 3, lineHeight: 1.4 }}>
                              Este cliente tiene{' '}
                              <strong>
                                {sesionesPosterioresProgramadas.length}{' '}
                                {sesionesPosterioresProgramadas.length === 1
                                  ? 'sesión programada posterior'
                                  : 'sesiones programadas posteriores'}
                              </strong>
                              . Si marcas esta casilla, esta nueva sesión tomará la rutina de la siguiente sesión posterior, y así sucesivamente hacia atrás.
                            </div>
                          </div>
                        </label>
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

      {/* MODAL REPROGRAMAR SESIÓN UNIFICADO */}
      <ReprogramarSesionModal
        isOpen={reprogModalOpen}
        sessionId={reprogSourceSessionId}
        clientId={reprogIdCliente}
        clientName={reprogNombreCliente}
        onClose={() => setReprogModalOpen(false)}
        onSuccess={loadAgenda}
      />

      {/* SEND ROUTINE MODAL */}
      <SendRoutineModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        ejercicios={sendEjercicios}
        defaultIntensity={sendIntensidad}
        defaultTipoSesion={sendTipoSesion}
        defaultClientId={sendClientId}
        excludeSessionId={sendSessionId}
        onSuccess={loadAgenda}
      />

      {/* MODAL COLISIÓN DE SESIÓN EN EL MISMO DÍA */}
      {colisionMismoDiaModal.open && (
        <div
          className="modal-overlay"
          style={{ display: 'flex', zIndex: 2300 }}
          onClick={() => {
            if (!colisionMismoDiaModal.saving) {
              setColisionMismoDiaModal(prev => ({ ...prev, open: false }));
            }
          }}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 520 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              disabled={colisionMismoDiaModal.saving}
              onClick={() => setColisionMismoDiaModal(prev => ({ ...prev, open: false }))}
            >
              &times;
            </button>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>⚠️ Ya existe una sesión ese día</h2>
              <p>
                <strong>{colisionMismoDiaModal.nombreCliente}</strong> ya tiene una sesión programada el{' '}
                <strong>{colisionMismoDiaModal.fechaLabelStr}</strong> a las{' '}
                <strong>{colisionMismoDiaModal.horaExistenteStr}</strong> (
                {colisionMismoDiaModal.numEjExistente} ejercicio
                {colisionMismoDiaModal.numEjExistente === 1 ? '' : 's'}).
              </p>
              <p style={{ marginTop: 8, fontSize: '0.86rem', color: '#475569' }}>
                No se pueden tener dos sesiones el mismo día. La sesión de ese día se actualizará a la nueva hora elegida (
                <strong>{colisionMismoDiaModal.horaNuevaStr}</strong>). ¿Qué deseas hacer con los ejercicios?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="btn-outline"
                disabled={colisionMismoDiaModal.saving}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  textAlign: 'left',
                  borderColor: '#f59e0b',
                  background: '#fffbeb',
                  color: '#92400e',
                  borderRadius: 10
                }}
                onClick={() => handleEjecutarResolucionColisionMismoDia('MACHACAR')}
              >
                <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>🔄</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                    Actualizar a las {colisionMismoDiaModal.horaNuevaStr} y machacar ejercicios
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#78350f', fontWeight: 400, lineHeight: 1.35 }}>
                    Sustituye los ejercicios que había en ese día ({colisionMismoDiaModal.numEjExistente} ej.) por los de la sesión entrante ({colisionMismoDiaModal.numEjEntrante} ej.) sin desplazar el resto de sesiones.
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="btn-outline"
                disabled={colisionMismoDiaModal.saving}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  textAlign: 'left',
                  borderColor: '#38bdf8',
                  background: '#f0f9ff',
                  color: '#0369a1',
                  borderRadius: 10
                }}
                onClick={() => handleEjecutarResolucionColisionMismoDia('CASCADA_ADELANTE')}
              >
                <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>⏩</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                    Actualizar a las {colisionMismoDiaModal.horaNuevaStr} y realizar cascada hacia delante
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#0c4a6e', fontWeight: 400, lineHeight: 1.35 }}>
                    Coloca aquí los ejercicios de la sesión entrante ({colisionMismoDiaModal.numEjEntrante} ej.) y desplaza la rutina que estaba ese día hacia las siguientes sesiones futuras (ubicando la última en la primera vacía del bloque final o en "Sin fecha").
                  </div>
                </div>
              </button>
            </div>

            <div className="modal-footer" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={colisionMismoDiaModal.saving}
                onClick={() => setColisionMismoDiaModal(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL UBICAR SESIÓN SIN FECHA (CON O SIN CASCADA) */}
      {ubicarSinFechaModal.open && (
        <div
          className="modal-overlay"
          style={{ display: 'flex', zIndex: 2350 }}
          onClick={() => {
            if (!ubicarSinFechaModal.saving) {
              setUbicarSinFechaModal(prev => ({ ...prev, open: false }));
            }
          }}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 520 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              disabled={ubicarSinFechaModal.saving}
              onClick={() => setUbicarSinFechaModal(prev => ({ ...prev, open: false }))}
            >
              &times;
            </button>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>
                {ubicarSinFechaModal.esSinFecha
                  ? '📌 Ubicar sesión sin fecha'
                  : '📅 Reprogramar sesión a nueva fecha'}
              </h2>
              <p>
                Vas a ubicar la sesión de <strong>{ubicarSinFechaModal.nombreCliente}</strong> (
                {ubicarSinFechaModal.numEjercicios} ejercicio
                {ubicarSinFechaModal.numEjercicios === 1 ? '' : 's'}) el{' '}
                <strong>{ubicarSinFechaModal.fechaLabelStr}</strong> a las{' '}
                <strong>{ubicarSinFechaModal.horaStr}</strong>.
              </p>
              <p style={{ marginTop: 8, fontSize: '0.86rem', color: '#475569' }}>
                ¿Quieres ubicar esta programación directamente en esa fecha sin mover nada, o realizar cascada?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="btn-outline"
                disabled={ubicarSinFechaModal.saving}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  textAlign: 'left',
                  borderColor: '#10b981',
                  background: '#ecfdf5',
                  color: '#065f46',
                  borderRadius: 10
                }}
                onClick={() => handleEjecutarUbicacionSinFecha(false)}
              >
                <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>📍</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                    Ubicar directamente sin cascada (sin mover nada)
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#047857', fontWeight: 400, lineHeight: 1.35 }}>
                    Coloca esta sesión y su programación ({ubicarSinFechaModal.numEjercicios} ej.) directamente el {ubicarSinFechaModal.fechaLabelStr} a las {ubicarSinFechaModal.horaStr} sin desplazar ninguna otra sesión.
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="btn-outline"
                disabled={ubicarSinFechaModal.saving}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  textAlign: 'left',
                  borderColor: '#38bdf8',
                  background: '#f0f9ff',
                  color: '#0369a1',
                  borderRadius: 10
                }}
                onClick={() => handleEjecutarUbicacionSinFecha(true)}
              >
                <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>🔄</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                    Ubicar con cascada
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#0c4a6e', fontWeight: 400, lineHeight: 1.35 }}>
                    {ubicarSinFechaModal.esSinFecha
                      ? 'Inserta este hueco, adelanta las programaciones posteriores en cascada y ubica esta rutina al final (en la última sesión programada o primera vacía del bloque final).'
                      : 'Mueve la sesión a la nueva fecha y reordena las rutinas en cascada manteniendo su orden cronológico.'}
                  </div>
                </div>
              </button>
            </div>

            <div className="modal-footer" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={ubicarSinFechaModal.saving}
                onClick={() => setUbicarSinFechaModal(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL OPCIONES PAPELERA (ELIMINAR O ENVIAR A SIN FECHA - IDÉNTICO A FICHA CLIENTE) */}
      {papeleraSesionModal.open && (
        <div
          className="modal-overlay"
          style={{ display: 'flex', zIndex: 2350 }}
          onClick={() => setPapeleraSesionModal(prev => ({ ...prev, open: false }))}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 460 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setPapeleraSesionModal(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>🗑️ Opciones de sesión</h2>
              <p>
                Sesión del <strong>{papeleraSesionModal.fechaStr}</strong> a las{' '}
                <strong>{papeleraSesionModal.horaStr}</strong>. ¿Qué acción deseas realizar?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {papeleraSesionModal.puedeEnviarSinFecha && (
                <button
                  type="button"
                  className="btn-outline"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '14px 16px',
                    textAlign: 'left',
                    borderColor: '#f59e0b',
                    background: '#fffbeb',
                    color: '#92400e',
                    borderRadius: 10
                  }}
                  onClick={async () => {
                    const { idSesion, sFmt } = papeleraSesionModal;
                    setPapeleraSesionModal(prev => ({ ...prev, open: false }));
                    await handleCancelarSinFecha(idSesion, sFmt);
                  }}
                >
                  <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>📌</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                      Enviar a sin fecha (Cancelar sesión)
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#78350f', fontWeight: 400, lineHeight: 1.35 }}>
                      Libera el hueco en la agenda, desplaza las rutinas en cascada y ubica la última en la primera sesión vacía del bloque final (o en "Sesiones programadas sin fecha").
                    </div>
                  </div>
                </button>
              )}

              <button
                type="button"
                className="btn-outline"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  textAlign: 'left',
                  borderColor: '#fca5a5',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  borderRadius: 10
                }}
                onClick={async () => {
                  const { idSesion, sFmt } = papeleraSesionModal;
                  setPapeleraSesionModal(prev => ({ ...prev, open: false }));
                  await handleEliminarSesion(idSesion, sFmt);
                }}
              >
                <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>🗑️</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                    Eliminar sesión definitivamente
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#991b1b', fontWeight: 400, lineHeight: 1.35 }}>
                    Borra por completo esta sesión de la agenda sin desplazar las demás sesiones.
                  </div>
                </div>
              </button>
            </div>

            <div className="modal-footer" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn-outline"
                onClick={() => setPapeleraSesionModal(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
