const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query } = require('../database');
const { createPersonalData } = require('../services/agentPersonalData');
const { createHolidayData } = require('../services/agentHolidays');

function createPersonalRouter({ secret = process.env.CAMPUS_AGENT_SHARED_SECRET || '', queryImpl = query,
  now = () => new Date(), calendarNow = now, data = createPersonalData({ query: queryImpl, now: calendarNow }) } = {}) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (secret.length < 32) return res.status(503).json({ status: -1, message: '个人数据连接尚未配置' });
    let claims;
    try {
      claims = jwt.verify(req.get('X-Campus-Agent-Assertion') || '', secret, {
        algorithms: ['HS256'], issuer: 'campus-copilot', audience: 'xmumdorm-personal',
        maxAge: '65s', clockTolerance: 5, clockTimestamp: Math.floor(now().getTime() / 1000),
      });
      const clock = Math.floor(now().getTime() / 1000);
      if (typeof claims.sub !== 'string' || !/^[1-9][0-9]{0,15}$/.test(claims.sub)
          || !Number.isSafeInteger(Number(claims.sub)) || !Number.isInteger(claims.iat)
          || !Number.isInteger(claims.exp) || claims.iat > clock + 5
          || claims.exp <= clock || claims.exp <= claims.iat || claims.exp - claims.iat > 120) throw new Error('Invalid claims');
    } catch (_) { return res.status(401).json({ status: -1, message: '个人数据连接验证失败' }); }
    try {
      const rows = await queryImpl('SELECT status FROM users WHERE id = ? LIMIT 1', [Number(claims.sub)]);
      if (rows.length !== 1 || rows[0].status === 'deactivated') return res.status(403).json({ status: -1, message: '账号不可用' });
    } catch (_) { return res.status(503).json({ status: -1, message: '账号状态暂时无法确认' }); }
    req.personalUserId = Number(claims.sub);
    return next();
  });
  router.use(rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => String(req.personalUserId),
    standardHeaders: true, legacyHeaders: false }));
  function read(path, keys, handler) {
    router.get(path, async (req, res) => {
      if (Object.keys(req.query).some(key => !keys.includes(key))
          || Object.values(req.query).some(value => typeof value !== 'string')) {
        return res.status(400).json({ status: -1, message: '查询参数无效' });
      }
      try { return res.json({ status: 0, data: await handler(req.personalUserId, req.query) }); }
      catch (error) { return res.status(error.status === 400 ? 400 : 503).json({ status: -1,
        message: error.status === 400 ? '查询参数无效' : '个人数据暂时无法读取' }); }
    });
  }
  read('/clock', [], () => data.clock());
  read('/schedule', ['when', 'date', 'week', 'weekday'], (id, args) => data.schedule(id, args));
  read('/todos', ['when', 'date', 'status', 'page'], (id, args) => data.todos(id, args));
  read('/holidays', ['when', 'year', 'name', 'date', 'start', 'end'], (_id, args) => createHolidayData({ now: calendarNow })(args));
  return router;
}

module.exports = createPersonalRouter();
module.exports.createPersonalRouter = createPersonalRouter;
