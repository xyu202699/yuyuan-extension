export function cloneWorldInfo(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value ?? {})); }
}

export function worldInfoFingerprint(value) {
    try { return JSON.stringify(value ?? null); } catch { return ''; }
}

function findOriginalEntry(data, uid) {
    const entries = data?.originalData?.entries;
    if (!Array.isArray(entries)) return null;
    return entries.find(entry => String(entry?.uid ?? entry?.id) === String(uid)) || null;
}

export function getEntrySnapshot(data, uid) {
    const entry = data?.entries?.[uid];
    if (!entry || typeof entry !== 'object') return null;
    const originalEntry = findOriginalEntry(data, uid);
    return {
        uid: String(uid),
        entry: cloneWorldInfo(entry),
        originalEntry: originalEntry ? cloneWorldInfo(originalEntry) : null,
    };
}

export function restoreEntrySnapshot(data, snapshot) {
    if (!snapshot?.entry || snapshot.uid === undefined || !data?.entries) return cloneWorldInfo(data);
    const next = cloneWorldInfo(data);
    const uid = String(snapshot.uid);
    next.entries[uid] = cloneWorldInfo(snapshot.entry);

    if (snapshot.originalEntry && Array.isArray(next?.originalData?.entries)) {
        const index = next.originalData.entries.findIndex(entry => String(entry?.uid ?? entry?.id) === uid);
        if (index >= 0) next.originalData.entries[index] = cloneWorldInfo(snapshot.originalEntry);
    }
    return next;
}
