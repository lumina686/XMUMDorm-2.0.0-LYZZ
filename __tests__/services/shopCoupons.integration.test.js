// Opt-in: loopback only, dedicated throwaway schema. Never reads .env or DATABASE_URL.
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise');
const schema=process.env.SHOP_COUPON_TEST_DATABASE;
if(schema&&!/^coupon_test_[a-z0-9_]+$/.test(schema))throw Error('DEDICATED_COUPON_TEST_SCHEMA_REQUIRED');
const integration=schema?describe:describe.skip;
integration('coupon transactions against isolated MySQL',()=>{
  let pool,s,c,serial=100;
  const query=async(sql,args)=>{const [rows]=await pool.execute(sql,args);return rows;};
  const flag=process.env.SHOP_COUPONS_ENABLED;
  beforeAll(async()=>{
    const conn=await mysql.createConnection({host:'127.0.0.1',port:3308,user:'root',password:'',multipleStatements:true,dateStrings:true});
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${schema}\``);await conn.query(`USE \`${schema}\``);
    await conn.query("CREATE TABLE IF NOT EXISTS users(id INT PRIMARY KEY,status VARCHAR(30) NOT NULL DEFAULT 'active',role VARCHAR(30) NOT NULL DEFAULT 'student') ENGINE=InnoDB");
    for(const file of ['071_campus_shop.sql','072_shop_merchants.sql','073_daily_delivery_schedule.sql','074_special_date_delivery_slots.sql','075_shop_store_soft_delete.sql','077_shop_coupons.sql'])
      await conn.query(fs.readFileSync(path.join(__dirname,'../../migrations',file),'utf8'));
    await require('../../scripts/run-migration-077-shop-coupons').apply(conn);
    await conn.end();
    pool=mysql.createPool({host:'127.0.0.1',port:3308,user:'root',password:'',database:schema,dateStrings:true,connectionLimit:8});
    serial=Math.max(100,Number((await query('SELECT MAX(id) AS max_id FROM users'))[0].max_id||0));
    jest.resetModules();jest.doMock('../../database',()=>({query,pool}));
    s=require('../../services/shop');c=require('../../services/shopCoupons');process.env.SHOP_COUPONS_ENABLED='1';
  },30000);
  afterAll(async()=>{if(pool)await pool.end();if(flag==null)delete process.env.SHOP_COUPONS_ENABLED;else process.env.SHOP_COUPONS_ENABLED=flag;});
  async function fixture(limit=1) {
    const owner=++serial,u1=++serial,u2=++serial;
    await query("INSERT INTO users(id,role) VALUES (?,'merchant'),(?,'student'),(?,'student')",[owner,u1,u2]);
    const merchant=await query('INSERT INTO shop_merchants(slug,name_zh,name_en) VALUES (?,?,?)',['coupon-fixture-'+owner,'演示商户','Demo merchant']);
    const mid=merchant.insertId;
    await query('INSERT INTO shop_merchant_members VALUES (?,?)',[mid,owner]);
    const methods=[{id:'qr',name_zh:'演示收款','name_en':'Demo QR',qr_url:'/demo.png'}];
    await query("INSERT INTO shop_settings(id,delivery_notice_zh,delivery_notice_en,payment_zh,payment_en,payment_methods) VALUES (?,'','','','',?)",[mid,JSON.stringify(methods)]);
    const now=s.campusNow().slice(0,10);
    const slot=await query("INSERT INTO shop_slots(merchant_id,delivery_date,label_zh,label_en,cutoff_at,delivery_start,delivery_end,is_special,capacity) VALUES (?,?,'演示 00:00-23:59','Demo 00:00-23:59',?,'00:00','23:59',1,100000)",[mid,now,now+' 00:00:00']);
    const product=await query("INSERT INTO shop_products(merchant_id,category,name_zh,name_en,spec_zh,spec_en,description_zh,description_en,image_url,price_cents,stock) VALUES (?,'water','演示','Demo','','','','','/demo.png',2000,10)",[mid]);
    for(const user of [u1,u2])await query('INSERT INTO shop_cart_items(user_id,product_id,quantity) VALUES (?,?,1)',[user,product.insertId]);
    const rule={name_zh:'演示券',name_en:'Demo coupon',discount_cents:500,min_subtotal_cents:1500,starts_at:'2020-01-01T00:00',ends_at:'2099-01-01T00:00',total_limit:limit};
    const coupon=await c.create(mid,owner,rule,'fixture-create-key-'+owner);
    const body={address:{contact_name:'演示学生',contact:'demo@example.test',building:'演示楼',room:'演示房间'},slot_id:slot.insertId,payment_method:'qr',expected_total_cents:1500,coupon_code:coupon.code};
    return {owner,u1,u2,mid,productId:product.insertId,body,coupon,rule};
  }
  const counts=async id=>(await query('SELECT reserved_count,redeemed_count FROM shop_coupons WHERE id=?',[id]))[0];
  test('migration repeat leaves required columns and existing data intact',async()=>{expect(await c.ready()).toBe(true);});
  test('quote is read-only, checkout snapshots amount and same-key replay never deducts twice',async()=>{
    const f=await fixture();
    const quote=await s.checkout(f.u1,{slot_id:f.body.slot_id,payment_method:'qr',coupon_code:f.coupon.code},'quote-integration-key',f.mid,{quote:true});
    expect(quote).toMatchObject({subtotal_cents:2000,discount_cents:500,total_cents:1500});expect(await counts(f.coupon.id)).toEqual({reserved_count:0,redeemed_count:0});
    const first=await s.checkout(f.u1,f.body,'checkout-replay-key-'+f.u1,f.mid);
    expect(first.order).toMatchObject({subtotal_cents:2000,discount_cents:500,total_cents:1500,coupon_json:{code:f.coupon.code}});
    await c.setStatus(f.mid,f.coupon.id,'disabled');process.env.SHOP_COUPONS_ENABLED='0';
    try{const replay=await s.checkout(f.u1,f.body,'checkout-replay-key-'+f.u1,f.mid);expect(replay.replayed).toBe(true);expect(replay.order.id).toBe(first.order.id);}finally{process.env.SHOP_COUPONS_ENABLED='1';}
    expect(await counts(f.coupon.id)).toEqual({reserved_count:1,redeemed_count:0});
    expect((await query('SELECT stock FROM shop_products WHERE id=?',[f.productId]))[0].stock).toBe(9);
  });
  test('only one of two students can reserve the final use; loser retains cart and stock',async()=>{
    const f=await fixture();
    const outcomes=await Promise.allSettled([s.checkout(f.u1,f.body,'last-use-key-'+f.u1,f.mid),s.checkout(f.u2,f.body,'last-use-key-'+f.u2,f.mid)]);
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o=>o.status==='rejected')).toHaveLength(1);
    expect(await counts(f.coupon.id)).toEqual({reserved_count:1,redeemed_count:0});
    expect((await query('SELECT stock FROM shop_products WHERE id=?',[f.productId]))[0].stock).toBe(9);
    const loser=outcomes[0].status==='rejected'?f.u1:f.u2;
    expect(await query('SELECT id FROM shop_cart_items WHERE user_id=? AND deleted_at IS NULL',[loser])).toHaveLength(1);
  });
  test('cancelling before verification releases exactly once and permits a new order',async()=>{
    const f=await fixture();const first=await s.checkout(f.u1,f.body,'cancel-reserved-key-'+f.u1,f.mid);
    await s.changeStatus(first.order.id,'cancelled',f.mid);await s.changeStatus(first.order.id,'cancelled',f.mid);
    expect(await counts(f.coupon.id)).toEqual({reserved_count:0,redeemed_count:0});
    await query('UPDATE shop_cart_items SET deleted_at=NULL WHERE user_id=?',[f.u1]);
    await expect(s.checkout(f.u1,f.body,'after-cancel-key-'+f.u1,f.mid)).resolves.toMatchObject({replayed:false});
  });
  test('payment proof is required, verification redeems once, later cancellation does not return use',async()=>{
    const f=await fixture(3);const first=await s.checkout(f.u1,f.body,'confirm-coupon-key-'+f.u1,f.mid);
    await expect(s.changeStatus(first.order.id,'confirmed',f.mid)).rejects.toMatchObject({status:409});
    await query("INSERT INTO shop_payment_proofs(order_id,content_type,image) VALUES (?,'image/png',?)",[first.order.id,Buffer.from('synthetic-test-proof')]);
    await s.changeStatus(first.order.id,'confirmed',f.mid);await s.changeStatus(first.order.id,'confirmed',f.mid);
    expect(await counts(f.coupon.id)).toEqual({reserved_count:0,redeemed_count:1});
    await s.changeStatus(first.order.id,'cancelled',f.mid);expect(await counts(f.coupon.id)).toEqual({reserved_count:0,redeemed_count:1});
  });
  test('creation retry is idempotent and a different payload with same key conflicts',async()=>{
    const f=await fixture();const second=await c.create(f.mid,f.owner,f.rule,'fixture-create-key-'+f.owner);expect(second.id).toBe(f.coupon.id);
    await expect(c.create(f.mid,f.owner,{...f.rule,discount_cents:600},'fixture-create-key-'+f.owner)).rejects.toMatchObject({status:409});
  });
  test('coupon and redemption pagination use production-compatible prepared statements',async()=>{
    const f=await fixture();
    expect((await c.list(f.mid,{page:1,page_size:1})).items).toHaveLength(1);
    const order=await s.checkout(f.u1,f.body,'usage-list-test-key-'+f.u1,f.mid);
    expect((await c.redemptions(f.mid,f.coupon.id,{page:1,page_size:1})).items[0]).toMatchObject({order_id:order.order.id,status:'reserved'});
  });
  test('no coupon and flag off still create regular orders; changed expected price rolls back',async()=>{
    const f=await fixture();
    await expect(s.checkout(f.u1,{...f.body,expected_total_cents:1},'bad-price-test-key-'+f.u1,f.mid)).rejects.toMatchObject({status:409});
    expect(await counts(f.coupon.id)).toEqual({reserved_count:0,redeemed_count:0});
    process.env.SHOP_COUPONS_ENABLED='0';
    try{const order=await s.checkout(f.u1,{...f.body,coupon_code:'',expected_total_cents:2000},'plain-order-key-'+f.u1,f.mid);expect(order.order.total_cents).toBe(2000);}finally{process.env.SHOP_COUPONS_ENABLED='1';}
  });
  test('unset flag supports issue, quote, discounted checkout, payment proof, redemption and completed delivery',async()=>{
    delete process.env.SHOP_COUPONS_ENABLED;
    try {
      expect(await c.ready()).toBe(true);const f=await fixture();
      const quote=await s.checkout(f.u1,{slot_id:f.body.slot_id,payment_method:'qr',coupon_code:f.coupon.code},'auto-quote-readonly',f.mid,{quote:true});
      expect(quote).toMatchObject({subtotal_cents:2000,discount_cents:500,total_cents:1500});
      const first=await s.checkout(f.u1,f.body,'auto-checkout-key-'+f.u1,f.mid);
      const replay=await s.checkout(f.u1,f.body,'auto-checkout-key-'+f.u1,f.mid);expect(replay.order.id).toBe(first.order.id);
      expect(await counts(f.coupon.id)).toEqual({reserved_count:1,redeemed_count:0});
      await query("INSERT INTO shop_payment_proofs(order_id,content_type,image) VALUES (?,'image/png',?)",[first.order.id,Buffer.from('synthetic-auto-mode-proof')]);
      for(const next of ['confirmed','preparing','delivering','completed'])expect((await s.changeStatus(first.order.id,next,f.mid)).status).toBe(next);
      expect(await counts(f.coupon.id)).toEqual({reserved_count:0,redeemed_count:1});
      expect((await query('SELECT total_cents FROM shop_orders WHERE id=?',[first.order.id]))[0].total_cents).toBe(1500);
    } finally { process.env.SHOP_COUPONS_ENABLED='1'; }
  });
  test('explicit pause blocks new coupon use while plain orders remain available in auto-capable backend',async()=>{
    const f=await fixture();process.env.SHOP_COUPONS_ENABLED='0';
    try{await expect(s.checkout(f.u1,f.body,'auto-pause-key-'+f.u1,f.mid)).rejects.toMatchObject({publicCode:'COUPONS_UNAVAILABLE'});
      expect(await counts(f.coupon.id)).toEqual({reserved_count:0,redeemed_count:0});
      const plain=await s.checkout(f.u1,{...f.body,coupon_code:'',expected_total_cents:2000},'auto-plain-key-'+f.u1,f.mid);expect(plain.order.total_cents).toBe(2000);
    }finally{process.env.SHOP_COUPONS_ENABLED='1';}
  });

});
