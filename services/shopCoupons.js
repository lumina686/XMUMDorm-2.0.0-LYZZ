const crypto = require('crypto');
const { query, pool } = require('../database');
const sanitize = require('sanitize-html');
const { couponMode, checkCouponSchema } = require('./shopCouponSchema');
const {inlineLimit,inlineOffset}=require('../utils/sqlLimit');
function fail(message, code, status = 409) { throw Object.assign(new Error(message), { status, publicCode: code }); }
function enabled() { return ['auto','on'].includes(couponMode()); }
async function ready() {
  if (!enabled()) return false;
  try { return (await checkCouponSchema(query)).ready; }
  catch { return false; }
}

async function requireReady() {
  if (!await ready()) fail('优惠券暂未开放，请稍后重试 / Coupons are unavailable', 'COUPONS_UNAVAILABLE', 503);
}
function normalizeCode(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') fail('优惠码格式无效 / Invalid coupon code', 'INVALID_INPUT', 400);
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,24}$/.test(code)) fail('请输入8–24位字母数字优惠码 / Enter an 8–24 character code', 'INVALID_INPUT', 400);
  return code;
}
function key(value) {
  if (typeof value !== 'string' || !/^[\w-]{16,80}$/.test(value)) fail('缺少有效请求标识 / Invalid request key', 'INVALID_INPUT', 400);
  return value;
}
function number(value, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('金额或次数无效 / Invalid amount or limit', 'INVALID_INPUT', 400);
  return value;
}
function text(value) {
  const result = typeof value === 'string' ? sanitize(value, {allowedTags:[],allowedAttributes:{}}).trim() : '';
  if (!result || result.length > 120) fail('请填写中英文名称 / Both names are required', 'INVALID_INPUT', 400);
  return result;
}
function datetime(value) {
  if (typeof value !== 'string') fail('时间无效 / Invalid time', 'INVALID_INPUT', 400);
  const result = value.replace('T', ' ').replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/, '$1:00');
  const date = new Date(result.replace(' ', 'T') + 'Z');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(result) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,19).replace('T',' ') !== result)
    fail('时间无效 / Invalid time', 'INVALID_INPUT', 400);
  return result;
}
function rule(body) {
  const row = {name_zh:text(body.name_zh),name_en:text(body.name_en),discount_cents:number(body.discount_cents,1),
    min_subtotal_cents:number(body.min_subtotal_cents),starts_at:datetime(body.starts_at),ends_at:datetime(body.ends_at),total_limit:number(body.total_limit,1,1000000)};
  if (row.starts_at >= row.ends_at) fail('结束时间必须晚于开始时间 / Invalid date range', 'INVALID_INPUT', 400);
  return row;
}
async function transaction(work) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
const select = `SELECT *,CAST(starts_at AS CHAR) AS starts_at,CAST(ends_at AS CHAR) AS ends_at FROM shop_coupons`;
async function create(merchantId, userId, body, requestKey) {
  await requireReady();
  const value = rule(body), createKey = key(requestKey);
  const hash = crypto.createHash('sha256').update(JSON.stringify({merchantId,...value})).digest('hex');
  return transaction(async conn => {
    const [users] = await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
    if (!users.length) fail('账号不可用 / Account unavailable','FORBIDDEN',403);
    const [old] = await conn.execute(`${select} WHERE created_by=? AND create_key=?`,[userId,createKey]);
    if (old[0]) {
      if (old[0].create_hash !== hash || old[0].merchant_id !== merchantId) fail('请求标识已用于其他内容 / Request key reused','IDEMPOTENCY_CONFLICT');
      return old[0];
    }
    const code = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g,'A').toUpperCase().slice(0,12);
    const [insert] = await conn.execute(`INSERT INTO shop_coupons
      (merchant_id,code,name_zh,name_en,discount_cents,min_subtotal_cents,starts_at,ends_at,total_limit,created_by,create_key,create_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[merchantId,code,...Object.values(value),userId,createKey,hash]);
    const [rows] = await conn.execute(`${select} WHERE id=?`,[insert.insertId]);
    return rows[0];
  });
}
function page(value, fallback, max) { const n = value == null ? fallback : Number(value); return number(n,1,max); }
async function list(merchantId, args) {
  await requireReady();
  const current=page(args.page,1,1000000), size=page(args.page_size,20,50);
  const rows=await query(`${select} WHERE merchant_id=? ORDER BY id DESC LIMIT ${inlineLimit(size+1,{max:51})} OFFSET ${inlineOffset((current-1)*size,{max:50000000})}`,[merchantId]);
  return {items:rows.slice(0,size),has_more:rows.length>size,page:current};
}
async function setStatus(merchantId,id,status) {
  await requireReady();
  if (!['active','disabled'].includes(status)) fail('状态无效 / Invalid status','INVALID_INPUT',400);
  return transaction(async conn=>{
    const [rows]=await conn.execute(`${select} WHERE id=? AND merchant_id=? FOR UPDATE`,[id,merchantId]);
    if(!rows[0])fail('优惠券不存在 / Coupon not found','NOT_FOUND',404);
    await conn.execute('UPDATE shop_coupons SET status=? WHERE id=?',[status,id]);
    return {...rows[0],status};
  });
}
async function redemptions(merchantId,id,args) {
  await requireReady();
  const coupons=await query('SELECT id FROM shop_coupons WHERE id=? AND merchant_id=?',[id,merchantId]);
  if(!coupons[0])fail('优惠券不存在 / Coupon not found','NOT_FOUND',404);
  const current=page(args.page,1,1000000),size=page(args.page_size,20,50);
  const rows=await query(`SELECT order_id,discount_cents,status,created_at,redeemed_at,released_at FROM shop_coupon_redemptions WHERE coupon_id=? ORDER BY id DESC LIMIT ${inlineLimit(size+1,{max:51})} OFFSET ${inlineOffset((current-1)*size,{max:50000000})}`,[id]);
  return {items:rows.slice(0,size),has_more:rows.length>size,page:current};
}
async function discount(conn,code,merchantId,userId,subtotal,now) {
  const [rows]=await conn.execute(`${select} WHERE code=? FOR UPDATE`,[code]);
  const row=rows[0];
  if(!row||row.merchant_id!==merchantId||row.status!=='active'||now<row.starts_at||now>=row.ends_at||row.reserved_count+row.redeemed_count>=row.total_limit)
    fail('优惠码不可用 / Coupon unavailable','COUPON_UNAVAILABLE');
  const [used]=await conn.execute("SELECT id FROM shop_coupon_redemptions WHERE coupon_id=? AND user_id=? AND status IN ('reserved','redeemed') FOR UPDATE",[row.id,userId]);
  if(used.length>=row.per_user_limit)fail('优惠码不可用 / Coupon unavailable','COUPON_UNAVAILABLE');
  if(subtotal<row.min_subtotal_cents)fail('未达到优惠券最低消费 / Minimum spend not met','COUPON_MIN_NOT_MET');
  if(subtotal<=row.discount_cents)fail('优惠后应付金额须至少RM 0.01 / Payable must be at least RM 0.01','COUPON_PAYABLE_TOO_LOW');
  return {id:row.id,code:row.code,name_zh:row.name_zh,name_en:row.name_en,discount_cents:row.discount_cents,min_subtotal_cents:row.min_subtotal_cents,starts_at:row.starts_at,ends_at:row.ends_at};
}
async function reserve(conn,coupon,orderId,userId) {
  await conn.execute("INSERT INTO shop_coupon_redemptions (coupon_id,order_id,user_id,discount_cents,status) VALUES (?,?,?,?,'reserved')",[coupon.id,orderId,userId,coupon.discount_cents]);
  await conn.execute('UPDATE shop_coupons SET reserved_count=reserved_count+1 WHERE id=?',[coupon.id]);
}
async function transition(conn,order,next) {
  if(!order.coupon_json || !['confirmed','cancelled'].includes(next))return;
  const id=order.coupon_json.id;
  await conn.execute('SELECT id FROM shop_coupons WHERE id=? FOR UPDATE',[id]);
  const [rows]=await conn.execute('SELECT id,status FROM shop_coupon_redemptions WHERE order_id=? AND coupon_id=? FOR UPDATE',[order.id,id]);
  if(!rows[0])fail('优惠记录异常，请联系管理员 / Coupon record missing','COUPON_RECORD_MISSING',503);
  if(rows[0].status!=='reserved')return;
  const redeem=next==='confirmed';
  await conn.execute(`UPDATE shop_coupon_redemptions SET status=?,${redeem?'redeemed_at':'released_at'}=NOW() WHERE id=?`,[redeem?'redeemed':'released',rows[0].id]);
  const [result]=await conn.execute(`UPDATE shop_coupons SET reserved_count=reserved_count-1${redeem?',redeemed_count=redeemed_count+1':''} WHERE id=? AND reserved_count>0`,[id]);
  if(result.affectedRows!==1)fail('优惠计数异常，请联系管理员 / Coupon count mismatch','COUPON_COUNT_MISMATCH',503);
}
module.exports={enabled,ready,requireReady,normalizeCode,rule,key,create,list,setStatus,redemptions,discount,reserve,transition};
