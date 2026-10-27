import firebase_admin
from firebase_admin import credentials, firestore

print("Conectando con Firebase usando firebase-key.json...")
cred = credentials.Certificate('firebase-key.json')
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

def activar_ejercicios_fuerza_maxima():
    batch = db.batch()
    contador = 0
    
    print("Buscando ejercicios con subcategoría 'Fuerza Máxima RM'...")
    
    # Obtenemos todos los ejercicios y filtramos para evitar problemas de índices o nombres de campo (con/sin tilde)
    docs = db.collection('ejercicios').stream()
    
    for doc in docs:
        data = doc.to_dict()
        # Rescatamos el campo de subcategoría (ya sea que esté guardado con o sin tilde)
        subcategoria = data.get('Subcategoría', data.get('Subcategoria', ''))
        
        if subcategoria == 'Fuerza Máxima RM':
            batch.set(doc.reference, {'es_de_progreso': True}, merge=True)
            contador += 1
            
            # Firestore permite hasta 500 operaciones por batch, aseguramos el envío si hay muchos
            if contador % 400 == 0:
                batch.commit()
                batch = db.batch()
                
    # Commiteamos el resto
    if contador % 400 != 0:
        batch.commit()
        
    print(f"✅ ¡Éxito! Se ha activado la marca de progreso automáticamente en {contador} ejercicios.")

if __name__ == '__main__':
    activar_ejercicios_fuerza_maxima()