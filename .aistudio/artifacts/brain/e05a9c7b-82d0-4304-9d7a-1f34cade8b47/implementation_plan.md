# Persistencia al Refrescar, Reparación de Deshacer en Cascada y Gestión de Colisión en el Mismo Día

Este plan resuelve tres puntos clave de experiencia de usuario e integridad de datos en **GymPlanner**: mantener exactamente la vista y contexto de trabajo al recargar el navegador, reparar el sistema de **Deshacer (`Ctrl+Z`)** en operaciones de cascada y reprogramación para que restaure las fechas reales de las sesiones, e impedir sesiones duplicadas en un mismo día permitiendo machacar la sesión existente con opción de reemplazar ejercicios o desplazar en cascada hacia delante.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Se han incorporado tus respuestas de configuración para el comportamiento al coincidir dos sesiones de un mismo cliente en el mismo día:

- **Detección y aviso en el mismo día**: Cuando se intente programar, asignar una sesión sin fecha o reprogramar una sesión para un cliente en un día en el que ya tiene otra sesión (salvo que esté *Completada*, la cual sigue protegida), el sistema avisará de la coincidencia y permitirá machacar la sesión de ese día en lugar de duplicarla.
- **Actualización de hora y elección sobre los ejercicios**: Al machacar la sesión existente de ese día, se actualizará su hora a la nueva hora elegida y, si existe programación en juego, el usuario podrá elegir entre **Machacar los ejercicios** (reemplazar la rutina de ese día) o **Realizar cascada hacia delante** (desplazar la rutina desplazada hacia las siguientes sesiones del cliente y pasar la última a *Sesiones sin fecha*).
- **Persistencia completa al refrescar (F5)**: El navegador conservará tanto la pantalla y ficha/sesión activa (mediante el hash de la URL y `sessionStorage`) como el contexto visual (pestaña activa dentro de la ficha de cliente, mes/día seleccionado en Agenda y Planificación, y posición de scroll).

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Persistencia de estado al recargar**: Al pulsar `F5` o recargar la página en cualquier vista (por ejemplo, dentro de la ficha de un cliente en la pestaña *Registro de Movimientos*, programando una sesión concreta, o viendo una semana específica de la Agenda), la aplicación vuelve exactamente al mismo punto sin redirigir a la pantalla inicial.
  2. **Restauración exacta al Deshacer (`Ctrl+Z`)**: Al deshacer una cancelación con cascada, una asignación de sesión sin fecha o una reprogramación, todas las sesiones involucradas recuperan sus objetos `Timestamp` / `Date` originales de Firestore (`fecha_hora_inicio`), evitando que queden marcadas erróneamente como *Sin fecha*.
  3. **Control de sesión única por día con machaque o cascada**: Un cliente no tendrá dos sesiones individuales el mismo día. Si se agenda, asigna o reprograma sobre un día que ya tiene sesión para ese cliente, un diálogo interactivo permite actualizar la sesión de ese día a la nueva hora y elegir entre **machacar sus ejercicios** o **desplazar en cascada hacia delante**.
- **Target Audience / Persona**: Entrenadores y coordinadores de **GO & train** que gestionan diariamente la agenda, fichas de clientes y programación de entrenamientos.
- **Key Value**: Cero pérdida de contexto al refrescar el navegador, fiabilidad total al usar `Ctrl+Z` / `Ctrl+Y` en operaciones complejas de agenda, y prevención de sesiones duplicadas en un mismo día.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Recarga de página (`F5`)**:
     - El entrenador está en `#ficha_cliente/CLI-xxx` (o `#programar_sesion/SES-xxx`, `#agenda`, `#ejercicios`, etc.).
     - Al refrescar el navegador, el sistema lee el hash inicial de la URL (con respaldo en `sessionStorage`), mantiene la vista activa, recuerda la sub-pestaña abierta y restaura la posición de scroll tras cargar los datos.
  2. **Deshacer (`Ctrl+Z`) tras eliminar/cancelar en cascada o reprogramar**:
     - El entrenador cancela una sesión a *Sin fecha* (desplazando las siguientes en cascada) o reprograma una sesión en el calendario.
     - Si pulsa **Deshacer (`Ctrl+Z`)**, el lote de restauración reconstruye las fechas `Date` / `Timestamp` válidas en Firestore; todas las sesiones vuelven inmediatamente a su día y hora originales en los acordeones mensuales y en la Agenda.
  3. **Colisión de sesión en el mismo día (Machacar vs. Cascada hacia delante)**:
     - El entrenador intenta crear una cita, asignar una sesión sin fecha o reprogramar una sesión hacia un día (ej. *Miércoles 18/11 a las 18:00*) donde el cliente ya tenía una sesión (ej. *Miércoles 18/11 a las 10:00*).
     - Si el cambio es solo de hora para la misma sesión o el hueco destino está vacío, se actualiza directamente a la nueva hora.
     - Si ya existe otra sesión ese mismo día para el cliente, aparece un modal claro indicando la sesión existente de ese día y ofreciendo:
       - **Opción A — Machacar ejercicios y actualizar hora**: La sesión de ese día pasa a la nueva hora indicada y adopta los ejercicios de la sesión entrante (eliminando la sesión origen si venía de otro día o de *Sin fecha* para no dejar duplicados).
       - **Opción B — Actualizar hora y hacer cascada hacia delante**: La sesión de ese día pasa a la nueva hora con la rutina entrante, y la rutina que había en ese día se desplaza en cascada hacia delante a las siguientes sesiones pendientes del cliente (pasando la última a *Sesiones sin fecha*).
- **Visual Identity & Theme**:
  - Se mantiene la estética corporativa de **GO & train** (`--surface`, `--accent`, `--border`) utilizando modales limpios con tarjetas de opción diferenciadas por icono y descripción clara.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Clonado profundo preservando `Date` y `Timestamp` de Firestore**
  - *Chosen Approach*: Sustituir `JSON.parse(JSON.stringify(obj))` por una función recursiva `clonarProfundoPreservandoFechas(obj)` junto con normalización de fechas en el servicio de `Undo/Redo`.
  - *Why*: `JSON.stringify` convierte los objetos `Timestamp` de Firestore en mapas planos `{ seconds, nanoseconds }` sin método `.toDate()`. Al escribir ese mapa plano de vuelta en Firestore durante un `Undo`, Firestore lo guarda como un objeto genérico en lugar de un `Timestamp`, provocando que la aplicación interprete la sesión como carente de fecha válida (*Sin fecha*). Preservando instancias `Date` y `Timestamp` (y convirtiendo cualquier `{ seconds, nanoseconds }` serializado de nuevo a `Date`), el `Undo/Redo` restaura siempre fechas nativas de Firestore.
- **Decision 2: Sincronización bidireccional URL Hash + `sessionStorage`**
  - *Chosen Approach*: Inicializar `activeTab` y `routeParam` leyendo `window.location.hash` antes del primer render (en lugar de sobrescribirlo con `#planificacion`), y guardar en `sessionStorage` tanto la ruta como el estado de sub-vistas (mes de agenda, fecha de planificación, pestaña activa de ficha de cliente y filtros).
  - *Why*: Garantiza que tanto el botón *Atrás/Adelante* del navegador como el refresco completo de página (`F5`) mantengan al usuario exactamente donde estaba.
- **Decision 3: Resolución unificada de colisiones en el mismo día**
  - *Chosen Approach*: Centralizar la detección de otra sesión del mismo cliente en la misma fecha UTC (`YYYY-MM-DD`) tanto al reprogramar como al asignar sin fecha o planificar días en Agenda, ofreciendo el diálogo de **Machacar ejercicios** vs. **Cascada hacia delante**.
  - *Why*: Evita que un cliente acabe con dos sesiones el mismo día por cualquier vía de entrada y respeta la lógica de cascada del centro.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        Navegador (URL Hash + Session)                     │
│  #tab/param  ◄──►  sessionStorage (sub-tabs, mes/día activo, scrollY)     │
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │
                                     ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          Vistas de Usuario (React)                         │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌───────────────────┐  │
│  │   FichaClienteView  │  │     AgendaView      │  │ PlanificacionView │  │
│  └──────────┬──────────┘  └──────────┬──────────┘  └───────────────────┘  │
└─────────────┼────────────────────────┼────────────────────────────────────┘
              │                        │
              ▼                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│              Motor de Cascada y Colisión (sessionCascadeService)          │
│  • Detectar sesión existente del cliente en el mismo día UTC (YYYY-MM-DD) │
│  • Modo MACHACAR: actualiza hora + reemplaza ejercicios + absorbe origen  │
│  • Modo CASCADA_ADELANTE: actualiza hora + desplaza rutinas + Sin Fecha   │
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │
                                     ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                 Servicio Undo / Redo (undoService + clonar)               │
│  • clonarProfundoPreservandoFechas(): conserva Date y Firestore Timestamp │
│  • sanitizarDatosParaFirestore(): reconstruye Date desde {seconds, nanos} │
└───────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State
- **Sanitización de Timestamps en `undoService` y `sessionCascadeService`**:
  - Cualquier campo de fecha (`fecha_hora_inicio`, `fecha_hora_anterior`, `fecha_creacion_sin_fecha`, `fecha_ultima_edicion`, `fecha_modificacion`, `fecha_creacion`, `fecha`) se clona conservando su instancia `Date` / `Timestamp` real y se valida antes de enviarse en `ejecutarOperacionesFirestore`.
- **Persistencia de Navegación**:
  - `window.location.hash` parseado al iniciar la aplicación (`#ficha_cliente/CLI-...`, `#programar_sesion/SES-...`, `#agenda`, etc.).
  - Claves ligeras en `sessionStorage` para recordar la pestaña activa de `FichaClienteView` (`sesiones` | `progreso` | `movimientos`), el filtro de estado, el mes visualizado en `AgendaView` y el día seleccionado en `PlanificacionView`.

### Interactive Component & State Mapping
- **En `FichaClienteView` y `AgendaView` (Reprogramar / Asignar sin fecha / Planificar)**:
  - Al seleccionar un día y hora de destino, se comprueba si el cliente ya posee otra sesión en ese mismo día (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`).
  - Si la sesión existente en ese día está `Completada`, se mantiene bloqueada la operación con aviso.
  - Si existe otra sesión pendiente/vencida en ese mismo día, se abre el modal de resolución de mismo día para que el entrenador confirme:
    1. **Machacar los ejercicios** (actualizando la sesión de ese día a la nueva hora y reemplazando sus ejercicios).
    2. **Realizar cascada hacia delante** (actualizando la sesión de ese día a la nueva hora con la rutina entrante y desplazando la rutina anterior hacia las siguientes sesiones del cliente, enviando la última a *Sin fecha*).
    - Todas las operaciones quedan registradas en `pushAction` (`UndoContext`) con snapshots de fecha íntegros para poder deshacerse con `Ctrl+Z`.
