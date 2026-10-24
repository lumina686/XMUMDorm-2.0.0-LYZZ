let isShopImageFile;
beforeAll(async()=>{({isShopImageFile}=await import('../../frontend/src/pages/Shop/shopUploadFile.js'));});
test.each(['','application/octet-stream','image/x-png'])('PNG filename survives missing or unreliable MIME %s',type=>{expect(isShopImageFile({name:'截图.PNG',type})).toBe(true);});
test('known image MIME permits photos without a filename extension',()=>{expect(isShopImageFile({name:'photo',type:'image/png'})).toBe(true);});
test('HEIC and SVG do not appear to be supported images',()=>{for(const file of [{name:'photo.heic',type:'image/heic'},{name:'image.svg',type:'image/svg+xml'}])expect(isShopImageFile(file)).toBe(false);});
test('payment AVIF support remains available',()=>{expect(isShopImageFile({name:'code.avif',type:'image/avif'},true)).toBe(true);expect(isShopImageFile({name:'code.avif',type:'image/avif'})).toBe(false);});
