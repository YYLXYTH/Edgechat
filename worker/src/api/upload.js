import { errorResponse } from '../utils.js';

const FILE_BROWSER_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const BLOCKED_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'text/xml',
  'application/xml'
]);

function normalizeContentType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function isInlineContentType(contentType) {
  if (!contentType) {
    return false;
  }
  if (contentType === 'application/pdf') {
    return true;
  }
  if (contentType.startsWith('image/')) {
    return contentType !== 'image/svg+xml';
  }
  if (contentType.startsWith('video/')) {
    return true;
  }
  return false;
}

function sanitizeFilename(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '');
  return cleaned.slice(0, 180) || 'file';
}

function contentDispositionValue(kind, filename) {
  const safeUtf8 = sanitizeFilename(filename);
  const safeAscii = safeUtf8
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, '')
    .trim()
    .slice(0, 150) || 'file';
  return `${kind}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(safeUtf8)}`;
}

function validateUpload(env, file) {
  const maxFileSize = Number(env.MAX_FILE_SIZE || 20971520);
  if (file.size > maxFileSize) {
    throw new Error(`文件大小不能超过 ${Math.round(maxFileSize / 1024 / 1024)}MB`);
  }

  const contentType = normalizeContentType(file.type);
  if (BLOCKED_MIME_TYPES.has(contentType)) {
    throw new Error('该文件类型不允许上传');
  }

  const allowed = String(env.ALLOWED_FILE_TYPES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowed.length && !allowed.some((prefix) => contentType.startsWith(prefix))) {
    throw new Error('该文件类型不允许上传');
  }
}

export function registerUploadRoutes(app) {
  app.post('/api/upload', async (c) => {
    return errorResponse('文件上传功能已禁用（R2 存储已移除）');
  });

  app.get('/files/:key{.+}', async (c) => {
    return new Response('文件下载功能已禁用（R2 存储已移除）', { status: 404 });
  });
}
