// Shared by JSON imports and browser autosave.
// Omitted fields stay omitted so older snapshots retain their exact shape.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isLocked = item => item?.locked === true;

export function validateLock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid lock settings');
  const result = {};
  if (raw.locked !== undefined) {
    if (typeof raw.locked !== 'boolean') throw new TypeError('Invalid object lock');
    result.locked = raw.locked;
  }
  if (raw.lockGroup !== undefined) {
    if (!isLocked(raw) || typeof raw.lockGroup !== 'string' || !uuid.test(raw.lockGroup)) throw new TypeError('Invalid lock group');
    result.lockGroup = raw.lockGroup.toLowerCase();
  }
  if (raw.lockLabel !== undefined) {
    if (!isLocked(raw) || typeof raw.lockLabel !== 'string' || raw.lockLabel.length > 80 || /[\u0000-\u001f\u007f]/u.test(raw.lockLabel)) throw new TypeError('Use a lock name up to 80 characters');
    result.lockLabel = raw.lockLabel.trim();
  }
  return result;
}
