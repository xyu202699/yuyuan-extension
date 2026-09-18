import {
    GROUP_STATE_PATH,
    GROUP_RUNTIME_KEY,
    clonePlain,
    getGlobalPromptOrder,
    inferNewPromptGroups,
    readGroupState,
    writeGroupState,
} from './core.js';

let modulesPromise = null;

async function loadModules() {
    if (!modulesPromise) {
        modulesPromise = Promise.all([
            import('../../../../../preset-manager.js'),
            import('../../../../../openai.js'),
            import('../../../../../../script.js'),
            import('../../../../../utils.js'),
        ]).then(([presetModule, openaiModule, scriptModule, utilsModule]) => ({
            presetModule,
            openaiModule,
            scriptModule,
            utilsModule,
        })).catch(error => {
            modulesPromise = null;
            throw error;
        });
    }
    return await modulesPromise;
}

function replaceObject(target, source) {
    if (!target || typeof target !== 'object') return;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, clonePlain(source));
}

function syncExternalGroupRuntime(name, preset) {
    const root = globalThis.top || globalThis;
    const extensionState = root[GROUP_RUNTIME_KEY];
    const groupState = readGroupState(preset) || { version: 1, groups: [], prompts: {} };
    if (!extensionState || typeof extensionState !== 'object') return;
    extensionState.presetPromptGroupRuntimePresetName = name;
    extensionState.presetPromptGroupRuntimeState = clonePlain(groupState);
    delete extensionState.presetPromptGroupExtensionSyncKey;
}

export async function getPresetContext() {
    const modules = await loadModules();
    const manager = modules.presetModule.getPresetManager('openai');
    if (!manager) throw new Error('当前页面没有可用的聊天补全预设');
    return { ...modules, manager };
}

export async function listPresetNames() {
    const { manager } = await getPresetContext();
    return manager.getAllPresets().filter(Boolean);
}

export async function getCurrentPresetName() {
    const { manager } = await getPresetContext();
    return manager.getSelectedPresetName();
}

export async function getPresetSnapshot(name) {
    const { manager, openaiModule } = await getPresetContext();
    const currentName = manager.getSelectedPresetName();
    if (name === currentName && typeof openaiModule.getChatCompletionPreset === 'function') {
        const snapshot = clonePlain(openaiModule.getChatCompletionPreset(openaiModule.oai_settings));
        const state = (globalThis.top || globalThis)[GROUP_RUNTIME_KEY];
        // The visible list may have unsaved group edits, including removing all groups.
        if (state?.presetPromptGroupRuntimePresetName === name && state.presetPromptGroupRuntimeState) {
            writeGroupState(snapshot, state.presetPromptGroupRuntimeState);
        }
        return snapshot;
    }
    const preset = manager.getCompletionPresetByName(name);
    if (!preset) throw new Error(`找不到预设“${name}”`);
    return clonePlain(preset);
}

export async function savePresetSnapshot(name, preset, { refreshCurrent = true } = {}) {
    const { manager, openaiModule, scriptModule } = await getPresetContext();
    await manager.savePreset(name, clonePlain(preset), { skipUpdate: true });

    const memoryPreset = manager.getCompletionPresetByName(name);
    if (memoryPreset) replaceObject(memoryPreset, preset);

    if (refreshCurrent && name === manager.getSelectedPresetName()) {
        for (const key of ['prompts', 'prompt_order', 'extensions']) {
            if (Object.hasOwn(preset, key)) openaiModule.oai_settings[key] = clonePlain(preset[key]);
        }
        syncExternalGroupRuntime(name, preset);
        openaiModule.setupChatCompletionPromptManager?.(openaiModule.oai_settings);
        scriptModule.saveSettingsDebounced?.();
    }
}

export async function createIdentifier() {
    const { utilsModule } = await getPresetContext();
    if (typeof utilsModule.uuidv4 === 'function') return utilsModule.uuidv4();
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    return `yuyuan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function bindPresetEvents({ onSettingsUpdated, onPresetChanged }) {
    const { scriptModule } = await getPresetContext();
    const { eventSource, event_types } = scriptModule;
    if (onSettingsUpdated) eventSource.on(event_types.SETTINGS_UPDATED, onSettingsUpdated);
    if (onPresetChanged) eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, onPresetChanged);
    return () => {
        if (onSettingsUpdated) eventSource.removeListener(event_types.SETTINGS_UPDATED, onSettingsUpdated);
        if (onPresetChanged) eventSource.removeListener(event_types.OAI_PRESET_CHANGED_AFTER, onPresetChanged);
    };
}

export async function getCurrentOrderSnapshot() {
    const name = await getCurrentPresetName();
    const preset = await getPresetSnapshot(name);
    return { name, order: getGlobalPromptOrder(preset).map(entry => entry?.identifier).filter(Boolean), preset };
}

export async function repairNewPromptGroups(previousOrder) {
    const current = await getCurrentOrderSnapshot();
    const groupState = readGroupState(current.preset);
    if (!groupState) return { ...current, assigned: {} };
    const assigned = inferNewPromptGroups(previousOrder, current.order, groupState);
    if (!Object.keys(assigned).length) return { ...current, assigned };

    Object.assign(groupState.prompts, assigned);
    writeGroupState(current.preset, groupState);
    await savePresetSnapshot(current.name, current.preset, { refreshCurrent: true });
    return { ...current, assigned, groupState, path: GROUP_STATE_PATH };
}
