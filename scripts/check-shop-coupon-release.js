// Read-only release checks. Explicit configuration only; never loads root .env.
const fs = require('fs');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { REQUIRED, couponMode, checkCouponSchema } = require('../services/shopCouponSchema');
function readEnvironment(args) {
  const i = args.indexOf('--env');
  if (args.includes('--process-env') === (i >= 0)) throw Error('CHOOSE_ENV_FILE_OR_PROCESS_ENV');
  if (i >= 0 && (!args[i+1] || args[i+1].startsWith('--'))) throw Error('ENV_FILE_REQUIRED');
  return i >= 0 ? dotenv.parse(fs.readFileSync(args[i+1])) : {...process.env};
}
function databaseTarget(env) {
  const uri = env.DATABASE_URL || env.MYSQL_URL || env.RAILWAY_MYSQL_URL;
  if (uri) {
    const url = new URL(uri);
    if (!['mysql:','mysql2:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw Error('DATABASE_URL_INVALID');
    return {host:url.hostname, config:{uri,connectTimeout:10000}};
  }
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER) throw Error('DATABASE_CONFIGURATION_REQUIRED');
  return {host:env.DB_HOST,config:{host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD||'',database:env.DB_NAME,connectTimeout:10000}};
}
function configurationIssues(env,args) {
  const errors=[],warnings=[];
  const mode = couponMode(env);
  if (mode === 'invalid') errors.push('SHOP_COUPONS_CONFIGURATION_INVALID');
  if (args.includes('--require-enabled') && mode === 'off') errors.push('SHOP_COUPONS_NOT_ENABLED');
  if (args.includes('--production')) {
    if (env.NODE_ENV !== 'production') errors.push('NODE_ENV_NOT_PRODUCTION');
    if (!env.JWT_SECRET || env.JWT_SECRET === 'your-secret-key-change-in-production') errors.push('JWT_SECRET_REQUIRED');
    if (env.OBJECT_STORAGE_BUCKET) {
      try {if(new URL(env.PUBLIC_ASSET_BASE_URL).protocol !== 'https:') throw Error();} catch {errors.push('PUBLIC_HTTPS_ASSET_URL_REQUIRED');}
      warnings.push('OBJECT_STORAGE_ACCESS_AND_PUBLIC_IMAGES_MUST_BE_SMOKE_TESTED');
    } else {
      if (!env.SHOP_ASSET_DIR || !env.SHOP_ASSET_DIR.startsWith('/')) errors.push('PRODUCTION_ABSOLUTE_ASSET_DIR_REQUIRED');
      warnings.push('PERSISTENT_VOLUME_MOUNT_AND_BACKUP_MUST_BE_VERIFIED');
    }
  }
  return {errors,warnings};
}
async function schemaStatus(conn) {
  return checkCouponSchema(async sql => { const [rows] = await conn.execute(sql); return rows; });
}

async function main(args) {
  const env=readEnvironment(args),target=databaseTarget(env),checks=configurationIssues(env,args);
  const result={source:args.includes('--process-env')?'server-process-environment':'explicit-env-file',...checks,couponMode:couponMode(env),databaseChecked:false};
  if(!args.includes('--no-database')) {
    if(!['localhost','127.0.0.1','::1','[::1]'].includes(target.host)&&!args.includes('--allow-remote'))throw Error('REMOTE_CHECK_REQUIRES_ALLOW_REMOTE');
    const conn=await mysql.createConnection({...target.config,multipleStatements:false});
    try {result.schema=await schemaStatus(conn);result.databaseChecked=true;} finally {await conn.end();}
  }
  result.ready=result.errors.length===0&&result.databaseChecked&&result.schema?.ready===true;
  console.log(JSON.stringify(result,null,2));
  return result.errors.length || (result.databaseChecked&&!result.schema.ready) ? 1 : 0;
}
module.exports={REQUIRED,readEnvironment,databaseTarget,configurationIssues,schemaStatus,main};
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(/^[A-Z_]+$/.test(error.message)?error.message:'RELEASE_CHECK_FAILED_NO_CREDENTIALS_PRINTED');process.exitCode=1;});
