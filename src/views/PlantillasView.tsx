import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useUndo } from '../context/UndoContext';
import { cargarCatalogoMaestros, extraerListaMaster } from '../services/maestrosService';
import {
  normalizarIntensidad,
  renderIntensityBadge,
  formatIntensityOptionLabel,
  DEFAULT_INTENSIDADES_SESION
} from '../utils/helpers';
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
  const [intensidadesMaster, setIntensidadesMaster] = useState<string[]>(
    DEFAULT_INTENSIDADES_SESION
  );

  const [collapsedTipos, setCollapsedTipos] = useState<Record<string, boolean>>({});

  // Modal Nueva / Editar Plantilla
  const [modalNuevaOpen, setModalNuevaOpen] = useState(false);
  const [editingPlantillaId, setEditingPlantillaId] = useState<string | null>(null);
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

        const ints = extraerListaMaster(maestros, 'Sesiones', [
          'Intensidad de la Sesión',
          'Intensidad de la sesión',
          'Intensidad'
        ]);
        if (ints.length > 0) setIntensidadesMaster(ints);
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
    setEditingPlantillaId(null);
    setFormNueva({
      tipo: tiposSesionMaster[0] || 'Fuerza',
      nombre: '',
      nivel: nivelesMaster[0] || 'Básico',
      intensidad: normalizarIntensidad(intensidadesMaster[1] || intensidadesMaster[0] || 'MED')
    });
    setModalNuevaOpen(true);
  };

  const abrirModalEditarPlantilla = (e: React.MouseEvent, p: any) => {
    e.stopPropagation();
    setEditingPlantillaId(p.id);
    setFormNueva({
      tipo: p.tipo_sesion || tiposSesionMaster[0] || 'Fuerza',
      nombre: p.nombre || '',
      nivel: p.nivel || nivelesMaster[0] || 'Básico',
      intensidad: normalizarIntensidad(p.intensidad_sesion || p.intensidad || 'MED')
    });
    setModalNuevaOpen(true);
  };

  const guardarPlantillaModal = async () => {
    const nombre = formNueva.nombre.trim();
    if (!nombre) {
      alert('El nombre de la plantilla es obligatorio.');
      return;
    }

    setSavingNueva(true);
    try {
      const intNorm = normalizarIntensidad(formNueva.intensidad || 'MED');

      if (editingPlantillaId) {
        const pPrevia = plantillasData.find(p => p.id === editingPlantillaId);
        const prevData = {
          tipo_sesion: pPrevia?.tipo_sesion || '',
          nombre: pPrevia?.nombre || '',
          nivel: pPrevia?.nivel || '',
          intensidad: normalizarIntensidad(
            pPrevia?.intensidad_sesion || pPrevia?.intensidad || 'MED'
          ),
          Intensidad: normalizarIntensidad(
            pPrevia?.intensidad_sesion || pPrevia?.intensidad || 'MED'
          ),
          intensidad_sesion: normalizarIntensidad(
            pPrevia?.intensidad_sesion || pPrevia?.intensidad || 'MED'
          )
        };
        const nextData = {
          tipo_sesion: formNueva.tipo,
          nombre,
          nivel: formNueva.nivel,
          intensidad: intNorm,
          Intensidad: intNorm,
          intensidad_sesion: intNorm
        };

        await updateDoc(doc(db, 'plantillas_sesiones', editingPlantillaId), nextData);
        setPlantillasData(prev =>
          prev.map(p => (p.id === editingPlantillaId ? { ...p, ...nextData } : p))
        );
        setModalNuevaOpen(false);
        setEditingPlantillaId(null);

        pushAction({
          label: `Editar plantilla "${nombre}"`,
          undoOps: [
            {
              type: 'update',
              collection: 'plantillas_sesiones',
              id: editingPlantillaId,
              data: prevData
            }
          ],
          redoOps: [
            {
              type: 'update',
              collection: 'plantillas_sesiones',
              id: editingPlantillaId,
              data: nextData
            }
          ],
          showToast: true,
          toastMessage: `✓ Plantilla "${nombre}" actualizada`
        });
      } else {
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
      }
    } catch (e) {
      console.error('Error guardando plantilla:', e);
      alert('Error al guardar la plantilla.');
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className="ui-icon">📂</span>
                      <span>TIPO DE SESIÓN: {tipo.toUpperCase()}</span>
                    </span>
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
                            <th style={{ width: '36%' }}>Nombre de Sesión</th>
                            <th style={{ width: '18%' }}>Intensidad</th>
                            <th style={{ width: '18%' }}>Nivel</th>
                            <th style={{ width: '16%' }}>Nº Ejercicios</th>
                            <th style={{ width: '12%', textAlign: 'right' }}>Acciones</th>
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
                                <strong>{p.nombre || 'Sin nombre'}</strong>
                              </td>
                              <td>
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
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <button
                                    type="button"
                                    className="btn-icon"
                                    title="Editar nombre, tipo de sesión y nivel"
                                    onClick={e => abrirModalEditarPlantilla(e, p)}
                                  >
                                    <span className="ui-icon">✏️</span>
                                  </button>
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
                                </div>
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

      {/* Modal Crear / Editar Plantilla */}
      {modalNuevaOpen && (
        <div
          className="modal-overlay"
          style={{ display: 'flex' }}
          onClick={() => !savingNueva && setModalNuevaOpen(false)}
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalNuevaOpen(false)}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>
                {editingPlantillaId ? (
                  <>
                    <span className="ui-icon">✏️</span>
                    <span>Editar Datos de Plantilla</span>
                  </>
                ) : (
                  'Crear Plantilla de Sesión'
                )}
              </h2>
              <p>
                {editingPlantillaId
                  ? 'Modifica el nombre, tipo de sesión, nivel o intensidad'
                  : 'Define los datos básicos antes de añadir los ejercicios'}
              </p>
            </div>

            <div className="form-group">
              <label>Tipo de Sesión *</label>
              <select
                value={formNueva.tipo}
                onChange={e => setFormNueva(prev => ({ ...prev, tipo: e.target.value }))}
              >
                {Array.from(
                  new Set([
                    ...tiposSesionMaster,
                    ...(formNueva.tipo ? [formNueva.tipo] : [])
                  ])
                ).map(t => (
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
                {Array.from(
                  new Set([
                    ...nivelesMaster,
                    ...(formNueva.nivel ? [formNueva.nivel] : [])
                  ])
                ).map(n => (
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
                {Array.from(
                  new Set([
                    ...intensidadesMaster.map(normalizarIntensidad),
                    normalizarIntensidad(formNueva.intensidad)
                  ])
                ).map(intOption => (
                  <option key={intOption} value={intOption}>
                    {formatIntensityOptionLabel(intOption)}
                  </option>
                ))}
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
                onClick={guardarPlantillaModal}
              >
                {savingNueva
                  ? 'Guardando...'
                  : editingPlantillaId
                  ? 'Guardar cambios'
                  : 'Crear y Añadir Ejercicios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
