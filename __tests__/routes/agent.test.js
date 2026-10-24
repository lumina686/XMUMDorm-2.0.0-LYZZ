const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');
jest.mock('../../database', () => ({ query: jest.fn() }));
const { query } = require('../../database');
const { createAgentRouter } = require('../../routes/agent');
const { createAgentProxy } = require('../../services/agentProxy');

const secret = randomBytes(32).toString('hex');
const loginKey = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const token = () => jwt.sign({ id: 7, role: 'student' }, loginKey, { expiresIn: 60 });
function app(fetchImpl, options = {}) {
  const value = express();
  value.use(express.json());
  value.use('/api/agent', createAgentRouter({ forward: createAgentProxy({ secret, fetchImpl, ...options }) }));
  return value;
}
const asJson = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { query.mockReset(); query.mockResolvedValue([{ status: 'active' }]); });

test('requires login and rechecks deactivated accounts', async () => {
  const fetchImpl = jest.fn();
  expect((await request(app(fetchImpl)).get('/api/agent/conversations')).status).toBe(401);
  query.mockResolvedValue([{ status: 'deactivated' }]);
  expect((await request(app(fetchImpl)).get('/api/agent/conversations').auth(token(), { type: 'bearer' })).status).toBe(403);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('signs the verified identity and replaces untrusted identity headers', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(asJson({ conversations: [{ id: 'main' }] }));
  const reply = await request(app(fetchImpl)).get('/api/agent/conversations')
    .auth(token(), { type: 'bearer' }).set('X-Campus-Assertion', 'forged');
  expect(reply.status).toBe(200);
  expect(reply.body).toEqual({ status: 0, data: { conversations: [{ id: 'main' }] } });
  const [url, options] = fetchImpl.mock.calls[0];
  expect(url.pathname).toBe('/internal/xmumdorm/conversations');
  expect(options.headers.Authorization).toBeUndefined();
  const claims = jwt.verify(options.headers['X-Campus-Assertion'], secret, {
    algorithms: ['HS256'], issuer: 'xmumdorm', audience: 'campus-copilot',
  });
  expect(claims.sub).toBe('7');
  expect(claims.exp - claims.iat).toBe(60);
});

test('deletes and restores conversations through authenticated allowlisted paths', async () => {
  const fetchImpl = jest.fn().mockImplementation(() => Promise.resolve(asJson({ id: 'abc' })));
  const target = app(fetchImpl);
  expect((await request(target).delete('/api/agent/conversations/abc')).status).toBe(401);
  expect((await request(target).delete('/api/agent/conversations/abc').auth(token(), { type: 'bearer' })).status).toBe(200);
  expect(fetchImpl.mock.calls[0][0].pathname).toBe('/internal/xmumdorm/conversations/abc');
  expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
  expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  expect((await request(target).post('/api/agent/conversations/abc/restore').auth(token(), { type: 'bearer' }).send({})).status).toBe(200);
  expect(fetchImpl.mock.calls[1][0].pathname).toBe('/internal/xmumdorm/conversations/abc/restore');
  expect(fetchImpl.mock.calls[1][1].method).toBe('POST');
  for (const method of ['delete', 'post']) {
    const path = '/api/agent/conversations/abc' + (method === 'post' ? '/restore' : '');
    expect((await request(target)[method](path).auth(token(), { type: 'bearer' }).send({ user_id: 8 })).status).toBe(400);
  }
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('creates a conversation and keeps user-owned 404 errors', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(asJson({ id: 'abc' }))
    .mockResolvedValueOnce(asJson({ detail: '会话不存在' }, 404));
  const target = app(fetchImpl);
  const created = await request(target).post('/api/agent/conversations').auth(token(), { type: 'bearer' }).send({});
  expect(created.body.data.id).toBe('abc');
  const detail = await request(target).get('/api/agent/conversations/abc').auth(token(), { type: 'bearer' });
  expect(detail.status).toBe(404);
  expect(detail.body.message).toBe('会话不存在');
});

test.each([{ message: '' }, { message: 'x', user_id: 9 }, { message: 'x', resume: true },
  { message: 'x'.repeat(4001) }, { decisions: [] }])('rejects invalid or self-declared identity input %j', async body => {
  const fetchImpl = jest.fn();
  const response = await request(app(fetchImpl)).post('/api/agent/chat').auth(token(), { type: 'bearer' }).send(body);
  expect(response.status).toBe(400);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('streams UTF-8 and preserves SSE framing', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('data: {"type":"token","text":"你好🌿"}\n\ndata: {"type":"done"}\n\n');
  const fetchImpl = jest.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes.slice(0, 39)); controller.enqueue(bytes.slice(39)); controller.close(); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const response = await request(app(fetchImpl)).post('/api/agent/chat').auth(token(), { type: 'bearer' }).send({ message: '你好' });
  expect(response.headers['content-type']).toContain('text/event-stream');
  expect(response.headers['x-accel-buffering']).toBe('no');
  expect(response.text).toContain('你好🌿');
  expect(response.text).toContain('"type":"done"');
});

test('keeps checkpoint conflicts and maps service credentials to gateway failure', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(asJson({ detail: '确认状态已改变' }, 409))
    .mockResolvedValueOnce(asJson({ detail: 'internal rejected' }, 401));
  const target = app(fetchImpl);
  const body = { resume: true, conversation_id: 'main', checkpoint_id: 'old' };
  expect((await request(target).post('/api/agent/chat').auth(token(), { type: 'bearer' }).send(body)).status).toBe(409);
  expect((await request(target).get('/api/agent/conversations').auth(token(), { type: 'bearer' })).status).toBe(502);
});

test('fails closed without configuration, on network errors and unknown paths', async () => {
  const fetchImpl = jest.fn().mockRejectedValue(new Error('do not disclose credentials'));
  const bad = await request(app(fetchImpl)).get('/api/agent/conversations').auth(token(), { type: 'bearer' });
  expect(bad.status).toBe(503);
  expect(bad.text).not.toContain('credentials');
  expect((await request(app(fetchImpl, { secret: '' })).get('/api/agent/conversations').auth(token(), { type: 'bearer' })).status).toBe(503);
  expect((await request(app(fetchImpl)).get('/api/agent/database').auth(token(), { type: 'bearer' })).status).toBe(404);
});
