import { normalizeStore } from './core.js';

const SETTINGS_KEY = 'yuyuan_regex_groups';

const clone = value => {
    try { return structuredClone(value); }
    catch { return JSON.parse(JSON.stringify(value)); }
};

export async function createSillyTavernAdapter(root = window) {
    const [engine, script, extensions, groups] = await Promise.all([
        import('../../../../regex/engine.js'),
        import('../../../../../../script.js'),
        import('../../../../../extensions.js'),
        import('../../../../../group-chats.js'),
    ]);

    const typeFor = scope => ({
        global: engine.SCRIPT_TYPES.GLOBAL,
        preset: engine.SCRIPT_TYPES.PRESET,
        scoped: engine.SCRIPT_TYPES.SCOPED,
    })[scope];

    function context(scope) {
        if (scope === 'global') return { available: true, key: 'global', label: '全部聊天' };
        if (scope === 'preset') {
            const api = engine.getCurrentPresetAPI?.();
            const name = engine.getCurrentPresetName?.();
            return {
                available: !!(api && name),
                key: api && name ? `${api}::${name}` : '',
                label: name || '未选择预设',
                api,
                name,
            };
        }
        const chid = script.this_chid;
        const numericChid = chid === undefined || chid === null || chid === '' ? NaN : Number(chid);
        const character = Number.isInteger(numericChid) ? script.characters?.[numericChid] : null;
        const groupChat = !!groups.selected_group;
        return {
            available: !!character && !groupChat,
            key: character?.avatar ? `avatar:${character.avatar}` : (character ? `chid:${numericChid}` : ''),
            label: groupChat ? '群聊不支持角色局部正则' : (character?.name || '未选择角色'),
            character,
            groupChat,
        };
    }

    function getStore() {
        return normalizeStore(extensions.extension_settings?.[SETTINGS_KEY]);
    }

    function saveStore(store) {
        extensions.extension_settings[SETTINGS_KEY] = normalizeStore(store);
        script.saveSettingsDebounced?.();
    }

    function getScripts(scope) {
        const info = context(scope);
        if (!info.available && scope !== 'global') return [];
        const scripts = engine.getScriptsByType(typeFor(scope));
        return Array.isArray(scripts) ? clone(scripts) : [];
    }

    async function saveScripts(scope, scripts, expectedKey) {
        const info = context(scope);
        if (expectedKey !== undefined && info.key !== expectedKey) throw new Error('当前角色或预设已切换，请重新选择后再操作');
        if (!info.available) throw new Error(scope === 'preset' ? '请先选择一个预设' : '请先进入单个角色聊天');
        await engine.saveScriptsByType(clone(scripts), typeFor(scope));
        engine.RegexProvider?.instance?.clear?.();
        script.saveSettingsDebounced?.();
    }

    async function afterMutation() {
        // RegexProvider is cleared by saveScripts. Reloading the current chat here
        // also closes whichever settings drawer opened the manager, so leave the
        // surrounding SillyTavern view untouched and apply changes on the next render.
        return;
    }

    function notify(message, type = 'info') {
        const toast = root.toastr || window.toastr;
        if (toast && typeof toast[type] === 'function') toast[type](message);
    }

    function openNativeEditor(id) {
        const row = root.document.getElementById(String(id));
        const button = row?.querySelector('.edit_existing_regex');
        if (!button) return false;
        button.click();
        return true;
    }

    function downloadJson(data, fileName) {
        const blob = new Blob([JSON.stringify(data, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = root.document.createElement('a');
        link.href = url;
        link.download = fileName;
        root.document.body.appendChild(link);
        link.click();
        link.remove();
        root.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return {
        root,
        engine,
        script,
        settingsKey: SETTINGS_KEY,
        context,
        getStore,
        saveStore,
        getScripts,
        saveScripts,
        afterMutation,
        notify,
        openNativeEditor,
        downloadJson,
        uuid: () => root.crypto?.randomUUID?.() || `rx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    };
}
