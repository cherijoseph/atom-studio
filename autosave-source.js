const FORMAT = 'atom-studio-browser-autosave';
const VERSION = 1;

/** Save one browser-local workspace without changing the downloadable file format. */
export function createBrowserAutosave({
  key,
  getStorage = () => localStorage,
  readState,
  applyState,
  validateState = () => true,
  onStatus = () => {},
  delay = 600,
}) {
  let timer;
  let savedState = null;
  let savedAt = null;
  let protectedRecord = false;
  let failureBaseline = null;
  let observedRaw;
  let observedStorage = false;
  let revision = 0;
  let conflict = false;
  let initialBaseline = null;
  let untouchedEmpty = false;
  const writerId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  const status = (value, timestamp = savedAt) => {
    // A display callback must not prevent a successfully persisted workspace.
    try { onStatus(value, timestamp); } catch {}
  };

  const snapshot = () => {
    const workspace = readState();
    const json = JSON.stringify(workspace);
    if (typeof json !== 'string') throw new Error('Workspace is not serializable');
    return { workspace, json };
  };

  const storage = () => {
    const value = getStorage();
    if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function') {
      throw new Error('Browser storage is unavailable');
    }
    return value;
  };

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const protect = () => {
    protectedRecord = true;
    try { failureBaseline = snapshot().json; } catch { failureBaseline = null; }
  };

  const canWrite = (json) => {
    if (!protectedRecord) return true;
    // In particular, a pagehide flush after a failed restore must not erase it.
    if (json === failureBaseline) return false;
    protectedRecord = false;
    failureBaseline = null;
    return true;
  };

  const validated = (workspace) => {
    const result = validateState(workspace);
    if (result === false || result === null) throw new Error('Invalid workspace');
    const value = result === undefined || result === true ? workspace : result;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace');
    return value;
  };

  function restore() {
    cancel();
    savedState = null;
    savedAt = null;
    observedStorage = false;
    observedRaw = undefined;
    revision = 0;
    conflict = false;
    untouchedEmpty = false;
    let raw;
    try { raw = storage().getItem(key); }
    catch {
      protect();
      status('unavailable');
      return false;
    }
    observedRaw = raw;
    observedStorage = true;
    if (raw === null) {
      protectedRecord = false;
      failureBaseline = null;
      untouchedEmpty = true;
      try { initialBaseline = snapshot().json; } catch { initialBaseline = null; }
      return false;
    }
    try {
      const record = JSON.parse(raw);
      if (!record || record.format !== FORMAT || record.version !== VERSION ||
          typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt)) ||
          !Object.hasOwn(record, 'workspace') || !record.workspace ||
          typeof record.workspace !== 'object' || Array.isArray(record.workspace) ||
          (record.revision !== undefined && (!Number.isSafeInteger(record.revision) || record.revision < 0))) {
        throw new Error('Unsupported or invalid autosave');
      }
      applyState(validated(record.workspace));
      // Compare future edits with the actual restored state, including any normalization.
      savedState = snapshot().json;
      savedAt = record.savedAt;
      revision = record.revision ?? 0;
      protectedRecord = false;
      failureBaseline = null;
      status('restored');
      return true;
    } catch {
      protect();
      status('invalid');
      return false;
    }
  }

  function flush() {
    cancel();
    let current;
    try { current = snapshot(); }
    catch {
      status('invalid');
      return false;
    }
    if (!canWrite(current.json)) return false;
    if (untouchedEmpty && current.json === initialBaseline) return false;
    untouchedEmpty = false;
    let targetStorage;
    try {
      targetStorage = storage();
      const raw = targetStorage.getItem(key);
      if (!observedStorage) {
        // Calling flush without restore is safe only when there is no prior record.
        observedRaw = raw;
        observedStorage = true;
        if (raw !== null) conflict = true;
      }
      if (conflict || raw !== observedRaw) {
        conflict = true;
        status('conflict');
        return false;
      }
    } catch {
      status('unavailable');
      return false;
    }
    if (current.json === savedState) {
      status('saved');
      return true;
    }
    let workspaceJson;
    try { workspaceJson = JSON.stringify(validated(current.workspace)); }
    catch {
      status('invalid');
      return false;
    }
    const timestamp = new Date().toISOString();
    const nextRevision = revision + 1;
    const record = `{"format":"${FORMAT}","version":${VERSION},"revision":${nextRevision},"writerId":${JSON.stringify(writerId)},"savedAt":${JSON.stringify(timestamp)},"workspace":${workspaceJson}}`;
    try { targetStorage.setItem(key, record); }
    catch {
      // setItem is atomic: keep the previous record and previous successful snapshot.
      status('unavailable');
      return false;
    }
    savedState = current.json;
    savedAt = timestamp;
    revision = nextRevision;
    observedRaw = record;
    status('saved');
    return true;
  }

  function schedule() {
    cancel();
    untouchedEmpty = false;
    let current;
    try { current = snapshot(); }
    catch {
      status('invalid');
      return;
    }
    if (!canWrite(current.json) || conflict || current.json === savedState) return;
    status('saving');
    timer = setTimeout(flush, Math.max(0, delay));
  }

  function isCurrentSaved() {
    if (savedState === null || conflict) return false;
    try { return snapshot().json === savedState; } catch { return false; }
  }

  return { restore, schedule, flush, hasSaved: () => savedState !== null, isCurrentSaved };
}
