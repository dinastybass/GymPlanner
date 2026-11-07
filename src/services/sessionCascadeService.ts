import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { FirestoreOp } from './undoService';
import { esSesionCompletada, esSesionCancelada } from '../utils/helpers';
import {
  getMesesMargenReprogramacion,
  obtenerFechaLimiteReprogramacionUTC
} from './maestrosService';

export interface MovimientoLogCliente {
  id: string;
  id_cliente: string;
  tipo:
    | 'CANCELACION'
    | 'VENCIMIENTO'
    | 'REPROGRAMACION'
    | 'ASIGNACION_SIN_FECHA'
    | 'CADUCIDAD_SIN_FECHA';
  titulo: string;
  detalle: string;
  fecha_registro: string; // ISO string for clean serialization in Firestore arrays
  usuario: string;
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const clonarProfundo = (obj: any) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

export function formatearFechaHoraHumanaUTC(fecha: Date | null | undefined): string {
  if (!fecha || isNaN(fecha.getTime())) return 'Sin fecha';
  const diaSem = DIAS_SEMANA[fecha.getUTCDay()] || '';
  const d = String(fecha.getUTCDate()).padStart(2, '0');
  const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const y = fecha.getUTCFullYear();
  const hh = String(fecha.getUTCHours()).padStart(2, '0');
  const mm = String(fecha.getUTCMinutes()).padStart(2, '0');
  return `${diaSem} ${d}/${m}/${y} a las ${hh}:${mm}`;
}

function esSmallGroupTipo(tipoRaw: any): boolean {
  const t = String(tipoRaw || '').toLowerCase();
  return t.includes('small') || t.includes('group') || t === 'sg';
}

function tieneEjercicios(sesion: any): boolean {
  return Array.isArray(sesion?.ejercicios) && sesion.ejercicios.length > 0;
}

function extraerPayloadProgramacion(sesion: any) {
  return {
    ejercicios: clonarProfundo(sesion?.ejercicios || []),
    intensidad_sesion: sesion?.intensidad_sesion || sesion?.intensidad || 'MED',
    orden_customizado: Boolean(sesion?.orden_customizado),
    ultimo_editor: sesion?.ultimo_editor || sesion?.ultimo_modificado_por || '',
    fecha_ultima_edicion: sesion?.fecha_ultima_edicion || sesion?.fecha_modificacion || null
  };
}

function crearPayloadVacio() {
  return {
    ejercicios: [],
    intensidad_sesion: 'MED',
    orden_customizado: false,
    ultimo_editor: '',
    fecha_ultima_edicion: null
  };
}

async function resolverDocumentoCliente(idCliente: string): Promise<{
  docId: string | null;
  data: any | null;
  allClientIds: string[];
}> {
  if (!idCliente) return { docId: null, data: null, allClientIds: [] };

  const idsSet = new Set<string>([idCliente]);
  const directSnap = await getDoc(doc(db, 'clientes', idCliente));
  if (directSnap.exists()) {
    const data = directSnap.data();
    if (data.ID_Cliente && String(data.ID_Cliente).trim()) {
      idsSet.add(String(data.ID_Cliente).trim());
    }
    return { docId: directSnap.id, data, allClientIds: Array.from(idsSet) };
  }

  const qAlt = query(collection(db, 'clientes'), where('ID_Cliente', '==', idCliente));
  const altSnap = await getDocs(qAlt);
  if (!altSnap.empty) {
    const first = altSnap.docs[0];
    idsSet.add(first.id);
    return { docId: first.id, data: first.data(), allClientIds: Array.from(idsSet) };
  }

  return { docId: null, data: null, allClientIds: Array.from(idsSet) };
}

async function cargarSesionesDeCliente(allClientIds: string[]): Promise<any[]> {
  if (allClientIds.length === 0) return [];
  const mapDocs = new Map<string, any>();

  for (const cid of allClientIds) {
    const snap = await getDocs(query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', cid)));
    snap.forEach(d => {
      const raw = d.data();
      const esSinFecha = Boolean(raw.sin_fecha === true || !raw.fecha_hora_inicio);
      const fechaObj =
        !esSinFecha && raw.fecha_hora_inicio
          ? raw.fecha_hora_inicio.toDate
            ? raw.fecha_hora_inicio.toDate()
            : new Date(raw.fecha_hora_inicio)
          : null;
      mapDocs.set(d.id, {
        id: d.id,
        raw: clonarProfundo(raw),
        ...raw,
        sin_fecha: esSinFecha,
        fechaObj
      });
    });
  }

  return Array.from(mapDocs.values());
}

function prepararOperacionLogCliente(
  batch: ReturnType<typeof writeBatch>,
  undoOps: FirestoreOp[],
  redoOps: FirestoreOp[],
  clienteInfo: { docId: string | null; data: any | null },
  nuevoLog: MovimientoLogCliente
) {
  if (!clienteInfo.docId || !clienteInfo.data) return;
  const prevHistorial: MovimientoLogCliente[] = Array.isArray(clienteInfo.data.historial_movimientos)
    ? clonarProfundo(clienteInfo.data.historial_movimientos)
    : [];
  const nextHistorial = [nuevoLog, ...prevHistorial].slice(0, 200);

  batch.update(doc(db, 'clientes', clienteInfo.docId), {
    historial_movimientos: nextHistorial
  });

  undoOps.push({
    type: 'update',
    collection: 'clientes',
    id: clienteInfo.docId,
    data: { historial_movimientos: prevHistorial }
  });
  redoOps.push({
    type: 'update',
    collection: 'clientes',
    id: clienteInfo.docId,
    data: { historial_movimientos: nextHistorial }
  });
}

/**
 * 1. CANCELAR SESIÓN (Manual o Vencimiento Automático)
 * - Elimina la cita cancelada del calendario para liberar el hueco.
 * - Desplaza su programación en cascada hacia delante a las siguientes sesiones pendientes del cliente.
 * - La programación de la última sesión programada pasa a la bolsa de "Sesiones programadas sin fecha".
 * - Registra la entrada profesional en el historial del cliente.
 */
export async function cancelarSesionConCascadaAdelante(params: {
  idSesion: string;
  esAutomatico?: boolean;
  usuario?: string;
}): Promise<{
  ok: boolean;
  undoOps: FirestoreOp[];
  redoOps: FirestoreOp[];
  toastMessage: string;
  logEntry?: MovimientoLogCliente;
}> {
  const { idSesion, esAutomatico = false, usuario = 'Entrenador' } = params;

  const sesSnap = await getDoc(doc(db, 'agenda_sesiones', idSesion));
  if (!sesSnap.exists()) {
    return { ok: false, undoOps: [], redoOps: [], toastMessage: 'La sesión no existe.' };
  }

  const sesData = sesSnap.data();
  const idCliente = sesData.id_cliente || sesData.ID_Cliente || '';
  const nombreCli =
    sesData.cliente_nombre || sesData.alias || sesData.Alias || sesData.nombre_cliente || 'Cliente';
  const fechaCancelada: Date | null = sesData.fecha_hora_inicio
    ? sesData.fecha_hora_inicio.toDate
      ? sesData.fecha_hora_inicio.toDate()
      : new Date(sesData.fecha_hora_inicio)
    : null;

  const clienteInfo = await resolverDocumentoCliente(idCliente);
  const todasSesiones = await cargarSesionesDeCliente(
    clienteInfo.allClientIds.length > 0 ? clienteInfo.allClientIds : [idCliente]
  );

  const sesionObjetivo = todasSesiones.find(s => s.id === idSesion) || {
    id: idSesion,
    raw: clonarProfundo(sesData),
    ...sesData,
    sin_fecha: Boolean(sesData.sin_fecha || !fechaCancelada),
    fechaObj: fechaCancelada
  };

  const esSG = esSmallGroupTipo(sesionObjetivo.tipo_sesion);
  const batch = writeBatch(db);
  const undoOps: FirestoreOp[] = [];
  const redoOps: FirestoreOp[] = [];
  const ahora = new Date();

  // 1. Eliminar la cita cancelada del calendario
  batch.delete(doc(db, 'agenda_sesiones', idSesion));
  undoOps.push({
    type: 'set',
    collection: 'agenda_sesiones',
    id: idSesion,
    data: sesionObjetivo.raw,
    merge: false
  });
  redoOps.push({
    type: 'delete',
    collection: 'agenda_sesiones',
    id: idSesion
  });

  let huboCascada = false;
  let pasoASinFecha = false;

  if (!esSG && fechaCancelada) {
    // Sesiones individuales futuras (posteriores a la sesión cancelada, no completadas ni canceladas)
    const futuras = todasSesiones
      .filter(
        s =>
          s.id !== idSesion &&
          !s.sin_fecha &&
          s.fechaObj &&
          !esSmallGroupTipo(s.tipo_sesion) &&
          !esSesionCompletada(s) &&
          !esSesionCancelada(s) &&
          s.fechaObj.getTime() > fechaCancelada.getTime()
      )
      .sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());

    const secuencia = [sesionObjetivo, ...futuras];

    // Encontrar la última sesión que tiene ejercicios programados
    let lastProgIdx = -1;
    for (let i = secuencia.length - 1; i >= 0; i--) {
      if (tieneEjercicios(secuencia[i])) {
        lastProgIdx = i;
        break;
      }
    }

    if (lastProgIdx >= 0) {
      // El payload de la última sesión programada pasará a la bolsa de "Sin fecha"
      const payloadParaSinFecha = extraerPayloadProgramacion(secuencia[lastProgIdx]);

      // Desplazar en cascada hacia delante desde 0 hasta lastProgIdx
      for (let i = 1; i <= lastProgIdx; i++) {
        const sesionDestino = secuencia[i];
        const payloadAnterior = extraerPayloadProgramacion(secuencia[i - 1]);
        const updateFields = {
          ejercicios: payloadAnterior.ejercicios,
          intensidad_sesion: payloadAnterior.intensidad_sesion,
          orden_customizado: payloadAnterior.orden_customizado,
          ultimo_editor: usuario,
          fecha_ultima_edicion: ahora,
          ultimo_modificado_por: usuario,
          fecha_modificacion: ahora
        };
        batch.update(doc(db, 'agenda_sesiones', sesionDestino.id), updateFields);
        undoOps.push({
          type: 'set',
          collection: 'agenda_sesiones',
          id: sesionDestino.id,
          data: sesionDestino.raw,
          merge: false
        });
        redoOps.push({
          type: 'set',
          collection: 'agenda_sesiones',
          id: sesionDestino.id,
          data: { ...sesionDestino.raw, ...updateFields },
          merge: false
        });
        huboCascada = true;
      }

      // Crear la sesión en la bolsa de "Sesiones programadas sin fecha" con la programación sobrante
      const newSinFechaId = `SES-SF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const sinFechaDocData = {
        id_sesion_global: newSinFechaId,
        id_cliente: clienteInfo.docId || idCliente,
        alias: nombreCli,
        nombre_cliente: nombreCli,
        cliente_nombre: nombreCli,
        tipo_sesion: sesionObjetivo.tipo_sesion || 'Individual',
        sin_fecha: true,
        fecha_hora_inicio: null,
        fecha_hora_anterior: sesionObjetivo.raw?.fecha_hora_inicio || null,
        fecha_creacion_sin_fecha: ahora,
        estado: 'Sin fecha',
        estado_sesion: 'Pendiente',
        ejercicios: payloadParaSinFecha.ejercicios,
        intensidad_sesion: payloadParaSinFecha.intensidad_sesion,
        orden_customizado: payloadParaSinFecha.orden_customizado,
        ultimo_editor: usuario,
        fecha_ultima_edicion: ahora,
        creado_por: usuario,
        fecha_creacion: ahora,
        utc_migrado: true
      };

      batch.set(doc(db, 'agenda_sesiones', newSinFechaId), sinFechaDocData);
      undoOps.push({
        type: 'delete',
        collection: 'agenda_sesiones',
        id: newSinFechaId
      });
      redoOps.push({
        type: 'set',
        collection: 'agenda_sesiones',
        id: newSinFechaId,
        data: sinFechaDocData,
        merge: false
      });
      pasoASinFecha = true;
    }
  }

  const fechaTexto = formatearFechaHoraHumanaUTC(fechaCancelada);
  const detalleLog = esAutomatico
    ? pasoASinFecha
      ? `La sesión del ${fechaTexto} finalizó el día sin completarse. Se liberó el hueco, su programación se desplazó en cascada a las siguientes sesiones y la última rutina pasó a Sesiones sin fecha.`
      : `La sesión del ${fechaTexto} finalizó el día sin completarse y se anuló automáticamente.`
    : pasoASinFecha
    ? `El cliente canceló la sesión del ${fechaTexto}. Se liberó el hueco en agenda, la programación avanzó en cascada a los siguientes días y la última rutina pasó a Sesiones sin fecha.`
    : `El cliente canceló la sesión del ${fechaTexto}, liberando su hueco en la agenda.`;

  const logEntry: MovimientoLogCliente = {
    id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    id_cliente: clienteInfo.docId || idCliente,
    tipo: esAutomatico ? 'VENCIMIENTO' : 'CANCELACION',
    titulo: esAutomatico ? 'Cancelación automática por vencimiento' : 'Sesión cancelada',
    detalle: detalleLog,
    fecha_registro: ahora.toISOString(),
    usuario: esAutomatico ? 'Sistema Automático' : usuario
  };

  prepararOperacionLogCliente(batch, undoOps, redoOps, clienteInfo, logEntry);

  await batch.commit();

  const toastMessage = pasoASinFecha
    ? huboCascada
      ? `📅 Sesión cancelada: rutinas desplazadas en cascada y última pasada a "Sin fecha"`
      : `📌 Sesión cancelada y guardada en "Sesiones sin fecha"`
    : `🗑️ Sesión del ${fechaTexto} cancelada`;

  return { ok: true, undoOps, redoOps, toastMessage, logEntry };
}

/**
 * 2. ASIGNAR FECHA A SESIÓN DE LA BOLSA "SIN FECHA" (Cascada hacia atrás)
 * - Trae la programación de la siguiente sesión a la fecha donde se ubica la "sin fecha"
 *   y sucesivamente con las siguientes sesiones programadas.
 * - Ubica la programación que tenía la sesión "sin fecha" en la última sesión programada,
 *   o si las últimas sesiones están sin programar (vacías), en la primera "no programada"
 *   de la última secuencia de vacías (empezando desde la última sesión con fecha hacia atrás).
 */
export async function asignarFechaASesionSinFechaConCascadaAtras(params: {
  idSesionSinFecha: string;
  nuevaFechaUTC: Date;
  idHuecoExistente?: string;
  usuario?: string;
}): Promise<{
  ok: boolean;
  undoOps: FirestoreOp[];
  redoOps: FirestoreOp[];
  toastMessage: string;
  logEntry?: MovimientoLogCliente;
}> {
  const { idSesionSinFecha, nuevaFechaUTC, idHuecoExistente, usuario = 'Entrenador' } = params;

  const sfSnap = await getDoc(doc(db, 'agenda_sesiones', idSesionSinFecha));
  if (!sfSnap.exists()) {
    return { ok: false, undoOps: [], redoOps: [], toastMessage: 'La sesión sin fecha no existe.' };
  }

  const sfData = sfSnap.data();
  const idCliente = sfData.id_cliente || sfData.ID_Cliente || '';
  const clienteInfo = await resolverDocumentoCliente(idCliente);
  const todasSesiones = await cargarSesionesDeCliente(
    clienteInfo.allClientIds.length > 0 ? clienteInfo.allClientIds : [idCliente]
  );

  const sesionSinFechaObj = todasSesiones.find(s => s.id === idSesionSinFecha) || {
    id: idSesionSinFecha,
    raw: clonarProfundo(sfData),
    ...sfData,
    sin_fecha: true,
    fechaObj: null
  };

  const payloadSinFecha = extraerPayloadProgramacion(sesionSinFechaObj);
  const sfTieneEjercicios = tieneEjercicios(payloadSinFecha);

  // Comprobar si ya existe una sesión en esa misma fecha/hora o se indicó idHuecoExistente
  const sesionesConFecha = todasSesiones.filter(
    s =>
      s.id !== idSesionSinFecha &&
      !s.sin_fecha &&
      s.fechaObj &&
      !esSmallGroupTipo(s.tipo_sesion) &&
      !esSesionCancelada(s)
  );

  const huecoExistente =
    (idHuecoExistente && sesionesConFecha.find(s => s.id === idHuecoExistente)) ||
    sesionesConFecha.find(
      s => Math.abs(s.fechaObj.getTime() - nuevaFechaUTC.getTime()) < 60 * 1000
    ) ||
    null;

  const fechaDestinoEfectiva = huecoExistente ? huecoExistente.fechaObj : nuevaFechaUTC;
  const batch = writeBatch(db);
  const undoOps: FirestoreOp[] = [];
  const redoOps: FirestoreOp[] = [];
  const ahora = new Date();

  // Construir la lista cronológica de sesiones pendientes (no completadas) más el hueco de destino
  // Nota: también mantenemos referencia a la última sesión completada para no retroceder antes de ella
  const pendientesConFecha = sesionesConFecha.filter(s => !esSesionCompletada(s));

  interface NodoFecha {
    id: string;
    esSlotNuevoDeSinFecha: boolean;
    fechaObj: Date;
    rawOriginal: any;
    payloadActual: ReturnType<typeof extraerPayloadProgramacion>;
  }

  const nodos: NodoFecha[] = [];

  if (huecoExistente) {
    // Eliminamos el documento sin_fecha porque se absorbe en la agenda
    batch.delete(doc(db, 'agenda_sesiones', idSesionSinFecha));
    undoOps.push({
      type: 'set',
      collection: 'agenda_sesiones',
      id: idSesionSinFecha,
      data: sesionSinFechaObj.raw,
      merge: false
    });
    redoOps.push({
      type: 'delete',
      collection: 'agenda_sesiones',
      id: idSesionSinFecha
    });

    pendientesConFecha.forEach(s => {
      nodos.push({
        id: s.id,
        esSlotNuevoDeSinFecha: false,
        fechaObj: s.fechaObj,
        rawOriginal: s.raw,
        payloadActual: extraerPayloadProgramacion(s)
      });
    });
  } else {
    // Reutilizamos el documento sin_fecha asignándole fecha_hora_inicio = fechaDestinoEfectiva
    pendientesConFecha.forEach(s => {
      nodos.push({
        id: s.id,
        esSlotNuevoDeSinFecha: false,
        fechaObj: s.fechaObj,
        rawOriginal: s.raw,
        payloadActual: extraerPayloadProgramacion(s)
      });
    });
    nodos.push({
      id: idSesionSinFecha,
      esSlotNuevoDeSinFecha: true,
      fechaObj: fechaDestinoEfectiva,
      rawOriginal: sesionSinFechaObj.raw,
      payloadActual: crearPayloadVacio()
    });
  }

  // Ordenar todos los nodos pendientes cronológicamente
  nodos.sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());

  const targetNodeId = huecoExistente ? huecoExistente.id : idSesionSinFecha;
  const idxDest = nodos.findIndex(n => n.id === targetNodeId);

  if (sfTieneEjercicios && idxDest !== -1) {
    // Encontrar la última sesión (distinta de idxDest si es nueva) que tiene ejercicios
    let lastProgIdx = -1;
    for (let i = nodos.length - 1; i >= 0; i--) {
      if (i !== idxDest && tieneEjercicios(nodos[i].payloadActual)) {
        lastProgIdx = i;
        break;
      }
    }

    // 1. Si hay sesiones con ejercicios posteriores a idxDest, hacemos la cascada hacia atrás:
    // traer la programación de la siguiente sesión a la fecha donde ubicamos la sin fecha, y sucesivamente
    if (lastProgIdx > idxDest) {
      for (let i = idxDest; i < lastProgIdx; i++) {
        nodos[i].payloadActual = clonarProfundo(nodos[i + 1].payloadActual);
      }
      // La última que tenía programación queda libre para determinar dónde cae la de "sin fecha"
      nodos[lastProgIdx].payloadActual = crearPayloadVacio();
    }

    // 2. Ubicar la programación de "sin fecha":
    // - Si la última sesión con fecha estaba programada, cae en esa última sesión programada.
    // - Si las últimas sesiones están sin programar (vacías), se ubica en la primera "no programada"
    //   de la última secuencia de vacías, empezando por la última sesión con fecha hacia atrás
    //   (ignorando cualquier vacía que hubiera entre medias antes de alguna sesión con ejercicios).
    let idxUltimaConEjercicios = -1;
    for (let i = nodos.length - 1; i >= 0; i--) {
      if (tieneEjercicios(nodos[i].payloadActual)) {
        idxUltimaConEjercicios = i;
        break;
      }
    }

    let idxUbicacionSinFecha = idxDest;
    if (idxUltimaConEjercicios === nodos.length - 1) {
      // Todas hasta la última tienen ejercicios: se pone en la última sesión
      idxUbicacionSinFecha = nodos.length - 1;
    } else if (idxUltimaConEjercicios >= 0) {
      // Hay una secuencia final de sesiones vacías después de idxUltimaConEjercicios:
      // la primera vacía de esa última secuencia de vacías es exactamente idxUltimaConEjercicios + 1
      idxUbicacionSinFecha = idxUltimaConEjercicios + 1;
    } else {
      // Ninguna sesión pendiente tiene ejercicios: la primera vacía de la secuencia final
      idxUbicacionSinFecha = idxDest;
    }

    nodos[idxUbicacionSinFecha].payloadActual = clonarProfundo(payloadSinFecha);
  }

  // Persistir todos los nodos en Firestore
  for (const nodo of nodos) {
    const updateData: any = {
      sin_fecha: false,
      fecha_hora_inicio: nodo.fechaObj,
      estado: 'Pendiente',
      estado_sesion: 'Pendiente',
      ejercicios: nodo.payloadActual.ejercicios,
      intensidad_sesion: nodo.payloadActual.intensidad_sesion,
      orden_customizado: nodo.payloadActual.orden_customizado,
      ultimo_editor: usuario,
      fecha_ultima_edicion: ahora,
      ultimo_modificado_por: usuario,
      fecha_modificacion: ahora,
      utc_migrado: true
    };

    batch.set(doc(db, 'agenda_sesiones', nodo.id), updateData, { merge: true });
    undoOps.push({
      type: 'set',
      collection: 'agenda_sesiones',
      id: nodo.id,
      data: nodo.rawOriginal,
      merge: false
    });
    redoOps.push({
      type: 'set',
      collection: 'agenda_sesiones',
      id: nodo.id,
      data: { ...nodo.rawOriginal, ...updateData },
      merge: false
    });
  }

  const fechaTexto = formatearFechaHoraHumanaUTC(fechaDestinoEfectiva);
  const logEntry: MovimientoLogCliente = {
    id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    id_cliente: clienteInfo.docId || idCliente,
    tipo: 'ASIGNACION_SIN_FECHA',
    titulo: 'Sesión sin fecha asignada',
    detalle: `Se asignó fecha a una sesión de la bolsa Sin fecha para el ${fechaTexto}, ajustando el orden de las programaciones.`,
    fecha_registro: ahora.toISOString(),
    usuario
  };

  prepararOperacionLogCliente(batch, undoOps, redoOps, clienteInfo, logEntry);

  await batch.commit();

  return {
    ok: true,
    undoOps,
    redoOps,
    toastMessage: `📅 Sesión sin fecha asignada al ${fechaTexto}`,
    logEntry
  };
}

/**
 * 3. REPROGRAMAR DIRECTAMENTE UNA SESIÓN CON FECHA
 * - Cambia la fecha/hora de la sesión y reordena automáticamente las rutinas en orden cronológico
 *   sin preguntar opciones de cascada.
 * - Registra la entrada profesional en el historial del cliente.
 */
export async function reprogramarSesionConFechaOrdenCronologico(params: {
  idSesion: string;
  nuevaFechaUTC: Date;
  usuario?: string;
}): Promise<{
  ok: boolean;
  undoOps: FirestoreOp[];
  redoOps: FirestoreOp[];
  toastMessage: string;
  logEntry?: MovimientoLogCliente;
}> {
  const { idSesion, nuevaFechaUTC, usuario = 'Entrenador' } = params;

  const sesSnap = await getDoc(doc(db, 'agenda_sesiones', idSesion));
  if (!sesSnap.exists()) {
    return { ok: false, undoOps: [], redoOps: [], toastMessage: 'La sesión no existe.' };
  }

  const sesData = sesSnap.data();
  if (sesData.sin_fecha || !sesData.fecha_hora_inicio) {
    return asignarFechaASesionSinFechaConCascadaAtras({
      idSesionSinFecha: idSesion,
      nuevaFechaUTC,
      usuario
    });
  }

  const idCliente = sesData.id_cliente || sesData.ID_Cliente || '';
  const fechaOrigen: Date = sesData.fecha_hora_inicio.toDate
    ? sesData.fecha_hora_inicio.toDate()
    : new Date(sesData.fecha_hora_inicio);

  const clienteInfo = await resolverDocumentoCliente(idCliente);
  const todasSesiones = await cargarSesionesDeCliente(
    clienteInfo.allClientIds.length > 0 ? clienteInfo.allClientIds : [idCliente]
  );

  const esSGOrig = esSmallGroupTipo(sesData.tipo_sesion);
  const fechaMinima =
    fechaOrigen.getTime() < nuevaFechaUTC.getTime() ? fechaOrigen : nuevaFechaUTC;

  const sesionesAfectadas = todasSesiones
    .filter(s => {
      if (s.sin_fecha || !s.fechaObj) return false;
      if (esSesionCompletada(s) || esSesionCancelada(s)) return false;
      if (esSmallGroupTipo(s.tipo_sesion) !== esSGOrig) return false;
      return s.fechaObj.getTime() >= fechaMinima.getTime() || s.id === idSesion;
    })
    .sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());

  const batch = writeBatch(db);
  const undoOps: FirestoreOp[] = [];
  const redoOps: FirestoreOp[] = [];
  const ahora = new Date();

  if (sesionesAfectadas.length <= 1) {
    const rawOrig = clonarProfundo(sesData);
    const updateData = {
      sin_fecha: false,
      fecha_hora_inicio: nuevaFechaUTC,
      estado: 'Pendiente',
      estado_sesion: 'Pendiente',
      ultimo_editor: usuario,
      fecha_ultima_edicion: ahora,
      ultimo_modificado_por: usuario,
      fecha_modificacion: ahora,
      utc_migrado: true
    };
    batch.update(doc(db, 'agenda_sesiones', idSesion), updateData);
    undoOps.push({
      type: 'set',
      collection: 'agenda_sesiones',
      id: idSesion,
      data: rawOrig,
      merge: false
    });
    redoOps.push({
      type: 'set',
      collection: 'agenda_sesiones',
      id: idSesion,
      data: { ...rawOrig, ...updateData },
      merge: false
    });
  } else {
    // Extraer los payloads en su orden cronológico original
    const payloadsEnOrden = sesionesAfectadas.map(s => extraerPayloadProgramacion(s));

    // Ordenar las sesiones según sus nuevas fechas efectivas
    const sesionesConNuevasFechas = sesionesAfectadas
      .map(s => ({
        sesion: s,
        fechaEfectiva: s.id === idSesion ? nuevaFechaUTC : s.fechaObj
      }))
      .sort((a, b) => a.fechaEfectiva.getTime() - b.fechaEfectiva.getTime());

    sesionesConNuevasFechas.forEach((item, idx) => {
      const p = payloadsEnOrden[idx];
      const updateData: any = {
        sin_fecha: false,
        fecha_hora_inicio: item.fechaEfectiva,
        estado: 'Pendiente',
        estado_sesion: 'Pendiente',
        ejercicios: p.ejercicios,
        intensidad_sesion: p.intensidad_sesion,
        orden_customizado: p.orden_customizado,
        ultimo_editor: usuario,
        fecha_ultima_edicion: ahora,
        ultimo_modificado_por: usuario,
        fecha_modificacion: ahora,
        utc_migrado: true
      };

      batch.update(doc(db, 'agenda_sesiones', item.sesion.id), updateData);
      undoOps.push({
        type: 'set',
        collection: 'agenda_sesiones',
        id: item.sesion.id,
        data: item.sesion.raw,
        merge: false
      });
      redoOps.push({
        type: 'set',
        collection: 'agenda_sesiones',
        id: item.sesion.id,
        data: { ...item.sesion.raw, ...updateData },
        merge: false
      });
    });
  }

  const origenTxt = formatearFechaHoraHumanaUTC(fechaOrigen);
  const destinoTxt = formatearFechaHoraHumanaUTC(nuevaFechaUTC);
  const logEntry: MovimientoLogCliente = {
    id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    id_cliente: clienteInfo.docId || idCliente,
    tipo: 'REPROGRAMACION',
    titulo: 'Sesión reprogramada',
    detalle: `La sesión del ${origenTxt} fue reprogramada al ${destinoTxt}, manteniendo el orden cronológico de la programación.`,
    fecha_registro: ahora.toISOString(),
    usuario
  };

  prepararOperacionLogCliente(batch, undoOps, redoOps, clienteInfo, logEntry);

  await batch.commit();

  return {
    ok: true,
    undoOps,
    redoOps,
    toastMessage: `📅 Sesión reprogramada al ${destinoTxt}`,
    logEntry
  };
}

/**
 * 4. PROCESADOR DE VENCIMIENTOS AUTOMÁTICOS (A partir de las 00:00 del día siguiente)
 * Detecta sesiones de días anteriores a hoy que no fueron marcadas como Completadas
 * y ejecuta automáticamente la cancelación con cascada hacia delante.
 *
 * NOTA: Actualmente PAUSADO / COMENTADO por petición del usuario hasta que la aplicación
 * esté preparada para activarlo en producción.
 */
export async function procesarVencimientosAutomaticos(
  _idClienteOpcional?: string
): Promise<number> {
  // Proceso automático de las 00:00 pausado temporalmente.
  return 0;
}

let revirtiendoVencimientosLock = false;

function toMillis(val: any): number {
  if (!val) return 0;
  if (typeof val.toDate === 'function') {
    const d = val.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0;
  }
  if (val instanceof Date) {
    return !isNaN(val.getTime()) ? val.getTime() : 0;
  }
  if (typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6);
  }
  const d = new Date(val);
  return !isNaN(d.getTime()) ? d.getTime() : 0;
}

function parseFechaFromDetalleLog(detalle?: string): Date | null {
  if (!detalle) return null;
  const m = String(detalle).match(/(\d{2})\/(\d{2})\/(\d{4})\s+a\s+las\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const d = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 5. REVERTIR CANCELACIONES AUTOMÁTICAS POR VENCIMIENTO (Recuperación íntegra en orden LIFO)
 * - Identifica todos los clientes y sesiones afectados por "Sistema Automático".
 * - Deshace paso a paso (en orden inverso exacto LIFO) cada cascada hacia delante que se ejecutó.
 * - Devuelve cada programación a su sesión original, recrea las sesiones eliminadas en sus días
 *   y horas exactos como Pendientes/Vencidas, elimina las sesiones "Sin fecha" generadas por el
 *   proceso automático y limpia los registros automáticos del historial del cliente.
 */
export async function revertirVencimientosAutomaticos(): Promise<{
  clientesRestaurados: number;
  sesionesRestauradas: number;
  sinFechaEliminadas: number;
}> {
  if (revirtiendoVencimientosLock) {
    return { clientesRestaurados: 0, sesionesRestauradas: 0, sinFechaEliminadas: 0 };
  }
  revirtiendoVencimientosLock = true;

  try {
    const [clientesSnap, sfAutoSnap, modAutoSnap] = await Promise.all([
      getDocs(collection(db, 'clientes')),
      getDocs(query(collection(db, 'agenda_sesiones'), where('creado_por', '==', 'Sistema Automático'))),
      getDocs(query(collection(db, 'agenda_sesiones'), where('ultimo_editor', '==', 'Sistema Automático')))
    ]);

    interface ClienteBucket {
      docId: string | null;
      data: any | null;
      allClientIds: Set<string>;
      nombreCli: string;
    }

    const bucketsByKey = new Map<string, ClienteBucket>();
    const idToKey = new Map<string, string>();
    const affectedKeys = new Set<string>();

    clientesSnap.forEach(d => {
      const data = d.data();
      const key = d.id;
      const ids = new Set<string>([d.id]);
      idToKey.set(d.id, key);
      if (data.ID_Cliente && String(data.ID_Cliente).trim()) {
        const altId = String(data.ID_Cliente).trim();
        ids.add(altId);
        idToKey.set(altId, key);
      }
      const nombreCli =
        data.Alias || data.alias || data.Nombre_Cliente || data.Nombre || data.nombre_completo || 'Cliente';
      bucketsByKey.set(key, {
        docId: d.id,
        data,
        allClientIds: ids,
        nombreCli
      });

      const hist: any[] = Array.isArray(data.historial_movimientos) ? data.historial_movimientos : [];
      if (hist.some(h => h && (h.tipo === 'VENCIMIENTO' || h.usuario === 'Sistema Automático'))) {
        affectedKeys.add(key);
      }
    });

    const registerSessionClient = (sesDoc: any) => {
      const sData = sesDoc.data();
      const rawCid = String(sData.id_cliente || sData.ID_Cliente || '').trim();
      if (!rawCid) return;
      let key = idToKey.get(rawCid);
      if (!key) {
        key = rawCid;
        idToKey.set(rawCid, key);
        bucketsByKey.set(key, {
          docId: null,
          data: null,
          allClientIds: new Set([rawCid]),
          nombreCli:
            sData.alias || sData.nombre_cliente || sData.cliente_nombre || 'Cliente'
        });
      }
      affectedKeys.add(key);
    };

    sfAutoSnap.forEach(registerSessionClient);
    modAutoSnap.forEach(registerSessionClient);

    if (affectedKeys.size === 0) {
      return { clientesRestaurados: 0, sesionesRestauradas: 0, sinFechaEliminadas: 0 };
    }

    let clientesRestaurados = 0;
    let sesionesRestauradas = 0;
    let sinFechaEliminadas = 0;
    const ahoraRestauracion = new Date();
    const fechaCorteEjecucion = new Date(Date.UTC(2026, 10, 6, 0, 0, 0, 0)); // 06/11/2026 00:00 UTC

    for (const key of affectedKeys) {
      const bucket = bucketsByKey.get(key);
      if (!bucket) continue;

      const allClientIds = Array.from(bucket.allClientIds);
      const todasSesiones = await cargarSesionesDeCliente(allClientIds);

      const sfAutoDocs = todasSesiones.filter(
        s =>
          s.sin_fecha === true &&
          (s.creado_por === 'Sistema Automático' || s.ultimo_editor === 'Sistema Automático')
      );

      const rawHist: any[] = Array.isArray(bucket.data?.historial_movimientos)
        ? bucket.data.historial_movimientos
        : [];

      const vencLogs = rawHist
        .map((log, idx) => ({ log, idx }))
        .filter(({ log }) => log && (log.tipo === 'VENCIMIENTO' || log.usuario === 'Sistema Automático'));

      interface AutoStep {
        fechaOriginal: Date;
        execTimeMs: number;
        logIdx: number;
        sfDoc: any | null;
        pasoASinFecha: boolean;
      }

      const autoSteps: AutoStep[] = [];
      const usedSfIds = new Set<string>();

      for (const { log, idx } of vencLogs) {
        const fechaFromLog = parseFechaFromDetalleLog(log.detalle);
        const execMsFromLog = toMillis(log.fecha_registro);
        const pasoASinFecha = String(log.detalle || '').includes('Sesiones sin fecha');

        let matchedSf: any | null = null;

        if (fechaFromLog) {
          matchedSf =
            sfAutoDocs.find(
              sf =>
                !usedSfIds.has(sf.id) &&
                toMillis(sf.fecha_hora_anterior) > 0 &&
                Math.abs(toMillis(sf.fecha_hora_anterior) - fechaFromLog.getTime()) <= 60 * 1000
            ) || null;
        }

        if (!matchedSf && pasoASinFecha && execMsFromLog > 0) {
          matchedSf =
            sfAutoDocs.find(
              sf =>
                !usedSfIds.has(sf.id) &&
                Math.abs(
                  toMillis(sf.fecha_creacion || sf.fecha_creacion_sin_fecha) - execMsFromLog
                ) <= 15 * 1000
            ) || null;
        }

        if (matchedSf) {
          usedSfIds.add(matchedSf.id);
          const antMs = toMillis(matchedSf.fecha_hora_anterior);
          const fechaOrig = antMs > 0 ? new Date(antMs) : fechaFromLog;
          const execMs =
            toMillis(matchedSf.fecha_creacion || matchedSf.fecha_creacion_sin_fecha) || execMsFromLog;
          if (fechaOrig) {
            autoSteps.push({
              fechaOriginal: fechaOrig,
              execTimeMs: execMs,
              logIdx: idx,
              sfDoc: matchedSf,
              pasoASinFecha: true
            });
          }
        } else if (fechaFromLog) {
          autoSteps.push({
            fechaOriginal: fechaFromLog,
            execTimeMs: execMsFromLog,
            logIdx: idx,
            sfDoc: null,
            pasoASinFecha: false
          });
        }
      }

      for (const sf of sfAutoDocs) {
        if (usedSfIds.has(sf.id)) continue;
        const antMs = toMillis(sf.fecha_hora_anterior);
        if (antMs > 0) {
          usedSfIds.add(sf.id);
          autoSteps.push({
            fechaOriginal: new Date(antMs),
            execTimeMs: toMillis(sf.fecha_creacion || sf.fecha_creacion_sin_fecha),
            logIdx: 9999,
            sfDoc: sf,
            pasoASinFecha: true
          });
        }
      }

      if (autoSteps.length === 0 && vencLogs.length === 0 && sfAutoDocs.length === 0) {
        continue;
      }

      // Orden LIFO exacto: desde la última cancelación automática ejecutada hasta la primera
      autoSteps.sort((a, b) => {
        if (a.logIdx !== b.logIdx && a.logIdx < 9999 && b.logIdx < 9999) {
          return a.logIdx - b.logIdx;
        }
        if (b.fechaOriginal.getTime() !== a.fechaOriginal.getTime()) {
          return b.fechaOriginal.getTime() - a.fechaOriginal.getTime();
        }
        return b.execTimeMs - a.execTimeMs;
      });

      interface NodoMemoria {
        id: string;
        fechaObj: Date;
        payload: {
          ejercicios: any[];
          intensidad_sesion: string;
          orden_customizado: boolean;
          ultimo_editor: string;
          fecha_ultima_edicion: any;
        };
        wasModifiedBySistemaAutomatico: boolean;
        initialModifiedByAutoMs: number;
        restoredFromStepWithSinFecha: boolean;
        isNewRestored: boolean;
        dirty: boolean;
        tipo_sesion: string;
        raw: any;
      }

      const nodosActivos: NodoMemoria[] = todasSesiones
        .filter(s => {
          if (s.sin_fecha || !s.fechaObj) return false;
          if (esSmallGroupTipo(s.tipo_sesion) || esSesionCancelada(s)) return false;
          const modByAuto =
            s.ultimo_editor === 'Sistema Automático' ||
            s.ultimo_modificado_por === 'Sistema Automático';
          const posibleAutoCompletadaEnVista =
            s.fechaObj.getTime() >= fechaCorteEjecucion.getTime() && !tieneEjercicios(s);
          return !esSesionCompletada(s) || modByAuto || posibleAutoCompletadaEnVista;
        })
        .map(s => {
          const modByAuto =
            s.ultimo_editor === 'Sistema Automático' ||
            s.ultimo_modificado_por === 'Sistema Automático';
          return {
            id: s.id,
            fechaObj: s.fechaObj as Date,
            payload: extraerPayloadProgramacion(s),
            wasModifiedBySistemaAutomatico: modByAuto,
            initialModifiedByAutoMs: toMillis(s.fecha_ultima_edicion || s.fecha_modificacion),
            restoredFromStepWithSinFecha: false,
            isNewRestored: false,
            dirty: modByAuto,
            tipo_sesion: s.tipo_sesion || 'Individual',
            raw: s.raw
          };
        });

      const sfIdsToDelete = new Set<string>();

      // Ejecutar la inversión de cada paso en orden LIFO
      for (const step of autoSteps) {
        const T_k = step.fechaOriginal;
        nodosActivos.sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());

        const yaExiste = nodosActivos.find(
          n => Math.abs(n.fechaObj.getTime() - T_k.getTime()) < 60 * 1000
        );

        if (step.sfDoc) {
          const payloadSf = extraerPayloadProgramacion(step.sfDoc);
          const futuras = nodosActivos.filter(
            n => n.fechaObj.getTime() > T_k.getTime() + 60 * 1000
          );

          let lastFuturasIdx = -1;
          for (let i = futuras.length - 1; i >= 0; i--) {
            const fNode = futuras[i];
            const modEnEstePasoOPosterior =
              fNode.wasModifiedBySistemaAutomatico &&
              (step.execTimeMs === 0 || fNode.initialModifiedByAutoMs >= step.execTimeMs - 5000);
            if (
              modEnEstePasoOPosterior ||
              tieneEjercicios(fNode.payload) ||
              fNode.restoredFromStepWithSinFecha
            ) {
              lastFuturasIdx = i;
              break;
            }
          }

          let payloadRestaurado = crearPayloadVacio();
          if (lastFuturasIdx >= 0) {
            payloadRestaurado = clonarProfundo(futuras[0].payload);
            for (let j = 0; j < lastFuturasIdx; j++) {
              futuras[j].payload = clonarProfundo(futuras[j + 1].payload);
              futuras[j].dirty = true;
            }
            futuras[lastFuturasIdx].payload = clonarProfundo(payloadSf);
            futuras[lastFuturasIdx].dirty = true;
          } else {
            payloadRestaurado = clonarProfundo(payloadSf);
          }

          if (yaExiste) {
            yaExiste.payload = payloadRestaurado;
            yaExiste.restoredFromStepWithSinFecha = true;
            yaExiste.dirty = true;
          } else {
            nodosActivos.push({
              id: `SES-REC-${T_k.getTime()}-${Math.floor(Math.random() * 10000)}`,
              fechaObj: T_k,
              payload: payloadRestaurado,
              wasModifiedBySistemaAutomatico: true,
              initialModifiedByAutoMs: step.execTimeMs,
              restoredFromStepWithSinFecha: true,
              isNewRestored: true,
              dirty: true,
              tipo_sesion: step.sfDoc.tipo_sesion || 'Individual',
              raw: null
            });
          }

          sfIdsToDelete.add(step.sfDoc.id);
        } else {
          if (!yaExiste) {
            nodosActivos.push({
              id: `SES-REC-${T_k.getTime()}-${Math.floor(Math.random() * 10000)}`,
              fechaObj: T_k,
              payload: crearPayloadVacio(),
              wasModifiedBySistemaAutomatico: true,
              initialModifiedByAutoMs: step.execTimeMs,
              restoredFromStepWithSinFecha: false,
              isNewRestored: true,
              dirty: true,
              tipo_sesion: 'Individual',
              raw: null
            });
          }
        }
      }

      // También eliminar cualquier sesión sin_fecha huérfana creada por Sistema Automático
      for (const sf of sfAutoDocs) {
        sfIdsToDelete.add(sf.id);
      }

      const batch = writeBatch(db);
      let opsEnBatch = 0;
      const clienteIdEfectivo = bucket.docId || allClientIds[0] || key;

      for (const nodo of nodosActivos) {
        if (nodo.fechaObj.getTime() < Date.UTC(2026, 8, 1, 0, 0, 0, 0)) {
          continue;
        }
        if (nodo.isNewRestored) {
          const restoredDocData = {
            id_sesion_global: nodo.id,
            id_cliente: clienteIdEfectivo,
            alias: bucket.nombreCli,
            nombre_cliente: bucket.nombreCli,
            cliente_nombre: bucket.nombreCli,
            tipo_sesion: nodo.tipo_sesion || 'Individual',
            sin_fecha: false,
            fecha_hora_inicio: nodo.fechaObj,
            estado: 'Pendiente',
            estado_sesion: 'Pendiente',
            ejercicios: nodo.payload.ejercicios || [],
            intensidad_sesion: nodo.payload.intensidad_sesion || 'MED',
            orden_customizado: Boolean(nodo.payload.orden_customizado),
            ultimo_editor: 'Entrenador',
            fecha_ultima_edicion: ahoraRestauracion,
            ultimo_modificado_por: 'Entrenador',
            fecha_modificacion: ahoraRestauracion,
            creado_por: 'Entrenador',
            fecha_creacion: ahoraRestauracion,
            utc_migrado: true
          };
          batch.set(doc(db, 'agenda_sesiones', nodo.id), restoredDocData);
          sesionesRestauradas++;
          opsEnBatch++;
        } else if (nodo.dirty) {
          batch.update(doc(db, 'agenda_sesiones', nodo.id), {
            estado: 'Pendiente',
            estado_sesion: 'Pendiente',
            ejercicios: nodo.payload.ejercicios || [],
            intensidad_sesion: nodo.payload.intensidad_sesion || 'MED',
            orden_customizado: Boolean(nodo.payload.orden_customizado),
            ultimo_editor: 'Entrenador',
            fecha_ultima_edicion: ahoraRestauracion,
            ultimo_modificado_por: 'Entrenador',
            fecha_modificacion: ahoraRestauracion
          });
          opsEnBatch++;
        }
      }

      for (const sfId of sfIdsToDelete) {
        batch.delete(doc(db, 'agenda_sesiones', sfId));
        sinFechaEliminadas++;
        opsEnBatch++;
      }

      if (bucket.docId && vencLogs.length > 0) {
        const cleanedHist = rawHist.filter(
          h => !h || (h.tipo !== 'VENCIMIENTO' && h.usuario !== 'Sistema Automático')
        );
        batch.update(doc(db, 'clientes', bucket.docId), {
          historial_movimientos: cleanedHist
        });
        opsEnBatch++;
      }

      if (opsEnBatch > 0) {
        await batch.commit();
        clientesRestaurados++;
      }
    }

    return {
      clientesRestaurados,
      sesionesRestauradas,
      sinFechaEliminadas
    };
  } catch (e) {
    console.error('Error revirtiendo vencimientos automáticos:', e);
    return { clientesRestaurados: 0, sesionesRestauradas: 0, sinFechaEliminadas: 0 };
  } finally {
    revirtiendoVencimientosLock = false;
  }
}

let procesandoCaducidadSinFechaLock = false;

export function obtenerFechaOrigenSesionSinFecha(data: any): Date | null {
  if (!data) return null;
  const msAnt = toMillis(data.fecha_hora_anterior);
  if (msAnt > 0) return new Date(msAnt);
  const msCreaSf = toMillis(data.fecha_creacion_sin_fecha);
  if (msCreaSf > 0) return new Date(msCreaSf);
  const msCrea = toMillis(data.fecha_creacion);
  if (msCrea > 0) return new Date(msCrea);
  return null;
}

/**
 * 6. PROCESAR CADUCIDAD MENSUAL DE SESIONES "SIN FECHA" POR POLÍTICA DEL GYM
 * - Lee de Maestros > Agenda el parámetro "Meses de margen para reprogramar" (por defecto 1).
 * - Si una sesión en la bolsa "Sin fecha" tiene una fecha de origen anterior al 1º día del
 *   mes permitido (ej. septiembre o anterior estando en noviembre con margen 1):
 *   1) Mantiene intactas las rutinas de las sesiones futuras.
 *   2) Quita la sesión de "Sin fecha" y la devuelve a su fecha original como Vencida bloqueada.
 *   3) Registra el movimiento en el historial del cliente.
 */
export async function procesarCaducidadSesionesSinFechaPorMeses(
  idClienteOpcional?: string
): Promise<number> {
  if (procesandoCaducidadSinFechaLock) return 0;
  procesandoCaducidadSinFechaLock = true;

  try {
    const mesesMargen = await getMesesMargenReprogramacion();
    const fechaLimiteUTC = obtenerFechaLimiteReprogramacionUTC(mesesMargen);

    let docsSinFecha: { id: string; data: any; fechaOrigen: Date }[] = [];

    if (idClienteOpcional) {
      const cliInfo = await resolverDocumentoCliente(idClienteOpcional);
      const ids = cliInfo.allClientIds.length > 0 ? cliInfo.allClientIds : [idClienteOpcional];
      const seenIds = new Set<string>();
      for (const cid of ids) {
        const snap = await getDocs(
          query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', cid))
        );
        snap.forEach(d => {
          if (seenIds.has(d.id)) return;
          seenIds.add(d.id);
          const data = d.data();
          const esSf = Boolean(data.sin_fecha === true || !data.fecha_hora_inicio);
          if (!esSf) return;
          const fOrigen = obtenerFechaOrigenSesionSinFecha(data);
          if (fOrigen && fOrigen.getTime() < fechaLimiteUTC.getTime()) {
            docsSinFecha.push({ id: d.id, data, fechaOrigen: fOrigen });
          }
        });
      }
    } else {
      const snap = await getDocs(
        query(collection(db, 'agenda_sesiones'), where('sin_fecha', '==', true))
      );
      snap.forEach(d => {
        const data = d.data();
        const fOrigen = obtenerFechaOrigenSesionSinFecha(data);
        if (fOrigen && fOrigen.getTime() < fechaLimiteUTC.getTime()) {
          docsSinFecha.push({ id: d.id, data, fechaOrigen: fOrigen });
        }
      });
    }

    if (docsSinFecha.length === 0) return 0;

    // Agrupar por cliente para actualizar sesiones e historial en bloque
    const porCliente = new Map<string, { id: string; data: any; fechaOrigen: Date }[]>();
    for (const item of docsSinFecha) {
      const rawCid = String(item.data.id_cliente || item.data.ID_Cliente || '').trim();
      const key = rawCid || item.id;
      if (!porCliente.has(key)) porCliente.set(key, []);
      porCliente.get(key)!.push(item);
    }

    const ahora = new Date();
    let totalCaducadas = 0;

    for (const [rawCid, items] of porCliente.entries()) {
      const clienteInfo = await resolverDocumentoCliente(rawCid);
      const batch = writeBatch(db);
      const nuevosLogs: MovimientoLogCliente[] = [];

      // Ordenar de más antigua a más reciente
      items.sort((a, b) => a.fechaOrigen.getTime() - b.fechaOrigen.getTime());

      for (const item of items) {
        batch.update(doc(db, 'agenda_sesiones', item.id), {
          sin_fecha: false,
          fecha_hora_inicio: item.fechaOrigen,
          estado: 'Vencida',
          estado_sesion: 'Vencida',
          caducada_por_plazo: true,
          fecha_caducidad_plazo: ahora
        });

        const fechaTxt = formatearFechaHoraHumanaUTC(item.fechaOrigen);
        const plazoTxt =
          mesesMargen === 0
            ? 'mes en curso'
            : mesesMargen === 1
            ? 'mes actual + 1 mes anterior'
            : `mes actual + ${mesesMargen} meses anteriores`;

        nuevosLogs.unshift({
          id: `LOG-CAD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          id_cliente: clienteInfo.docId || rawCid,
          tipo: 'CADUCIDAD_SIN_FECHA',
          titulo: 'Sesión sin fecha caducada por plazo',
          detalle: `La sesión sin fecha con origen el ${fechaTxt} superó el límite de reprogramación (${plazoTxt}) y volvió a su fecha original como Vencida no reprogramable.`,
          fecha_registro: ahora.toISOString(),
          usuario: 'Política Gym'
        });

        totalCaducadas++;
      }

      if (clienteInfo.docId && clienteInfo.data && nuevosLogs.length > 0) {
        const prevHist: MovimientoLogCliente[] = Array.isArray(
          clienteInfo.data.historial_movimientos
        )
          ? clonarProfundo(clienteInfo.data.historial_movimientos)
          : [];
        const nextHist = [...nuevosLogs, ...prevHist].slice(0, 200);
        batch.update(doc(db, 'clientes', clienteInfo.docId), {
          historial_movimientos: nextHist
        });
      }

      await batch.commit();
    }

    return totalCaducadas;
  } catch (e) {
    console.error('Error procesando caducidad mensual de sesiones sin fecha:', e);
    return 0;
  } finally {
    procesandoCaducidadSinFechaLock = false;
  }
}

let limpiandoIntegridadLock = false;
let limpiezaEjecutadaEnSesion = false;

/**
 * 7. LIMPIEZA DE SESIONES PREVIAS A SEPTIEMBRE 2026 Y EJERCICIOS SIN INTEGRIDAD REFERENCIAL
 * - Elimina todas las sesiones en `agenda_sesiones` cuya fecha (o fecha de origen) sea anterior al 01/09/2026 UTC.
 * - Elimina de `agenda_sesiones`, `plantillas_sesiones` y `progreso_clientes` cualquier ejercicio
 *   huérfano que no tenga integridad referencial con un ejercicio real del catálogo `ejercicios`
 *   (por ejemplo, ejercicios borrados anteriormente o que se muestran como "Ejercicio" genérico).
 */
export async function limpiarSesionesAntiguasYEjerciciosHuerfanos(force = false): Promise<{
  sesionesAntiguasBorradas: number;
  sesionesLimpiadas: number;
  plantillasLimpiadas: number;
}> {
  if (limpiandoIntegridadLock || (limpiezaEjecutadaEnSesion && !force)) {
    return { sesionesAntiguasBorradas: 0, sesionesLimpiadas: 0, plantillasLimpiadas: 0 };
  }
  limpiandoIntegridadLock = true;

  try {
    const fechaCorteSept2026Ms = Date.UTC(2026, 8, 1, 0, 0, 0, 0); // 1 Septiembre 2026 00:00 UTC

    const [catSnap, sesSnap, plantSnap, prSnap] = await Promise.all([
      getDocs(collection(db, 'ejercicios')),
      getDocs(collection(db, 'agenda_sesiones')),
      getDocs(collection(db, 'plantillas_sesiones')),
      getDocs(collection(db, 'progreso_clientes'))
    ]);

    interface CatEntry {
      id: string;
      nombre: string;
      acronimo: string;
    }

    const byId = new Map<string, CatEntry>();
    const byName = new Map<string, CatEntry>();
    const byAcronimo = new Map<string, CatEntry>();
    const idsCatalogoCorruptos: string[] = [];

    catSnap.forEach(d => {
      const data = d.data();
      const rawNom = String(
        data.Nombre_Ejercicio || data.nombre_ejercicio || data.nombre || ''
      ).trim();
      const rawAcr = String(data['Acrónimo'] || data.Acronimo || data.acronimo || '').trim();

      const nomInvalido =
        !rawNom ||
        rawNom.toLowerCase() === 'sin nombre' ||
        rawNom.toLowerCase() === 'ejercicio';
      const acrInvalido =
        !rawAcr ||
        rawAcr === '-' ||
        rawAcr.toLowerCase() === 'ejercicio' ||
        rawAcr.toLowerCase() === 'ej';

      if (nomInvalido && acrInvalido) {
        idsCatalogoCorruptos.push(d.id);
        return;
      }

      const entry: CatEntry = {
        id: d.id,
        nombre: rawNom || rawAcr,
        acronimo: rawAcr && rawAcr !== '-' ? rawAcr : rawNom
      };

      byId.set(d.id, entry);
      const altId = String(
        data.Id_Ejercicio || data.ID_Ejercicio || data.id_ejercicio || ''
      ).trim();
      if (altId) byId.set(altId, entry);

      if (!nomInvalido) {
        byName.set(rawNom.toLowerCase(), entry);
      }
      if (!acrInvalido) {
        byAcronimo.set(rawAcr.toLowerCase(), entry);
      }
    });

    const resolverEjercicioReal = (ej: any): CatEntry | null => {
      if (!ej || typeof ej !== 'object') return null;
      const idEj = String(
        ej.id_ejercicio || ej.ID_Ejercicio || ej.Id_Ejercicio || ''
      ).trim();
      const nomEj = String(
        ej.Nombre_Ejercicio || ej.nombre_ejercicio || ej.nombre || ''
      ).trim();
      const acrEj = String(
        ej.Acrónimo || ej.Acronimo || ej.acronimo || ej.alias || ''
      ).trim();

      // Si el texto visible es literalmente "Ejercicio" y no tiene ID válido en catálogo, es huérfano
      if (idEj) {
        const foundById = byId.get(idEj);
        if (foundById) return foundById;
        // Si tenía un ID que ya no existe en el catálogo, fue eliminado -> no tiene integridad referencial
        return null;
      }

      if (nomEj && nomEj.toLowerCase() !== 'ejercicio' && nomEj.toLowerCase() !== 'sin nombre') {
        const foundByName = byName.get(nomEj.toLowerCase());
        if (foundByName) return foundByName;
      }

      if (
        acrEj &&
        acrEj !== '-' &&
        acrEj.toLowerCase() !== 'ejercicio' &&
        acrEj.toLowerCase() !== 'ej'
      ) {
        const foundByAcr = byAcronimo.get(acrEj.toLowerCase());
        if (foundByAcr) return foundByAcr;
      }

      return null;
    };

    type BatchAction =
      | { type: 'delete'; col: string; id: string }
      | { type: 'update'; col: string; id: string; data: any };

    const actions: BatchAction[] = [];
    let sesionesAntiguasBorradas = 0;
    let sesionesLimpiadas = 0;
    let plantillasLimpiadas = 0;

    for (const badId of idsCatalogoCorruptos) {
      actions.push({ type: 'delete', col: 'ejercicios', id: badId });
    }

    sesSnap.forEach(d => {
      const data = d.data();
      const esSinFecha = Boolean(data.sin_fecha === true || !data.fecha_hora_inicio);

      let msRef = 0;
      if (!esSinFecha) {
        msRef = toMillis(data.fecha_hora_inicio);
      } else {
        const fOrig = obtenerFechaOrigenSesionSinFecha(data);
        msRef = fOrig ? fOrig.getTime() : 0;
      }

      if (msRef > 0 && msRef < fechaCorteSept2026Ms) {
        actions.push({ type: 'delete', col: 'agenda_sesiones', id: d.id });
        sesionesAntiguasBorradas++;
        return;
      }

      if (Array.isArray(data.ejercicios) && data.ejercicios.length > 0) {
        let changed = false;
        const nuevosEjercicios: any[] = [];

        for (const ej of data.ejercicios) {
          const catMatch = resolverEjercicioReal(ej);
          if (!catMatch) {
            changed = true;
            continue;
          }
          const needSync =
            ej.id_ejercicio !== catMatch.id ||
            !ej.Nombre_Ejercicio ||
            ej.Nombre_Ejercicio === 'Ejercicio' ||
            !ej.Acrónimo ||
            ej.Acrónimo === 'Ejercicio';

          if (needSync) {
            changed = true;
            nuevosEjercicios.push({
              ...ej,
              id_ejercicio: catMatch.id,
              Nombre_Ejercicio: catMatch.nombre,
              Acrónimo: catMatch.acronimo || catMatch.nombre
            });
          } else {
            nuevosEjercicios.push(ej);
          }
        }

        if (changed) {
          actions.push({
            type: 'update',
            col: 'agenda_sesiones',
            id: d.id,
            data: { ejercicios: nuevosEjercicios }
          });
          sesionesLimpiadas++;
        }
      }
    });

    plantSnap.forEach(d => {
      const data = d.data();
      if (Array.isArray(data.ejercicios) && data.ejercicios.length > 0) {
        let changed = false;
        const nuevosEjercicios: any[] = [];

        for (const ej of data.ejercicios) {
          const catMatch = resolverEjercicioReal(ej);
          if (!catMatch) {
            changed = true;
            continue;
          }
          if (ej.id_ejercicio !== catMatch.id || !ej.Nombre_Ejercicio) {
            changed = true;
            nuevosEjercicios.push({
              ...ej,
              id_ejercicio: catMatch.id,
              Nombre_Ejercicio: catMatch.nombre,
              Acrónimo: catMatch.acronimo || catMatch.nombre
            });
          } else {
            nuevosEjercicios.push(ej);
          }
        }

        if (changed) {
          actions.push({
            type: 'update',
            col: 'plantillas_sesiones',
            id: d.id,
            data: { ejercicios: nuevosEjercicios }
          });
          plantillasLimpiadas++;
        }
      }
    });

    prSnap.forEach(d => {
      const data = d.data();
      const idEj = String(data.id_ejercicio || '').trim();
      const nomEj = String(data.nombre_ejercicio || '').trim();
      const existsById = idEj ? byId.has(idEj) : false;
      const existsByName = nomEj ? byName.has(nomEj.toLowerCase()) : false;
      if (!existsById && !existsByName) {
        actions.push({ type: 'delete', col: 'progreso_clientes', id: d.id });
      }
    });

    // Ejecutar en lotes de 400 operaciones
    const CHUNK_SIZE = 400;
    for (let i = 0; i < actions.length; i += CHUNK_SIZE) {
      const chunk = actions.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const act of chunk) {
        if (act.type === 'delete') {
          batch.delete(doc(db, act.col, act.id));
        } else {
          batch.update(doc(db, act.col, act.id), act.data);
        }
      }
      await batch.commit();
    }

    limpiezaEjecutadaEnSesion = true;
    return { sesionesAntiguasBorradas, sesionesLimpiadas, plantillasLimpiadas };
  } catch (e) {
    console.error('Error en limpiarSesionesAntiguasYEjerciciosHuerfanos:', e);
    return { sesionesAntiguasBorradas: 0, sesionesLimpiadas: 0, plantillasLimpiadas: 0 };
  } finally {
    limpiandoIntegridadLock = false;
  }
}

function coincideEjercicioConObjetivo(
  ej: any,
  targetIds: Set<string>,
  targetNombreLower: string
): boolean {
  if (!ej || typeof ej !== 'object') return false;
  const idEj = String(ej.id_ejercicio || ej.ID_Ejercicio || ej.Id_Ejercicio || '').trim();
  if (idEj && targetIds.has(idEj)) return true;
  if (!idEj && targetNombreLower) {
    const nom = String(ej.Nombre_Ejercicio || ej.nombre_ejercicio || ej.nombre || '')
      .trim()
      .toLowerCase();
    if (nom && nom === targetNombreLower) return true;
  }
  return false;
}

export async function contarReferenciasEjercicio(
  idEjercicio: string,
  nombreEjercicio?: string,
  altIdEjercicio?: string
): Promise<{
  sesionesCount: number;
  plantillasCount: number;
  progresoCount: number;
}> {
  const targetIds = new Set<string>([idEjercicio]);
  if (altIdEjercicio) targetIds.add(altIdEjercicio);
  const targetNombreLower = (nombreEjercicio || '').trim().toLowerCase();

  const [sesSnap, plantSnap, prSnap] = await Promise.all([
    getDocs(collection(db, 'agenda_sesiones')),
    getDocs(collection(db, 'plantillas_sesiones')),
    getDocs(collection(db, 'progreso_clientes'))
  ]);

  let sesionesCount = 0;
  sesSnap.forEach(d => {
    const data = d.data();
    if (
      Array.isArray(data.ejercicios) &&
      data.ejercicios.some((ej: any) =>
        coincideEjercicioConObjetivo(ej, targetIds, targetNombreLower)
      )
    ) {
      sesionesCount++;
    }
  });

  let plantillasCount = 0;
  plantSnap.forEach(d => {
    const data = d.data();
    if (
      Array.isArray(data.ejercicios) &&
      data.ejercicios.some((ej: any) =>
        coincideEjercicioConObjetivo(ej, targetIds, targetNombreLower)
      )
    ) {
      plantillasCount++;
    }
  });

  let progresoCount = 0;
  prSnap.forEach(d => {
    const data = d.data();
    const idEj = String(data.id_ejercicio || '').trim();
    const nomEj = String(data.nombre_ejercicio || '').trim().toLowerCase();
    if ((idEj && targetIds.has(idEj)) || (!idEj && targetNombreLower && nomEj === targetNombreLower)) {
      progresoCount++;
    }
  });

  return { sesionesCount, plantillasCount, progresoCount };
}

export async function eliminarEjercicioConCascada(params: {
  idEjercicio: string;
  nombreEjercicio?: string;
  rawEjercicio?: any;
}): Promise<{
  undoOps: FirestoreOp[];
  redoOps: FirestoreOp[];
  sesionesAfectadas: number;
  plantillasAfectadas: number;
  prsEliminados: number;
}> {
  const { idEjercicio, nombreEjercicio, rawEjercicio } = params;
  const targetIds = new Set<string>([idEjercicio]);
  if (rawEjercicio) {
    const alt = String(
      rawEjercicio.Id_Ejercicio || rawEjercicio.ID_Ejercicio || rawEjercicio.id_ejercicio || ''
    ).trim();
    if (alt) targetIds.add(alt);
  }
  const targetNombreLower = (
    nombreEjercicio ||
    rawEjercicio?.Nombre_Ejercicio ||
    rawEjercicio?.nombre_ejercicio ||
    ''
  )
    .trim()
    .toLowerCase();

  const [sesSnap, plantSnap, prSnap] = await Promise.all([
    getDocs(collection(db, 'agenda_sesiones')),
    getDocs(collection(db, 'plantillas_sesiones')),
    getDocs(collection(db, 'progreso_clientes'))
  ]);

  const undoOps: FirestoreOp[] = [];
  const redoOps: FirestoreOp[] = [];

  if (rawEjercicio) {
    undoOps.push({
      type: 'set',
      collection: 'ejercicios',
      id: idEjercicio,
      data: clonarProfundo(rawEjercicio)
    });
  }
  redoOps.push({
    type: 'delete',
    collection: 'ejercicios',
    id: idEjercicio
  });

  type BatchOp =
    | { type: 'delete'; col: string; id: string }
    | { type: 'update'; col: string; id: string; data: any };

  const batchOps: BatchOp[] = [{ type: 'delete', col: 'ejercicios', id: idEjercicio }];

  let sesionesAfectadas = 0;
  sesSnap.forEach(d => {
    const data = d.data();
    if (!Array.isArray(data.ejercicios) || data.ejercicios.length === 0) return;
    const prevEjercicios = clonarProfundo(data.ejercicios);
    const nextEjercicios = prevEjercicios.filter(
      (ej: any) => !coincideEjercicioConObjetivo(ej, targetIds, targetNombreLower)
    );
    if (nextEjercicios.length !== prevEjercicios.length) {
      sesionesAfectadas++;
      batchOps.push({
        type: 'update',
        col: 'agenda_sesiones',
        id: d.id,
        data: { ejercicios: nextEjercicios }
      });
      undoOps.push({
        type: 'update',
        collection: 'agenda_sesiones',
        id: d.id,
        data: { ejercicios: prevEjercicios }
      });
      redoOps.push({
        type: 'update',
        collection: 'agenda_sesiones',
        id: d.id,
        data: { ejercicios: nextEjercicios }
      });
    }
  });

  let plantillasAfectadas = 0;
  plantSnap.forEach(d => {
    const data = d.data();
    if (!Array.isArray(data.ejercicios) || data.ejercicios.length === 0) return;
    const prevEjercicios = clonarProfundo(data.ejercicios);
    const nextEjercicios = prevEjercicios.filter(
      (ej: any) => !coincideEjercicioConObjetivo(ej, targetIds, targetNombreLower)
    );
    if (nextEjercicios.length !== prevEjercicios.length) {
      plantillasAfectadas++;
      batchOps.push({
        type: 'update',
        col: 'plantillas_sesiones',
        id: d.id,
        data: { ejercicios: nextEjercicios }
      });
      undoOps.push({
        type: 'update',
        collection: 'plantillas_sesiones',
        id: d.id,
        data: { ejercicios: prevEjercicios }
      });
      redoOps.push({
        type: 'update',
        collection: 'plantillas_sesiones',
        id: d.id,
        data: { ejercicios: nextEjercicios }
      });
    }
  });

  let prsEliminados = 0;
  prSnap.forEach(d => {
    const data = d.data();
    const idEj = String(data.id_ejercicio || '').trim();
    const nomEj = String(data.nombre_ejercicio || '').trim().toLowerCase();
    if ((idEj && targetIds.has(idEj)) || (!idEj && targetNombreLower && nomEj === targetNombreLower)) {
      prsEliminados++;
      const prevPr = clonarProfundo(data);
      batchOps.push({ type: 'delete', col: 'progreso_clientes', id: d.id });
      undoOps.push({
        type: 'set',
        collection: 'progreso_clientes',
        id: d.id,
        data: prevPr
      });
      redoOps.push({
        type: 'delete',
        collection: 'progreso_clientes',
        id: d.id
      });
    }
  });

  const CHUNK_SIZE = 400;
  for (let i = 0; i < batchOps.length; i += CHUNK_SIZE) {
    const chunk = batchOps.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.type === 'delete') {
        batch.delete(doc(db, op.col, op.id));
      } else {
        batch.update(doc(db, op.col, op.id), op.data);
      }
    }
    await batch.commit();
  }

  return {
    undoOps,
    redoOps,
    sesionesAfectadas,
    plantillasAfectadas,
    prsEliminados
  };
}



