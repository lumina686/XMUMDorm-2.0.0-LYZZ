/** Minimal read-only DTOs for the authenticated user's imported schedule and todos. */
const { resolveSemesterContext, kualaLumpurCalendarParts, addDaysYmd, parseYmd } = require('../shared/config/semesters');

function invalid() {
  const error = new Error('Invalid personal query');
  error.status = 400;
  return error;
}

function integer(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw invalid();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw invalid();
  return result;
}

function createPersonalData({ query, now = () => new Date() }) {
  function clock() {
    const instant = now();
    const local = kualaLumpurCalendarParts(instant);
    const context = resolveSemesterContext(instant);
    return { today: local.ymd, weekday: local.dayOfWeek, timeZone: 'Asia/Kuala_Lumpur',
      currentWeek: context.status === 'during' ? context.week : null,
      semesterStatus: context.status, semester: context.semester, totalWeeks: context.totalWeeks };
  }

  async function schedule(userId, options = {}) {
    const context = clock();
    const when = options.when || 'today';
    if (!['today', 'tomorrow', 'this_week', 'next_week', 'date', 'week'].includes(when)) throw invalid();
    const weekday = integer(options.weekday, 0, 0, 7);
    const explicitWeek = integer(options.week, 0, 0, 60);
    if ((when !== 'week' && explicitWeek) || (when !== 'date' && options.date)) throw invalid();
    if (['today', 'tomorrow', 'date'].includes(when) && weekday) throw invalid();
    const date = when === 'date' ? options.date : when === 'today' ? context.today
      : when === 'tomorrow' ? addDaysYmd(context.today, 1) : null;
    if (when === 'date' && (!date || !parseYmd(date))) throw invalid();
    let week;
    let day = weekday;
    if (date) {
      const target = resolveSemesterContext(new Date(date + 'T12:00:00+08:00'));
      if (target.status !== 'during' || target.semester?.id !== context.semester?.id) {
        return { ...context, status: 'outside_semester', date, classes: [],
          note: '目标日期不在当前课表日历覆盖范围，不能据此判断有没有课。' };
      }
      week = target.week;
      day = kualaLumpurCalendarParts(new Date(date + 'T12:00:00+08:00')).dayOfWeek;
    } else if (when === 'week') {
      if (!explicitWeek || explicitWeek > context.totalWeeks) throw invalid();
      week = explicitWeek;
    } else {
      if (!context.currentWeek) return { ...context, status: 'outside_semester', classes: [] };
      week = context.currentWeek + (when === 'next_week' ? 1 : 0);
      if (week > context.totalWeeks) return { ...context, status: 'outside_semester', classes: [] };
    }
    const counts = await query('SELECT COUNT(*) AS count FROM timetable_courses WHERE user_id = ?', [userId]);
    if (!Number(counts[0]?.count)) return { ...context, status: 'not_imported', week, date, classes: [] };
    const params = [userId, week, week];
    let dayFilter = '';
    if (day) { dayFilter = ' AND m.day_of_week = ?'; params.push(day); }
    const rows = await query(
      `SELECT c.course_code AS courseCode, c.course_name AS courseName, c.lecturer,
              m.day_of_week AS weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
              TIME_FORMAT(m.end_time, '%H:%i') AS endTime, m.venue
         FROM timetable_courses c JOIN timetable_meetings m ON m.course_id = c.id
        WHERE c.user_id = ? AND (m.week_start IS NULL OR m.week_start <= ?)
          AND (m.week_end IS NULL OR m.week_end >= ?)${dayFilter}
        ORDER BY m.day_of_week ASC, m.start_time ASC LIMIT 201`, params);
    const monday = context.semester ? addDaysYmd(context.semester.startDate, (week - 1) * 7) : null;
    return { ...context, status: rows.length ? 'ok' : 'no_classes', week, date,
      startDate: monday, endDate: monday ? addDaysYmd(monday, 6) : null,
      weekday: day || null, classes: rows.slice(0, 200), hasMore: rows.length > 200,
      note: '仅查询你最近导入的网站课表；这些导入记录未单独绑定学期，周次按网站当前学期日历计算。' };
  }

  async function todos(userId, options = {}) {
    const context = clock();
    const when = options.when || 'all';
    const status = options.status || 'active';
    if (!['all', 'today', 'tomorrow', 'date', 'overdue'].includes(when)
        || !['active', 'completed', 'all'].includes(status)) throw invalid();
    if (when !== 'date' && options.date) throw invalid();
    const date = when === 'date' ? options.date : when === 'today' ? context.today
      : when === 'tomorrow' ? addDaysYmd(context.today, 1) : null;
    if (when === 'date' && (!date || !parseYmd(date))) throw invalid();
    const page = integer(options.page, 1, 1, 100);
    const pageSize = 20;
    let where = 'WHERE user_id = ?';
    const params = [userId];
    if (date) { where += ' AND due_date = ?'; params.push(date); }
    if (when === 'overdue') { where += ' AND due_date < ?'; params.push(context.today); }
    if (status !== 'all') { where += ' AND is_completed = ?'; params.push(status === 'completed' ? 1 : 0); }
    const counts = await query(`SELECT COUNT(*) AS total FROM todos ${where}`, params);
    const total = Number(counts[0]?.total || 0);
    const rows = await query(
      `SELECT id, title, priority, DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate,
              TIME_FORMAT(due_time, '%H:%i') AS dueTime, is_completed AS completed, list_type AS listType
         FROM todos ${where}
        ORDER BY is_completed ASC, due_date IS NULL ASC, due_date ASC,
                 due_time IS NULL ASC, due_time ASC, priority DESC, created_at DESC
        LIMIT 20 OFFSET ${(page - 1) * pageSize}`, params);
    return { today: context.today, timeZone: context.timeZone, status: 'ok', when, filterStatus: status,
      date, page, pageSize, total, hasMore: page * pageSize < total,
      items: rows.map(row => ({ ...row, completed: Boolean(row.completed) })),
      note: date ? '按截止日期筛选；未设置日期的待办不计入当天。' : '未设置截止日期的事项也包含在列表中。' };
  }
  return { clock, schedule, todos };
}

module.exports = { createPersonalData };
