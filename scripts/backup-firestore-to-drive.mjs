import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Automated Daily Backup of Production Firestore (gymapp-d8ae7) to Google Drive.
 * Uses native Node 20 APIs (crypto, fetch, fs) so it requires zero external npm dependencies in GitHub Actions.
 */

const COLLECTIONS = [
  'clientes',
  'agenda_sesiones',
  'ejercicios',
  'plantillas_sesiones',
  'progreso_clientes',
  'maestros',
  'usuarios_app',
];

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || '30');

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Generates an OAuth2 Access Token from a Google Cloud Service Account JSON
 */
async function getServiceAccountAccessToken(serviceAccount, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: scopes.join(' '),
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const signature = signer.sign(privateKey);
  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const res = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error obteniendo token de Service Account (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Generates an OAuth2 Access Token from User Refresh Token (for personal Google Drive accounts)
 */
async function getOAuthRefreshTokenAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error obteniendo token OAuth2 de Google Drive (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Converts Firestore REST Value format into the same JSON format used by the Web Backup Service
 */
function parseFirestoreRestValue(valObj) {
  if (!valObj || typeof valObj !== 'object') return null;
  if ('nullValue' in valObj) return null;
  if ('booleanValue' in valObj) return Boolean(valObj.booleanValue);
  if ('integerValue' in valObj) return Number(valObj.integerValue);
  if ('doubleValue' in valObj) return Number(valObj.doubleValue);
  if ('stringValue' in valObj) return String(valObj.stringValue);
  if ('timestampValue' in valObj) {
    return {
      __datatype__: 'timestamp',
      value: valObj.timestampValue,
    };
  }
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue?.values || [];
    return values.map(parseFirestoreRestValue);
  }
  if ('mapValue' in valObj) {
    const fields = valObj.mapValue?.fields || {};
    const result = {};
    for (const [k, v] of Object.entries(fields)) {
      result[k] = parseFirestoreRestValue(v);
    }
    return result;
  }
  if ('geoPointValue' in valObj) {
    return valObj.geoPointValue;
  }
  if ('referenceValue' in valObj) {
    return valObj.referenceValue;
  }
  return null;
}

function parseFirestoreDocument(doc) {
  const fields = doc.fields || {};
  const parsed = {};
  for (const [k, v] of Object.entries(fields)) {
    parsed[k] = parseFirestoreRestValue(v);
  }
  return parsed;
}

/**
 * Fetches all documents in a collection via Firestore REST API (handles pagination)
 */
async function exportCollection(projectId, accessToken, collectionName) {
  const documentsMap = {};
  let pageToken = '';

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodeURIComponent(collectionName)}`
    );
    url.searchParams.set('pageSize', '300');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error exportando colección "${collectionName}" (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const docs = data.documents || [];
    for (const doc of docs) {
      const segments = doc.name.split('/');
      const docId = segments[segments.length - 1];
      documentsMap[docId] = parseFirestoreDocument(doc);
    }

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return documentsMap;
}

/**
 * Uploads or updates a JSON file in Google Drive Folder
 */
async function uploadBackupToGoogleDrive(driveToken, folderId, fileName, fileBuffer) {
  // Check if a backup with the exact same fileName already exists today in the folder
  const searchQuery = `name = '${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`;
  const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
  searchUrl.searchParams.set('q', searchQuery);
  searchUrl.searchParams.set('fields', 'files(id, name)');
  searchUrl.searchParams.set('supportsAllDrives', 'true');
  searchUrl.searchParams.set('includeItemsFromAllDrives', 'true');

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${driveToken}` },
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Error buscando archivos en Google Drive (${searchRes.status}): ${errText}`);
  }

  const searchData = await searchRes.json();
  const existingFile = searchData.files?.[0];

  const boundary = '-------GymPlannerBackupBoundary' + Date.now();
  const metadata = existingFile
    ? { name: fileName, mimeType: 'application/json' }
    : { name: fileName, mimeType: 'application/json', parents: [folderId] };

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      'utf8'
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`, 'utf8'),
  ]);

  const uploadUrl = existingFile
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';

  const uploadRes = await fetch(uploadUrl, {
    method: existingFile ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${driveToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(multipartBody.length),
    },
    body: multipartBody,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Error subiendo backup a Google Drive (${uploadRes.status}): ${errText}`);
  }

  return await uploadRes.json();
}

/**
 * Deletes backup files older than retentionDays inside the target Google Drive folder
 */
async function cleanupOldBackupsInDrive(driveToken, folderId, retentionDays) {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const query = `'${folderId}' in parents and name contains 'backup-gymplanner-prod-' and createdTime < '${cutoffDate}' and trashed = false`;

  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('fields', 'files(id, name, createdTime)');
  listUrl.searchParams.set('supportsAllDrives', 'true');
  listUrl.searchParams.set('includeItemsFromAllDrives', 'true');

  const res = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${driveToken}` },
  });

  if (!res.ok) {
    console.warn(`⚠️ No se pudo listar backups antiguos para limpieza (${res.status})`);
    return;
  }

  const data = await res.json();
  const oldFiles = data.files || [];

  if (oldFiles.length === 0) {
    console.log(`🧹 Retención de ${retentionDays} días: no hay backups antiguos para eliminar.`);
    return;
  }

  for (const file of oldFiles) {
    const delRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?supportsAllDrives=true`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${driveToken}` },
      }
    );
    if (delRes.ok) {
      console.log(`🗑️ Backup antiguo eliminado: ${file.name} (${file.createdTime})`);
    } else {
      console.warn(`⚠️ No se pudo eliminar ${file.name} (${delRes.status})`);
    }
  }
}

async function main() {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_PRO;
  if (!rawServiceAccount) {
    throw new Error('Falta el secret FIREBASE_SERVICE_ACCOUNT_PRO en las variables de entorno.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(rawServiceAccount);
  } catch (e) {
    throw new Error('El secret FIREBASE_SERVICE_ACCOUNT_PRO no contiene un JSON válido.');
  }

  const projectId = serviceAccount.project_id || 'gymapp-d8ae7';
  const todayStr = new Date().toISOString().slice(0, 10);
  const fileName = `backup-gymplanner-prod-${todayStr}.json`;

  console.log(`🚀 Iniciando backup de Firestore Producción (${projectId}) - Fecha: ${todayStr}`);

  const firestoreToken = await getServiceAccountAccessToken(serviceAccount, [
    'https://www.googleapis.com/auth/datastore',
  ]);

  const collectionsData = {};
  const stats = {};
  let totalDocuments = 0;

  for (const colName of COLLECTIONS) {
    console.log(`📦 Exportando colección: ${colName}...`);
    const docs = await exportCollection(projectId, firestoreToken, colName);
    const count = Object.keys(docs).length;
    collectionsData[colName] = docs;
    stats[colName] = count;
    totalDocuments += count;
    console.log(`   ✅ ${colName}: ${count} documentos`);
  }

  const backupPayload = {
    metadata: {
      app: 'GymPlanner',
      environment: 'production',
      projectId,
      createdAt: new Date().toISOString(),
      date: todayStr,
      version: '1.0',
      totalCollections: COLLECTIONS.length,
      totalDocuments,
      counts: stats,
    },
    collections: collectionsData,
  };

  const outDir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const localFilePath = path.join(outDir, fileName);
  const fileBuffer = Buffer.from(JSON.stringify(backupPayload, null, 2), 'utf8');
  fs.writeFileSync(localFilePath, fileBuffer);

  console.log(
    `💾 Backup guardado localmente en ${localFilePath} (${(fileBuffer.length / 1024).toFixed(1)} KB, ${totalDocuments} documentos totales).`
  );

  const folderId = process.env.GDRIVE_FOLDER_ID?.trim();
  if (!folderId) {
    console.log(
      'ℹ️ No se definió GDRIVE_FOLDER_ID. El backup queda disponible en los Artifacts de GitHub Actions.'
    );
    return;
  }

  const clientId = process.env.GDRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN?.trim();

  let driveToken;
  if (clientId && clientSecret && refreshToken) {
    console.log('🔑 Autenticando con Google Drive vía OAuth2 Refresh Token...');
    driveToken = await getOAuthRefreshTokenAccessToken(clientId, clientSecret, refreshToken);
  } else {
    console.log('🔑 Autenticando con Google Drive vía Service Account...');
    driveToken = await getServiceAccountAccessToken(serviceAccount, [
      'https://www.googleapis.com/auth/drive',
    ]);
  }

  console.log(`☁️ Subiendo ${fileName} a Google Drive (Carpeta: ${folderId})...`);
  const uploaded = await uploadBackupToGoogleDrive(driveToken, folderId, fileName, fileBuffer);
  console.log(`✅ Subido con éxito a Google Drive (File ID: ${uploaded.id}, Nombre: ${uploaded.name})`);

  await cleanupOldBackupsInDrive(driveToken, folderId, RETENTION_DAYS);
  console.log('🎉 Proceso de backup diario finalizado correctamente.');
}

main().catch((err) => {
  console.error('❌ Error fatal durante el backup:', err);
  process.exit(1);
});
