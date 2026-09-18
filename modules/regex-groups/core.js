export const STORE_VERSION = 1;
export const DEFAULT_GROUP_ID = '__default__';
export const SCOPES = Object.freeze(['global', 'preset', 'scoped']);

const clone = value => JSON.parse(JSON.stringify(value));

function blankStore() {
    return {
        version: STORE_VERSION,
        groups: { global: [], preset: {}, scoped: {} },
        assignments: { global: {}, preset: {}, scoped: {} },
    };
}

function cleanGroupList(value) {
    if (!Array.isArray(value)) return [];
    const names = new Set();
    const ids = new Set();
    return value
        .filter(item => item && typeof item === 'object')
        .map((item, index) => ({
            id: String(item.id || '').trim(),
            name: String(item.name || '').trim(),
            order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        }))
        .filter(item => {
            const nameKey = item.name.toLocaleLowerCase();
            if (!item.id || item.id === DEFAULT_GROUP_ID || !item.name || ids.has(item.id) || names.has(nameKey)) return false;
            ids.add(item.id);
            names.add(nameKey);
            return true;
        })
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
        .map((item, index) => ({ ...item, order: index }));
}

function cleanAssignments(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .map(([scriptId, groupId]) => [String(scriptId || '').trim(), String(groupId || '').trim()])
        .filter(([scriptId, groupId]) => scriptId && groupId && groupId !== DEFAULT_GROUP_ID));
}

function cleanOwnerMap(value, cleaner) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .map(([key, item]) => [String(key || '').trim(), cleaner(item)])
        .filter(([key]) => key));
}

export function normalizeStore(raw) {
    const next = blankStore();
    if (!raw || typeof raw !== 'object') return next;
    next.groups.global = cleanGroupList(raw.groups?.global);
    next.groups.preset = cleanOwnerMap(raw.groups?.preset, cleanGroupList);
    next.groups.scoped = cleanOwnerMap(raw.groups?.scoped, cleanGroupList);
    next.assignments.global = cleanAssignments(raw.assignments?.global);
    next.assignments.preset = cleanOwnerMap(raw.assignments?.preset, cleanAssignments);
    next.assignments.scoped = cleanOwnerMap(raw.assignments?.scoped, cleanAssignments);
    return next;
}

function assertScope(scope) {
    if (!SCOPES.includes(scope)) throw new Error(`未知正则区域：${scope}`);
}

function ownerList(store, scope, ownerKey, create = false) {
    assertScope(scope);
    if (scope === 'global') return store.groups.global;
    const key = String(ownerKey || '').trim();
    if (!key) return [];
    if (create && !Array.isArray(store.groups[scope][key])) store.groups[scope][key] = [];
    return store.groups[scope][key] || [];
}

function ownerAssignments(store, scope, ownerKey, create = false) {
    assertScope(scope);
    if (scope === 'global') return store.assignments.global;
    const key = String(ownerKey || '').trim();
    if (!key) return {};
    if (create && (!store.assignments[scope][key] || Array.isArray(store.assignments[scope][key]))) {
        store.assignments[scope][key] = {};
    }
    return store.assignments[scope][key] || {};
}

export function listGroups(store, scope, ownerKey) {
    const custom = ownerList(store, scope, ownerKey).map(group => ({ ...group }));
    return [{ id: DEFAULT_GROUP_ID, name: '默认', order: -1, locked: true }, ...custom];
}

export function createGroup(store, scope, ownerKey, name, idFactory = () => crypto.randomUUID()) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('分组名称不能为空');
    if (cleanName === '默认') throw new Error('“默认”是系统分组名称');
    const list = ownerList(store, scope, ownerKey, true);
    if (list.some(group => group.name.localeCompare(cleanName, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
        throw new Error('已经有同名分组');
    }
    const group = { id: `g_${idFactory()}`, name: cleanName, order: list.length };
    list.push(group);
    return group;
}

export function renameGroup(store, scope, ownerKey, groupId, name) {
    if (!groupId || groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不能重命名');
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('分组名称不能为空');
    const list = ownerList(store, scope, ownerKey, true);
    if (list.some(group => group.id !== groupId && group.name.localeCompare(cleanName, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
        throw new Error('已经有同名分组');
    }
    const group = list.find(item => item.id === groupId);
    if (!group) throw new Error('找不到这个分组');
    group.name = cleanName;
    return group;
}

export function deleteGroup(store, scope, ownerKey, groupId) {
    if (!groupId || groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不能删除');
    const list = ownerList(store, scope, ownerKey, true);
    const index = list.findIndex(item => item.id === groupId);
    if (index === -1) return false;
    list.splice(index, 1);
    list.forEach((group, order) => { group.order = order; });
    const assignments = ownerAssignments(store, scope, ownerKey, true);
    Object.entries(assignments).forEach(([scriptId, assigned]) => {
        if (assigned === groupId) delete assignments[scriptId];
    });
    return true;
}

export function assignedGroup(store, scope, ownerKey, scriptId) {
    const assignments = ownerAssignments(store, scope, ownerKey);
    const requested = assignments[String(scriptId || '')];
    if (!requested) return DEFAULT_GROUP_ID;
    return ownerList(store, scope, ownerKey).some(group => group.id === requested) ? requested : DEFAULT_GROUP_ID;
}

export function assignScripts(store, scope, ownerKey, scriptIds, groupId) {
    const validGroup = groupId === DEFAULT_GROUP_ID || ownerList(store, scope, ownerKey).some(group => group.id === groupId);
    if (!validGroup) throw new Error('目标分组不存在');
    const assignments = ownerAssignments(store, scope, ownerKey, true);
    for (const rawId of scriptIds) {
        const id = String(rawId || '').trim();
        if (!id) continue;
        if (groupId === DEFAULT_GROUP_ID) delete assignments[id];
        else assignments[id] = groupId;
    }
}

export function removeAssignments(store, scope, ownerKey, scriptIds) {
    const assignments = ownerAssignments(store, scope, ownerKey, true);
    for (const id of scriptIds) delete assignments[String(id || '')];
}

export function removeScriptsByIds(scripts, scriptIds) {
    const selected = new Set(Array.from(scriptIds || [], String));
    const kept = [];
    const removed = [];
    for (const script of scripts || []) {
        (selected.has(String(script?.id || '')) ? removed : kept).push(clone(script));
    }
    return { kept, removed };
}

export function scriptsInGroup(store, scope, ownerKey, scripts, groupId) {
    return scripts.filter(script => assignedGroup(store, scope, ownerKey, script.id) === groupId);
}

export function pruneAssignments(store, scope, ownerKey, scripts) {
    const validScripts = new Set(scripts.map(script => String(script.id || '')).filter(Boolean));
    const validGroups = new Set(ownerList(store, scope, ownerKey).map(group => group.id));
    const assignments = ownerAssignments(store, scope, ownerKey, true);
    let changed = false;
    for (const [scriptId, groupId] of Object.entries(assignments)) {
        if (!validScripts.has(scriptId) || !validGroups.has(groupId)) {
            delete assignments[scriptId];
            changed = true;
        }
    }
    return changed;
}

export function migrateOwnerKey(store, scope, oldKey, newKey) {
    assertScope(scope);
    if (scope === 'global' || !oldKey || !newKey || oldKey === newKey) return false;
    let changed = false;
    if (store.groups[scope][oldKey] && !store.groups[scope][newKey]) {
        store.groups[scope][newKey] = store.groups[scope][oldKey];
        delete store.groups[scope][oldKey];
        changed = true;
    }
    if (store.assignments[scope][oldKey] && !store.assignments[scope][newKey]) {
        store.assignments[scope][newKey] = store.assignments[scope][oldKey];
        delete store.assignments[scope][oldKey];
        changed = true;
    }
    return changed;
}

export function parseImportPayload(payload, idFactory = () => crypto.randomUUID()) {
    const rawList = Array.isArray(payload) ? payload : [payload];
    const scripts = [];
    const errors = [];
    rawList.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !String(raw.scriptName || '').trim()) {
            errors.push(`第 ${index + 1} 条缺少 scriptName`);
            return;
        }
        const script = clone(raw);
        script.id = idFactory();
        script.scriptName = String(script.scriptName).trim();
        if (typeof script.findRegex !== 'string') script.findRegex = String(script.findRegex ?? '');
        if (typeof script.replaceString !== 'string') script.replaceString = String(script.replaceString ?? '');
        if (!Array.isArray(script.placement)) script.placement = [];
        scripts.push(script);
    });
    return { scripts, errors };
}

export function makeCrossScopeMove(sourceScripts, targetScripts, selectedIds, idFactory = () => crypto.randomUUID()) {
    const selected = new Set(selectedIds.map(String));
    const moved = sourceScripts.filter(script => selected.has(String(script.id)));
    const sourceNext = sourceScripts.filter(script => !selected.has(String(script.id))).map(clone);
    const targetNext = targetScripts.map(clone);
    const occupied = new Set(targetNext.map(script => String(script.id)));
    const idMap = Object.create(null);
    for (const source of moved) {
        const item = clone(source);
        const oldId = String(item.id || '');
        if (!oldId || occupied.has(oldId)) item.id = idFactory();
        occupied.add(String(item.id));
        idMap[oldId] = String(item.id);
        targetNext.push(item);
    }
    return { sourceNext, targetNext, moved: moved.map(clone), idMap };
}

export function cloneStore(store) {
    return normalizeStore(clone(store));
}
