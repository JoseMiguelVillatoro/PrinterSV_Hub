import { supabase } from './supabase';

export const PRODUCT_BUCKET = 'product-images';

/**
 * Achica y comprime una foto en el navegador antes de subirla:
 * máximo `max` px por lado, JPEG con fondo blanco (las PNG transparentes
 * no quedan negras). Una foto de celular de 5 MB queda en ~60–150 KB.
 */
export async function compressImage(file: Blob, max = 800, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap) (bitmap as ImageBitmap).close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return blob;
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // imageOrientation respeta la rotación de las fotos de celular
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* formato no soportado por createImageBitmap (p. ej. algunos HEIC): se intenta con <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Formato de imagen no soportado. Probá con JPG o PNG.'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Sube la foto ya comprimida y devuelve su URL pública. */
export async function uploadProductImage(blob: Blob): Promise<string> {
  const path = `productos/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(PRODUCT_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new Error('Falta activar el espacio de fotos en Supabase (archivo SQL de fotos de productos).');
    }
    if (/row-level security|unauthorized|403/i.test(error.message)) {
      throw new Error('No tenés permiso para subir fotos.');
    }
    throw new Error(`No se pudo subir la foto: ${error.message}`);
  }
  return supabase.storage.from(PRODUCT_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Si la URL es de nuestro espacio de fotos, devuelve la ruta interna del archivo. */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PRODUCT_BUCKET}/`;
  const i = url.indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split('?')[0]) : null;
}

/** Borra una foto vieja de nuestro espacio (si no es nuestra, no hace nada). Nunca lanza error. */
export async function removeProductImage(url: string | null | undefined): Promise<void> {
  const path = storagePathFromUrl(url);
  if (!path) return;
  await supabase.storage.from(PRODUCT_BUCKET).remove([path]).catch(() => undefined);
}
