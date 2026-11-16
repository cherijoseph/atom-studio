const DEFAULT_BASE_NAME = 'material-structure';
const MAX_BASE_LENGTH = 100;
const MAX_SAVED_INPUT_LENGTH = 512;

// The base is shared by the JSON and PNG downloads, so strip either suffix.
const DOWNLOAD_SUFFIXES = /(?:\.(?:json|png))+$/i;
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]) *(?:\.|$)/i;
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]+/g;

function trimFilename(value) {
  return value.trim().replace(/[. ]+$/, '');
}

/** Return a portable base and a filename with exactly one requested suffix. */
export function normalizeDownloadName(input, extension) {
  const suffix = typeof extension === 'string' ? extension.replace(/^\./, '').toLowerCase() : '';
  if (suffix !== 'json' && suffix !== 'png') {
    throw new TypeError('Download extension must be json or png.');
  }
  let baseName = typeof input === 'string' ? input : '';
  baseName = trimFilename(baseName.replace(INVALID_FILENAME_CHARACTERS, '-'));
  baseName = trimFilename(baseName.replace(DOWNLOAD_SUFFIXES, ''));
  // Code points keep emoji and other supplementary characters intact.
  baseName = trimFilename(Array.from(baseName).slice(0, MAX_BASE_LENGTH).join(''));
  // Truncation can reveal a suffix that was originally inside a longer name.
  baseName = trimFilename(baseName.replace(DOWNLOAD_SUFFIXES, ''));
  if (!baseName || !/[^.\s-]/u.test(baseName) || RESERVED_DEVICE_NAME.test(baseName)) {
    baseName = DEFAULT_BASE_NAME;
  }
  return { baseName, fileName: `${baseName}.${suffix}` };
}

/** Fresh defaults can be included in workspace snapshots without aliasing. */
export function defaultDownloadNames() {
  return { scene: DEFAULT_BASE_NAME, image: DEFAULT_BASE_NAME };
}

/** Old autosaves can omit these preferences; malformed values fall back safely. */
export function normalizeDownloadNames(raw) {
  const defaults = defaultDownloadNames();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  for (const [key, extension] of [['scene', 'json'], ['image', 'png']]) {
    const value = raw[key];
    if (typeof value === 'string' && value.length <= MAX_SAVED_INPUT_LENGTH) {
      defaults[key] = normalizeDownloadName(value, extension).baseName;
    }
  }
  return defaults;
}
