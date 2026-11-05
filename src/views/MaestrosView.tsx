import React, { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useUndo } from '../context/UndoContext';
import {
  ESTRUCTURA_MAESTROS,
  CATALOGO_PERMISOS_APP,
  cargarTodosLosMaestros,
  guardarValorMaestro,
  reordenarValoresMaestro,
  eliminarValorMaestro,
  comprobarDependenciasMaestro,
  reasignarOQuitarDependencia,
  limpiarNombreDoc,
  limpiarCacheMaestros,
  asegurarRolesYPermisosIniciales,
  cargarMatrizPermisos,
  guardarMatrizPermisos,
  cargarUsuariosAutenticacion,
  PermisosPorDefectoParaRol,
  esRolAdmin,
  esRolProyectorSala
} from '../services/maestrosService';
import { PermisoAccion } from '../types';

const clonarProfundo = (obj: any) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

export const MaestrosView: React.FC = () => {
  const { role } = useAuth();
  const { pushAction, registerChangeListener } = useUndo();

  const [mapaMaestros, setMapaMaestros] = useState<
    Record<string, Record<string, { id: string; valor: string; orden: number }[]>>
  >({});
  const [currentSection, setCurrentSection] = useState('Ejercicios');
  const [currentKey, setCurrentKey] = useState('Niveles');

  const [inputValor, setInputValor] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingOldValue, setEditingOldValue] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  // Perfiles state
  const [matrizPermisosGlobal, setMatrizPermisosGlobal] = useState<
    Record<string, Record<string, PermisoAccion>>
  >({});
  const [usuariosAuthGlobal, setUsuariosAuthGlobal] = useState<any[]>([]);
  const [rolSeleccionadoPermisos, setRolSeleccionadoPermisos] = useState('programador');

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserNombre, setNewUserNombre] = useState('');
  const [newUserRol, setNewUserRol] = useState('programador');

  // Drag state
  const dragIdxRef = useRef<number | null>(null);

  // Dependency modal state
  const [depModal, setDepModal] = useState<{
    open: boolean;
    itemId: string;
    valor: string;
    depsCount: number;
    colsStr: string;
    accion: 'vaciar' | 'reasignar';
    nuevoValor: string;
    otherOptions: string[];
    processing: boolean;
  }>({
    open: false,
    itemId: '',
    valor: '',
    depsCount: 0,
    colsStr: '',
    accion: 'vaciar',
    nuevoValor: '',
    otherOptions: [],
    processing: false
  });

  const esAdmin = esRolAdmin(role);

  const puedeEditarActual = () => {
    if (currentSection === 'Gestión de Perfiles' && currentKey === 'Permisos') return false;
    if (esAdmin) return true;
    return currentSection === 'Ejercicios';
  };

  const getItemsActuales = useCallback((): { id: string; valor: string; orden: number }[] => {
    if (!mapaMaestros[currentSection] || !mapaMaestros[currentSection][currentKey]) {
      return [];
    }
    return [...mapaMaestros[currentSection][currentKey]];
  }, [mapaMaestros, currentSection, currentKey]);

  const getRolesDisponibles = useCallback((): string[] => {
    const itemsRoles = mapaMaestros['Gestión de Perfiles']?.Roles || [];
    const lista = itemsRoles.map(x => x.valor);
    if (lista.length === 0) return ['admin', 'programador', 'Proyector Sala'];
    return lista;
  }, [mapaMaestros]);

  const recargarTodo = useCallback(async () => {
    try {
      await asegurarRolesYPermisosIniciales();
    } catch (e) {
      console.warn('No se pudo inicializar roles/permisos por defecto:', e);
    }
    const [maestros, matriz, users] = await Promise.all([
      cargarTodosLosMaestros(true),
      cargarMatrizPermisos(),
      cargarUsuariosAutenticacion()
    ]);
    setMapaMaestros(maestros);
    setMatrizPermisosGlobal(matriz);
    setUsuariosAuthGlobal(users);
  }, []);

  useEffect(() => {
    recargarTodo();
  }, [recargarTodo]);

  useEffect(() => {
    return registerChangeListener(() => {
      limpiarCacheMaestros();
      recargarTodo();
    });
  }, [registerChangeListener, recargarTodo]);

  const cancelarEdicion = () => {
    setEditingItemId(null);
    setEditingOldValue(null);
    setInputValor('');
  };

  const seleccionarClave = (sec: string, clv: string) => {
    setCurrentSection(sec);
    setCurrentKey(clv);
    cancelarEdicion();
  };

  const iniciarEdicion = (id: string, valor: string) => {
    setEditingItemId(id);
    setEditingOldValue(valor);
    setInputValor(valor);
  };

  const handleGuardarItem = async () => {
    if (!puedeEditarActual()) return;
    const val = inputValor.trim();
    if (!val) {
      alert('Escribe un valor válido.');
      return;
    }

    const esOcupacionMaxima =
      currentSection === 'Agenda' && currentKey === 'Ocupación máxima';
    if (esOcupacionMaxima) {
      const numVal = parseInt(val, 10);
      if (isNaN(numVal) || numVal < 1) {
        alert('Introduce un número entero mayor o igual a 1 para la ocupación máxima.');
        return;
      }
    }

    setSavingItem(true);
    try {
      const docKey = limpiarNombreDoc(currentKey);
      const docRef = doc(db, 'maestros', docKey);
      const prevSnap = await getDoc(docRef);
      const prevDocData = prevSnap.exists() ? clonarProfundo(prevSnap.data()) : null;

      const itemsCurr = getItemsActuales();
      const targetEditId =
        editingItemId || (esOcupacionMaxima && itemsCurr.length > 0 ? itemsCurr[0].id : null);
      const targetOldVal =
        editingOldValue || (esOcupacionMaxima && itemsCurr.length > 0 ? itemsCurr[0].valor : null);

      if (esOcupacionMaxima) {
        await reordenarValoresMaestro(currentSection, currentKey, [
          { id: String(parseInt(val, 10)), valor: String(parseInt(val, 10)) }
        ]);
      } else {
        await guardarValorMaestro(currentSection, currentKey, val, null, targetEditId);
      }

      if (targetEditId && targetOldVal && targetOldVal !== val && !esOcupacionMaxima) {
        await reasignarOQuitarDependencia(currentKey, targetOldVal, val);
      }

      if (currentSection === 'Gestión de Perfiles' && currentKey === 'Roles') {
        const nextMatriz = { ...matrizPermisosGlobal };
        if (editingOldValue && editingOldValue !== val && nextMatriz[editingOldValue]) {
          nextMatriz[val] = nextMatriz[editingOldValue];
          delete nextMatriz[editingOldValue];
          await guardarMatrizPermisos(nextMatriz);
        } else if (!nextMatriz[val]) {
          nextMatriz[val] = PermisosPorDefectoParaRol(val);
          await guardarMatrizPermisos(nextMatriz);
        }
      }

      const nextSnap = await getDoc(docRef);
      const nextDocData = nextSnap.exists() ? clonarProfundo(nextSnap.data()) : null;

      if (nextDocData) {
        const eraEdicion = Boolean(editingItemId);
        pushAction({
          label: eraEdicion
            ? `Editar valor "${val}" en ${currentKey}`
            : `Añadir "${val}" en ${currentKey}`,
          undoOps: [
            prevDocData
              ? { type: 'set', collection: 'maestros', id: docKey, data: prevDocData }
              : { type: 'delete', collection: 'maestros', id: docKey }
          ],
          redoOps: [{ type: 'set', collection: 'maestros', id: docKey, data: nextDocData }],
          showToast: true,
          toastMessage: eraEdicion
            ? `✓ Valor actualizado a "${val}"`
            : `✓ Valor "${val}" añadido a ${currentKey}`
        });
      }

      cancelarEdicion();
      await recargarTodo();
    } catch (e) {
      console.error(e);
      alert('Error al guardar el valor en la base de datos.');
    } finally {
      setSavingItem(false);
    }
  };

  // Drag & Drop reorder
  const handleDropRow = async (targetIdx: number) => {
    const fromIdx = dragIdxRef.current;
    dragIdxRef.current = null;
    if (fromIdx === null || fromIdx === targetIdx || !puedeEditarActual()) return;

    const items = getItemsActuales();
    const [moved] = items.splice(fromIdx, 1);
    items.splice(targetIdx, 0, moved);

    try {
      const docKey = limpiarNombreDoc(currentKey);
      const docRef = doc(db, 'maestros', docKey);
      const prevSnap = await getDoc(docRef);
      const prevDocData = prevSnap.exists() ? clonarProfundo(prevSnap.data()) : null;

      await reordenarValoresMaestro(currentSection, currentKey, items);

      const nextSnap = await getDoc(docRef);
      const nextDocData = nextSnap.exists() ? clonarProfundo(nextSnap.data()) : null;

      if (prevDocData && nextDocData) {
        pushAction({
          label: `Reordenar lista "${currentKey}"`,
          undoOps: [{ type: 'set', collection: 'maestros', id: docKey, data: prevDocData }],
          redoOps: [{ type: 'set', collection: 'maestros', id: docKey, data: nextDocData }],
          showToast: false
        });
      }

      await recargarTodo();
    } catch (e) {
      console.error('Error al reordenar maestro:', e);
      alert('No se pudo guardar el nuevo orden.');
    }
  };

  const solicitarBorrado = async (id: string, valor: string) => {
    if (!puedeEditarActual()) return;

    try {
      const deps = await comprobarDependenciasMaestro(currentKey, valor);
      if (deps.length === 0) {
        if (
          !window.confirm(
            `¿Seguro que deseas eliminar "${valor}" de "${currentKey}"?\n\nPodrás deshacerlo con Ctrl+Z.`
          )
        ) {
          return;
        }
        const docKey = limpiarNombreDoc(currentKey);
        const docRef = doc(db, 'maestros', docKey);
        const prevSnap = await getDoc(docRef);
        const prevDocData = prevSnap.exists() ? clonarProfundo(prevSnap.data()) : null;

        await eliminarValorMaestro(currentKey, id);

        if (
          currentSection === 'Gestión de Perfiles' &&
          currentKey === 'Roles' &&
          matrizPermisosGlobal[valor]
        ) {
          const nextM = { ...matrizPermisosGlobal };
          delete nextM[valor];
          await guardarMatrizPermisos(nextM);
        }

        const nextSnap = await getDoc(docRef);
        const nextDocData = nextSnap.exists() ? clonarProfundo(nextSnap.data()) : null;

        if (prevDocData && nextDocData) {
          pushAction({
            label: `Eliminar "${valor}" de ${currentKey}`,
            undoOps: [{ type: 'set', collection: 'maestros', id: docKey, data: prevDocData }],
            redoOps: [{ type: 'set', collection: 'maestros', id: docKey, data: nextDocData }],
            showToast: true,
            toastMessage: `🗑️ Valor "${valor}" eliminado de ${currentKey}`
          });
        }

        await recargarTodo();
      } else {
        const otros = getItemsActuales()
          .filter(x => x.id !== id)
          .map(x => x.valor);
        const colsUnicas = [...new Set(deps.map(d => d.coleccion))].join(', ');
        setDepModal({
          open: true,
          itemId: id,
          valor,
          depsCount: deps.length,
          colsStr: colsUnicas,
          accion: 'vaciar',
          nuevoValor: otros[0] || '',
          otherOptions: otros,
          processing: false
        });
      }
    } catch (e) {
      console.error(e);
      alert('Error al comprobar dependencias.');
    }
  };

  const confirmarBorradoConDependencias = async () => {
    if (depModal.accion === 'reasignar' && !depModal.nuevoValor) {
      alert('No hay otro valor disponible para reasignar.');
      return;
    }

    setDepModal(prev => ({ ...prev, processing: true }));
    try {
      const docKey = limpiarNombreDoc(currentKey);
      const docRef = doc(db, 'maestros', docKey);
      const prevSnap = await getDoc(docRef);
      const prevDocData = prevSnap.exists() ? clonarProfundo(prevSnap.data()) : null;

      await reasignarOQuitarDependencia(
        currentKey,
        depModal.valor,
        depModal.accion === 'reasignar' ? depModal.nuevoValor : null
      );
      await eliminarValorMaestro(currentKey, depModal.itemId);

      const nextSnap = await getDoc(docRef);
      const nextDocData = nextSnap.exists() ? clonarProfundo(nextSnap.data()) : null;

      if (prevDocData && nextDocData) {
        pushAction({
          label: `Eliminar "${depModal.valor}" de ${currentKey}`,
          undoOps: [{ type: 'set', collection: 'maestros', id: docKey, data: prevDocData }],
          redoOps: [{ type: 'set', collection: 'maestros', id: docKey, data: nextDocData }],
          showToast: true,
          toastMessage: `🗑️ Valor "${depModal.valor}" eliminado de ${currentKey}`
        });
      }

      setDepModal(prev => ({ ...prev, open: false, processing: false }));
      await recargarTodo();
    } catch (e) {
      console.error(e);
      alert('Error al actualizar dependencias y eliminar el valor.');
      setDepModal(prev => ({ ...prev, processing: false }));
    }
  };

  // --- Perfiles: Roles y Usuarios ---
  const cambiarRolUsuario = async (docId: string, nuevoRol: string) => {
    if (!esAdmin) return;
    try {
      const userRef = doc(db, 'usuarios_app', docId);
      const prevSnap = await getDoc(userRef);
      const prevData = prevSnap.exists() ? clonarProfundo(prevSnap.data()) : null;

      const esProyector = esRolProyectorSala(nuevoRol);
      const updatePayload: any = { rol: nuevoRol };
      if (esProyector) updatePayload.es_programador = false;

      await setDoc(userRef, updatePayload, { merge: true });
      sessionStorage.removeItem('gym_programadores_cache_v1');

      if (prevData) {
        pushAction({
          label: `Cambiar rol de ${docId} a "${nuevoRol}"`,
          undoOps: [{ type: 'set', collection: 'usuarios_app', id: docId, data: prevData }],
          redoOps: [
            {
              type: 'set',
              collection: 'usuarios_app',
              id: docId,
              data: { ...prevData, ...updatePayload }
            }
          ],
          showToast: true,
          toastMessage: `✓ Rol de ${prevData.nombre || docId} actualizado a "${nuevoRol}"`
        });
      }

      const users = await cargarUsuariosAutenticacion();
      setUsuariosAuthGlobal(users);
    } catch (e) {
      console.error(e);
      alert('No se pudo actualizar el rol del usuario.');
    }
  };

  const vincularNuevoUsuarioAuth = async () => {
    if (!esAdmin) return;
    const email = newUserEmail.trim().toLowerCase();
    const nombre = newUserNombre.trim();
    const rol = newUserRol;

    if (!email || !email.includes('@')) {
      alert('Introduce un correo electrónico válido.');
      return;
    }
    if (!nombre) {
      alert('Introduce el nombre o alias del usuario.');
      return;
    }

    try {
      const userRef = doc(db, 'usuarios_app', email);
      const prevSnap = await getDoc(userRef);
      const prevData = prevSnap.exists() ? clonarProfundo(prevSnap.data()) : null;
      const esProyector = esRolProyectorSala(rol);

      const nuevoDoc = {
        email,
        nombre,
        alias: nombre,
        rol,
        es_programador: !esProyector
      };

      await setDoc(userRef, nuevoDoc, { merge: true });
      sessionStorage.removeItem('gym_programadores_cache_v1');

      pushAction({
        label: `Vincular usuario "${nombre}" (${rol})`,
        undoOps: [
          prevData
            ? { type: 'set', collection: 'usuarios_app', id: email, data: prevData }
            : { type: 'delete', collection: 'usuarios_app', id: email }
        ],
        redoOps: [{ type: 'set', collection: 'usuarios_app', id: email, data: nuevoDoc }],
        showToast: true,
        toastMessage: `✓ Usuario "${nombre}" vinculado con rol "${rol}"`
      });

      setNewUserEmail('');
      setNewUserNombre('');
      const users = await cargarUsuariosAutenticacion();
      setUsuariosAuthGlobal(users);
    } catch (e) {
      console.error(e);
      alert('Error al vincular el usuario en usuarios_app.');
    }
  };

  // --- Perfiles: Matriz de Permisos ---
  const togglePermisoRol = async (
    rolTarget: string,
    permId: string,
    tipoOp: keyof PermisoAccion,
    checked: boolean
  ) => {
    if (!esAdmin || esRolAdmin(rolTarget)) return;

    const prevMatriz = clonarProfundo(matrizPermisosGlobal);
    const nextMatriz = clonarProfundo(matrizPermisosGlobal);

    if (!nextMatriz[rolTarget]) {
      nextMatriz[rolTarget] = PermisosPorDefectoParaRol(rolTarget);
    }
    if (!nextMatriz[rolTarget][permId] || typeof nextMatriz[rolTarget][permId] !== 'object') {
      nextMatriz[rolTarget][permId] = { ver: false, editar: false, crear: false, borrar: false };
    }

    nextMatriz[rolTarget][permId][tipoOp] = Boolean(checked);

    if (checked && (tipoOp === 'editar' || tipoOp === 'crear' || tipoOp === 'borrar')) {
      nextMatriz[rolTarget][permId].ver = true;
    }
    if (!checked && tipoOp === 'ver') {
      nextMatriz[rolTarget][permId].editar = false;
      nextMatriz[rolTarget][permId].crear = false;
      nextMatriz[rolTarget][permId].borrar = false;
    }

    setMatrizPermisosGlobal(nextMatriz);

    try {
      await guardarMatrizPermisos(nextMatriz);
      pushAction({
        label: `${checked ? 'Activar' : 'Desactivar'} permiso [${tipoOp.toUpperCase()}] "${permId}" en rol "${rolTarget}"`,
        undoOps: [
          {
            type: 'set',
            collection: 'maestros',
            id: 'config_permisos_roles',
            data: { schema_version: 2, roles: prevMatriz }
          }
        ],
        redoOps: [
          {
            type: 'set',
            collection: 'maestros',
            id: 'config_permisos_roles',
            data: { schema_version: 2, roles: nextMatriz }
          }
        ],
        showToast: true,
        toastMessage: `✓ Permisos de "${rolTarget}" actualizados`
      });
    } catch (e) {
      console.error(e);
      setMatrizPermisosGlobal(prevMatriz);
      alert('Error al guardar el cambio de permisos.');
    }
  };

  const restaurarPermisosDefectoRol = async (rolTarget: string) => {
    if (!esAdmin || esRolAdmin(rolTarget)) return;
    if (
      !window.confirm(`¿Restaurar los permisos recomendados por defecto para el rol "${rolTarget}"?`)
    ) {
      return;
    }

    const prevMatriz = clonarProfundo(matrizPermisosGlobal);
    const nextMatriz = clonarProfundo(matrizPermisosGlobal);
    nextMatriz[rolTarget] = PermisosPorDefectoParaRol(rolTarget);

    setMatrizPermisosGlobal(nextMatriz);

    try {
      await guardarMatrizPermisos(nextMatriz);
      pushAction({
        label: `Restaurar permisos por defecto de "${rolTarget}"`,
        undoOps: [
          {
            type: 'set',
            collection: 'maestros',
            id: 'config_permisos_roles',
            data: { schema_version: 2, roles: prevMatriz }
          }
        ],
        redoOps: [
          {
            type: 'set',
            collection: 'maestros',
            id: 'config_permisos_roles',
            data: { schema_version: 2, roles: nextMatriz }
          }
        ],
        showToast: true,
        toastMessage: `↺ Permisos por defecto restaurados para "${rolTarget}"`
      });
    } catch (e) {
      console.error(e);
      setMatrizPermisosGlobal(prevMatriz);
      alert('No se pudieron restaurar los permisos.');
    }
  };

  const itemsActuales = getItemsActuales();
  const editable = puedeEditarActual();
  const esVistaPermisos =
    currentSection === 'Gestión de Perfiles' && currentKey === 'Permisos';
  const esVistaRoles = currentSection === 'Gestión de Perfiles' && currentKey === 'Roles';
  const rolesDisponibles = getRolesDisponibles();

  const descPorAccion: Record<string, { categoria: string; descripcion: string }> = {};
  if (esVistaPermisos) {
    CATALOGO_PERMISOS_APP.forEach(p => {
      descPorAccion[p.id] = { categoria: p.categoria, descripcion: p.descripcion };
      descPorAccion[p.nombre.toLowerCase()] = {
        categoria: p.categoria,
        descripcion: p.descripcion
      };
    });
  }

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>Configuración</h1>
          <div className="header-meta">
            Configura las listas desplegables, maestros y el orden de aparición en toda la aplicación
          </div>
        </div>
      </div>

      <div className="maestros-grid">
        {/* Left Sidebar */}
        <aside className="sidebar-card">
          {Object.entries(ESTRUCTURA_MAESTROS).map(([seccion, claves]) => (
            <div key={seccion} className="section-group">
              <div className="section-group-title">{seccion}</div>
              {claves.map(clv => {
                const count = mapaMaestros[seccion]?.[clv]?.length || 0;
                const isActive = seccion === currentSection && clv === currentKey;
                return (
                  <button
                    key={clv}
                    type="button"
                    className={`key-btn ${isActive ? 'active' : ''}`}
                    onClick={() => seleccionarClave(seccion, clv)}
                  >
                    <span>{clv}</span>
                    <span className="key-count">{count}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Right Panel */}
        <section className="card">
          <div className="maestros-header-bar">
            <div>
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                SECCIÓN · {currentSection.toUpperCase()}
              </div>
              <h2>{currentKey}</h2>
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {itemsActuales.length} {itemsActuales.length === 1 ? 'valor' : 'valores'}
            </span>
          </div>

          {!esAdmin && currentSection !== 'Ejercicios' && (
            <div className="readonly-banner">
              🔒 Modo consulta: como Programador solo puedes editar los maestros de la sección{' '}
              <strong>Ejercicios</strong>.
            </div>
          )}

          {!esVistaPermisos && editable && (
            <div className="add-item-bar">
              <input
                type={currentSection === 'Agenda' && currentKey === 'Ocupación máxima' ? 'number' : 'text'}
                min={currentSection === 'Agenda' && currentKey === 'Ocupación máxima' ? 1 : undefined}
                placeholder={
                  currentSection === 'Agenda' && currentKey === 'Ocupación máxima'
                    ? 'Escribe el valor de ocupación máxima (ej: 6)...'
                    : 'Escribe un nuevo valor para esta lista...'
                }
                value={inputValor}
                onChange={e => setInputValor(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleGuardarItem();
                  }
                }}
              />
              <button
                type="button"
                className="btn-primary"
                disabled={savingItem}
                onClick={handleGuardarItem}
              >
                {editingItemId || (currentSection === 'Agenda' && currentKey === 'Ocupación máxima')
                  ? 'Guardar valor'
                  : '+ Añadir'}
              </button>
              {editingItemId && (
                <button type="button" className="btn-outline" onClick={cancelarEdicion}>
                  Cancelar
                </button>
              )}
            </div>
          )}

          <div className="table-responsive">
            <table className="maestros-table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Orden</th>
                  <th>Valor</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {itemsActuales.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}
                    >
                      No hay valores registrados en esta lista.
                    </td>
                  </tr>
                ) : (
                  itemsActuales.map((item, idx) => {
                    const metaPermiso = esVistaPermisos
                      ? descPorAccion[item.id] || descPorAccion[item.valor.toLowerCase()]
                      : null;

                    return (
                      <tr
                        key={item.id}
                        className="maestros-row"
                        draggable={editable}
                        onDragStart={() => {
                          dragIdxRef.current = idx;
                        }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleDropRow(idx)}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {editable && (
                              <span
                                className="drag-handle"
                                title="Arrastra para cambiar el orden"
                              >
                                ⋮⋮
                              </span>
                            )}
                            <span className="order-badge">{idx + 1}</span>
                          </div>
                        </td>
                        <td>
                          <strong>{item.valor}</strong>
                          {metaPermiso && (
                            <>
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: '0.7rem',
                                  background: '#f0fdfa',
                                  color: '#0d7488',
                                  border: '1px solid #ccfbf1',
                                  padding: '2px 7px',
                                  borderRadius: 10,
                                  fontWeight: 700
                                }}
                              >
                                {metaPermiso.categoria}
                              </span>
                              <div
                                style={{
                                  fontSize: '0.78rem',
                                  color: 'var(--text-muted)',
                                  marginTop: 2
                                }}
                              >
                                {metaPermiso.descripcion}
                              </div>
                            </>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {editable ? (
                            <div className="action-btns" style={{ justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn-icon"
                                title="Renombrar"
                                onClick={() => iniciarEdicion(item.id, item.valor)}
                              >
                                ✏️ Editar
                              </button>
                              <button
                                type="button"
                                className="btn-icon danger"
                                title="Eliminar"
                                onClick={() => solicitarBorrado(item.id, item.valor)}
                              >
                                <svg
                                  width="15"
                                  height="15"
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
                          ) : esVistaPermisos ? (
                            <span
                              style={{
                                color: '#0369a1',
                                background: '#e0f2fe',
                                padding: '3px 8px',
                                borderRadius: 6,
                                fontSize: '0.72rem',
                                fontWeight: 700
                              }}
                            >
                              Acción del sistema
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                              Solo lectura
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Extra Panel: Roles */}
          {esVistaRoles && (
            <div
              style={{
                marginTop: 28,
                paddingTop: 22,
                borderTop: '2px solid var(--border)'
              }}
            >
              <div className="maestros-header-bar" style={{ marginBottom: 14 }}>
                <div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--accent-dark)',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    CUENTAS VINCULADAS A FIREBASE AUTHENTICATION
                  </div>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '1.1rem' }}>
                    👤 Usuarios de Autenticación y Asignación de Rol
                  </h3>
                </div>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {usuariosAuthGlobal.length} usuarios registrados
                </span>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
                Asigna qué rol tiene cada cuenta de acceso de Firebase Authentication. La cuenta{' '}
                <code>invitado@goandtrain.com</code> utiliza el rol <strong>Proyector Sala</strong>{' '}
                con acceso exclusivo a Pantalla Sala.
              </p>

              <div className="table-responsive" style={{ marginBottom: 18 }}>
                <table className="maestros-table">
                  <thead>
                    <tr>
                      <th>Nombre / Alias</th>
                      <th>Correo (Auth)</th>
                      <th>Programador</th>
                      <th style={{ width: 220 }}>Rol Asignado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosAuthGlobal.map(u => {
                      const esProyector =
                        esRolProyectorSala(u.rol) ||
                        u.email.toLowerCase() === 'invitado@goandtrain.com';
                      const opcionesRol = [...rolesDisponibles];
                      if (u.rol && !opcionesRol.includes(u.rol)) opcionesRol.push(u.rol);

                      return (
                        <tr key={u.id} className="maestros-row">
                          <td>
                            <strong>{u.nombre}</strong>
                            {u.alias && u.alias !== u.nombre ? ` (${u.alias})` : ''}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>
                            {u.email || u.id}
                          </td>
                          <td>
                            {esProyector ? (
                              <span
                                className="pill"
                                style={{
                                  background: '#f1f5f9',
                                  color: '#64748b',
                                  border: '1px solid #cbd5e1'
                                }}
                              >
                                Solo Proyección
                              </span>
                            ) : (
                              <span className="pill status-activo">Entrenador / Staff</span>
                            )}
                          </td>
                          <td>
                            <select
                              className="form-control"
                              style={{
                                minHeight: 36,
                                padding: '6px 10px',
                                fontSize: '0.85rem',
                                fontWeight: 600
                              }}
                              disabled={!esAdmin}
                              value={u.rol}
                              onChange={e => cambiarRolUsuario(u.id, e.target.value)}
                            >
                              {opcionesRol.map(r => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {esAdmin && (
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 16
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      marginBottom: 10,
                      color: 'var(--text-main)'
                    }}
                  >
                    + Vincular Usuario Registrado en Firebase Authentication
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.3fr 1fr 1fr auto',
                      gap: 10,
                      alignItems: 'end'
                    }}
                  >
                    <div>
                      <label
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: 4
                        }}
                      >
                        Correo electrónico (Firebase Auth)
                      </label>
                      <input
                        type="email"
                        className="form-control"
                        placeholder="usuario@goandtrain.com"
                        style={{ minHeight: 38 }}
                        value={newUserEmail}
                        onChange={e => setNewUserEmail(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: 4
                        }}
                      >
                        Nombre / Alias
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Ej: Maite"
                        style={{ minHeight: 38 }}
                        value={newUserNombre}
                        onChange={e => setNewUserNombre(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: 4
                        }}
                      >
                        Rol a asignar
                      </label>
                      <select
                        className="form-control"
                        style={{ minHeight: 38 }}
                        value={newUserRol}
                        onChange={e => setNewUserRol(e.target.value)}
                      >
                        {rolesDisponibles.map(r => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ height: 38 }}
                      onClick={vincularNuevoUsuarioAuth}
                    >
                      + Vincular
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Extra Panel: Matriz de Permisos */}
          {esVistaPermisos && (
            <div
              style={{
                marginTop: 28,
                paddingTop: 22,
                borderTop: '2px solid var(--border)'
              }}
            >
              <div className="maestros-header-bar" style={{ marginBottom: 14 }}>
                <div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--accent-dark)',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    CONTROL DE ACCESO POR ROL Y TIPO DE OPERACIÓN
                  </div>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '1.1rem' }}>
                    🔐 Matriz de Permisos por Rol (Ver · Editar · Crear · Borrar)
                  </h3>
                </div>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
                Selecciona un rol en las pestañas superiores para configurar qué acciones puede{' '}
                <strong>Ver</strong>, <strong>Editar</strong>, <strong>Crear</strong> o{' '}
                <strong>Borrar</strong>. El rol <strong>admin</strong> tiene todos los permisos
                habilitados permanentemente y el rol <strong>Proyector Sala</strong> viene
                configurado por defecto solo con visualización de{' '}
                <strong>Pantalla Sala (TV)</strong>.
              </p>

              {/* Pestañas de Roles */}
              <div className="perm-role-tabs">
                {rolesDisponibles.map(r => {
                  const active = r === rolSeleccionadoPermisos;
                  const mapaR = matrizPermisosGlobal[r] || PermisosPorDefectoParaRol(r);
                  const totalChecks = CATALOGO_PERMISOS_APP.length * 4;
                  let activosCount = 0;
                  if (esRolAdmin(r)) {
                    activosCount = totalChecks;
                  } else {
                    CATALOGO_PERMISOS_APP.forEach(p => {
                      const obj = mapaR[p.id] || {
                        ver: false,
                        editar: false,
                        crear: false,
                        borrar: false
                      };
                      if (obj.ver) activosCount++;
                      if (obj.editar) activosCount++;
                      if (obj.crear) activosCount++;
                      if (obj.borrar) activosCount++;
                    });
                  }

                  return (
                    <button
                      key={r}
                      type="button"
                      className={`perm-role-tab ${active ? 'active' : ''}`}
                      onClick={() => setRolSeleccionadoPermisos(r)}
                    >
                      <span>👤 {r}</span>
                      <span className="role-badge">
                        {activosCount}/{totalChecks}
                      </span>
                    </button>
                  );
                })}
              </div>

              {(() => {
                const rolActivo = rolesDisponibles.includes(rolSeleccionadoPermisos)
                  ? rolSeleccionadoPermisos
                  : rolesDisponibles[0];
                const isTargetAdmin = esRolAdmin(rolActivo);
                const isTargetProyector = esRolProyectorSala(rolActivo);
                const mapaRolActual =
                  matrizPermisosGlobal[rolActivo] || PermisosPorDefectoParaRol(rolActivo);

                const porCategoria: Record<string, typeof CATALOGO_PERMISOS_APP> = {};
                CATALOGO_PERMISOS_APP.forEach(p => {
                  if (!porCategoria[p.categoria]) porCategoria[p.categoria] = [];
                  porCategoria[p.categoria].push(p);
                });

                return (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#f8fafc',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: '12px 16px',
                        marginBottom: 16,
                        flexWrap: 'wrap',
                        gap: 10
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '0.95rem',
                            fontWeight: 800,
                            color: 'var(--text-main)'
                          }}
                        >
                          Configurando permisos del rol:{' '}
                          <span style={{ color: 'var(--accent-dark)' }}>{rolActivo}</span>
                          {isTargetAdmin && (
                            <span
                              className="pill status-activo"
                              style={{ marginLeft: 8, fontSize: '0.72rem' }}
                            >
                              Acceso Total Fijo
                            </span>
                          )}
                          {isTargetProyector && (
                            <span
                              className="pill"
                              style={{
                                marginLeft: 8,
                                fontSize: '0.72rem',
                                background: '#e0f2fe',
                                color: '#0369a1'
                              }}
                            >
                              Perfil TV / Sala
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {isTargetAdmin
                            ? 'El rol administrador dispone siempre de todos los permisos (Ver, Editar, Crear y Borrar).'
                            : 'Marca o desmarca las casillas para habilitar o restringir cada tipo de operación en este rol.'}
                        </div>
                      </div>
                      {esAdmin && !isTargetAdmin && (
                        <button
                          type="button"
                          className="btn-outline"
                          style={{ padding: '7px 14px', fontSize: '0.8rem' }}
                          onClick={() => restaurarPermisosDefectoRol(rolActivo)}
                        >
                          ↺ Restaurar valores por defecto
                        </button>
                      )}
                    </div>

                    <div className="table-responsive">
                      <table className="maestros-table perm-matrix-table">
                        <thead>
                          <tr>
                            <th style={{ minWidth: 280 }}>Acción / Módulo del Sistema</th>
                            <th style={{ width: 95 }}>👁️ Ver</th>
                            <th style={{ width: 95 }}>✏️ Editar</th>
                            <th style={{ width: 95 }}>➕ Crear</th>
                            <th style={{ width: 95 }}>🗑️ Borrar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(porCategoria).map(([cat, acciones]) => (
                            <React.Fragment key={cat}>
                              <tr>
                                <td
                                  colSpan={5}
                                  style={{
                                    background: '#f0fdfa',
                                    color: '#0d7488',
                                    fontWeight: 800,
                                    fontSize: '0.76rem',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.6px',
                                    padding: '8px 14px'
                                  }}
                                >
                                  📂 {cat}
                                </td>
                              </tr>
                              {acciones.map(p => {
                                const estadoPerm = isTargetAdmin
                                  ? { ver: true, editar: true, crear: true, borrar: true }
                                  : mapaRolActual[p.id] || {
                                      ver: false,
                                      editar: false,
                                      crear: false,
                                      borrar: false
                                    };
                                const disabledAttr = !esAdmin || isTargetAdmin;

                                return (
                                  <tr key={p.id} className="maestros-row">
                                    <td>
                                      <strong>{p.nombre}</strong>
                                      <div
                                        style={{
                                          fontSize: '0.76rem',
                                          color: 'var(--text-muted)',
                                          marginTop: 2
                                        }}
                                      >
                                        {p.descripcion}
                                      </div>
                                    </td>
                                    {(['ver', 'editar', 'crear', 'borrar'] as const).map(op => (
                                      <td key={op}>
                                        <input
                                          type="checkbox"
                                          className="perm-check"
                                          checked={Boolean(estadoPerm[op])}
                                          disabled={disabledAttr}
                                          onChange={e =>
                                            togglePermisoRol(
                                              rolActivo,
                                              p.id,
                                              op,
                                              e.target.checked
                                            )
                                          }
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </section>
      </div>

      {/* Modal Dependencias */}
      {depModal.open && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content small">
            <button
              type="button"
              className="modal-close"
              onClick={() => setDepModal(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>⚠️ Valor en uso</h2>
              <p>
                El valor <strong>"{depModal.valor}"</strong> se está utilizando actualmente en{' '}
                <strong>{depModal.depsCount}</strong> registro(s) ({depModal.colsStr}).
              </p>
            </div>

            <div className="form-group">
              <label>¿Qué deseas hacer con los registros que usan este valor?</label>
              <label className="radio-option" style={{ marginTop: 8 }}>
                <input
                  type="radio"
                  name="depAccion"
                  value="vaciar"
                  checked={depModal.accion === 'vaciar'}
                  onChange={() => setDepModal(prev => ({ ...prev, accion: 'vaciar' }))}
                />
                <span>Dejar el campo vacío en esos registros</span>
              </label>
              <label className="radio-option" style={{ marginTop: 8 }}>
                <input
                  type="radio"
                  name="depAccion"
                  value="reasignar"
                  checked={depModal.accion === 'reasignar'}
                  onChange={() => setDepModal(prev => ({ ...prev, accion: 'reasignar' }))}
                />
                <span>Reasignar a otro valor existente:</span>
              </label>
              <select
                className="form-control"
                style={{ marginTop: 8 }}
                disabled={depModal.accion !== 'reasignar'}
                value={depModal.nuevoValor}
                onChange={e =>
                  setDepModal(prev => ({ ...prev, nuevoValor: e.target.value }))
                }
              >
                {depModal.otherOptions.map(o => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setDepModal(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={depModal.processing}
                onClick={confirmarBorradoConDependencias}
              >
                {depModal.processing ? 'Procesando...' : 'Aplicar y Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
