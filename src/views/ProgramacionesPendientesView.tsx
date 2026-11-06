import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { getListaProgramadores } from '../services/maestrosService';
import { esSesionCompletada, esSesionCancelada } from '../utils/helpers';

interface ProgramacionesPendientesViewProps {
  onNavigate: (tab: string, param?: string) => void;
}

const diasSemanaMap: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  0: 'Domingo'
};

export const ProgramacionesPendientesView: React.FC<ProgramacionesPendientesViewProps> = ({ onNavigate }) => {
  const [currentView, setCurrentView] = useState<'individuales' | 'small_groups'>('individuales');
  const [clientesDataMap, setClientesDataMap] = useState<Record<string, { nombre: string; programador: string }>>({});
  const [programadoresMaestros, setProgramadoresMaestros] = useState<string[]>(['Javi', 'Carlos']);
  const [sesionesPendientes, setSesionesPendientes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [collapsedTrainers, setCollapsedTrainers] = useState<Record<string, boolean>>({});
  const [collapsedClients, setCollapsedClients] = useState<Record<string, boolean>>({});

  const initPage = useCallback(async () => {
    setLoading(true);
    try {
      const progs = await getListaProgramadores();
      if (progs.length > 0) setProgramadoresMaestros(progs);
    } catch (e) {
      console.warn('Error cargando programadores:', e);
    }

    const cMap: Record<string, { nombre: string; programador: string }> = {};
    try {
      const snapCli = await getDocs(collection(db, 'clientes'));
      snapCli.forEach(d => {
        const data = d.data();
        const nom = data.Alias || data.alias || data.Nombre_Cliente || data.nombre_completo || 'Sin nombre';
        const prog = data.Programador || data.programador || 'Sin asignar';
        cMap[d.id] = { nombre: nom, programador: prog };
      });
      setClientesDataMap(cMap);
    } catch (e) {
      console.error('Error cargando clientes:', e);
    }

    try {
      const now = new Date();
      const hoy = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
      const limiteDosSemanas = new Date(hoy);
      limiteDosSemanas.setUTCDate(hoy.getUTCDate() + 14);
      limiteDosSemanas.setUTCHours(23, 59, 59, 999);

      const q = query(
        collection(db, 'agenda_sesiones'),
        where('fecha_hora_inicio', '>=', hoy),
        where('fecha_hora_inicio', '<=', limiteDosSemanas)
      );

      const snapSes = await getDocs(q);
      const todasLasSesiones: any[] = [];
      const gruposSG: Record<number, any[]> = {};

      snapSes.forEach(d => {
        const data = d.data();
        if (!data.fecha_hora_inicio) return;
        const fecha = data.fecha_hora_inicio.toDate ? data.fecha_hora_inicio.toDate() : new Date(data.fecha_hora_inicio);
        const sesObj = { id: d.id, ...data, fecha };
        todasLasSesiones.push(sesObj);

        const tipo = (data.tipo_sesion || '').toLowerCase();
        if (tipo.includes('small') || tipo.includes('group')) {
          const timeKey = fecha.getTime();
          if (!gruposSG[timeKey]) gruposSG[timeKey] = [];
          gruposSG[timeKey].push(sesObj);
        }
      });

      // Auto-sync SG routines if one session in the group has exercises
      const batch = writeBatch(db);
      let huboAutoreparacion = false;

      for (const timeKey in gruposSG) {
        const grupo = gruposSG[Number(timeKey)];
        const sesionConRutina = grupo.find(s => Array.isArray(s.ejercicios) && s.ejercicios.length > 0);
        if (sesionConRutina) {
          grupo.forEach(s => {
            if (!Array.isArray(s.ejercicios) || s.ejercicios.length === 0) {
              s.ejercicios = sesionConRutina.ejercicios;
              batch.update(doc(db, 'agenda_sesiones', s.id), { ejercicios: sesionConRutina.ejercicios });
              huboAutoreparacion = true;
            }
          });
        }
      }

      if (huboAutoreparacion) {
        await batch.commit();
      }

      const pendientes: any[] = [];
      todasLasSesiones.forEach(s => {
        if (esSesionCancelada(s) || esSesionCompletada(s)) return;
        const tieneEjercicios = Array.isArray(s.ejercicios) && s.ejercicios.length > 0;
        if (!tieneEjercicios) {
          pendientes.push(s);
        }
      });

      pendientes.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      setSesionesPendientes(pendientes);
    } catch (e) {
      console.error('Error cargando sesiones pendientes:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initPage();
  }, [initPage]);

  const toggleTrainer = (trainer: string) => {
    setCollapsedTrainers(prev => ({ ...prev, [trainer]: !prev[trainer] }));
  };

  const toggleClient = (clientKey: string) => {
    setCollapsedClients(prev => ({ ...prev, [clientKey]: !prev[clientKey] }));
  };

  const renderIndividuales = () => {
    const individuales = sesionesPendientes.filter(s => {
      const t = (s.tipo_sesion || '').toLowerCase();
      return !t.includes('small') && !t.includes('group');
    });

    if (individuales.length === 0) {
      return (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
          🎉 ¡Todo al día! No hay sesiones individuales pendientes de programar para las próximas 2 semanas.
        </div>
      );
    }

    const estructura: Record<string, Record<string, { idCliente: string; sesiones: any[] }>> = {};

    individuales.forEach(s => {
      const cliInfo = clientesDataMap[s.id_cliente] || {
        nombre: s.cliente_nombre || 'Cliente Desconocido',
        programador: 'Sin asignar'
      };
      const prog = cliInfo.programador || 'Sin asignar';
      const nomCli = cliInfo.nombre;

      if (!estructura[prog]) estructura[prog] = {};
      if (!estructura[prog][nomCli]) {
        estructura[prog][nomCli] = { idCliente: s.id_cliente || '', sesiones: [] };
      }
      estructura[prog][nomCli].sesiones.push(s);
    });

    const ordenEntrenadores = [...programadoresMaestros];
    Object.keys(estructura).forEach(p => {
      if (p !== 'Sin asignar' && !ordenEntrenadores.includes(p)) {
        ordenEntrenadores.push(p);
      }
    });
    if (!ordenEntrenadores.includes('Sin asignar')) {
      ordenEntrenadores.push('Sin asignar');
    }

    return ordenEntrenadores.map(entrenador => {
      const clientesObj = estructura[entrenador];
      if (!clientesObj) return null;

      const nombresClientes = Object.keys(clientesObj).sort((a, b) => a.localeCompare(b));
      if (nombresClientes.length === 0) return null;

      let totalSesionesEntrenador = 0;
      nombresClientes.forEach(c => {
        totalSesionesEntrenador += clientesObj[c].sesiones.length;
      });

      const isTrainerClosed = Boolean(collapsedTrainers[entrenador]);

      return (
        <div key={entrenador} className="trainer-accordion">
          <div className="trainer-header" onClick={() => toggleTrainer(entrenador)}>
            <div className="trainer-title">
              <span>👤 ENTRENADOR: {entrenador}</span>
              <span
                style={{
                  background: '#ffffff',
                  color: '#334155',
                  padding: '2px 10px',
                  borderRadius: 12,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  border: '1px solid #cbd5e1'
                }}
              >
                {nombresClientes.length} {nombresClientes.length === 1 ? 'cliente' : 'clientes'} · {totalSesionesEntrenador}{' '}
                {totalSesionesEntrenador === 1 ? 'sesión' : 'sesiones'}
              </span>
            </div>
            <span
              className="chevron-icon"
              style={{ transform: isTrainerClosed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>

          {!isTrainerClosed && (
            <div className="trainer-content">
              {nombresClientes.map(cliente => {
                const { idCliente, sesiones } = clientesObj[cliente];
                const clientKey = `${entrenador}_${cliente}`;
                const isClientClosed = Boolean(collapsedClients[clientKey]);

                return (
                  <div key={clientKey} className="client-accordion">
                    <div
                      className="client-header"
                      onClick={() => toggleClient(clientKey)}
                      style={{ borderBottomColor: isClientClosed ? 'transparent' : 'var(--border)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          className="chevron-icon"
                          style={{ transform: isClientClosed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                        {idCliente ? (
                          <a
                            href={`#ficha_cliente/${idCliente}`}
                            className="client-link"
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              onNavigate('ficha_cliente', idCliente);
                            }}
                          >
                            {cliente}
                          </a>
                        ) : (
                          <span>{cliente}</span>
                        )}
                      </div>
                      <span className="count">
                        {sesiones.length} {sesiones.length === 1 ? 'pendiente' : 'pendientes'}
                      </span>
                    </div>

                    {!isClientClosed && (
                      <div className="client-content">
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: '25%' }}>FECHA</th>
                              <th style={{ width: '25%' }}>DÍA</th>
                              <th style={{ width: '25%' }}>HORA</th>
                              <th style={{ width: '25%', textAlign: 'right' }}>ACCIÓN</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sesiones.map(s => {
                              const d = s.fecha.getUTCDate().toString().padStart(2, '0');
                              const m = (s.fecha.getUTCMonth() + 1).toString().padStart(2, '0');
                              const y = s.fecha.getUTCFullYear();
                              const fechaStr = `${d}/${m}/${y}`;
                              const diaStr = diasSemanaMap[s.fecha.getUTCDay()];
                              const horaStr = `${s.fecha.getUTCHours().toString().padStart(2, '0')}:${s.fecha.getUTCMinutes().toString().padStart(2, '0')}`;

                              return (
                                <tr key={s.id}>
                                  <td>{fechaStr}</td>
                                  <td>{diaStr}</td>
                                  <td>{horaStr}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button
                                      type="button"
                                      className="btn-action"
                                      onClick={() => onNavigate('programar_sesion', s.id)}
                                    >
                                      Programar sesión
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  const renderSmallGroups = () => {
    const sgs = sesionesPendientes.filter(s => {
      const t = (s.tipo_sesion || '').toLowerCase();
      return t.includes('small') || t.includes('group');
    });

    const mapHuecos: Record<number, any> = {};
    sgs.forEach(s => {
      const timeKey = s.fecha.getTime();
      if (!mapHuecos[timeKey]) {
        mapHuecos[timeKey] = s;
      }
    });

    const huecosUnicos = Object.values(mapHuecos);

    if (huecosUnicos.length === 0) {
      return (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
          🎉 ¡Todo al día! No hay Small Groups pendientes de programar para las próximas 2 semanas.
        </div>
      );
    }

    return (
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th style={{ width: '25%' }}>FECHA</th>
              <th style={{ width: '25%' }}>DÍA</th>
              <th style={{ width: '25%' }}>HORA</th>
              <th style={{ width: '25%', textAlign: 'right' }}>ACCIÓN</th>
            </tr>
          </thead>
          <tbody>
            {huecosUnicos.map((s: any) => {
              const d = s.fecha.getUTCDate().toString().padStart(2, '0');
              const m = (s.fecha.getUTCMonth() + 1).toString().padStart(2, '0');
              const y = s.fecha.getUTCFullYear();
              const fechaStr = `${d}/${m}/${y}`;
              const diaStr = diasSemanaMap[s.fecha.getUTCDay()];
              const horaStr = `${s.fecha.getUTCHours().toString().padStart(2, '0')}:${s.fecha.getUTCMinutes().toString().padStart(2, '0')}`;

              return (
                <tr key={s.id}>
                  <td>{fechaStr}</td>
                  <td>{diaStr}</td>
                  <td>{horaStr}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn-action"
                      onClick={() => onNavigate('programar_sesion', s.id)}
                    >
                      Programar sesión
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

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
        &gt; Programaciones Pendientes
      </div>

      <div className="page-header">
        <h1>Sesiones pendientes de programar</h1>
      </div>

      <div className="tabs-selector">
        <button
          type="button"
          className={`tab-filter-btn ${currentView === 'individuales' ? 'active' : 'inactive'}`}
          onClick={() => setCurrentView('individuales')}
        >
          Sesiones individuales
        </button>
        <button
          type="button"
          className={`tab-filter-btn ${currentView === 'small_groups' ? 'active' : 'inactive'}`}
          onClick={() => setCurrentView('small_groups')}
        >
          Small Groups
        </button>
      </div>

      <div id="contentContainer">
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            Buscando sesiones pendientes...
          </div>
        ) : currentView === 'individuales' ? (
          renderIndividuales()
        ) : (
          renderSmallGroups()
        )}
      </div>
    </div>
  );
};
