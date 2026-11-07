import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useUndo } from '../context/UndoContext';
import { cargarCatalogoMaestros, extraerListaMaster } from '../services/maestrosService';
import { coincideBusqueda } from '../utils/helpers';
import { confirmarDialogo } from '../utils/confirmDialog';
import {
  limpiarSesionesAntiguasYEjerciciosHuerfanos,
  contarReferenciasEjercicio,
  eliminarEjercicioConCascada
} from '../services/sessionCascadeService';

interface EjerciciosViewProps {
  onNavigate?: (tab: string, param?: string) => void;
}

const clonarProfundo = (obj: any) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

type MultiFieldKey =
  | 'patrones'
  | 'musculos'
  | 'bloques'
  | 'niveles'
  | 'materiales'
  | 'subcategorias'
  | 'zonas'
  | 'posiciones';

export const EjerciciosView: React.FC<EjerciciosViewProps> = () => {
  const { pushAction, registerChangeListener } = useUndo();

  const [ejerciciosData, setEjerciciosData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchText, setSearchText] = useState('');
  const [filterGrupo, setFilterGrupo] = useState('Todos');
  const [filterMaterial, setFilterMaterial] = useState('Todos');
  const [filterSubcategoria, setFilterSubcategoria] = useState('Todos');

  const [openNiveles, setOpenNiveles] = useState<Record<string, boolean>>({});
  const [collapsedBloques, setCollapsedBloques] = useState<Record<string, boolean>>({});

  // Master lists
  const [ordenNiveles, setOrdenNiveles] = useState<string[]>([
    'Básico',
    'Intermedio',
    'Avanzado',
    'Todos los niveles',
    'Sin nivel'
  ]);
  const [ordenBloques, setOrdenBloques] = useState<string[]>([
    'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
    'BLOQUE 2: FUERZA - PRINCIPAL',
    'BLOQUE 3: COMPENSATORIO - ACCESORIO',
    'BLOQUE 4: METABÓLICO - ACONDICIONAMIENTO',
    'General'
  ]);
  const [patronesList, setPatronesList] = useState<string[]>([]);
  const [musculosList, setMusculosList] = useState<string[]>([]);
  const [materialesList, setMaterialesList] = useState<string[]>([]);
  const [subcategoriasList, setSubcategoriasList] = useState<string[]>([]);
  const [zonasList, setZonasList] = useState<string[]>([]);
  const [posicionesList, setPosicionesList] = useState<string[]>([]);
  const [seriesList, setSeriesList] = useState<string[]>(['3 x 10']);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<MultiFieldKey | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState<Record<MultiFieldKey, string>>({
    patrones: '',
    musculos: '',
    bloques: '',
    niveles: '',
    materiales: '',
    subcategorias: '',
    zonas: '',
    posiciones: ''
  });

  const [formEj, setFormEj] = useState({
    nombre: '',
    acronimo: '',
    patrones: [] as string[],
    musculos: [] as string[],
    bloques: [] as string[],
    niveles: [] as string[],
    materiales: [] as string[],
    subcategorias: [] as string[],
    zonas: [] as string[],
    posiciones: [] as string[],
    series_defecto: '3 x 10',
    video_url: '',
    es_de_progreso: false
  });

  const cargarEjercicios = useCallback(async () => {
    setLoading(true);
    try {
      await limpiarSesionesAntiguasYEjerciciosHuerfanos();
      const snap = await getDocs(collection(db, 'ejercicios'));
      const list: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        const toArray = (val: any): string[] => {
          if (!val) return [];
          if (Array.isArray(val)) return val.map(x => String(x).trim()).filter(Boolean);
          return String(val)
            .split(',')
            .map(x => x.trim())
            .filter(Boolean);
        };
        list.push({
          id: d.id,
          raw: data,
          nombre: data.Nombre_Ejercicio || data.nombre_ejercicio || data.nombre || 'Sin nombre',
          acronimo: data['Acrónimo'] || data.Acronimo || data.acronimo || '-',
          patrones: toArray(
            data.Patron_Movimiento || data.Patron_Motor || data.patron_movimiento
          ),
          musculos: toArray(data.Grupo_Muscular || data.grupo_muscular),
          materiales: toArray(data.Material || data.material),
          bloques: toArray(data.Bloque || data.Fase_Bloque || data.bloque),
          niveles: toArray(data.Nivel_Dificultad || data.Nivel || data.nivel),
          subcategorias: toArray(data['Subcategoría'] || data.Subcategoria || data.subcategoria),
          zonas: toArray(data['Zona Articulación'] || data.Zona_Articulacion || data.zona),
          posiciones: toArray(data['Posición'] || data.Posicion || data.posicion),
          series_defecto:
            data.Series_Reps ||
            data.Volumen_Series_Reps ||
            data.Series ||
            data.Series_Defecto ||
            '3 x 10',
          video_url:
            data.Video_URL ||
            data.URL_Video ||
            data['Video / Enlace'] ||
            data.Video_Enlace ||
            '',
          es_de_progreso: Boolean(data.es_de_progreso === true)
        });
      });
      setEjerciciosData(list);
    } catch (e) {
      console.error('Error al cargar catálogo de ejercicios:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const maestros = await cargarCatalogoMaestros();
        const nivs = extraerListaMaster(maestros, 'Ejercicios', ['Niveles', 'Nivel de Dificultad']);
        if (nivs.length > 0) setOrdenNiveles([...nivs, 'Sin nivel']);

        const bloqs = extraerListaMaster(maestros, 'Ejercicios', [
          'Bloques',
          'Bloque de la sesión en que se recomienda',
          'Bloque de recomendación'
        ]);
        if (bloqs.length > 0) setOrdenBloques([...bloqs, 'General']);

        setPatronesList(
          extraerListaMaster(maestros, 'Ejercicios', ['Patrón Motor', 'Patrón de movimiento'])
        );
        setMusculosList(
          extraerListaMaster(maestros, 'Ejercicios', ['Grupos de Ejercicios', 'Grupo muscular'])
        );
        setMaterialesList(
          extraerListaMaster(maestros, 'Ejercicios', ['Materiales', 'Material sugerido'])
        );
        setSubcategoriasList(
          extraerListaMaster(maestros, 'Ejercicios', ['Subcategorías', 'Subcategoría'])
        );
        setZonasList(
          extraerListaMaster(maestros, 'Ejercicios', [
            'Zona / Articulación',
            'Zona / Articulación (para movilidad/activación)'
          ])
        );
        setPosicionesList(extraerListaMaster(maestros, 'Ejercicios', ['Posición']));
        const sers = extraerListaMaster(maestros, 'Ejercicios', ['Series y Repeticiones']);
        if (sers.length > 0) setSeriesList(sers);
      } catch (e) {
        console.warn('Error cargando maestros en ejercicios:', e);
      }
      await cargarEjercicios();
    };
    init();
  }, [cargarEjercicios]);

  useEffect(() => {
    return registerChangeListener(() => {
      cargarEjercicios();
    });
  }, [registerChangeListener, cargarEjercicios]);

  const abrirModalNuevo = () => {
    setEditingId(null);
    setActiveDropdown(null);
    setFormEj({
      nombre: '',
      acronimo: '',
      patrones: [],
      musculos: [],
      bloques: [],
      niveles: [],
      materiales: [],
      subcategorias: [],
      zonas: [],
      posiciones: [],
      series_defecto: seriesList[0] || '3 x 10',
      video_url: '',
      es_de_progreso: false
    });
    setModalOpen(true);
  };

  const abrirModalEditar = (id: string) => {
    const ej = ejerciciosData.find(item => item.id === id);
    if (!ej) return;
    setEditingId(id);
    setActiveDropdown(null);
    setFormEj({
      nombre: ej.nombre !== 'Sin nombre' ? ej.nombre : '',
      acronimo: ej.acronimo !== '-' ? ej.acronimo : '',
      patrones: [...ej.patrones],
      musculos: [...ej.musculos],
      bloques: [...ej.bloques],
      niveles: [...ej.niveles],
      materiales: [...ej.materiales],
      subcategorias: [...ej.subcategorias],
      zonas: [...ej.zonas],
      posiciones: [...ej.posiciones],
      series_defecto: ej.series_defecto || seriesList[0] || '3 x 10',
      video_url: ej.video_url || '',
      es_de_progreso: Boolean(ej.es_de_progreso)
    });
    setModalOpen(true);
  };

  const guardarEjercicio = async () => {
    const nom = formEj.nombre.trim();
    const acr = formEj.acronimo.trim();
    if (!nom || !acr) {
      alert('El Nombre y el Acrónimo son obligatorios.');
      return;
    }

    setSaving(true);
    try {
      const eraEdicion = Boolean(editingId);
      const idTarget = editingId || `EJ-${Math.floor(100000 + Math.random() * 900000)}`;
      const ejPrevio = eraEdicion ? ejerciciosData.find(x => x.id === idTarget) : null;
      const prevRaw = ejPrevio ? clonarProfundo(ejPrevio.raw) : null;

      const datosGuardar = {
        Id_Ejercicio: idTarget,
        Nombre_Ejercicio: nom,
        Acrónimo: acr,
        Patron_Movimiento: formEj.patrones.join(', '),
        Grupo_Muscular: formEj.musculos.join(', '),
        Bloque: formEj.bloques.join(', '),
        Nivel_Dificultad: formEj.niveles.join(', '),
        Nivel: formEj.niveles.join(', '),
        Material: formEj.materiales.join(', '),
        Subcategoría: formEj.subcategorias.join(', '),
        Subcategoria: formEj.subcategorias.join(', '),
        'Zona Articulación': formEj.zonas.join(', '),
        Zona_Articulacion: formEj.zonas.join(', '),
        Posición: formEj.posiciones.join(', '),
        Posicion: formEj.posiciones.join(', '),
        Series_Reps: formEj.series_defecto,
        Series_Defecto: formEj.series_defecto,
        Video_URL: formEj.video_url.trim(),
        URL_Video: formEj.video_url.trim(),
        es_de_progreso: formEj.es_de_progreso
      };

      await setDoc(doc(db, 'ejercicios', idTarget), datosGuardar, { merge: true });

      if (eraEdicion && prevRaw) {
        pushAction({
          label: `Editar ejercicio "${acr} · ${nom}"`,
          undoOps: [
            { type: 'set', collection: 'ejercicios', id: idTarget, data: prevRaw }
          ],
          redoOps: [
            {
              type: 'set',
              collection: 'ejercicios',
              id: idTarget,
              data: { ...prevRaw, ...datosGuardar }
            }
          ],
          showToast: true,
          toastMessage: `✓ Ejercicio "${acr}" actualizado`
        });
      } else {
        pushAction({
          label: `Crear ejercicio "${acr} · ${nom}"`,
          undoOps: [{ type: 'delete', collection: 'ejercicios', id: idTarget }],
          redoOps: [
            { type: 'set', collection: 'ejercicios', id: idTarget, data: datosGuardar }
          ],
          showToast: true,
          toastMessage: `✓ Ejercicio "${acr}" creado`
        });
      }

      setModalOpen(false);
      await cargarEjercicios();
    } catch (e) {
      console.error('Error guardando ejercicio:', e);
      alert('Hubo un error al guardar el ejercicio.');
    } finally {
      setSaving(false);
    }
  };

  const eliminarEjercicio = async (id: string, nombre: string) => {
    const ejPrevio = ejerciciosData.find(x => x.id === id);
    const prevRaw = ejPrevio ? clonarProfundo(ejPrevio.raw) : null;
    const altId = prevRaw
      ? String(prevRaw.Id_Ejercicio || prevRaw.ID_Ejercicio || prevRaw.id_ejercicio || '').trim()
      : '';

    let avisoCascada =
      'Se eliminará en cascada de cualquier sesión, plantilla o registro de progreso donde estuviera asignado.';
    try {
      const refs = await contarReferenciasEjercicio(id, nombre, altId);
      const partes: string[] = [];
      if (refs.sesionesCount > 0) {
        partes.push(`${refs.sesionesCount} ${refs.sesionesCount === 1 ? 'sesión' : 'sesiones'}`);
      }
      if (refs.plantillasCount > 0) {
        partes.push(
          `${refs.plantillasCount} ${refs.plantillasCount === 1 ? 'plantilla' : 'plantillas'}`
        );
      }
      if (refs.progresoCount > 0) {
        partes.push(
          `${refs.progresoCount} ${refs.progresoCount === 1 ? 'registro PR' : 'registros PR'}`
        );
      }
      if (partes.length > 0) {
        avisoCascada =
          `⚠️ AVISO DE BORRADO EN CASCADA:\n` +
          `Este ejercicio está asignado actualmente en ${partes.join(', ')}.\n` +
          `Al eliminarlo del catálogo, también se quitará automáticamente en cascada de todas esas sesiones, plantillas y registros.`;
      }
    } catch (e) {
      console.warn('Error contando referencias del ejercicio:', e);
    }

    if (
      !(await confirmarDialogo(
        `¿Estás seguro de que deseas eliminar permanentemente el ejercicio "${nombre}" del catálogo?\n\n${avisoCascada}\n\nPodrás deshacer toda la operación con Ctrl+Z.`,
        {
          titulo: 'Eliminar ejercicio (Borrado en cascada)',
          textoConfirmar: 'Sí, eliminar en cascada',
          danger: true
        }
      ))
    ) {
      return;
    }

    try {
      const res = await eliminarEjercicioConCascada({
        idEjercicio: id,
        nombreEjercicio: nombre,
        rawEjercicio: prevRaw
      });
      setEjerciciosData(prev => prev.filter(e => e.id !== id));

      const extraMsg =
        res.sesionesAfectadas > 0 || res.plantillasAfectadas > 0
          ? ` (limpiado de ${res.sesionesAfectadas} sesiones y ${res.plantillasAfectadas} plantillas)`
          : '';

      pushAction({
        label: `Eliminar ejercicio "${nombre}"${extraMsg}`,
        undoOps: res.undoOps,
        redoOps: res.redoOps,
        showToast: true,
        toastMessage: `🗑️ Ejercicio "${nombre}" eliminado${extraMsg}`
      });
    } catch (e) {
      console.error(e);
      alert('Error al eliminar el ejercicio en cascada.');
    }
  };

  const toggleMultiOption = (field: MultiFieldKey, val: string) => {
    setFormEj(prev => {
      const current = prev[field];
      const exists = current.includes(val);
      return {
        ...prev,
        [field]: exists ? current.filter(x => x !== val) : [...current, val]
      };
    });
  };

  const renderMultiDropdown = (
    field: MultiFieldKey,
    label: string,
    options: string[],
    fullWidth = false
  ) => {
    const selected = formEj[field];
    const isOpen = activeDropdown === field;
    const searchVal = dropdownSearch[field] || '';
    const filteredOpts = options.filter(o =>
      coincideBusqueda(o, searchVal)
    );

    let triggerText = 'Seleccionar...';
    if (selected.length > 0 && selected.length <= 2) {
      triggerText = selected.join(', ');
    } else if (selected.length > 2) {
      triggerText = `${selected.length} seleccionados`;
    }

    return (
      <div className={`form-group ${fullWidth ? 'full' : ''}`}>
        <label>{label}</label>
        <div className="custom-dropdown">
          <div
            className="dropdown-trigger"
            onClick={() => setActiveDropdown(isOpen ? null : field)}
          >
            <span
              style={{
                color: selected.length > 0 ? 'var(--text-main)' : 'var(--text-muted)',
                fontWeight: selected.length > 0 ? 600 : 400
              }}
            >
              {triggerText}
            </span>
            <span>▼</span>
          </div>

          {isOpen && (
            <div className="dropdown-panel active">
              <div className="dropdown-search-container">
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={searchVal}
                  onChange={e =>
                    setDropdownSearch(prev => ({ ...prev, [field]: e.target.value }))
                  }
                />
              </div>
              <div className="dropdown-options">
                {Array.from(new Set([...selected, ...filteredOpts]))
                  .filter(opt => coincideBusqueda(opt, searchVal))
                  .sort((a, b) => {
                    const aSel = selected.includes(a);
                    const bSel = selected.includes(b);
                    if (aSel && !bSel) return -1;
                    if (!aSel && bSel) return 1;
                    return 0;
                  })
                  .map(opt => (
                    <label key={opt} className="dropdown-option">
                      <input
                        type="checkbox"
                        checked={selected.includes(opt)}
                        onChange={() => toggleMultiOption(field, opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
              </div>
              <div className="dropdown-actions">
                <button
                  type="button"
                  className="btn-limpiar"
                  onClick={() => setFormEj(prev => ({ ...prev, [field]: [] }))}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  className="btn-listo"
                  onClick={() => setActiveDropdown(null)}
                >
                  Listo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Filtering
  const filtrados = ejerciciosData.filter(e => {
    const matchText =
      coincideBusqueda(e.nombre, searchText) ||
      coincideBusqueda(e.acronimo, searchText);
    const matchGrupo = filterGrupo === 'Todos' || e.musculos.includes(filterGrupo);
    const matchMat = filterMaterial === 'Todos' || e.materiales.includes(filterMaterial);
    const matchSub =
      filterSubcategoria === 'Todos' || e.subcategorias.includes(filterSubcategoria);
    return matchText && matchGrupo && matchMat && matchSub;
  });

  // Hierarchical structure: Nivel -> Bloque -> Ejercicios
  const estructura: Record<string, Record<string, any[]>> = {};
  filtrados.forEach(e => {
    const nivs = e.niveles.length > 0 ? e.niveles : ['Sin nivel'];
    const bloqs = e.bloques.length > 0 ? e.bloques : ['General'];

    nivs.forEach((n: string) => {
      if (!estructura[n]) estructura[n] = {};
      bloqs.forEach((b: string) => {
        if (!estructura[n][b]) estructura[n][b] = [];
        if (!estructura[n][b].some(item => item.id === e.id)) {
          estructura[n][b].push(e);
        }
      });
    });
  });

  const nivelesPresentes = Object.keys(estructura).sort((a, b) => {
    const idxA = ordenNiveles.indexOf(a);
    const idxB = ordenNiveles.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const isSearchingOrFiltering =
    searchText.trim() !== '' ||
    filterGrupo !== 'Todos' ||
    filterMaterial !== 'Todos' ||
    filterSubcategoria !== 'Todos';

  return (
    <div className="container">
      <div className="page-header">
        <h1>Catálogo de ejercicios</h1>
        <button type="button" className="btn-primary" onClick={abrirModalNuevo}>
          + Nuevo ejercicio
        </button>
      </div>

      <div className="controls-bar">
        <div className="search-box">
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
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre o acrónimo..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={filterGrupo}
          onChange={e => setFilterGrupo(e.target.value)}
        >
          <option value="Todos">Todos los grupos</option>
          {musculosList.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={filterMaterial}
          onChange={e => setFilterMaterial(e.target.value)}
        >
          <option value="Todos">Todos los materiales</option>
          {materialesList.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={filterSubcategoria}
          onChange={e => setFilterSubcategoria(e.target.value)}
        >
          <option value="Todos">Todas las subcategorías</option>
          {subcategoriasList.map(sc => (
            <option key={sc} value={sc}>
              {sc}
            </option>
          ))}
        </select>

        <span className="total-count">{filtrados.length} ejercicios</span>
      </div>

      <div id="accordionsContainer">
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            Cargando catálogo de ejercicios...
          </div>
        ) : filtrados.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              padding: 40,
              background: 'var(--surface)',
              borderRadius: 12,
              border: '1px solid var(--border)'
            }}
          >
            No se encontraron ejercicios con estos filtros.
          </div>
        ) : (
          nivelesPresentes.map(nivel => {
            const bloquesObj = estructura[nivel];
            const idsUnicosNivel = new Set<string>();
            Object.values(bloquesObj).forEach(arr =>
              arr.forEach(item => idsUnicosNivel.add(item.id))
            );

            const isOpen = isSearchingOrFiltering ? true : Boolean(openNiveles[nivel]);

            const bloquesPresentes = Object.keys(bloquesObj).sort((a, b) => {
              const idxA = ordenBloques.indexOf(a);
              const idxB = ordenBloques.indexOf(b);
              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
              if (idxA !== -1) return -1;
              if (idxB !== -1) return 1;
              return a.localeCompare(b);
            });

            return (
              <div key={nivel} className="level-accordion">
                <div
                  className="level-header"
                  onClick={() =>
                    setOpenNiveles(prev => ({ ...prev, [nivel]: !isOpen }))
                  }
                >
                  <div className="level-title">
                    <span>NIVEL: {nivel}</span>
                    <span className="level-badge">{idsUnicosNivel.size} ejercicios</span>
                  </div>
                  <span
                    className="chevron-icon"
                    style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  >
                    <svg
                      width="20"
                      height="20"
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

                {isOpen && (
                  <div className="level-content">
                    {bloquesPresentes.map(bloque => {
                      const listaEj = [...bloquesObj[bloque]].sort((a, b) =>
                        a.nombre.localeCompare(b.nombre)
                      );

                      const blockKey = `${nivel}__${bloque}`;
                      const isBlockClosed = Boolean(collapsedBloques[blockKey]);

                      return (
                        <div key={bloque} className="block-section">
                          <div
                            className="block-header"
                            onClick={() =>
                              setCollapsedBloques(prev => ({
                                ...prev,
                                [blockKey]: !prev[blockKey]
                              }))
                            }
                          >
                            <span>{bloque}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>{listaEj.length}</span>
                              <span
                                className="chevron-icon"
                                style={{
                                  transform: isBlockClosed ? 'rotate(-90deg)' : 'rotate(0deg)'
                                }}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </span>
                            </div>
                          </div>
                          {!isBlockClosed && (
                            <table>
                              <thead>
                                <tr>
                                  <th style={{ width: '15%' }}>Acrónimo</th>
                                  <th style={{ width: '25%' }}>Nombre</th>
                                  <th style={{ width: '18%' }}>Patrón</th>
                                  <th style={{ width: '17%' }}>Músculo</th>
                                  <th style={{ width: '17%' }}>Material</th>
                                  <th style={{ width: '8%', textAlign: 'right' }} />
                                </tr>
                              </thead>
                              <tbody>
                                {listaEj.map(e => (
                                  <tr key={e.id}>
                                    <td>
                                      <span
                                        className="acronimo-link"
                                        title="Haz clic para editar este ejercicio"
                                        onClick={() => abrirModalEditar(e.id)}
                                      >
                                        {e.acronimo}
                                      </span>
                                      {e.es_de_progreso && (
                                        <span
                                          title="Ejercicio de Progreso (PR)"
                                          style={{ fontSize: '0.85rem', marginLeft: 4 }}
                                        >
                                          📈
                                        </span>
                                      )}
                                    </td>
                                    <td>{e.nombre}</td>
                                    <td>{e.patrones.join(', ') || '-'}</td>
                                    <td>{e.musculos.join(', ') || '-'}</td>
                                    <td>{e.materiales.join(', ') || '-'}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <button
                                        type="button"
                                        className="btn-icon del"
                                        title="Eliminar"
                                        onClick={() => eliminarEjercicio(e.id, e.nombre)}
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
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal Nuevo / Editar Ejercicio */}
      {modalOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalOpen(false)}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>{editingId ? 'Editar ejercicio' : 'Nuevo ejercicio'}</h2>
              <p>
                {editingId
                  ? 'Modifica los parámetros del ejercicio en el catálogo'
                  : 'Añade un nuevo ejercicio al catálogo del gimnasio'}
              </p>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Nombre del ejercicio *</label>
                <input
                  type="text"
                  placeholder="Ej: Sentadilla Goblet"
                  value={formEj.nombre}
                  onChange={e => setFormEj(prev => ({ ...prev, nombre: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Acrónimo *</label>
                <input
                  type="text"
                  placeholder="Ej: SQ-GOB"
                  value={formEj.acronimo}
                  onChange={e => setFormEj(prev => ({ ...prev, acronimo: e.target.value }))}
                />
              </div>

              {renderMultiDropdown('patrones', 'Patrón de movimiento', patronesList)}
              {renderMultiDropdown('musculos', 'Grupo muscular', musculosList)}
              {renderMultiDropdown(
                'bloques',
                'Bloque de recomendación',
                ordenBloques.filter(b => b !== 'General'),
                true
              )}
              {renderMultiDropdown(
                'niveles',
                'Nivel de Dificultad',
                ordenNiveles.filter(n => n !== 'Sin nivel')
              )}
              {renderMultiDropdown('materiales', 'Material sugerido', materialesList)}
              {renderMultiDropdown('subcategorias', 'Subcategoría', subcategoriasList)}
              {renderMultiDropdown('zonas', 'Zona / Articulación', zonasList)}
              {renderMultiDropdown('posiciones', 'Posición', posicionesList)}

              <div className="form-group">
                <label>Series y Repeticiones</label>
                <select
                  value={formEj.series_defecto}
                  onChange={e =>
                    setFormEj(prev => ({ ...prev, series_defecto: e.target.value }))
                  }
                >
                  {seriesList.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full">
                <label>URL del vídeo (Opcional)</label>
                <div className="url-input-group">
                  <input
                    type="url"
                    placeholder="https://youtube.com/..."
                    value={formEj.video_url}
                    onChange={e =>
                      setFormEj(prev => ({ ...prev, video_url: e.target.value }))
                    }
                  />
                  {formEj.video_url.trim() && (
                    <a
                      href={formEj.video_url.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-youtube"
                      title="Abrir vídeo en una pestaña nueva"
                    >
                      ▶ Ver en YouTube
                    </a>
                  )}
                </div>
              </div>

              <div
                className="form-group full"
                style={{
                  background: '#f0fdf4',
                  padding: '12px 15px',
                  borderRadius: 8,
                  border: '1px solid #bbf7d0',
                  marginTop: 5
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
                    fontSize: '0.9rem'
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ width: 18, height: 18, cursor: 'pointer', margin: 0 }}
                    checked={formEj.es_de_progreso}
                    onChange={e =>
                      setFormEj(prev => ({ ...prev, es_de_progreso: e.target.checked }))
                    }
                  />
                  <span>
                    📈 <strong>Este es un "Ejercicio de Progreso"</strong> (Aparecerá en la pestaña Progreso de los clientes para registrar sus PRs de peso máximo)
                  </span>
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving}
                onClick={guardarEjercicio}
              >
                {saving
                  ? 'Guardando...'
                  : editingId
                  ? 'Actualizar ejercicio'
                  : 'Guardar ejercicio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
