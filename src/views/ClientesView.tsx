import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useUndo } from '../context/UndoContext';
import {
  cargarCatalogoMaestros,
  extraerListaMaster,
  getListaProgramadores
} from '../services/maestrosService';
import { coincideBusqueda, normalizarTextoBusqueda } from '../utils/helpers';

interface ClientesViewProps {
  onNavigate: (tab: string, param?: string) => void;
}

export const ClientesView: React.FC<ClientesViewProps> = ({ onNavigate }) => {
  const { role } = useAuth();
  const { pushAction, registerChangeListener } = useUndo();

  const [clientesData, setClientesData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [typeFilter, setTypeFilter] = useState('Todos');

  const [sortCol, setSortCol] = useState<'nombre_completo' | 'alias'>('nombre_completo');
  const [sortAsc, setSortAsc] = useState(true);

  const [openEstados, setOpenEstados] = useState<Record<string, boolean>>({
    Activos: true,
    'En pausa': false,
    'De baja': false
  });
  const [collapsedTipos, setCollapsedTipos] = useState<Record<string, boolean>>({});

  const [tiposClienteMaster, setTiposClienteMaster] = useState<string[]>([
    'Individual',
    'Small Group',
    'Individual + SG'
  ]);
  const [estadosClienteMaster, setEstadosClienteMaster] = useState<string[]>([
    'Activo',
    'Pausa',
    'Baja'
  ]);
  const [programadoresList, setProgramadoresList] = useState<string[]>(['Javi', 'Carlos']);

  // Modal Alta state
  const [modalAltaOpen, setModalAltaOpen] = useState(false);
  const [idGenerado, setIdGenerado] = useState('CLI-000000');
  const [savingAlta, setSavingAlta] = useState(false);
  const [formAlta, setFormAlta] = useState({
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

  const cargarClientes = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'clientes'));
      const list: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        const nom = data.Nombre_Cliente || data.nombre_completo || 'Sin nombre';
        const ali = data.Alias || data.alias || '-';
        const obj = data.Objetivo_Global || data.objetivo_global || '-';
        const les = data.Lesiones_Historial || data.lesiones || '-';
        const estRaw = data.Estado_Cliente || data.estado || 'Activo';
        const tipo = data.Tipo_Cliente || data.tipo_cliente || 'Sin asignar';

        let estadoNorm = 'Activos';
        const estLower = String(estRaw).toLowerCase();
        if (estLower.includes('pausa')) estadoNorm = 'En pausa';
        if (estLower.includes('baja') || estLower.includes('inactivo')) estadoNorm = 'De baja';

        list.push({
          id: d.id,
          raw: data,
          nombre_completo: nom,
          alias: ali,
          objetivo_global: obj,
          lesiones: les,
          estado: estadoNorm,
          tipo_cliente: tipo
        });
      });
      setClientesData(list);
    } catch (e) {
      console.error('Error al cargar clientes:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const maestros = await cargarCatalogoMaestros();
        const tipos = extraerListaMaster(maestros, 'Clientes', ['Tipo de Cliente', 'Tipo de cliente']);
        if (tipos.length > 0) setTiposClienteMaster(tipos);

        const estados = extraerListaMaster(maestros, 'Clientes', ['Estado Cliente', 'Estado cliente']);
        if (estados.length > 0) setEstadosClienteMaster(estados);

        const progs = await getListaProgramadores();
        if (progs.length > 0) setProgramadoresList(progs);
      } catch (e) {
        console.warn('Error cargando maestros en clientes:', e);
      }
      await cargarClientes();
    };
    init();
  }, [cargarClientes]);

  useEffect(() => {
    return registerChangeListener(() => {
      cargarClientes();
    });
  }, [registerChangeListener, cargarClientes]);

  const handleSort = (col: 'nombre_completo' | 'alias') => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const handleBorrarCliente = async (e: React.MouseEvent, id: string, nombre: string) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `¿Estás completamente seguro de que deseas eliminar permanentemente la ficha de "${nombre}"?\n\nPodrás deshacer esta acción con el botón Deshacer o Ctrl+Z.`
      )
    ) {
      return;
    }

    const clientePrevio = clientesData.find(c => c.id === id);
    const prevRawData = clientePrevio ? { ...clientePrevio.raw } : null;

    try {
      await deleteDoc(doc(db, 'clientes', id));
      setClientesData(prev => prev.filter(c => c.id !== id));

      if (prevRawData) {
        pushAction({
          label: `Eliminar cliente "${nombre}"`,
          undoOps: [{ type: 'set', collection: 'clientes', id, data: prevRawData }],
          redoOps: [{ type: 'delete', collection: 'clientes', id }],
          showToast: true,
          toastMessage: `🗑️ Cliente "${nombre}" eliminado`
        });
      }
    } catch (err) {
      console.error('Error al eliminar cliente:', err);
      alert('No se pudo eliminar el cliente. Revisa tu conexión o permisos.');
    }
  };

  const abrirModalAlta = () => {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    setIdGenerado(`CLI-${randomNum}`);
    setFormAlta({
      nombre: '',
      alias: '',
      estado: estadosClienteMaster[0] || 'Activo',
      tipo: tiposClienteMaster[0] || 'Individual',
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
    setModalAltaOpen(true);
  };

  const guardarNuevoCliente = async () => {
    const nom = formAlta.nombre.trim();
    if (!nom) {
      alert('El Nombre Completo es obligatorio.');
      return;
    }

    let alias = formAlta.alias.trim();
    if (!alias) {
      alias = nom.split(' ')[0];
    }

    setSavingAlta(true);
    try {
      const nuevoClientePayload = {
        Id_Cliente: idGenerado,
        Nombre_Cliente: nom,
        Alias: alias,
        Estado_Cliente: formAlta.estado,
        Tipo_Cliente: formAlta.tipo,
        Programador: formAlta.programador,
        Usa_Kids: formAlta.kidsActivo,
        'Nº_Niños_Kids': formAlta.kidsActivo === 'SI' ? parseInt(formAlta.kidsNum, 10) || 0 : 0,
        Nombres_Niños_Kids: formAlta.kidsActivo === 'SI' ? formAlta.kidsNombres.trim() : '',
        Objetivo_Global: formAlta.objGlobal.trim(),
        Objetivo_Especifico: formAlta.objEsp.trim(),
        Observaciones_Posteriores: formAlta.obsPost.trim(),
        Lesiones_Historial: formAlta.lesiones.trim(),
        Observaciones_VAF: formAlta.vaf.trim(),
        fecha_alta: new Date()
      };

      await setDoc(doc(db, 'clientes', idGenerado), nuevoClientePayload);

      pushAction({
        label: `Crear cliente "${alias || nom}"`,
        undoOps: [{ type: 'delete', collection: 'clientes', id: idGenerado }],
        redoOps: [{ type: 'set', collection: 'clientes', id: idGenerado, data: nuevoClientePayload }],
        showToast: false
      });

      setModalAltaOpen(false);
      onNavigate('ficha_cliente', idGenerado);
    } catch (e) {
      console.error('Error creando cliente:', e);
      alert('Hubo un error al guardar el cliente en la base de datos.');
    } finally {
      setSavingAlta(false);
    }
  };

  const isProgramadorOnly = role === 'programador';

  const filtrados = clientesData.filter(c => {
    const matchText =
      coincideBusqueda(c.nombre_completo, searchText) ||
      coincideBusqueda(c.alias, searchText) ||
      coincideBusqueda(c.objetivo_global, searchText) ||
      coincideBusqueda(c.lesiones, searchText);

    const matchStatus = statusFilter === 'Todos' || c.estado === statusFilter;
    const matchType = typeFilter === 'Todos' || c.tipo_cliente === typeFilter;

    return matchText && matchStatus && matchType;
  });

  filtrados.sort((a, b) => {
    const valA = normalizarTextoBusqueda(a[sortCol]);
    const valB = normalizarTextoBusqueda(b[sortCol]);
    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  const gruposEstado: Record<string, any[]> = {
    Activos: [],
    'En pausa': [],
    'De baja': []
  };

  filtrados.forEach(c => {
    if (gruposEstado[c.estado]) gruposEstado[c.estado].push(c);
    else gruposEstado.Activos.push(c);
  });

  const configVisual: Record<string, { clase: string; icono: string }> = {
    Activos: { clase: 'activos', icono: '🟢' },
    'En pausa': { clase: 'pausa', icono: '🟡' },
    'De baja': { clase: 'baja', icono: '🔴' }
  };

  const isFilteredOrSearching =
    statusFilter !== 'Todos' || typeFilter !== 'Todos' || searchText.trim() !== '';

  return (
    <div className="container">
      <div className="page-header">
        <h1>Fichas de clientes</h1>
        {!isProgramadorOnly && (
          <button type="button" className="btn-primary" onClick={abrirModalAlta}>
            + Nuevo cliente
          </button>
        )}
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
            placeholder="Buscar por alias, nombre, objetivo o lesión..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="Todos">Todos los estados</option>
          <option value="Activos">Activos</option>
          <option value="En pausa">En pausa</option>
          <option value="De baja">De baja</option>
        </select>

        <select
          className="filter-select"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="Todos">Todos los tipos</option>
          {tiposClienteMaster.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="Sin asignar">Sin asignar</option>
        </select>

        <span className="total-count">{filtrados.length} clientes</span>
      </div>

      <div id="accordionsContainer">
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            Cargando base de datos de clientes...
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
            No se encontraron clientes con estos filtros.
          </div>
        ) : (
          (['Activos', 'En pausa', 'De baja'] as const).map(estadoKey => {
            const listaEstado = gruposEstado[estadoKey];
            if (listaEstado.length === 0) return null;

            const isOpen = isFilteredOrSearching ? true : Boolean(openEstados[estadoKey]);

            const porTipo: Record<string, any[]> = {};
            listaEstado.forEach(c => {
              const t = c.tipo_cliente || 'Sin asignar';
              if (!porTipo[t]) porTipo[t] = [];
              porTipo[t].push(c);
            });

            const ordenTipos = [...tiposClienteMaster];
            Object.keys(porTipo).forEach(t => {
              if (!ordenTipos.includes(t) && t !== 'Sin asignar') ordenTipos.push(t);
            });
            if (!ordenTipos.includes('Sin asignar')) ordenTipos.push('Sin asignar');

            return (
              <div key={estadoKey} className="status-accordion">
                <div
                  className={`acc-header ${configVisual[estadoKey].clase}`}
                  onClick={() =>
                    setOpenEstados(prev => ({ ...prev, [estadoKey]: !isOpen }))
                  }
                >
                  <div className="acc-title">
                    <span>
                      {configVisual[estadoKey].icono} {estadoKey.toUpperCase()}
                    </span>
                    <span className="acc-badge">{listaEstado.length}</span>
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
                  <div className="acc-content">
                    {ordenTipos.map(tipoKey => {
                      const listaTipo = porTipo[tipoKey];
                      if (!listaTipo || listaTipo.length === 0) return null;

                      const tipoCollapseKey = `${estadoKey}__${tipoKey}`;
                      const isTipoClosed = Boolean(collapsedTipos[tipoCollapseKey]);

                      return (
                        <div key={tipoKey} className="type-section">
                          <div
                            className="type-header"
                            onClick={() =>
                              setCollapsedTipos(prev => ({
                                ...prev,
                                [tipoCollapseKey]: !prev[tipoCollapseKey]
                              }))
                            }
                          >
                            <span>TIPO: {tipoKey}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>{listaTipo.length} clientes</span>
                              <span
                                className="chevron-icon"
                                style={{
                                  transform: isTipoClosed ? 'rotate(-90deg)' : 'rotate(0deg)'
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
                          {!isTipoClosed && (
                            <table className="clientes-list-table">
                              <thead>
                                <tr>
                                  <th
                                    className="col-cli-nombre"
                                    style={{ width: '30%', cursor: 'pointer' }}
                                    onClick={() => handleSort('nombre_completo')}
                                  >
                                    Nombre completo{' '}
                                    {sortCol === 'nombre_completo' ? (sortAsc ? '↑' : '↓') : '↕'}
                                  </th>
                                  <th
                                    className="col-cli-alias"
                                    style={{ width: '25%', cursor: 'pointer' }}
                                    onClick={() => handleSort('alias')}
                                  >
                                    Alias {sortCol === 'alias' ? (sortAsc ? '↑' : '↓') : '↕'}
                                  </th>
                                  <th
                                    className="col-cli-objetivo"
                                    style={{ width: isProgramadorOnly ? '45%' : '35%' }}
                                  >
                                    Objetivo global
                                  </th>
                                  {!isProgramadorOnly && (
                                    <th className="col-cli-acciones" style={{ width: '10%', textAlign: 'right' }}>
                                      Acciones
                                    </th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {listaTipo.map(c => (
                                  <tr
                                    key={c.id}
                                    className="client-row"
                                    onClick={() => onNavigate('ficha_cliente', c.id)}
                                  >
                                    <td className="col-cli-nombre">{c.nombre_completo}</td>
                                    <td className="col-cli-alias">
                                      <strong>{c.alias}</strong>
                                    </td>
                                    <td className="col-cli-objetivo text-light">{c.objetivo_global}</td>
                                    {!isProgramadorOnly && (
                                      <td className="col-cli-acciones" style={{ textAlign: 'right' }}>
                                        <button
                                          type="button"
                                          className="btn-icon danger"
                                          title="Eliminar cliente"
                                          onClick={e =>
                                            handleBorrarCliente(
                                              e,
                                              c.id,
                                              c.alias !== '-' ? c.alias : c.nombre_completo
                                            )
                                          }
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
                                    )}
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

      {/* Modal Alta de Cliente */}
      {modalAltaOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content large">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalAltaOpen(false)}
            >
              ×
            </button>
            <div
              className="modal-header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingRight: 30
              }}
            >
              <div>
                <h2>Ficha de Alta de Cliente</h2>
                <p>Completa los datos para registrar un nuevo cliente en el centro</p>
              </div>
              <div className="code-badge" title="Código único autogenerado">
                {idGenerado}
              </div>
            </div>

            <div className="form-grid">
              <div className="form-section-title">📋 Datos Personales y Asignación</div>

              <div className="form-group">
                <label>Nombre Completo *</label>
                <input
                  type="text"
                  placeholder="Ej: Laura Martínez Gómez"
                  value={formAlta.nombre}
                  onChange={e => setFormAlta(prev => ({ ...prev, nombre: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Alias (Nombre en pantallas y agenda) *</label>
                <input
                  type="text"
                  placeholder="Ej: Laura M."
                  value={formAlta.alias}
                  onChange={e => setFormAlta(prev => ({ ...prev, alias: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Estado Inicial</label>
                <select
                  value={formAlta.estado}
                  onChange={e => setFormAlta(prev => ({ ...prev, estado: e.target.value }))}
                >
                  {estadosClienteMaster.map(est => (
                    <option key={est} value={est}>
                      {est}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Tipo de Cliente</label>
                <select
                  value={formAlta.tipo}
                  onChange={e => setFormAlta(prev => ({ ...prev, tipo: e.target.value }))}
                >
                  {tiposClienteMaster.map(t => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full">
                <label>Programador / Entrenador Asignado</label>
                <select
                  value={formAlta.programador}
                  onChange={e => setFormAlta(prev => ({ ...prev, programador: e.target.value }))}
                >
                  <option value="">Sin asignar</option>
                  {programadoresList.map(p => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-section-title">🧒 Servicio Go &amp; Kids</div>

              <div className="form-group">
                <label>¿Activo este mes?</label>
                <select
                  value={formAlta.kidsActivo}
                  onChange={e => setFormAlta(prev => ({ ...prev, kidsActivo: e.target.value }))}
                >
                  <option value="NO">No</option>
                  <option value="SI">Sí</option>
                </select>
              </div>
              <div className="form-group">
                <label>Nº de Niños Contratados</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  disabled={formAlta.kidsActivo !== 'SI'}
                  value={formAlta.kidsActivo === 'SI' ? formAlta.kidsNum : '0'}
                  onChange={e => setFormAlta(prev => ({ ...prev, kidsNum: e.target.value }))}
                />
              </div>
              <div className="form-group full">
                <label>Nombres de los niños registrados</label>
                <input
                  type="text"
                  placeholder="Ej: Hugo y Mateo"
                  disabled={formAlta.kidsActivo !== 'SI'}
                  value={formAlta.kidsActivo === 'SI' ? formAlta.kidsNombres : ''}
                  onChange={e => setFormAlta(prev => ({ ...prev, kidsNombres: e.target.value }))}
                />
              </div>

              <div className="form-section-title">🎯 Objetivos y Seguimiento</div>

              <div className="form-group">
                <label>Objetivo Global</label>
                <input
                  type="text"
                  placeholder="Ej: Pérdida de peso y tonificación"
                  value={formAlta.objGlobal}
                  onChange={e => setFormAlta(prev => ({ ...prev, objGlobal: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Objetivo Específico</label>
                <input
                  type="text"
                  placeholder="Ej: Mejorar fuerza tren inferior"
                  value={formAlta.objEsp}
                  onChange={e => setFormAlta(prev => ({ ...prev, objEsp: e.target.value }))}
                />
              </div>
              <div className="form-group full">
                <label>Observaciones Posteriores / Seguimiento</label>
                <textarea
                  placeholder="Notas adicionales sobre horarios, preferencias, motivación..."
                  value={formAlta.obsPost}
                  onChange={e => setFormAlta(prev => ({ ...prev, obsPost: e.target.value }))}
                />
              </div>

              <div className="form-section-title">
                ⚠️ Salud, Precauciones y Valoración Física (VAF)
              </div>

              <div className="form-group full">
                <label>Patologías / Lesiones Previas</label>
                <textarea
                  placeholder="Ej: Hernia discal L4-L5, molestia en hombro derecho al hacer press..."
                  value={formAlta.lesiones}
                  onChange={e => setFormAlta(prev => ({ ...prev, lesiones: e.target.value }))}
                />
              </div>
              <div className="form-group full">
                <label>Observaciones VAF (Valoración Funcional Inicial)</label>
                <textarea
                  placeholder="Resultados del test inicial, limitaciones de movilidad, descompensaciones..."
                  value={formAlta.vaf}
                  onChange={e => setFormAlta(prev => ({ ...prev, vaf: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalAltaOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={savingAlta}
                onClick={guardarNuevoCliente}
              >
                {savingAlta ? 'Guardando...' : 'Crear Cliente y Abrir Ficha'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
