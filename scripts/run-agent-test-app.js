/** Isolated browser fixture. No .env, real database or model API is loaded. */
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const databasePath = require.resolve('../database');
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { query: async (_sql, params) => [1, 2].includes(Number(params?.[0])) ? [{ status: 'active' }] : [] },
};
const authenticate = require('../middleware/auth');
const { createAgentRouter } = require('../routes/agent');
const app = express();
app.use(express.json());
app.get('/__fixture', (_req, res) => res.type('html').send(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>校园助手 · 本地联调</title>
<style>body{font:16px/1.8 system-ui;color:#20304a;background:#f7fafc;margin:60px auto;padding:24px;max-width:560px}button{font:inherit;color:white;background:#236db5;border:0;border-radius:10px;padding:12px 20px;margin:8px;cursor:pointer}p{color:#42526b}</style>
<h1>校园助手本地联调</h1>
<p>${process.env.DORM_AGENT_LIVE === '1' ? '真实模型与知识检索已启用。' : '当前使用离线假模型。'}
使用下方测试身份进入，无需 Dorm 数据库。这些身份不会访问正式账号资料。</p>
<button onclick="enter(1)">测试身份一</button><button onclick="enter(2)">测试身份二</button><p id="notice" role="status"></p>
<script>async function enter(id){try{const res=await fetch('/__fixture/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});if(!res.ok)throw new Error();const data=await res.json();localStorage.setItem('token',data.token);localStorage.setItem('user',JSON.stringify(data.user));localStorage.setItem('dorm-install-hint-dismissed','true');location.href='/myzone/agent'}catch(e){document.getElementById('notice').textContent='无法进入，请检查本地联调服务是否运行。'}}</script></html>`));
let available = true;
app.post('/__fixture/availability', (req, res) => { available = req.body.available !== false; res.sendStatus(204); });
app.post('/__fixture/login', (req, res) => {
  const id = Number(req.body.id);
  if (![1, 2].includes(id)) return res.sendStatus(400);
  const user = { id, username: 'fixture-' + id, nickname: '测试同学' + id, role: 'student', email_verified: true, level: 1 };
  return res.json({ token: jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' }), user });
});
app.get('/api/users/me', authenticate, (req, res) => res.json({ status: 0, data: req.user }));
app.use('/api/agent', (_req, res, next) => available ? next() : res.status(503).json({ status: -1, message: '校园助手尚未配置，请先启动本地 Agent 服务' }), createAgentRouter());
app.use('/api', (_req, res) => res.json({ status: 0, data: { list: [], unreadCount: 0, total: 0, hasMore: false } }));
const dist = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const port = Number(process.env.CAMPUS_FIXTURE_PORT || 18766);
app.listen(port, '127.0.0.1', () => console.log(`Offline Dorm fixture: http://127.0.0.1:${port}/agent`));
