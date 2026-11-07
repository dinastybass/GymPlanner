import React, { useState, useEffect, useCallback } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  deleteDoc,
  addDoc,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useUndo } from '../context/UndoContext';
import {
  cargarCatalogoMaestros,
  extraerListaMaster,
  getListaProgramadores,
  obtenerFechaLimiteReprogramacionUTC
} from '../services/maestrosService';
import { normalizarIntensidad, renderIntensityBadge, esSesionCompletada, esSesionCancelada } from '../utils/helpers';
import { confirmarDialogo } from '../utils/confirmDialog';
import { SendRoutineModal } from '../components/SendRoutineModal';
import {
  cancelarSesionConCascadaAdelante,
  asignarFechaASesionSinFechaConCascadaAtras,
  reprogramarSesionConFechaOrdenCronologico,
  revertirVencimientosAutomaticos,
  procesarCaducidadSesionesSinFechaPorMeses,
  obtenerFechaOrigenSesionSinFecha,
  limpiarSesionesAntiguasYEjerciciosHuerfanos,
  MovimientoLogCliente
} from '../services/sessionCascadeService';

interface FichaClienteViewProps {
  clientId: string;
  onNavigate: (tab: string, param?: string) => void;
}

const mesesNombres = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];
const diasSemanaCortos = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const clonarProfundo = (obj: any) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

export const FichaClienteView: React.FC<FichaClienteViewProps> = ({ clientId, onNavigate }) => {
  const { userName } = useAuth();
  const { pushAction, registerChangeListener } = useUndo();

  const [clienteActual, setClienteActual] = useState<any>(null);
  const [sesionesCliente, setSesionesCliente] = useState<any[]>([]);
  const [catalogoProgreso, setCatalogoProgreso] = useState<any[]>([]);
  const [registrosPR, setRegistrosPR] = useState<any[]>([]);
  const [todosLosClientes, setTodosLosClientes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [ordenBloques, setOrdenBloques] = useState<string[]>([
    'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
    'BLOQUE 2: FUERZA - PRINCIPAL',
    'BLOQUE 3: COMPENSATORIO - ACCESORIO',
    'BLOQUE 4: METABÓLICO - ACONDICIONAMIENTO'
  ]);
  const [tiposClienteList, setTiposClienteList] = useState<string[]>([
    'Individual', 'Small Group', 'Individual + SG'
  ]);
  const [estadosClienteList, setEstadosClienteList] = useState<string[]>([
    'Activo', 'Pausa', 'Baja'
  ]);
  const [programadoresList, setProgramadoresList] = useState<string[]>(['Javi', 'Carlos']);
  const [reprogHorariosInd, setReprogHorariosInd] = useState<string[]>([
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'
  ]);
  const [reprogHorariosSG, setReprogHorariosSG] = useState<string[]>([
    '08:00', '09:00', '10:00', '16:00', '18:00', '19:00'
  ]);
  const [mesesMargenReprog, setMesesMargenReprog] = useState<number>(1);

  // Main view tabs
  const [mainView, setMainView] = useState<'sesiones' | 'progreso' | 'movimientos'>('sesiones');
  const [filtroActual, setFiltroActual] = useState<'Todas' | 'Completada' | 'Pendiente' | 'Vencida'>('Todas');

  // Expanded session rows & month accordions
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [openSinFecha, setOpenSinFecha] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  // Inline PR inputs
  const [inlinePRValues, setInlinePRValues] = useState<Record<string, string>>({});

  // Modal Editar Cliente
  const [modalEditOpen, setModalEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    nombre: '',
    alias: '',
    estado: 'Activo',
    tipo: 'Individual',
    programador: '',
    kidsActivo: 'NO',
    kidsNum: '0',
    kidsNombres: '',
    objGlobal: '',
    objEsp: '',
    obsPost: '',
    lesiones: '',
    vaf: ''
  });

  // Modal Historial PR
  const [modalHistorialPR, setModalHistorialPR] = useState<{
    open: boolean;
    idEj: string;
    nomEj: string;
    nuevoPeso: string;
    saving: boolean;
  }>({
    open: false,
    idEj: '',
    nomEj: '',
    nuevoPeso: '',
    saving: false
  });

  // Modal Enviar Rutina Reutilizable
  const [sendRoutineData, setSendRoutineData] = useState<{
    open: boolean;
    originSessionId: string;
    ejercicios: any[];
    intensity: 'LOW' | 'MED' | 'HIGH';
    tipoSesion: string;
  }>({
    open: false,
    originSessionId: '',
    ejercicios: [],
    intensity: 'MED',
    tipoSesion: 'Individual'
  });


  // Modal Opciones Papelera (Eliminar definitivamente vs Enviar a sin fecha)
  const [modalPapeleraSesion, setModalPapeleraSesion] = useState<{
    open: boolean;
    idSesion: string;
    fechaStr: string;
    horaStr: string;
    puedeEnviarSinFecha: boolean;
  }>({
    open: false,
    idSesion: '',
    fechaStr: '',
    horaStr: '',
    puedeEnviarSinFecha: true
  });

  // Modal Reprogramar con Calendario Semanal
  const [modalReprog, setModalReprog] = useState<{
    open: boolean;
    idSesion: string;
    weekStart: Date;
    step: 1 | 2;
    selectedCell: { y: number; m: number; d: number; timeStr: string } | null;
    weekSessions: any[];
    loadingWeek: boolean;
    saving: boolean;
  }>({
    open: false,
    idSesion: '',
    weekStart: new Date(),
    step: 1,
    selectedCell: null,
    weekSessions: [],
    loadingWeek: false,
    saving: false
  });

  const cargarTodo = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const maestros = await cargarCatalogoMaestros();
      const bloques = extraerListaMaster(maestros, 'Ejercicios', [
        'Bloque de la sesión en que se recomienda',
        'Bloque de recomendación'
      ]);
      if (bloques.length > 0) setOrdenBloques(bloques);

      const tipos = extraerListaMaster(maestros, 'Clientes', ['Tipo de Cliente', 'Tipo de cliente']);
      if (tipos.length > 0) setTiposClienteList(tipos);

      const estados = extraerListaMaster(maestros, 'Clientes', ['Estado Cliente', 'Estado cliente']);
      if (estados.length > 0) setEstadosClienteList(estados);

      const progs = await getListaProgramadores();
      if (progs.length > 0) setProgramadoresList(progs);

      const hInd = extraerListaMaster(maestros, 'Agenda', ['Horarios Sesiones Individuales']);
      if (hInd.length > 0) setReprogHorariosInd(hInd);

      const hSG = extraerListaMaster(maestros, 'Agenda', ['Horarios Small Group']);
      if (hSG.length > 0) setReprogHorariosSG(hSG);

      const margenArr = extraerListaMaster(maestros, 'Agenda', ['Meses de margen para reprogramar']);
      if (margenArr.length > 0) {
        const parsed = parseInt(String(margenArr[0]).trim(), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          setMesesMargenReprog(parsed);
        }
      }
    } catch (e) {
      console.warn('Error cargando maestros en ficha_cliente:', e);
    }

    try {
      await revertirVencimientosAutomaticos();
      await limpiarSesionesAntiguasYEjerciciosHuerfanos();
      await procesarCaducidadSesionesSinFechaPorMeses(clientId);

      const [docSnap, sesSnap, catSnap, prSnap, allCliSnap] = await Promise.all([
        getDoc(doc(db, 'clientes', clientId)),
        getDocs(query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', clientId))),
        getDocs(query(collection(db, 'ejercicios'), where('es_de_progreso', '==', true))),
        getDocs(query(collection(db, 'progreso_clientes'), where('id_cliente', '==', clientId))),
        getDocs(collection(db, 'clientes'))
      ]);

      let cliData: any = null;
      let altClientId = '';
      if (docSnap.exists()) {
        cliData = docSnap.data();
        if (cliData.ID_Cliente && String(cliData.ID_Cliente).trim() !== '' && cliData.ID_Cliente !== clientId) {
          altClientId = String(cliData.ID_Cliente).trim();
        }
      } else {
        allCliSnap.forEach(d => {
          const c = d.data();
          if (c.ID_Cliente === clientId) {
            cliData = c;
            altClientId = d.id;
          }
        });
      }
      setClienteActual(cliData);

      const sesDocsMap = new Map<string, any>();
      sesSnap.forEach(d => sesDocsMap.set(d.id, d));
      if (altClientId) {
        const altSesSnap = await getDocs(
          query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', altClientId))
        );
        altSesSnap.forEach(d => sesDocsMap.set(d.id, d));
      }

      const nowLocal = new Date();
      const startOfTodayUTC = new Date(
        Date.UTC(
          nowLocal.getFullYear(),
          nowLocal.getMonth(),
          nowLocal.getDate(),
          0,
          0,
          0,
          0
        )
      );

      const sesList: any[] = [];
      sesDocsMap.forEach(d => {
        const data = d.data();
        const esSinFecha = Boolean(data.sin_fecha === true || !data.fecha_hora_inicio);

        if (esSinFecha) {
          const fechaOrigen = obtenerFechaOrigenSesionSinFecha(data) || new Date(0);
          sesList.push({
            id: d.id,
            ...data,
            sin_fecha: true,
            fechaObj: null,
            fechaOrdenSinFecha: fechaOrigen,
            estadoCalculado: 'SinFecha'
          });
          return;
        }

        const fechaObj = data.fecha_hora_inicio.toDate
          ? data.fecha_hora_inicio.toDate()
          : new Date(data.fecha_hora_inicio);

        const isComp = esSesionCompletada(data);
        if (isComp && (data.estado !== 'Completada' || data.estado_sesion !== 'Completada')) {
          data.estado = 'Completada';
          data.estado_sesion = 'Completada';
          updateDoc(doc(db, 'agenda_sesiones', d.id), {
            estado: 'Completada',
            estado_sesion: 'Completada'
          }).catch(() => {});
        }

        let estadoCalc = 'Pendiente';
        if (isComp) {
          estadoCalc = 'Completada';
        } else if (fechaObj < startOfTodayUTC) {
          estadoCalc = 'Vencida';
        }

        sesList.push({
          id: d.id,
          ...data,
          sin_fecha: false,
          fechaObj,
          estadoCalculado: estadoCalc
        });
      });

      sesList.sort((a, b) => {
        if (a.sin_fecha && b.sin_fecha) {
          return (b.fechaOrdenSinFecha?.getTime() || 0) - (a.fechaOrdenSinFecha?.getTime() || 0);
        }
        if (a.sin_fecha) return -1;
        if (b.sin_fecha) return 1;
        return a.fechaObj.getTime() - b.fechaObj.getTime();
      });

      setSesionesCliente(sesList);

      // Initialize auto-open months (prev, current, next)
      const curY = nowLocal.getFullYear();
      const curM = nowLocal.getMonth();
      const prevDate = new Date(curY, curM - 1, 1);
      const nextDate = new Date(curY, curM + 1, 1);
      const mesesAbiertos = [
        `${mesesNombres[prevDate.getMonth()]} ${prevDate.getFullYear()}`,
        `${mesesNombres[curM]} ${curY}`,
        `${mesesNombres[nextDate.getMonth()]} ${nextDate.getFullYear()}`
      ];
      const initialOpenMonths: Record<string, boolean> = {};
      mesesAbiertos.forEach(m => {
        initialOpenMonths[m] = true;
      });
      setOpenMonths(prev => ({ ...initialOpenMonths, ...prev }));

      const catList: any[] = [];
      catSnap.forEach(d => catList.push({ id: d.id, ...d.data() }));
      catList.sort((a, b) => (a.Nombre_Ejercicio || '').localeCompare(b.Nombre_Ejercicio || ''));
      setCatalogoProgreso(catList);

      const prList: any[] = [];
      prSnap.forEach(d => {
        const data = d.data();
        const fechaObj = data.fecha
          ? data.fecha.toDate
            ? data.fecha.toDate()
            : new Date(data.fecha)
          : new Date(0);
        prList.push({ id: d.id, ...data, fechaObj });
      });
      prList.sort((a, b) => b.fechaObj.getTime() - a.fechaObj.getTime());
      setRegistrosPR(prList);

      const allClis: any[] = [];
      allCliSnap.forEach(d => {
        const data = d.data();
        const est = (data.Estado_Cliente || data.estado || 'Activo').toLowerCase();
        if (!est.includes('baja') && !est.includes('inactivo')) {
          const nom = data.Alias || data.alias || data.Nombre_Cliente || data.nombre_completo || 'Sin nombre';
          allClis.push({ id: d.id, nombre: nom });
        }
      });
      allClis.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setTodosLosClientes(allClis);
    } catch (e) {
      console.error('Error cargando ficha de cliente:', e);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    cargarTodo();
  }, [cargarTodo]);

  useEffect(() => {
    return registerChangeListener(() => {
      cargarTodo();
    });
  }, [registerChangeListener, cargarTodo]);

  // --- Edit Client Modal ---
  const abrirModalEditar = () => {
    if (!clienteActual) return;
    const c = clienteActual;
    let est = c.Estado_Cliente || c.estado || estadosClienteList[0] || 'Activo';
    if (String(est).toLowerCase().includes('pausa')) est = 'Pausa';
    if (String(est).toLowerCase().includes('baja')) est = 'Baja';
    if (!estadosClienteList.includes(est)) est = estadosClienteList[0] || 'Activo';

    const kidsRaw = c.Usa_Kids || c.kids_activo || 'NO';
    const isKids = String(kidsRaw).toUpperCase() === 'SI' || kidsRaw === true;

    setEditForm({
      nombre: c.Nombre_Cliente || c.nombre_completo || '',
      alias: c.Alias || c.alias || '',
      estado: est,
      tipo: c.Tipo_Cliente || c.tipo_cliente || tiposClienteList[0] || 'Individual',
      programador: c.Programador || c.programador || '',
      kidsActivo: isKids ? 'SI' : 'NO',
      kidsNum: String(c['Nº_Niños_Kids'] ?? c.kids_contratados ?? 0),
      kidsNombres: c.Nombres_Niños_Kids || c.kids_registrados || '',
      objGlobal: c.Objetivo_Global || c.objetivo_global || '',
      objEsp: c.Objetivo_Especifico || c.objetivo_especifico || '',
      obsPost: c.Observaciones_Posteriores || c.observaciones_posteriores || '',
      lesiones: c.Lesiones_Historial || c.lesiones || '',
      vaf: c.Observaciones_VAF || c.vaf || ''
    });
    setModalEditOpen(true);
  };

  const guardarEdicionCliente = async () => {
    if (!clientId || !clienteActual) return;
    setSavingEdit(true);
    try {
      const prevClientSnapshot = clonarProfundo(clienteActual);
      const updatedFields = {
        Nombre_Cliente: editForm.nombre.trim(),
        Alias: editForm.alias.trim(),
        Estado_Cliente: editForm.estado,
        Tipo_Cliente: editForm.tipo,
        Programador: editForm.programador,
        Usa_Kids: editForm.kidsActivo,
        'Nº_Niños_Kids': editForm.kidsActivo === 'SI' ? parseInt(editForm.kidsNum, 10) || 0 : 0,
        Nombres_Niños_Kids: editForm.kidsActivo === 'SI' ? editForm.kidsNombres.trim() : '',
        Objetivo_Global: editForm.objGlobal.trim(),
        Objetivo_Especifico: editForm.objEsp.trim(),
        Observaciones_Posteriores: editForm.obsPost.trim(),
        Lesiones_Historial: editForm.lesiones.trim(),
        Observaciones_VAF: editForm.vaf.trim()
      };

      await updateDoc(doc(db, 'clientes', clientId), updatedFields);
      const nextSnapshot = { ...prevClientSnapshot, ...updatedFields };
      setClienteActual(nextSnapshot);

      pushAction({
        label: `Editar ficha de "${updatedFields.Alias || updatedFields.Nombre_Cliente}"`,
        undoOps: [{ type: 'set', collection: 'clientes', id: clientId, data: prevClientSnapshot }],
        redoOps: [{ type: 'set', collection: 'clientes', id: clientId, data: nextSnapshot }],
        showToast: true,
        toastMessage: `✓ Ficha de "${updatedFields.Alias || updatedFields.Nombre_Cliente}" actualizada`
      });

      setModalEditOpen(false);
    } catch (e) {
      console.error('Error guardando edición de cliente:', e);
      alert('Error al guardar los cambios.');
    } finally {
      setSavingEdit(false);
    }
  };

  // --- Session Actions ---
  const crearNuevaSesionSinFecha = async () => {
    if (!clientId) return;
    try {
      const nomCli =
        clienteActual?.Alias ||
        clienteActual?.alias ||
        clienteActual?.Nombre_Cliente ||
        clienteActual?.nombre_completo ||
        'Cliente';
      const ahora = new Date();
      const payload = {
        id_cliente: clientId,
        cliente_nombre: nomCli,
        tipo_sesion: 'Sesión Individual',
        sin_fecha: true,
        fecha_hora_inicio: null,
        fecha_creacion_sin_fecha: ahora,
        estado: 'Pendiente',
        estado_sesion: 'Pendiente',
        ejercicios: [],
        intensidad_sesion: 'MED',
        ultimo_editor: userName || 'Entrenador',
        fecha_ultima_edicion: ahora
      };
      const docRef = await addDoc(collection(db, 'agenda_sesiones'), payload);
      pushAction({
        label: `Crear sesión sin fecha para ${nomCli}`,
        undoOps: [{ type: 'delete', collection: 'agenda_sesiones', id: docRef.id }],
        redoOps: [{ type: 'set', collection: 'agenda_sesiones', id: docRef.id, data: payload }],
        showToast: false
      });
      onNavigate('programar_sesion', docRef.id);
    } catch (e) {
      console.error('Error al crear sesión sin fecha:', e);
      alert('Error al crear la sesión sin fecha.');
    }
  };

  const cancelarSesionConCascada = async (idSesion: string) => {
    const sesion = sesionesCliente.find(s => s.id === idSesion);
    if (!sesion || sesion.sin_fecha) return;

    const msg =
      '¿Cancelar esta sesión?\n\n' +
      '• Se liberará este hueco del calendario.\n' +
      '• Su programación se desplazará en cascada al siguiente día programado.\n' +
      '• La programación de la última sesión pasará a la bolsa de "Sesiones programadas sin fecha".';

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
      const res = await cancelarSesionConCascadaAdelante({
        idSesion,
        esAutomatico: false,
        usuario: userName || 'Entrenador'
      });

      if (res) {
        pushAction({
          label: 'Cancelar sesión (cascada hacia delante)',
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }

      await cargarTodo();
    } catch (e) {
      console.error('Error al cancelar sesión en cascada:', e);
      alert('Error al cancelar la sesión.');
    }
  };

  const toggleEstadoCompletada = async (sesion: any) => {
    if (!sesion || sesion.sin_fecha) return;
    const isCompleted = esSesionCompletada(sesion) || sesion.estadoCalculado === 'Completada';
    const nextStatus = isCompleted ? 'Pendiente' : 'Completada';
    const prevStatus = isCompleted ? 'Completada' : 'Pendiente';
    const nextManual = nextStatus === 'Pendiente';

    try {
      await updateDoc(doc(db, 'agenda_sesiones', sesion.id), {
        estado: nextStatus,
        estado_sesion: nextStatus,
        pendiente_manual: nextManual
      });

      const nowLocal = new Date();
      const startOfTodayUTC = new Date(
        Date.UTC(
          nowLocal.getFullYear(),
          nowLocal.getMonth(),
          nowLocal.getDate(),
          0,
          0,
          0,
          0
        )
      );

      setSesionesCliente(prev =>
        prev.map(s => {
          if (s.id !== sesion.id) return s;
          let nuevoCalc = 'Pendiente';
          if (nextStatus === 'Completada') {
            nuevoCalc = 'Completada';
          } else if (s.fechaObj && s.fechaObj < startOfTodayUTC) {
            nuevoCalc = 'Vencida';
          }
          return {
            ...s,
            estado: nextStatus,
            estado_sesion: nextStatus,
            pendiente_manual: nextManual,
            estadoCalculado: nuevoCalc
          };
        })
      );

      pushAction({
        label: `Marcar sesión como ${nextStatus}`,
        undoOps: [
          {
            type: 'update',
            collection: 'agenda_sesiones',
            id: sesion.id,
            data: { estado: prevStatus, estado_sesion: prevStatus, pendiente_manual: !nextManual }
          }
        ],
        redoOps: [
          {
            type: 'update',
            collection: 'agenda_sesiones',
            id: sesion.id,
            data: { estado: nextStatus, estado_sesion: nextStatus, pendiente_manual: nextManual }
          }
        ],
        showToast: true,
        toastMessage:
          nextStatus === 'Completada'
            ? '🟢 Sesión marcada como Completada'
            : '⚪ Sesión marcada como Pendiente'
      });
    } catch (e) {
      console.error('Error cambiando estado de sesión:', e);
      alert('No se pudo actualizar el estado de la sesión.');
    }
  };

  const borrarSesion = async (idSesion: string) => {
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

    const sesionPrevia = sesionesCliente.find(s => s.id === idSesion);
    const prevRaw = sesionPrevia ? clonarProfundo(sesionPrevia) : null;
    if (prevRaw) {
      delete prevRaw.id;
      delete prevRaw.fechaObj;
      delete prevRaw.estadoCalculado;
      delete prevRaw.fechaOrdenSinFecha;
    }

    try {
      await deleteDoc(doc(db, 'agenda_sesiones', idSesion));
      setSesionesCliente(prev => prev.filter(s => s.id !== idSesion));

      if (prevRaw) {
        pushAction({
          label: 'Eliminar sesión de agenda',
          undoOps: [{ type: 'set', collection: 'agenda_sesiones', id: idSesion, data: prevRaw }],
          redoOps: [{ type: 'delete', collection: 'agenda_sesiones', id: idSesion }],
          showToast: true,
          toastMessage: '🗑️ Sesión eliminada'
        });
      }
    } catch (e) {
      console.error(e);
      alert('Error al eliminar la sesión.');
    }
  };

  // --- Modal Enviar Rutina Reutilizable ---
  const abrirModalEnviar = (idSesionOrigen: string) => {
    const sesion = sesionesCliente.find(s => s.id === idSesionOrigen);
    if (!sesion || !sesion.ejercicios || sesion.ejercicios.length === 0) {
      alert('Esta sesión no tiene ejercicios para enviar.');
      return;
    }
    const intNorm = normalizarIntensidad(sesion.intensidad_sesion || sesion.intensidad || 'MED') as 'LOW' | 'MED' | 'HIGH';
    setSendRoutineData({
      open: true,
      originSessionId: idSesionOrigen,
      ejercicios: sesion.ejercicios,
      intensity: intNorm || 'MED',
      tipoSesion: sesion.tipo_sesion || 'Individual'
    });
  };


  const abrirModalPapeleraSesion = (
    idSesion: string,
    fechaStr: string,
    horaStr: string,
    puedeEnviarSinFecha: boolean
  ) => {
    setModalPapeleraSesion({
      open: true,
      idSesion,
      fechaStr,
      horaStr,
      puedeEnviarSinFecha
    });
  };

  // --- Modal Reprogramar ---
  const getMondayUTC = (d: Date) => {
    const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
    const day = copy.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    copy.setUTCDate(copy.getUTCDate() + diff);
    return copy;
  };

  const cargarSemanaReprog = async (monday: Date) => {
    setModalReprog(prev => ({ ...prev, loadingWeek: true }));
    try {
      const startUTC = new Date(monday);
      const endUTC = new Date(monday);
      endUTC.setUTCDate(endUTC.getUTCDate() + 5);
      endUTC.setUTCHours(23, 59, 59, 999);

      const q = query(
        collection(db, 'agenda_sesiones'),
        where('fecha_hora_inicio', '>=', startUTC),
        where('fecha_hora_inicio', '<=', endUTC)
      );
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (!data.fecha_hora_inicio || esSesionCancelada(data)) return;
        const f = data.fecha_hora_inicio.toDate
          ? data.fecha_hora_inicio.toDate()
          : new Date(data.fecha_hora_inicio);
        list.push({ id: d.id, ...data, fecha: f });
      });
      setModalReprog(prev => ({ ...prev, weekSessions: list, loadingWeek: false }));
    } catch (e) {
      console.error(e);
      setModalReprog(prev => ({ ...prev, loadingWeek: false }));
    }
  };

  const abrirModalReprogramar = (idSesion: string) => {
    const sesion = sesionesCliente.find(s => s.id === idSesion);
    if (!sesion) return;
    let baseDate = sesion.fechaObj;
    if (!baseDate || isNaN(baseDate.getTime())) {
      const now = new Date();
      baseDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0));
    }
    const monday = getMondayUTC(baseDate);
    setModalReprog({
      open: true,
      idSesion,
      weekStart: monday,
      step: 1,
      selectedCell: null,
      weekSessions: [],
      loadingWeek: true,
      saving: false
    });
    cargarSemanaReprog(monday);
  };

  const cambiarSemanaReprog = (deltaWeeks: number) => {
    const nextMonday = new Date(modalReprog.weekStart);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + deltaWeeks * 7);
    setModalReprog(prev => ({ ...prev, weekStart: nextMonday, step: 1, selectedCell: null }));
    cargarSemanaReprog(nextMonday);
  };

  const seleccionarCeldaReprog = async (y: number, m: number, d: number, timeStr: string) => {
    const sesion = sesionesCliente.find(s => s.id === modalReprog.idSesion);
    if (!sesion || modalReprog.saving) return;

    const [hh, mm] = timeStr.split(':').map(Number);
    const nuevaFechaUTC = new Date(Date.UTC(y, m, d, hh, mm, 0));

    const sesionExistenteMismoDia = sesionesCliente.find(s => {
      if (s.sin_fecha || !s.fechaObj || s.id === sesion.id) return false;
      return (
        s.fechaObj.getUTCFullYear() === y &&
        s.fechaObj.getUTCMonth() === m &&
        s.fechaObj.getUTCDate() === d
      );
    });

    if (sesionExistenteMismoDia && esSesionCompletada(sesionExistenteMismoDia)) {
      alert('Operación bloqueada: No puedes reprogramar una sesión en un día que ya tiene una sesión completada.');
      return;
    }

    setModalReprog(prev => ({ ...prev, saving: true }));
    const editorActual = userName || 'Entrenador';

    try {
      if (sesion.sin_fecha) {
        const res = await asignarFechaASesionSinFechaConCascadaAtras({
          idSesionSinFecha: sesion.id,
          nuevaFechaUTC,
          idHuecoExistente: sesionExistenteMismoDia?.id,
          usuario: editorActual
        });

        if (res) {
          pushAction({
            label: 'Asignar fecha a sesión sin fecha (cascada hacia atrás)',
            undoOps: res.undoOps,
            redoOps: res.redoOps,
            showToast: true,
            toastMessage: res.toastMessage
          });
        }
      } else {
        const res = await reprogramarSesionConFechaOrdenCronologico({
          idSesion: sesion.id,
          nuevaFechaUTC,
          usuario: editorActual
        });

        if (res) {
          pushAction({
            label: 'Reprogramar sesión',
            undoOps: res.undoOps,
            redoOps: res.redoOps,
            showToast: true,
            toastMessage: res.toastMessage
          });
        }
      }

      setModalReprog(prev => ({ ...prev, open: false, saving: false }));
      await cargarTodo();
    } catch (e) {
      console.error('Error al reprogramar sesión:', e);
      alert('Hubo un error al reprogramar la sesión.');
      setModalReprog(prev => ({ ...prev, saving: false }));
    }
  };

  // --- Progreso (PRs) ---
  const guardarPRInline = async (idEj: string, nomEj: string) => {
    const valStr = inlinePRValues[idEj] || '';
    const val = parseFloat(valStr);
    if (isNaN(val) || val <= 0) {
      alert('Por favor, introduce un peso válido mayor que 0.');
      return;
    }
    try {
      const prPayload = {
        id_cliente: clientId,
        id_ejercicio: idEj,
        nombre_ejercicio: nomEj,
        peso_levantado: val,
        fecha: new Date()
      };
      const docRef = await addDoc(collection(db, 'progreso_clientes'), prPayload);
      pushAction({
        label: `Registrar PR ${val} kg en ${nomEj}`,
        undoOps: [{ type: 'delete', collection: 'progreso_clientes', id: docRef.id }],
        redoOps: [{ type: 'set', collection: 'progreso_clientes', id: docRef.id, data: prPayload }],
        showToast: true,
        toastMessage: `🏆 PR registrado: ${val} kg (${nomEj})`
      });
      await cargarTodo();
    } catch (e) {
      console.error(e);
      alert('Error al guardar el récord.');
    }
  };

  const guardarNuevoPRDesdeModal = async () => {
    const val = parseFloat(modalHistorialPR.nuevoPeso);
    if (isNaN(val) || val <= 0) {
      alert('Introduce un peso válido.');
      return;
    }
    setModalHistorialPR(prev => ({ ...prev, saving: true }));
    try {
      const prPayload = {
        id_cliente: clientId,
        id_ejercicio: modalHistorialPR.idEj,
        nombre_ejercicio: modalHistorialPR.nomEj,
        peso_levantado: val,
        fecha: new Date()
      };
      const docRef = await addDoc(collection(db, 'progreso_clientes'), prPayload);
      pushAction({
        label: `Registrar PR ${val} kg en ${modalHistorialPR.nomEj}`,
        undoOps: [{ type: 'delete', collection: 'progreso_clientes', id: docRef.id }],
        redoOps: [{ type: 'set', collection: 'progreso_clientes', id: docRef.id, data: prPayload }],
        showToast: true,
        toastMessage: `🏆 PR registrado: ${val} kg (${modalHistorialPR.nomEj})`
      });
      setModalHistorialPR(prev => ({ ...prev, nuevoPeso: '', saving: false }));
      await cargarTodo();
    } catch (e) {
      console.error(e);
      alert('Error al guardar.');
      setModalHistorialPR(prev => ({ ...prev, saving: false }));
    }
  };

  const borrarRegistroPR = async (idReg: string) => {
    if (
      !(await confirmarDialogo(
        '¿Seguro que deseas eliminar este registro de peso?\n\nPodrás deshacerlo con Ctrl+Z.',
        {
          titulo: 'Eliminar registro PR',
          textoConfirmar: 'Sí, eliminar',
          danger: true
        }
      ))
    ) {
      return;
    }
    const regPrevio = registrosPR.find(r => r.id === idReg);
    const prevRaw = regPrevio ? clonarProfundo(regPrevio) : null;
    if (prevRaw) {
      delete prevRaw.id;
      delete prevRaw.fechaObj;
    }
    try {
      await deleteDoc(doc(db, 'progreso_clientes', idReg));
      if (prevRaw) {
        pushAction({
          label: `Eliminar registro PR (${prevRaw.peso_levantado} kg)`,
          undoOps: [{ type: 'set', collection: 'progreso_clientes', id: idReg, data: prevRaw }],
          redoOps: [{ type: 'delete', collection: 'progreso_clientes', id: idReg }],
          showToast: true,
          toastMessage: '🗑️ Registro PR eliminado'
        });
      }
      await cargarTodo();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
        Cargando ficha del cliente...
      </div>
    );
  }

  if (!clienteActual) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50 }}>
        <h2>Cliente no encontrado</h2>
        <button type="button" className="btn-primary" onClick={() => onNavigate('clientes')}>
          Volver a Clientes
        </button>
      </div>
    );
  }

  const nom = clienteActual.Nombre_Cliente || clienteActual.nombre_completo || 'Sin nombre';
  const alias = clienteActual.Alias || clienteActual.alias || '';
  const estRaw = clienteActual.Estado_Cliente || clienteActual.estado || 'Activo';
  const tipo = clienteActual.Tipo_Cliente || clienteActual.tipo_cliente || 'No especificado';
  const prog = clienteActual.Programador || clienteActual.programador || 'Sin asignar';

  let estClass = 'status-activo';
  let estText = 'Activo';
  if (String(estRaw).toLowerCase().includes('pausa')) {
    estClass = 'status-pausa';
    estText = 'En Pausa';
  }
  if (String(estRaw).toLowerCase().includes('baja') || String(estRaw).toLowerCase().includes('inactivo')) {
    estClass = 'status-baja';
    estText = 'De Baja';
  }

  const kidsRaw = clienteActual.Usa_Kids || clienteActual.kids_activo || 'No';
  const kidsActivo = String(kidsRaw).toUpperCase() === 'SI' || kidsRaw === true ? 'Sí' : 'No';
  const kidsNum = clienteActual['Nº_Niños_Kids'] ?? clienteActual.kids_contratados ?? '0';
  const kidsNom = clienteActual.Nombres_Niños_Kids || clienteActual.kids_registrados || '-';

  const objGlobal = clienteActual.Objetivo_Global || clienteActual.objetivo_global || '-';
  const objEsp = clienteActual.Objetivo_Especifico || clienteActual.objetivo_especifico || '-';
  const obsPost = clienteActual.Observaciones_Posteriores || clienteActual.observaciones_posteriores || '-';
  const lesiones = clienteActual.Lesiones_Historial || clienteActual.lesiones || 'Ninguna registrada';
  const vaf = clienteActual.Observaciones_VAF || clienteActual.vaf || 'Sin observaciones VAF';

  // Counts & Rescheduling Window Limit
  const fechaLimiteReprogramarUTC = obtenerFechaLimiteReprogramacionUTC(mesesMargenReprog, new Date());
  const sesionesSinFecha = sesionesCliente.filter(s => s.sin_fecha);
  const sesionesConFecha = sesionesCliente.filter(s => !s.sin_fecha);
  const totalConFecha = sesionesConFecha.length;
  const compCount = sesionesConFecha.filter(s => s.estadoCalculado === 'Completada').length;
  const pendCount = sesionesConFecha.filter(s => s.estadoCalculado === 'Pendiente').length;
  const vencCount = sesionesConFecha.filter(s => s.estadoCalculado === 'Vencida').length;

  const sesionesFiltradas = sesionesConFecha.filter(s => {
    if (filtroActual === 'Todas') return true;
    return s.estadoCalculado === filtroActual;
  });

  const gruposMesMap: Record<string, { mes: string; sortKey: number; sesiones: any[] }> = {};
  sesionesFiltradas.forEach(s => {
    const y = s.fechaObj.getUTCFullYear();
    const m = s.fechaObj.getUTCMonth();
    const mesAño = `${mesesNombres[m]} ${y}`;
    if (!gruposMesMap[mesAño]) {
      gruposMesMap[mesAño] = {
        mes: mesAño,
        sortKey: y * 100 + m,
        sesiones: []
      };
    }
    gruposMesMap[mesAño].sesiones.push(s);
  });

  // Meses ordenados descendentes (del más reciente al más antiguo)
  // y sesiones dentro de cada mes ordenadas ascendentes por día y hora
  const listaMesesOrdenados = Object.values(gruposMesMap)
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(grupo => ({
      ...grupo,
      sesiones: [...grupo.sesiones].sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime())
    }));

  const renderBloqueEjerciciosDetalle = (s: any) => {
    const tieneEjercicios = Array.isArray(s.ejercicios) && s.ejercicios.length > 0;
    if (!tieneEjercicios) return null;

    let listaEj = [...s.ejercicios];
    if (!s.orden_customizado) {
      listaEj.sort((a, b) => {
        const bA = a.Bloque || 'General';
        const bB = b.Bloque || 'General';
        const idxA = ordenBloques.indexOf(bA);
        const idxB = ordenBloques.indexOf(bB);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return bA.localeCompare(bB);
      });
    }

    const bloquesSecuenciales: { nombre: string; ejercicios: any[] }[] = [];
    listaEj.forEach(ej => {
      const b = ej.Bloque || 'Ejercicios';
      const ultimo = bloquesSecuenciales[bloquesSecuenciales.length - 1];
      if (!ultimo || ultimo.nombre !== b) {
        bloquesSecuenciales.push({ nombre: b, ejercicios: [ej] });
      } else {
        ultimo.ejercicios.push(ej);
      }
    });

    const renderFilaDetalle = (ej: any, keyStr: string) => {
      const acronimo = ej.Acrónimo || ej.alias || '';
      const nombre = ej.Nombre_Ejercicio || '';
      const tituloEj =
        acronimo && nombre && acronimo !== nombre
          ? `${acronimo} · ${nombre}`
          : acronimo || nombre || 'Ejercicio';

      const detallesArr: string[] = [];
      if (ej.Detalle && String(ej.Detalle).trim() !== '') detallesArr.push(ej.Detalle);
      if (ej.Material_Adaptacion && String(ej.Material_Adaptacion).trim() !== '') {
        detallesArr.push(`Mat: ${ej.Material_Adaptacion}`);
      }

      let prescTxt = ej.Series || '';
      if (ej.Peso && String(ej.Peso).trim() !== '') {
        prescTxt += (prescTxt ? ' · ' : '') + `⚖️ ${ej.Peso}`;
      }
      const intEj = normalizarIntensidad(ej.intensidad || ej.Intensidad || 'MED');
      const idEj = ej.id_ejercicio || '';

      return (
        <div key={keyStr} className="detail-ex-row">
          <span>
            •{' '}
            {idEj ? (
              <a
                href={`#ficha_ejercicio/${idEj}`}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigate('ficha_ejercicio', idEj);
                }}
                style={{ color: 'inherit', textDecoration: 'none' }}
                onMouseOver={e => (e.currentTarget.style.textDecoration = 'underline')}
                onMouseOut={e => (e.currentTarget.style.textDecoration = 'none')}
              >
                <strong>{tituloEj}</strong>
                {detallesArr.length > 0 && (
                  <i style={{ color: '#64748b' }}> ({detallesArr.join(' | ')})</i>
                )}
              </a>
            ) : (
              <>
                <strong>{tituloEj}</strong>
                {detallesArr.length > 0 && (
                  <i style={{ color: '#64748b' }}> ({detallesArr.join(' | ')})</i>
                )}
              </>
            )}
            {ej.guardar_progreso && <span title="Seguimiento PR activo"> 📈</span>}
          </span>
          <span className="detail-ex-reps">
            {prescTxt}
            {intEj !== 'MED' && (
              <span
                style={{ marginLeft: 4 }}
                dangerouslySetInnerHTML={{
                  __html: renderIntensityBadge(intEj, { prefix: '', compact: true })
                }}
              />
            )}
          </span>
        </div>
      );
    };

    return (
      <div className="details-box">
        {bloquesSecuenciales.map((grupoBloque, bIdx) => {
          const itemsRender: {
            esSubgrupo: boolean;
            nombre?: string;
            pauta?: string;
            ejercicios: any[];
          }[] = [];

          grupoBloque.ejercicios.forEach(ej => {
            const sub =
              ej.Subgrupo && String(ej.Subgrupo).trim() !== '' ? String(ej.Subgrupo).trim() : null;
            const pauta =
              ej.Subgrupo_Series && String(ej.Subgrupo_Series).trim() !== ''
                ? String(ej.Subgrupo_Series).trim()
                : '';
            if (sub) {
              const ultimo = itemsRender[itemsRender.length - 1];
              if (ultimo && ultimo.esSubgrupo && ultimo.nombre === sub) {
                ultimo.ejercicios.push(ej);
                if (!ultimo.pauta && pauta) ultimo.pauta = pauta;
              } else {
                itemsRender.push({ esSubgrupo: true, nombre: sub, pauta, ejercicios: [ej] });
              }
            } else {
              itemsRender.push({ esSubgrupo: false, ejercicios: [ej] });
            }
          });

          return (
            <div key={bIdx} className="detail-block">
              <div className="detail-block-title">
                {grupoBloque.nombre.replace(/BLOQUE \d+: /i, '')}
              </div>
              {itemsRender.map((item, iIdx) =>
                item.esSubgrupo ? (
                  <div key={iIdx} className="preview-subgrupo">
                    <div className="subgrupo-header">
                      <span className="subgrupo-title">🔄 {item.nombre}</span>
                      {item.pauta && <span className="subgrupo-reps">{item.pauta}</span>}
                    </div>
                    {item.ejercicios.map((ej, eIdx) =>
                      renderFilaDetalle(ej, `${bIdx}-${iIdx}-${eIdx}`)
                    )}
                  </div>
                ) : (
                  renderFilaDetalle(item.ejercicios[0], `${bIdx}-${iIdx}`)
                )
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="container">
      <div className="breadcrumb">
        <a
          href="#clientes"
          onClick={e => {
            e.preventDefault();
            onNavigate('clientes');
          }}
        >
          Clientes
        </a>{' '}
        &gt; <span>{alias || nom}</span>
      </div>

      <div className="page-header">
        <h1>{nom}</h1>
        <button type="button" className="btn-outline" onClick={abrirModalEditar}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Editar ficha
        </button>
      </div>

      <div className="layout-grid">
        {/* Left Sidebar */}
        <aside>
          <div className="ficha-card">
            <div className="profile-header">
              <div className="avatar">{(alias || nom).charAt(0).toUpperCase()}</div>
              <div className="profile-info">
                <h2>{nom}</h2>
                <p>Alias: {alias || '-'}</p>
              </div>
            </div>
            <div className="info-row">
              <span className="info-label">Estado</span>
              <span className="info-val">
                <span className={`status-pill ${estClass}`}>{estText}</span>
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Tipo de cliente</span>
              <span className="info-val">
                <span className="status-pill" style={{ background: '#f1f5f9', color: '#475569' }}>
                  {tipo}
                </span>
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Programador</span>
              <span className="info-val">
                <span className="status-pill" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                  {prog}
                </span>
              </span>
            </div>
          </div>

          <button
            type="button"
            className="mobile-details-toggle"
            onClick={() => setMobileDetailsOpen(!mobileDetailsOpen)}
          >
            <span>
              {mobileDetailsOpen
                ? '▲ Ocultar objetivos, lesiones y Go&Kids'
                : '📋 Ver objetivos, lesiones y Go&Kids'}
            </span>
          </button>

          <div className={`ficha-extra-cards ${mobileDetailsOpen ? 'show-mobile' : ''}`}>
            <div className="ficha-card">
              <h3>👶 Servicio Go&amp;Kids</h3>
              <div className="info-row">
                <span className="info-label">Activo este mes</span>
                <span className="info-val">{kidsActivo}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Niños contratados</span>
                <span className="info-val">{kidsNum}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Niños registrados</span>
                <span className="info-val">{kidsNom}</span>
              </div>
            </div>

            <div className="ficha-card">
              <h3>🎯 Objetivos y seguimiento</h3>
              <div className="text-block">
                <span>Objetivo global</span>
                <p>{objGlobal}</p>
              </div>
              <div className="text-block">
                <span>Objetivo específico</span>
                <p>{objEsp}</p>
              </div>
              <div className="text-block">
                <span>Observaciones posteriores</span>
                <p>{obsPost}</p>
              </div>
            </div>

            <div className="ficha-card warning-card">
              <h3>⚠️ Historial y Precauciones</h3>
              <div className="warning-box">
                <span>Patología / Lesiones previas</span>
                <p>{lesiones}</p>
              </div>
              <div className="vaf-text">
                <span>OBSERVACIONES VAF / VALORACIÓN FÍSICA</span>
                <p>{vaf}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Main Content */}
        <main>
          <div className="ficha-card ficha-main-card">
            <div className="ficha-view-switcher">
              <button
                type="button"
                className={mainView === 'sesiones' ? 'btn-primary' : 'btn-outline'}
                style={mainView !== 'sesiones' ? { borderColor: 'transparent', color: 'var(--text-muted)' } : undefined}
                onClick={() => setMainView('sesiones')}
              >
                📅 Historial de Sesiones
              </button>
              <button
                type="button"
                className={mainView === 'progreso' ? 'btn-primary' : 'btn-outline'}
                style={mainView !== 'progreso' ? { borderColor: 'transparent', color: 'var(--text-muted)' } : undefined}
                onClick={() => setMainView('progreso')}
              >
                📈 Progreso
              </button>
              <button
                type="button"
                className={mainView === 'movimientos' ? 'btn-primary' : 'btn-outline'}
                style={mainView !== 'movimientos' ? { borderColor: 'transparent', color: 'var(--text-muted)' } : undefined}
                onClick={() => setMainView('movimientos')}
              >
                📋 Registro de Movimientos
                {Array.isArray(clienteActual?.historial_movimientos) &&
                  clienteActual.historial_movimientos.length > 0 && (
                    <span
                      style={{
                        marginLeft: 6,
                        background: mainView === 'movimientos' ? 'rgba(255,255,255,0.22)' : '#e2e8f0',
                        color: mainView === 'movimientos' ? '#fff' : '#334155',
                        borderRadius: 6,
                        padding: '1px 7px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      {clienteActual.historial_movimientos.length}
                    </span>
                  )}
              </button>
            </div>

            {mainView === 'sesiones' ? (
              <div>
                <div className="tabs">
                  <button
                    type="button"
                    className={`tab ${filtroActual === 'Completada' ? 'active' : ''}`}
                    onClick={() => setFiltroActual('Completada')}
                  >
                    Completadas ({compCount})
                  </button>
                  <button
                    type="button"
                    className={`tab ${filtroActual === 'Pendiente' ? 'active' : ''}`}
                    onClick={() => setFiltroActual('Pendiente')}
                  >
                    Pendientes ({pendCount})
                  </button>
                  <button
                    type="button"
                    className={`tab ${filtroActual === 'Vencida' ? 'active' : ''}`}
                    onClick={() => setFiltroActual('Vencida')}
                  >
                    Vencidas ({vencCount})
                  </button>
                  <button
                    type="button"
                    className={`tab ${filtroActual === 'Todas' ? 'active' : ''}`}
                    onClick={() => setFiltroActual('Todas')}
                  >
                    Todas ({totalConFecha})
                  </button>
                </div>

                {/* Bloque Fijo: Sesiones programadas sin fecha */}
                <div
                  className="month-accordion sin-fecha-accordion"
                  style={{
                    marginBottom: 22,
                    border: '2px solid #f59e0b',
                    background: '#fffbeb',
                    borderRadius: 10
                  }}
                >
                  <div
                    className="month-header sin-fecha-header"
                    style={{
                      background: 'linear-gradient(90deg, #fffbeb 0%, #fef3c7 100%)',
                      color: '#92400e',
                      borderBottom: openSinFecha ? '1px solid #fde68a' : 'none'
                    }}
                    onClick={() => setOpenSinFecha(!openSinFecha)}
                  >
                    <div className="sin-fecha-title-group">
                      <strong>📌 Sesiones programadas sin fecha</strong>
                      <span
                        style={{
                          background: '#fde68a',
                          color: '#78350f',
                          fontWeight: 700,
                          padding: '2px 10px',
                          borderRadius: 12,
                          fontSize: '0.78rem'
                        }}
                      >
                        {sesionesSinFecha.length} {sesionesSinFecha.length === 1 ? 'sesión' : 'sesiones'}
                      </span>
                    </div>
                    <div
                      className="sin-fecha-actions-group"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ padding: '6px 12px', fontSize: '0.78rem', background: '#d97706' }}
                        onClick={crearNuevaSesionSinFecha}
                      >
                        ➕ Nueva sin fecha
                      </button>
                      <span
                        className="chevron-icon"
                        style={{
                          transform: openSinFecha ? 'rotate(0deg)' : 'rotate(-90deg)',
                          cursor: 'pointer'
                        }}
                        onClick={() => setOpenSinFecha(!openSinFecha)}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                    </div>
                  </div>

                  {openSinFecha && (
                    <div className="month-content" style={{ background: '#ffffff' }}>
                      {sesionesSinFecha.length === 0 ? (
                        <div
                          style={{
                            padding: '18px 10px',
                            color: '#92400e',
                            fontSize: '0.85rem',
                            textAlign: 'center'
                          }}
                        >
                          No hay sesiones pendientes sin fecha asignada. Pulsa{' '}
                          <strong>"➕ Nueva sin fecha"</strong> para dejar una rutina lista o cancela una sesión de la agenda con la opción{' '}
                          <em>"Cancelar sin fecha"</em>.
                        </div>
                      ) : (
                        <table className="client-sessions-table sin-fecha-table">
                          <thead>
                            <tr>
                              <th className="col-chevron" />
                              <th className="col-fecha">CREACIÓN / ORIGEN</th>
                              <th className="col-tipo">TIPO</th>
                              <th className="col-estado">CONTENIDO</th>
                              <th className="col-acciones">ACCIONES</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sesionesSinFecha.map(s => {
                              const tieneEjercicios =
                                Array.isArray(s.ejercicios) && s.ejercicios.length > 0;
                              const isExpanded = Boolean(expandedRows[s.id]);
                              const fRef = s.fechaOrdenSinFecha || new Date();
                              const fStr =
                                fRef.getTime() > 0
                                  ? `${fRef.getUTCDate().toString().padStart(2, '0')}/${(fRef.getUTCMonth() + 1)
                                      .toString()
                                      .padStart(2, '0')}/${fRef.getUTCFullYear()}`
                                  : 'Sin fecha';
                              const intSes = normalizarIntensidad(
                                s.intensidad_sesion || s.intensidad || 'MED'
                              );
                              const numEj = tieneEjercicios ? s.ejercicios.length : 0;
                              const isSG =
                                (s.tipo_sesion || '').toLowerCase().includes('small') ||
                                (s.tipo_sesion || '').toLowerCase().includes('group');

                              return (
                                <React.Fragment key={s.id}>
                                  <tr
                                    className={`row-main ${tieneEjercicios ? 'clickable' : ''}`}
                                    onClick={() => {
                                      if (tieneEjercicios) {
                                        setExpandedRows(prev => ({
                                          ...prev,
                                          [s.id]: !prev[s.id]
                                        }));
                                      }
                                    }}
                                  >
                                    <td className="col-chevron">
                                      {tieneEjercicios && (
                                        <span
                                          className="chevron-icon"
                                          style={{
                                            color: 'var(--accent-dark)',
                                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                                          }}
                                        >
                                          <svg
                                            width="15"
                                            height="15"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          >
                                            <polyline points="9 18 15 12 9 6" />
                                          </svg>
                                        </span>
                                      )}
                                    </td>
                                    <td className="col-fecha">
                                      <span className="pill pill-sin-fecha">📌 Sin fecha</span>
                                      <span
                                        style={{
                                          fontSize: '0.73rem',
                                          color: 'var(--text-muted)',
                                          marginLeft: 6
                                        }}
                                      >
                                        (Origen: {fStr})
                                      </span>
                                    </td>
                                    <td className="col-tipo">
                                      <span
                                        className={`pill ${isSG ? 'pill-sg' : 'pill-si'}`}
                                        title={isSG ? 'Small Group' : 'Individual'}
                                      >
                                        {isSG ? 'S.G.' : 'Ind.'}
                                      </span>
                                    </td>
                                    <td className="col-estado">
                                      <div className="estado-cell-wrap">
                                        <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>
                                          {numEj} {numEj === 1 ? 'ej.' : 'ejs.'}
                                        </span>
                                        {tieneEjercicios && (
                                          <span
                                            dangerouslySetInnerHTML={{
                                              __html: renderIntensityBadge(intSes, { compact: true })
                                            }}
                                          />
                                        )}
                                      </div>
                                    </td>
                                    <td className="col-acciones" onClick={e => e.stopPropagation()}>
                                      <div className="action-btns">
                                        <button
                                          type="button"
                                          className="action-btn"
                                          title="Programar / Editar ejercicios"
                                          onClick={() => onNavigate('programar_sesion', s.id)}
                                        >
                                          <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          >
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          className="action-btn"
                                          title="Asignar día y hora en el calendario semanal"
                                          onClick={() => abrirModalReprogramar(s.id)}
                                        >
                                          <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          >
                                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                            <line x1="16" y1="2" x2="16" y2="6" />
                                            <line x1="8" y1="2" x2="8" y2="6" />
                                            <line x1="3" y1="10" x2="21" y2="10" />
                                          </svg>
                                        </button>
                                        {tieneEjercicios && (
                                          <button
                                            type="button"
                                            className="action-btn send"
                                            title="Enviar copia de ejercicios a otra sesión"
                                            onClick={() => abrirModalEnviar(s.id)}
                                          >
                                            ➡️
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="action-btn del"
                                          title="Eliminar sesión sin fecha"
                                          onClick={() => borrarSesion(s.id)}
                                        >
                                          <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          >
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                          </svg>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  {tieneEjercicios && isExpanded && (
                                    <tr className="row-details">
                                      <td colSpan={5}>{renderBloqueEjerciciosDetalle(s)}</td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>

                {/* Monthly Accordions */}
                {sesionesFiltradas.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>
                    No hay sesiones en esta categoría.
                  </div>
                ) : (
                  listaMesesOrdenados.map(({ mes, sesiones }) => {
                    const isMonthOpen = Boolean(openMonths[mes]);

                    return (
                      <div key={mes} className="month-accordion">
                        <div
                          className="month-header"
                          onClick={() =>
                            setOpenMonths(prev => ({ ...prev, [mes]: !prev[mes] }))
                          }
                        >
                          <div>
                            {mes} <span>{sesiones.length} {sesiones.length === 1 ? 'sesión' : 'sesiones'}</span>
                          </div>
                          <span
                            className="chevron-icon"
                            style={{ transform: isMonthOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                          >
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </span>
                        </div>

                        {isMonthOpen && (
                          <div className="month-content">
                            <table className="client-sessions-table">
                              <thead>
                                <tr>
                                  <th className="col-chevron" />
                                  <th className="col-fecha">FECHA</th>
                                  <th className="col-hora">HORA</th>
                                  <th className="col-tipo">TIPO</th>
                                  <th className="col-estado">ESTADO</th>
                                  <th className="col-acciones">ACCIONES</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sesiones.map(s => {
                                  const f = s.fechaObj;
                                  const diaSem = diasSemanaCortos[f.getUTCDay()];
                                  const d = f.getUTCDate().toString().padStart(2, '0');
                                  const m = (f.getUTCMonth() + 1).toString().padStart(2, '0');
                                  const y = f.getUTCFullYear();
                                  const fechaStr = `${diaSem}, ${d}/${m}/${y}`;
                                  const horaStr = `${f.getUTCHours().toString().padStart(2, '0')}:${f
                                    .getUTCMinutes()
                                    .toString()
                                    .padStart(2, '0')}`;

                                  const isSG =
                                    (s.tipo_sesion || '').toLowerCase().includes('small') ||
                                    (s.tipo_sesion || '').toLowerCase().includes('group');
                                  const tipoPill = isSG ? (
                                    <span className="pill pill-sg" title="Small Group">
                                      S.G.
                                    </span>
                                  ) : (
                                    <span className="pill pill-si" title="Individual">
                                      Ind.
                                    </span>
                                  );

                                  let estPill = (
                                    <span
                                      className="pill pill-pendiente"
                                      style={{ cursor: 'pointer' }}
                                      title="Pendiente · Haz clic para marcar como Completada"
                                      onClick={e => {
                                        e.stopPropagation();
                                        toggleEstadoCompletada(s);
                                      }}
                                    >
                                      Pen
                                    </span>
                                  );
                                  if (s.estadoCalculado === 'Completada') {
                                    estPill = (
                                      <span
                                        className="pill pill-completada"
                                        style={{ cursor: 'pointer' }}
                                        title="Completada · Haz clic para volver a Pendiente"
                                        onClick={e => {
                                          e.stopPropagation();
                                          toggleEstadoCompletada(s);
                                        }}
                                      >
                                        Com
                                      </span>
                                    );
                                  } else if (s.estadoCalculado === 'Vencida') {
                                    estPill = (
                                      <span
                                        className="pill pill-vencida"
                                        style={{ cursor: 'pointer' }}
                                        title="Vencida · Haz clic para marcar como Completada"
                                        onClick={e => {
                                          e.stopPropagation();
                                          toggleEstadoCompletada(s);
                                        }}
                                      >
                                        Ven
                                      </span>
                                    );
                                  }

                                  const tieneEjercicios =
                                    Array.isArray(s.ejercicios) && s.ejercicios.length > 0;
                                  const intSes = normalizarIntensidad(
                                    s.intensidad_sesion || s.intensidad || 'MED'
                                  );
                                  const isExpanded = Boolean(expandedRows[s.id]);
                                  const fueraDePlazoReprogramar =
                                    s.estadoCalculado === 'Vencida' && f < fechaLimiteReprogramarUTC;
                                  const puedeReprogramarOCancelar =
                                    s.estadoCalculado !== 'Completada' && !fueraDePlazoReprogramar;

                                  return (
                                    <React.Fragment key={s.id}>
                                      <tr
                                        className={`row-main ${tieneEjercicios ? 'clickable' : ''}`}
                                        onClick={() => {
                                          if (tieneEjercicios) {
                                            setExpandedRows(prev => ({
                                              ...prev,
                                              [s.id]: !prev[s.id]
                                            }));
                                          }
                                        }}
                                      >
                                        <td className="col-chevron">
                                          {tieneEjercicios && (
                                            <span
                                              className="chevron-icon"
                                              style={{
                                                color: 'var(--accent-dark)',
                                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                                              }}
                                            >
                                              <svg
                                                width="15"
                                                height="15"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              >
                                                <polyline points="9 18 15 12 9 6" />
                                              </svg>
                                            </span>
                                          )}
                                        </td>
                                        <td className="col-fecha">{fechaStr}</td>
                                        <td className="col-hora">{horaStr}</td>
                                        <td className="col-tipo">{tipoPill}</td>
                                        <td className="col-estado">
                                          <div className="estado-cell-wrap">
                                            {estPill}
                                            {tieneEjercicios && (
                                              <span
                                                dangerouslySetInnerHTML={{
                                                  __html: renderIntensityBadge(intSes, { compact: true })
                                                }}
                                              />
                                            )}
                                          </div>
                                        </td>
                                        <td className="col-acciones" onClick={e => e.stopPropagation()}>
                                          <div className="action-btns">
                                            <button
                                              type="button"
                                              className="action-btn"
                                              title="Programar / Editar ejercicios"
                                              onClick={() => onNavigate('programar_sesion', s.id)}
                                            >
                                              <svg
                                                width="14"
                                                height="14"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              >
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                              </svg>
                                            </button>
                                            {puedeReprogramarOCancelar && (
                                              <button
                                                type="button"
                                                className="action-btn"
                                                title="Reprogramar fecha/hora"
                                                onClick={() => abrirModalReprogramar(s.id)}
                                              >
                                                <svg
                                                  width="14"
                                                  height="14"
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  strokeWidth="2"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                >
                                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                                  <line x1="16" y1="2" x2="16" y2="6" />
                                                  <line x1="8" y1="2" x2="8" y2="6" />
                                                  <line x1="3" y1="10" x2="21" y2="10" />
                                                </svg>
                                              </button>
                                            )}
                                            {tieneEjercicios && (
                                              <button
                                                type="button"
                                                className="action-btn send"
                                                title="Enviar ejercicios a..."
                                                onClick={() => abrirModalEnviar(s.id)}
                                              >
                                                ➡️
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              className="action-btn del"
                                              title="Eliminar o enviar a sin fecha"
                                              onClick={() =>
                                                abrirModalPapeleraSesion(
                                                  s.id,
                                                  fechaStr,
                                                  horaStr,
                                                  puedeReprogramarOCancelar
                                                )
                                              }
                                            >
                                              <svg
                                                width="14"
                                                height="14"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              >
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                              </svg>
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                      {tieneEjercicios && isExpanded && (
                                        <tr className="row-details">
                                          <td colSpan={6}>{renderBloqueEjerciciosDetalle(s)}</td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : mainView === 'progreso' ? (
              /* Vista Progreso */
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0, marginBottom: 20 }}>
                  Aquí se muestran todos los ejercicios marcados como "De Progreso" en el catálogo. Registra los récords personales (PR) de peso levantado para hacer seguimiento de la evolución del cliente.
                </p>
                {catalogoProgreso.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>
                    No hay ejercicios marcados como "De Progreso" en el catálogo general. Ve a la pestaña Ejercicios y edita los ejercicios básicos para activar esta casilla.
                  </div>
                ) : (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                    <table className="progreso-pr-table">
                      <thead style={{ background: 'var(--hover-bg)' }}>
                        <tr>
                          <th style={{ width: '40%' }}>Ejercicio de Progreso</th>
                          <th style={{ width: '35%' }}>Peso Máximo (PR)</th>
                          <th style={{ width: '25%', textAlign: 'right' }}>Último Registro / Opciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catalogoProgreso.map(ej => {
                          const idEj = ej.id;
                          const nomEj = ej.Nombre_Ejercicio || 'Sin nombre';
                          const acrEj = ej.Acrónimo || '';

                          const regsDeEsteEj = registrosPR.filter(
                            r => r.id_ejercicio === idEj || r.nombre_ejercicio === nomEj
                          );

                          if (regsDeEsteEj.length > 0) {
                            let maxPeso = 0;
                            regsDeEsteEj.forEach(r => {
                              const p = parseFloat(r.peso_levantado) || 0;
                              if (p > maxPeso) maxPeso = p;
                            });
                            const ultimoReg = regsDeEsteEj[0];
                            const f = ultimoReg.fechaObj;
                            const fechaStr = `${f.getDate().toString().padStart(2, '0')}/${(
                              f.getMonth() + 1
                            )
                              .toString()
                              .padStart(2, '0')}/${f.getFullYear()}`;

                            return (
                              <tr key={idEj}>
                                <td>
                                  <strong>{acrEj ? `${acrEj} · ` : ''}{nomEj}</strong>
                                </td>
                                <td>
                                  <span
                                    style={{
                                      background: '#dcfce7',
                                      color: '#166534',
                                      padding: '6px 14px',
                                      borderRadius: 20,
                                      fontWeight: 800,
                                      fontSize: '0.95rem',
                                      border: '1px solid #bbf7d0'
                                    }}
                                  >
                                    🏆 {maxPeso} kg
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'flex-end',
                                      gap: 12
                                    }}
                                  >
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                      Último: {ultimoReg.peso_levantado}kg ({fechaStr})
                                    </span>
                                    <button
                                      type="button"
                                      className="btn-outline"
                                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                      onClick={() =>
                                        setModalHistorialPR({
                                          open: true,
                                          idEj,
                                          nomEj,
                                          nuevoPeso: '',
                                          saving: false
                                        })
                                      }
                                    >
                                      📋 Historial ({regsDeEsteEj.length})
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          } else {
                            return (
                              <tr key={idEj}>
                                <td>
                                  <strong>{acrEj ? `${acrEj} · ` : ''}{nomEj}</strong>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                      type="number"
                                      step="0.5"
                                      placeholder="Peso (kg)"
                                      value={inlinePRValues[idEj] || ''}
                                      onChange={e =>
                                        setInlinePRValues(prev => ({ ...prev, [idEj]: e.target.value }))
                                      }
                                      style={{
                                        width: 110,
                                        padding: '6px 10px',
                                        border: '1px solid var(--border)',
                                        borderRadius: 6,
                                        fontSize: '0.85rem'
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="btn-primary"
                                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                      onClick={() => guardarPRInline(idEj, nomEj)}
                                    >
                                      Añadir
                                    </button>
                                  </div>
                                </td>
                                <td
                                  style={{
                                    textAlign: 'right',
                                    color: 'var(--text-muted)',
                                    fontSize: '0.8rem',
                                    fontStyle: 'italic'
                                  }}
                                >
                                  Sin registros aún
                                </td>
                              </tr>
                            );
                          }
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              /* Vista Registro de Movimientos */
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0, marginBottom: 18 }}>
                  Historial cronológico de anulaciones, vencimientos automáticos, reprogramaciones y asignaciones de sesiones sin fecha del cliente.
                </p>
                {(() => {
                  const logs: MovimientoLogCliente[] = Array.isArray(clienteActual?.historial_movimientos)
                    ? clienteActual.historial_movimientos
                    : [];
                  if (logs.length === 0) {
                    return (
                      <div
                        style={{
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                          padding: '36px 20px',
                          background: '#f8fafc',
                          borderRadius: 10,
                          border: '1px solid var(--border)'
                        }}
                      >
                        No hay movimientos registrados todavía para este cliente.
                      </div>
                    );
                  }

                  const getBadgeConfig = (tipo: MovimientoLogCliente['tipo']) => {
                    switch (tipo) {
                      case 'CANCELACION':
                        return {
                          label: 'Sesión cancelada',
                          bg: '#fffbeb',
                          color: '#b45309',
                          border: '#fde68a'
                        };
                      case 'VENCIMIENTO':
                        return {
                          label: 'Cancelación por vencimiento',
                          bg: '#fef2f2',
                          color: '#b91c1c',
                          border: '#fecaca'
                        };
                      case 'REPROGRAMACION':
                        return {
                          label: 'Sesión reprogramada',
                          bg: '#f0f9ff',
                          color: '#0369a1',
                          border: '#bae6fd'
                        };
                      case 'CADUCIDAD_SIN_FECHA':
                        return {
                          label: 'Sesión sin fecha caducada',
                          bg: '#f3e8ff',
                          color: '#6b21a8',
                          border: '#d8b4fe'
                        };
                      case 'ASIGNACION_SIN_FECHA':
                      default:
                        return {
                          label: 'Sesión sin fecha asignada',
                          bg: '#f0fdf4',
                          color: '#15803d',
                          border: '#bbf7d0'
                        };
                    }
                  };

                  return (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: 'var(--hover-bg)' }}>
                          <tr>
                            <th style={{ width: '18%', textAlign: 'left', padding: '10px 14px', fontSize: '0.76rem', color: '#475569' }}>
                              FECHA Y HORA
                            </th>
                            <th style={{ width: '22%', textAlign: 'left', padding: '10px 14px', fontSize: '0.76rem', color: '#475569' }}>
                              ACCIÓN
                            </th>
                            <th style={{ width: '46%', textAlign: 'left', padding: '10px 14px', fontSize: '0.76rem', color: '#475569' }}>
                              DETALLE DEL MOVIMIENTO
                            </th>
                            <th style={{ width: '14%', textAlign: 'right', padding: '10px 14px', fontSize: '0.76rem', color: '#475569' }}>
                              REGISTRADO POR
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((entry, idx) => {
                            const f = entry.fecha_registro ? new Date(entry.fecha_registro) : null;
                            const fechaFmt =
                              f && !isNaN(f.getTime())
                                ? `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(
                                    2,
                                    '0'
                                  )}/${f.getFullYear()} · ${String(f.getHours()).padStart(2, '0')}:${String(
                                    f.getMinutes()
                                  ).padStart(2, '0')}`
                                : '—';
                            const badge = getBadgeConfig(entry.tipo);

                            return (
                              <tr
                                key={entry.id || idx}
                                style={{ borderTop: '1px solid var(--border)' }}
                              >
                                <td
                                  style={{
                                    padding: '12px 14px',
                                    fontSize: '0.82rem',
                                    color: '#475569',
                                    fontVariantNumeric: 'tabular-nums',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {fechaFmt}
                                </td>
                                <td style={{ padding: '12px 14px' }}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '3px 9px',
                                      borderRadius: 6,
                                      fontSize: '0.76rem',
                                      fontWeight: 700,
                                      background: badge.bg,
                                      color: badge.color,
                                      border: `1px solid ${badge.border}`
                                    }}
                                  >
                                    {entry.titulo || badge.label}
                                  </span>
                                </td>
                                <td
                                  style={{
                                    padding: '12px 14px',
                                    fontSize: '0.86rem',
                                    color: '#0f172a',
                                    lineHeight: 1.45
                                  }}
                                >
                                  {entry.detalle}
                                </td>
                                <td
                                  style={{
                                    padding: '12px 14px',
                                    fontSize: '0.8rem',
                                    color: '#64748b',
                                    textAlign: 'right',
                                    fontWeight: 600
                                  }}
                                >
                                  {entry.usuario || 'Sistema'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modal Editar Ficha de Cliente */}
      {modalEditOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalEditOpen(false)}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>Editar Ficha de Cliente</h2>
              <p>Modifica los datos personales, objetivos y valoraciones</p>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Nombre completo</label>
                <input
                  type="text"
                  value={editForm.nombre}
                  onChange={e => setEditForm(prev => ({ ...prev, nombre: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Alias (Nombre corto)</label>
                <input
                  type="text"
                  value={editForm.alias}
                  onChange={e => setEditForm(prev => ({ ...prev, alias: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select
                  value={editForm.estado}
                  onChange={e => setEditForm(prev => ({ ...prev, estado: e.target.value }))}
                >
                  {estadosClienteList.map(est => (
                    <option key={est} value={est}>
                      {est}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Tipo de cliente</label>
                <select
                  value={editForm.tipo}
                  onChange={e => setEditForm(prev => ({ ...prev, tipo: e.target.value }))}
                >
                  {tiposClienteList.map(t => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group full">
                <label>Programador Asignado</label>
                <select
                  value={editForm.programador}
                  onChange={e => setEditForm(prev => ({ ...prev, programador: e.target.value }))}
                >
                  <option value="">Sin asignar</option>
                  {programadoresList.map(p => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Servicio Go&amp;Kids Activo</label>
                <select
                  value={editForm.kidsActivo}
                  onChange={e => setEditForm(prev => ({ ...prev, kidsActivo: e.target.value }))}
                >
                  <option value="NO">No</option>
                  <option value="SI">Sí</option>
                </select>
              </div>
              <div className="form-group">
                <label>Nº Niños Contratados</label>
                <input
                  type="number"
                  min={0}
                  disabled={editForm.kidsActivo !== 'SI'}
                  value={editForm.kidsActivo === 'SI' ? editForm.kidsNum : '0'}
                  onChange={e => setEditForm(prev => ({ ...prev, kidsNum: e.target.value }))}
                />
              </div>
              <div className="form-group full">
                <label>Nombres de los niños registrados</label>
                <input
                  type="text"
                  disabled={editForm.kidsActivo !== 'SI'}
                  value={editForm.kidsActivo === 'SI' ? editForm.kidsNombres : ''}
                  onChange={e => setEditForm(prev => ({ ...prev, kidsNombres: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Objetivo Global</label>
                <input
                  type="text"
                  value={editForm.objGlobal}
                  onChange={e => setEditForm(prev => ({ ...prev, objGlobal: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Objetivo Específico</label>
                <input
                  type="text"
                  value={editForm.objEsp}
                  onChange={e => setEditForm(prev => ({ ...prev, objEsp: e.target.value }))}
                />
              </div>
              <div className="form-group full">
                <label>Observaciones Posteriores</label>
                <textarea
                  value={editForm.obsPost}
                  onChange={e => setEditForm(prev => ({ ...prev, obsPost: e.target.value }))}
                />
              </div>
              <div className="form-group full">
                <label>Patologías / Lesiones Previas</label>
                <textarea
                  value={editForm.lesiones}
                  onChange={e => setEditForm(prev => ({ ...prev, lesiones: e.target.value }))}
                />
              </div>
              <div className="form-group full">
                <label>Observaciones VAF / Valoración Física</label>
                <textarea
                  value={editForm.vaf}
                  onChange={e => setEditForm(prev => ({ ...prev, vaf: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalEditOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={savingEdit}
                onClick={guardarEdicionCliente}
              >
                {savingEdit ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Historial PR */}
      {modalHistorialPR.open && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 500 }}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalHistorialPR(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>{modalHistorialPR.nomEj}</h2>
              <p>Historial de evolución y récords personales (PR)</p>
            </div>

            <div
              style={{
                background: 'var(--hover-bg)',
                padding: 15,
                borderRadius: 8,
                marginBottom: 20,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-end'
              }}
            >
              <div className="form-group" style={{ flexGrow: 1, marginBottom: 0 }}>
                <label>Registrar nuevo peso levantado (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="Ej: 80"
                  value={modalHistorialPR.nuevoPeso}
                  onChange={e =>
                    setModalHistorialPR(prev => ({ ...prev, nuevoPeso: e.target.value }))
                  }
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                style={{ height: 40 }}
                disabled={modalHistorialPR.saving}
                onClick={guardarNuevoPRDesdeModal}
              >
                + Añadir PR
              </button>
            </div>

            <div
              style={{
                maxHeight: 250,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 8
              }}
            >
              <table>
                <thead style={{ background: 'var(--hover-bg)' }}>
                  <tr>
                    <th>FECHA</th>
                    <th>PESO LEVANTADO</th>
                    <th style={{ textAlign: 'right' }}>BORRAR</th>
                  </tr>
                </thead>
                <tbody>
                  {registrosPR
                    .filter(
                      r =>
                        r.id_ejercicio === modalHistorialPR.idEj ||
                        r.nombre_ejercicio === modalHistorialPR.nomEj
                    )
                    .map(r => {
                      const f = r.fechaObj;
                      const fechaStr = `${f.getDate().toString().padStart(2, '0')}/${(
                        f.getMonth() + 1
                      )
                        .toString()
                        .padStart(2, '0')}/${f.getFullYear()}`;
                      return (
                        <tr key={r.id}>
                          <td>{fechaStr}</td>
                          <td>
                            <strong>{r.peso_levantado} kg</strong>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="action-btn del"
                              onClick={() => borrarRegistroPR(r.id)}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalHistorialPR(prev => ({ ...prev, open: false }))}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Enviar Rutina Reutilizable */}
      <SendRoutineModal
        isOpen={sendRoutineData.open}
        onClose={() => setSendRoutineData(prev => ({ ...prev, open: false }))}
        ejercicios={sendRoutineData.ejercicios}
        defaultIntensity={sendRoutineData.intensity}
        defaultTipoSesion={sendRoutineData.tipoSesion}
        defaultClientId={clientId}
        excludeSessionId={sendRoutineData.originSessionId}
        onSuccess={cargarTodo}
      />


      {/* Modal Opciones Papelera (Eliminar o Enviar a Sin Fecha) */}
      {modalPapeleraSesion.open && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 460 }}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalPapeleraSesion(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>🗑️ Opciones de sesión</h2>
              <p>
                Sesión del <strong>{modalPapeleraSesion.fechaStr}</strong> a las{' '}
                <strong>{modalPapeleraSesion.horaStr}</strong>. ¿Qué acción deseas realizar?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {modalPapeleraSesion.puedeEnviarSinFecha && (
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
                    const id = modalPapeleraSesion.idSesion;
                    setModalPapeleraSesion(prev => ({ ...prev, open: false }));
                    await cancelarSesionConCascada(id);
                  }}
                >
                  <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>📌</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                      Enviar a sin fecha (Cancelar sesión)
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#78350f', fontWeight: 400, lineHeight: 1.35 }}>
                      Libera el hueco en la agenda, desplaza las rutinas en cascada y envía la última a "Sesiones programadas sin fecha".
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
                  const id = modalPapeleraSesion.idSesion;
                  setModalPapeleraSesion(prev => ({ ...prev, open: false }));
                  await borrarSesion(id);
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
                onClick={() => setModalPapeleraSesion(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reprogramar con Calendario Semanal */}
      {modalReprog.open && (() => {
        const sesionOrig = sesionesCliente.find(s => s.id === modalReprog.idSesion);
        const tipo = (sesionOrig?.tipo_sesion || '').toLowerCase();
        const esSG = tipo.includes('small') || tipo.includes('group');
        const slots = esSG ? reprogHorariosSG : reprogHorariosInd;

        const morningSlots = slots.filter(h => parseInt(h.split(':')[0], 10) < 14);
        const afternoonSlots = slots.filter(h => parseInt(h.split(':')[0], 10) >= 14);

        const getRowForTime = (timeStr: string) => {
          const idxM = morningSlots.indexOf(timeStr);
          if (idxM !== -1) return idxM + 2;
          const idxA = afternoonSlots.indexOf(timeStr);
          if (idxA !== -1) return idxA + morningSlots.length + 3;
          return -1;
        };

        const diasSemanaNombres = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES'];
        const diasSemanaFechas: Date[] = [];
        for (let i = 0; i < 5; i++) {
          const d = new Date(modalReprog.weekStart);
          d.setUTCDate(d.getUTCDate() + i);
          diasSemanaFechas.push(d);
        }

        const viernes = diasSemanaFechas[4];
        const weekLabel = `${diasSemanaFechas[0].getUTCDate()} ${mesesNombres[
          diasSemanaFechas[0].getUTCMonth()
        ].substring(0, 3)} - ${viernes.getUTCDate()} ${mesesNombres[
          viernes.getUTCMonth()
        ].substring(0, 3)} ${viernes.getUTCFullYear()}`;

        const gridRowsTemplate = `auto repeat(${morningSlots.length}, 34px) 14px repeat(${afternoonSlots.length}, 34px)`;

        return (
          <div className="modal-overlay" style={{ display: 'flex' }}>
            <div className="modal-content" style={{ maxWidth: 940, width: '95%' }}>
              <button
                type="button"
                className="modal-close"
                onClick={() => setModalReprog(prev => ({ ...prev, open: false }))}
              >
                ×
              </button>
              <div className="modal-header" style={{ marginBottom: 15 }}>
                <h2>📅 Reprogramar Sesión en Calendario</h2>
                <p>
                  {sesionOrig
                    ? `${alias || nom} · ${
                        sesionOrig.sin_fecha
                          ? '📌 Sesión sin fecha asignada'
                          : `Actual: ${diasSemanaCortos[sesionOrig.fechaObj.getUTCDay()]} ${sesionOrig.fechaObj
                              .getUTCDate()
                              .toString()
                              .padStart(2, '0')}/${(sesionOrig.fechaObj.getUTCMonth() + 1)
                              .toString()
                              .padStart(2, '0')}/${sesionOrig.fechaObj.getUTCFullYear()} a las ${sesionOrig.fechaObj
                              .getUTCHours()
                              .toString()
                              .padStart(2, '0')}:${sesionOrig.fechaObj
                              .getUTCMinutes()
                              .toString()
                              .padStart(2, '0')}`
                      }`
                    : 'Haz clic directamente sobre el día y hora de destino en el calendario semanal'}
                </p>
              </div>

              {modalReprog.step === 1 ? (
                <div>
                  <div className="reprog-toolbar">
                    <div className="reprog-nav-group">
                      <button
                        type="button"
                        className="reprog-nav-arrow"
                        onClick={() => cambiarSemanaReprog(-1)}
                      >
                        &lt;
                      </button>
                      <div className="reprog-week-title">{weekLabel}</div>
                      <button
                        type="button"
                        className="reprog-nav-arrow"
                        onClick={() => cambiarSemanaReprog(1)}
                      >
                        &gt;
                      </button>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      💡 Haz clic en cualquier hueco del calendario para elegir la nueva fecha y hora
                    </div>
                  </div>

                  <div className="reprog-calendar-wrapper">
                    {modalReprog.loadingWeek ? (
                      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                        Cargando calendario semanal...
                      </div>
                    ) : (
                      <div
                        className="reprog-calendar-grid"
                        style={{
                          gridTemplateColumns: '60px repeat(5, 1fr)',
                          gridTemplateRows: gridRowsTemplate
                        }}
                      >
                        <div className="reprog-day-header" style={{ gridColumn: 1, gridRow: 1 }} />
                        {diasSemanaFechas.map((dObj, i) => {
                          const dd = dObj.getUTCDate().toString().padStart(2, '0');
                          const mm = (dObj.getUTCMonth() + 1).toString().padStart(2, '0');
                          return (
                            <div
                              key={i}
                              className="reprog-day-header"
                              style={{ gridColumn: i + 2, gridRow: 1 }}
                            >
                              <strong>{diasSemanaNombres[i]}</strong>
                              <span>
                                {dd}/{mm}
                              </span>
                            </div>
                          );
                        })}

                        {morningSlots.map((t, idx) => {
                          const r = idx + 2;
                          return (
                            <React.Fragment key={`m-${t}`}>
                              <div className="reprog-time-label" style={{ gridColumn: 1, gridRow: r }}>
                                {t}
                              </div>
                              {diasSemanaFechas.map((dObj, c) => (
                                <div
                                  key={`mc-${c}`}
                                  className="reprog-bg-cell"
                                  style={{ gridColumn: c + 2, gridRow: r }}
                                  title={`Mover a ${diasSemanaNombres[c]} ${dObj.getUTCDate()}/${
                                    dObj.getUTCMonth() + 1
                                  } a las ${t}`}
                                  onClick={() =>
                                    seleccionarCeldaReprog(
                                      dObj.getUTCFullYear(),
                                      dObj.getUTCMonth(),
                                      dObj.getUTCDate(),
                                      t
                                    )
                                  }
                                />
                              ))}
                            </React.Fragment>
                          );
                        })}

                        <div
                          className="reprog-noon-separator"
                          style={{ gridRow: morningSlots.length + 2 }}
                        />

                        {afternoonSlots.map((t, idx) => {
                          const r = idx + morningSlots.length + 3;
                          return (
                            <React.Fragment key={`a-${t}`}>
                              <div className="reprog-time-label" style={{ gridColumn: 1, gridRow: r }}>
                                {t}
                              </div>
                              {diasSemanaFechas.map((dObj, c) => (
                                <div
                                  key={`ac-${c}`}
                                  className="reprog-bg-cell"
                                  style={{ gridColumn: c + 2, gridRow: r }}
                                  title={`Mover a ${diasSemanaNombres[c]} ${dObj.getUTCDate()}/${
                                    dObj.getUTCMonth() + 1
                                  } a las ${t}`}
                                  onClick={() =>
                                    seleccionarCeldaReprog(
                                      dObj.getUTCFullYear(),
                                      dObj.getUTCMonth(),
                                      dObj.getUTCDate(),
                                      t
                                    )
                                  }
                                />
                              ))}
                            </React.Fragment>
                          );
                        })}

                        {/* Existing client events */}
                        {modalReprog.weekSessions
                          .filter(s => s.id_cliente === clientId)
                          .map(s => {
                            const f = s.fecha;
                            const dayOfWeek = f.getUTCDay();
                            if (dayOfWeek < 1 || dayOfWeek > 5) return null;
                            const col = dayOfWeek + 1;
                            const hStr = `${f.getUTCHours().toString().padStart(2, '0')}:${f
                              .getUTCMinutes()
                              .toString()
                              .padStart(2, '0')}`;
                            const row = getRowForTime(hStr);
                            if (row === -1) return null;

                            const esOrigen = s.id === modalReprog.idSesion;
                            const esComp = esSesionCompletada(s);
                            const tieneEj = Array.isArray(s.ejercicios) && s.ejercicios.length > 0;
                            const cardClass = esOrigen
                              ? 'reprog-event-origin'
                              : esComp
                              ? 'reprog-event-completed'
                              : 'reprog-event-other';
                            const spanRows = esSG ? 1 : 2;
                            const labelText = esOrigen
                              ? `📍 Actual (${hStr})`
                              : `${esComp ? '✓ ' : ''}${hStr} ${tieneEj ? '💪' : ''}`;

                            return (
                              <div
                                key={s.id}
                                className={`reprog-event-card ${cardClass}`}
                                style={{
                                  gridColumn: col,
                                  gridRow: `${row} / span ${spanRows}`,
                                  pointerEvents: 'none'
                                }}
                              >
                                <div
                                  style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {labelText}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
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
                      Sesión completada
                    </span>
                  </div>

                  <div className="modal-footer" style={{ marginTop: 15 }}>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => setModalReprog(prev => ({ ...prev, open: false }))}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
