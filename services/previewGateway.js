/**
 * 协作者本地课程资料与指南只读预览网关。
 *
 * 只使用 PREVIEW_DATABASE_URL，绝不回退到应用运行时的 DATABASE_URL。
 * 生产环境必须把 PREVIEW_DATABASE_URL 配成只读账号或只读副本。
 */

const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { inlineLimit, inlineOffset } = require('../utils/sqlLimit');
const { TYPES } = require('../shared/constants/materials');

function cdnUrl(baseUrl, filePath) {
  if (!baseUrl || !filePath) return null;
  const encodedPath = String(filePath).split('/').map(encodeURIComponent).join('/');
  return `${String(baseUrl).replace(/\/+$/, '')}/${encodedPath}`;
}

function tagsFromDatabase(value) {
  return String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

function hashPreviewToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseTokenEntries(raw) {
  const entries = new Map();
  for (const part of String(raw || '').split(',')) {
    const [clientId, hash] = part.trim().split(':', 2);
    if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(clientId || '') && /^[a-f0-9]{64}$/i.test(hash || '')) {
      entries.set(clientId, hash.toLowerCase());
    }
  }
  return entries;
}

function parseOrigins(raw) {
  return new Set(String(raw || '').split(',').map((origin) => origin.trim()).filter(Boolean));
}

function createPreviewGateway({
  previewDatabaseUrl = process.env.PREVIEW_DATABASE_URL,
  tokenEntries = process.env.PREVIEW_GATEWAY_TOKENS,
  allowedOrigins = process.env.PREVIEW_ALLOWED_ORIGINS,
  materialsBaseUrl = process.env.PREVIEW_MATERIALS_BASE_URL,
  createPool = mysql.createPool,
} = {}) {
  const clients = parseTokenEntries(tokenEntries);
  const origins = parseOrigins(allowedOrigins);
  const enabled = Boolean(previewDatabaseUrl && clients.size > 0 && origins.size > 0);
  let pool = null;

  function authorize({ token, origin }) {
    if (!enabled) return { ok: false, code: 'PREVIEW_DISABLED' };
    if (!origin || !origins.has(origin)) return { ok: false, code: 'PREVIEW_ORIGIN_DENIED' };

    const candidate = Buffer.from(hashPreviewToken(token), 'hex');
    for (const [clientId, expectedHash] of clients) {
      const expected = Buffer.from(expectedHash, 'hex');
      if (crypto.timingSafeEqual(candidate, expected)) return { ok: true, clientId };
    }
    return { ok: false, code: 'PREVIEW_UNAUTHORIZED' };
  }

  function readPool() {
    if (!enabled) throw new Error('Preview gateway is disabled');
    if (!pool) {
      pool = createPool(previewDatabaseUrl, {
        waitForConnections: true,
        connectionLimit: 4,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        multipleStatements: false,
      });
    }
    return pool;
  }

  async function listCourses({ q = '', limit = 100 } = {}) {
    const keyword = String(q || '').trim();
    const params = [];
    let where = '';
    if (keyword) {
      where = 'WHERE (c.name LIKE ? OR c.lecturer LIKE ? OR c.course_code LIKE ?)';
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }
    const [rows] = await readPool().execute(
      `SELECT c.id AS courseId, c.name, c.lecturer, c.course_code AS courseCode,
              COUNT(m.id) AS materialCount
         FROM courses c
         LEFT JOIN materials m
                ON m.course_id = c.id AND m.deleted_at IS NULL AND m.status = 'merged'
         ${where}
        GROUP BY c.id, c.name, c.lecturer, c.course_code, c.is_pseudo
       HAVING materialCount > 0 OR c.is_pseudo = 1
        ORDER BY materialCount DESC, c.name ASC, c.lecturer ASC
        LIMIT ${inlineLimit(limit, { fallback: 100, max: 100 })}`,
      params
    );
    return Array.isArray(rows) ? rows : [];
  }

  async function listMaterials({
    q = '', courseId = null, type = '', examNode = '', lesson = null, kind = '', sort = 'recent', page = 1, pageSize = 30,
  } = {}) {
    const conditions = ["m.deleted_at IS NULL", "m.status = 'merged'"];
    const params = [];
    const keyword = String(q || '').trim();
    const id = Number(courseId);
    if (Number.isInteger(id) && id > 0) {
      conditions.push('m.course_id = ?');
      params.push(id);
    }
    if (type && TYPES.includes(type)) {
      conditions.push('m.type = ?');
      params.push(type);
    }
    if (examNode) {
      conditions.push('m.exam_node = ?');
      params.push(String(examNode));
    }
    const lessonNumber = Number(lesson);
    if (Number.isInteger(lessonNumber) && lessonNumber > 0) {
      conditions.push('m.lesson = ?');
      params.push(lessonNumber);
    }
    if (kind) {
      conditions.push('m.kind = ?');
      params.push(String(kind));
    }
    if (keyword) {
      const like = `%${keyword}%`;
      conditions.push('(m.title LIKE ? OR m.description LIKE ? OR c.name LIKE ? OR c.lecturer LIKE ? OR m.lesson_title LIKE ? OR m.tags LIKE ?)');
      params.push(like, like, like, like, like, like);
    }
    const safePage = Math.max(1, Number(page) || 1);
    const limit = inlineLimit(pageSize, { fallback: 30, max: 100 });
    const offset = inlineOffset((safePage - 1) * limit, { max: 10000 });
    const where = conditions.join(' AND ');
    const orderBy = sort === 'name'
      ? 'm.title ASC, m.id ASC'
      : sort === 'size'
        ? 'm.file_size DESC, m.id DESC'
        : 'm.created_at DESC, m.id DESC';
    const db = readPool();
    const [[{ total = 0 } = {}]] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM materials m
         JOIN courses c ON c.id = m.course_id
        WHERE ${where}`,
      params
    );
    const [rows] = await readPool().execute(
      `SELECT m.id, m.material_path AS path, m.title, m.description, m.type, m.lesson,
              m.lesson_title AS lessonTitle, m.exam_node AS examNode, m.source, m.tags,
              m.semester, m.kind, m.file_name AS name, m.file_name AS fileName, m.file_size AS size,
              m.created_at AS updatedAt, m.download_count AS downloadCount,
              c.id AS courseId, c.name AS courseName, c.lecturer
         FROM materials m
         JOIN courses c ON c.id = m.course_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const items = Array.isArray(rows) ? rows.map((row) => {
      const url = cdnUrl(materialsBaseUrl, row.path);
      return {
        ...row,
        tags: tagsFromDatabase(row.tags),
        cdnUrl: url,
        downloadUrl: url,
      };
    }) : [];
    return {
      configured: true,
      baseUrl: materialsBaseUrl || null,
      total: Number(total) || 0,
      page: safePage,
      pageSize: limit,
      items,
    };
  }

  async function exportGuides({ afterId = '0', snapshot = '', limit = '30' } = {}) {
    if (!/^\d{1,15}$/.test(String(afterId)) || !/^\d{1,3}$/.test(String(limit))
        || Number(limit) < 1 || Number(limit) > 30
        || (snapshot && !/^[a-f0-9]{64}$/.test(String(snapshot)))
        || (Number(afterId) > 0 && !snapshot)) {
      const error = new Error('Invalid guide export cursor');
      error.status = 400;
      throw error;
    }
    // One SELECT creates a coherent snapshot. Reject oversize exports rather
    // than silently losing articles. No author/account/interaction data or writes.
    const [rows] = await readPool().execute(
      `SELECT a.id, a.title, a.summary, a.content, a.content_type AS contentType,
              a.external_url AS externalUrl, a.published_at AS publishedAt,
              a.updated_at AS updatedAt, t.slug AS category
         FROM handbook_articles a
         JOIN handbook_tabs t ON t.id = a.tab_id
        WHERE a.deleted_at IS NULL AND a.status = 'published' AND t.is_enabled = 1
        ORDER BY a.id ASC LIMIT 1001`, []
    );
    const items = rows.map(row => ({
      id: Number(row.id), title: row.title, summary: row.summary || '',
      content: row.content || '', contentType: row.contentType || 'markdown',
      externalUrl: row.externalUrl || null, publishedAt: row.publishedAt,
      updatedAt: row.updatedAt, category: row.category, status: 'published',
    }));
    const serialized = JSON.stringify(items);
    if (items.length > 1000 || Buffer.byteLength(serialized) > 10 * 1024 * 1024) {
      const error = new Error('Guide export exceeds snapshot limit');
      error.status = 413;
      throw error;
    }
    const revision = crypto.createHash('sha256').update(serialized).digest('hex');
    if (snapshot && snapshot !== revision) {
      const error = new Error('Guide snapshot changed; restart the export');
      error.status = 409;
      throw error;
    }
    const remaining = items.filter(item => item.id > Number(afterId));
    const page = remaining.slice(0, Number(limit));
    const hasMore = remaining.length > page.length;
    return { schemaVersion: 1, snapshot: revision, total: items.length, items: page,
      hasMore, nextAfterId: hasMore ? page[page.length - 1].id : null };
  }

  return { enabled, authorize, listCourses, listMaterials, exportGuides };
}

module.exports = { createPreviewGateway, hashPreviewToken };
