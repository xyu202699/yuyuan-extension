import { themeIcon } from '../theme-icon.js';
import {
    createPromptCopy,
    ensureSourcePromptGroup,
    getGlobalPromptOrder,
    getPromptById,
    inferInsertionGroup,
    insertPrompt,
    listEditablePrompts,
    readGroupState,
    removePrompt,
    resolveEnabled,
} from './core.js';
import {
    bindPresetEvents,
    createIdentifier,
    getCurrentOrderSnapshot,
    getCurrentPresetName,
    getPresetSnapshot,
    listPresetNames,
    savePresetSnapshot,
} from './st-adapter.js';
import { captureHostView, mountViewportOverlay, protectHostDrawer, releaseViewportOverlay, restoreHostView, preserveScroll, findOverlay } from '../host-view.js';

const PANEL_ID = 'yuyuan-preset-editor';
const BUTTON_ID = 'yuyuan-preset-editor-open-native';
const STYLE_ID = 'yuyuan-preset-editor-style';
const PREFS_KEY = 'yuyuan_preset_editor_v1';
const DRAFTS_KEY = 'yuyuan_preset_editor_drafts_v1';

let runtime = null;

function getRoot(input) {
    return input?.root || runtime?.root || window.top || window;
}

function toast(message, type = 'info') {
    const root = getRoot();
    const service = root.toastr || window.toastr;
    if (typeof service?.[type] === 'function') service[type](message);
}

function readPrefs(root = getRoot()) {
    try {
        const saved = JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}') || {};
        return { theme: saved.theme === 'dark' ? 'dark' : 'day' };
    } catch {
        return { theme: 'day' };
    }
}

function savePrefs(patch, root = getRoot()) {
    const next = { ...readPrefs(root), ...patch };
    delete next.autoGroup;
    try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch {}
    return next;
}

function readDrafts(root = getRoot()) {
    try {
        const drafts = JSON.parse(root.localStorage.getItem(DRAFTS_KEY) || '[]');
        return Array.isArray(drafts) ? drafts.filter(draft => draft?.id && draft?.name) : [];
    } catch {
        return [];
    }
}

function saveDrafts(drafts, root = getRoot()) {
    try { root.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch {}
}

function installStyle(root) {
    if (root.document.getElementById(STYLE_ID)) return;
    const link = root.document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    (root.document.head || root.document.documentElement).appendChild(link);
}

function iconHtml() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
}

function enhanceNativeButton(root = getRoot()) {
    const footer = root.document.querySelector('.completion_prompt_manager_footer');
    if (!footer) return false;
    let button = root.document.getElementById(BUTTON_ID);
    if (!runtime?.enabled) {
        button?.remove();
        return true;
    }
    if (!button) {
        button = root.document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'menu_button yuyuan-preset-native-button';
        button.title = '预设快速编辑';
        button.setAttribute('aria-label', '打开预设快速编辑');
        button.innerHTML = iconHtml();
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            open({ root }).catch(error => toast(`预设编辑打开失败：${error.message}`, 'error'));
        });
    }
    if (button.parentElement !== footer) footer.appendChild(button);
    return true;
}

function watchNativeButton(root) {
    runtime.observer?.disconnect?.();
    let attached = null;
    runtime.observer = new root.MutationObserver(() => {
        if (!runtime?.enabled) return;
        if (attached?.isConnected && attached.parentElement?.matches('.completion_prompt_manager_footer')) return;
        if (runtime?.buttonQueued) return;
        runtime.buttonQueued = true;
        root.requestAnimationFrame(() => {
            if (!runtime) return;
            runtime.buttonQueued = false;
            enhanceNativeButton(root);
            attached = root.document.getElementById(BUTTON_ID);
        });
    });
    runtime.observer.observe(root.document.body || root.document.documentElement, { childList: true, subtree: true });
    enhanceNativeButton(root);
    attached = root.document.getElementById(BUTTON_ID);
}

async function resetOrderSnapshot() {
    if (!runtime?.enabled) return;
    try {
        const snapshot = await getCurrentOrderSnapshot();
        runtime.presetName = snapshot.name;
        runtime.order = snapshot.order;
        runtime.orderReady = true;
    } catch {}
}

async function handleSettingsUpdated() {
    if (!runtime?.enabled || runtime.repairing) return;
    if (runtime.repairTimer) runtime.root.clearTimeout(runtime.repairTimer);
    runtime.repairTimer = runtime.root.setTimeout(async () => {
        if (!runtime?.enabled || runtime.repairing) return;
        runtime.repairing = true;
        try {
            const currentName = await getCurrentPresetName();
            if (!runtime.orderReady || currentName !== runtime.presetName) {
                await resetOrderSnapshot();
                return;
            }
            // New identifiers do not imply group membership. In particular,
            // native imports and intentionally ungrouped copies must stay so.
            await resetOrderSnapshot();
        } catch (error) {
            console.warn('[yuyuan-preset-editor] order snapshot failed', error);
        } finally {
            if (runtime) runtime.repairing = false;
        }
    }, 180);
}

function createOption(doc, value, label) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}

function fillSelect(select, entries, selected) {
    select.replaceChildren(...entries.map(([value, label]) => createOption(select.ownerDocument, value, label)));
    if (entries.some(([value]) => value === selected)) select.value = selected;
}

function buildSearchPicker(container, entries, selected, { placeholder = '输入关键词搜索', onChange = null } = {}) {
    const doc = container.ownerDocument;
    const input = doc.createElement('input');
    const toggle = doc.createElement('button');
    const menu = doc.createElement('div');
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = placeholder;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    toggle.type = 'button';
    toggle.className = 'ype-picker-toggle';
    toggle.setAttribute('aria-label', '展开选项');
    toggle.textContent = '⌄';
    menu.className = 'ype-picker-menu';
    menu.hidden = true;
    container.classList.add('ype-picker');
    container.replaceChildren(input, toggle, menu);

    const state = { entries: [], value: '' };
    const panel = container.closest('#yuyuan-preset-editor');
    const view = doc.defaultView;
    const placeMenu = () => {
        if (menu.hidden) return;
        if (container.closest('.ype-source') && view.innerWidth <= 700) return;
        const field = input.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
        const above = Math.max(0, field.top - bounds.top - 12);
        const below = Math.max(0, bounds.bottom - field.bottom - 12);
        const upwards = above > below;
        const height = Math.min(240, upwards ? above : below);
        Object.assign(menu.style, {
            position:'absolute', left:`${Math.max(8, field.left - bounds.left)}px`, right:'auto',
            width:`${Math.min(field.width, bounds.width - 16)}px`, maxHeight:`${height}px`,
            top: upwards ? `${field.top - bounds.top - 6 + panel.scrollTop}px` : `${field.bottom - bounds.top + 6 + panel.scrollTop}px`,
            transform:upwards ? 'translateY(-100%)' : 'none', zIndex:'30',
        });
    };
    const close = () => {
        menu.hidden = true;
        container.appendChild(menu);
        panel.removeEventListener('scroll', placeMenu, true);
        panel.removeEventListener('yuyuan-viewport', placeMenu);
        input.setAttribute('aria-expanded', 'false');
        container.classList.remove('is-open');
    };
    const render = () => {
        const query = input.value.trim().toLowerCase();
        const visible = state.entries.filter(([, label, keywords = '']) => !query || `${label}\n${keywords}`.toLowerCase().includes(query));
        preserveScroll(menu, () => menu.replaceChildren(...visible.map(([value, label]) => {
            const option = doc.createElement('button');
            option.type = 'button';
            option.className = 'ype-picker-option';
            option.dataset.value = value;
            option.classList.toggle('active', value === state.value);
            option.textContent = label;
            option.addEventListener('mousedown', event => event.preventDefault());
            option.addEventListener('click', () => {
                const changed = state.value !== value;
                state.value = value;
                input.value = label;
                close();
                if (changed) onChange?.(value);
            });
            return option;
        })));
        if (!visible.length) {
            const empty = doc.createElement('div');
            empty.className = 'ype-picker-empty';
            empty.textContent = '没有匹配项';
            menu.appendChild(empty);
        }
    };
    const openMenu = ({ clear = false } = {}) => {
        if (clear) input.value = '';
        menu.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        container.classList.add('is-open');
        if (container.closest('.ype-source') && view.innerWidth <= 700) container.appendChild(menu);
        else panel.appendChild(menu);
        panel.addEventListener('scroll', placeMenu, true);
        panel.addEventListener('yuyuan-viewport', placeMenu);
        render();
        placeMenu();
    };
    input.addEventListener('focus', () => { input.select(); });
    input.addEventListener('click', () => { if (menu.hidden) openMenu({ clear: true }); });
    input.addEventListener('input', () => openMenu());
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            close();
            input.value = state.entries.find(([value]) => value === state.value)?.[1] || '';
        } else if (event.key === 'Enter') {
            const first = menu.querySelector('.ype-picker-option');
            if (first) {
                event.preventDefault();
                first.click();
            }
        }
    });
    input.addEventListener('blur', () => (doc.defaultView || window).setTimeout(() => {
        const active = container.getRootNode().activeElement || doc.activeElement;
        if (container.contains(active) || menu.contains(active)) return;
        close();
        input.value = state.entries.find(([value]) => value === state.value)?.[1] || '';
    }, 100));
    toggle.addEventListener('click', () => {
        if (menu.hidden) {
            input.focus({ preventScroll: true });
            openMenu({ clear: true });
        } else {
            close();
        }
    });
    menu.addEventListener('focusout', () => view.setTimeout(() => {
        const active = panel.getRootNode().activeElement;
        if (!container.contains(active) && !menu.contains(active)) close();
    }, 100));
    panel.addEventListener('pointerdown', event => {
        if (!menu.hidden && !container.contains(event.target) && !menu.contains(event.target)) close();
    }, true);

    const api = {
        get value() { return state.value; },
        setEntries(nextEntries, nextSelected = state.value) {
            state.entries = nextEntries;
            state.value = state.entries.some(([value]) => value === nextSelected) ? nextSelected : (state.entries[0]?.[0] || '');
            input.value = state.entries.find(([value]) => value === state.value)?.[1] || '';
            render();
        },
        focus() { input.focus({ preventScroll: true }); },
    };
    api.setEntries(entries, selected);
    return api;
}

function clampNumber(value, fallback, min = 0, max = 9999) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}



function applyTheme(panel, theme) {
    const next = theme === 'dark' ? 'dark' : 'day';
    panel.dataset.theme = next;
    const button = panel.querySelector('[data-ype-action="theme"]');
    if (button) {
        button.innerHTML = themeIcon(next);
        button.title = next === 'dark' ? '切换到日间模式' : '切换到夜间模式';
        button.setAttribute('aria-label', button.title);
    }
    return next;
}

function staticPanelHtml() {
    const expandButton = field => `<button type="button" class="ype-expand-button" data-ype-action="expand" data-ype-expand-field="${field}" title="放大输入框" aria-label="放大输入框"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>`;
    return `
        <div class="ype-card" role="dialog" aria-modal="true" aria-labelledby="ype-title">
            <header class="ype-header">
                <span class="ype-brand">YUYUAN TOOLS</span>
                <h2 id="ype-title">预设快速编辑</h2>
                <div class="ype-header-actions">
                    <button class="ype-icon-button" type="button" data-ype-action="theme" aria-label="切换夜间模式"></button>
                    <button class="ype-icon-button" type="button" data-ype-action="close" aria-label="关闭">×</button>
                </div>
            </header>
            <nav class="ype-tabs" aria-label="编辑方式">
                <button type="button" class="active" data-ype-tab="copy">从其他预设取用</button>
                <button type="button" data-ype-tab="edit">编辑预设条目</button>
                <button type="button" data-ype-tab="create">新建条目</button>
            </nav>
            <main class="ype-body">
                <section class="ype-source" data-ype-page="copy">
                    <div class="ype-field"><span>来源预设</span><div data-ype-picker="source"></div></div>
                    <label class="ype-search"><span class="sr-only">搜索条目</span><input type="search" data-ype-field="search" placeholder="搜索条目名称或内容"></label>
                    <div class="ype-source-meta"><span data-ype-source-count>0 个条目</span><button type="button" data-ype-action="toggle-all">全选</button></div>
                    <div class="ype-prompt-list" data-ype-list></div>
                </section>
                <section class="ype-source ype-edit-source" data-ype-page="edit" hidden>
                    <div class="ype-field"><span>要编辑的预设</span><div data-ype-picker="edit-preset"></div></div>
                    <label class="ype-search"><span class="sr-only">搜索条目</span><input type="search" data-ype-field="edit-search" placeholder="搜索条目名称或内容"></label>
                    <div class="ype-source-meta"><span data-ype-edit-count>0 个条目</span></div>
                    <div class="ype-prompt-list" data-ype-edit-list></div>
                </section>
                <section class="ype-source" data-ype-page="create" hidden>
                    <div class="ype-create-form">
                        <label><span>条目名称</span><input type="text" data-ype-field="name" maxlength="120" placeholder="输入条目名称"></label>
                        <div class="ype-form-grid">
                            <label><span>角色</span><select data-ype-field="role"><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
                            <label><span>插入方式</span><select data-ype-field="injection"><option value="0">相对位置</option><option value="1">聊天内注入</option></select></label>
                            <label data-ype-advanced hidden><span>深度</span><input type="number" min="0" max="9999" value="4" data-ype-field="depth"></label>
                            <label data-ype-advanced hidden><span>顺序</span><input type="number" min="0" max="9999" value="100" data-ype-field="order"></label>
                        </div>
                        <label class="ype-content"><span class="ype-label-row"><span>条目内容</span>${expandButton('content')}</span><textarea data-ype-field="content" placeholder="输入提示词内容"></textarea></label>
                        <button type="button" class="ype-save-draft" data-ype-action="save-draft">保存到新建条目库</button>
                        <button type="button" class="ype-save-draft" data-ype-action="cancel-draft" hidden>取消编辑，继续新建</button>
                    </div>
                    <div class="ype-source-meta ype-draft-meta"><span data-ype-draft-count>已保存 0 条</span><button type="button" data-ype-action="toggle-drafts">全选</button></div>
                    <div class="ype-draft-list" data-ype-draft-list></div>
                </section>
                <aside class="ype-destination ype-edit-panel" data-ype-edit-panel hidden>
                    <h3>编辑条目</h3>
                    <div class="ype-edit-empty" data-ype-edit-empty>请从左侧选择一个条目</div>
                    <div class="ype-edit-form" data-ype-edit-form hidden>
                        <label><span>条目名称</span><input type="text" maxlength="120" data-ype-field="edit-name"></label>
                        <div class="ype-form-grid">
                            <label><span>角色</span><select data-ype-field="edit-role"><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
                            <label><span>当前状态</span><select data-ype-field="edit-enabled"><option value="on">开启</option><option value="off">关闭</option></select></label>
                            <label><span>插入方式</span><select data-ype-field="edit-injection"><option value="0">相对位置</option><option value="1">聊天内注入</option></select></label>
                            <label data-ype-edit-advanced hidden><span>深度</span><input type="number" min="0" max="9999" value="4" data-ype-field="edit-depth"></label>
                            <label data-ype-edit-advanced hidden><span>顺序</span><input type="number" min="0" max="9999" value="100" data-ype-field="edit-order"></label>
                        </div>
                        <label class="ype-content ype-edit-content"><span class="ype-label-row"><span>条目内容</span>${expandButton('edit-content')}</span><textarea data-ype-field="edit-content" placeholder="输入提示词内容"></textarea></label>
                        <button type="button" class="ype-delete-prompt" data-ype-action="delete-edit-prompt"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg><span>删除当前条目</span></button>
                    </div>
                </aside>
                <aside class="ype-destination" data-ype-destination>
                    <h3>导入设置</h3>
                    <div class="ype-field"><span>目标预设</span><div data-ype-picker="target"></div></div>
                    <div class="ype-field"><span>放置位置</span><div data-ype-picker="position"></div></div>
                    <label><span>所属分组</span><select data-ype-field="group"></select><small data-ype-group-hint></small></label>
                    <fieldset>
                        <legend>初始状态</legend>
                        <div class="ype-segments" data-ype-status data-mode="copy">
                            <button type="button" class="active" data-value="preserve">沿用原状态</button>
                            <button type="button" data-value="on">开启</button>
                            <button type="button" data-value="off">关闭</button>
                        </div>
                    </fieldset>
                </aside>
            </main>
            <footer class="ype-footer">
                <span data-ype-message>请选择要取用的条目</span>
                <div><button type="button" class="ype-secondary" data-ype-action="close">取消</button><button type="button" class="ype-primary" data-ype-action="submit">导入条目</button></div>
            </footer>
            <div class="ype-busy" data-ype-busy hidden><span></span><b>正在保存预设…</b></div>
            <div class="ype-expand-editor" data-ype-expand-editor hidden>
                <section role="dialog" aria-modal="true" aria-labelledby="ype-expand-title">
                    <header><h3 id="ype-expand-title">编辑条目内容</h3><button type="button" data-ype-action="expand-close" aria-label="关闭">×</button></header>
                    <textarea data-ype-expand-textarea></textarea>
                    <footer><button type="button" class="ype-secondary" data-ype-action="expand-close">取消</button><button type="button" class="ype-primary" data-ype-action="expand-apply">应用内容</button></footer>
                </section>
            </div>
        </div>`;
}

function closePanel(root = getRoot(), { restore = true } = {}) {
    const panel = findOverlay(root, PANEL_ID);
    if (!panel) return;
    const hostView = panel.__ypeHostView;
    if (panel.__ypeOnKey) root.document.removeEventListener('keydown', panel.__ypeOnKey);
    releaseViewportOverlay(panel);
    panel.remove();
    root.document.documentElement.classList.remove('ype-open');
    if (restore) restoreHostView(root, hostView);
}

function buildController(panel, { presets, currentName }) {
    const root = getRoot();
    const state = {
        mode: 'copy',
        sourceName: presets.find(name => name !== currentName) || currentName,
        targetName: currentName,
        sourcePreset: null,
        targetPreset: null,
        sourceItems: [],
        selected: new Set(),
        editPresetName: currentName,
        editPreset: null,
        editItems: [],
        editIdentifier: '',
        drafts: readDrafts(root),
        selectedDrafts: new Set(),
        status: 'preserve',
        saving: false,
    };
    state.drafts.forEach(draft => state.selectedDrafts.add(draft.id));
    const q = selector => panel.querySelector(selector);
    const qa = selector => Array.from(panel.querySelectorAll(selector));
    let loadSource;
    let loadTarget;
    let loadEditPreset;
    let updateAutoGroupHint;
    let sourceRequest = 0, targetRequest = 0, editRequest = 0;

    const presetEntries = presets.map(name => [name, name, name]);
    const sourcePicker = buildSearchPicker(q('[data-ype-picker="source"]'), presetEntries, state.sourceName, {
        placeholder: '搜索来源预设',
        onChange: async value => {
            state.sourceName = value;
            try { await loadSource(); } catch (error) { setMessage(error.message, 'error'); }
        },
    });
    const targetPicker = buildSearchPicker(q('[data-ype-picker="target"]'), presets.map(name => [name, name === currentName ? `${name}（当前）` : name, name]), state.targetName, {
        placeholder: '搜索目标预设',
        onChange: async value => {
            state.targetName = value;
            try { await loadTarget(); } catch (error) { setMessage(error.message, 'error'); }
        },
    });
    const editPresetPicker = buildSearchPicker(q('[data-ype-picker="edit-preset"]'), presets.map(name => [name, name === currentName ? `${name}（当前）` : name, name]), state.editPresetName, {
        placeholder: '搜索要编辑的预设',
        onChange: async value => {
            state.editPresetName = value;
            state.editIdentifier = '';
            try { await loadEditPreset(); } catch (error) { setMessage(error.message, 'error'); }
        },
    });
    const positionPicker = buildSearchPicker(q('[data-ype-picker="position"]'), [], '', {
        placeholder: '搜索条目名称',
        onChange: () => updateAutoGroupHint?.(),
    });

    const setMessage = (message, tone = '') => {
        const node = q('[data-ype-message]');
        node.textContent = message;
        node.dataset.tone = tone;
    };

    const renderSourceItems = () => {
        const query = q('[data-ype-field="search"]').value.trim().toLowerCase();
        const visible = state.sourceItems.filter(item => !query || `${item.name}\n${item.content}`.toLowerCase().includes(query));
        const list = q('[data-ype-list]');
        preserveScroll(list, () => list.replaceChildren(...visible.map(item => {
            const row = root.document.createElement('label');
            row.className = 'ype-prompt-row';
            row.dataset.identifier = item.identifier;
            const checkbox = root.document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = state.selected.has(item.identifier);
            checkbox.addEventListener('change', () => {
                checkbox.checked ? state.selected.add(item.identifier) : state.selected.delete(item.identifier);
                renderSelection();
            });
            const check = root.document.createElement('i');
            const text = root.document.createElement('span');
            const name = root.document.createElement('b');
            name.textContent = item.name;
            const preview = root.document.createElement('small');
            preview.textContent = item.content.replace(/\s+/g, ' ').trim() || '空内容';
            text.append(name, preview);
            const role = root.document.createElement('em');
            role.textContent = item.role;
            row.append(checkbox, check, text, role);
            return row;
        })));
        q('[data-ype-source-count]').textContent = `${visible.length} 个条目`;
        q('[data-ype-action="toggle-all"]').textContent = visible.length && visible.every(item => state.selected.has(item.identifier)) ? '取消全选' : '全选';
        if (!visible.length) {
            const empty = root.document.createElement('div');
            empty.className = 'ype-empty';
            empty.textContent = state.sourceItems.length ? '没有符合搜索条件的条目' : '这个预设没有可复制的自定义条目';
            list.appendChild(empty);
        }
    };

    const renderSelection = () => {
        if (state.mode === 'copy') setMessage(state.selected.size ? `已选择 ${state.selected.size} 个条目` : '请选择要取用的条目');
        const rows = qa('[data-ype-list] [data-identifier]');
        rows.forEach(row => { row.querySelector('input').checked = state.selected.has(row.dataset.identifier); });
        q('[data-ype-action="toggle-all"]').textContent = rows.length && rows.every(row => state.selected.has(row.dataset.identifier)) ? '取消全选' : '全选';
    };

    const selectedEditItem = () => state.editItems.find(item => item.identifier === state.editIdentifier) || null;

    const fillEditForm = () => {
        const item = selectedEditItem();
        q('[data-ype-edit-empty]').hidden = Boolean(item);
        q('[data-ype-edit-form]').hidden = !item;
        if (!item) return;
        q('[data-ype-field="edit-name"]').value = item.name;
        q('[data-ype-field="edit-role"]').value = ['system', 'user', 'assistant'].includes(item.role) ? item.role : 'system';
        q('[data-ype-field="edit-enabled"]').value = item.enabled ? 'on' : 'off';
        q('[data-ype-field="edit-injection"]').value = Number(item.prompt?.injection_position) === 1 ? '1' : '0';
        q('[data-ype-field="edit-depth"]').value = clampNumber(item.prompt?.injection_depth, 4);
        q('[data-ype-field="edit-order"]').value = clampNumber(item.prompt?.injection_order, 100);
        q('[data-ype-field="edit-content"]').value = item.content;
        qa('[data-ype-edit-advanced]').forEach(label => label.hidden = Number(item.prompt?.injection_position) !== 1);
    };

    const renderEditItems = () => {
        const query = q('[data-ype-field="edit-search"]').value.trim().toLowerCase();
        const visible = state.editItems.filter(item => !query || `${item.name}\n${item.content}`.toLowerCase().includes(query));
        const list = q('[data-ype-edit-list]');
        preserveScroll(list, () => list.replaceChildren(...visible.map(item => {
            const row = root.document.createElement('button');
            row.type = 'button';
            row.className = 'ype-prompt-row ype-edit-row';
            row.classList.toggle('active', item.identifier === state.editIdentifier);
            row.dataset.identifier = item.identifier;
            const text = root.document.createElement('span');
            const name = root.document.createElement('b');
            name.textContent = item.name;
            const preview = root.document.createElement('small');
            preview.textContent = item.content.replace(/\s+/g, ' ').trim() || '空内容';
            text.append(name, preview);
            const role = root.document.createElement('em');
            role.textContent = item.role;
            row.append(text, role);
            row.addEventListener('click', () => {
                state.editIdentifier = item.identifier;
                qa('[data-ype-edit-list] [data-identifier]').forEach(button => button.classList.toggle('active', button.dataset.identifier === state.editIdentifier));
                fillEditForm();
                setMessage(`正在编辑「${item.name}」`);
            });
            return row;
        })));
        q('[data-ype-edit-count]').textContent = `${visible.length} 个条目`;
        if (!visible.length) {
            const empty = root.document.createElement('div');
            empty.className = 'ype-empty';
            empty.textContent = state.editItems.length ? '没有符合搜索条件的条目' : '这个预设没有可编辑的自定义条目';
            list.appendChild(empty);
        }
    };

    const updateSubmitLabel = () => {
        q('[data-ype-action="submit"]').textContent = state.mode === 'copy'
            ? '导入条目'
            : state.mode === 'edit'
                ? '保存修改'
                : `导入已选条目${state.selectedDrafts.size ? `（${state.selectedDrafts.size}）` : ''}`;
    };

    const renderDrafts = () => {
        const list = q('[data-ype-draft-list]');
        preserveScroll(list, () => list.replaceChildren(...state.drafts.map(draft => {
            const row = root.document.createElement('label');
            row.className = 'ype-draft-row';
            const checkbox = root.document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = state.selectedDrafts.has(draft.id);
            checkbox.addEventListener('change', () => {
                checkbox.checked ? state.selectedDrafts.add(draft.id) : state.selectedDrafts.delete(draft.id);
                renderDrafts();
            });
            const check = root.document.createElement('i');
            const text = root.document.createElement('span');
            const name = root.document.createElement('b');
            name.textContent = draft.name;
            const preview = root.document.createElement('small');
            preview.textContent = String(draft.content || '').replace(/\s+/g, ' ').trim() || '空内容';
            text.append(name, preview);
            text.setAttribute('role', 'button');
            text.tabIndex = 0;
            text.title = '编辑已保存条目';
            const editDraft = event => {
                event.preventDefault();
                state.editingDraftId = draft.id;
                for (const [field, value] of Object.entries({name:draft.name, content:draft.content || '', role:draft.role || 'system', injection:draft.injection_position || 0, depth:draft.injection_depth ?? 4, order:draft.injection_order ?? 100})) {
                    q(`[data-ype-field="${field}"]`).value = value;
                }
                qa('[data-ype-advanced]').forEach(label => label.hidden = Number(draft.injection_position) !== 1);
                q('[data-ype-action="save-draft"]').textContent = '保存条目修改';
                q('[data-ype-action="cancel-draft"]').hidden = false;
                q('[data-ype-field="name"]').focus({preventScroll:true});
            };
            text.addEventListener('click', editDraft);
            text.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') editDraft(event); });
            const remove = root.document.createElement('button');
            remove.type = 'button';
            remove.className = 'ype-draft-remove';
            remove.title = '从新建条目库删除';
            remove.textContent = '×';
            remove.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                state.drafts = state.drafts.filter(item => item.id !== draft.id);
                state.selectedDrafts.delete(draft.id);
                if (state.editingDraftId === draft.id) resetDraftEditor();
                saveDrafts(state.drafts, root);
                renderDrafts();
            });
            row.append(checkbox, check, text, remove);
            return row;
        })));
        if (!state.drafts.length) {
            const empty = root.document.createElement('div');
            empty.className = 'ype-empty ype-draft-empty';
            empty.textContent = '保存的新条目会长期留在这里，可反复导入不同预设';
            list.appendChild(empty);
        }
        q('[data-ype-draft-count]').textContent = `已保存 ${state.drafts.length} 条 · 已选 ${state.selectedDrafts.size} 条`;
        q('[data-ype-action="toggle-drafts"]').textContent = state.drafts.length && state.drafts.every(draft => state.selectedDrafts.has(draft.id)) ? '取消全选' : '全选';
        updateSubmitLabel();
        if (state.mode === 'create') setMessage(state.selectedDrafts.size ? `已选择 ${state.selectedDrafts.size} 个已保存条目` : '请先保存并选择要导入的新条目');
    };

    const resetDraftEditor = () => {
        state.editingDraftId = null;
        q('[data-ype-field="name"]').value = '';
        q('[data-ype-field="content"]').value = '';
        q('[data-ype-action="save-draft"]').textContent = '保存到新建条目库';
        q('[data-ype-action="cancel-draft"]').hidden = true;
    };
    q('[data-ype-action="cancel-draft"]').addEventListener('click', resetDraftEditor);
    const saveDraft = () => {
        const nameInput = q('[data-ype-field="name"]');
        const contentInput = q('[data-ype-field="content"]');
        const name = nameInput.value.trim();
        if (!name) {
            setMessage('请先填写条目名称', 'error');
            nameInput.focus({ preventScroll: true });
            return;
        }
        const injectionPosition = Number(q('[data-ype-field="injection"]').value) === 1 ? 1 : 0;
        const draft = {
            id: state.editingDraftId || root.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name,
            content: contentInput.value,
            role: q('[data-ype-field="role"]').value,
            injection_position: injectionPosition,
            injection_depth: clampNumber(q('[data-ype-field="depth"]').value, 4),
            injection_order: clampNumber(q('[data-ype-field="order"]').value, 100),
        };
        const index = state.drafts.findIndex(item => item.id === draft.id);
        if (index >= 0) state.drafts[index] = draft;
        else state.drafts.push(draft);
        state.selectedDrafts.add(draft.id);
        saveDrafts(state.drafts, root);
        resetDraftEditor();
        nameInput.focus({ preventScroll: true });
        renderDrafts();
    };

    loadSource = async () => {
        const request = ++sourceRequest, name = state.sourceName;
        state.sourcePreset = null; state.sourceItems = []; state.selected.clear();
        renderSourceItems(); renderSelection();
        const preset = await getPresetSnapshot(name);
        if (request !== sourceRequest || name !== state.sourceName || !panel.isConnected) return;
        state.sourcePreset = preset;
        state.sourceItems = listEditablePrompts(state.sourcePreset);
        state.selected.clear();
        renderSourceItems();
        renderSelection();
    };

    loadEditPreset = async () => {
        const request = ++editRequest, name = state.editPresetName;
        state.editPreset = null; state.editItems = [];
        renderEditItems(); fillEditForm();
        const preset = await getPresetSnapshot(name);
        if (request !== editRequest || name !== state.editPresetName || !panel.isConnected) return;
        state.editPreset = preset;
        state.editItems = listEditablePrompts(state.editPreset);
        if (!state.editItems.some(item => item.identifier === state.editIdentifier)) {
            state.editIdentifier = state.editItems[0]?.identifier || '';
        }
        renderEditItems();
        fillEditForm();
        if (state.mode === 'edit') {
            const item = selectedEditItem();
            setMessage(item ? `正在编辑「${item.name}」` : '这个预设没有可编辑的自定义条目');
        }
    };

    updateAutoGroupHint = () => {
        const select = q('[data-ype-field="group"]');
        const groupState = readGroupState(state.targetPreset);
        const groups = groupState?.groups || [];
        if (select.value === '__preserve__') {
            q('[data-ype-group-hint]').textContent = state.mode === 'copy'
                ? '按来源分组及顺序导入；未分组条目保持未分组，仅复用名称完全相同的组'
                : '新建条目默认不加入分组';
            return;
        }
        if (select.value === '__auto__') {
            const groupId = inferInsertionGroup(state.targetPreset, positionPicker.value);
            const group = groups.find(item => String(item.id) === String(groupId));
            q('[data-ype-group-hint]').textContent = group
                ? `将自动归入「${group.name || '未命名分组'}」`
                : '插入位置附近没有分组，将保持未分组';
        } else if (!select.value) {
            q('[data-ype-group-hint]').textContent = '这些条目不会加入任何分组';
        } else {
            const group = groups.find(item => String(item.id) === String(select.value));
            q('[data-ype-group-hint]').textContent = group ? `将加入「${group.name || '未命名分组'}」` : '';
        }
    };

    loadTarget = async () => {
        const request = ++targetRequest, name = state.targetName;
        state.targetPreset = null;
        const preset = await getPresetSnapshot(name);
        if (request !== targetRequest || name !== state.targetName || !panel.isConnected) return;
        state.targetPreset = preset;
        const order = getGlobalPromptOrder(state.targetPreset);
        const options = [['top', '最前面', '顶部 开头'], ['bottom', '最后面', '底部 末尾']];
        for (const entry of order) {
            const prompt = getPromptById(state.targetPreset, entry?.identifier);
            if (prompt) options.push([prompt.identifier, `在「${prompt.name || prompt.identifier}」之后`, `${prompt.name || ''}\n${prompt.content || ''}`]);
        }
        positionPicker.setEntries(options, 'bottom');

        const groupState = readGroupState(state.targetPreset);
        const groups = groupState?.groups || [];
        fillSelect(q('[data-ype-field="group"]'), [['__auto__', '跟随插入位置分组'], ['__preserve__', '保留来源分组（未分组仍不分组）'], ['', '不加入分组'], ...groups.map(group => [String(group.id), String(group.name || '未命名分组')])], '__auto__');
        updateAutoGroupHint();
    };

    const switchMode = mode => {
        state.mode = mode;
        qa('[data-ype-tab]').forEach(button => button.classList.toggle('active', button.dataset.ypeTab === mode));
        qa('[data-ype-page]').forEach(page => page.hidden = page.dataset.ypePage !== mode);
        q('[data-ype-destination]').hidden = mode === 'edit';
        q('[data-ype-edit-panel]').hidden = mode !== 'edit';
        q('[data-ype-status]').dataset.mode = mode;
        q('[data-ype-status] [data-value="preserve"]').hidden = mode !== 'copy';
        if (mode === 'create' && state.status === 'preserve') {
            state.status = 'on';
            qa('[data-ype-status] button').forEach(button => button.classList.toggle('active', button.dataset.value === state.status));
        }
        updateSubmitLabel();
        updateAutoGroupHint();
        setMessage(mode === 'copy'
            ? (state.selected.size ? `已选择 ${state.selected.size} 个条目` : '请选择要取用的条目')
            : mode === 'edit'
                ? (selectedEditItem() ? `正在编辑「${selectedEditItem().name}」` : '请选择要修改的条目')
                : (state.selectedDrafts.size ? `已选择 ${state.selectedDrafts.size} 个已保存条目` : '先把新条目保存到条目库，再导入预设'));
    };

    const saveEditedPrompt = async () => {
        const identifier = state.editIdentifier;
        if (!identifier) throw new Error('请先选择一个要修改的条目');
        const preset = await getPresetSnapshot(state.editPresetName);
        const prompt = getPromptById(preset, identifier);
        if (!prompt) throw new Error('这个条目已不存在，请重新选择');
        const name = q('[data-ype-field="edit-name"]').value.trim();
        if (!name) throw new Error('条目名称不能为空');
        prompt.name = name;
        prompt.role = q('[data-ype-field="edit-role"]').value;
        prompt.content = q('[data-ype-field="edit-content"]').value;
        prompt.injection_position = Number(q('[data-ype-field="edit-injection"]').value) === 1 ? 1 : 0;
        prompt.injection_depth = clampNumber(q('[data-ype-field="edit-depth"]').value, 4);
        prompt.injection_order = clampNumber(q('[data-ype-field="edit-order"]').value, 100);
        const orderEntry = getGlobalPromptOrder(preset).find(entry => entry?.identifier === identifier);
        if (orderEntry) orderEntry.enabled = q('[data-ype-field="edit-enabled"]').value === 'on';
        if (runtime) runtime.repairing = true;
        await savePresetSnapshot(state.editPresetName, preset, { refreshCurrent: true });
        await resetOrderSnapshot();
        state.editPreset = preset;
        state.editItems = listEditablePrompts(preset);
        renderEditItems();
        fillEditForm();
        setMessage(`「${name}」已保存`, 'success');
        toast(`“${state.editPresetName}”中的「${name}」已保存`, 'success');
    };

    const deleteEditedPrompt = async () => {
        if (state.saving) return;
        const item = selectedEditItem();
        if (!item) throw new Error('请先选择一个要删除的条目');
        if (!root.confirm(`确定删除“${state.editPresetName}”中的「${item.name}」吗？\n此操作会立即保存。`)) return;
        setBusy(true);
        try {
            const preset = await getPresetSnapshot(state.editPresetName);
            if (!removePrompt(preset, item.identifier)) throw new Error('这个条目已经不存在');
            if (runtime) runtime.repairing = true;
            await savePresetSnapshot(state.editPresetName, preset, { refreshCurrent: true });
            await resetOrderSnapshot();
            state.editIdentifier = '';
            await loadEditPreset();
            toast(`已删除「${item.name}」`, 'success');
        } finally {
            if (runtime) runtime.repairing = false;
            if (panel.isConnected) setBusy(false);
        }
    };

    const closeExpandedEditor = () => {
        const editor = q('[data-ype-expand-editor]');
        q('[data-ype-expand-textarea]').blur();
        editor.hidden = true;
        panel.scrollTop = Number(editor.dataset.previousScroll || 0);
        delete editor.dataset.targetField;
    };

    const openExpandedEditor = field => {
        const input = q(`[data-ype-field="${field}"]`);
        if (!input) return;
        const editor = q('[data-ype-expand-editor]');
        editor.dataset.targetField = field;
        editor.dataset.previousScroll = panel.scrollTop;
        panel.scrollTop = 0;
        q('[data-ype-expand-textarea]').value = input.value;
        q('#ype-expand-title').textContent = field === 'edit-content' ? '编辑预设条目内容' : '新建条目内容';
        editor.hidden = false;
        if (root.matchMedia('(pointer:fine)').matches) {
            root.requestAnimationFrame(() => q('[data-ype-expand-textarea]').focus({ preventScroll: true }));
        }
    };

    const applyExpandedEditor = () => {
        const editor = q('[data-ype-expand-editor]');
        const input = q(`[data-ype-field="${editor.dataset.targetField || ''}"]`);
        if (input) {
            input.value = q('[data-ype-expand-textarea]').value;
            input.dispatchEvent(new root.Event('input', { bubbles: true }));
        }
        closeExpandedEditor();
    };
    panel.__ypeCloseExpanded = closeExpandedEditor;

    const setBusy = busy => {
        state.saving = busy;
        q('[data-ype-busy]').hidden = !busy;
        qa('button,select,input,textarea').forEach(control => control.disabled = busy);
    };

    const submit = async () => {
        if (state.saving) return;
        setBusy(true);
        try {
            if (state.mode === 'edit' ? !state.editPreset : (!state.targetPreset || (state.mode === 'copy' && !state.sourcePreset))) {
                throw new Error('预设仍在读取，请稍后再保存');
            }
            if (state.mode === 'edit') {
                await saveEditedPrompt();
                return;
            }
            const target = await getPresetSnapshot(state.targetName);
            const selectedGroup = q('[data-ype-field="group"]').value;
            let position = positionPicker.value;
            const groupId = selectedGroup === '__auto__' ? inferInsertionGroup(target, position) : selectedGroup === '__preserve__' ? '' : selectedGroup;
            let count = 0;

            if (state.mode === 'copy') {
                const selectedItems = state.sourceItems.filter(item => state.selected.has(item.identifier));
                if (!selectedItems.length) throw new Error('请至少选择一个条目');
                const sourceGroupIds = new Map();
                if (selectedGroup === '__preserve__') {
                    const sourceState = readGroupState(state.sourcePreset);
                    // Create groups in the author's order, not first prompt occurrence.
                    for (const sourceGroup of sourceState?.groups || []) {
                        const sourceGroupKey = String(sourceGroup.id);
                        const member = selectedItems.find(item => String(sourceState.prompts[item.identifier]?.groupId || '') === sourceGroupKey);
                        if (!member) continue;
                        const mappedId = ensureSourcePromptGroup(target, state.sourcePreset, member.identifier, await createIdentifier());
                        if (mappedId) sourceGroupIds.set(sourceGroupKey, mappedId);
                    }
                }
                for (const item of selectedItems) {
                    const identifier = await createIdentifier();
                    const prompt = createPromptCopy(item.prompt, identifier);
                    let itemGroupId = groupId;
                    if (selectedGroup === '__preserve__') {
                        const sourceState = readGroupState(state.sourcePreset);
                        const sourceGroupKey = String(sourceState?.prompts?.[item.identifier]?.groupId || '');
                        itemGroupId = sourceGroupIds.get(sourceGroupKey) || '';
                    }
                    insertPrompt(target, prompt, {
                        position,
                        enabled: resolveEnabled(state.status, item.enabled),
                        groupId: itemGroupId,
                    });
                    position = identifier;
                    count++;
                }
            } else {
                const selectedDrafts = state.drafts.filter(draft => state.selectedDrafts.has(draft.id));
                if (!selectedDrafts.length) throw new Error('请先保存并选择至少一个新条目');
                for (const draft of selectedDrafts) {
                    const identifier = await createIdentifier();
                    const prompt = createPromptCopy(draft, identifier);
                    insertPrompt(target, prompt, { position, enabled: resolveEnabled(state.status, true), groupId });
                    position = identifier;
                    count++;
                }
            }

            if (runtime) runtime.repairing = true;
            await savePresetSnapshot(state.targetName, target, { refreshCurrent: true });
            await resetOrderSnapshot();
            toast(`${count} 个条目已写入“${state.targetName}”`, 'success');
            closePanel(root);
        } catch (error) {
            setMessage(error.message || String(error), 'error');
            toast(`保存失败：${error.message || error}`, 'error');
        } finally {
            if (runtime) runtime.repairing = false;
            if (panel.isConnected) setBusy(false);
        }
    };

    panel.addEventListener('click', event => {
        const expand = event.target.closest('[data-ype-action="expand"]');
        if (expand) {
            event.preventDefault();
            openExpandedEditor(expand.dataset.ypeExpandField);
            return;
        }
        if (event.target.closest('[data-ype-action="expand-apply"]')) {
            applyExpandedEditor();
            return;
        }
        if (event.target.closest('[data-ype-action="expand-close"]') || event.target.matches('[data-ype-expand-editor]')) {
            closeExpandedEditor();
            return;
        }
        if (event.target.closest('[data-ype-action="delete-edit-prompt"]')) {
            deleteEditedPrompt().catch(error => {
                setMessage(error.message || String(error), 'error');
                toast(`删除失败：${error.message || error}`, 'error');
            });
            return;
        }
        if (event.target === panel || event.target.closest('[data-ype-action="close"]')) {
            closePanel(root);
            return;
        }
        if (event.target.closest('[data-ype-action="theme"]')) {
            const theme = panel.dataset.theme === 'dark' ? 'day' : 'dark';
            applyTheme(panel, theme);
            savePrefs({ theme }, root);
        }
    });
    qa('[data-ype-tab]').forEach(button => button.addEventListener('click', () => switchMode(button.dataset.ypeTab)));
    q('[data-ype-field="search"]').addEventListener('input', renderSourceItems);
    q('[data-ype-field="edit-search"]').addEventListener('input', renderEditItems);
    q('[data-ype-action="toggle-all"]').addEventListener('click', () => {
        const query = q('[data-ype-field="search"]').value.trim().toLowerCase();
        const visible = state.sourceItems.filter(item => !query || `${item.name}\n${item.content}`.toLowerCase().includes(query));
        const allSelected = visible.length && visible.every(item => state.selected.has(item.identifier));
        visible.forEach(item => allSelected ? state.selected.delete(item.identifier) : state.selected.add(item.identifier));
        renderSelection();
    });
    q('[data-ype-action="save-draft"]').addEventListener('click', saveDraft);
    q('[data-ype-action="toggle-drafts"]').addEventListener('click', () => {
        const allSelected = state.drafts.length && state.drafts.every(draft => state.selectedDrafts.has(draft.id));
        state.drafts.forEach(draft => allSelected ? state.selectedDrafts.delete(draft.id) : state.selectedDrafts.add(draft.id));
        renderDrafts();
    });
    qa('[data-ype-status] button').forEach(button => button.addEventListener('click', () => {
        state.status = button.dataset.value;
        qa('[data-ype-status] button').forEach(item => item.classList.toggle('active', item === button));
    }));
    q('[data-ype-field="injection"]').addEventListener('change', event => {
        qa('[data-ype-advanced]').forEach(label => label.hidden = event.currentTarget.value !== '1');
    });
    q('[data-ype-field="edit-injection"]').addEventListener('change', event => {
        qa('[data-ype-edit-advanced]').forEach(label => label.hidden = event.currentTarget.value !== '1');
    });
    q('[data-ype-field="group"]').addEventListener('change', updateAutoGroupHint);
    q('[data-ype-action="submit"]').addEventListener('click', submit);

    renderDrafts();
    return Promise.all([loadSource(), loadTarget(), loadEditPreset()]);
}

export async function open(options = {}) {
    const root = getRoot(options);
    installStyle(root);
    closePanel(root, { restore: false });
    const hostView = captureHostView(root);
    const [presets, currentName] = await Promise.all([listPresetNames(), getCurrentPresetName()]);
    if (!presets.length) throw new Error('没有找到聊天补全预设');

    const panel = root.document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = staticPanelHtml();
    panel.appendChild(panel.querySelector('[data-ype-expand-editor]'));
    panel.__ypeHostView = hostView;
    protectHostDrawer(panel);
    applyTheme(panel, readPrefs(root).theme);
    mountViewportOverlay(root, panel);
    await panel.__yuyuanStyleReady;
    root.document.documentElement.classList.add('ype-open');
    const onKey = event => {
        if (event.key !== 'Escape') return;
        const expanded = panel.querySelector('[data-ype-expand-editor]');
        if (expanded && !expanded.hidden) panel.__ypeCloseExpanded?.();
        else closePanel(root);
    };
    panel.__ypeOnKey = onKey;
    root.document.addEventListener('keydown', onKey);
    await buildController(panel, { presets, currentName });
    return panel;
}

export async function setEnabled(enabled, options = {}) {
    const root = getRoot(options);
    if (!runtime) await init({ root, enabled });
    runtime.enabled = enabled !== false;
    if (runtime.enabled) {
        enhanceNativeButton(root);
        await resetOrderSnapshot();
    } else {
        root.document.getElementById(BUTTON_ID)?.remove();
        closePanel(root);
    }
}

export function setAutoGroup(_enabled, options = {}) {
    getRoot(options);
    resetOrderSnapshot();
}

export function getPreferences(options = {}) {
    return readPrefs(getRoot(options));
}

export async function init(options = {}) {
    const root = getRoot(options);
    if (runtime) {
        runtime.enabled = options.enabled !== false;
        enhanceNativeButton(root);
        return runtime;
    }
    runtime = { root, enabled: options.enabled !== false, observer: null, unbindEvents: null, order: [], orderReady: false, presetName: '', repairing: false, repairTimer: null };
    installStyle(root);
    watchNativeButton(root);
    runtime.unbindEvents = await bindPresetEvents({
        onSettingsUpdated: handleSettingsUpdated,
        onPresetChanged: () => root.setTimeout(resetOrderSnapshot, 0),
    });
    await resetOrderSnapshot();
    root.__YUYUAN_PRESET_EDITOR__ = { open, setEnabled, setAutoGroup, getPreferences };
    return runtime;
}

export function destroy() {
    if (!runtime) return;
    runtime.observer?.disconnect?.();
    runtime.unbindEvents?.();
    if (runtime.repairTimer) runtime.root.clearTimeout(runtime.repairTimer);
    runtime.root.document.getElementById(BUTTON_ID)?.remove();
    closePanel(runtime.root);
    delete runtime.root.__YUYUAN_PRESET_EDITOR__;
    runtime = null;
}

export { enhanceNativeButton as enhanceNative };
