const {REQUIRED,readEnvironment,databaseTarget,configurationIssues,schemaStatus}=require('../../scripts/check-shop-coupon-release');
const local={DB_HOST:'127.0.0.1',DB_PORT:'3308',DB_NAME:'coupon_test_release',DB_USER:'root'};
function schemaConnection(omit){
 const columns=Object.entries(REQUIRED).flatMap(([table,cols])=>cols.map(col=>({TABLE_NAME:table,COLUMN_NAME:col}))).filter(r=>r.TABLE_NAME+'.'+r.COLUMN_NAME!==omit);
 const indexes=[{TABLE_NAME:'shop_coupons',INDEX_NAME:'code',COLUMN_NAME:'code',SEQ_IN_INDEX:1},{TABLE_NAME:'shop_coupons',INDEX_NAME:'create',COLUMN_NAME:'created_by',SEQ_IN_INDEX:1},{TABLE_NAME:'shop_coupons',INDEX_NAME:'create',COLUMN_NAME:'create_key',SEQ_IN_INDEX:2},{TABLE_NAME:'shop_coupon_redemptions',INDEX_NAME:'order',COLUMN_NAME:'order_id',SEQ_IN_INDEX:1}];
 return {execute:jest.fn().mockResolvedValueOnce([columns]).mockResolvedValueOnce([indexes.filter(r=>r.INDEX_NAME!==omit)])};
}
test('release commands require one explicit configuration source',()=>{
 expect(()=>readEnvironment([])).toThrow('CHOOSE_ENV_FILE_OR_PROCESS_ENV');
 expect(()=>readEnvironment(['--process-env','--env','somewhere'])).toThrow('CHOOSE_ENV_FILE_OR_PROCESS_ENV');
 expect(()=>readEnvironment(['--env','--production'])).toThrow('ENV_FILE_REQUIRED');
});
test('missing database fields never fall back to a default database',()=>{expect(()=>databaseTarget({})).toThrow('DATABASE_CONFIGURATION_REQUIRED');expect(databaseTarget(local).config.database).toBe('coupon_test_release');});
test('database URL has precedence and must use MySQL',()=>{
 expect(databaseTarget({...local,DATABASE_URL:'mysql://reader:example@database.invalid/schema'}).host).toBe('database.invalid');
 expect(()=>databaseTarget({DATABASE_URL:'https://database.invalid/schema'})).toThrow('DATABASE_URL_INVALID');
});
test('production check rejects development config, missing JWT, unpersisted images and a disabled feature',()=>{
 expect(configurationIssues({...local,SHOP_COUPONS_ENABLED:'0'},['--production','--require-enabled']).errors).toEqual(expect.arrayContaining(['NODE_ENV_NOT_PRODUCTION','JWT_SECRET_REQUIRED','PRODUCTION_ABSOLUTE_ASSET_DIR_REQUIRED','SHOP_COUPONS_NOT_ENABLED']));
});
test('object storage requires public HTTPS but does not pretend it tested bucket access',()=>{
 const env={NODE_ENV:'production',JWT_SECRET:'synthetic-test-key',SHOP_COUPONS_ENABLED:'1',OBJECT_STORAGE_BUCKET:'synthetic-bucket',PUBLIC_ASSET_BASE_URL:'http://example.test'};
 expect(configurationIssues(env,['--production']).errors).toContain('PUBLIC_HTTPS_ASSET_URL_REQUIRED');
 env.PUBLIC_ASSET_BASE_URL='https://example.test';const result=configurationIssues(env,['--production','--require-enabled']);expect(result.errors).toEqual([]);expect(result.warnings).toContain('OBJECT_STORAGE_ACCESS_AND_PUBLIC_IMAGES_MUST_BE_SMOKE_TESTED');
});
test('disk path setting alone cannot prove a persistent volume is mounted',()=>{
 const result=configurationIssues({NODE_ENV:'production',JWT_SECRET:'synthetic-test-key',SHOP_ASSET_DIR:'/data/shop'},['--production']);expect(result.errors).toEqual([]);expect(result.warnings).toContain('PERSISTENT_VOLUME_MOUNT_AND_BACKUP_MUST_BE_VERIFIED');
});
test('complete columns and uniqueness constraints pass read-only schema check',async()=>{
 const conn=schemaConnection();expect(await schemaStatus(conn)).toEqual({ready:true,missing:[]});for(const [sql]of conn.execute.mock.calls)expect(sql).toMatch(/^SELECT /);
});
test('partial migration or missing order uniqueness cannot be reported ready',async()=>{
 expect(await schemaStatus(schemaConnection('shop_coupon_redemptions.status'))).toMatchObject({ready:false,missing:['shop_coupon_redemptions.status']});
 expect(await schemaStatus(schemaConnection('order'))).toMatchObject({ready:false,missing:['shop_coupon_redemptions.unique(order_id)']});
});

test.each([undefined,'','auto','1'])('release enabled check permits automatic mode %s with separate schema verification',flag=>{expect(configurationIssues({...local,SHOP_COUPONS_ENABLED:flag},['--require-enabled']).errors).toEqual([]);});
test('release check reports invalid flags even without require-enabled',()=>{expect(configurationIssues({...local,SHOP_COUPONS_ENABLED:'typo'},[]).errors).toContain('SHOP_COUPONS_CONFIGURATION_INVALID');});
