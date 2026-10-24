jest.mock('../../database',()=>({query:jest.fn(),pool:{getConnection:jest.fn()}}));
const {query,pool}=require('../../database');
const c=require('../../services/shopCoupons');
const valid={name_zh:'演示券',name_en:'Demo coupon',discount_cents:500,min_subtotal_cents:1500,starts_at:'2026-01-01T00:00',ends_at:'2099-01-01T00:00',total_limit:10};
const coupon={id:1,merchant_id:2,code:'DEMOCODE1234',status:'active',starts_at:'2026-01-01 00:00:00',ends_at:'2099-01-01 00:00:00',discount_cents:500,min_subtotal_cents:1500,total_limit:2,reserved_count:0,redeemed_count:0,per_user_limit:1};
const {REQUIRED}=require('../../services/shopCouponSchema');
const schemaColumns=Object.entries(REQUIRED).flatMap(([table,cols])=>cols.map(col=>({TABLE_NAME:table,COLUMN_NAME:col})));
const schemaIndexes=[{TABLE_NAME:'shop_coupons',INDEX_NAME:'code',COLUMN_NAME:'code'},{TABLE_NAME:'shop_coupons',INDEX_NAME:'create',COLUMN_NAME:'created_by'},{TABLE_NAME:'shop_coupons',INDEX_NAME:'create',COLUMN_NAME:'create_key'},{TABLE_NAME:'shop_coupon_redemptions',INDEX_NAME:'order',COLUMN_NAME:'order_id'}];
const originalFlag=process.env.SHOP_COUPONS_ENABLED;
beforeEach(()=>{jest.clearAllMocks();process.env.SHOP_COUPONS_ENABLED='1';query.mockImplementation(async sql=>sql.includes('STATISTICS')?schemaIndexes:schemaColumns);});
afterAll(()=>{if(originalFlag==null)delete process.env.SHOP_COUPONS_ENABLED;else process.env.SHOP_COUPONS_ENABLED=originalFlag;});
test('normalize code without accepting punctuation or non-ASCII letters',()=>{
  expect(c.normalizeCode(' democode1234 ')).toBe('DEMOCODE1234');
  for(const input of ['short','<script>x</script>','优惠券123456',{},'DEMO-123456'])expect(()=>c.normalizeCode(input)).toThrow();
});
test('validate integer cents, real calendar dates, and immutable rule inputs',()=>{
  expect(c.rule(valid)).toMatchObject({discount_cents:500,starts_at:'2026-01-01 00:00:00'});
  for(const change of [{discount_cents:0},{discount_cents:1.1},{total_limit:0},{starts_at:'2026-02-30T00:00'},{ends_at:'2025-01-01T00:00'}])expect(()=>c.rule({...valid,...change})).toThrow();
});
test('disabled flag does not query missing coupon tables',async()=>{
  process.env.SHOP_COUPONS_ENABLED='0';expect(await c.ready()).toBe(false);expect(query).not.toHaveBeenCalled();
  await expect(c.requireReady()).rejects.toMatchObject({status:503});
});
test('incomplete migration makes coupons unavailable rather than breaking regular orders',async()=>{
  query.mockResolvedValue([]);expect(await c.ready()).toBe(false);
});
test('known example 2000 cents less 500 returns the server configured discount',async()=>{
  const conn={execute:jest.fn().mockResolvedValueOnce([[coupon]]).mockResolvedValueOnce([[]])};
  expect(await c.discount(conn,'DEMOCODE1234',2,4,2000,'2026-10-19 10:00:00')).toMatchObject({discount_cents:500});
});
test.each([{merchant_id:8},{status:'disabled'},{reserved_count:2},{ends_at:'2026-10-19 10:00:00'},{starts_at:'2026-10-19 10:00:01'}])('reject unusable coupon %j',async change=>{
  const conn={execute:jest.fn().mockResolvedValueOnce([[{...coupon,...change}]])};
  await expect(c.discount(conn,'DEMOCODE1234',2,4,2000,'2026-10-19 10:00:00')).rejects.toMatchObject({publicCode:'COUPON_UNAVAILABLE'});
});
test.each([[1400,'COUPON_MIN_NOT_MET'],[500,'COUPON_PAYABLE_TOO_LOW']])('reject invalid subtotal %s',async(amount,code)=>{
  const conn={execute:jest.fn().mockResolvedValueOnce([[{...coupon,min_subtotal_cents:amount===500?0:1500}]]).mockResolvedValueOnce([[]])};
  await expect(c.discount(conn,'DEMOCODE1234',2,4,amount,'2026-10-19 10:00:00')).rejects.toMatchObject({publicCode:code});
});
test('per-account limit uses a locking read and does not accept a used code',async()=>{
  const conn={execute:jest.fn().mockResolvedValueOnce([[coupon]]).mockResolvedValueOnce([[{id:1}]])};
  await expect(c.discount(conn,'DEMOCODE1234',2,4,2000,'2026-10-19 10:00:00')).rejects.toMatchObject({status:409});
  expect(conn.execute.mock.calls[1][0]).toContain('FOR UPDATE');
});
test('missing redemption rolls back via caller rather than silently accepting state',async()=>{
  const conn={execute:jest.fn().mockResolvedValueOnce([[{id:1}]]).mockResolvedValueOnce([[]])};
  await expect(c.transition(conn,{id:4,coupon_json:{id:1}},'confirmed')).rejects.toMatchObject({status:503});
});
test('redeemed coupon is not released after a later cancellation',async()=>{
  const conn={execute:jest.fn().mockResolvedValueOnce([[{id:1}]]).mockResolvedValueOnce([[{id:1,status:'redeemed'}]])};
  await c.transition(conn,{id:4,coupon_json:{id:1}},'cancelled');expect(conn.execute).toHaveBeenCalledTimes(2);
});
test('cross-store status update is rejected',async()=>{
  const conn={beginTransaction:jest.fn(),rollback:jest.fn(),release:jest.fn(),execute:jest.fn().mockResolvedValue([[]])};pool.getConnection.mockResolvedValue(conn);
  await expect(c.setStatus(2,1,'disabled')).rejects.toMatchObject({status:404});expect(conn.rollback).toHaveBeenCalled();
});

test.each([undefined,'','auto',' AUTO ','1'])('complete schema enables coupons in mode %s without mandatory platform setup',async flag=>{
 if(flag===undefined)delete process.env.SHOP_COUPONS_ENABLED;else process.env.SHOP_COUPONS_ENABLED=flag;expect(await c.ready()).toBe(true);for(const [sql]of query.mock.calls)expect(sql).toMatch(/^SELECT /);
});
test.each(['0',' 0 ','false','typo'])('explicit off or invalid configuration %s never queries coupon metadata',async flag=>{process.env.SHOP_COUPONS_ENABLED=flag;expect(await c.ready()).toBe(false);expect(query).not.toHaveBeenCalled();});
test.each(schemaColumns.map(r=>[r.TABLE_NAME+'.'+r.COLUMN_NAME]))('auto refuses partial structure missing %s',async missing=>{delete process.env.SHOP_COUPONS_ENABLED;query.mockImplementation(async sql=>sql.includes('STATISTICS')?schemaIndexes:schemaColumns.filter(r=>r.TABLE_NAME+'.'+r.COLUMN_NAME!==missing));expect(await c.ready()).toBe(false);});
test.each(['code','create','order'])('auto refuses missing unique %s constraint',async missing=>{delete process.env.SHOP_COUPONS_ENABLED;query.mockImplementation(async sql=>sql.includes('STATISTICS')?schemaIndexes.filter(r=>r.INDEX_NAME!==missing):schemaColumns);expect(await c.ready()).toBe(false);});
test('database metadata errors fail closed and do not leak details',async()=>{delete process.env.SHOP_COUPONS_ENABLED;query.mockRejectedValue(Error('private database detail'));expect(await c.ready()).toBe(false);await expect(c.requireReady()).rejects.toMatchObject({status:503,publicCode:'COUPONS_UNAVAILABLE'});});
test('migration becomes available without process restart or cached missing state',async()=>{delete process.env.SHOP_COUPONS_ENABLED;query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);expect(await c.ready()).toBe(false);expect(await c.ready()).toBe(true);});
