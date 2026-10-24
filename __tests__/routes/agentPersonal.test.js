const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createPersonalRouter } = require('../../routes/agentPersonal');
const { createPersonalData } = require('../../services/agentPersonalData');
const { createHolidayData } = require('../../services/agentHolidays');

const secret = 'personal-callback-test-key-with-more-than-32-characters';
const instant = new Date('2026-10-24T03:30:00Z');
const nowSeconds = Math.floor(instant.getTime() / 1000);
function token(sub = '7', changes = {}) {
  const claims = { iss: 'campus-copilot', aud: 'xmumdorm-personal', sub, iat: nowSeconds, exp: nowSeconds + 60, ...changes };
  return jwt.sign(Object.fromEntries(Object.entries(claims).filter(([, value]) => value !== undefined)), secret, { algorithm: 'HS256' });
}
function appFor({ status = 'active', data, queryImpl, calendarNow } = {}) {
  const query = queryImpl || jest.fn(async () => [{ status }]);
  const app = express();
  const personal = data || { clock: () => ({ today: '2026-10-24' }),
    schedule: jest.fn(async id => ({ classes: [{ courseName: `Only user ${id}` }] })),
    todos: jest.fn(async id => ({ items: [{ title: `Only user ${id}` }] })) };
  app.use('/internal/campus-agent/personal', createPersonalRouter({ secret, queryImpl: query, data: personal, now: () => instant, calendarNow }));
  return { app, query, personal };
}
function get(app, path, assertion = token()) {
  return request(app).get('/internal/campus-agent/personal' + path).set('X-Campus-Agent-Assertion', assertion);
}

test('个人查询拒绝浏览器令牌、缺失/过期/错误用途或无期限的内部凭证', async () => {
  const { app, query } = appFor();
  expect((await request(app).get('/internal/campus-agent/personal/todos').set('Authorization', 'Bearer user-token')).status).toBe(401);
  for (const value of ['bad', token('7', { exp: nowSeconds - 1 }), token('7', { aud: 'campus-copilot' }),
    token('7', { iss: 'xmumdorm' }), token('7', { exp: undefined }), token('7', { exp: nowSeconds + 3600 }), token('07')]) {
    expect((await get(app, '/todos', value)).status).toBe(401);
  }
  expect(query).not.toHaveBeenCalled();
});

test('身份只由有效断言确定，不能通过查询参数改为其他账号', async () => {
  const { app, personal } = appFor();
  const first = await get(app, '/schedule?when=today', token('7'));
  const second = await get(app, '/schedule?when=today', token('8'));
  expect(first.body.data.classes[0].courseName).toBe('Only user 7');
  expect(second.body.data.classes[0].courseName).toBe('Only user 8');
  expect(first.headers['cache-control']).toContain('no-store');
  expect((await get(app, '/todos?user_id=8')).status).toBe(400);
  expect((await get(app, '/schedule?when=today&when=tomorrow')).status).toBe(400);
  expect(personal.todos).not.toHaveBeenCalled();
  expect((await request(app).post('/internal/campus-agent/personal/todos').set('X-Campus-Agent-Assertion', token())).status).toBe(404);
});

test('注销状态与查询失败都拒绝读取，不泄漏数据库错误', async () => {
  expect((await get(appFor({ status: 'deactivated' }).app, '/todos')).status).toBe(403);
  const { app } = appFor({ queryImpl: jest.fn(async () => { throw new Error('mysql://private:secret@db'); }) });
  const response = await get(app, '/todos');
  expect(response.status).toBe(503);
  expect(response.text).not.toMatch(/private|secret/);
});

test('学校时区周次由日历计算，今天/下周一的 SQL 均绑定当前用户', async () => {
  const query = jest.fn(async sql => sql.includes('COUNT(*)') ? [{ count: 2 }] : [{ courseName: 'Math', weekday: 6 }]);
  const data = createPersonalData({ query, now: () => instant });
  const today = await data.schedule(7, { when: 'today' });
  expect(today).toMatchObject({ date: '2026-10-24', week: 4, weekday: 6, status: 'ok', timeZone: 'Asia/Kuala_Lumpur' });
  expect(query.mock.calls[1][1]).toEqual([7, 4, 4, 6]);
  query.mockClear();
  const nextMonday = await data.schedule(8, { when: 'next_week', weekday: '1' });
  expect(nextMonday).toMatchObject({ week: 5, startDate: '2026-10-26', weekday: 1 });
  expect(query.mock.calls[1][1]).toEqual([8, 5, 5, 1]);
  for (const [sql] of query.mock.calls) expect(sql).toMatch(/^SELECT\b/);
});

test('没有导入、当日没课、日期超出覆盖范围分别返回不同状态', async () => {
  const notImported = createPersonalData({ query: async () => [{ count: 0 }], now: () => instant });
  expect((await notImported.schedule(7)).status).toBe('not_imported');
  const empty = createPersonalData({ query: async sql => sql.includes('COUNT(*)') ? [{ count: 1 }] : [], now: () => instant });
  expect((await empty.schedule(7)).status).toBe('no_classes');
  expect((await empty.schedule(7, { when: 'date', date: '2027-05-01' })).status).toBe('outside_semester');
  await expect(empty.schedule(7, { when: 'date', date: '2026-02-31' })).rejects.toHaveProperty('status', 400);
  await expect(empty.schedule(7, { when: 'week', week: '60' })).rejects.toHaveProperty('status', 400);
});

test('待办按截止日期和完成状态参数化过滤，分页不把结果误称全部', async () => {
  const query = jest.fn(async sql => sql.includes('COUNT(*)') ? [{ total: 21 }] : [{ id: 9, title: 'Task', completed: 0 }]);
  const data = createPersonalData({ query, now: () => instant });
  const page = await data.todos(7, { when: 'tomorrow', status: 'active' });
  expect(page).toMatchObject({ date: '2026-10-25', total: 21, hasMore: true, pageSize: 20 });
  expect(page.items[0].completed).toBe(false);
  expect(query.mock.calls[0][1]).toEqual([7, '2026-10-25', 0]);
  expect(query.mock.calls[1][0]).toContain('WHERE user_id = ?');
  expect(query.mock.calls[1][0]).not.toMatch(/description|UPDATE|INSERT|DELETE/);
  query.mockClear();
  await data.todos(8, { when: 'overdue', page: '2' });
  expect(query.mock.calls[1][1]).toEqual([8, '2026-10-24', 0]);
  expect(query.mock.calls[1][0]).toContain('OFFSET 20');
  await expect(data.todos(7, { when: 'date', date: 'bad-date' })).rejects.toHaveProperty('status', 400);
});

test('假期直接复用共享模块，学校时区计算倒计时，本学期含跨年元旦', () => {
  const holidays = createHolidayData({ now: () => instant });
  expect(holidays({ when: 'next' })).toMatchObject({ today: '2026-10-24', status: 'ok', items: [
    { id: 'deepavali-2026', start: '2026-11-08', end: '2026-11-09', daysUntil: 15, durationDays: 2, phase: 'upcoming' },
  ] });
  const term = holidays({ when: 'this_semester' });
  expect(term.start).toBe('2026-09-28');
  expect(term.end).toBe('2027-01-03');
  expect(term.items.map(item => item.id)).toEqual(['deepavali-2026', 'selangor-sultan-2026', 'christmas-2026', 'new-year-2027']);
  expect(holidays({ when: 'year', year: '2027', name: 'Christmas' }).items[0].start).toBe('2027-12-25');
  const midnight = createHolidayData({ now: () => new Date('2026-11-07T16:01:00Z') });
  expect(midnight({ when: 'today' }).items[0]).toMatchObject({ id: 'deepavali-2026', phase: 'ongoing', daysUntil: 0 });
});

test('同日假期和重叠假期均保留，不把未收录当成无假期', () => {
  const sameDay = createHolidayData({ now: () => new Date('2028-02-12T12:00:00Z') });
  expect(sameDay({ when: 'next' }).items.map(item => item.id).sort()).toEqual(['nuzul-al-quran-2028', 'thaipusam-2028']);
  const ongoing = createHolidayData({ now: () => new Date('2027-06-07T03:00:00Z') });
  expect(ongoing({ when: 'next' }).items.map(item => item.id).sort()).toEqual(['agong-birthday', 'awal-muharram']);
  const holidays = createHolidayData({ now: () => instant });
  expect(holidays({ when: 'year', year: '2030' })).toMatchObject({ status: 'not_recorded', items: [], recordedOnly: true });
  expect(holidays({ when: 'tomorrow' }).status).toBe('no_record');
  expect(ongoing({ when: 'this_semester' }).status).toBe('outside_semester');
  for (const args of [{ when: 'date', date: '2026-02-31' }, { when: 'range', start: '2026-12-31', end: '2026-01-01' },
    { when: 'year', year: '2027abc' }, { when: 'next', year: '2027' }]) expect(() => holidays(args)).toThrow();
});

test('假期通过现有受保护的只读回查接口，不接受用户编号或未知参数', async () => {
  const { app } = appFor();
  const response = await get(app, '/holidays?when=next');
  expect(response.status).toBe(200);
  expect(response.body.data.items[0].id).toBe('deepavali-2026');
  expect((await get(app, '/holidays?when=next&user_id=8')).status).toBe(400);
  expect((await get(app, '/holidays?when=next&when=today')).status).toBe(400);
  expect((await request(app).get('/internal/campus-agent/personal/holidays')).status).toBe(401);
  const shifted = appFor({ calendarNow: () => new Date('2028-02-12T12:00:00Z') });
  const laterCalendar = await get(shifted.app, '/holidays?when=next');
  expect(laterCalendar.status).toBe(200);
  expect(laterCalendar.body.data.items).toHaveLength(2);
  expect(laterCalendar.body.data.today).toBe('2028-02-12');
});
