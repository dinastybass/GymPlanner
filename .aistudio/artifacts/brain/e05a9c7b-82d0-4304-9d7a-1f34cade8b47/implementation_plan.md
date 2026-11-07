# Política de Límite Mensual de Reprogramación y Caducidad de Sesiones Sin Fecha

Este plan implementa la política del gimnasio que restringe la reprogramación únicamente a las sesiones del mes en curso y los meses previos configurados en **Maestros > Agenda** (por defecto `1`, es decir, mes actual más el mes anterior), bloqueando las sesiones completadas y las vencidas fuera de plazo, y devolviendo automáticamente las sesiones **Sin fecha** caducadas a su fecha original como **Vencidas** no reprogramables.

## Revisión de Usuario y Decisiones Confirmadas

> [!IMPORTANT]
> Las siguientes decisiones han sido confirmadas e incorporadas en el diseño:

- **Comportamiento al caducar una sesión Sin fecha fuera de plazo**: Se mantienen intactas las rutinas de las sesiones futuras y la sesión **Sin fecha** se quita de la bolsa y vuelve a su fecha y hora original (`fecha_hora_anterior`) con sus ejercicios y con estado **Vencida** bloqueada para reprogramación.
- **Interpretación del parámetro en Maestros > Agenda**: El valor numérico indica cuántos meses anteriores al mes actual están permitidos (por ejemplo, el valor por defecto `1` permite reprogramar sesiones del **mes actual + 1 mes anterior**; en noviembre son reprogramables noviembre y octubre, mientras que septiembre y meses anteriores quedan bloqueados).
- **Trazabilidad en el Registro de Movimientos**: Cuando una sesión **Sin fecha** supera el plazo mensual y vuelve a su fecha original como **Vencida**, se añade automáticamente una entrada profesional en la pestaña **Registro de Movimientos** de la ficha del cliente.

---

## 1. Visión General y Concepto Principal

- **Qué hace**:
  1. Incorpora en **Maestros > Agenda** el parámetro **"Meses de margen para reprogramar"** con valor inicial `1`.
  2. Registra y muestra en cada sesión de la bolsa **Sin fecha** su fecha de origen (`fecha_hora_anterior`).
  3. Al cargar la aplicación o cambiar de mes, evalúa todas las sesiones **Sin fecha**: aquellas cuya fecha original sea anterior al primer día del mes límite permitido (`mesActual - mesesMargen`) salen automáticamente de la bolsa **Sin fecha**, se reubican en su fecha y hora original como **Vencida** (sin alterar las sesiones futuras) y registran el movimiento en la ficha del cliente.
  4. Bloquea las acciones de **Reprogramar**, **Cancelar a Sin fecha** y **Volcar en hueco** tanto en **Agenda** como en **Ficha de Cliente** para todas las sesiones **Completadas** y para todas las sesiones **Vencidas** cuya fecha sea anterior al límite de meses configurado.
- **Valor clave**: Garantiza que las sesiones vencidas o sin fecha de más de dos meses (ej. septiembre o anteriores estando en noviembre) queden cerradas como **Vencidas** en su día original sin posibilidad de reprogramarse, automatizando el control administrativo del gimnasio.

---

## 2. Experiencia de Usuario y Diseño Visual

- **Flujos de Usuario Clave**:
  1. **Configuración en Maestros > Agenda**: El administrador accede a **Maestros**, selecciona la sección **Agenda** y edita la categoría **"Meses de margen para reprogramar"** (por defecto `1`).
  2. **Visualización de fecha de origen en Sesiones Sin Fecha**: En la tabla de **Sesiones programadas sin fecha** dentro de la ficha del cliente, cada sesión muestra su fecha de origen (`Origen: DD/MM/AAAA HH:MM`) para identificar de qué mes proviene.
  3. **Paso de mes y conversión a Vencida**: Si una sesión **Sin fecha** tiene fecha de origen anterior al mes límite (por ejemplo, septiembre estando en noviembre con margen `1`), desaparece de la bolsa **Sin fecha**, aparece ubicada en su mes y día original dentro del historial del cliente con estado **Vencida** y queda registrada en **Registro de Movimientos**.
  4. **Bloqueo de acciones fuera de plazo**: En el listado de sesiones de **Ficha de Cliente** y en el menú contextual de **Agenda**, las sesiones **Completadas** y las sesiones **Vencidas** anteriores al mes límite solo permiten consultar su programación o enviar copia de ejercicios a sesiones futuras, ocultando los botones de reprogramación y cancelación.
- **Identidad Visual y Jerarquía**:
  - **Estética de Panel Operativo**: Superficies limpias en blanco (`#FFFFFF`) y gris pizarra (`#F8FAFC`) con bordes sutiles de `1px` (`#E2E8F0`), manteniendo la tipografía tabular (`tabular-nums`) en fechas, horas y contadores.
  - **Semántica de Estados**:
    - **Completada**: Texto e indicador en verde (`#15803D`), bloqueada para reprogramación.
    - **Vencida (dentro de plazo, ej. mes anterior)**: Indicador en rojo (`#B91C1C`), con botones de reprogramación activos.
    - **Vencida (fuera de plazo, ej. septiembre o anterior)**: Indicador en rojo (`#B91C1C`) acompañado de etiqueta sutil de plazo agotado, sin controles de reprogramación ni cancelación.

---

## 3. Decisiones de Producto y Arquitectura

- **Cálculo dinámico de la fecha de corte (`fechaLimiteReprogramacionUTC`)**:
  - *Enfoque elegido*: Calcular el primer instante en UTC del mes permitido según el valor maestro `N` (`Date.UTC(añoActual, mesActual - N, 1, 0, 0, 0, 0)`).
  - *Por qué*: Con `N = 1` en noviembre de 2026, la fecha de corte es el `01/10/2026 00:00 UTC`. Cualquier sesión con fecha `< 01/10/2026` pertenece a septiembre o meses anteriores y queda automáticamente bloqueada.
- **Conservación de la fecha de origen en la bolsa Sin fecha**:
  - *Enfoque elegido*: Al cancelar una sesión con cascada hacia delante, la sesión que pasa a **Sin fecha** conserva en `fecha_hora_anterior` la fecha y hora exacta de la cita cancelada que originó el movimiento. Si existiera alguna sesión sin fecha antigua sin `fecha_hora_anterior`, se toma `fecha_creacion_sin_fecha` o `fecha_creacion` como respaldo.
  - *Por qué*: Permite saber con exactitud a qué día y hora debe regresar la sesión cuando supere el plazo mensual de reprogramación.

---

## 4. Arquitectura Técnica y Flujo de Datos

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Maestros > Agenda (Firestore)                    │
│        "Meses de margen para reprogramar" (Valor por defecto: 1)        │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             Cálculo de Corte: 1º día de (Mes Actual - N meses)          │
│         Ej. Noviembre 2026 (N=1) ──► Corte = 01/10/2026 00:00 UTC       │
└─────────────────┬─────────────────────────────────────┬─────────────────┘
                  │                                     │
                  ▼                                     ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│   Procesador de Caducidad Mensual │ │   Reglas de UI (Agenda y Ficha)   │
│   de Bolsa "Sin Fecha"            │ │                                   │
│                                   │ │ • Si Completada:                  │
│ • Detecta sesiones sin_fecha con  │ │   Bloquea Reprogramar y Cancelar  │
│   fecha_hora_anterior < Corte     │ │ • Si Vencida y fecha < Corte:     │
│ • Mantiene rutinas futuras        │ │   Bloquea Reprogramar, Cancelar   │
│ • Pasa sesión a su fecha original │ │   y Volcar en hueco               │
│   con estado = "Vencida"          │ │ • Si Vencida y fecha >= Corte:    │
│ • Añade entrada en Registro de    │ │   Permite Reprogramar             │
│   Movimientos del cliente         │ │                                   │
└───────────────────────────────────┘ └───────────────────────────────────┘
```

### Modelo de Datos y Estados Interactivos
- **Catálogo de Maestros**:
  - Se añade `"Meses de margen para reprogramar"` dentro de `ESTRUCTURA_MAESTROS["Agenda"]` con inicialización automática en `"1"` si no existe en Firestore, junto con una función auxiliar `getMesesMargenReprogramacion()` y `obtenerFechaLimiteReprogramacionUTC(mesesMargen)`.
- **Proceso de Caducidad de Sesiones Sin Fecha**:
  - Al cargar `Agenda`, `Ficha de Cliente` o `Hoy`, se verifica si existen sesiones `sin_fecha: true` cuya fecha de origen (`fecha_hora_anterior` o `fecha_creacion_sin_fecha`) sea `< fechaLimiteUTC`.
  - Para cada sesión detectada, se actualiza su documento pasando `sin_fecha: false`, `fecha_hora_inicio: fechaOrigen`, `estado: 'Vencida'`, `estado_sesion: 'Vencida'` y se inserta un registro en `historial_movimientos` del cliente con el detalle de la caducidad por plazo superado.
- **Controles en Ficha de Cliente y Agenda**:
  - En `FichaClienteView`: los botones de **Reprogramar fecha/hora**, **Cancelar sesión** (`📌`) y **Asignar a hueco** (`📥`) solo se muestran cuando la sesión no está `Completada` y su fecha es `>= fechaLimiteUTC`. Además, el modal de asignar sesión existente a un hueco excluye sesiones vencidas anteriores a `fechaLimiteUTC`.
  - En `AgendaView`: `obtenerAccionesDisponiblesSesion` utiliza el valor de `mesesMargen` leído de Maestros para calcular `limiteReprogramar` y deshabilitar tanto `puedeReprogramar` como `puedeCancelarSinFecha` en sesiones anteriores a `limiteReprogramar`.
