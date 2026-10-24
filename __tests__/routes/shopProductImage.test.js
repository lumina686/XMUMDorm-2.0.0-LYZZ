const express = require('express');
const helmet = require('helmet');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-image-test-'));
process.env.SHOP_ASSET_DIR = mockRoot;
jest.mock('../../database', () => ({ query: jest.fn(), pool: {} }));
jest.mock('../../services/objectStorage', () => ({
  isObjectStorageConfigured: jest.fn(), publicUrlForKey: jest.fn(), uploadBuffer: jest.fn(),
}));
jest.mock('../../services/auditLog', () => ({ logAudit: jest.fn().mockResolvedValue() }));
const { query } = require('../../database');
const storage = require('../../services/objectStorage');
const app = express(); app.use(helmet()); app.use('/api/shop', require('../../routes/shop'));
const upload = (role, image, type='image/png') => request(app).post('/api/shop/stores/test/admin/product-images')
  .set('Authorization', `Bearer ${jwt.sign({id:1,role},process.env.JWT_SECRET)}`)
  .attach('image', image, {filename:'image.png',contentType:type});
let png;
beforeAll(async()=>{png=await sharp({create:{width:10,height:20,channels:3,background:'#173874'}}).png().toBuffer();});
beforeEach(()=>{
  jest.clearAllMocks();
  process.env.SHOP_ASSET_DIR=mockRoot;
  storage.isObjectStorageConfigured.mockReturnValue(false);
  storage.uploadBuffer.mockResolvedValue();
  storage.publicUrlForKey.mockImplementation(key=>'https://assets.example.com/'+key);
  query.mockImplementation(async sql=>{
    if(sql.includes('FROM shop_merchants'))return [{id:7,slug:'test'}];
    if(sql.includes('SELECT status FROM users'))return [{status:'active'}];
    if(sql.includes('SELECT role'))return [{role:'merchant',status:'active'}];
    if(sql.includes('shop_merchant_members'))return [{user_id:1}];
    return [];
  });
});
afterAll(()=>fs.rmSync(mockRoot,{recursive:true,force:true}));
test('merchant upload uses existing object storage and returns public URL',async()=>{
  storage.isObjectStorageConfigured.mockReturnValue(true);
  const r=await upload('merchant',png);
  expect(r.status).toBe(200); expect(r.body.data.url).toMatch(/^https:\/\/assets.example.com\/shop\/products\/7\/[a-f0-9]+\.webp$/);
  const args=storage.uploadBuffer.mock.calls[0][0];
  expect(args.contentType).toBe('image/webp');expect((await sharp(args.body).metadata()).width).toBe(10);
});
test('local upload can be displayed across frontend/backend origins under Helmet',async()=>{
  const r=await upload('merchant',png);expect(r.status).toBe(200);
  const image=await request(app).get(r.body.data.url);
  expect(image.status).toBe(200);expect(image.headers['content-type']).toContain('image/webp');
  expect(image.headers['cross-origin-resource-policy']).toBe('cross-origin');
  expect(image.headers['x-content-type-options']).toBe('nosniff');
  expect((await sharp(image.body).metadata()).height).toBe(20);
});
test('anonymous cannot upload',async()=>expect((await request(app).post('/api/shop/stores/test/admin/product-images')).status).toBe(401));
test('student cannot upload',async()=>{
  query.mockImplementation(async sql=>sql.includes('FROM shop_merchants')?[{id:7}]:sql.includes('SELECT role')?[{role:'student',status:'active'}]:sql.includes('SELECT status FROM users')?[{status:'active'}]:[]);
  expect((await upload('student',png)).status).toBe(403);expect(storage.uploadBuffer).not.toHaveBeenCalled();
});
test('merchant cannot upload for another store',async()=>{
  query.mockImplementation(async sql=>sql.includes('FROM shop_merchants')?[{id:8}]:sql.includes('SELECT role')?[{role:'merchant',status:'active'}]:sql.includes('SELECT status FROM users')?[{status:'active'}]:[]);
  expect((await upload('merchant',png)).status).toBe(403);
});
test.each([['forged',Buffer.from('invalid'),'image/png'],['SVG with PNG MIME',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),'image/png']])('rejects %s image',async(_,bytes,type)=>{
  expect((await upload('merchant',bytes||png,type)).status).toBe(400);expect(storage.uploadBuffer).not.toHaveBeenCalled();
});
test('rejects files larger than 5MB',async()=>expect((await upload('merchant',Buffer.alloc(5*1024*1024+1))).status).toBe(400));
test('production refuses ephemeral storage',async()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';delete process.env.SHOP_ASSET_DIR;
  try{expect((await upload('merchant',png)).status).toBe(503);}finally{process.env.NODE_ENV=previous;}
});
test('invalid public storage URL fails without uploading',async()=>{
  storage.isObjectStorageConfigured.mockReturnValue(true);storage.publicUrlForKey.mockReturnValue('http://assets.example.com/x');
  expect((await upload('merchant',png)).status).toBe(503);expect(storage.uploadBuffer).not.toHaveBeenCalled();
});
test('storage failure does not return a broken success URL or leak secrets',async()=>{
  storage.isObjectStorageConfigured.mockReturnValue(true);storage.uploadBuffer.mockRejectedValue(Error('secret-storage-detail'));
  const spy=jest.spyOn(console,'error').mockImplementation(()=>{});
  try{const r=await upload('merchant',png);expect(r.status).toBe(503);expect(r.body.message).toContain('Image storage unavailable');expect(JSON.stringify(r.body)).not.toContain('secret-storage-detail');}finally{spy.mockRestore();}
});

test.each(['image/x-png','application/octet-stream','image/jpeg'])('real PNG accepts unreliable MIME %s and produces safe WebP',async type=>{
 const r=await upload('merchant',png,type);expect(r.status).toBe(200);const image=await request(app).get(r.body.data.url);expect(image.status).toBe(200);expect((await sharp(image.body).metadata()).format).toBe('webp');
});
test('oversized image dimensions give resize guidance rather than invalid-format message',async()=>{
 const large=await sharp({create:{width:4001,height:4001,channels:3,background:'#173874'}}).png().toBuffer();
 const r=await upload('merchant',large);expect(r.status).toBe(400);expect(r.body.message).toContain('16 megapixels');expect(storage.uploadBuffer).not.toHaveBeenCalled();
});
