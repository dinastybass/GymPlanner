import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_COLLECTIONS = [
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
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

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
    throw new Error(`Error token Service Account (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

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
    throw new Error(`Error token OAuth2 Google Drive (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function listAllFirestoreCollections(projectId, accessToken) {
  try {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:listCollectionIds`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pageSize: 100 }),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.collectionIds) && data.collectionIds.length > 0) {
        return Array.from(new Set([...DEFAULT_COLLECTIONS, ...data.collectionIds]));
      }
    }
  } catch (e) {
    console.warn('No se pudo listar colecciones automáticamente, usando lista base:', e);
  }
  return DEFAULT_COLLECTIONS;
}

function parseFirestoreRestValue(valObj) {
  if (!valObj || typeof valObj !== 'object') return null;
  if ('nullValue' in valObj) return null;
  if ('booleanValue' in valObj) return Boolean(valObj.booleanValue);
  if ('integerValue' in valObj) return Number(valObj.integerValue);
  if ('doubleValue' in valObj) return Number(valObj.doubleValue);
  if ('stringValue' in valObj) return String(valObj.stringValue);
  if ('timestampValue' in valObj) {
    return { __datatype__: 'timestamp', value: valObj.timestampValue };
  }
  if ('arrayValue' in valObj) {
    return (valObj.arrayValue?.values || []).map(parseFirestoreRestValue);
  }
  if ('mapValue' in valObj) {
    const fields = valObj.mapValue?.fields || {};
    const result = {};
    for (const [k, v] of Object.entries(fields)) {
      result[k] = parseFirestoreRestValue(v);
    }
    return result;
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

async function exportCollection(projectId, accessToken, collectionName) {
  const documentsMap = {};
  let pageToken = '';
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodeURIComponent(collectionName)}`
    );
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Error exportando "${collectionName}" (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    for (const doc of data.documents || []) {
      const segments = doc.name.split('/');
      const docId = segments[segments.length - 1];
      documentsMap[docId] = parseFirestoreDocument(doc);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return documentsMap;
}

async function uploadBackupToGoogleDrive(driveToken, folderId, fileName, fileBuffer) {
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
    throw new Error(`Error buscando en Google Drive (${searchRes.status}): ${await searchRes.text()}`);
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
    throw new Error(`Error subiendo a Google Drive (${uploadRes.status}): ${await uploadRes.text()}`);
  }
  return await uploadRes.json();
}

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
  if (!res.ok) return;
  const data = await res.json();
  for (const file of data.files || []) {
    const delRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?supportsAllDrives=true`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${driveToken}` } }
    );
    if (delRes.ok) console.log(`🗑️ Eliminado backup antiguo: ${file.name}`);
  }
}

async function main() {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_PRO;
  if (!rawServiceAccount) {
    throw new Error('Falta el secret FIREBASE_SERVICE_ACCOUNT_PRO en GitHub Secrets.');
  }
  const serviceAccount = JSON.parse(rawServiceAccount);
  const projectId = serviceAccount.project_id || 'gymapp-d8ae7';
  const todayStr = new Date().toISOString().slice(0, 10);
  const fileName = `backup-gymplanner-prod-${todayStr}.json`;

  console.log(`🚀 Exportando Firestore Producción (${projectId}) - ${todayStr}`);
  const firestoreToken = await getServiceAccountAccessToken(serviceAccount, [
    'https://www.googleapis.com/auth/datastore',
  ]);

  const collectionsToExport = await listAllFirestoreCollections(projectId, firestoreToken);
  const collectionsData = {};
  const stats = {};
  let totalDocuments = 0;

  for (const colName of collectionsToExport) {
    const docs = await exportCollection(projectId, firestoreToken, colName);
    const count = Object.keys(docs).length;
    collectionsData[colName] = docs;
    stats[colName] = count;
    totalDocuments += count;
    console.log(`✅ ${colName}: ${count} documentos`);
  }

  const backupPayload = {
    metadata: {
      app: 'GymPlanner',
      environment: 'production',
      projectId,
      createdAt: new Date().toISOString(),
      date: todayStr,
      version: '1.0',
      totalCollections: collectionsToExport.length,
      totalDocuments,
      counts: stats,
    },
    collections: collectionsData,
  };

  const outDir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const fileBuffer = Buffer.from(JSON.stringify(backupPayload, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, fileName), fileBuffer);
  console.log(`💾 Guardado ${fileName} (${totalDocuments} documentos en ${collectionsToExport.length} colecciones)`);

  const folderId = process.env.GDRIVE_FOLDER_ID?.trim();
  if (folderId) {
    const clientId = process.env.GDRIVE_CLIENT_ID?.trim();
    const clientSecret = process.env.GDRIVE_CLIENT_SECRET?.trim();
    const refreshToken = process.env.GDRIVE_REFRESH_TOKEN?.trim();

    const driveToken = (clientId && clientSecret && refreshToken)
      ? await getOAuthRefreshTokenAccessToken(clientId, clientSecret, refreshToken)
      : await getServiceAccountAccessToken(serviceAccount, ['https://www.googleapis.com/auth/drive']);

    const uploaded = await uploadBackupToGoogleDrive(driveToken, folderId, fileName, fileBuffer);
    console.log(`☁️ Subido a Google Drive con éxito: ${uploaded.name} (ID: ${uploaded.id})`);
    await cleanupOldBackupsInDrive(driveToken, folderId, RETENTION_DAYS);
  }
}

main().catch((err) => {
  console.error('❌ Error fatal durante el backup:', err);
  process.exit(1);
});
