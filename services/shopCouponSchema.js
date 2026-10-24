// Runtime and release checks share the same read-only structural contract.
const REQUIRED = {
  shop_orders: ['subtotal_cents','discount_cents','coupon_json'],
  shop_coupons: ['id','merchant_id','code','name_zh','name_en','discount_cents','min_subtotal_cents','starts_at','ends_at','total_limit','per_user_limit','reserved_count','redeemed_count','status','created_by','create_key','create_hash','created_at','updated_at'],
  shop_coupon_redemptions: ['id','coupon_id','order_id','user_id','discount_cents','status','redeemed_at','released_at','created_at','updated_at'],
};
function couponMode(env = process.env) {
  const flag = String(env.SHOP_COUPONS_ENABLED ?? '').trim().toLowerCase();
  if (!flag || flag === 'auto') return 'auto';
  if (flag === '1') return 'on';
  if (flag === '0') return 'off';
  return 'invalid';
}
async function checkCouponSchema(runQuery) {
  const rows=await runQuery("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('shop_orders','shop_coupons','shop_coupon_redemptions')");
  const found=new Set(rows.map(r=>r.TABLE_NAME+'.'+r.COLUMN_NAME));
  const missing=Object.entries(REQUIRED).flatMap(([table,columns])=>columns.filter(col=>!found.has(table+'.'+col)).map(col=>table+'.'+col));
  const indexes=await runQuery("SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND NON_UNIQUE=0 AND TABLE_NAME IN ('shop_coupons','shop_coupon_redemptions') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX");
  const groups=new Map();for(const r of indexes){const k=r.TABLE_NAME+'.'+r.INDEX_NAME;groups.set(k,[...(groups.get(k)||[]),r.COLUMN_NAME]);}
  for(const [table,columns] of [['shop_coupons',['code']],['shop_coupons',['created_by','create_key']],['shop_coupon_redemptions',['order_id']]]) {
    if(![...groups].some(([key,cols])=>key.startsWith(table+'.')&&JSON.stringify(cols)===JSON.stringify(columns)))missing.push(table+'.unique('+columns.join(',')+')');
  }
  return {ready:missing.length===0,missing};
}
module.exports = { REQUIRED, couponMode, checkCouponSchema };
