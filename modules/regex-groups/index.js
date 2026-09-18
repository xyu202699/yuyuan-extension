import { themeIcon } from '../theme-icon.js';
import {
    DEFAULT_GROUP_ID,
    SCOPES,
    assignScripts,
    assignedGroup,
    createGroup,
    deleteGroup,
    listGroups,
    makeCrossScopeMove,
    migrateOwnerKey,
    parseImportPayload,
    pruneAssignments,
    removeAssignments,
    removeScriptsByIds,
    renameGroup,
    scriptsInGroup,
} from './core.js';
import { createSillyTavernAdapter } from './st-adapter.js';
import { captureHostView, mountViewportOverlay, protectHostDrawer, releaseViewportOverlay, restoreHostView, updateHtml, findOverlay } from '../host-view.js';

const SCOPE_LABELS = Object.freeze({ global: '全局', preset: '预设', scoped: '局部' });
const THEME_KEY = 'yuyuan_regex_groups_theme_v1';
const NATIVE_COLLAPSE_KEY = 'yuyuan_regex_native_collapsed_v1';
let instance = null;

const TOOL_ICONS = Object.freeze({
    select: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m7.5 12 3 3 6-6"/></svg>',
    clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
    enable: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.3-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.3 5.5-9.2 5.5S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>',
    disable: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 5.2 19.8 18.8M9.5 6.8A9.7 9.7 0 0 1 12 6.5c5.9 0 9.2 5.5 9.2 5.5a16 16 0 0 1-2.5 3.1M6.6 8.2A15.8 15.8 0 0 0 2.8 12s3.3 5.5 9.2 5.5a9.6 9.6 0 0 0 3.1-.5"/><path d="M10.2 10.2a2.7 2.7 0 0 0 3.6 3.6"/></svg>',
    move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h6l1.7 2H21v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z"/><path d="m10 14 2-2 2 2m-2-2v5"/></svg>',
    export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14v5h14v-5M12 4v10m-4-4 4 4 4-4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>',
    import: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14v5h14v-5M12 4v10m-4-4 4 4 4-4" transform="rotate(180 12 11.5)"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
    panel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M9 10h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Zm10-13.2 3.2 3.2"/></svg>',
});

const toolButton = (action, icon, label, className = '') => `<button${className ? ` class="${className}"` : ''} type="button" data-yrg-action="${action}" title="${label}">${TOOL_ICONS[icon]}<span>${label}</span></button>`;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[char]);

const safeFileName = value => String(value || '正则').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80);

export class RegexGroupManager {
    constructor(adapter) {
        this.adapter = adapter;
        this.root = adapter.root;
        this.doc = adapter.root.document;
        this.scope = 'global';
        this.activeGroups = { global: DEFAULT_GROUP_ID, preset: DEFAULT_GROUP_ID, scoped: DEFAULT_GROUP_ID };
        this.nativeGroups = { global: DEFAULT_GROUP_ID, preset: DEFAULT_GROUP_ID, scoped: DEFAULT_GROUP_ID };
        this.nativeGroupMenus = { global: false, preset: false, scoped: false };
        this.nativeScrollLeft = { global: 0, preset: 0, scoped: 0 };
        this.nativeCollapsed = this.readNativeCollapsed();
        this.selected = new Set();
        this.search = '';
        this.busy = false;
        this.pendingImport = null;
        this.pendingImportBatch = null;
        this.importReviewSelection = new Set();
        this.theme = this.readTheme();
        this.nativeObservers = [];
        this.nativeListeners = [];
        this.eventBindings = [];
        this.renderQueued = false;
        this.boundClick = event => this.onClick(event);
        this.boundInput = event => this.onInput(event);
        this.boundChange = event => this.onChange(event);
        this.boundKeydown = event => this.onKeydown(event);
        this.boundNativeDocumentClick = event => this.onNativeDocumentClick(event);
        this.hostView = null;
    }

    init() {
        this.injectStyles();
        this.createOverlay();
        this.enhanceNativePanel();
        this.bindSillyTavernEvents();
        this.doc.addEventListener('click', this.boundNativeDocumentClick);
    }

    injectStyles() {
        if (this.doc.getElementById('yuyuan-regex-groups-css')) return;
        const link = this.doc.createElement('link');
        link.id = 'yuyuan-regex-groups-css';
        link.rel = 'stylesheet';
        link.href = new URL('./style.css', import.meta.url).href;
        this.doc.head.appendChild(link);
    }

    createOverlay() {
        const previous = findOverlay(this.root, 'yuyuan-regex-groups');
        releaseViewportOverlay(previous);
        previous?.remove();
        const overlay = this.doc.createElement('div');
        overlay.id = 'yuyuan-regex-groups';
        overlay.dataset.theme = this.theme;
        overlay.hidden = true;
        overlay.innerHTML = `
            <section class="yrg-panel" role="dialog" aria-modal="true" aria-labelledby="yrg-title">
                <header class="yrg-header">
                    <div><span class="yrg-kicker">YUYUAN TOOLS</span><h2 id="yrg-title">正则分组管理</h2></div>
                    <div class="yrg-header-actions">
                        <button class="yrg-theme-button" type="button" data-yrg-action="theme" aria-label="切换配色"></button>
                        <button class="yrg-icon-button" type="button" data-yrg-action="close" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </header>
                <nav class="yrg-scope-tabs" aria-label="正则区域"></nav>
                <div class="yrg-context"></div>
                <div class="yrg-group-tabs"></div>
                <div class="yrg-toolbar">
                    <label class="yrg-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" data-yrg-search placeholder="搜索名称或表达式"></label>
                    <div class="yrg-toolbar-actions">
                        ${toolButton('select-all', 'select', '全选')}
                        ${toolButton('select-none', 'clear', '取消')}
                        ${toolButton('enable', 'enable', '启用')}
                        ${toolButton('disable', 'disable', '停用')}
                        ${toolButton('move', 'move', '移动')}
                        ${toolButton('export', 'export', '导出')}
                        ${toolButton('delete-selected', 'trash', '删除', 'danger')}
                        ${toolButton('import', 'import', '导入', 'primary')}
                    </div>
                </div>
                <main class="yrg-list"></main>
                <footer class="yrg-footer"><span class="yrg-selection"></span></footer>
                <input type="file" data-yrg-file hidden accept=".json,application/json" multiple>
                <div class="yrg-busy" hidden><i class="fa-solid fa-circle-notch fa-spin"></i><span>正在保存…</span></div>
            </section>
            <div class="yrg-dialog-host"></div>`;
        mountViewportOverlay(this.root, overlay);
        protectHostDrawer(overlay);
        overlay.querySelector('[data-yrg-action="close"]')?.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        });
        overlay.addEventListener('click', this.boundClick);
        overlay.addEventListener('input', this.boundInput);
        overlay.addEventListener('change', this.boundChange);
        overlay.addEventListener('keydown', this.boundKeydown);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) this.close();
        });
        this.overlay = overlay;
        this.paintTheme();
    }

    readTheme() {
        try {
            const saved = this.root.localStorage.getItem(THEME_KEY);
            if (saved === 'dark' || saved === 'day') return saved;
        } catch {}
        return 'day';
    }

    readNativeCollapsed() {
        try {
            const saved = JSON.parse(this.root.localStorage.getItem(NATIVE_COLLAPSE_KEY) || '{}');
            return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        } catch { return {}; }
    }

    nativeCollapseId(scope, ownerKey, groupId) {
        return `${scope}\u0000${String(ownerKey || '')}\u0000${String(groupId || DEFAULT_GROUP_ID)}`;
    }

    isNativeCollapsed(scope, ownerKey, groupId) {
        return this.nativeCollapsed[this.nativeCollapseId(scope, ownerKey, groupId)] === true;
    }

    setNativeCollapsed(scope, ownerKey, groupId, collapsed) {
        const id = this.nativeCollapseId(scope, ownerKey, groupId);
        if (collapsed) this.nativeCollapsed[id] = true;
        else delete this.nativeCollapsed[id];
        try { this.root.localStorage.setItem(NATIVE_COLLAPSE_KEY, JSON.stringify(this.nativeCollapsed)); } catch {}
    }

    setTheme(theme) {
        this.theme = theme === 'dark' ? 'dark' : 'day';
        try { this.root.localStorage.setItem(THEME_KEY, this.theme); } catch {}
        this.paintTheme();
    }

    paintTheme() {
        if (!this.overlay) return;
        this.overlay.dataset.theme = this.theme;
        const button = this.overlay.querySelector('[data-yrg-action="theme"]');
        if (!button) return;
        const day = this.theme === 'day';
        button.setAttribute('aria-label', day ? '切换到夜间配色' : '切换到日间配色');
        button.title = button.getAttribute('aria-label');
        button.innerHTML = themeIcon(day ? 'day' : 'dark');
    }

    open(scope = this.scope) {
        if (SCOPES.includes(scope)) this.scope = scope;
        if (this.overlay.hidden) this.hostView = captureHostView(this.root);
        this.overlay.hidden = false;
        this.render();
        // Opening a manager should not summon the iOS keyboard and pan/zoom
        // the viewport before the user has chosen to search.
        const desktopPointer = this.root.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
        this.overlay.querySelector(desktopPointer === false ? '[data-yrg-action="close"]' : '[data-yrg-search]')?.focus({ preventScroll: true });
    }

    close() {
        if (this.busy) return;
        this.pendingImport = null;
        this.pendingImportBatch = null;
        this.importReviewSelection.clear();
        this.closeDialog();
        this.overlay.hidden = true;
        restoreHostView(this.root, this.hostView);
        this.hostView = null;
    }

    currentContext(scope = this.scope) {
        return this.adapter.context(scope);
    }

    currentGroup(scope = this.scope) {
        const store = this.adapter.getStore();
        const info = this.currentContext(scope);
        const groups = listGroups(store, scope, info.key);
        const wanted = this.activeGroups[scope];
        if (!groups.some(group => group.id === wanted)) this.activeGroups[scope] = DEFAULT_GROUP_ID;
        return this.activeGroups[scope];
    }

    render() {
        if (!this.overlay || this.overlay.hidden) return;
        const store = this.adapter.getStore();
        const info = this.currentContext();
        const scripts = this.adapter.getScripts(this.scope);
        if (pruneAssignments(store, this.scope, info.key, scripts)) this.adapter.saveStore(store);
        const groups = listGroups(store, this.scope, info.key);
        const active = this.currentGroup();
        const groupScripts = scriptsInGroup(store, this.scope, info.key, scripts, active);
        const query = this.search.trim().toLocaleLowerCase();
        const visible = query ? groupScripts.filter(script => `${script.scriptName || ''}\n${script.findRegex || ''}`.toLocaleLowerCase().includes(query)) : groupScripts;
        const activeInfo = groups.find(group => group.id === active) || groups[0];

        this.overlay.querySelector('.yrg-scope-tabs').innerHTML = SCOPES.map(scope => {
            const context = this.currentContext(scope);
            const count = this.adapter.getScripts(scope).length;
            return `<button type="button" class="${scope === this.scope ? 'active' : ''}" data-yrg-scope="${scope}" ${!context.available ? 'aria-disabled="true"' : ''}><span>${SCOPE_LABELS[scope]}</span><b>${count}</b></button>`;
        }).join('');
        this.overlay.querySelector('.yrg-context').innerHTML = `<span>${escapeHtml(SCOPE_LABELS[this.scope])}范围</span><b>${escapeHtml(info.label)}</b>${info.available ? '' : '<em>当前不可用</em>'}`;
        const tabs = this.overlay.querySelector('.yrg-group-tabs');
        if (!tabs.querySelector('.yrg-group-scroll')) tabs.innerHTML = '<div class="yrg-group-scroll"></div><div class="yrg-group-actions"></div>';
        updateHtml(tabs.querySelector('.yrg-group-scroll'), groups.map(group => {
                const count = scriptsInGroup(store, this.scope, info.key, scripts, group.id).length;
                return `<button type="button" class="${group.id === active ? 'active' : ''}" data-yrg-group="${escapeHtml(group.id)}"><span>${escapeHtml(group.name)}</span><b>${count}</b></button>`;
            }).join(''));
        updateHtml(tabs.querySelector('.yrg-group-actions'), `
                <button type="button" data-yrg-action="add-group" title="新建分组" aria-label="新建分组"><i class="fa-solid fa-plus"></i></button>
                <button type="button" data-yrg-action="rename-group" title="重命名当前分组" aria-label="重命名当前分组" ${activeInfo.locked ? 'disabled' : ''}><i class="fa-regular fa-pen-to-square"></i></button>
                <button class="danger" type="button" data-yrg-action="delete-group" title="删除当前分组" aria-label="删除当前分组" ${activeInfo.locked ? 'disabled' : ''}><i class="fa-regular fa-trash-can"></i></button>
            `);
        updateHtml(this.overlay.querySelector('.yrg-list'), !info.available
            ? `<div class="yrg-empty"><i class="fa-regular fa-folder-open"></i><b>${escapeHtml(info.label)}</b><span>${this.scope === 'scoped' ? '局部正则需要进入单个角色聊天后管理' : '选择一个预设后即可管理预设正则'}</span></div>`
            : visible.length
                ? visible.map(script => this.renderRow(script)).join('')
                : `<div class="yrg-empty"><i class="fa-regular fa-folder-open"></i><b>${query ? '没有匹配的正则' : '这个分组还是空的'}</b><span>${query ? '换一个关键词试试' : '可以导入正则，或从其他分组移动到这里'}</span></div>`);
        this.overlay.querySelector('.yrg-selection').textContent = `已选择 ${this.selected.size} 条 · 本组 ${groupScripts.length} 条`;
        const search = this.overlay.querySelector('[data-yrg-search]');
        if (search && search.value !== this.search) search.value = this.search;
    }

    renderRow(script) {
        const id = String(script.id || '');
        const selected = this.selected.has(id);
        const find = String(script.findRegex || '').replace(/\s+/g, ' ').trim();
        return `<article class="yrg-row ${selected ? 'selected' : ''}" data-yrg-id="${escapeHtml(id)}">
            <label class="yrg-check"><input type="checkbox" data-yrg-select="${escapeHtml(id)}" ${selected ? 'checked' : ''}><span></span></label>
            <button class="yrg-row-main" type="button" data-yrg-action="edit" data-yrg-id="${escapeHtml(id)}">
                <b>${escapeHtml(script.scriptName || '未命名正则')}</b>
                <small>${escapeHtml(find || '未填写查找表达式')}</small>
            </button>
            <span class="yrg-status ${script.disabled ? 'off' : 'on'}">${script.disabled ? '已停用' : '已启用'}</span>
            <button class="yrg-row-menu" type="button" data-yrg-action="toggle-one" data-yrg-id="${escapeHtml(id)}" title="${script.disabled ? '启用' : '停用'}"><i class="fa-solid ${script.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i></button>
            <button class="yrg-row-delete" type="button" data-yrg-action="delete-one" data-yrg-id="${escapeHtml(id)}" title="删除这条正则"><i class="fa-regular fa-trash-can"></i></button>
        </article>`;
    }

    async onClick(event) {
        const scopeButton = event.target.closest('[data-yrg-scope]');
        if (scopeButton) {
            const scope = scopeButton.dataset.yrgScope;
            const info = this.currentContext(scope);
            if (!info.available) {
                this.adapter.notify(info.label, 'warning');
                return;
            }
            this.scope = scope;
            this.selected.clear();
            this.search = '';
            this.render();
            return;
        }
        const groupButton = event.target.closest('[data-yrg-group]');
        if (groupButton) {
            this.activeGroups[this.scope] = groupButton.dataset.yrgGroup;
            this.selected.clear();
            this.render();
            return;
        }
        const button = event.target.closest('[data-yrg-action]');
        if (!button || this.busy) return;
        const action = button.dataset.yrgAction;
        try {
            if (action === 'close') this.close();
            else if (action === 'theme') this.setTheme(this.theme === 'day' ? 'dark' : 'day');
            else if (action === 'add-group') this.addGroup();
            else if (action === 'rename-group') this.renameActiveGroup();
            else if (action === 'delete-group') this.deleteActiveGroup();
            else if (action === 'select-all') this.selectAll();
            else if (action === 'select-none') { this.selected.clear(); this.render(); }
            else if (action === 'enable') await this.setSelectedDisabled(false);
            else if (action === 'disable') await this.setSelectedDisabled(true);
            else if (action === 'toggle-one') await this.toggleOne(button.dataset.yrgId);
            else if (action === 'move') this.showDestinationDialog('move');
            else if (action === 'import') this.showDestinationDialog('import');
            else if (action === 'export') this.exportSelected();
            else if (action === 'delete-selected') await this.deleteScripts(this.scope, Array.from(this.selected));
            else if (action === 'delete-one') await this.deleteScripts(this.scope, [button.dataset.yrgId]);
            else if (action === 'edit') this.editNative(button.dataset.yrgId);
            else if (action === 'dialog-close') this.closeDialog();
            else if (action === 'dialog-confirm') await this.confirmDestination();
            else if (action === 'import-cancel') this.cancelImportReview();
            else if (action === 'import-confirm') await this.confirmImportBatch();
        } catch (error) {
            console.error('[yuyuan-regex-groups]', error);
            this.adapter.notify(error.message || '正则分组操作失败', 'error');
        }
    }

    onInput(event) {
        if (event.target.matches('[data-yrg-search]')) {
            this.search = event.target.value;
            this.render();
        }
    }

    onChange(event) {
        if (event.target.matches('[data-yrg-select]')) {
            const id = event.target.dataset.yrgSelect;
            if (event.target.checked) this.selected.add(id);
            else this.selected.delete(id);
            this.render();
        }
        if (event.target.matches('[data-yrg-dest-scope]')) this.renderDestinationGroups();
        if (event.target.matches('[data-yrg-file]')) {
            this.importFiles(event.target.files).catch(error => {
                console.error('[yuyuan-regex-groups] import failed', error);
                this.adapter.notify(error.message || '正则文件读取失败', 'error');
            });
        }
        if (event.target.matches('[data-yrg-import-select]')) {
            const id = event.target.dataset.yrgImportSelect;
            if (event.target.checked) this.importReviewSelection.add(id);
            else this.importReviewSelection.delete(id);
            event.target.closest('.yrg-import-row')?.classList.toggle('selected', event.target.checked);
            this.updateImportReviewState();
        }
    }

    onKeydown(event) {
        if (event.key === 'Escape') {
            if (this.overlay.querySelector('.yrg-import-review')) this.cancelImportReview();
            else if (this.overlay.querySelector('.yrg-dialog')) this.closeDialog();
            else this.close();
        }
    }

    addGroup() {
        const info = this.currentContext();
        if (!info.available) throw new Error(info.label);
        const name = this.root.prompt('新分组名称');
        if (name === null) return;
        const store = this.adapter.getStore();
        const group = createGroup(store, this.scope, info.key, name, this.adapter.uuid);
        this.adapter.saveStore(store);
        this.activeGroups[this.scope] = group.id;
        this.render();
        this.refreshNativeBars();
    }

    renameActiveGroup() {
        const groupId = this.currentGroup();
        const info = this.currentContext();
        const store = this.adapter.getStore();
        const current = listGroups(store, this.scope, info.key).find(group => group.id === groupId);
        const name = this.root.prompt('新的分组名称', current?.name || '');
        if (name === null) return;
        renameGroup(store, this.scope, info.key, groupId, name);
        this.adapter.saveStore(store);
        this.render();
        this.refreshNativeBars();
    }

    deleteActiveGroup() {
        const groupId = this.currentGroup();
        const info = this.currentContext();
        const store = this.adapter.getStore();
        const current = listGroups(store, this.scope, info.key).find(group => group.id === groupId);
        if (!this.root.confirm(`删除分组“${current?.name || ''}”？\n组内正则会回到“默认”，不会被删除。`)) return;
        deleteGroup(store, this.scope, info.key, groupId);
        this.setNativeCollapsed(this.scope, info.key, groupId, false);
        this.adapter.saveStore(store);
        this.activeGroups[this.scope] = DEFAULT_GROUP_ID;
        this.selected.clear();
        this.render();
        this.refreshNativeBars();
    }

    selectAll() {
        const store = this.adapter.getStore();
        const info = this.currentContext();
        const scripts = scriptsInGroup(store, this.scope, info.key, this.adapter.getScripts(this.scope), this.currentGroup());
        scripts.forEach(script => script.id && this.selected.add(String(script.id)));
        this.render();
    }

    selectedScripts() {
        return this.adapter.getScripts(this.scope).filter(script => this.selected.has(String(script.id)));
    }

    requireSelection() {
        const scripts = this.selectedScripts();
        if (!scripts.length) throw new Error('请先选择正则');
        return scripts;
    }

    async setSelectedDisabled(disabled) {
        const chosen = this.requireSelection();
        await this.withBusy(async () => {
            const ids = new Set(chosen.map(script => String(script.id)));
            const scripts = this.adapter.getScripts(this.scope).map(script => ids.has(String(script.id)) ? { ...script, disabled } : script);
            await this.adapter.saveScripts(this.scope, scripts);
            await this.adapter.afterMutation();
        });
        this.render();
        this.syncNativeRows();
        this.adapter.notify(disabled ? '已停用所选正则' : '已启用所选正则', 'success');
    }

    async toggleOne(id) {
        const scripts = this.adapter.getScripts(this.scope);
        const target = scripts.find(script => String(script.id) === String(id));
        if (!target) throw new Error('找不到这条正则');
        target.disabled = !target.disabled;
        await this.withBusy(async () => {
            await this.adapter.saveScripts(this.scope, scripts);
            await this.adapter.afterMutation();
        });
        this.render();
        this.syncNativeRows();
    }

    async deleteScripts(scope, ids) {
        const selectedIds = new Set((ids || []).map(String).filter(Boolean));
        const scripts = this.adapter.getScripts(scope);
        const plan = removeScriptsByIds(scripts, selectedIds);
        const chosen = plan.removed;
        if (!chosen.length) throw new Error('请先选择要删除的正则');
        const preview = chosen.slice(0, 3).map(script => `“${script.scriptName || '未命名正则'}”`).join('、');
        const suffix = chosen.length > 3 ? `等 ${chosen.length} 条` : '';
        if (!this.root.confirm(`确定永久删除 ${preview}${suffix}？\n删除的是正则内容，无法通过分组恢复。`)) return;
        const info = this.currentContext(scope);
        await this.withBusy(async () => {
            await this.adapter.saveScripts(scope, plan.kept);
            const store = this.adapter.getStore();
            removeAssignments(store, scope, info.key, selectedIds);
            this.adapter.saveStore(store);
            await this.adapter.afterMutation();
        });
        selectedIds.forEach(id => this.selected.delete(id));
        this.render();
        this.reconcileNativeRows([scope]);
        this.refreshNativeBars();
        this.adapter.notify(`已删除 ${chosen.length} 条正则`, 'success');
    }

    editNative(id) {
        if (this.adapter.openNativeEditor(id)) {
            this.close();
            return;
        }
        this.adapter.notify('请先展开酒馆原生 Regex 面板，再点一次编辑', 'info');
    }

    exportSelected() {
        const scripts = this.requireSelection();
        const info = this.currentContext();
        const group = listGroups(this.adapter.getStore(), this.scope, info.key).find(item => item.id === this.currentGroup());
        this.adapter.downloadJson(scripts, `regex-${safeFileName(group?.name)}-${new Date().toISOString().slice(0, 10)}.json`);
        this.adapter.notify(`已导出 ${scripts.length} 条正则`, 'success');
    }

    showDestinationDialog(mode, fixedScope = null) {
        if (mode === 'move') this.requireSelection();
        const contexts = Object.fromEntries(SCOPES.map(scope => [scope, this.currentContext(scope)]));
        const available = SCOPES.filter(scope => contexts[scope].available);
        const initial = fixedScope && available.includes(fixedScope) ? fixedScope : (available.includes(this.scope) ? this.scope : available[0]);
        if (!initial) throw new Error('当前没有可用的正则区域');
        const host = this.overlay.querySelector('.yrg-dialog-host');
        host.innerHTML = `<div class="yrg-dialog-backdrop"><div class="yrg-dialog" data-yrg-mode="${mode}">
            <header><div><span>${mode === 'import' ? '导入到' : '移动到'}</span><b>${mode === 'import' ? '选择正则保存位置' : `已选择 ${this.selected.size} 条正则`}</b></div><button type="button" data-yrg-action="dialog-close"><i class="fa-solid fa-xmark"></i></button></header>
            <label><span>区域</span><select data-yrg-dest-scope>${SCOPES.map(scope => {
                const info = contexts[scope];
                return `<option value="${scope}" ${scope === initial ? 'selected' : ''} ${info.available ? '' : 'disabled'}>${SCOPE_LABELS[scope]} · ${escapeHtml(info.label)}${info.available ? '' : '（当前不可用）'}</option>`;
            }).join('')}</select></label>
            <label><span>分组</span><select data-yrg-dest-group></select></label>
            <p>${mode === 'import' ? '文件中的每条正则会生成新的 ID，原文件不会被修改。' : '跨区域移动会先写入目标位置，成功后再从原位置移除。'}</p>
            <footer><button type="button" data-yrg-action="dialog-close">取消</button><button class="primary" type="button" data-yrg-action="dialog-confirm">${mode === 'import' ? '选择文件' : '确认移动'}</button></footer>
        </div></div>`;
        this.renderDestinationGroups();
    }

    renderDestinationGroups() {
        const dialog = this.overlay.querySelector('.yrg-dialog');
        if (!dialog) return;
        const scope = dialog.querySelector('[data-yrg-dest-scope]').value;
        const info = this.currentContext(scope);
        const groups = listGroups(this.adapter.getStore(), scope, info.key);
        const preferred = groups.some(group => group.id === this.activeGroups[scope]) ? this.activeGroups[scope] : DEFAULT_GROUP_ID;
        dialog.querySelector('[data-yrg-dest-group]').innerHTML = groups
            .map(group => `<option value="${escapeHtml(group.id)}" ${group.id === preferred ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');
    }

    closeDialog() {
        const host = this.overlay?.querySelector('.yrg-dialog-host');
        if (host) host.innerHTML = '';
    }

    async confirmDestination() {
        const dialog = this.overlay.querySelector('.yrg-dialog');
        if (!dialog) return;
        const mode = dialog.dataset.yrgMode;
        const destination = {
            scope: dialog.querySelector('[data-yrg-dest-scope]').value,
            groupId: dialog.querySelector('[data-yrg-dest-group]').value,
        };
        const destinationInfo = this.currentContext(destination.scope);
        if (!destinationInfo.available) throw new Error(destinationInfo.label);
        destination.ownerKey = destinationInfo.key;
        if (mode === 'import') {
            this.pendingImport = destination;
            this.closeDialog();
            this.overlay.querySelector('[data-yrg-file]').click();
        } else {
            this.closeDialog();
            await this.moveSelected(destination);
        }
    }

    async importFiles(fileList) {
        const destination = this.pendingImport;
        this.pendingImport = null;
        const input = this.overlay.querySelector('[data-yrg-file]');
        if (!destination || !fileList?.length) { if (input) input.value = ''; return; }
        const items = [];
        const problems = [];
        try {
            for (const file of Array.from(fileList)) {
                try {
                    const payload = JSON.parse(await file.text());
                    const parsed = parseImportPayload(payload, this.adapter.uuid);
                    items.push(...parsed.scripts.map(script => ({ script, fileName: file.name })));
                    problems.push(...parsed.errors.map(error => `${file.name}：${error}`));
                } catch (error) {
                    problems.push(`${file.name}：无法读取 JSON`);
                }
            }
            if (!items.length) throw new Error(problems[0] || '文件里没有可导入的正则');
            this.pendingImportBatch = { destination, items, problems };
            this.importReviewSelection = new Set(items.map(item => String(item.script.id)));
            this.showImportReview();
        } finally {
            if (input) input.value = '';
        }
    }

    showImportReview() {
        const batch = this.pendingImportBatch;
        if (!batch) return;
        const host = this.overlay.querySelector('.yrg-dialog-host');
        const { destination, items, problems } = batch;
        const target = this.currentContext(destination.scope);
        const groups = listGroups(this.adapter.getStore(), destination.scope, target.key);
        const group = groups.find(item => item.id === destination.groupId);
        host.innerHTML = `<div class="yrg-dialog-backdrop"><div class="yrg-dialog yrg-import-review" data-yrg-mode="import-review">
            <header><div><span>导入前确认</span><b>选择要导入的正则</b></div><button type="button" data-yrg-action="import-cancel" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button></header>
            <div class="yrg-import-destination"><span>${escapeHtml(SCOPE_LABELS[destination.scope])}</span><b>${escapeHtml(target.label)}</b><i class="fa-solid fa-chevron-right"></i><strong>${escapeHtml(group?.name || '默认')}</strong></div>
            <div class="yrg-import-review-tools"><span data-yrg-import-count></span><div><button type="button" data-yrg-action="import-review-all">全选</button><button type="button" data-yrg-action="import-review-none">取消</button></div></div>
            <div class="yrg-import-list">${items.map(({ script, fileName }) => {
                const id = String(script.id);
                const checked = this.importReviewSelection.has(id);
                const find = String(script.findRegex || '').replace(/\s+/g, ' ').trim();
                return `<article class="yrg-import-row ${checked ? 'selected' : ''}">
                    <label class="yrg-check"><input type="checkbox" data-yrg-import-select="${escapeHtml(id)}" ${checked ? 'checked' : ''}><span></span></label>
                    <div class="yrg-import-copy"><b>${escapeHtml(script.scriptName || '未命名正则')}</b><small>${escapeHtml(fileName)}</small><code>${escapeHtml(find || '未填写查找表达式')}</code></div>
                </article>`;
            }).join('')}</div>
            ${problems.length ? `<p class="yrg-import-problems">有 ${problems.length} 条异常数据不会导入</p>` : ''}
            <footer><button type="button" data-yrg-action="import-cancel">取消</button><button class="primary" type="button" data-yrg-action="import-confirm" data-yrg-import-confirm></button></footer>
        </div></div>`;
        host.querySelector('[data-yrg-action="import-review-all"]')?.addEventListener('click', () => {
            this.importReviewSelection = new Set(items.map(item => String(item.script.id)));
            this.showImportReview();
        });
        host.querySelector('[data-yrg-action="import-review-none"]')?.addEventListener('click', () => {
            this.importReviewSelection.clear();
            this.showImportReview();
        });
        this.updateImportReviewState();
    }

    updateImportReviewState() {
        const batch = this.pendingImportBatch;
        const dialog = this.overlay.querySelector('.yrg-import-review');
        if (!batch || !dialog) return;
        const count = this.importReviewSelection.size;
        const total = batch.items.length;
        const label = dialog.querySelector('[data-yrg-import-count]');
        const confirm = dialog.querySelector('[data-yrg-import-confirm]');
        if (label) label.textContent = `已选择 ${count} / ${total} 条`;
        if (confirm) {
            confirm.textContent = `导入 ${count} 条`;
            confirm.disabled = count === 0;
        }
    }

    cancelImportReview() {
        this.pendingImportBatch = null;
        this.importReviewSelection.clear();
        this.closeDialog();
    }

    importItems(ids) {
        const wanted = new Set((ids || []).map(String));
        return (this.pendingImportBatch?.items || []).filter(item => wanted.has(String(item.script.id)));
    }

    async confirmImportBatch() {
        const batch = this.pendingImportBatch;
        if (!batch) return;
        const chosen = this.importItems(Array.from(this.importReviewSelection));
        if (!chosen.length) throw new Error('请至少选择一条正则');
        const { destination, problems } = batch;
        const targetInfo = this.currentContext(destination.scope);
        if (!targetInfo.available) throw new Error(targetInfo.label);
        if (destination.ownerKey !== undefined && destination.ownerKey !== targetInfo.key) throw new Error('导入目标已切换，请重新选择目标后导入');
        const importedScripts = chosen.map(item => item.script);
        const importedIds = importedScripts.map(script => String(script.id));
        await this.withBusy(async () => {
            const scripts = this.adapter.getScripts(destination.scope).concat(importedScripts);
            await this.adapter.saveScripts(destination.scope, scripts, targetInfo.key);
            const store = this.adapter.getStore();
            assignScripts(store, destination.scope, targetInfo.key, importedIds, destination.groupId);
            this.adapter.saveStore(store);
            await this.adapter.afterMutation();
            this.scope = destination.scope;
            this.activeGroups[destination.scope] = destination.groupId;
            this.selected = new Set(importedIds);
        });
        this.pendingImportBatch = null;
        this.importReviewSelection.clear();
        this.closeDialog();
        this.render();
        this.refreshNativeBars();
        this.adapter.notify(`已导入 ${importedScripts.length} 条正则${problems.length ? `，跳过 ${problems.length} 条异常数据` : ''}`, problems.length ? 'warning' : 'success');
    }

    async moveSelected(destination) {
        const chosen = this.requireSelection();
        const sourceScope = this.scope;
        const sourceInfo = this.currentContext(sourceScope);
        const targetInfo = this.currentContext(destination.scope);
        const selectedIds = chosen.map(script => String(script.id));
        if (!targetInfo.available) throw new Error(targetInfo.label);

        if (sourceScope === destination.scope) {
            const store = this.adapter.getStore();
            assignScripts(store, sourceScope, sourceInfo.key, selectedIds, destination.groupId);
            this.adapter.saveStore(store);
            this.activeGroups[sourceScope] = destination.groupId;
            this.selected.clear();
            this.render();
            this.refreshNativeBars();
            this.adapter.notify('已移动到目标分组', 'success');
            return;
        }

        await this.withBusy(async () => {
            const sourceOriginal = this.adapter.getScripts(sourceScope);
            const targetOriginal = this.adapter.getScripts(destination.scope);
            const plan = makeCrossScopeMove(sourceOriginal, targetOriginal, selectedIds, this.adapter.uuid);
            if (!plan.moved.length) throw new Error('没有找到要移动的正则');
            await this.adapter.saveScripts(destination.scope, plan.targetNext, targetInfo.key);
            try {
                await this.adapter.saveScripts(sourceScope, plan.sourceNext, sourceInfo.key);
            } catch (error) {
                try { await this.adapter.saveScripts(destination.scope, targetOriginal, targetInfo.key); } catch (rollbackError) { console.error('[yuyuan-regex-groups] rollback failed', rollbackError); }
                throw error;
            }
            const store = this.adapter.getStore();
            removeAssignments(store, sourceScope, sourceInfo.key, selectedIds);
            assignScripts(store, destination.scope, targetInfo.key, Object.values(plan.idMap), destination.groupId);
            this.adapter.saveStore(store);
            await this.adapter.afterMutation();
            this.scope = destination.scope;
            this.activeGroups[destination.scope] = destination.groupId;
            this.selected = new Set(Object.values(plan.idMap));
        });
        this.render();
        this.refreshNativeBars();
        this.adapter.notify(`已移动 ${chosen.length} 条正则`, 'success');
    }

    async withBusy(task) {
        this.busy = true;
        const busy = this.overlay.querySelector('.yrg-busy');
        if (busy) busy.hidden = false;
        try { return await task(); }
        finally {
            this.busy = false;
            if (busy) busy.hidden = true;
        }
    }

    enhanceNativePanel() {
        const container = this.doc.getElementById('regex_container');
        const toolbar = container?.querySelector('.regex_settings .inline-drawer-content > .flex-container');
        if (!container || !toolbar) return false;
        if (!this.doc.getElementById('yuyuan-regex-groups-open-native')) {
            const button = this.doc.createElement('button');
            button.id = 'yuyuan-regex-groups-open-native';
            button.type = 'button';
            button.className = 'menu_button menu_button_icon yrg-native-open';
            button.innerHTML = '<i class="fa-solid fa-folder-tree"></i><small>分组</small>';
            button.addEventListener('click', () => this.open());
            toolbar.appendChild(button);
        }
        const map = { global: 'saved_regex_scripts', preset: 'saved_preset_scripts', scoped: 'saved_scoped_scripts' };
        for (const [scope, id] of Object.entries(map)) {
            const list = this.doc.getElementById(id);
            if (!list) continue;
            let bar = list.previousElementSibling;
            if (!bar?.matches(`.yrg-native-groups[data-yrg-native-scope="${scope}"]`)) {
                bar = this.doc.createElement('div');
                bar.className = 'yrg-native-groups';
                bar.dataset.yrgNativeScope = scope;
                list.before(bar);
                bar.addEventListener('click', event => this.onNativeBarClick(event, scope));
            }
            if (!list.dataset.yrgObserved) {
                list.dataset.yrgObserved = '1';
                const observer = new this.root.MutationObserver(() => this.scheduleNativeRefresh());
                observer.observe(list, { childList: true });
                this.nativeObservers.push(observer);
                const changeHandler = event => {
                    if (!event.target.matches('.regex_bulk_checkbox')) return;
                    event.target.closest('.regex-script-label')?.classList.toggle('yrg-native-selected', event.target.checked);
                    this.scheduleNativeRefresh();
                };
                list.addEventListener('change', changeHandler);
                this.nativeListeners.push([list, 'change', changeHandler, false]);
            }
        }
        const importButton = this.doc.getElementById('import_regex');
        if (importButton && !importButton.dataset.yrgCaptured) {
            importButton.dataset.yrgCaptured = '1';
            const importHandler = event => {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.open();
                this.showDestinationDialog('import');
            };
            importButton.addEventListener('click', importHandler, true);
            this.nativeListeners.push([importButton, 'click', importHandler, true]);
        }
        this.refreshNativeBars();
        return true;
    }

    async onNativeBarClick(event, scope) {
        const collapseButton = event.target.closest('[data-yrg-native-collapse]');
        if (collapseButton) {
            const info = this.currentContext(scope);
            const groupId = collapseButton.dataset.yrgNativeCollapse;
            this.rememberNativeScroll(scope);
            this.clearNativeSelection(scope);
            this.nativeGroups[scope] = groupId;
            this.nativeGroupMenus[scope] = false;
            this.setNativeCollapsed(scope, info.key, groupId, !this.isNativeCollapsed(scope, info.key, groupId));
            this.refreshNativeBars();
            return;
        }
        const group = event.target.closest('[data-yrg-native-group]');
        if (group) {
            const scroll = group.closest('.yrg-native-scroll');
            if (Number(scroll?.dataset.yrgSuppressClickUntil || 0) > Date.now()) return;
            this.rememberNativeScroll(scope);
            this.clearNativeSelection(scope);
            this.nativeGroups[scope] = group.dataset.yrgNativeGroup;
            this.nativeGroupMenus[scope] = false;
            this.refreshNativeBars();
            return;
        }
        const action = event.target.closest('[data-yrg-native-action]')?.dataset.yrgNativeAction;
        try {
            if (action === 'add') {
                const info = this.currentContext(scope);
                if (!info.available) { this.adapter.notify(info.label, 'warning'); return; }
                const name = this.root.prompt('新分组名称');
                if (name === null) return;
                const store = this.adapter.getStore();
                const created = createGroup(store, scope, info.key, name, this.adapter.uuid);
                this.adapter.saveStore(store);
                this.nativeGroups[scope] = created.id;
                this.nativeGroupMenus[scope] = false;
                this.refreshNativeBars();
            } else if (action === 'manage-groups') {
                this.rememberNativeScroll(scope);
                this.nativeGroupMenus[scope] = !this.nativeGroupMenus[scope];
                this.refreshNativeBars();
            } else if (action === 'rename-group') {
                const groupId = event.target.closest('[data-yrg-native-action]')?.dataset.yrgGroupId;
                const info = this.currentContext(scope);
                const store = this.adapter.getStore();
                const current = listGroups(store, scope, info.key).find(item => item.id === groupId);
                if (!current || current.locked) return;
                const name = this.root.prompt('新的分组名称', current.name);
                if (name === null) return;
                renameGroup(store, scope, info.key, groupId, name);
                this.adapter.saveStore(store);
                this.refreshNativeBars();
            } else if (action === 'delete-group') {
                const groupId = event.target.closest('[data-yrg-native-action]')?.dataset.yrgGroupId;
                const info = this.currentContext(scope);
                const store = this.adapter.getStore();
                const current = listGroups(store, scope, info.key).find(item => item.id === groupId);
                if (!current || current.locked) return;
                if (!this.root.confirm(`删除分组“${current.name}”？\n组内正则会回到“默认”，不会被删除。`)) return;
                deleteGroup(store, scope, info.key, groupId);
                this.setNativeCollapsed(scope, info.key, groupId, false);
                this.adapter.saveStore(store);
                if (this.nativeGroups[scope] === groupId) this.nativeGroups[scope] = DEFAULT_GROUP_ID;
                this.clearNativeSelection(scope);
                this.refreshNativeBars();
            } else if (action === 'select') {
                const rows = this.nativeRows(scope, true);
                const next = rows.some(row => !row.classList.contains('yrg-native-selected'));
                rows.forEach(row => {
                    row.classList.toggle('yrg-native-selected', next);
                    const box = row.querySelector('.regex_bulk_checkbox');
                    if (box) box.checked = next;
                });
                this.refreshNativeBars();
            } else if (action === 'delete-selected') {
                await this.deleteScripts(scope, this.nativeSelectedIds(scope));
            } else if (action === 'manage') {
                this.scope = scope;
                this.activeGroups[scope] = this.nativeGroups[scope];
                this.selected = new Set(this.nativeSelectedIds(scope));
                this.nativeGroupMenus[scope] = false;
                this.open(scope);
            }
        } catch (error) {
            console.error('[yuyuan-regex-groups] native action failed', error);
            this.adapter.notify(error.message || '正则操作失败', 'error');
        }
    }

    nativeSelectedIds(scope) {
        return this.nativeRows(scope, true)
            .filter(row => row.classList.contains('yrg-native-selected') || row.querySelector('.regex_bulk_checkbox:checked'))
            .map(row => row.id)
            .filter(Boolean);
    }

    nativeRows(scope, visibleOnly = false) {
        const listId = { global: 'saved_regex_scripts', preset: 'saved_preset_scripts', scoped: 'saved_scoped_scripts' }[scope];
        if (!listId) return [];
        return Array.from(this.doc.querySelectorAll(`#${listId} .regex-script-label`))
            .filter(row => !visibleOnly || !row.hidden);
    }

    clearNativeSelection(scope) {
        this.nativeRows(scope).forEach(row => {
            row.classList.remove('yrg-native-selected');
            const box = row.querySelector('.regex_bulk_checkbox');
            if (box) box.checked = false;
        });
    }

    reconcileNativeRows(scopes = SCOPES) {
        scopes.forEach(scope => {
            const validIds = new Set(this.adapter.getScripts(scope).map(script => String(script.id)));
            this.nativeRows(scope).forEach(row => {
                if (!validIds.has(String(row.id))) row.remove();
            });
        });
    }

    rememberNativeScroll(scope, bar = null) {
        const host = bar || this.doc.querySelector(`.yrg-native-groups[data-yrg-native-scope="${scope}"]`);
        const scroll = host?.querySelector('.yrg-native-scroll');
        if (scroll) this.nativeScrollLeft[scope] = scroll.scrollLeft;
        return this.nativeScrollLeft[scope] || 0;
    }

    onNativeDocumentClick(event) {
        if (event.target.closest('.yrg-native-group-menu') || event.target.closest('[data-yrg-native-action="manage-groups"]')) return;
        if (!SCOPES.some(scope => this.nativeGroupMenus[scope])) return;
        SCOPES.forEach(scope => { this.nativeGroupMenus[scope] = false; });
        this.refreshNativeBars();
    }

    bindNativeScroller(scroll, scope) {
        if (!scroll) return;
        let drag = null;
        const finish = event => {
            if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
            if (drag.moved) scroll.dataset.yrgSuppressClickUntil = String(Date.now() + 260);
            scroll.classList.remove('yrg-native-dragging');
            try { scroll.releasePointerCapture?.(drag.pointerId); } catch {}
            this.nativeScrollLeft[scope] = scroll.scrollLeft;
            drag = null;
        };
        scroll.addEventListener('pointerdown', event => {
            // Touch uses native scrolling, including Safari's momentum. Only
            // emulate dragging for a mouse; don't capture/cancel touch swipes.
            if (event.pointerType !== 'mouse') return;
            if (event.button !== undefined && event.button !== 0) return;
            drag = { pointerId: event.pointerId, startX: event.clientX, startLeft: scroll.scrollLeft, moved: false };
        });
        scroll.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const delta = event.clientX - drag.startX;
            if (!drag.moved && Math.abs(delta) < 4) return;
            if (!drag.moved) scroll.setPointerCapture?.(event.pointerId);
            drag.moved = true;
            scroll.classList.add('yrg-native-dragging');
            scroll.scrollLeft = drag.startLeft - delta;
            event.preventDefault();
        });
        scroll.addEventListener('pointerup', finish);
        scroll.addEventListener('pointercancel', finish);
        scroll.addEventListener('wheel', event => {
            if (scroll.scrollWidth <= scroll.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            const before = scroll.scrollLeft;
            scroll.scrollLeft += event.deltaY;
            if (scroll.scrollLeft === before) return;
            this.nativeScrollLeft[scope] = scroll.scrollLeft;
            event.preventDefault();
        }, { passive: false });
    }

    scheduleNativeRefresh() {
        if (this.renderQueued) return;
        this.renderQueued = true;
        this.root.requestAnimationFrame(() => {
            this.renderQueued = false;
            this.refreshNativeBars();
        });
    }

    refreshNativeBars() {
        const store = this.adapter.getStore();
        const map = { global: 'saved_regex_scripts', preset: 'saved_preset_scripts', scoped: 'saved_scoped_scripts' };
        for (const [scope, id] of Object.entries(map)) {
            const list = this.doc.getElementById(id);
            const bar = list?.previousElementSibling;
            if (!list || !bar?.classList.contains('yrg-native-groups')) continue;
            const info = this.currentContext(scope);
            const scripts = this.adapter.getScripts(scope);
            const scriptMap = new Map(scripts.map(script => [String(script.id), script]));
            const groups = listGroups(store, scope, info.key);
            if (!groups.some(group => group.id === this.nativeGroups[scope])) this.nativeGroups[scope] = DEFAULT_GROUP_ID;
            const active = this.nativeGroups[scope];
            const activeCollapsed = this.isNativeCollapsed(scope, info.key, active);
            const savedScrollLeft = this.rememberNativeScroll(scope, bar);
            Array.from(list.children).forEach(row => {
                if (!row.classList.contains('regex-script-label')) return;
                const filtered = assignedGroup(store, scope, info.key, row.id) !== active;
                row.hidden = filtered || activeCollapsed;
                row.classList.toggle('yrg-native-filtered', filtered);
                const box = row.querySelector('.regex_bulk_checkbox');
                row.classList.toggle('yrg-native-selected', !!box?.checked);
                const scriptItem = scriptMap.get(String(row.id));
                const name = row.querySelector('.regex_script_name');
                if (name && scriptItem) {
                    const find = String(scriptItem.findRegex || '').replace(/\s+/g, ' ').trim();
                    updateHtml(name, `<span class="yrg-native-name-text">${escapeHtml(scriptItem.scriptName || '未命名正则')}</span><small class="yrg-native-find">${escapeHtml(find || '未填写查找表达式')}</small>`);
                    name.title = scriptItem.scriptName || '';
                }
            });
            list.classList.toggle('yrg-native-list-collapsed', activeCollapsed);
            const selectedCount = this.nativeSelectedIds(scope).length;
            bar.classList.toggle('yrg-native-selecting', selectedCount > 0);
            const groupTabs = groups.map(group => {
                const count = scriptsInGroup(store, scope, info.key, scripts, group.id).length;
                const collapsed = this.isNativeCollapsed(scope, info.key, group.id);
                return `<div class="yrg-native-tab-wrap ${group.id === active ? 'active' : ''} ${collapsed ? 'collapsed' : ''}">
                    <button type="button" class="yrg-native-tab ${group.id === active ? 'active' : ''}" data-yrg-native-group="${escapeHtml(group.id)}"><span>${escapeHtml(group.name)}</span><b>${count}</b></button>
                    <button type="button" class="yrg-native-collapse" data-yrg-native-collapse="${escapeHtml(group.id)}" title="${collapsed ? '展开' : '折叠'}${escapeHtml(group.name)}" aria-label="${collapsed ? '展开' : '折叠'}${escapeHtml(group.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg></button>
                </div>`;
            }).join('');
            const groupMenu = this.nativeGroupMenus[scope] ? `<div class="yrg-native-group-menu">
                <div class="yrg-native-group-menu-title"><span>管理分组</span><button type="button" data-yrg-native-action="add" title="新建分组" aria-label="新建分组">${TOOL_ICONS.plus}</button></div>
                ${groups.map(group => `<div class="yrg-native-group-menu-row"><span>${escapeHtml(group.name)}</span>${group.locked
                    ? '<small>默认分组</small>'
                    : `<div><button type="button" data-yrg-native-action="rename-group" data-yrg-group-id="${escapeHtml(group.id)}" title="重命名" aria-label="重命名 ${escapeHtml(group.name)}">${TOOL_ICONS.edit}</button><button class="danger" type="button" data-yrg-native-action="delete-group" data-yrg-group-id="${escapeHtml(group.id)}" title="删除分组" aria-label="删除 ${escapeHtml(group.name)}">${TOOL_ICONS.trash}</button></div>`}</div>`).join('')}
            </div>` : '';
            if (!bar.querySelector('.yrg-native-scroll')) {
                bar.innerHTML = '<div class="yrg-native-group-line"><div class="yrg-native-scroll"></div><div class="yrg-native-fixed"></div></div><div class="yrg-native-tools"></div><div class="yrg-native-menu-host"></div>';
                const scroll = bar.querySelector('.yrg-native-scroll');
                scroll.addEventListener('scroll', () => { this.nativeScrollLeft[scope] = scroll.scrollLeft; }, { passive: true });
                this.bindNativeScroller(scroll, scope);
            }
            updateHtml(bar.querySelector('.yrg-native-scroll'), groupTabs);
            updateHtml(bar.querySelector('.yrg-native-fixed'), `<button type="button" class="${this.nativeGroupMenus[scope] ? 'active' : ''}" data-yrg-native-action="manage-groups" title="管理分组" aria-label="管理分组">${TOOL_ICONS.gear}</button>`);
            updateHtml(bar.querySelector('.yrg-native-tools'), `
                <button class="yrg-native-select" type="button" data-yrg-native-action="select" title="${selectedCount ? '取消选择' : '全选本组'}">${TOOL_ICONS[selectedCount ? 'clear' : 'select']}<span>${selectedCount ? `已选 ${selectedCount}` : '全选'}</span></button>
                <span class="yrg-native-tools-spacer"></span>
                <button class="danger yrg-native-tool-icon" type="button" data-yrg-native-action="delete-selected" title="永久删除选中的正则" aria-label="删除选中的正则" ${selectedCount ? '' : 'disabled'}>${TOOL_ICONS.trash}</button>
                <button class="yrg-native-tool-icon" type="button" data-yrg-native-action="manage" title="打开完整正则管理面板" aria-label="打开完整正则管理面板">${TOOL_ICONS.panel}</button>
            `);
            updateHtml(bar.querySelector('.yrg-native-menu-host'), groupMenu);
            const scroll = bar.querySelector('.yrg-native-scroll');
            if (scroll && scroll.scrollLeft !== savedScrollLeft) {
                scroll.scrollLeft = savedScrollLeft;
            }
        }
    }

    syncNativeRows() {
        const scripts = SCOPES.flatMap(scope => this.adapter.getScripts(scope));
        scripts.forEach(script => {
            const row = this.doc.getElementById(String(script.id));
            const input = row?.querySelector('.disable_regex');
            if (input) input.checked = !!script.disabled;
        });
        this.refreshNativeBars();
    }

    bindSillyTavernEvents() {
        const { eventSource, event_types } = this.adapter.script;
        if (!eventSource?.on || !event_types) return;
        const refresh = () => {
            if (!this.overlay.hidden) this.render();
            this.refreshNativeBars();
        };
        [event_types.CHAT_CHANGED, event_types.PRESET_CHANGED, event_types.MAIN_API_CHANGED].filter(Boolean).forEach(type => {
            eventSource.on(type, refresh);
            this.eventBindings.push([type, refresh]);
        });
        if (event_types.PRESET_RENAMED_BEFORE) {
            const rename = ({ apiId, oldName, newName } = {}) => {
                const store = this.adapter.getStore();
                if (migrateOwnerKey(store, 'preset', `${apiId}::${oldName}`, `${apiId}::${newName}`)) this.adapter.saveStore(store);
            };
            eventSource.on(event_types.PRESET_RENAMED_BEFORE, rename);
            this.eventBindings.push([event_types.PRESET_RENAMED_BEFORE, rename]);
        }
    }

    destroy() {
        this.nativeObservers.forEach(observer => observer.disconnect());
        this.nativeObservers = [];
        this.nativeListeners.forEach(([target, type, handler, options]) => {
            target.removeEventListener(type, handler, options);
            if (target.id === 'import_regex') delete target.dataset.yrgCaptured;
        });
        this.nativeListeners = [];
        const eventSource = this.adapter.script.eventSource;
        this.eventBindings.forEach(([type, handler]) => {
            if (typeof eventSource?.off === 'function') eventSource.off(type, handler);
            else if (typeof eventSource?.removeListener === 'function') eventSource.removeListener(type, handler);
        });
        this.eventBindings = [];
        this.doc.getElementById('yuyuan-regex-groups-open-native')?.remove();
        this.doc.querySelectorAll('.yrg-native-groups').forEach(element => element.remove());
        this.doc.querySelectorAll('[data-yrg-observed]').forEach(element => { delete element.dataset.yrgObserved; });
        this.doc.querySelectorAll('.regex-script-label[hidden], .regex-script-label.yrg-native-filtered').forEach(element => {
            element.hidden = false;
            element.classList.remove('yrg-native-filtered');
        });
        this.doc.removeEventListener('click', this.boundNativeDocumentClick);
        releaseViewportOverlay(this.overlay);
        this.overlay?.remove();
        this.doc.getElementById('yuyuan-regex-groups-css')?.remove();
    }
}

export async function init(options = {}) {
    if (instance) return instance;
    const adapter = await createSillyTavernAdapter(options.root || window);
    instance = new RegexGroupManager(adapter);
    instance.init();
    return instance;
}

export async function open(options = {}) {
    const manager = await init(options);
    manager.open(options.scope);
    return manager;
}

export async function enhanceNative(options = {}) {
    const manager = await init(options);
    return manager.enhanceNativePanel();
}

export function destroy() {
    instance?.destroy();
    instance = null;
}

export function status() {
    return { initialized: !!instance, open: !!instance && !instance.overlay.hidden };
}
