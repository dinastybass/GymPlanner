# GymPlanner - GO & train (React + TypeScript + Vite)

Sistema integral de planificación de entrenamientos, agenda de sesiones, directorio de clientes, catálogo de ejercicios, plantillas y pantalla de sala para **GO & train**.

## Características principales

- **Autenticación y Roles (RBAC)**: Inicio de sesión con Firebase Authentication, gestión de perfiles (`usuarios_app`), matriz de permisos por rol y redirección automática para cuentas de tipo `Proyector Sala`.
- **Planificación Diaria**: Panel de sesiones organizadas por Mañana, Tarde y Small Groups con selector de fecha, estado de sesión y exportación rápida de rutinas.
- **Programación de Sesiones**: Configuración de bloques, subgrupos, series, repeticiones, pesos e intensidad (`LOW`, `MED`, `HIGH`), alertas de lesiones/objetivos del cliente, carga desde plantillas y exportación a otros clientes o nuevas plantillas.
- **Agenda y Calendario**: Gestión de citas con fecha y citas "Sin fecha asignada", alta de sesiones, reprogramación y cancelación con soporte de Deshacer/Rehacer (`Ctrl+Z` / `Ctrl+Y`).
- **Directorio y Fichas de Clientes**: Gestión de clientes por estado (`Activo`, `Pausa`, `Baja`), datos de contacto, lesiones, objetivos, historial de sesiones y registro de Marcas Personales (`PR`).
- **Catálogo de Ejercicios y Plantillas**: Base de datos categorizada por nivel, bloque, grupo muscular y material, además de editor de plantillas predefinidas.
- **Gestión de Maestros**: Configuración dinámica de desplegables del sistema y matriz de permisos por rol.
- **Pantalla Sala (TV)**: Vista en tiempo real optimizada para proyección en sala con las sesiones programadas del día.

## Desarrollo

```bash
npm install
npm run dev
```
