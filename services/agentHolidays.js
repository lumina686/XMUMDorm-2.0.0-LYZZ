/** Read the exact same public-holiday records as the Web/App Holidays module. */
const { ALL_HOLIDAYS } = require('../shared/config/holidays');
const { resolveSemesterContext, kualaLumpurCalendarParts, addDaysYmd, parseYmd, ymdToDayNumber } = require('../shared/config/semesters');

function invalid() { const error = new Error('Invalid holiday query'); error.status = 400; return error; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseYmd(value); }

function createHolidayData({ now = () => new Date() } = {}) {
  return function holidays(options = {}) {
    const instant = now();
    const today = kualaLumpurCalendarParts(instant).ymd;
    const todayNumber = ymdToDayNumber(today);
    const when = options.when || 'upcoming';
    if (!['next', 'upcoming', 'this_semester', 'this_year', 'year', 'today', 'tomorrow', 'date', 'range'].includes(when)) throw invalid();
    const name = (options.name || '').trim().toLocaleLowerCase();
    if (name.length > 80) throw invalid();
    if ((when !== 'year' && options.year) || (when !== 'date' && options.date)
        || (when !== 'range' && (options.start || options.end))) throw invalid();
    let start = null;
    let end = null;
    let semester = null;
    const years = [...new Set(ALL_HOLIDAYS.map(item => Number(item.start.slice(0, 4))))].sort();
    const base = { today, timeZone: 'Asia/Kuala_Lumpur', when, supportedYears: years, recordedOnly: true };
    if (when === 'year' || when === 'this_year') {
      const year = when === 'this_year' ? Number(today.slice(0, 4)) : Number(options.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100 || (when === 'year' && !/^\d{4}$/.test(String(options.year)))) throw invalid();
      start = `${year}-01-01`; end = `${year}-12-31`;
      if (!years.includes(year)) return { ...base, status: 'not_recorded', start, end, items: [] };
    } else if (when === 'this_semester') {
      const context = resolveSemesterContext(instant);
      if (context.status !== 'during') return { ...base, status: 'outside_semester', items: [] };
      start = context.startDate; end = context.endDate; semester = context.semester;
    } else if (['today', 'tomorrow', 'date'].includes(when)) {
      start = when === 'today' ? today : when === 'tomorrow' ? addDaysYmd(today, 1) : options.date;
      if (!validDate(start)) throw invalid();
      end = start;
    } else if (when === 'range') {
      start = options.start; end = options.end;
      if (!validDate(start) || !validDate(end) || start > end) throw invalid();
    } else {
      start = today;
    }
    let items = ALL_HOLIDAYS.filter(item => (!start || item.end >= start) && (!end || item.start <= end)
      && (!name || [item.nameZh, item.nameEn, item.id].some(value => value.toLocaleLowerCase().includes(name))))
      .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    if (when === 'next' && items.length) {
      // Keep simultaneous holidays rather than dropping one with the same start date.
      const first = items[0].start < today ? today : items[0].start;
      items = items.filter(item => item.start <= first);
    }
    return { ...base, status: items.length ? 'ok' : 'no_record', start, end, semester,
      items: items.map(item => ({ ...item,
        daysUntil: Math.max(0, ymdToDayNumber(item.start) - todayNumber),
        durationDays: ymdToDayNumber(item.end) - ymdToDayNumber(item.start) + 1,
        phase: item.end < today ? 'past' : item.start > today ? 'upcoming' : 'ongoing' })),
      note: '仅为放假日模块已收录的公共假期，不代表完整校历；不含寒暑假、考试安排、调课或课程取消。没有记录不代表当天一定上课。' };
  };
}

module.exports = { createHolidayData };
