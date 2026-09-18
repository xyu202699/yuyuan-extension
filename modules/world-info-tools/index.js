import { cloneWorldInfo, getEntrySnapshot, restoreEntrySnapshot, worldInfoFingerprint } from './core.js';

const STYLE_ID = 'yuyuan-world-info-tools-css';
const BUTTON_CLASS = 'yuyuan-world-entry-undo';
const MAX_HISTORY = 30;
let instance = null;

function context(root) {
    return root.SillyTavern?.getContext?.() || null;
}

function currentBookName(root) {
    const select = root.document.getElementById('world_editor_select');
    const option = select?.selectedOptions?.[0];
    const name = String(option?.textContent || '').trim();
    return option?.value && name && !/^---/.test(name) ? name : '';
}

function entryUid(element) {
    const entry = element?.closest?.('.world_entry');
    return entry?.dataset?.uid ?? entry?.getAttribute?.('uid') ?? '';
}

function ensureStyle(root) {
    if (root.document.getElementById(STYLE_ID)) return;
    const link = root.document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    (root.document.head || root.document.documentElement).appendChild(link);
}

class WorldInfoEntryUndo {
    constructor(root) {
        this.root = root;
        this.enabled = false;
        this.bound = false;
        this.current = new Map();
        this.history = new Map();
        this.editBursts = new Map();
        this.lastFocusedControl = new Map();
        this.listObserver = null;
        this.pageObserver = null;
        this.undoBusy = false;
    }

    ctx() { return context(this.root); }

    notify(message, type = 'info') {
        this.root.toastr?.[type]?.(message);
    }

    historyKey(name, uid) {
        return `${name}\u0000${String(uid)}`;
    }

    stackFor(name, uid) {
        const key = this.historyKey(name, uid);
        if (!this.history.has(key)) this.history.set(key, []);
        return this.history.get(key);
    }

    pushHistory(name, uid, snapshot) {
        if (!name || uid === '' || !snapshot) return;
        const stack = this.stackFor(name, uid);
        const fingerprint = worldInfoFingerprint(snapshot);
        if (stack.length && worldInfoFingerprint(stack[stack.length - 1]) === fingerprint) return;
        stack.push(cloneWorldInfo(snapshot));
        if (stack.length > MAX_HISTORY) stack.splice(0, stack.length - MAX_HISTORY);
        this.paintButtons();
    }

    async hydrate(name = currentBookName(this.root), force = false) {
        if (!name) return null;
        if (!force && this.current.has(name)) return this.current.get(name);
        const data = await this.ctx()?.loadWorldInfo?.(name);
        if (data) this.current.set(name, cloneWorldInfo(data));
        this.paintButtons();
        return data;
    }

    async captureEdit(event) {
        if (!this.enabled) return;
        const target = event.target;
        if (!target?.closest?.('#world_popup_entries_list')) return;
        const control = target.closest('input, textarea, select, .killSwitch');
        const uid = entryUid(control);
        const name = currentBookName(this.root);
        this.rememberFocusedControl(control, name, uid);
        const beforeData = this.current.get(name);
        const before = getEntrySnapshot(beforeData, uid);
        if (!control || !name || uid === '' || !before) return;

        const field = control.getAttribute?.('name') || control.className || control.tagName;
        const burstKey = `${this.historyKey(name, uid)}\u0000${String(field)}`;
        await Promise.resolve();
        const latest = await this.ctx()?.loadWorldInfo?.(name);
        const after = getEntrySnapshot(latest, uid);
        if (!after || worldInfoFingerprint(before) === worldInfoFingerprint(after)) return;

        if (!this.editBursts.has(burstKey)) this.pushHistory(name, uid, before);
        this.root.clearTimeout(this.editBursts.get(burstKey));
        this.editBursts.set(burstKey, this.root.setTimeout(() => this.editBursts.delete(burstKey), 700));
        this.current.set(name, cloneWorldInfo(latest));
    }

    rememberFocusedControl(control, name = currentBookName(this.root), uid = entryUid(control)) {
        if (!control || !name || uid === '' || !control.matches?.('input, textarea, select')) return;
        const entry = control.closest('.world_entry');
        if (!entry) return;
        const controls = Array.from(entry.querySelectorAll('input, textarea, select'));
        const sameKind = controls.filter(item => item.tagName === control.tagName && item.getAttribute('name') === control.getAttribute('name'));
        this.lastFocusedControl.set(this.historyKey(name, uid), {
            id: control.id || '',
            name: control.getAttribute('name') || '',
            tagName: control.tagName,
            index: Math.max(0, sameKind.indexOf(control)),
            selectionStart: typeof control.selectionStart === 'number' ? control.selectionStart : null,
            selectionEnd: typeof control.selectionEnd === 'number' ? control.selectionEnd : null,
        });
    }

    onWorldUpdated(name, data) {
        if (!name || !data) return;
        this.current.set(name, cloneWorldInfo(data));
        this.paintButtons();
    }

    installEntryButtons() {
        if (!this.enabled) return false;
        const doc = this.root.document;
        const list = doc.getElementById('world_popup_entries_list');
        if (!list) return false;
        list.querySelectorAll('.world_entry').forEach(entry => {
            if (entry.querySelector(`.${BUTTON_CLASS}`)) return;
            const anchor = entry.querySelector('.move_entry_button, .duplicate_entry_button, .delete_entry_button');
            const header = anchor?.parentElement;
            if (!header) return;
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = `menu_button fa-solid fa-rotate-left ${BUTTON_CLASS}`;
            button.title = '撤销当前条目的上一步编辑';
            button.setAttribute('aria-label', '撤销当前条目的上一步编辑');
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this.undoEntry(button).catch(error => this.notify(`撤销失败：${error.message}`, 'error'));
            });
            header.insertBefore(button, anchor);
        });
        this.paintButtons();
        this.watchEntryList(list);
        return true;
    }

    watchEntryList(list) {
        if (this.listObserver?.target === list) return;
        this.listObserver?.observer?.disconnect();
        const observer = new this.root.MutationObserver(() => this.installEntryButtons());
        observer.observe(list, { childList: true, subtree: true });
        this.listObserver = { target: list, observer };
    }

    watchPageForEntryList() {
        if (!this.enabled || this.pageObserver) return;
        const doc = this.root.document;
        this.pageObserver = new this.root.MutationObserver(() => {
            if (!this.installEntryButtons()) return;
            this.pageObserver?.disconnect();
            this.pageObserver = null;
        });
        this.pageObserver.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    }

    paintButtons() {
        const name = currentBookName(this.root);
        this.root.document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => {
            const uid = entryUid(button);
            const count = name && uid !== '' ? this.stackFor(name, uid).length : 0;
            button.disabled = this.undoBusy || count === 0;
            button.title = count ? `撤销当前条目的上一步编辑（剩余 ${count} 步）` : '当前条目暂无可撤销编辑';
            button.dataset.undoCount = String(count);
        });
    }

    isEntryExpanded(entry) {
        return Array.from(entry?.querySelectorAll?.('.inline-drawer-content') || []).some(element => {
            const style = this.root.getComputedStyle?.(element);
            return style ? style.display !== 'none' && style.visibility !== 'hidden' : element.style.display !== 'none';
        });
    }

    currentPageNumber() {
        try {
            const pagination = this.root.jQuery?.('#world_info_pagination') || this.root.$?.('#world_info_pagination');
            return Math.max(1, Number(pagination?.pagination?.('getCurrentPageNum')) || 1);
        } catch {
            return 1;
        }
    }

    captureUiState(button, name, uid) {
        const doc = this.root.document;
        const list = doc.getElementById('world_popup_entries_list');
        const panel = doc.getElementById('WorldInfo');
        const entry = button.closest('.world_entry');
        const openUids = Array.from(list?.querySelectorAll?.('.world_entry') || [])
            .filter(item => this.isEntryExpanded(item))
            .map(item => entryUid(item));
        const active = doc.activeElement;
        if (active?.closest?.('.world_entry')) this.rememberFocusedControl(active, name, entryUid(active));
        return {
            previousEntry: entry,
            previousFirstEntry: list?.querySelector('.world_entry') || null,
            page: this.currentPageNumber(),
            openUids,
            focus: cloneWorldInfo(this.lastFocusedControl.get(this.historyKey(name, uid)) || null),
            panelScrollTop: panel?.scrollTop || 0,
            panelScrollLeft: panel?.scrollLeft || 0,
            listScrollTop: list?.scrollTop || 0,
            listScrollLeft: list?.scrollLeft || 0,
            windowScrollX: this.root.scrollX || 0,
            windowScrollY: this.root.scrollY || 0,
        };
    }

    async waitUntil(check, timeout = 2500) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            const result = check();
            if (result) return result;
            await new Promise(resolve => this.root.setTimeout(resolve, 16));
        }
        return null;
    }

    findEntry(uid) {
        return Array.from(this.root.document.querySelectorAll('#world_popup_entries_list .world_entry'))
            .find(entry => String(entryUid(entry)) === String(uid)) || null;
    }

    async restoreUiState(state, uid, name = currentBookName(this.root)) {
        const sameBook = () => this.enabled && currentBookName(this.root) === name;
        if (!sameBook()) return;
        const doc = this.root.document;
        await this.waitUntil(() => {
            const first = doc.querySelector('#world_popup_entries_list .world_entry');
            return first && first !== state.previousFirstEntry;
        });

        if (!sameBook()) return;
        if (state.page > 1) {
            try {
                const pagination = this.root.jQuery?.('#world_info_pagination') || this.root.$?.('#world_info_pagination');
                pagination?.pagination?.('go', state.page);
            } catch {
                // Older SillyTavern builds may not expose the pagination helper.
            }
        }

        const entry = await this.waitUntil(() => {
            const current = this.findEntry(uid);
            return current && current !== state.previousEntry ? current : null;
        });
        if (!entry || !sameBook()) return;

        for (const openUid of state.openUids) {
            const openEntry = this.findEntry(openUid);
            if (!openEntry || this.isEntryExpanded(openEntry)) continue;
            openEntry.querySelector('.inline-drawer-icon')?.click();
        }
        await new Promise(resolve => this.root.requestAnimationFrame?.(() => resolve()) || this.root.setTimeout(resolve, 16));
        if (!sameBook()) return;

        const panel = doc.getElementById('WorldInfo');
        const list = doc.getElementById('world_popup_entries_list');
        if (panel) {
            panel.scrollTop = state.panelScrollTop;
            panel.scrollLeft = state.panelScrollLeft;
        }
        if (list) {
            list.scrollTop = state.listScrollTop;
            list.scrollLeft = state.listScrollLeft;
        }
        this.root.scrollTo?.(state.windowScrollX, state.windowScrollY);

        const focus = state.focus;
        if (!focus) return;
        const restoreFocus = () => {
            if (!sameBook()) return;
            const currentEntry = this.findEntry(uid);
            if (!currentEntry) return;
            const controls = Array.from(currentEntry.querySelectorAll('input, textarea, select'));
            let control = focus.id ? controls.find(item => item.id === focus.id) : null;
            if (!control) {
                const matches = controls.filter(item => item.tagName === focus.tagName && item.getAttribute('name') === focus.name);
                control = matches[focus.index] || matches[0] || null;
            }
            if (!control) return;
            const active = doc.activeElement;
            if (active && active !== doc.body && active !== control && !active.classList?.contains(BUTTON_CLASS)) return;
            try { control.focus?.({ preventScroll: true }); } catch { control.focus?.(); }
            if (typeof control.setSelectionRange === 'function' && focus.selectionStart !== null) {
                const length = String(control.value ?? '').length;
                control.setSelectionRange(Math.min(focus.selectionStart, length), Math.min(focus.selectionEnd ?? focus.selectionStart, length));
            }
            const currentPanel = doc.getElementById('WorldInfo');
            const currentList = doc.getElementById('world_popup_entries_list');
            if (currentPanel) {
                currentPanel.scrollTop = state.panelScrollTop;
                currentPanel.scrollLeft = state.panelScrollLeft;
            }
            if (currentList) {
                currentList.scrollTop = state.listScrollTop;
                currentList.scrollLeft = state.listScrollLeft;
            }
        };
        restoreFocus();
        this.root.setTimeout(restoreFocus, 60);
        this.root.setTimeout(restoreFocus, 180);
        this.root.setTimeout(restoreFocus, 420);
    }

    async undoEntry(button) {
        if (!this.enabled || this.undoBusy) return;
        const name = currentBookName(this.root);
        const uid = entryUid(button);
        if (!name || uid === '') return this.notify('没有找到当前世界书条目', 'info');
        const stack = this.stackFor(name, uid);
        const snapshot = stack.pop();
        if (!snapshot) return this.notify('当前条目暂时没有可撤销的编辑', 'info');
        const uiState = this.captureUiState(button, name, uid);
        this.undoBusy = true;
        this.paintButtons();

        try {
            const latest = await this.ctx()?.loadWorldInfo?.(name);
            if (!latest) throw new Error('无法读取当前世界书');
            const restored = restoreEntrySnapshot(latest, snapshot);
            const ctx = this.ctx();
            if (typeof ctx?.saveWorldInfo !== 'function') throw new Error('当前酒馆未提供世界书保存接口');
            await ctx.saveWorldInfo(name, restored, true);
            this.current.set(name, cloneWorldInfo(restored));
            if (this.enabled && currentBookName(this.root) === name) {
                this.ctx()?.reloadWorldInfoEditor?.(name, true);
                await this.restoreUiState(uiState, uid, name);
            }
            this.notify('当前条目已返回上一步', 'success');
        } catch (error) {
            stack.push(snapshot);
            throw error;
        } finally {
            this.undoBusy = false;
            this.paintButtons();
        }
    }

    bind() {
        if (this.bound) return;
        const doc = this.root.document;
        const capture = event => this.captureEdit(event).catch(error => console.warn('[yuyuan-world-info-undo]', error));
        const rememberFocus = event => {
            const control = event.target?.closest?.('#world_popup_entries_list input, #world_popup_entries_list textarea, #world_popup_entries_list select');
            if (control) this.rememberFocusedControl(control);
        };
        doc.addEventListener('input', capture, true);
        doc.addEventListener('change', capture, true);
        doc.addEventListener('click', capture, true);
        doc.addEventListener('focusin', rememberFocus, true);
        doc.addEventListener('change', event => {
            if (event.target?.id !== 'world_editor_select') return;
            this.root.setTimeout(() => this.hydrate(currentBookName(this.root), true).catch(() => {}), 0);
        }, true);

        const ctx = this.ctx();
        const eventName = ctx?.eventTypes?.WORLDINFO_UPDATED || ctx?.event_types?.WORLDINFO_UPDATED;
        if (eventName && ctx?.eventSource?.on) ctx.eventSource.on(eventName, (name, data) => this.onWorldUpdated(name, data));

        this.bound = true;
        if (!this.installEntryButtons()) this.watchPageForEntryList();
        this.hydrate().catch(() => {});
    }

    setEnabled(value) {
        this.enabled = !!value;
        if (this.enabled) {
            this.bind();
            if (!this.installEntryButtons()) this.watchPageForEntryList();
        } else {
            this.root.document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => button.remove());
            this.listObserver?.observer?.disconnect();
            this.listObserver = null;
            this.pageObserver?.disconnect();
            this.pageObserver = null;
        }
        return this.enabled;
    }
}

export async function init({ root = globalThis.top || globalThis, enabled = true } = {}) {
    ensureStyle(root);
    if (!instance) instance = new WorldInfoEntryUndo(root);
    instance.setEnabled(enabled);
    return instance;
}

export async function setEnabled(enabled, options = {}) {
    const manager = await init({ ...options, enabled });
    manager.setEnabled(enabled);
    return manager;
}

export async function enhanceNative({ root = globalThis.top || globalThis } = {}) {
    const manager = await init({ root, enabled: instance?.enabled ?? true });
    manager.installEntryButtons();
    return manager;
}
