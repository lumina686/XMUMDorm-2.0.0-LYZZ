// Isolated synthetic data for real-model personal-tool verification. No dotenv or MySQL access.
const express = require('express');
const databasePath = require.resolve('../database');
async function query(sql, params) {
  if (!/^SELECT\b/.test(sql.trim())) throw new Error('Only SELECT allowed');
  const user = Number(params[0]);
  if (sql.includes('FROM users')) return [7, 8].includes(user) ? [{ status: 'active' }] : [];
  if (sql.includes('COUNT(*)') && sql.includes('timetable_courses')) return [{ count: user === 7 ? 1 : 0 }];
  if (sql.includes('timetable_meetings')) return [{ courseCode: 'TEST101', courseName: 'Zeta测试课程', lecturer: '测试教师', weekday: 1,
    startTime: '09:15', endTime: '10:45', venue: 'TEST-B204' }];
  if (sql.includes('COUNT(*)') && sql.includes('FROM todos')) return [{ total: user === 7 ? 1 : 0 }];
  if (sql.includes('FROM todos')) return user === 7 ? [{ id: 17, title: '整理Zeta测试笔记', priority: 2,
    dueDate: '2026-10-26', dueTime: '18:30', completed: 0, listType: 'course' }] : [];
  throw new Error('Unexpected test query');
}
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { query } };
const { createPersonalRouter } = require('../routes/agentPersonal');
const app = express();
app.use('/internal/campus-agent/personal', createPersonalRouter({ queryImpl: query,
  calendarNow: () => process.env.CAMPUS_TEST_NOW ? new Date(process.env.CAMPUS_TEST_NOW) : new Date() }));
app.listen(18768, '127.0.0.1');
