// This is selection guidance only. The server decodes and validates image bytes.
export function isShopImageFile(file, payment = false) {
  const types = ['image/jpeg','image/png','image/x-png','image/webp', ...(payment ? ['image/avif'] : [])];
  return types.includes(String(file.type || '').toLowerCase()) || (payment ? /\.(jpe?g|png|webp|avif)$/i : /\.(jpe?g|png|webp)$/i).test(file.name || '');
}
