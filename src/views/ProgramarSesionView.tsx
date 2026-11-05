import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useUndo } from '../context/UndoContext';
import { cargarCatalogoMaestros, extraerListaMaster } from '../services/maestrosService';
import { normalizarIntensidad, renderIntensityBadge } from '../utils/helpers';

interface ProgramarSesionViewProps {
  sessionId: string;
  onNavigate: (tab: string, param?: string) => void;
}

const diasSemanaCortos = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const clonarProfundo = (obj: any) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

export const ProgramarSesionView: React.FC<ProgramarSesionViewProps> = ({
  sessionId,
  onNavigate
}) => {
  const { userName } = useAuth();
  const { pushAction, registerChangeListener } = useUndo();

  const [sesionActual, setSesionActual] = useState<any>(null);
  const [esSmallGroup, setEsSmallGroup] = useState(false);
  const [idsGrupoActual, setIdsGrupoActual] = useState<string[]>([]);
  const [sgClientesGrupo, setSgClientesGrupo] = useState<{ id: string; nom: string }[]>([]);
  const [nombreClienteHeader, setNombreClienteHeader] = useState('');
  const [entrenadorAsignado, setEntrenadorAsignado] = useState('Sin asignar');

  const [catalogoEjercicios, setCatalogoEjercicios] = useState<any[]>([]);
  const [plantillasDisponibles, setPlantillasDisponibles] = useState<any[]>([]);
  const [todosLosClientes, setTodosLosClientes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [ordenBloques, setOrdenBloques] = useState<string[]>([
    'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
    'BLOQUE 2: FUERZA - PRINCIPAL',
    'BLOQUE 3: COMPENSATORIO - ACCESORIO',
    'BLOQUE 4: METABÓLICO - ACONDICIONAMIENTO'
  ]);
  const [gruposMuscularesMaster, setGruposMuscularesMaster] = useState<string[]>([]);
  const [nivelesMaster, setNivelesMaster] = useState<string[]>([]);
  const [subcategoriasMaster, setSubcategoriasMaster] = useState<string[]>([]);
  const [materialesMaster, setMaterialesMaster] = useState<string[]>([]);
  const [seriesMaster, setSeriesMaster] = useState<string[]>([
    '3 x 10',
    '3 x 12',
    '3 x 15',
    '4 x 8',
    '4 x 10',
    '4 x 12',
    "3 x 40''"
  ]);

  // Drag state for reordering exercises
  const dragIndexRef = useRef<number | null>(null);

  // Modal Añadir / Editar Ejercicio
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [exPanelOpen, setExPanelOpen] = useState(false);
  const [matPanelOpen, setMatPanelOpen] = useState(false);
  const [matSearch, setMatSearch] = useState('');

  // Exercise filter controls inside modalAdd
  const [filterMusculo, setFilterMusculo] = useState('Todos');
  const [filterBloque, setFilterBloque] = useState('Todos');
  const [filterNivel, setFilterNivel] = useState('Todos');
  const [filterSubcat, setFilterSubcat] = useState('Todos');
  const [exSearchText, setExSearchText] = useState('');

  const [formEx, setFormEx] = useState({
    id_ejercicio: '',
    nombre_ejercicio: '',
    es_de_progreso: false,
    guardar_progreso: false,
    prHint: '',
    detalle: '',
    acronimo: '',
    materiales: [] as string[],
    bloque: 'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
    subgrupoSelect: '',
    subgrupoCustom: '',
    subgrupoSeries: '',
    seriesSelect: '3 x 10',
    seriesCustom: '',
    peso: '',
    intensidad: 'MED'
  });

  // Modal Importar Plantilla
  const [modalImportarOpen, setModalImportarOpen] = useState(false);
  const [selectedPlantillaId, setSelectedPlantillaId] = useState('');
  const [importing, setImporting] = useState(false);

  // Modal Enviar Rutina
  const [modalEnviar, setModalEnviar] = useState<{
    open: boolean;
    targetClientId: string;
    targetSessionId: string;
    targetSessionsList: any[];
    loadingTarget: boolean;
    saving: boolean;
  }>({
    open: false,
    targetClientId: '',
    targetSessionId: '',
    targetSessionsList: [],
    loadingTarget: false,
    saving: false
  });

  const cargarTodo = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const maestros = await cargarCatalogoMaestros();
      const bloques = extraerListaMaster(maestros, 'Ejercicios', [
        'Bloque de la sesión en que se recomienda',
        'Bloque de recomendación'
      ]);
      if (bloques.length > 0) setOrdenBloques(bloques);

      const musc = extraerListaMaster(maestros, 'Ejercicios', ['Grupo muscular']);
      if (musc.length > 0) setGruposMuscularesMaster(musc);

      const niv = extraerListaMaster(maestros, 'Ejercicios', ['Nivel de Dificultad']);
      if (niv.length > 0) setNivelesMaster(niv);

      const subc = extraerListaMaster(maestros, 'Ejercicios', ['Subcategoría']);
      if (subc.length > 0) setSubcategoriasMaster(subc);

      const mats = extraerListaMaster(maestros, 'Ejercicios', ['Material sugerido']);
      if (mats.length > 0) setMaterialesMaster(mats);

      const sers = extraerListaMaster(maestros, 'Ejercicios', ['Series y Repeticiones']);
      if (sers.length > 0) setSeriesMaster(sers);
    } catch (e) {
      console.warn('Error cargando maestros en programar_sesion:', e);
    }

    try {
      const [sesSnap, catSnap, cliSnap, plantSnap] = await Promise.all([
        getDoc(doc(db, 'agenda_sesiones', sessionId)),
        getDocs(collection(db, 'ejercicios')),
        getDocs(collection(db, 'clientes')),
        getDocs(collection(db, 'plantillas_sesiones'))
      ]);

      const cMap: Record<string, { nombre: string; programador: string }> = {};
      const cliList: any[] = [];
      cliSnap.forEach(d => {
        const data = d.data();
        const nom = data.Alias || data.alias || data.Nombre_Cliente || data.nombre_completo || 'Sin nombre';
        const prog = data.Programador || data.programador || 'Sin asignar';
        cMap[d.id] = { nombre: nom, programador: prog };

        const est = (data.Estado_Cliente || data.estado || 'Activo').toLowerCase();
        if (!est.includes('baja') && !est.includes('inactivo')) {
          cliList.push({ id: d.id, nombre: nom });
        }
      });
      cliList.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setTodosLosClientes(cliList);

      const catList: any[] = [];
      catSnap.forEach(d => catList.push({ id: d.id, ...d.data() }));
      catList.sort((a, b) => (a.Nombre_Ejercicio || '').localeCompare(b.Nombre_Ejercicio || ''));
      setCatalogoEjercicios(catList);

      const plantList: any[] = [];
      plantSnap.forEach(d => plantList.push({ id: d.id, ...d.data() }));
      plantList.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      setPlantillasDisponibles(plantList);

      if (!sesSnap.exists()) {
        setSesionActual(null);
        setLoading(false);
        return;
      }

      const dataSes = { id: sesSnap.id, ...sesSnap.data() } as any;
      if (!dataSes.ejercicios) dataSes.ejercicios = [];

      const tipo = (dataSes.tipo_sesion || '').toLowerCase();
      const isSG = tipo.includes('small') || tipo.includes('group');
      setEsSmallGroup(isSG);

      if (isSG && dataSes.fecha_hora_inicio) {
        setNombreClienteHeader('Small Group');
        const qGroup = query(
          collection(db, 'agenda_sesiones'),
          where('fecha_hora_inicio', '==', dataSes.fecha_hora_inicio)
        );
        const snapGroup = await getDocs(qGroup);
        const idsG: string[] = [];
        const clientesG: { id: string; nom: string }[] = [];
        let ejerciciosComunes: any[] = dataSes.ejercicios || [];

        snapGroup.forEach(d => {
          const dData = d.data();
          const t = (dData.tipo_sesion || '').toLowerCase();
          if (t.includes('small') || t.includes('group')) {
            idsG.push(d.id);
            const idCli = dData.id_cliente || '';
            const cInfo = cMap[idCli];
            const nom = cInfo ? cInfo.nombre : dData.cliente_nombre || 'Cliente';
            if (!clientesG.some(c => (idCli && c.id === idCli) || c.nom === nom)) {
              clientesG.push({ id: idCli, nom });
            }
            if (ejerciciosComunes.length === 0 && dData.ejercicios && dData.ejercicios.length > 0) {
              ejerciciosComunes = dData.ejercicios;
            }
          }
        });

        setIdsGrupoActual(idsG);
        setSgClientesGrupo(clientesG);

        if ((dataSes.ejercicios || []).length === 0 && ejerciciosComunes.length > 0) {
          dataSes.ejercicios = ejerciciosComunes;
          const batch = writeBatch(db);
          idsG.forEach(idDoc => {
            batch.update(doc(db, 'agenda_sesiones', idDoc), { ejercicios: ejerciciosComunes });
          });
          await batch.commit();
        }
      } else {
        setIdsGrupoActual([sessionId]);
        const cInfo = cMap[dataSes.id_cliente] || {
          nombre: dataSes.cliente_nombre || 'Desconocido',
          programador: 'Sin asignar'
        };
        setNombreClienteHeader(cInfo.nombre);
        setEntrenadorAsignado(cInfo.programador);
      }

      setSesionActual(dataSes);
    } catch (e) {
      console.error('Error cargando sesión:', e);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    cargarTodo();
  }, [cargarTodo]);

  useEffect(() => {
    return registerChangeListener(() => {
      cargarTodo();
    });
  }, [registerChangeListener, cargarTodo]);

  const guardarCambiosEnFirestore = async (
    nuevosEjercicios: any[],
    ordenCustomizado: boolean,
    labelUndo = 'Modificar ejercicios de la sesión'
  ) => {
    if (!sesionActual) return;
    const editorActual = userName || 'Entrenador';
    const fechaEdicion = new Date();
    const intSes = normalizarIntensidad(
      sesionActual.intensidad_sesion || sesionActual.intensidad || 'MED'
    );

    const prevEjercicios = clonarProfundo(sesionActual.ejercicios || []);
    const prevOrden = Boolean(sesionActual.orden_customizado);
    const prevEditor = sesionActual.ultimo_editor || null;
    const prevFechaEd = sesionActual.fecha_ultima_edicion || null;
    const prevInt = normalizarIntensidad(
      sesionActual.intensidad_sesion || sesionActual.intensidad || 'MED'
    );

    const payloadActualizacion = {
      ejercicios: nuevosEjercicios,
      intensidad_sesion: intSes,
      ultimo_editor: editorActual,
      fecha_ultima_edicion: fechaEdicion,
      orden_customizado: ordenCustomizado
    };

    const payloadUndo = {
      ejercicios: prevEjercicios,
      intensidad_sesion: prevInt,
      ultimo_editor: prevEditor,
      fecha_ultima_edicion: prevFechaEd,
      orden_customizado: prevOrden
    };

    try {
      const targetIds =
        esSmallGroup && idsGrupoActual.length > 0 ? idsGrupoActual : [sessionId];

      if (targetIds.length > 1) {
        const batch = writeBatch(db);
        targetIds.forEach(idDoc => {
          batch.update(doc(db, 'agenda_sesiones', idDoc), payloadActualizacion);
        });
        await batch.commit();
      } else {
        await updateDoc(doc(db, 'agenda_sesiones', sessionId), payloadActualizacion);
      }

      setSesionActual((prev: any) => ({
        ...prev,
        ...payloadActualizacion
      }));

      pushAction({
        label: labelUndo,
        undoOps: targetIds.map(idDoc => ({
          type: 'update',
          collection: 'agenda_sesiones',
          id: idDoc,
          data: payloadUndo
        })),
        redoOps: targetIds.map(idDoc => ({
          type: 'update',
          collection: 'agenda_sesiones',
          id: idDoc,
          data: payloadActualizacion
        })),
        showToast: false
      });
    } catch (e) {
      console.error('Error guardando sesión:', e);
      alert('Error al guardar en la base de datos.');
    }
  };

  const cambiarIntensidadSesion = async (nuevaIntRaw: string) => {
    if (!sesionActual) return;
    const nuevaInt = normalizarIntensidad(nuevaIntRaw);
    const prevInt = normalizarIntensidad(
      sesionActual.intensidad_sesion || sesionActual.intensidad || 'MED'
    );
    if (nuevaInt === prevInt) return;

    const editorActual = userName || 'Entrenador';
    const fechaEdicion = new Date();
    const targetIds =
      esSmallGroup && idsGrupoActual.length > 0 ? idsGrupoActual : [sessionId];

    try {
      const batch = writeBatch(db);
      targetIds.forEach(idDoc => {
        batch.update(doc(db, 'agenda_sesiones', idDoc), {
          intensidad_sesion: nuevaInt,
          ultimo_editor: editorActual,
          fecha_ultima_edicion: fechaEdicion
        });
      });
      await batch.commit();

      setSesionActual((prev: any) => ({
        ...prev,
        intensidad_sesion: nuevaInt,
        ultimo_editor: editorActual,
        fecha_ultima_edicion: fechaEdicion
      }));

      pushAction({
        label: `Cambiar intensidad de sesión a ${nuevaInt}`,
        undoOps: targetIds.map(idDoc => ({
          type: 'update',
          collection: 'agenda_sesiones',
          id: idDoc,
          data: { intensidad_sesion: prevInt }
        })),
        redoOps: targetIds.map(idDoc => ({
          type: 'update',
          collection: 'agenda_sesiones',
          id: idDoc,
          data: { intensidad_sesion: nuevaInt }
        })),
        showToast: true,
        toastMessage: `⚡ Intensidad de la sesión: ${nuevaInt}`
      });
    } catch (e) {
      console.error(e);
      alert('No se pudo actualizar la intensidad de la sesión.');
    }
  };

  // --- Drag & Drop Reordering ---
  const handleDragStart = (idx: number) => {
    dragIndexRef.current = idx;
  };

  const handleDropOnIndex = async (targetIdx: number) => {
    const fromIdx = dragIndexRef.current;
    dragIndexRef.current = null;
    if (fromIdx === null || fromIdx === targetIdx || !sesionActual) return;

    const list = [...(sesionActual.ejercicios || [])];
    const [moved] = list.splice(fromIdx, 1);
    list.splice(targetIdx, 0, moved);

    await guardarCambiosEnFirestore(list, true, 'Reordenar ejercicios de la sesión');
  };

  const borrarEjercicio = async (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (!sesionActual || !sesionActual.ejercicios) return;
    const ejBorrado = sesionActual.ejercicios[index];
    const nomEj = ejBorrado ? ejBorrado.Acrónimo || ejBorrado.Nombre_Ejercicio || 'Ejercicio' : 'Ejercicio';

    const nuevaLista = [...sesionActual.ejercicios];
    nuevaLista.splice(index, 1);

    await guardarCambiosEnFirestore(
      nuevaLista,
      Boolean(sesionActual.orden_customizado),
      `Quitar ejercicio "${nomEj}"`
    );
  };

  // --- Modal Add / Edit Exercise ---
  const getExistingSubgrupos = (): Record<string, string> => {
    const map: Record<string, string> = {};
    if (sesionActual && Array.isArray(sesionActual.ejercicios)) {
      sesionActual.ejercicios.forEach((ej: any) => {
        if (ej.Subgrupo && String(ej.Subgrupo).trim() !== '') {
          map[String(ej.Subgrupo).trim()] = ej.Subgrupo_Series || '';
        }
      });
    }
    return map;
  };

  const buscarUltimoPRCliente = async (idEj: string, nomEj: string) => {
    if (esSmallGroup || !sesionActual?.id_cliente || !idEj) return '';
    try {
      const q = query(
        collection(db, 'progreso_clientes'),
        where('id_cliente', '==', sesionActual.id_cliente)
      );
      const snap = await getDocs(q);
      const regs: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.id_ejercicio === idEj || data.nombre_ejercicio === nomEj) {
          const f = data.fecha?.toDate
            ? data.fecha.toDate()
            : data.fecha
            ? new Date(data.fecha)
            : new Date(0);
          regs.push({ ...data, f });
        }
      });
      if (regs.length > 0) {
        regs.sort((a, b) => b.f.getTime() - a.f.getTime());
        return String(regs[0].peso_levantado || '');
      }
    } catch (e) {
      console.error(e);
    }
    return '';
  };

  const seleccionarEjercicioCatalogo = async (ej: any) => {
    let bloqueDef = ordenBloques[0] || 'BLOQUE 1: MOVILIDAD - ACTIVACIÓN';
    const rawBloque = ej.Bloque || ej.Fase_Bloque;
    if (Array.isArray(rawBloque) && rawBloque.length > 0) bloqueDef = rawBloque[0];
    else if (typeof rawBloque === 'string' && rawBloque) {
      bloqueDef = rawBloque.split(',')[0].trim();
    }

    let matsDef: string[] = [];
    if (Array.isArray(ej.Material)) matsDef = [...ej.Material];
    else if (typeof ej.Material === 'string' && ej.Material) {
      matsDef = ej.Material.split(',').map((m: string) => m.trim()).filter(Boolean);
    }

    const sDef =
      ej.Series_Reps ||
      ej.Volumen_Series_Reps ||
      ej.Series ||
      ej.Series_Defecto ||
      seriesMaster[0] ||
      '3 x 10';
    const isCustomS = sDef && !seriesMaster.includes(sDef);

    const esProg = Boolean(ej.es_de_progreso === true && !esSmallGroup);
    let pesoAuto = '';
    let hintText = '';

    if (esProg) {
      const prVal = await buscarUltimoPRCliente(ej.id, ej.Nombre_Ejercicio);
      if (prVal) {
        pesoAuto = `${prVal} kg`;
        hintText = `(Último PR registrado: ${prVal} kg)`;
      } else {
        hintText = '(Sin PR registrado aún para este cliente)';
      }
    }

    setFormEx(prev => ({
      ...prev,
      id_ejercicio: ej.id,
      nombre_ejercicio: ej.Nombre_Ejercicio || '',
      es_de_progreso: esProg,
      guardar_progreso: esProg,
      prHint: hintText,
      acronimo: ej.Acrónimo || ej.Acronimo || '',
      bloque: ordenBloques.includes(bloqueDef) ? bloqueDef : prev.bloque,
      materiales: matsDef,
      seriesSelect: isCustomS ? 'CUSTOM' : sDef,
      seriesCustom: isCustomS ? sDef : '',
      peso: pesoAuto || prev.peso
    }));
    setExPanelOpen(false);
  };

  const abrirModalAnadir = (
    bloquePreseleccionado = '',
    subgrupoPreseleccionado = '',
    pautaSubgrupoPre = ''
  ) => {
    setEditingIndex(-1);
    setFilterMusculo('Todos');
    setFilterBloque('Todos');
    setFilterNivel('Todos');
    setFilterSubcat('Todos');
    setExSearchText('');
    setExPanelOpen(false);
    setMatPanelOpen(false);

    const existingSub = getExistingSubgrupos();
    const isKnownSub = subgrupoPreseleccionado && (
      ['Circuito 1', 'Circuito 2', 'Superserie 1', 'Superserie 2', 'Biserie 1', 'EMOM', 'AMRAP', 'Tabata'].includes(subgrupoPreseleccionado) ||
      existingSub[subgrupoPreseleccionado] !== undefined
    );

    setFormEx({
      id_ejercicio: '',
      nombre_ejercicio: '',
      es_de_progreso: false,
      guardar_progreso: false,
      prHint: '',
      detalle: '',
      acronimo: '',
      materiales: [],
      bloque: bloquePreseleccionado || ordenBloques[0] || 'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
      subgrupoSelect: subgrupoPreseleccionado
        ? isKnownSub
          ? subgrupoPreseleccionado
          : 'CUSTOM_SUB'
        : '',
      subgrupoCustom: subgrupoPreseleccionado && !isKnownSub ? subgrupoPreseleccionado : '',
      subgrupoSeries:
        pautaSubgrupoPre ||
        (subgrupoPreseleccionado ? existingSub[subgrupoPreseleccionado] || '' : ''),
      seriesSelect: seriesMaster[0] || '3 x 10',
      seriesCustom: '',
      peso: '',
      intensidad: normalizarIntensidad(
        sesionActual?.intensidad_sesion || sesionActual?.intensidad || 'MED'
      )
    });
    setModalAddOpen(true);
  };

  const abrirModalEditar = (index: number) => {
    if (!sesionActual || !sesionActual.ejercicios[index]) return;
    const ej = sesionActual.ejercicios[index];
    setEditingIndex(index);
    setExPanelOpen(false);
    setMatPanelOpen(false);

    const ejCat = catalogoEjercicios.find(
      c => c.id === ej.id_ejercicio || c.Nombre_Ejercicio === ej.Nombre_Ejercicio
    );
    const esProg = Boolean(ejCat && ejCat.es_de_progreso === true && !esSmallGroup);

    const matGuardado = ej.Material_Adaptacion || '';
    const mats = matGuardado
      ? String(matGuardado)
          .split(',')
          .map(m => m.trim())
          .filter(Boolean)
      : [];

    const existingSub = getExistingSubgrupos();
    const subGuardado = ej.Subgrupo || '';
    const knownSubOptions = [
      'Circuito 1',
      'Circuito 2',
      'Superserie 1',
      'Superserie 2',
      'Biserie 1',
      'EMOM',
      'AMRAP',
      'Tabata',
      ...Object.keys(existingSub)
    ];
    const isCustomSub = subGuardado && !knownSubOptions.includes(subGuardado);

    const seriesGuardada = ej.Series || '';
    const isCustomSeries = seriesGuardada && !seriesMaster.includes(seriesGuardada);

    setFormEx({
      id_ejercicio: ej.id_ejercicio || ejCat?.id || '',
      nombre_ejercicio: ej.Nombre_Ejercicio || '',
      es_de_progreso: esProg,
      guardar_progreso: Boolean(ej.guardar_progreso),
      prHint: '',
      detalle: ej.Detalle || '',
      acronimo: ej.Acrónimo || ej.alias || '',
      materiales: mats,
      bloque: ej.Bloque || ordenBloques[0] || 'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
      subgrupoSelect: isCustomSub ? 'CUSTOM_SUB' : subGuardado,
      subgrupoCustom: isCustomSub ? subGuardado : '',
      subgrupoSeries: ej.Subgrupo_Series || '',
      seriesSelect: isCustomSeries ? 'CUSTOM' : seriesGuardada || seriesMaster[0] || '3 x 10',
      seriesCustom: isCustomSeries ? seriesGuardada : '',
      peso: ej.Peso || '',
      intensidad: normalizarIntensidad(
        ej.intensidad ||
          ej.Intensidad ||
          sesionActual.intensidad_sesion ||
          sesionActual.intensidad ||
          'MED'
      )
    });
    setModalAddOpen(true);
  };

  const guardarEjercicio = async () => {
    if (!formEx.nombre_ejercicio) {
      alert('Por favor, selecciona un ejercicio del buscador.');
      return;
    }

    const seriesVal =
      formEx.seriesSelect === 'CUSTOM'
        ? formEx.seriesCustom.trim() || 'S/N'
        : formEx.seriesSelect;

    const subgrupoFinal =
      formEx.subgrupoSelect === 'CUSTOM_SUB'
        ? formEx.subgrupoCustom.trim()
        : formEx.subgrupoSelect;

    const pautaSubgrupoFinal = subgrupoFinal ? formEx.subgrupoSeries.trim() : '';

    const objetoEjercicio = {
      id_ejercicio: formEx.id_ejercicio,
      Nombre_Ejercicio: formEx.nombre_ejercicio,
      Acrónimo: formEx.acronimo.trim() || formEx.nombre_ejercicio,
      Detalle: formEx.detalle.trim(),
      Material_Adaptacion: formEx.materiales.join(', '),
      Bloque: formEx.bloque,
      Subgrupo: subgrupoFinal,
      Subgrupo_Series: pautaSubgrupoFinal,
      Series: seriesVal,
      Peso: formEx.peso.trim(),
      intensidad: normalizarIntensidad(formEx.intensidad || 'MED'),
      guardar_progreso: formEx.guardar_progreso
    };

    const lista = [...(sesionActual.ejercicios || [])];
    const eraEdicion = editingIndex >= 0;

    if (eraEdicion) {
      lista[editingIndex] = objetoEjercicio;
    } else {
      lista.push(objetoEjercicio);
    }

    if (subgrupoFinal) {
      lista.forEach(item => {
        if (item.Bloque === formEx.bloque && item.Subgrupo === subgrupoFinal) {
          item.Subgrupo_Series = pautaSubgrupoFinal;
        }
      });
    }

    setModalAddOpen(false);
    const nomCorto = objetoEjercicio.Acrónimo || objetoEjercicio.Nombre_Ejercicio;
    await guardarCambiosEnFirestore(
      lista,
      Boolean(sesionActual.orden_customizado),
      eraEdicion ? `Editar ejercicio "${nomCorto}"` : `Añadir ejercicio "${nomCorto}"`
    );
  };

  // --- Modal Importar Plantilla ---
  const confirmarImportacion = async () => {
    if (!selectedPlantillaId || !sesionActual) return;
    const p = plantillasDisponibles.find(pl => pl.id === selectedPlantillaId);
    if (!p || !p.ejercicios || p.ejercicios.length === 0) {
      alert('La plantilla seleccionada no contiene ejercicios.');
      return;
    }

    if (sesionActual.ejercicios && sesionActual.ejercicios.length > 0) {
      if (
        !window.confirm(
          '¿Deseas añadir los ejercicios de esta plantilla a los que ya tienes programados en la sesión?'
        )
      ) {
        return;
      }
    }

    setImporting(true);
    try {
      const clonados = JSON.parse(JSON.stringify(p.ejercicios));
      const nuevaLista = [...(sesionActual.ejercicios || []), ...clonados];
      let ordenCust = Boolean(sesionActual.orden_customizado);
      if (p.orden_customizado && (!sesionActual.ejercicios || sesionActual.ejercicios.length === 0)) {
        ordenCust = true;
      }
      await guardarCambiosEnFirestore(
        nuevaLista,
        ordenCust,
        `Importar plantilla "${p.nombre || 'Plantilla'}"`
      );
      setModalImportarOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setImporting(false);
    }
  };

  // --- Modal Enviar Rutina ---
  const abrirModalEnviar = () => {
    if (!sesionActual?.ejercicios || sesionActual.ejercicios.length === 0) {
      alert('Añade al menos un ejercicio a la sesión antes de enviarla.');
      return;
    }
    const defaultClient = !esSmallGroup && sesionActual.id_cliente ? sesionActual.id_cliente : '';
    setModalEnviar({
      open: true,
      targetClientId: defaultClient,
      targetSessionId: '',
      targetSessionsList: [],
      loadingTarget: Boolean(defaultClient),
      saving: false
    });
    if (defaultClient) {
      cargarSesionesDestino(defaultClient);
    }
  };

  const cargarSesionesDestino = async (idCli: string) => {
    if (!idCli) {
      setModalEnviar(prev => ({
        ...prev,
        targetClientId: '',
        targetSessionId: '',
        targetSessionsList: [],
        loadingTarget: false
      }));
      return;
    }
    setModalEnviar(prev => ({ ...prev, targetClientId: idCli, loadingTarget: true }));
    try {
      const q = query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', idCli));
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach(d => {
        if (d.id === sessionId || idsGrupoActual.includes(d.id)) return;
        const data = d.data();
        if (data.estado_sesion === 'Cancelada') return;
        const f = data.fecha_hora_inicio?.toDate
          ? data.fecha_hora_inicio.toDate()
          : data.fecha_hora_inicio
          ? new Date(data.fecha_hora_inicio)
          : null;
        if (!f) return;
        list.push({ id: d.id, ...data, fecha: f });
      });
      list.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
      setModalEnviar(prev => ({
        ...prev,
        targetSessionsList: list,
        targetSessionId: list[0]?.id || '',
        loadingTarget: false
      }));
    } catch (e) {
      console.error(e);
      setModalEnviar(prev => ({ ...prev, loadingTarget: false }));
    }
  };

  const confirmarEnvio = async () => {
    if (!modalEnviar.targetSessionId || !sesionActual) return;
    setModalEnviar(prev => ({ ...prev, saving: true }));
    try {
      const docDestSnap = await getDoc(doc(db, 'agenda_sesiones', modalEnviar.targetSessionId));
      if (!docDestSnap.exists()) throw new Error('Sesión destino no existe');
      const dataDest = docDestSnap.data();

      if (dataDest.ejercicios && dataDest.ejercicios.length > 0) {
        if (
          !window.confirm(
            '⚠️ La sesión de destino YA TIENE ejercicios programados. ¿Deseas fusionar y añadir estos ejercicios a los que ya existen?'
          )
        ) {
          setModalEnviar(prev => ({ ...prev, saving: false }));
          return;
        }
      }

      const clonados = JSON.parse(JSON.stringify(sesionActual.ejercicios));
      const finales = [...(dataDest.ejercicios || []), ...clonados];
      const editorActual = userName || 'Entrenador';
      const fechaEd = new Date();
      const intClon = normalizarIntensidad(
        sesionActual.intensidad_sesion || sesionActual.intensidad || 'MED'
      );

      const tipoDest = (dataDest.tipo_sesion || '').toLowerCase();
      if (tipoDest.includes('small') || tipoDest.includes('group')) {
        const qG = query(
          collection(db, 'agenda_sesiones'),
          where('fecha_hora_inicio', '==', dataDest.fecha_hora_inicio)
        );
        const snapG = await getDocs(qG);
        const batch = writeBatch(db);
        snapG.forEach(d => {
          const t = (d.data().tipo_sesion || '').toLowerCase();
          if (t.includes('small') || t.includes('group')) {
            batch.update(doc(db, 'agenda_sesiones', d.id), {
              ejercicios: finales,
              intensidad_sesion: intClon,
              ultimo_editor: editorActual,
              fecha_ultima_edicion: fechaEd
            });
          }
        });
        await batch.commit();
      } else {
        await updateDoc(doc(db, 'agenda_sesiones', modalEnviar.targetSessionId), {
          ejercicios: finales,
          intensidad_sesion: intClon,
          ultimo_editor: editorActual,
          fecha_ultima_edicion: fechaEd
        });
      }

      setModalEnviar(prev => ({ ...prev, open: false, saving: false }));
      alert('¡Ejercicios enviados y copiados con éxito!');
    } catch (e) {
      console.error(e);
      alert('Error al enviar ejercicios.');
      setModalEnviar(prev => ({ ...prev, saving: false }));
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
        Cargando sesión...
      </div>
    );
  }

  if (!sesionActual) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50 }}>
        <h2>La sesión no existe</h2>
        <button type="button" className="btn-primary" onClick={() => onNavigate('agenda')}>
          Volver a Agenda
        </button>
      </div>
    );
  }

  // Date & Editor formatting
  let fechaMetaStr = '📌 Sesión programada sin fecha asignada';
  if (!sesionActual.sin_fecha && sesionActual.fecha_hora_inicio) {
    const f = sesionActual.fecha_hora_inicio.toDate
      ? sesionActual.fecha_hora_inicio.toDate()
      : new Date(sesionActual.fecha_hora_inicio);
    const d = f.getUTCDate().toString().padStart(2, '0');
    const m = (f.getUTCMonth() + 1).toString().padStart(2, '0');
    const y = f.getUTCFullYear();
    const h = f.getUTCHours().toString().padStart(2, '0');
    const min = f.getUTCMinutes().toString().padStart(2, '0');
    fechaMetaStr = `Fecha: ${d}/${m}/${y} a las ${h}:${min}`;
  }

  let editorMetaStr = 'Sin ediciones registradas';
  if (sesionActual.ultimo_editor) {
    let fEdStr = '';
    if (sesionActual.fecha_ultima_edicion) {
      const fEd = sesionActual.fecha_ultima_edicion.toDate
        ? sesionActual.fecha_ultima_edicion.toDate()
        : new Date(sesionActual.fecha_ultima_edicion);
      const dE = fEd.getDate().toString().padStart(2, '0');
      const mE = (fEd.getMonth() + 1).toString().padStart(2, '0');
      const hE = fEd.getHours().toString().padStart(2, '0');
      const minE = fEd.getMinutes().toString().padStart(2, '0');
      fEdStr = ` (${dE}/${mE} a las ${hE}:${minE})`;
    }
    editorMetaStr = `${sesionActual.ultimo_editor}${fEdStr}`;
  }

  const intSesActual = normalizarIntensidad(
    sesionActual.intensidad_sesion || sesionActual.intensidad || 'MED'
  );

  // Build ordered exercise items with original index for rendering
  const ejerciciosRaw: any[] = sesionActual.ejercicios || [];
  let itemsConIndice = ejerciciosRaw.map((ej, idx) => ({ ej, indexOriginal: idx }));

  if (!sesionActual.orden_customizado) {
    itemsConIndice.sort((a, b) => {
      const bA = a.ej.Bloque || 'General';
      const bB = b.ej.Bloque || 'General';
      const idxA = ordenBloques.indexOf(bA);
      const idxB = ordenBloques.indexOf(bB);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return bA.localeCompare(bB);
    });
  }

  // Filtered exercises in modalAdd
  const filteredCatalog = catalogoEjercicios.filter(ej => {
    const matchText =
      (ej.Nombre_Ejercicio || '').toLowerCase().includes(exSearchText.toLowerCase()) ||
      (ej.Acrónimo || ej.Acronimo || '').toLowerCase().includes(exSearchText.toLowerCase());

    const checkArr = (campo: any, filtro: string) => {
      if (filtro === 'Todos') return true;
      if (!campo) return false;
      if (Array.isArray(campo)) return campo.includes(filtro);
      return String(campo)
        .split(',')
        .map(s => s.trim())
        .includes(filtro);
    };

    return (
      matchText &&
      checkArr(ej.Grupo_Muscular, filterMusculo) &&
      checkArr(ej.Bloque || ej.Fase_Bloque, filterBloque) &&
      checkArr(ej.Nivel_Dificultad || ej.Nivel || ej.nivel, filterNivel) &&
      checkArr(ej['Subcategoría'] || ej.Subcategoria, filterSubcat)
    );
  });

  const existingSubgruposMap = getExistingSubgrupos();
  const baseSubgrupos = [
    'Circuito 1',
    'Circuito 2',
    'Superserie 1',
    'Superserie 2',
    'Biserie 1',
    'EMOM',
    'AMRAP',
    'Tabata'
  ];

  return (
    <div className="container">
      <div className="breadcrumb">
        <a
          href="#agenda"
          onClick={e => {
            e.preventDefault();
            onNavigate('agenda');
          }}
        >
          Agenda
        </a>{' '}
        &gt; Programar Sesión
      </div>

      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div className="header-info">
          <h1>
            {esSmallGroup ? (
              'Programar: Small Group'
            ) : sesionActual.id_cliente ? (
              <>
                Programar:{' '}
                <a
                  href={`#ficha_cliente/${sesionActual.id_cliente}`}
                  className="client-link"
                  onClick={e => {
                    e.preventDefault();
                    onNavigate('ficha_cliente', sesionActual.id_cliente);
                  }}
                >
                  {nombreClienteHeader}
                </a>
              </>
            ) : (
              `Programar: ${nombreClienteHeader}`
            )}
          </h1>

          <div className="header-meta-group">
            <div className="meta-line">{fechaMetaStr}</div>
            {!esSmallGroup ? (
              <div className="meta-line">
                <span>Entrenador asignado:</span>
                <span className="trainer-pill">{entrenadorAsignado}</span>
              </div>
            ) : (
              <div className="meta-line">
                <span>Clientes en este grupo:</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {sgClientesGrupo.map((c, idx) => (
                    <span key={idx} className="sg-client-tag">
                      {c.id ? (
                        <a
                          href={`#ficha_cliente/${c.id}`}
                          className="client-link"
                          onClick={e => {
                            e.preventDefault();
                            onNavigate('ficha_cliente', c.id);
                          }}
                        >
                          {c.nom}
                        </a>
                      ) : (
                        c.nom
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="meta-line">
              <span>Última edición por:</span>
              <span className="editor-pill">{editorMetaStr}</span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSelectedPlantillaId(plantillasDisponibles[0]?.id || '');
              setModalImportarOpen(true);
            }}
          >
            📥 Importar Plantilla
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => abrirModalAnadir()}
          >
            + Añadir ejercicio
          </button>
          <button type="button" className="btn-outline" onClick={abrirModalEnviar}>
            ➡️ Enviar a
          </button>
        </div>
      </div>

      {/* Barra de Intensidad Global de la Sesión */}
      <div className="session-intensity-bar">
        <div className="session-intensity-bar-left">
          <span>⚡ Intensidad global de la sesión:</span>
          <span
            dangerouslySetInnerHTML={{
              __html: renderIntensityBadge(intSesActual)
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label
            style={{
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
              fontWeight: 600
            }}
          >
            Cambiar nivel:
          </label>
          <select
            className="session-intensity-select"
            value={intSesActual}
            onChange={e => cambiarIntensidadSesion(e.target.value)}
          >
            <option value="LOW">🟢 LOW (Baja)</option>
            <option value="MED">🟡 MED (Media)</option>
            <option value="HIGH">🔴 HIGH (Alta)</option>
          </select>
        </div>
      </div>

      {/* Session Preview */}
      <div className="session-preview">
        {itemsConIndice.length === 0 ? (
          <div className="empty-preview">
            No hay ejercicios en esta sesión. Haz clic en "+ Añadir ejercicio" o importa una plantilla.
          </div>
        ) : (
          (() => {
            let ultimoBloqueMostrado: string | null = null;
            let ultimoSubgrupoMostrado: string | null = null;

            return itemsConIndice.map((item, renderIdx) => {
              const ej = item.ej;
              const idx = item.indexOriginal;
              const b = ej.Bloque || 'General';
              const sub =
                ej.Subgrupo && String(ej.Subgrupo).trim() !== ''
                  ? String(ej.Subgrupo).trim()
                  : null;
              const subPauta =
                ej.Subgrupo_Series && String(ej.Subgrupo_Series).trim() !== ''
                  ? String(ej.Subgrupo_Series).trim()
                  : '';

              const showBlockHeader = b !== ultimoBloqueMostrado;
              if (showBlockHeader) {
                ultimoBloqueMostrado = b;
                ultimoSubgrupoMostrado = null;
              }

              const showSubHeader = sub && sub !== ultimoSubgrupoMostrado;
              if (sub) {
                ultimoSubgrupoMostrado = sub;
              } else {
                ultimoSubgrupoMostrado = null;
              }

              const acronimo = ej.Acrónimo || ej.alias || '';
              const nombre = ej.Nombre_Ejercicio || '';
              const tituloMostrar =
                acronimo && nombre && acronimo !== nombre
                  ? `${acronimo} · ${nombre}`
                  : acronimo || nombre || 'Ejercicio';

              const detallesArr: string[] = [];
              if (ej.Detalle && String(ej.Detalle).trim() !== '') detallesArr.push(ej.Detalle);
              if (ej.Material_Adaptacion && String(ej.Material_Adaptacion).trim() !== '') {
                detallesArr.push(`Mat: ${ej.Material_Adaptacion}`);
              }

              let prescStr = ej.Series || '';
              if (ej.Peso && String(ej.Peso).trim() !== '') {
                prescStr += (prescStr ? ' · ' : '') + `⚖️ ${ej.Peso}`;
              }

              const intEj = normalizarIntensidad(ej.intensidad || ej.Intensidad || 'MED');

              return (
                <React.Fragment key={`${idx}-${renderIdx}`}>
                  {showBlockHeader && <div className="block-title">{b}</div>}
                  {showSubHeader && (
                    <div className="subgroup-header">
                      <div className="subgroup-title-box">
                        <span className="subgroup-badge">🔄 SUBGRUPO / CIRCUITO</span>
                        <span className="subgroup-name">{sub}</span>
                        {subPauta && <span className="subgroup-pauta">{subPauta}</span>}
                      </div>
                      <button
                        type="button"
                        className="btn-add-subgroup-ex"
                        onClick={() => abrirModalAnadir(b, sub || '', subPauta)}
                      >
                        + Añadir a este subgrupo
                      </button>
                    </div>
                  )}
                  <div
                    className={`ex-item ${sub ? 'in-subgroup' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDropOnIndex(idx)}
                    onClick={() => abrirModalEditar(idx)}
                  >
                    <div
                      className="drag-handle"
                      title="Mantén pulsado y arrastra para reordenar"
                      onClick={e => e.stopPropagation()}
                    >
                      ⋮⋮
                    </div>
                    <div className="ex-item-info">
                      <span className="ex-item-title">
                        {tituloMostrar}
                        {ej.guardar_progreso && (
                          <span
                            title="Seguimiento de Progreso (PR) activo"
                            style={{ fontSize: '0.85rem', marginLeft: 4 }}
                          >
                            📈
                          </span>
                        )}
                      </span>
                      {detallesArr.length > 0 && (
                        <span className="ex-item-detail">{detallesArr.join('  |  ')}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                      <span className="ex-item-presc">
                        {prescStr}{' '}
                        <span
                          dangerouslySetInnerHTML={{
                            __html: renderIntensityBadge(intEj, { compact: true })
                          }}
                        />
                      </span>
                      <button
                        type="button"
                        className="btn-remove-ex"
                        title="Quitar ejercicio"
                        onClick={e => borrarEjercicio(e, idx)}
                      >
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
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              );
            });
          })()
        )}
      </div>

      {/* Modal Añadir / Editar Ejercicio */}
      {modalAddOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalAddOpen(false)}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>{editingIndex >= 0 ? 'Editar ejercicio' : 'Añadir ejercicio a la sesión'}</h2>
              <p>
                {editingIndex >= 0
                  ? 'Modifica los parámetros de prescripción de este ejercicio'
                  : 'Busca y configura el ejercicio para prescribirlo'}
              </p>
            </div>

            <div className="form-grid">
              {/* Selector Ejercicio */}
              <div className="form-group full">
                <label>Ejercicio *</label>
                <div className="custom-dropdown">
                  <div
                    className="dropdown-trigger"
                    onClick={() => setExPanelOpen(!exPanelOpen)}
                  >
                    <span
                      style={{
                        color: formEx.nombre_ejercicio ? 'var(--text-main)' : 'var(--text-muted)',
                        fontWeight: formEx.nombre_ejercicio ? 600 : 400
                      }}
                    >
                      {formEx.nombre_ejercicio
                        ? `${formEx.acronimo ? `${formEx.acronimo} · ` : ''}${formEx.nombre_ejercicio}`
                        : 'Buscar y seleccionar ejercicio...'}
                    </span>
                    <span>▼</span>
                  </div>

                  {exPanelOpen && (
                    <div className="dropdown-panel active">
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 8,
                          marginBottom: 8
                        }}
                      >
                        <select
                          style={{
                            padding: 6,
                            fontSize: '0.8rem',
                            borderRadius: 6,
                            border: '1px solid var(--border)'
                          }}
                          value={filterMusculo}
                          onChange={e => setFilterMusculo(e.target.value)}
                        >
                          <option value="Todos">Todos los Grupos Musculares</option>
                          {gruposMuscularesMaster.map(m => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <select
                          style={{
                            padding: 6,
                            fontSize: '0.8rem',
                            borderRadius: 6,
                            border: '1px solid var(--border)'
                          }}
                          value={filterBloque}
                          onChange={e => setFilterBloque(e.target.value)}
                        >
                          <option value="Todos">Todos los Bloques</option>
                          {ordenBloques.map(b => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                        <select
                          style={{
                            padding: 6,
                            fontSize: '0.8rem',
                            borderRadius: 6,
                            border: '1px solid var(--border)'
                          }}
                          value={filterNivel}
                          onChange={e => setFilterNivel(e.target.value)}
                        >
                          <option value="Todos">Todos los Niveles</option>
                          {nivelesMaster.map(n => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                        <select
                          style={{
                            padding: 6,
                            fontSize: '0.8rem',
                            borderRadius: 6,
                            border: '1px solid var(--border)'
                          }}
                          value={filterSubcat}
                          onChange={e => setFilterSubcat(e.target.value)}
                        >
                          <option value="Todos">Todas las Subcategorías</option>
                          {subcategoriasMaster.map(sc => (
                            <option key={sc} value={sc}>
                              {sc}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="dropdown-search-container">
                        <input
                          type="text"
                          placeholder="Escribe el nombre o acrónimo..."
                          value={exSearchText}
                          onChange={e => setExSearchText(e.target.value)}
                          autoFocus
                        />
                      </div>

                      <div className="ex-list-panel">
                        {filteredCatalog.length === 0 ? (
                          <div style={{ padding: 15, textAlign: 'center', color: 'var(--text-muted)' }}>
                            No se encontraron ejercicios con estos filtros
                          </div>
                        ) : (
                          filteredCatalog.map(ej => {
                            const acr = ej.Acrónimo ? `${ej.Acrónimo} · ` : '';
                            const musc = Array.isArray(ej.Grupo_Muscular)
                              ? ej.Grupo_Muscular.join(', ')
                              : ej.Grupo_Muscular || '';
                            const niv = Array.isArray(ej.Nivel)
                              ? ej.Nivel.join(', ')
                              : ej.Nivel || '';

                            return (
                              <div
                                key={ej.id}
                                className="ex-option"
                                onClick={() => seleccionarEjercicioCatalogo(ej)}
                              >
                                <div>
                                  <strong>{acr}</strong>
                                  {ej.Nombre_Ejercicio}
                                  {ej.es_de_progreso && ' 📈'}
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {niv && (
                                    <span
                                      className="ex-option-tags"
                                      style={{ background: '#e0f2fe', color: '#0369a1' }}
                                    >
                                      {niv}
                                    </span>
                                  )}
                                  {musc && <span className="ex-option-tags">{musc}</span>}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* PR Checkbox if es_de_progreso */}
              {formEx.es_de_progreso && (
                <div
                  className="form-group full"
                  style={{
                    background: '#f0fdf4',
                    padding: '10px 15px',
                    borderRadius: 8,
                    border: '1px solid #bbf7d0'
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      margin: 0,
                      color: '#166534',
                      fontWeight: 700
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: 18, height: 18 }}
                      checked={formEx.guardar_progreso}
                      onChange={e =>
                        setFormEx(prev => ({ ...prev, guardar_progreso: e.target.checked }))
                      }
                    />
                    📈 Hacer seguimiento de Progreso (PR) en esta sesión
                    {formEx.prHint && (
                      <span
                        style={{
                          fontWeight: 'normal',
                          fontSize: '0.8rem',
                          marginLeft: 'auto',
                          color: '#15803d'
                        }}
                      >
                        {formEx.prHint}
                      </span>
                    )}
                  </label>
                </div>
              )}

              <div className="form-group full">
                <label>Detalle / Especificación (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: Unilateral, Tempo 3-1-1, Agarre neutro..."
                  value={formEx.detalle}
                  onChange={e => setFormEx(prev => ({ ...prev, detalle: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Acrónimo (Adaptable a la sesión)</label>
                <input
                  type="text"
                  placeholder="Se autocompleta al elegir..."
                  value={formEx.acronimo}
                  onChange={e => setFormEx(prev => ({ ...prev, acronimo: e.target.value }))}
                />
              </div>

              {/* Multi-select Material */}
              <div className="form-group">
                <label>Material / Adaptación</label>
                <div className="custom-dropdown">
                  <div
                    className="dropdown-trigger"
                    onClick={() => setMatPanelOpen(!matPanelOpen)}
                  >
                    <span
                      style={{
                        color:
                          formEx.materiales.length > 0 ? 'var(--text-main)' : 'var(--text-muted)',
                        fontWeight: formEx.materiales.length > 0 ? 600 : 400
                      }}
                    >
                      {formEx.materiales.length === 0
                        ? 'Seleccionar...'
                        : formEx.materiales.length <= 2
                        ? formEx.materiales.join(', ')
                        : `${formEx.materiales.length} seleccionados`}
                    </span>
                    <span>▼</span>
                  </div>

                  {matPanelOpen && (
                    <div className="dropdown-panel active">
                      <div className="dropdown-search-container">
                        <input
                          type="text"
                          placeholder="Buscar material..."
                          value={matSearch}
                          onChange={e => setMatSearch(e.target.value)}
                        />
                      </div>
                      <div className="dropdown-options">
                        {materialesMaster
                          .filter(m => m.toLowerCase().includes(matSearch.toLowerCase()))
                          .map(m => {
                            const checked = formEx.materiales.includes(m);
                            return (
                              <label key={m} className="dropdown-option">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setFormEx(prev => ({
                                      ...prev,
                                      materiales: checked
                                        ? prev.materiales.filter(x => x !== m)
                                        : [...prev.materiales, m]
                                    }));
                                  }}
                                />
                                <span>{m}</span>
                              </label>
                            );
                          })}
                      </div>
                      <div className="dropdown-actions">
                        <button
                          type="button"
                          className="btn-limpiar"
                          onClick={() => setFormEx(prev => ({ ...prev, materiales: [] }))}
                        >
                          Limpiar
                        </button>
                        <button
                          type="button"
                          className="btn-listo"
                          onClick={() => setMatPanelOpen(false)}
                        >
                          Listo
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>Bloque en la sesión</label>
                <select
                  value={formEx.bloque}
                  onChange={e => setFormEx(prev => ({ ...prev, bloque: e.target.value }))}
                >
                  {ordenBloques.map(b => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subgrupo / Circuito */}
              <div
                className="form-group full"
                style={{
                  background: '#f0fdfa',
                  padding: 15,
                  borderRadius: 8,
                  border: '1px solid #ccfbf1'
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: '#0f766e',
                    marginBottom: 10
                  }}
                >
                  🔄 Agrupación en Subgrupo / Circuito / Superserie (Opcional)
                </div>
                <div className="form-grid" style={{ marginBottom: 0, gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Subgrupo dentro del bloque</label>
                    <select
                      value={formEx.subgrupoSelect}
                      onChange={e => {
                        const val = e.target.value;
                        setFormEx(prev => ({
                          ...prev,
                          subgrupoSelect: val,
                          subgrupoSeries:
                            existingSubgruposMap[val] !== undefined
                              ? existingSubgruposMap[val]
                              : prev.subgrupoSeries
                        }));
                      }}
                    >
                      <option value="">Ninguno (Ejercicio suelto)</option>
                      {Object.keys(existingSubgruposMap).map(s => (
                        <option key={`ex-${s}`} value={s}>
                          🔄 {s} (Ya en sesión)
                        </option>
                      ))}
                      {baseSubgrupos
                        .filter(s => existingSubgruposMap[s] === undefined)
                        .map(s => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      <option value="CUSTOM_SUB">✏️ Otro nombre personalizado...</option>
                    </select>
                    {formEx.subgrupoSelect === 'CUSTOM_SUB' && (
                      <input
                        type="text"
                        placeholder="Ej: Triserie A, Circuito Core..."
                        style={{ marginTop: 8 }}
                        value={formEx.subgrupoCustom}
                        onChange={e =>
                          setFormEx(prev => ({ ...prev, subgrupoCustom: e.target.value }))
                        }
                      />
                    )}
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Vueltas / Pauta del Subgrupo</label>
                    <input
                      type="text"
                      placeholder="Ej: 3 vueltas, 4 rondas, EMOM 10'..."
                      value={formEx.subgrupoSeries}
                      onChange={e =>
                        setFormEx(prev => ({ ...prev, subgrupoSeries: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Series y Repeticiones */}
              <div className="form-group">
                <label>Series y repeticiones (Individual)</label>
                <select
                  value={formEx.seriesSelect}
                  onChange={e => setFormEx(prev => ({ ...prev, seriesSelect: e.target.value }))}
                >
                  {seriesMaster.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option
                    value="CUSTOM"
                    style={{ fontWeight: 'bold', color: 'var(--accent-dark)' }}
                  >
                    ✏️ Texto libre (Ej: 12-10-8)...
                  </option>
                </select>
                {formEx.seriesSelect === 'CUSTOM' && (
                  <input
                    type="text"
                    placeholder="Escribe la pauta (Ej: 12-10-8-6)..."
                    style={{ marginTop: 8 }}
                    value={formEx.seriesCustom}
                    onChange={e => setFormEx(prev => ({ ...prev, seriesCustom: e.target.value }))}
                  />
                )}
              </div>

              <div className="form-group">
                <label>Peso / Carga pautada (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: 20kg, 12kg c/u, Banda roja..."
                  value={formEx.peso}
                  onChange={e => setFormEx(prev => ({ ...prev, peso: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Intensidad del Ejercicio</label>
                <select
                  value={formEx.intensidad}
                  onChange={e => setFormEx(prev => ({ ...prev, intensidad: e.target.value }))}
                >
                  <option value="LOW">🟢 LOW (Baja)</option>
                  <option value="MED">🟡 MED (Media)</option>
                  <option value="HIGH">🔴 HIGH (Alta)</option>
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalAddOpen(false)}
              >
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={guardarEjercicio}>
                {editingIndex >= 0 ? 'Actualizar ejercicio' : 'Guardar ejercicio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar Plantilla */}
      {modalImportarOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 450 }}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalImportarOpen(false)}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>📥 Importar Plantilla</h2>
              <p>Selecciona una sesión predefinida para cargar todos sus ejercicios de golpe</p>
            </div>

            <div className="form-group">
              <label>Plantilla a importar</label>
              <select
                value={selectedPlantillaId}
                onChange={e => setSelectedPlantillaId(e.target.value)}
              >
                {plantillasDisponibles.length === 0 ? (
                  <option value="">No hay plantillas creadas aún</option>
                ) : (
                  (() => {
                    const porTipo: Record<string, any[]> = {};
                    plantillasDisponibles.forEach(p => {
                      const t = p.tipo_sesion || 'General';
                      if (!porTipo[t]) porTipo[t] = [];
                      porTipo[t].push(p);
                    });
                    return Object.keys(porTipo).map(t => (
                      <optgroup key={t} label={`TIPO: ${t.toUpperCase()}`}>
                        {porTipo[t].map(p => (
                          <option key={p.id} value={p.id}>
                            {p.nombre} ({p.nivel || 'Todos'}) -{' '}
                            {p.ejercicios ? p.ejercicios.length : 0} ej.
                          </option>
                        ))}
                      </optgroup>
                    ));
                  })()
                )}
              </select>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalImportarOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={importing || !selectedPlantillaId}
                onClick={confirmarImportacion}
              >
                {importing ? 'Importando...' : 'Cargar Ejercicios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Enviar Rutina */}
      {modalEnviar.open && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 480 }}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalEnviar(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>➡️ Enviar Ejercicios a otra Sesión</h2>
              <p>Copia todos los ejercicios de esta sesión en la sesión de otro día o cliente</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div className="form-group">
                <label>1. Selecciona el Cliente de destino</label>
                <select
                  value={modalEnviar.targetClientId}
                  onChange={e => cargarSesionesDestino(e.target.value)}
                >
                  <option value="">-- Elige un cliente --</option>
                  {todosLosClientes.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>2. Selecciona la Sesión de destino</label>
                <select
                  value={modalEnviar.targetSessionId}
                  disabled={
                    modalEnviar.loadingTarget || modalEnviar.targetSessionsList.length === 0
                  }
                  onChange={e =>
                    setModalEnviar(prev => ({ ...prev, targetSessionId: e.target.value }))
                  }
                >
                  {modalEnviar.loadingTarget ? (
                    <option value="">Buscando sesiones del cliente...</option>
                  ) : modalEnviar.targetSessionsList.length === 0 ? (
                    <option value="">Este cliente no tiene más sesiones agendadas</option>
                  ) : (
                    modalEnviar.targetSessionsList.map(s => {
                      const d = s.fecha.getUTCDate().toString().padStart(2, '0');
                      const m = (s.fecha.getUTCMonth() + 1).toString().padStart(2, '0');
                      const y = s.fecha.getUTCFullYear();
                      const h = s.fecha.getUTCHours().toString().padStart(2, '0');
                      const min = s.fecha.getUTCMinutes().toString().padStart(2, '0');
                      const diaSem = diasSemanaCortos[s.fecha.getUTCDay()];
                      const numEj = s.ejercicios ? s.ejercicios.length : 0;
                      const infoEj = numEj > 0 ? `(${numEj} ej. ya programados)` : '(Vacía)';
                      const tipo = (s.tipo_sesion || '').includes('Small') ? '[SG]' : '[Ind]';
                      return (
                        <option key={s.id} value={s.id}>
                          {diaSem} {d}/{m}/{y} a las {h}:{min} {tipo} {infoEj}
                        </option>
                      );
                    })
                  )}
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalEnviar(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={modalEnviar.saving || !modalEnviar.targetSessionId}
                onClick={confirmarEnvio}
              >
                {modalEnviar.saving ? 'Enviando...' : 'Confirmar y Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
