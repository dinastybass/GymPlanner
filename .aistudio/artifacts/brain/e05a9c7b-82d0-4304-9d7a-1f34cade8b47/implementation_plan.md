# Sistema de Backups Diarios en Google Drive (GitHub Actions) y Panel en Maestros

Este plan implementa copias de seguridad automáticas diarias de la base de datos de Producción (`gymapp-d8ae7`) hacia Google Drive mediante GitHub Actions, junto con un módulo de descarga y restauración directa en la sección **Maestros** de la aplicación web.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Decisiones confirmadas por el usuario**:
> - **Horario de ejecución**: Todos los días de madrugada a las **03:00 (hora de España)** (`cron: '0 2 * * *'` UTC) más opción de ejecución manual bajo demanda (`workflow_dispatch`) desde la pestaña *Actions* de GitHub.
> - **Política de retención**: Se conservarán los **últimos 30 días** de copias en la carpeta de Google Drive, eliminando automáticamente los archivos de backup con más de 30 días de antigüedad.
> - **Formato y panel web**: Un **único archivo JSON completo por día** (`backup-gymplanner-prod-YYYY-MM-DD.json`) con todas las colecciones y preservación exacta de fechas (`Timestamp`), más un panel en **Maestros** para descargar o restaurar un backup en cualquier momento desde la web.

> [!NOTE]
> **Autenticación con Google Drive personal**: Las cuentas de servicio de Google Cloud no tienen cuota de almacenamiento propia en cuentas personales de Google Drive (`@gmail.com`). Por ello, el script de GitHub Actions admitirá autenticación OAuth2 mediante *Refresh Token* de tu cuenta de Google Drive (además de guardar siempre una copia de respaldo de 30 días en *GitHub Actions Artifacts*) e incluirá una guía paso a paso de 3 minutos para configurar los secretos en GitHub.

## 1. Overview & Core Concept

- **Qué hace**:
  1. **Automatización nocturna en GitHub Actions**: Cada madrugada a las 03:00 (hora España), un flujo de trabajo se conecta al Firestore de Producción (`gymapp-d8ae7`), exporta todas las colecciones en un archivo JSON estructurado, lo sube a la carpeta indicada de tu Google Drive y purga las copias de más de 30 días.
  2. **Gestión desde la Web (Maestros)**: Añade en **Maestros > Copias de Seguridad (Backups)** una herramienta visual para administradores que permite descargar al instante el archivo JSON completo de la base de datos, previsualizar el contenido de cualquier archivo de backup y restaurar colecciones completas o individuales preservando los tipos `Timestamp` de Firestore.
- **Valor principal**: Protección total frente a pérdidas accidentales de datos, con copias externas automatizadas en tu Google Drive y capacidad de recuperación inmediata desde la propia aplicación.

## 2. User Experience & Visual Design

- **Flujo en la aplicación web (Maestros > Copias de Seguridad)**:
  - **Tarjeta de Descarga Inmediata**: Muestra el entorno activo (`PRODUCCIÓN` o `DESARROLLO`), el listado de colecciones incluidas (`clientes`, `agenda_sesiones`, `ejercicios`, `plantillas_sesiones`, `progreso_clientes`, `maestros`, `usuarios_app`) y un botón principal **📥 Descargar Backup Completo (.json)** con contador en tiempo real de documentos exportados.
  - **Tarjeta de Restauración Segura**: Permite seleccionar un archivo `.json` (generado por GitHub Actions o por la web), muestra un resumen previo (fecha del backup, entorno de origen y número de documentos por colección), permite marcar qué colecciones se desean restaurar y solicita confirmación antes de escribir en Firestore.
  - **Guía integrada de GitHub Actions + Google Drive**: Panel desplegable con los pasos exactos para añadir `GDRIVE_FOLDER_ID` y las credenciales de Google Drive en los *Secrets* del repositorio de GitHub.
- **Identidad visual**: Integrado en la estética limpia de **GymPlanner - GO & train**, utilizando tarjetas blancas con bordes suaves, insignias semánticas en verde esmeralda (`#0d9488`) y alertas de seguridad en ámbar/rojo para la restauración.

## 3. Key Product Decisions & Trade-Offs

- **Decisión 1: Serialización tipada de fechas Firestore (`Timestamp`)**
  - *Enfoque elegido*: Serializar cada `Timestamp` de Firestore con una envolvente `{ "__datatype__": "timestamp", "value": "2026-11-08T11:30:00.000Z" }`.
  - *Por qué*: El formato JSON estándar convierte las fechas en cadenas de texto simples; al incluir la marca `__datatype__`, la restauración reconstruye objetos `Timestamp` nativos de Firestore sin romper las consultas por rango de fechas de la Agenda.
- **Decisión 2: Doble destino en GitHub Actions (Google Drive + GitHub Artifact)**
  - *Enfoque elegido*: El workflow sube el archivo a tu carpeta de Google Drive mediante la API REST v3 de Google Drive y además adjunta el archivo como *Artifact* de GitHub Actions durante 30 días.
  - *Por qué*: Garantiza que tengas el backup disponible tanto en tu Google Drive como directamente en la pestaña *Actions* de GitHub incluso si en algún momento caduca un token o cambias de carpeta en Drive.

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────┐
│              GitHub Actions (03:00 Hora España + Manual)             │
│  1. Conecta a Firestore PROD (gymapp-d8ae7) con Service Account      │
│  2. Exporta todas las colecciones con Timestamps tipados             │
│  3. Sube backup-gymplanner-prod-YYYY-MM-DD.json a Google Drive       │
│  4. Elimina en esa carpeta de Drive los backups > 30 días            │
│  5. Guarda respaldo adicional en GitHub Actions Artifacts (30 días)  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│            Carpeta en Google Drive (Últimos 30 días)                 │
│     backup-gymplanner-prod-2026-11-08.json (JSON Único Completo)     │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│        Panel Web: Maestros > Copias de Seguridad (Solo Admin)        │
│  ┌────────────────────────────────┐ ┌──────────────────────────────┐ │
│  │  Exportador Web Instantáneo    │ │  Importador / Restaurador    │ │
│  │  Genera el mismo formato JSON  │ │  Lee JSON, reconstruye       │ │
│  │  y descarga en el navegador    │ │  Timestamps y escribe lotes  │ │
│  └────────────────────────────────┘ └──────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Estructura del Archivo JSON de Backup

- `metadata`: Fecha de generación ISO, proyecto (`gymapp-d8ae7`), versión de esquema y conteo de documentos por colección.
- `collections`: Mapa con todas las colecciones de la aplicación (`clientes`, `agenda_sesiones`, `ejercicios`, `plantillas_sesiones`, `progreso_clientes`, `maestros`, `usuarios_app`), donde cada clave es el `id` del documento y su valor contiene todos sus campos con preservación de objetos `Timestamp`.
