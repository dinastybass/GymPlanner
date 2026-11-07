import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useUndo } from '../context/UndoContext';
import { cargarCatalogoMaestros, extraerListaMaster } from '../services/maestrosService';
import { normalizarIntensidad, renderIntensityBadge } from '../utils/helpers';
import { confirmarDialogo } from '../utils/confirmDialog';

interface PlantillasViewProps {
  onNavigate: (tab: string, param?: string) => void;
}

const clonarProfundo = (obj: any) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

export const PlantillasView: React.FC<PlantillasViewProps> = ({ onNavigate }) => {
  const { pushAction, registerChangeListener } = useUndo();

  const [plantillasData, setPlantillasData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [tiposSesionMaster, setTiposSesionMaster] = useState<string[]>([
    'Fuerza',
    'Metabólico',
    'Movilidad',
    'Readaptación',
    'Full Body',
    'Tren Superior',
    'Tren Inferior'
  ]);
  const [nivelesMaster, setNivelesMaster] = useState<string[]>([
    'Básico',
    'Intermedio',
    'Avanzado',
    'Todos los niveles'
  ]);

  const [collapsedTipos, setCollapsedTipos] = useState<Record<string, boolean>>({});

  // Modal Nueva Plantilla
  const [modalNuevaOpen, setModalNuevaOpen] = useState(false);
  const [savingNueva, setSavingNueva] = useState(false);
  const [formNueva, setFormNueva] = useState({
    tipo: 'Fuerza',
    nombre: '',
    nivel: 'Básico',
    intensidad: 'MED'
  });

  const cargarPlantillas = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'plantillas_sesiones'));
      const list: any[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() });
      });
      setPlantillasData(list);
    } catch (e) {
      console.error('Error cargando plantillas:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const maestros = await cargarCatalogoMaestros();
        const tipos = extraerListaMaster(maestros, 'Sesiones', [
          'Tipo de Sesión',
          'Tipo de sesión',
          'Tipos de Sesión'
        ]);
        if (tipos.length > 0) setTiposSesionMaster(tipos);

        const nivs = extraerListaMaster(maestros, 'Ejercicios', ['Niveles', 'Nivel de Dificultad']);
        if (nivs.length > 0) setNivelesMaster([...nivs, 'Todos los niveles']);
      } catch (e) {
        console.warn('Error cargando maestros en plantillas:', e);
      }
      await cargarPlantillas();
    };
    init();
  }, [cargarPlantillas]);

  useEffect(() => {
    return registerChangeListener(() => {
      cargarPlantillas();
    });
  }, [registerChangeListener, cargarPlantillas]);

  const abrirModalNueva = () => {
    setFormNueva({
      tipo: tiposSesionMaster[0] || 'Fuerza',
      nombre: '',
      nivel: nivelesMaster[0] || 'Básico',
      intensidad: 'MED'
    });
    setModalNuevaOpen(true);
  };

  const crearPlantilla = async () => {
    const nombre = formNueva.nombre.trim();
    if (!nombre) {
      alert('El nombre de la plantilla es obligatorio.');
      return;
    }

    setSavingNueva(true);
    try {
      const intNorm = normalizarIntensidad(formNueva.intensidad || 'MED');
      const nuevaPlantillaPayload = {
        tipo_sesion: formNueva.tipo,
        nombre,
        nivel: formNueva.nivel,
        intensidad: intNorm,
        Intensidad: intNorm,
        intensidad_sesion: intNorm,
        ejercicios: [],
        fecha_creacion: new Date()
      };

      const docRef = await addDoc(collection(db, 'plantillas_sesiones'), nuevaPlantillaPayload);

      pushAction({
        label: `Crear plantilla "${nombre}"`,
        undoOps: [{ type: 'delete', collection: 'plantillas_sesiones', id: docRef.id }],
        redoOps: [
          {
            type: 'set',
            collection: 'plantillas_sesiones',
            id: docRef.id,
            data: nuevaPlantillaPayload
          }
        ],
        showToast: false
      });

      setModalNuevaOpen(false);
      onNavigate('editar_plantilla', docRef.id);
    } catch (e) {
      console.error('Error creando plantilla:', e);
      alert('Error al crear la plantilla.');
    } finally {
      setSavingNueva(false);
    }
  };

  const borrarPlantilla = async (e: React.MouseEvent, id: string, nombre: string) => {
    e.stopPropagation();
    if (
      !(await confirmarDialogo(
        `¿Estás seguro de que deseas eliminar permanentemente la plantilla "${nombre}"?\n\nPodrás deshacerlo con Ctrl+Z.`,
        {
          titulo: 'Eliminar plantilla',
          textoConfirmar: 'Sí, eliminar',
          danger: true
        }
      ))
    ) {
      return;
    }

    const pPrevia = plantillasData.find(p => p.id === id);
    const prevRaw = pPrevia ? clonarProfundo(pPrevia) : null;
    if (prevRaw) delete prevRaw.id;

    try {
      await deleteDoc(doc(db, 'plantillas_sesiones', id));
      setPlantillasData(prev => prev.filter(p => p.id !== id));

      if (prevRaw) {
        pushAction({
          label: `Eliminar plantilla "${nombre}"`,
          undoOps: [{ type: 'set', collection: 'plantillas_sesiones', id, data: prevRaw }],
          redoOps: [{ type: 'delete', collection: 'plantillas_sesiones', id }],
          showToast: true,
          toastMessage: `🗑️ Plantilla "${nombre}" eliminada`
        });
      }
    } catch (err) {
      console.error(err);
      alert('Error al eliminar la plantilla.');
    }
  };

  // Group by Tipo de Sesión
  const grupos: Record<string, any[]> = {};
  plantillasData.forEach(p => {
    const tipo = p.tipo_sesion || 'Otros';
    if (!grupos[tipo]) grupos[tipo] = [];
    grupos[tipo].push(p);
  });

  const ordenTipos = [...tiposSesionMaster];
  Object.keys(grupos).forEach(t => {
    if (!ordenTipos.includes(t) && t !== 'Otros') ordenTipos.push(t);
  });
  if (grupos['Otros'] && grupos['Otros'].length > 0 && !ordenTipos.includes('Otros')) {
    ordenTipos.push('Otros');
  }

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>Sesiones Predefinidas</h1>
          <div className="header-meta">
            Crea y organiza plantillas de entrenamiento para reutilizarlas rápidamente
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={abrirModalNueva}>
          + Nueva Plantilla
        </button>
      </div>

      <div id="accordionsContainer">
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            Cargando plantillas de sesiones...
          </div>
        ) : (
          ordenTipos.map(tipo => {
            const lista = [...(grupos[tipo] || [])];
            lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
            const isClosed = Boolean(collapsedTipos[tipo]);

            return (
              <div key={tipo} className="tipo-sesion-accordion">
                <div
                  className="tipo-header"
                  onClick={() =>
                    setCollapsedTipos(prev => ({ ...prev, [tipo]: !prev[tipo] }))
                  }
                >
                  <h2>
                    <span>📂 TIPO DE SESIÓN: {tipo.toUpperCase()}</span>
                    <span className="count">{lista.length} plantillas</span>
                  </h2>
                  <span
                    className="chevron-icon"
                    style={{ transform: isClosed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
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

                {!isClosed && (
                  <div className="tipo-content">
                    {lista.length === 0 ? (
                      <div
                        style={{
                          padding: '18px 20px',
                          color: 'var(--text-muted)',
                          fontSize: '0.88rem',
                          fontStyle: 'italic'
                        }}
                      >
                        No hay plantillas en esta sección todavía.
                      </div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: '45%' }}>Nombre de Sesión</th>
                            <th style={{ width: '25%' }}>Nivel</th>
                            <th style={{ width: '20%' }}>Nº Ejercicios</th>
                            <th style={{ width: '10%', textAlign: 'right' }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                        {lista.map(p => {
                          const numEj = Array.isArray(p.ejercicios) ? p.ejercicios.length : 0;
                          const intSes = normalizarIntensidad(
                            p.intensidad_sesion || p.intensidad || 'MED'
                          );
                          return (
                            <tr
                              key={p.id}
                              className="plantilla-row"
                              onClick={() => onNavigate('editar_plantilla', p.id)}
                            >
                              <td>
                                <strong>{p.nombre || 'Sin nombre'}</strong>{' '}
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: renderIntensityBadge(intSes, { compact: true })
                                  }}
                                />
                              </td>
                              <td>
                                <span className="pill-nivel">{p.nivel || 'Todos'}</span>
                              </td>
                              <td style={{ color: 'var(--text-muted)' }}>{numEj} ejercicios</td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  type="button"
                                  className="btn-icon danger"
                                  title="Eliminar plantilla"
                                  onClick={e => borrarPlantilla(e, p.id, p.nombre)}
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
                          );
                        })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal Crear Plantilla */}
      {modalNuevaOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalNuevaOpen(false)}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>Crear Plantilla de Sesión</h2>
              <p>Define los datos básicos antes de añadir los ejercicios</p>
            </div>

            <div className="form-group">
              <label>Tipo de Sesión *</label>
              <select
                value={formNueva.tipo}
                onChange={e => setFormNueva(prev => ({ ...prev, tipo: e.target.value }))}
              >
                {tiposSesionMaster.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Nombre de la Sesión *</label>
              <input
                type="text"
                placeholder="Ej: Rutina Empuje Nivel 1, Circuito HIIT A..."
                value={formNueva.nombre}
                onChange={e => setFormNueva(prev => ({ ...prev, nombre: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Nivel Objetivo *</label>
              <select
                value={formNueva.nivel}
                onChange={e => setFormNueva(prev => ({ ...prev, nivel: e.target.value }))}
              >
                {nivelesMaster.map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Intensidad Global de la Plantilla *</label>
              <select
                value={formNueva.intensidad}
                onChange={e =>
                  setFormNueva(prev => ({ ...prev, intensidad: e.target.value }))
                }
              >
                <option value="LOW">🟢 LOW (Baja)</option>
                <option value="MED">🟡 MED (Media)</option>
                <option value="HIGH">🔴 HIGH (Alta)</option>
              </select>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalNuevaOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={savingNueva}
                onClick={crearPlantilla}
              >
                {savingNueva ? 'Creando...' : 'Crear y Añadir Ejercicios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
