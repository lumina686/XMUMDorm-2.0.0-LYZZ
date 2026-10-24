/**
 * 只读本地预览接口。只允许已登记协作者读取固定的课程资料与已发布指南。
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createPreviewGateway } = require('../services/previewGateway');

const router = express.Router();
const gateway = createPreviewGateway();

const previewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.previewClientId,
  message: { status: -1, code: 'PREVIEW_RATE_LIMITED', message: '预览请求过于频繁，请稍后再试' },
});

router.use((req, res, next) => {
  const origin = req.get('origin');
  const access = gateway.authorize({ token: req.get('x-preview-token'), origin });
  if (!access.ok) {
    const status = access.code === 'PREVIEW_DISABLED' ? 404 : 403;
    return res.status(status).json({ status: -1, code: access.code, message: '预览访问未获授权' });
  }
  req.previewClientId = access.clientId;
  res.set({
    'Access-Control-Allow-Origin': origin,
    'Cache-Control': 'private, no-store',
    Vary: 'Origin, X-Preview-Token',
  });
  return next();
});

router.use(previewLimiter);

router.get('/health', (req, res) => {
  res.json({ status: 0, data: { clientId: req.previewClientId } });
});

router.get('/materials/courses', async (req, res, next) => {
  try {
    const courses = await gateway.listCourses({ q: req.query.q, limit: req.query.limit });
    res.json({ status: 0, data: { courses } });
  } catch (error) {
    next(error);
  }
});

router.get('/materials', async (req, res, next) => {
  try {
    const items = await gateway.listMaterials({
      q: req.query.q,
      // Keep the public Materials API's query name so the Web client can use
      // its existing call shape without a broad /api proxy.
      courseId: req.query.courseId || req.query.course,
      type: req.query.type,
      examNode: req.query.examNode,
      lesson: req.query.lesson,
      kind: req.query.kind,
      sort: req.query.sort,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ status: 0, data: items });
  } catch (error) {
    next(error);
  }
});

router.get('/handbook/export', async (req, res) => {
  if (Object.keys(req.query).some(key => !['afterId', 'snapshot', 'limit'].includes(key))) {
    return res.status(400).json({ status: -1, message: '不支持的导出参数' });
  }
  try {
    const data = await gateway.exportGuides(req.query);
    return res.json({ status: 0, data });
  } catch (error) {
    const status = [400, 409, 413].includes(error.status) ? error.status : 503;
    return res.status(status).json({ status: -1,
      message: status === 409 ? '指南已更新，请重新同步' : '指南导出暂不可用' });
  }
});

module.exports = router;
