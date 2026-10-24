const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticateToken = require('../middleware/auth');
const { createAgentProxy } = require('../services/agentProxy');

const ID = /^[A-Za-z0-9_-]{1,64}$/;
function validChat(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const allowed = ['message', 'resume', 'decisions', 'conversation_id', 'checkpoint_id', 'semester_id'];
  if (Object.keys(body).some(key => !allowed.includes(key))) return false;
  if (['message', 'resume', 'decisions'].filter(key => body[key] !== undefined).length !== 1) return false;
  if (body.message !== undefined && (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000)) return false;
  if (body.resume !== undefined && typeof body.resume !== 'boolean') return false;
  if (body.decisions !== undefined && (!Array.isArray(body.decisions) || !body.decisions.length
      || body.decisions.length > 10 || body.decisions.some(d => !d || !['approve', 'reject', 'edit'].includes(d.type)))) return false;
  if (body.conversation_id !== undefined && !ID.test(body.conversation_id)) return false;
  for (const field of ['checkpoint_id', 'semester_id']) {
    if (body[field] !== undefined && body[field] !== null
        && (typeof body[field] !== 'string' || body[field].length > 128)) return false;
  }
  return true;
}

function createAgentRouter({ forward = createAgentProxy(), auth = authenticateToken } = {}) {
  const router = express.Router();
  router.use(auth);
  const chatLimit = rateLimit({
    windowMs: 60000, limit: 20, keyGenerator: req => String(req.user.id),
    standardHeaders: true, legacyHeaders: false,
    message: { status: -1, message: '提问过于频繁，请稍后再试' },
  });
  let active = 0;
  const users = new Map();
  router.get('/conversations', (req, res) => forward(req, res, '/conversations'));
  router.post('/conversations', (req, res) => {
    if (req.body && Object.keys(req.body).length) return res.status(400).json({ status: -1, message: '新建会话不接受身份或其他参数' });
    return forward(req, res, '/conversations');
  });
  router.get('/conversations/:id', (req, res) => {
    if (!ID.test(req.params.id)) return res.status(400).json({ status: -1, message: '会话编号无效' });
    return forward(req, res, '/conversations/' + encodeURIComponent(req.params.id));
  });
  router.delete('/conversations/:id', (req, res) => {
    if (!ID.test(req.params.id)) return res.status(400).json({ status: -1, message: '会话编号无效' });
    if (req.body && Object.keys(req.body).length) return res.status(400).json({ status: -1, message: '删除会话不接受其他参数' });
    return forward(req, res, '/conversations/' + encodeURIComponent(req.params.id));
  });
  router.post('/conversations/:id/restore', (req, res) => {
    if (!ID.test(req.params.id)) return res.status(400).json({ status: -1, message: '会话编号无效' });
    if (req.body && Object.keys(req.body).length) return res.status(400).json({ status: -1, message: '撤销删除不接受其他参数' });
    return forward(req, res, '/conversations/' + encodeURIComponent(req.params.id) + '/restore');
  });
  router.post('/chat', chatLimit, async (req, res) => {
    if (!validChat(req.body)) return res.status(400).json({ status: -1, message: '消息参数无效，请刷新会话后重试' });
    const user = String(req.user.id);
    if (active >= 8 || (users.get(user) || 0) >= 2) {
      return res.status(429).json({ status: -1, message: '当前请求较多，请等待正在处理的会话完成' });
    }
    active++;
    users.set(user, (users.get(user) || 0) + 1);
    try { await forward(req, res, '/chat', { stream: true }); }
    finally {
      active--;
      const remaining = users.get(user) - 1;
      if (remaining) users.set(user, remaining); else users.delete(user);
    }
  });
  return router;
}

module.exports = createAgentRouter();
module.exports.createAgentRouter = createAgentRouter;
