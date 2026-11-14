import React, { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useUndo } from '../context/UndoContext';
import { cargarCatalogoMaestros, extraerListaMaster } from '../services/maestrosService';
import {
  normalizarIntensidad,
  renderIntensityBadge,
  formatIntensityOptionLabel,
  DEFAULT_INTENSIDADES_SESION,
  coincideBusqueda
} from '../utils/helpers';

interface EditarPlantillaViewProps {
  plantillaId: string;
  onNavigate: (tab: string, param?: string) => void;
}

const clonarProfundo = (obj: any) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

export const EditarPlantillaView: React.FC<EditarPlantillaViewProps> = ({
  plantillaId,
  onNavigate
}) => {
  const { pushAction, registerChangeListener } = useUndo();

  const [plantillaActual, setPlantillaActual] = useState<any>(null);
  const [catalogoEjercicios, setCatalogoEjercicios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [ordenBloques, setOrdenBloques] = useState<string[]>([
    'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
    'BLOQUE 2: FUERZA - PRINCIPAL',
    'BLOQUE 3: COMPENSATORIO - ACCESORIO',
    'BLOQUE 4: METABÓLICO - ACONDICIONAMIENTO'
  ]);
  const [tiposSesionMaster, setTiposSesionMaster] = useState<string[]>([
    'Fuerza',
    'Metabólico',
    'Movilidad',
    'Readaptación',
    'Full Body',
    'Tren Superior',
    'Tren Inferior'
  ]);
  const [intensidadesMaster, setIntensidadesMaster] = useState<string[]>(
    DEFAULT_INTENSIDADES_SESION
  );
  const [gruposMuscularesMaster, setGruposMuscularesMaster] = useState<string[]>([]);
  const [nivelesMaster, setNivelesMaster] = useState<string[]>([
    'Básico',
    'Intermedio',
    'Avanzado'
  ]);
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

  // Modal Editar Datos de la Plantilla (Nombre, Tipo de Sesión, Intensidad, Nivel)
  const [modalEditInfoOpen, setModalEditInfoOpen] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [formInfo, setFormInfo] = useState({
    nombre: '',
    tipo_sesion: '',
    intensidad: 'MED',
    nivel: ''
  });

  const dragIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Modal Añadir / Editar Ejercicio
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [exPanelOpen, setExPanelOpen] = useState(false);
  const [matPanelOpen, setMatPanelOpen] = useState(false);
  const [matSearch, setMatSearch] = useState('');

  const [filterMusculo, setFilterMusculo] = useState('Todos');
  const [filterBloque, setFilterBloque] = useState('Todos');
  const [filterNivel, setFilterNivel] = useState('Todos');
  const [filterSubcat, setFilterSubcat] = useState('Todos');
  const [exSearchText, setExSearchText] = useState('');

  useEffect(() => {
    if (!modalAddOpen) {
      setExSearchText('');
      setMatSearch('');
      setExPanelOpen(false);
      setMatPanelOpen(false);
    }
  }, [modalAddOpen]);

  useEffect(() => {
    if (!exPanelOpen) setExSearchText('');
  }, [exPanelOpen]);

  useEffect(() => {
    if (!matPanelOpen) setMatSearch('');
  }, [matPanelOpen]);

  const [formEx, setFormEx] = useState({
    id_ejercicio: '',
    nombre_ejercicio: '',
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

  const cargarTodo = useCallback(async () => {
    if (!plantillaId) return;
    setLoading(true);
    try {
      const maestros = await cargarCatalogoMaestros();
      const bloques = extraerListaMaster(maestros, 'Ejercicios', [
        'Bloques',
        'Bloque de la sesión en que se recomienda',
        'Bloque de recomendación'
      ]);
      if (bloques.length > 0) setOrdenBloques(bloques);

      const tipos = extraerListaMaster(maestros, 'Sesiones', [
        'Tipo de Sesión',
        'Tipo de sesión',
        'Tipos de Sesión'
      ]);
      if (tipos.length > 0) setTiposSesionMaster(tipos);

      const ints = extraerListaMaster(maestros, 'Sesiones', [
        'Intensidad de la Sesión',
        'Intensidad de la sesión',
        'Intensidad'
      ]);
      if (ints.length > 0) setIntensidadesMaster(ints);

      const musc = extraerListaMaster(maestros, 'Ejercicios', [
        'Músculos',
        'Grupos de Ejercicios',
        'Grupo muscular'
      ]);
      if (musc.length > 0) setGruposMuscularesMaster(musc);

      const niv = extraerListaMaster(maestros, 'Ejercicios', ['Niveles', 'Nivel de Dificultad']);
      if (niv.length > 0) setNivelesMaster(niv);

      const subc = extraerListaMaster(maestros, 'Ejercicios', ['Subcategorías', 'Subcategoría']);
      if (subc.length > 0) setSubcategoriasMaster(subc);

      const mats = extraerListaMaster(maestros, 'Ejercicios', ['Materiales', 'Material sugerido']);
      if (mats.length > 0) setMaterialesMaster(mats);

      const sers = extraerListaMaster(maestros, 'Ejercicios', ['Series y Repeticiones']);
      if (sers.length > 0) setSeriesMaster(sers);
    } catch (e) {
      console.warn('Error cargando maestros en editar_plantilla:', e);
    }

    try {
      const [docSnap, catSnap] = await Promise.all([
        getDoc(doc(db, 'plantillas_sesiones', plantillaId)),
        getDocs(collection(db, 'ejercicios'))
      ]);

      const catList: any[] = [];
      catSnap.forEach(d => catList.push({ id: d.id, ...d.data() }));
      catList.sort((a, b) => (a.Nombre_Ejercicio || '').localeCompare(b.Nombre_Ejercicio || ''));
      setCatalogoEjercicios(catList);

      if (docSnap.exists()) {
        const data = { id: docSnap.id, ...docSnap.data() } as any;
        if (!data.ejercicios) data.ejercicios = [];
        setPlantillaActual(data);
      } else {
        setPlantillaActual(null);
      }
    } catch (e) {
      console.error('Error cargando plantilla:', e);
    } finally {
      setLoading(false);
    }
  }, [plantillaId]);

  useEffect(() => {
    cargarTodo();
  }, [cargarTodo]);

  useEffect(() => {
    return registerChangeListener(() => {
      cargarTodo();
    });
  }, [registerChangeListener, cargarTodo]);

  const guardarEnFirestore = async (
    nuevosEjercicios: any[],
    ordenCustomizado: boolean,
    labelUndo = 'Modificar plantilla'
  ) => {
    if (!plantillaActual) return;
    const prevEjercicios = clonarProfundo(plantillaActual.ejercicios || []);
    const prevOrden = Boolean(plantillaActual.orden_customizado);
    const intSes = normalizarIntensidad(
      plantillaActual.intensidad_sesion || plantillaActual.intensidad || plantillaActual.Intensidad || 'MED'
    );

    const payloadNext = {
      ejercicios: nuevosEjercicios,
      intensidad: intSes,
      Intensidad: intSes,
      intensidad_sesion: intSes,
      orden_customizado: ordenCustomizado
    };
    const payloadPrev = {
      ejercicios: prevEjercicios,
      intensidad: intSes,
      Intensidad: intSes,
      intensidad_sesion: intSes,
      orden_customizado: prevOrden
    };

    try {
      await updateDoc(doc(db, 'plantillas_sesiones', plantillaId), payloadNext);
      setPlantillaActual((prev: any) => ({ ...prev, ...payloadNext }));

      pushAction({
        label: labelUndo,
        undoOps: [
          {
            type: 'update',
            collection: 'plantillas_sesiones',
            id: plantillaId,
            data: payloadPrev
          }
        ],
        redoOps: [
          {
            type: 'update',
            collection: 'plantillas_sesiones',
            id: plantillaId,
            data: payloadNext
          }
        ],
        showToast: false
      });
    } catch (e) {
      console.error(e);
      alert('Error al guardar en la base de datos.');
    }
  };

  const cambiarIntensidadPlantilla = async (nuevaIntRaw: string) => {
    if (!plantillaActual) return;
    const nuevaInt = normalizarIntensidad(nuevaIntRaw);
    const prevInt = normalizarIntensidad(
      plantillaActual.intensidad_sesion || plantillaActual.intensidad || plantillaActual.Intensidad || 'MED'
    );
    if (nuevaInt === prevInt) return;

    try {
      await updateDoc(doc(db, 'plantillas_sesiones', plantillaId), {
        intensidad: nuevaInt,
        Intensidad: nuevaInt,
        intensidad_sesion: nuevaInt
      });
      setPlantillaActual((prev: any) => ({
        ...prev,
        intensidad: nuevaInt,
        Intensidad: nuevaInt,
        intensidad_sesion: nuevaInt
      }));

      pushAction({
        label: `Cambiar intensidad de plantilla a ${nuevaInt}`,
        undoOps: [
          {
            type: 'update',
            collection: 'plantillas_sesiones',
            id: plantillaId,
            data: { intensidad: prevInt, Intensidad: prevInt, intensidad_sesion: prevInt }
          }
        ],
        redoOps: [
          {
            type: 'update',
            collection: 'plantillas_sesiones',
            id: plantillaId,
            data: { intensidad: nuevaInt, Intensidad: nuevaInt, intensidad_sesion: nuevaInt }
          }
        ],
        showToast: true,
        toastMessage: `⚡ Intensidad de la plantilla: ${nuevaInt}`
      });
    } catch (e) {
      console.error(e);
      alert('No se pudo actualizar la intensidad de la plantilla.');
    }
  };

  const abrirModalEditarInfo = () => {
    if (!plantillaActual) return;
    setFormInfo({
      nombre: plantillaActual.nombre || '',
      tipo_sesion: plantillaActual.tipo_sesion || tiposSesionMaster[0] || 'Fuerza',
      intensidad: normalizarIntensidad(
        plantillaActual.intensidad_sesion ||
          plantillaActual.intensidad ||
          plantillaActual.Intensidad ||
          'MED'
      ),
      nivel: plantillaActual.nivel || nivelesMaster[0] || 'Básico'
    });
    setModalEditInfoOpen(true);
  };

  const guardarInfoPlantilla = async () => {
    if (!plantillaActual) return;
    const nuevoNombre = formInfo.nombre.trim();
    if (!nuevoNombre) {
      alert('El nombre de la plantilla es obligatorio.');
      return;
    }
    const nuevoTipo = formInfo.tipo_sesion || 'Fuerza';
    const nuevaInt = normalizarIntensidad(formInfo.intensidad || 'MED');
    const nuevoNivel = formInfo.nivel || 'Todos los niveles';

    const prevInt = normalizarIntensidad(
      plantillaActual.intensidad_sesion ||
        plantillaActual.intensidad ||
        plantillaActual.Intensidad ||
        'MED'
    );

    const prevData = {
      nombre: plantillaActual.nombre || '',
      tipo_sesion: plantillaActual.tipo_sesion || '',
      intensidad: prevInt,
      Intensidad: prevInt,
      intensidad_sesion: prevInt,
      nivel: plantillaActual.nivel || ''
    };
    const nextData = {
      nombre: nuevoNombre,
      tipo_sesion: nuevoTipo,
      intensidad: nuevaInt,
      Intensidad: nuevaInt,
      intensidad_sesion: nuevaInt,
      nivel: nuevoNivel
    };

    if (
      prevData.nombre === nextData.nombre &&
      prevData.tipo_sesion === nextData.tipo_sesion &&
      prevData.intensidad_sesion === nextData.intensidad_sesion &&
      prevData.nivel === nextData.nivel
    ) {
      setModalEditInfoOpen(false);
      return;
    }

    setSavingInfo(true);
    try {
      await updateDoc(doc(db, 'plantillas_sesiones', plantillaId), nextData);
      setPlantillaActual((prev: any) => ({ ...prev, ...nextData }));
      setModalEditInfoOpen(false);

      pushAction({
        label: `Editar datos de plantilla "${nuevoNombre}"`,
        undoOps: [
          {
            type: 'update',
            collection: 'plantillas_sesiones',
            id: plantillaId,
            data: prevData
          }
        ],
        redoOps: [
          {
            type: 'update',
            collection: 'plantillas_sesiones',
            id: plantillaId,
            data: nextData
          }
        ],
        showToast: true,
        toastMessage: `✓ Datos de la plantilla "${nuevoNombre}" actualizados`
      });
    } catch (e) {
      console.error('Error actualizando datos de plantilla:', e);
      alert('No se pudieron actualizar los datos de la plantilla.');
    } finally {
      setSavingInfo(false);
    }
  };

  const getOrderedExercises = (): any[] => {
    const raw: any[] = plantillaActual?.ejercicios || [];
    const items = raw.map((ej, idx) => ({ ej, indexOriginal: idx }));
    if (!plantillaActual?.orden_customizado) {
      items.sort((a, b) => {
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
    return items.map(i => i.ej);
  };

  const handleDragStart = (renderIdx: number) => {
    dragIndexRef.current = renderIdx;
    dragOverIndexRef.current = renderIdx;
    setDraggingIdx(renderIdx);
  };

  const handleDropOnIndex = async (targetRenderIdx: number, explicitFromIdx?: number) => {
    const fromIdx = explicitFromIdx !== undefined ? explicitFromIdx : dragIndexRef.current;
    dragIndexRef.current = null;
    dragOverIndexRef.current = null;
    setDraggingIdx(null);
    setDragOverIdx(null);
    if (fromIdx === null || fromIdx === targetRenderIdx || !plantillaActual) return;

    const list = getOrderedExercises();
    if (fromIdx < 0 || fromIdx >= list.length || targetRenderIdx < 0 || targetRenderIdx >= list.length) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(targetRenderIdx, 0, moved);

    await guardarEnFirestore(list, true, 'Reordenar ejercicios de la plantilla');
  };

  const handleTouchStartDrag = (e: React.TouchEvent, renderIdx: number) => {
    e.stopPropagation();
    dragIndexRef.current = renderIdx;
    dragOverIndexRef.current = renderIdx;
    setDraggingIdx(renderIdx);
    setDragOverIdx(renderIdx);
  };

  const handleTouchMoveDrag = (e: React.TouchEvent) => {
    if (dragIndexRef.current === null) return;
    e.stopPropagation();
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const rowEl = el?.closest('[data-render-idx]');
    if (rowEl) {
      const idxAttr = rowEl.getAttribute('data-render-idx');
      if (idxAttr !== null) {
        const overIdx = parseInt(idxAttr, 10);
        if (!isNaN(overIdx) && overIdx !== dragOverIndexRef.current) {
          dragOverIndexRef.current = overIdx;
          setDragOverIdx(overIdx);
        }
      }
    }
  };

  const handleTouchEndDrag = (e: React.TouchEvent) => {
    if (dragIndexRef.current === null) return;
    e.stopPropagation();
    const fromIdx = dragIndexRef.current;
    const toIdx = dragOverIndexRef.current;
    dragIndexRef.current = null;
    dragOverIndexRef.current = null;
    setDraggingIdx(null);
    setDragOverIdx(null);
    if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
      handleDropOnIndex(toIdx, fromIdx);
    }
  };

  const borrarEjercicio = async (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (!plantillaActual || !plantillaActual.ejercicios) return;
    const ejBorrado = plantillaActual.ejercicios[index];
    const nomCorto = ejBorrado
      ? ejBorrado.Acrónimo || ejBorrado.Nombre_Ejercicio || 'Ejercicio'
      : 'Ejercicio';

    const nuevaLista = [...plantillaActual.ejercicios];
    nuevaLista.splice(index, 1);

    await guardarEnFirestore(
      nuevaLista,
      Boolean(plantillaActual.orden_customizado),
      `Quitar ejercicio "${nomCorto}" de plantilla`
    );
  };

  const getExistingSubgrupos = (): Record<string, string> => {
    const map: Record<string, string> = {};
    if (plantillaActual && Array.isArray(plantillaActual.ejercicios)) {
      plantillaActual.ejercicios.forEach((ej: any) => {
        if (ej.Subgrupo && String(ej.Subgrupo).trim() !== '') {
          map[String(ej.Subgrupo).trim()] = ej.Subgrupo_Series || '';
        }
      });
    }
    return map;
  };

  const seleccionarEjercicioCatalogo = (ej: any) => {
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

    setFormEx(prev => ({
      ...prev,
      id_ejercicio: ej.id,
      nombre_ejercicio: ej.Nombre_Ejercicio || '',
      acronimo: ej.Acrónimo || ej.Acronimo || '',
      bloque: ordenBloques.includes(bloqueDef) ? bloqueDef : prev.bloque,
      materiales: matsDef,
      seriesSelect: isCustomS ? 'CUSTOM' : sDef,
      seriesCustom: isCustomS ? sDef : ''
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
    setMatSearch('');
    setExPanelOpen(false);
    setMatPanelOpen(false);

    const existingSub = getExistingSubgrupos();
    const isKnownSub =
      subgrupoPreseleccionado &&
      (['Circuito 1', 'Circuito 2', 'Superserie 1', 'Superserie 2', 'Biserie 1', 'EMOM', 'AMRAP', 'Tabata'].includes(
        subgrupoPreseleccionado
      ) ||
        existingSub[subgrupoPreseleccionado] !== undefined);

    setFormEx({
      id_ejercicio: '',
      nombre_ejercicio: '',
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
        plantillaActual?.intensidad_sesion || plantillaActual?.intensidad || 'MED'
      )
    });
    setModalAddOpen(true);
  };

  const abrirModalEditar = (index: number) => {
    if (!plantillaActual || !plantillaActual.ejercicios[index]) return;
    const ej = plantillaActual.ejercicios[index];
    setEditingIndex(index);
    setFilterMusculo('Todos');
    setFilterBloque('Todos');
    setFilterNivel('Todos');
    setFilterSubcat('Todos');
    setExSearchText('');
    setMatSearch('');
    setExPanelOpen(false);
    setMatPanelOpen(false);

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
      id_ejercicio: ej.id_ejercicio || '',
      nombre_ejercicio: ej.Nombre_Ejercicio || '',
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
          plantillaActual.intensidad_sesion ||
          plantillaActual.intensidad ||
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
      intensidad: normalizarIntensidad(formEx.intensidad || 'MED')
    };

    const lista = [...(plantillaActual.ejercicios || [])];
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
    await guardarEnFirestore(
      lista,
      Boolean(plantillaActual.orden_customizado),
      eraEdicion
        ? `Editar ejercicio "${nomCorto}" en plantilla`
        : `Añadir ejercicio "${nomCorto}" a plantilla`
    );
  };

  if (loading) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
        Cargando plantilla...
      </div>
    );
  }

  if (!plantillaActual) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50 }}>
        <h2>La plantilla no existe</h2>
        <button type="button" className="btn-primary" onClick={() => onNavigate('plantillas')}>
          Volver a Plantillas
        </button>
      </div>
    );
  }

  const intSesActual = normalizarIntensidad(
    plantillaActual.intensidad_sesion || plantillaActual.intensidad || 'MED'
  );

  const ejerciciosRaw: any[] = plantillaActual.ejercicios || [];
  const itemsConIndice = ejerciciosRaw.map((ej, idx) => ({ ej, indexOriginal: idx }));

  if (!plantillaActual.orden_customizado) {
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

  const filteredCatalog = catalogoEjercicios.filter(ej => {
    const matchText =
      coincideBusqueda(ej.Nombre_Ejercicio, exSearchText) ||
      coincideBusqueda(ej.Acrónimo || ej.Acronimo, exSearchText);

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
          href="#plantillas"
          onClick={e => {
            e.preventDefault();
            onNavigate('plantillas');
          }}
        >
          Plantillas
        </a>{' '}
        &gt; Diseñador
      </div>

      <div className="page-header">
        <div>
          <h1>{plantillaActual.nombre || 'Sin nombre'}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={abrirModalEditarInfo}
            title="Cambiar nombre, tipo de sesión, intensidad o nivel de la plantilla"
          >
            <span className="ui-icon">✏️</span>
            <span>Editar datos</span>
          </button>
          <button type="button" className="btn-primary" onClick={() => abrirModalAnadir()}>
            + Añadir ejercicio
          </button>
        </div>
      </div>

      <div className="plantilla-meta-grid">
        <div className="plantilla-meta-col">
          <span className="plantilla-meta-label">Tipo de Sesión</span>
          <div className="plantilla-meta-value">
            {plantillaActual.tipo_sesion || 'General'}
          </div>
        </div>

        <div className="plantilla-meta-col">
          <span className="plantilla-meta-label">Intensidad</span>
          <div className="plantilla-meta-value">
            <span
              dangerouslySetInnerHTML={{
                __html: renderIntensityBadge(intSesActual)
              }}
            />
          </div>
        </div>

        <div className="plantilla-meta-col">
          <span className="plantilla-meta-label">Nivel Objetivo</span>
          <div className="plantilla-meta-value">
            <span className="pill-nivel">{plantillaActual.nivel || 'Todos'}</span>
          </div>
        </div>
      </div>

      <div className="session-preview">
        {itemsConIndice.length === 0 ? (
          <div className="empty-preview">
            No hay ejercicios en esta plantilla. Haz clic en "+ Añadir ejercicio" para empezar a diseñarla.
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
                        <span className="subgroup-badge">
                          <span className="ui-icon">🔄</span>
                          <span>SUBGRUPO / CIRCUITO</span>
                        </span>
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
                    className={`ex-item ${sub ? 'in-subgroup' : ''} ${draggingIdx === renderIdx ? 'dragging' : ''} ${dragOverIdx === renderIdx && draggingIdx !== renderIdx ? 'drag-over' : ''}`}
                    data-render-idx={renderIdx}
                    draggable
                    onDragStart={() => handleDragStart(renderIdx)}
                    onDragOver={e => {
                      e.preventDefault();
                      if (dragOverIdx !== renderIdx) {
                        dragOverIndexRef.current = renderIdx;
                        setDragOverIdx(renderIdx);
                      }
                    }}
                    onDragEnd={() => {
                      dragIndexRef.current = null;
                      dragOverIndexRef.current = null;
                      setDraggingIdx(null);
                      setDragOverIdx(null);
                    }}
                    onDrop={() => handleDropOnIndex(renderIdx)}
                    onClick={() => abrirModalEditar(idx)}
                  >
                    <div
                      className="drag-handle"
                      title="Mantén pulsado y arrastra para reordenar"
                      onClick={e => e.stopPropagation()}
                      onTouchStart={e => handleTouchStartDrag(e, renderIdx)}
                      onTouchMove={handleTouchMoveDrag}
                      onTouchEnd={handleTouchEndDrag}
                      onTouchCancel={handleTouchEndDrag}
                    >
                      ⋮⋮
                    </div>
                    <div className="ex-item-info">
                      <span className="ex-item-title">{tituloMostrar}</span>
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

      {/* Modal Añadir / Editar Ejercicio en Plantilla */}
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
              <h2>
                {editingIndex >= 0 ? 'Editar ejercicio' : 'Añadir ejercicio a la plantilla'}
              </h2>
              <p>Busca y configura el ejercicio para prescribirlo</p>
            </div>

            <div className="form-grid">
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
                <label>Acrónimo (Adaptable)</label>
                <input
                  type="text"
                  placeholder="Se autocompleta al elegir..."
                  value={formEx.acronimo}
                  onChange={e => setFormEx(prev => ({ ...prev, acronimo: e.target.value }))}
                />
              </div>

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
                        {Array.from(new Set([...formEx.materiales, ...materialesMaster]))
                          .filter(m => coincideBusqueda(m, matSearch))
                          .sort((a, b) => {
                            const aSel = formEx.materiales.includes(a);
                            const bSel = formEx.materiales.includes(b);
                            if (aSel && !bSel) return -1;
                            if (!aSel && bSel) return 1;
                            return 0;
                          })
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
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: '#0f766e',
                    marginBottom: 10
                  }}
                >
                  <span className="ui-icon">🔄</span>
                  <span>Agrupación en Subgrupo / Circuito / Superserie (Opcional)</span>
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
                          🔄 {s} (Ya en plantilla)
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
                <label>Peso / Carga orientativa (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: 70% RM, Moderado, 12kg..."
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
                  {Array.from(
                    new Set([
                      ...intensidadesMaster.map(normalizarIntensidad),
                      normalizarIntensidad(formEx.intensidad)
                    ])
                  ).map(intOption => (
                    <option key={intOption} value={intOption}>
                      {formatIntensityOptionLabel(intOption)}
                    </option>
                  ))}
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

      {/* Modal Editar Datos de la Plantilla (Nombre, Tipo de Sesión, Nivel) */}
      {modalEditInfoOpen && (
        <div
          className="modal-overlay"
          style={{ display: 'flex' }}
          onClick={() => !savingInfo && setModalEditInfoOpen(false)}
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              disabled={savingInfo}
              onClick={() => setModalEditInfoOpen(false)}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>
                <span className="ui-icon">✏️</span>
                <span>Editar Datos de la Plantilla</span>
              </h2>
              <p>Modifica el nombre, el tipo de sesión, la intensidad o el nivel objetivo</p>
            </div>

            <div className="form-group">
              <label>Nombre de la Plantilla *</label>
              <input
                type="text"
                placeholder="Ej: Empuje, Full Body Nivel 1..."
                value={formInfo.nombre}
                onChange={e => setFormInfo(prev => ({ ...prev, nombre: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Tipo de Sesión *</label>
              <select
                value={formInfo.tipo_sesion}
                onChange={e => setFormInfo(prev => ({ ...prev, tipo_sesion: e.target.value }))}
              >
                {Array.from(
                  new Set([
                    ...tiposSesionMaster,
                    ...(formInfo.tipo_sesion ? [formInfo.tipo_sesion] : [])
                  ])
                ).map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Intensidad *</label>
              <select
                value={formInfo.intensidad}
                onChange={e => setFormInfo(prev => ({ ...prev, intensidad: e.target.value }))}
              >
                {Array.from(
                  new Set([
                    ...intensidadesMaster.map(normalizarIntensidad),
                    normalizarIntensidad(formInfo.intensidad)
                  ])
                ).map(intOption => (
                  <option key={intOption} value={intOption}>
                    {formatIntensityOptionLabel(intOption)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Nivel Objetivo *</label>
              <select
                value={formInfo.nivel}
                onChange={e => setFormInfo(prev => ({ ...prev, nivel: e.target.value }))}
              >
                {Array.from(
                  new Set([
                    ...nivelesMaster,
                    'Todos los niveles',
                    ...(formInfo.nivel ? [formInfo.nivel] : [])
                  ])
                ).map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                disabled={savingInfo}
                onClick={() => setModalEditInfoOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={savingInfo}
                onClick={guardarInfoPlantilla}
              >
                {savingInfo ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
