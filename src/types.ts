export interface UsuarioApp {
  id: string;
  email: string;
  nombre: string;
  alias?: string;
  rol: string;
  es_programador: boolean;
}

export interface PermisoAccion {
  ver: boolean;
  editar: boolean;
  crear: boolean;
  borrar: boolean;
}

export type MatrizPermisos = Record<string, Record<string, PermisoAccion>>;

export interface CatalogoPermiso {
  id: string;
  categoria: string;
  nombre: string;
  descripcion: string;
}

export interface EjercicioSesion {
  ID_Ejercicio?: string;
  id_ejercicio?: string;
  Nombre_Ejercicio?: string;
  nombre_ejercicio?: string;
  Ejercicio_Detalle?: string;
  Acrónimo?: string;
  Acronimo?: string;
  alias?: string;
  Bloque?: string;
  bloque?: string;
  Series?: string;
  series?: string;
  Repeticiones?: string;
  repeticiones?: string;
  Peso?: string | number;
  peso?: string | number;
  Intensidad?: 'LOW' | 'MED' | 'HIGH' | string;
  intensidad?: 'LOW' | 'MED' | 'HIGH' | string;
  Material?: string;
  Material_Adaptacion?: string;
  Subgrupo?: string;
  subgrupo?: string;
  Subgrupo_Detalle?: string;
  subgrupo_detalle?: string;
  Detalle?: string;
  detalle?: string;
  notas?: string;
  video_url?: string;
  Video_URL?: string;
}

export interface SesionAgenda {
  id: string;
  id_cliente: string;
  ID_Cliente?: string;
  nombre_cliente?: string;
  Nombre_Cliente?: string;
  alias?: string;
  Alias?: string;
  tipo_sesion: 'Individual' | 'Small Group' | string;
  Tipo?: string;
  fecha_hora_inicio?: any;
  fecha_hora_anterior?: any;
  sin_fecha?: boolean;
  estado?: 'Pendiente' | 'Completada' | 'Vencida' | 'Sin fecha';
  intensidad?: 'LOW' | 'MED' | 'HIGH' | string;
  Intensidad?: 'LOW' | 'MED' | 'HIGH' | string;
  programado_por?: string;
  fecha_programacion?: any;
  ejercicios?: EjercicioSesion[];
  orden_customizado?: boolean;
  entrenador?: string;
  notas?: string;
  docData?: any;
}

export interface Cliente {
  id: string;
  Nombre_Cliente?: string;
  nombre?: string;
  Nombre?: string;
  Alias?: string;
  alias?: string;
  Estado_Cliente?: 'Activo' | 'Pausa' | 'Baja' | string;
  Tipo_Cliente?: string;
  Entrenador_Asignado?: string;
  Telefono?: string;
  Email?: string;
  Fecha_Nacimiento?: string;
  Lesiones?: string;
  Objetivos?: string;
  Observaciones?: string;
  fecha_alta?: any;
}

export interface EjercicioCatalogo {
  id: string;
  ID_Ejercicio?: string;
  Nombre_Ejercicio?: string;
  Acrónimo?: string;
  Bloque?: string;
  Nivel_Dificultad?: string;
  Grupo_Muscular?: string;
  Material?: string;
  Subcategoría?: string;
  Subcategoria?: string;
  Zona_Articulacion?: string;
  "Zona Articulación"?: string;
  Posición?: string;
  Posicion?: string;
  Patron_Movimiento?: string;
  Patron_Motor?: string;
  Video_URL?: string;
  Descripcion?: string;
  es_marca_pr?: boolean;
}

export interface PlantillaSesion {
  id: string;
  nombre: string;
  tipo_sesion: string;
  nivel: string;
  intensidad: 'LOW' | 'MED' | 'HIGH' | string;
  Intensidad?: 'LOW' | 'MED' | 'HIGH' | string;
  ejercicios: EjercicioSesion[];
  orden_customizado?: boolean;
}

export interface ProgresoCliente {
  id: string;
  id_cliente: string;
  id_ejercicio?: string;
  nombre_ejercicio: string;
  peso: number | string;
  repeticiones: number | string;
  fecha: any;
  observaciones?: string;
}

export interface MaestroItem {
  id: string;
  valor: string;
  orden: number;
}
