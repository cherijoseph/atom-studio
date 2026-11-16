// The same image allowlist is used for JSON imports and browser autosave.
// Only embedded raster pixels are accepted; imported images never fetch a remote URL.
import { validateLock } from './lock-schema-source.js';

export const IMAGE_LIMIT = 12;
export const IMAGE_DATA_LIMIT = 2_000_000;
export const IMAGE_TOTAL_LIMIT = 4_000_000;
export const IMAGE_MAX_EDGE = 16_384;
export const IMAGE_MAX_PIXELS = 64_000_000;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const fail = message => { throw new TypeError(message); };
const u16 = (data, offset) => data.charCodeAt(offset) * 256 + data.charCodeAt(offset + 1);
const le16 = (data, offset) => data.charCodeAt(offset) + data.charCodeAt(offset + 1) * 256;
const le24 = (data, offset) => data.charCodeAt(offset) + data.charCodeAt(offset + 1) * 256 + data.charCodeAt(offset + 2) * 65_536;
const le32 = (data, offset) => le24(data, offset) + data.charCodeAt(offset + 3) * 16_777_216;
const be32 = (data, offset) => data.charCodeAt(offset) * 16_777_216 + data.charCodeAt(offset + 1) * 65_536 + data.charCodeAt(offset + 2) * 256 + data.charCodeAt(offset + 3);

function jpegDimensions(data) {
  if (data.length < 12 || data.charCodeAt(0) !== 0xff || data.charCodeAt(1) !== 0xd8) return null;
  let offset = 2;
  while (offset < data.length) {
    if (data.charCodeAt(offset++) !== 0xff) return null;
    while (data.charCodeAt(offset) === 0xff) offset++;
    const marker = data.charCodeAt(offset++);
    if (marker === 0xda || marker === 0xd9 || marker === 0 || !Number.isFinite(marker)) return null;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
    if (offset + 2 > data.length) return null;
    const length = u16(data, offset);
    if (length < 2 || offset + length > data.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return null;
      return [u16(data, offset + 5), u16(data, offset + 3)];
    }
    offset += length;
  }
  return null;
}

function webpDimensions(data) {
  if (data.length < 20 || data.slice(0, 4) !== 'RIFF' || data.slice(8, 12) !== 'WEBP' || le32(data, 4) !== data.length - 8) return null;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const kind = data.slice(offset, offset + 4), size = le32(data, offset + 4), start = offset + 8;
    if (start + size > data.length) return null;
    if (kind === 'VP8X' && size >= 10) return [le24(data, start + 4) + 1, le24(data, start + 7) + 1];
    if (kind === 'VP8 ' && size >= 10 && (data.charCodeAt(start) & 1) === 0 && data.slice(start + 3, start + 6) === '\x9d\x01\x2a') return [le16(data, start + 6) & 0x3fff, le16(data, start + 8) & 0x3fff];
    if (kind === 'VP8L' && size >= 5 && data.charCodeAt(start) === 0x2f) {
      const bits = le32(data, start + 1);
      return [(bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1];
    }
    offset = start + size + (size & 1);
  }
  return null;
}

function validateDataUrl(value) {
  if (typeof value !== 'string' || value.length > IMAGE_DATA_LIMIT) fail('Each image must be smaller than 2 MB after import');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) fail('Use an embedded PNG, JPEG or WebP image');
  let data;
  try { data = atob(match[2]); } catch { fail('Invalid image data'); }
  // Re-encoding also rejects noncanonical padding bits that browsers otherwise tolerate.
  if (btoa(data) !== match[2]) fail('Invalid image data');
  let dimensions = null;
  if (match[1] === 'png' && data.length >= 33 && data.slice(0, 8) === '\x89PNG\r\n\x1a\n' && be32(data, 8) === 13 && data.slice(12, 16) === 'IHDR') dimensions = [be32(data, 16), be32(data, 20)];
  if (match[1] === 'jpeg') dimensions = jpegDimensions(data);
  if (match[1] === 'webp') dimensions = webpDimensions(data);
  if (!dimensions || dimensions.some(value => !Number.isSafeInteger(value) || value < 1 || value > IMAGE_MAX_EDGE) || dimensions[0] * dimensions[1] > IMAGE_MAX_PIXELS) fail('Image pixels must fit within 16,384 pixels per side and 64 megapixels');
  return value;
}

/** Validate an optional image collection and discard all unrecognized properties. */
export function validateImagePlanes(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > IMAGE_LIMIT) fail('Use up to 12 image planes');
  const ids = new Set();
  let total = 0;
  return Array.from(raw, image => {
    if (!record(image) || typeof image.id !== 'string' || !uuid.test(image.id)) fail('Invalid image ID');
    const id = image.id.toLowerCase();
    if (ids.has(id)) fail('Duplicate image ID');
    ids.add(id);
    if (typeof image.name !== 'string' || !image.name.trim() || image.name.length > 120 || /[\u0000-\u001f\u007f]/u.test(image.name)) fail('Use an image name from 1 to 120 characters');
    const dataUrl = validateDataUrl(image.dataUrl);
    total += dataUrl.length;
    if (total > IMAGE_TOTAL_LIMIT) fail('Combined images must be smaller than 4 MB after import');
    if (!finite(image.width, .1, 100) || !finite(image.height, .1, 100) || !['x', 'y', 'z'].every(axis => finite(image[axis], -100, 100))) fail('Invalid image size or position');
    if (!Array.isArray(image.rotation) || image.rotation.length !== 3 || ![0, 1, 2].every(index => finite(image.rotation[index], -360, 360))) fail('Invalid image orientation');
    if (!finite(image.opacity, 0, 1) || typeof image.visible !== 'boolean') fail('Invalid image visibility');
    return { id, name: image.name.trim(), dataUrl, width: image.width, height: image.height, x: image.x, y: image.y, z: image.z, rotation: [...image.rotation], opacity: image.opacity, visible: image.visible, ...validateLock(image) };
  });
}

export function validateActiveImageId(raw, images) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !uuid.test(raw) || !images.some(image => image.id === raw.toLowerCase())) fail('Invalid selected image ID');
  return raw.toLowerCase();
}
