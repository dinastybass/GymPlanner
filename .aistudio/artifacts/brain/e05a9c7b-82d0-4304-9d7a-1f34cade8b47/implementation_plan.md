# Lógica Unificada de Cancelación, Vencimiento Automático, Reprogramación en Cascada y Registro de Movimientos

Rediseño integral del flujo de anulación, vencimiento y reprogramación de entrenamientos para preservar siempre la secuencia lógica de las rutinas del cliente sin mostrar opciones confusas, liberando automáticamente los huecos del calendario y dejando constancia profesional de cada movimiento en la ficha del cliente.

## Revisión y Decisiones Confirmadas

> [!IMPORTANT]
> Estas decisiones recogen las respuestas confirmadas para alinear el comportamiento de la Agenda y la Ficha del Cliente con el método real de trabajo del gimnasio.

- **Liberación del hueco al cancelar o vencer**: Cuando una sesión se cancela manualmente o vence automáticamente sin haberse completado, **la cita se elimina del calendario** para liberar el hueco en la agenda, desplazando su programación en cascada hacia delante.
- **Vencimiento automático a partir del día siguiente**: Cualquier sesión individual cuya fecha haya quedado en un día anterior a hoy (a partir de las 00:00 del día siguiente) y no esté marcada como *Completada* se procesa automáticamente como una cancelación por inasistencia/vencimiento: libera su hueco, empuja su rutina en cascada a las siguientes sesiones y envía la última rutina sobrante a la bolsa de *Sesiones programadas sin fecha*.
- **Reprogramación directa sin preguntas intermedias**: Si una sesión con fecha se mueve directamente a otro día u hora, el sistema **reordena automáticamente las rutinas en orden cronológico** entre las sesiones pendientes del cliente sin mostrar el antiguo paso de selección de modos de cascada.
- **Registro profesional de movimientos (Log de actividad en la Ficha del Cliente)**: Cada acción relevante (*Cancelación manual*, *Cancelación automática por vencimiento*, *Reprogramación de fecha/hora* y *Recuperación/asignación desde Sin fecha*) genera una entrada clara, legible y en lenguaje natural dentro de la Ficha del Cliente.

---

## 1. Visión General y Concepto Central

- **Qué hace**: Automatiza el movimiento de las programaciones de ejercicios para que el orden de entrenamiento diseñado por el entrenador nunca se rompa cuando un cliente falta, cancela, cambia de día o recupera una sesión pendiente.
- **Usuarios**: Entrenadores y responsables de programación desde **Agenda**, **Hoy** y **Ficha de Cliente**.
- **Valor principal**:
  1. **Cero fricción operativa**: Desaparecen los modales con múltiples opciones técnicas de cascada; el sistema aplica siempre la regla del gimnasio.
  2. **Secuencia de entrenamiento intacta**: Tanto al cancelar (cascada hacia delante + sobrante a *Sin fecha*) como al recuperar una sesión de *Sin fecha* (cascada hacia atrás + ubicación de la rutina de *Sin fecha* en la última sesión programada o primera vacía), el cliente realiza sus sesiones exactamente en el orden previsto.
  3. **Trazabilidad clara**: El entrenador puede consultar en la ficha del cliente qué sesiones se cancelaron, reprogramaron o recuperaron y cuándo ocurrió.

---

## 2. Experiencia de Usuario y Diseño Visual

### Flujos de Usuario Clave

1. **Cancelar Sesión (Manual desde Agenda o Ficha de Cliente)**:
   - El botón antiguo *"Cancelar sin fecha"* pasa a llamarse **"Cancelar sesión"**.
   - Al pulsarlo (previa confirmación clara):
     - La cita del día cancelado se elimina del calendario (liberando el hueco).
     - Su programación pasa a la siguiente sesión futura del cliente, la de esa sesión a la siguiente, y así sucesivamente (**cascada hacia delante**).
     - La programación que estaba en la última sesión programada del cliente no crea una cita inventada al día siguiente, sino que **pasa con todos sus ejercicios a la bolsa de "Sesiones programadas sin fecha"**. (Si la sesión cancelada era la única o la última y tenía ejercicios, pasa directamente a *Sin fecha*).
     - Se registra en el historial del cliente: *"Sesión del [Fecha y Hora] cancelada. Su programación se desplazó a las siguientes sesiones y la última rutina pasó a Sesiones sin fecha."*

2. **Vencimiento Automático (Al pasar de día sin marcarse como Completada)**:
   - Al cargar la Agenda, la vista de Hoy o la Ficha del Cliente, el sistema detecta si existen sesiones de días anteriores a hoy (`fecha < inicio_de_hoy`) que sigan en estado *Pendiente* / *Vencida* (no completadas).
   - Automáticamente ejecuta la misma lógica de **Cancelación en cascada hacia delante**:
     - Desplaza las rutinas hacia las sesiones posteriores del cliente.
     - Envía la rutina desplazada del final a la bolsa de **Sesiones programadas sin fecha**.
     - Elimina la cita vencida del calendario y añade una entrada en el registro del cliente indicando que la sesión venció sin completarse y su rutina fue desplazada automáticamente.
   - Al ser automático al cambiar de día, la pestaña de *"Vencidas"* queda limpia y es sustituida de forma mucho más útil por el **Registro de Movimientos / Historial de Cambios** del cliente.

3. **Asignar Fecha / Reprogramar una Sesión desde la Bolsa "Sin fecha" (Cascada hacia atrás)**:
   - Cuando el entrenador selecciona una sesión de la bolsa **Programadas sin fecha** y elige un hueco de destino en el calendario (`Fecha Destino`):
     - Se crea/ubica la cita en la `Fecha Destino`.
     - **Si existen sesiones programadas posteriores a `Fecha Destino`**: se aplica la **cascada hacia atrás** (la programación de la sesión inmediatamente posterior pasa a `Fecha Destino`, la siguiente pasa a la anterior, etc.) y la programación que guardaba la sesión *Sin fecha* se coloca al final de la cola: en la **primera sesión no programada (vacía)** tras las sesiones con rutina, o bien en la **última sesión programada** si todas tenían ya ejercicios (en cuyo caso la que estaba en esa última pasa a la primera vacía si existe).
     - **Si `Fecha Destino` es posterior a todas las sesiones con ejercicios** (o no hay sesiones intermedias con ejercicios): la rutina de *Sin fecha* se ubica en la primera sesión no programada disponible siguiendo el orden cronológico.
     - Se elimina el documento de la bolsa *Sin fecha* ya consumido y se registra en el log del cliente: *"Sesión sin fecha asignada al [Fecha y Hora destino] reordenando el bloque de entrenamientos."*

4. **Reprogramar Fecha/Hora de una Sesión con Fecha**:
   - Al elegir el nuevo día y hora en el selector semanal, **no se muestra ningún paso 2 de preguntas técnicas**.
   - El cambio se aplica directamente manteniendo el orden cronológico de todas las rutinas pendientes desde la fecha afectada, y se anota en el registro del cliente: *"Sesión del [Fecha origen] reprogramada al [Fecha destino]."*

### Identidad Visual y Diseño del Registro de Movimientos

- **Estética y Superficies**: Integrado con el sistema visual actual del gimnasio (`--surface: #ffffff`, `--border: #e2e8f0`, `--accent-dark: #0f766e`), manteniendo superficies limpias de un solo nivel de elevación y tipografía tabular (`tabular-nums`) para fechas y horas.
- **Nuevo Panel / Pestaña "📋 Registro de Movimientos" en la Ficha del Cliente**:
  - Accesible directamente en la conmutación principal de la Ficha del Cliente (junto a *📅 Historial de Sesiones* y *📈 Progreso*) con contador de eventos.
  - Cada fila muestra en lenguaje claro y no técnico:
    - **Etiqueta semántica de acción**: *Cancelada*, *Vencimiento automático*, *Reprogramada* o *Sin fecha asignada*.
    - **Descripción humana**: Ej. *"El cliente canceló la sesión del Miércoles 04/11 a las 18:00. La rutina se desplazó a la siguiente sesión y la última programación pasó a Sin fecha."*
    - **Fecha del registro y autor**: Cuándo se realizó el movimiento y qué entrenador estaba activo (con cifras tabulares).

---

## 3. Decisiones de Producto y Racional

- **Decisión 1: Unificación de los algoritmos de Cascada en un Servicio Centralizado**
  - *Enfoque elegido*: Crear un motor único de operaciones de sesión que ejecutan por igual la Agenda y la Ficha del Cliente.
  - *Por qué*: Garantiza que cancelar o reprogramar desde la Agenda produzca exactamente el mismo resultado en base de datos, el mismo soporte de Deshacer (`Ctrl+Z`) y el mismo registro en el log que hacerlo desde la Ficha del Cliente.
- **Decisión 2: Destino de la rutina de "Sin fecha" al hacer cascada hacia atrás**
  - *Enfoque elegido*: Al insertar una sesión procedente de *Sin fecha* en una `Fecha Destino` intermedia, todas las sesiones con fecha en `[Fecha Destino ... última sesión]` forman una cola cronológica. Las rutinas de las sesiones posteriores a `Fecha Destino` dan un paso atrás (hacia `Fecha Destino`), y la rutina que venía de *Sin fecha* se deposita al final de las rutinas programadas (en la primera sesión vacía de las últimas sesiones o cerrando la última sesión programada).
  - *Por qué*: Como la sesión que estaba en *Sin fecha* contenía precisamente la rutina que salió despedida de la última sesión cuando el cliente canceló un día anterior, colocarla al final mientras las demás retroceden un puesto reconstruye exactamente la secuencia original `Sesión 1 → Sesión 2 → Sesión 3`.

---

## 4. Arquitectura Técnica y Flujo de Datos

### Diagrama de Arquitectura y Flujo de Cascadas

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   MOTOR DE CASCADAS Y LOG DE SESIONES                      │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
       ┌──────────────────────────────┼──────────────────────────────┐
       ▼                              ▼                              ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ 1. CANCELAR / VENCER    │  │ 2. ASIGNAR "SIN FECHA"  │  │ 3. REPROGRAMAR CON FECHA│
│ (Cascada hacia delante) │  │ (Cascada hacia atrás)   │  │ (Orden cronológico)     │
├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤
│ • Elimina cita del slot │  │ • Crea cita en F_dest   │  │ • Mueve cita de F_orig  │
│ • Empuja rutinas S_i a  │  │ • Trae rutinas de       │  │   a F_dest              │
│   S_{i+1}               │  │   S_{i+1} hacia S_i     │  │ • Reordena las rutinas  │
│ • La rutina de la última│  │ • Ubica rutina SinFecha │  │   en [min(F), max(F)]   │
│   sesión programada     │  │   en 1ª vacía final o   │  │   manteniendo su orden  │
│   pasa a bolsa SinFecha │  │   última programada     │  │   de secuencia          │
└────────────┬────────────┘  └────────────┬────────────┘  └────────────┬────────────┘
             │                            │                            │
             └────────────────────────────┼────────────────────────────┘
                                          ▼
                   ┌────────────────────────────────────────────┐
                   │ Firestore Batch + Historial Log Cliente    │
                   │ (Soporte completo de Deshacer / Ctrl+Z)    │
                   └────────────────────────────────────────────┘
```

### Modelo de Datos para el Registro de Movimientos del Cliente

- Los eventos se almacenan de forma persistente asociados al cliente (`historial_movimientos` en el documento del cliente o colección dedicada vinculada por `id_cliente`), con la estructura:
  - `id`: Identificador único del movimiento.
  - `id_cliente`: Identificador del cliente.
  - `tipo`: `'CANCELACION' | 'VENCIMIENTO' | 'REPROGRAMACION' | 'ASIGNACION_SIN_FECHA'`.
  - `titulo`: Resumen corto (ej. `"Sesión cancelada"`, `"Sesión reprogramada"`, `"Sesión sin fecha asignada"`, `"Cancelación automática por vencimiento"`).
  - `detalle`: Explicación clara y profesional con las fechas/horas implicadas.
  - `fecha_registro`: Marca temporal del movimiento.
  - `usuario`: Nombre del entrenador o `"Automático"` en el caso de vencimiento al cambiar de día.
