import firebase_admin
from firebase_admin import credentials, firestore
import datetime
from zoneinfo import ZoneInfo

print("Conectando con Firebase usando firebase-key.json...")
cred = credentials.Certificate('firebase-key.json')
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

def migrar_sesiones_a_utc():
    TZ_MADRID = ZoneInfo("Europe/Madrid")
    docs = db.collection('agenda_sesiones').stream()
    
    batch = db.batch()
    contador = 0
    omitidas = 0
    
    print("Analizando sesiones en 'agenda_sesiones'...")
    
    for doc in docs:
        data = doc.to_dict()
        
        # Si ya fue migrada o creada con el nuevo sistema UTC, la saltamos
        if data.get('utc_migrado'):
            omitidas += 1
            continue
            
        fecha_inicio = data.get('fecha_hora_inicio')
        if not fecha_inicio or not isinstance(fecha_inicio, datetime.datetime):
            continue
            
        # Asegurar que tenemos el objeto en UTC
        dt_utc = fecha_inicio.astimezone(datetime.timezone.utc)
        
        # Si la sesión se creó/modificó desde la web, rescatamos la hora local de Madrid elegida
        # Si vino de importar.py (que restó 2h fijas de verano a todo el CSV), le sumamos 2h
        if data.get('creado_por') or data.get('programado_por') or data.get('ultimo_modificado_por'):
            dt_local = dt_utc.astimezone(TZ_MADRID)
            nueva_fecha_utc = datetime.datetime(
                dt_local.year, dt_local.month, dt_local.day,
                dt_local.hour, dt_local.minute, 0,
                tzinfo=datetime.timezone.utc
            )
        else:
            nueva_fecha_utc = dt_utc + datetime.timedelta(hours=2)
            nueva_fecha_utc = nueva_fecha_utc.replace(second=0, microsecond=0)
            
        # Salvaguarda para Small Groups desfasados 1h respecto al horario maestro
        es_sg = (data.get('tipo_sesion') == 'Small Group' or data.get('Tipo') == 'SG')
        if es_sg:
            dia_semana = nueva_fecha_utc.weekday()  # 0=Lunes, 1=Martes, 2=Miércoles, 3=Jueves
            hora_utc = nueva_fecha_utc.hour
            if dia_semana in (0, 2) and hora_utc == 17:
                nueva_fecha_utc += datetime.timedelta(hours=1)
            elif dia_semana in (1, 3) and hora_utc in (16, 18):
                nueva_fecha_utc += datetime.timedelta(hours=1)
                
        update_data = {
            'fecha_hora_inicio': nueva_fecha_utc,
            'utc_migrado': True
        }
        
        # Si existe fecha_hora_fin en el documento, la ajustamos manteniendo la duración
        fecha_fin = data.get('fecha_hora_fin')
        if fecha_fin and isinstance(fecha_fin, datetime.datetime):
            update_data['fecha_hora_fin'] = nueva_fecha_utc + datetime.timedelta(hours=1)
            
        batch.set(doc.reference, update_data, merge=True)
        contador += 1
        
        # Firestore permite hasta 500 operaciones por lote
        if contador % 400 == 0:
            batch.commit()
            print(f"Procesadas {contador} sesiones...")
            batch = db.batch()
            
    if contador % 400 != 0:
        batch.commit()
        
    print(f"✅ ¡Migración completada! Se han actualizado {contador} sesiones a UTC nominal ({omitidas} ya estaban migradas).")

if __name__ == '__main__':
    migrar_sesiones_a_utc()