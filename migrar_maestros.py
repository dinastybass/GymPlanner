import firebase_admin
from firebase_admin import credentials, firestore
import re
import unicodedata

print("Conectando con Firebase usando firebase-key.json...")
cred = credentials.Certificate('firebase-key.json')
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

def generar_id_doc(texto):
    """Convierte una clave como 'Días de la semana' en el ID del documento: 'dias_de_la_semana'"""
    texto = unicodedata.normalize('NFKD', str(texto)).encode('ascii', 'ignore').decode('utf-8')
    texto = re.sub(r'[^a-z0-9]+', '_', texto.lower())
    return texto.strip('_')

def generar_id_item(valor):
    """Convierte un valor como 'Jueves' en la clave interna del mapa: 'jueves'"""
    texto = unicodedata.normalize('NFKD', str(valor)).encode('ascii', 'ignore').decode('utf-8')
    texto = re.sub(r'[^a-z0-9]+', '_', texto.lower())
    return texto.strip('_')

def migrar():
    print("Iniciando migración hacia la colección única 'maestros'...")
    
    # Diccionario para agrupar en memoria antes de volcar a Firestore
    # Formato: { doc_id: { seccion, clave, valores: { item_id: { detalles } } } }
    maestros_dict = {}

    def agregar_item(seccion, clave, valor, orden=99):
        if not valor or str(valor).strip() == "" or str(valor).strip() == "-":
            return
        val_str = str(valor).strip()
        doc_key = generar_id_doc(clave)
        item_key = generar_id_item(val_str)

        if doc_key not in maestros_dict:
            maestros_dict[doc_key] = {
                "seccion": seccion,
                "clave": clave,
                "valores": {}
            }
        
        maestros_dict[doc_key]["valores"][item_key] = {
            "seccion": seccion,
            "clave": clave,
            "valor": val_str,
            "orden": orden
        }

    # 1. Ejercicios base
    niveles_orden = ["Iniciación", "Básico", "Intermedio", "Avanzado"]
    for i, n in enumerate(niveles_orden):
        agregar_item("Ejercicios", "Niveles", n, i + 1)

    bloques_orden = [
        "Calentamiento Dinámico", "Calentamiento Específico", "Calentamiento",
        "Movilidad", "Activación", "Core", "Parte Principal", "Fuerza", "General"
    ]
    for i, b in enumerate(bloques_orden):
        agregar_item("Ejercicios", "Bloques", b, i + 1)

    series_base = ["3 x 8", "3 x 10", "3 x 12", "3 x 15", "4 x 8", "4 x 10", "4 x 12", "2 x 15", "3 x 30 seg"]
    for i, s in enumerate(series_base):
        agregar_item("Ejercicios", "Series y Repeticiones", s, i + 1)

    # Materiales desde ajustes/listas
    try:
        ajustes_doc = db.collection('ajustes').document('listas').get()
        if ajustes_doc.exists:
            for m in ajustes_doc.to_dict().get('materiales', []):
                if m: agregar_item("Ejercicios", "Materiales", m.strip())
    except Exception:
        pass

    # Extraer de ejercicios
    grupos_set, subcat_set, zona_set, pos_set, patron_set = set(), set(), set(), set(), set()
    for doc in db.collection('ejercicios').stream():
        d = doc.to_dict()
        if d.get('Nivel_Dificultad'):
            agregar_item("Ejercicios", "Niveles", d['Nivel_Dificultad'], 99)
        if d.get('Bloque') or d.get('Fase_Bloque'):
            agregar_item("Ejercicios", "Bloques", d.get('Bloque') or d.get('Fase_Bloque'), 99)

        for val in re.split(r'[,/]', str(d.get('Grupo_Muscular', ''))):
            if val.strip(): grupos_set.add(val.strip())
        for val in re.split(r'[,/]', str(d.get('Material', ''))):
            if val.strip(): agregar_item("Ejercicios", "Materiales", val.strip())
        for val in re.split(r'[,/]', str(d.get('Subcategoría') or d.get('Subcategoria') or '')):
            if val.strip(): subcat_set.add(val.strip())
        for val in re.split(r'[,/]', str(d.get('Zona Articulación') or d.get('Zona_Articulacion') or '')):
            if val.strip(): zona_set.add(val.strip())
        for val in re.split(r'[,/]', str(d.get('Posición') or d.get('Posicion') or '')):
            if val.strip(): pos_set.add(val.strip())
        
        pat = d.get('Patron_Movimiento') or d.get('Patron_Motor')
        if pat and str(pat).strip():
            patron_set.add(str(pat).strip())

    for i, val in enumerate(sorted(grupos_set)):
        agregar_item("Ejercicios", "Grupos de Ejercicios", val, i + 1)
    for i, val in enumerate(sorted(subcat_set)):
        agregar_item("Ejercicios", "Subcategorías", val, i + 1)
    for i, val in enumerate(sorted(zona_set)):
        agregar_item("Ejercicios", "Zona / Articulación", val, i + 1)
    for i, val in enumerate(sorted(pos_set)):
        agregar_item("Ejercicios", "Posición", val, i + 1)
    for i, val in enumerate(sorted(patron_set)):
        agregar_item("Ejercicios", "Patrón Motor", val, i + 1)

    # Clientes -> Estado
    estados_orden = ["Activo", "En pausa", "De baja"]
    for i, est in enumerate(estados_orden):
        agregar_item("Clientes", "Estado", est, i + 1)

    for doc in db.collection('clientes').stream():
        est = doc.to_dict().get('Estado_Cliente')
        if est:
            agregar_item("Clientes", "Estado", est, 99)

    # Agenda
    horarios_ind = [
        "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
        "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00"
    ]
    for i, h in enumerate(horarios_ind):
        agregar_item("Agenda", "Horarios Sesiones Individuales", h, i + 1)

    horarios_sg = ["17:00", "18:00", "19:00"]
    for i, h in enumerate(horarios_sg):
        agregar_item("Agenda", "Horarios Small Groups", h, i + 1)

    dias_semana = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]
    for i, d in enumerate(dias_semana):
        agregar_item("Agenda", "Días de la semana", d, i + 1)

    # Guardar en Firestore dentro de la colección 'maestros'
    batch = db.batch()
    count_docs = 0
    for doc_key, data in maestros_dict.items():
        ref = db.collection('maestros').document(doc_key)
        batch.set(ref, data, merge=True)
        count_docs += 1

    batch.commit()
    print(f"✅ ¡Migración completada! Se han creado {count_docs} documentos en la colección 'maestros'.")

if __name__ == '__main__':
    migrar()