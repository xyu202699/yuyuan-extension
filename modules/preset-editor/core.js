// Keep external storage keys unchanged at runtime for existing preset compatibility.
export const GROUP_METADATA_KEY = '\u0062\u0061\u0069\u0062\u0061\u0069Toolkit';
export const GROUP_RUNTIME_KEY = '__\u0062\u0061\u0069\u0042\u0061\u0069ToolkitExtensionInstalled';
export const GROUP_STATE_PATH = `${GROUP_METADATA_KEY}.presetPromptGroups`;
export const GLOBAL_PROMPT_CHARACTER_ID = 100001;

export function clonePlain(value) {
    if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch {}
    }
    return JSON.parse(JSON.stringify(value ?? null));
}

export function getGlobalPromptOrder(preset, { create = false } = {}) {
    if (!preset || typeof preset !== 'object') return [];
    if (!Array.isArray(preset.prompt_order)) {
        if (!create) return [];
        preset.prompt_order = [];
    }

    let block = preset.prompt_order.find(item => String(item?.character_id) === String(GLOBAL_PROMPT_CHARACTER_ID));
    if (!block) block = preset.prompt_order.find(item => Array.isArray(item?.order));
    if (!block && create) {
        block = { character_id: GLOBAL_PROMPT_CHARACTER_ID, order: [] };
        preset.prompt_order.push(block);
    }
    if (!block) return [];
    if (!Array.isArray(block.order)) block.order = [];
    return block.order;
}

export function getPromptById(preset, identifier) {
    return (Array.isArray(preset?.prompts) ? preset.prompts : []).find(prompt => prompt?.identifier === identifier) || null;
}

export function listEditablePrompts(preset) {
    const order = getGlobalPromptOrder(preset);
    const byId = new Map((Array.isArray(preset?.prompts) ? preset.prompts : []).map(prompt => [prompt?.identifier, prompt]));
    return order.flatMap((entry, index) => {
        const prompt = byId.get(entry?.identifier);
        if (!prompt || prompt.marker || prompt.system_prompt) return [];
        return [{
            index,
            identifier: prompt.identifier,
            name: String(prompt.name || prompt.identifier || '未命名条目'),
            role: String(prompt.role || 'system'),
            content: String(prompt.content || ''),
            enabled: entry.enabled !== false,
            prompt,
        }];
    });
}

export function readGroupState(preset) {
    const value = preset?.extensions?.[GROUP_METADATA_KEY]?.presetPromptGroups;
    if (!value || typeof value !== 'object') return null;
    const groups = Array.isArray(value.groups) ? value.groups.filter(group => group?.id)
        .map((group, index) => ({ ...group, order: Number.isFinite(Number(group.order)) ? Number(group.order) : index }))
        .sort((a, b) => a.order - b.order)
        .map((group, order) => ({ ...group, order })) : [];
    const valid = new Set(groups.map(group => String(group.id)));
    const prompts = {};
    for (const [identifier, meta] of Object.entries(value.prompts || {})) {
        if (meta?.groupId && valid.has(String(meta.groupId))) prompts[identifier] = { groupId: String(meta.groupId) };
    }
    return { ...clonePlain(value), version: Number(value.version) || 1, groups: clonePlain(groups), prompts };
}

export function writeGroupState(preset, state) {
    if (!preset || typeof preset !== 'object' || !state) return false;
    preset.extensions = preset.extensions && typeof preset.extensions === 'object' ? preset.extensions : {};
    preset.extensions[GROUP_METADATA_KEY] = preset.extensions[GROUP_METADATA_KEY] && typeof preset.extensions[GROUP_METADATA_KEY] === 'object'
        ? preset.extensions[GROUP_METADATA_KEY]
        : {};
    preset.extensions[GROUP_METADATA_KEY].presetPromptGroups = clonePlain(state);
    return true;
}

export function assignPromptGroup(preset, promptId, groupId) {
    if (!groupId) return false;
    const state = readGroupState(preset);
    if (!state || !state.groups.some(group => String(group.id) === String(groupId))) return false;
    state.prompts[promptId] = { groupId: String(groupId) };
    writeGroupState(preset, state);
    return true;
}

export function createPromptCopy(source, identifier) {
    const copy = clonePlain(source || {});
    copy.identifier = identifier;
    copy.name = String(copy.name || '未命名条目');
    copy.role = ['system', 'user', 'assistant'].includes(copy.role) ? copy.role : 'system';
    copy.content = String(copy.content || '');
    copy.system_prompt = false;
    copy.marker = false;
    copy.extension = false;
    copy.injection_position = Number(copy.injection_position) === 1 ? 1 : 0;
    const depth = Number(copy.injection_depth);
    const order = Number(copy.injection_order);
    copy.injection_depth = Number.isFinite(depth) ? Math.max(0, depth) : 4;
    copy.injection_order = Number.isFinite(order) ? Math.max(0, order) : 100;
    copy.injection_trigger = Array.isArray(copy.injection_trigger) ? copy.injection_trigger : [];
    copy.forbid_overrides = Boolean(copy.forbid_overrides);
    return copy;
}

export function insertPrompt(preset, prompt, { position = 'bottom', enabled = false, groupId = '' } = {}) {
    if (!preset || typeof preset !== 'object') throw new Error('目标预设不可用');
    preset.prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
    if (preset.prompts.some(item => item?.identifier === prompt.identifier)) throw new Error('条目 ID 已存在');

    const order = getGlobalPromptOrder(preset, { create: true });
    let insertAt = order.length;
    if (position === 'top') insertAt = 0;
    else if (position !== 'bottom') {
        const anchor = order.findIndex(item => item?.identifier === position);
        if (anchor >= 0) insertAt = anchor + 1;
    }

    preset.prompts.push(prompt);
    order.splice(insertAt, 0, { identifier: prompt.identifier, enabled: enabled !== false });
    if (groupId) assignPromptGroup(preset, prompt.identifier, groupId);
    return { identifier: prompt.identifier, index: insertAt };
}

export function removePrompt(preset, identifier) {
    if (!preset || typeof preset !== 'object' || !identifier) return false;
    const before = Array.isArray(preset.prompts) ? preset.prompts.length : 0;
    preset.prompts = (Array.isArray(preset.prompts) ? preset.prompts : []).filter(prompt => prompt?.identifier !== identifier);
    for (const block of Array.isArray(preset.prompt_order) ? preset.prompt_order : []) {
        if (Array.isArray(block?.order)) block.order = block.order.filter(entry => entry?.identifier !== identifier);
    }

    const state = readGroupState(preset);
    if (state) {
        delete state.prompts[identifier];
        const usedGroups = new Set(Object.values(state.prompts).map(meta => String(meta?.groupId || '')).filter(Boolean));
        state.groups = state.groups.filter(group => usedGroups.has(String(group.id))).map((group, order) => ({ ...group, order }));
        writeGroupState(preset, state);
    }
    return preset.prompts.length !== before;
}

export function resolveEnabled(mode, sourceEnabled = false) {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return sourceEnabled !== false;
}

export function inferInsertionGroup(preset, position = 'bottom') {
    const state = readGroupState(preset);
    if (!state) return '';
    const order = getGlobalPromptOrder(preset).map(entry => entry?.identifier).filter(Boolean);
    if (!order.length) return '';

    let candidates = [];
    if (position === 'top') {
        candidates = order;
    } else if (position === 'bottom') {
        candidates = [...order].reverse();
    } else {
        const anchor = order.indexOf(position);
        if (anchor >= 0) {
            candidates = [order[anchor], ...order.slice(0, anchor).reverse(), ...order.slice(anchor + 1)];
        }
    }

    const validGroups = new Set(state.groups.map(group => String(group.id)));
    for (const identifier of candidates) {
        const groupId = String(state.prompts?.[identifier]?.groupId || '');
        if (validGroups.has(groupId)) return groupId;
    }
    return '';
}

export function groupAtInsertionPosition(preset, position = 'bottom') {
    const state = readGroupState(preset);
    if (!state) return '';
    const order = getGlobalPromptOrder(preset).map(entry => entry?.identifier).filter(Boolean);
    if (!order.length) return '';
    const identifier = position === 'top'
        ? order[0]
        : position === 'bottom'
            ? order[order.length - 1]
            : position;
    const groupId = String(state.prompts?.[identifier]?.groupId || '');
    return state.groups.some(group => String(group.id) === groupId) ? groupId : '';
}

export function ensureSourcePromptGroup(targetPreset, sourcePreset, sourcePromptId, newGroupId) {
    const sourceState = readGroupState(sourcePreset);
    const sourceGroupId = String(sourceState?.prompts?.[sourcePromptId]?.groupId || '');
    const sourceGroup = sourceState?.groups?.find(group => String(group.id) === sourceGroupId);
    if (!sourceGroup) return '';

    const targetState = readGroupState(targetPreset) || { version: 1, groups: [], prompts: {} };
    const sourceName = String(sourceGroup.name || '未命名分组');
    // Presets can share an ancestor's IDs while having renamed its groups.
    // An ID match alone must not send source prompts into an unrelated group.
    const existing = targetState.groups.find(group => String(group.id) === sourceGroupId
        && String(group.name || '') === sourceName)
        || targetState.groups.find(group => String(group.name || '') === sourceName);
    if (existing) return String(existing.id);

    const groupId = targetState.groups.some(group => String(group.id) === sourceGroupId)
        ? String(newGroupId || '') : sourceGroupId;
    if (!groupId || targetState.groups.some(group => String(group.id) === groupId)) return '';
    targetState.groups.push({
        ...clonePlain(sourceGroup),
        id: groupId,
        name: sourceName,
        order: targetState.groups.length,
        collapsed: Boolean(sourceGroup.collapsed),
        enabled: sourceGroup.enabled !== false,
    });
    writeGroupState(targetPreset, targetState);
    return groupId;
}

export function inferNewPromptGroups(beforeOrder, afterOrder, groupState) {
    const before = new Set((beforeOrder || []).map(item => typeof item === 'string' ? item : item?.identifier).filter(Boolean));
    const ids = (afterOrder || []).map(item => typeof item === 'string' ? item : item?.identifier).filter(Boolean);
    const groups = new Set((groupState?.groups || []).map(group => String(group?.id || '')).filter(Boolean));
    const mapping = groupState?.prompts || {};
    const assigned = {};

    const groupFor = id => assigned[id]?.groupId || mapping[id]?.groupId || '';
    for (let index = 0; index < ids.length; index++) {
        const identifier = ids[index];
        if (before.has(identifier) || mapping[identifier]) continue;
        const previousGroup = index > 0 ? String(groupFor(ids[index - 1]) || '') : '';
        const nextGroup = index + 1 < ids.length ? String(groupFor(ids[index + 1]) || '') : '';
        const groupId = groups.has(previousGroup) ? previousGroup : (groups.has(nextGroup) ? nextGroup : '');
        if (groupId) assigned[identifier] = { groupId };
    }
    return assigned;
}
