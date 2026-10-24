const request = require('supertest');
const express = require('express');
const { hashPreviewToken } = require('../../services/previewGateway');

let app;
let execute;
const token = 'guide-route-test-token';
const origin = 'http://localhost:5173';

beforeEach(() => {
  jest.resetModules();
  process.env.PREVIEW_DATABASE_URL = 'mysql://preview:test@db.example/preview';
  process.env.PREVIEW_GATEWAY_TOKENS = `test:${hashPreviewToken(token)}`;
  process.env.PREVIEW_ALLOWED_ORIGINS = origin;
  execute = jest.fn(async () => [[{ id: 1, title: '住宿指南', content: '正文', category: 'campus-guide' }]]);
  jest.doMock('mysql2/promise', () => ({ createPool: () => ({ execute }) }));
  app = express();
  app.use('/api/preview', require('../../routes/preview'));
});

afterEach(() => {
  for (const key of ['PREVIEW_DATABASE_URL', 'PREVIEW_GATEWAY_TOKENS', 'PREVIEW_ALLOWED_ORIGINS']) delete process.env[key];
  jest.dontMock('mysql2/promise');
});

function get(path = '/handbook/export') {
  return request(app).get('/api/preview' + path).set('X-Preview-Token', token).set('Origin', origin);
}

test('指南导出需令牌和正确 Origin；匿名、错误令牌和来源都不访问数据库', async () => {
  expect((await request(app).get('/api/preview/handbook/export')).status).toBe(403);
  expect((await get().set('X-Preview-Token', 'wrong')).status).toBe(403);
  expect((await get().set('Origin', 'https://untrusted.example')).status).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});

test('导出响应不可缓存、只含公开正文，拒绝扩大范围的参数与写入', async () => {
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toContain('no-store');
  expect(response.body.data.items[0]).toMatchObject({ id: 1, content: '正文' });
  expect((await get('/handbook/export?includeDraft=1')).status).toBe(400);
  expect((await request(app).post('/api/preview/handbook/export').set('X-Preview-Token', token).set('Origin', origin)).status).toBe(404);
});

test('导出失败不向客户端泄漏数据库连接信息', async () => {
  execute.mockRejectedValue(new Error('mysql://private:secret@db.example/production'));
  const response = await get();
  expect(response.status).toBe(503);
  expect(response.text).not.toMatch(/private|secret|db.example/);
});
