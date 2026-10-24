import {useMemo,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {createShopApi} from '@shared/api/shop';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import {money,localized} from './shopLabels';

const empty={name_zh:'',name_en:'',amount:'',minimum:'0',starts_at:'',ends_at:'',total_limit:100};
const freshDraft=()=>({...empty,
  starts_at:new Date(Date.now()+8*3600000).toISOString().slice(0,16),
  ends_at:new Date(Date.now()+8*3600000+7*86400000).toISOString().slice(0,16)});
function stateLabel(row,t) {
  const now=new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ');
  if(row.status==='disabled')return t('已停用','Disabled');
  if(now<row.starts_at)return t('未开始','Not started');
  if(now>=row.ends_at)return t('已过期','Expired');
  if(row.reserved_count+row.redeemed_count>=row.total_limit)return t('已用完','Exhausted');
  return t('可使用','Available');
}
export default function ShopCoupons({slug,isZh}) {
  const t=(zh,en)=>isZh?zh:en;
  const api=useMemo(()=>createShopApi(slug),[slug]);
  const qc=useQueryClient();
  const [page,setPage]=useState(1),[draft,setDraft]=useState(freshDraft),[message,setMessage]=useState('');
  const [showForm,setShowForm]=useState(false),[couponId,setCouponId]=useState(null),[usagePage,setUsagePage]=useState(1);
  const request=useRef(null);
  const nextRequest=useRef(null), copying=useRef(false);
  const catalog=useQuery({queryKey:['shop',slug,'catalog'],queryFn:api.catalog});
  const available=!!catalog.data?.coupons_enabled;
  const rows=useQuery({queryKey:['shop',slug,'coupons',page],queryFn:()=>api.coupons(page),enabled:available,retry:false,refetchInterval:30000});
  const usage=useQuery({queryKey:['shop',slug,'coupon-usage',couponId,usagePage],queryFn:()=>api.couponRedemptions(couponId,usagePage),enabled:available&&!!couponId,retry:false});
  const create=useMutation({mutationFn:async()=>{
    const cents=value=>{if(!/^\d+(\.\d{1,2})?$/.test(String(value)))throw Error(t('金额最多两位小数','Use at most two decimal places'));return Math.round(Number(value)*100);};
    const body={name_zh:draft.name_zh,name_en:draft.name_en,discount_cents:cents(draft.amount),min_subtotal_cents:cents(draft.minimum),starts_at:draft.starts_at,ends_at:draft.ends_at,total_limit:Number(draft.total_limit)};
    const signature=JSON.stringify(body);
    if(request.current&&request.current.signature!==signature)throw Error(t('上次结果未确认，请先重试原内容或刷新列表核对','Previous result is unknown. Retry the same content or check the list first.'));
    request.current ||= {key:crypto.randomUUID(),signature};
    return api.createCoupon(body,request.current.key);
  },onSuccess:row=>{request.current=null;setMessage(t(`创建成功，优惠码：${row.code}`,`Created. Code: ${row.code}`));setDraft(freshDraft());setShowForm(false);setPage(1);qc.invalidateQueries({queryKey:['shop',slug,'coupons']});},onError:error=>{if(error.status&&error.status<500)request.current=null;setMessage(error.message);}});
  const next=useMutation({mutationFn:async row=>{
    if(nextRequest.current&&nextRequest.current.source!==row.id)throw Error(t('请先重试上一张券，确认生成结果','Retry the previous coupon first'));
    if(!nextRequest.current){
      try{await navigator.clipboard.writeText(row.code);}catch{throw Error(t('复制失败，未生成新券；请允许剪贴板访问后重试','Copy failed. No new coupon created. Allow clipboard access and retry.'));}
      nextRequest.current={source:row.id,key:crypto.randomUUID(),body:{name_zh:row.name_zh,name_en:row.name_en,discount_cents:row.discount_cents,min_subtotal_cents:row.min_subtotal_cents,starts_at:row.starts_at,ends_at:row.ends_at,total_limit:1}};
    }
    const pending=nextRequest.current;
    return api.createCoupon(pending.body,pending.key);
  },onSuccess:row=>{nextRequest.current=null;setMessage(t(`原券码已复制，可发送给学生。下一张已生成：${row.code}（限用一次）；原券继续有效，原有次数不变。`,`Original code copied. Next code: ${row.code} (single use). The original remains valid with its existing limit.`));setPage(1);qc.invalidateQueries({queryKey:['shop',slug,'coupons']});},onError:error=>{if(error.status&&error.status<500)nextRequest.current=null;setMessage(`${error.message}${nextRequest.current?t('；原券码已复制，请点击同一张券的按钮重试，不会重复生成','; original copied. Retry this same coupon without creating duplicates.'):''}`);},onSettled:()=>{copying.current=false;}});
  const status=useMutation({mutationFn:row=>api.couponStatus(row.id,row.status==='active'?'disabled':'active'),onSuccess:()=>qc.invalidateQueries({queryKey:['shop',slug,'coupons']}),onError:error=>setMessage(error.message)});
  if(catalog.isPending)return <p role="status">{t('正在检查优惠券…','Checking coupons…')}</p>;
  if(catalog.error)return <p role="alert">{catalog.error.message}<Button onClick={()=>catalog.refetch()}>{t('重试','Retry')}</Button></p>;
  if(!available)return <div role="status"><p>{t('优惠券暂不可用，请稍后重试或联系管理员。原有下单不受影响。','Coupons are temporarily unavailable. Retry or contact support. Regular orders remain available.')}</p><Button variant="outline" onClick={()=>catalog.refetch()}>{t('重新检查','Check again')}</Button></div>;
  return <section className="shop-coupons"><h2>{t('店铺优惠券','Store coupons')}</h2>
    <p>{t('固定金额优惠，仅本店使用。每个账号每券一次，付款核实前取消可返还次数。停用不影响已创建订单。所有时间为校园时间 UTC+8。','Fixed discounts for this store only. Once per account; cancellation before payment verification releases the use. Disabling does not change existing orders. All times are campus time UTC+8.')}</p>
    {message&&<p className="shop-notice" role="status">{message}</p>}
    <Button onClick={()=>setShowForm(value=>!value)} disabled={create.isPending}>{t(showForm?'收起表单':'新建优惠券',showForm?'Hide form':'Create coupon')}</Button>
    {showForm&&<form className="shop-order" onSubmit={event=>{event.preventDefault();create.mutate();}}><div className="shop-form-grid">
      {[[ 'name_zh','中文名称','Chinese name','text'],['name_en','英文名称','English name','text'],['amount','减免金额（RM）','Discount (RM)','number'],['minimum','最低消费（RM）','Minimum spend (RM)','number'],['starts_at','开始时间','Start time','datetime-local'],['ends_at','结束时间','End time','datetime-local'],['total_limit','总使用次数','Total uses','number']].map(([key,zh,en,type])=><Input key={key} id={`coupon-${key}`} label={t(zh,en)} required type={type} maxLength={120} min={key==='amount'?'0.01':key==='minimum'?0:key==='total_limit'?1:undefined} max={key==='total_limit'?1000000:undefined} step={['amount','minimum'].includes(key)?'0.01':type==='datetime-local'?60:1} value={draft[key]} disabled={create.isPending} onChange={event=>setDraft(current=>({...current,[key]:event.target.value}))}/>)}
    </div><p>{t('规则创建后不可修改；如需调整，请停用后新建。优惠后至少应付 RM 0.01。','Rules cannot be edited. Disable and create a new coupon to change them. Payable must be at least RM 0.01.')}</p><Button type="submit" loading={create.isPending}>{t('创建券码','Create code')}</Button></form>}
    <p>{t('复制并生成下一张：复制当前券码，并新增一张相同优惠和有效期的单次券。原券的可用次数不变。','Copy and generate next copies this code and creates a single-use coupon with the same discount and validity. The original usage limit stays unchanged.')}</p>
    {rows.isPending&&<p>{t('加载中…','Loading…')}</p>}{rows.error&&<p role="alert">{rows.error.message}<Button onClick={()=>rows.refetch()}>{t('重试','Retry')}</Button></p>}
    {rows.data?.items.map(row=><article className="shop-order" key={row.id}><div className="shop-order-top"><h3>{localized(row,'name',isZh)}</h3><span className="shop-status">{stateLabel(row,t)}</span></div>
      <strong className="shop-coupon-code">{row.code}</strong><p>{t('减免','Discount')} {money(row.discount_cents)} · {t('最低消费','Minimum')} {money(row.min_subtotal_cents)}</p><p>{row.starts_at} → {row.ends_at} (UTC+8)</p>
      <p>{t('占用 / 已使用 / 总次数','Reserved / redeemed / total')}: {row.reserved_count} / {row.redeemed_count} / {row.total_limit}</p>
      <div className="shop-actions"><Button variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(row.code);setMessage(t('券码已复制','Code copied'));}catch{setMessage(t(`请手动复制：${row.code}`,`Copy manually: ${row.code}`));}}}>{t('复制券码','Copy code')}</Button>
        <Button variant="outline" disabled={next.isPending||row.status!=='active'||stateLabel(row,t)===t('已过期','Expired')} onClick={()=>{if(copying.current)return;copying.current=true;next.mutate(row);}}>{next.isPending?t('正在生成…','Generating…'):t('复制并生成下一张','Copy and generate next')}</Button>
        <Button variant="outline" disabled={status.isPending} onClick={()=>status.mutate(row)}>{row.status==='active'?t('停用','Disable'):t('启用','Enable')}</Button>
        <Button variant="outline" onClick={()=>{setCouponId(row.id);setUsagePage(1);}}>{t('使用记录','Usage')}</Button></div></article>)}
    {rows.data?.items.length===0&&<p>{t('还没有优惠券','No coupons yet')}</p>}
    <div className="shop-actions"><Button variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>{t('上一页','Previous')}</Button><span>{page}</span><Button variant="outline" disabled={!rows.data?.has_more} onClick={()=>setPage(p=>p+1)}>{t('下一页','Next')}</Button></div>
    {couponId&&<div className="shop-order"><h3>{t('使用记录','Usage')}</h3>{usage.isPending&&<p>{t('加载中…','Loading…')}</p>}{usage.error&&<p role="alert">{usage.error.message}<Button onClick={()=>usage.refetch()}>{t('重试','Retry')}</Button></p>}
      {usage.data?.items.map(row=><p key={row.order_id}>#{row.order_id} · {money(row.discount_cents)} · {{reserved:t('待核实占用','Reserved'),redeemed:t('已核销','Redeemed'),released:t('已返还','Released')}[row.status]} · {row.created_at}</p>)}
      {usage.data?.items.length===0&&<p>{t('暂无使用记录','No uses yet')}</p>}<div className="shop-actions"><Button variant="outline" disabled={usagePage===1} onClick={()=>setUsagePage(p=>p-1)}>{t('上一页','Previous')}</Button><Button variant="outline" disabled={!usage.data?.has_more} onClick={()=>setUsagePage(p=>p+1)}>{t('下一页','Next')}</Button><Button variant="outline" onClick={()=>setCouponId(null)}>{t('关闭记录','Close usage')}</Button></div></div>}
  </section>;
}
