import { correctSameLayerMessage } from './core.js';
import { findOverlay, mountViewportOverlay, releaseViewportOverlay, protectHostDrawer } from '../host-view.js';

const LOG_KEY = 'yuyuan_message_corrector_log_v1';
const MAX_LOGS = 80;
let instance = null;

const waitFrame = root => new Promise(resolve => root.setTimeout(resolve, 0));
const clip = (value, size = 220) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > size ? `${text.slice(0, size)}…` : text;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[char]);

function getContext(root) {
    return root.SillyTavern?.getContext?.() || null;
}

function resolveMessageId(payload, chat) {
    const raw = payload && typeof payload === 'object'
        ? (payload.messageId ?? payload.message_id ?? payload.id)
        : payload;
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < chat.length) return numeric;
    return chat.length ? chat.length - 1 : -1;
}

function loadLogs(root) {
    try {
        const parsed = JSON.parse(root.localStorage.getItem(LOG_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.slice(0, MAX_LOGS) : [];
    } catch {
        return [];
    }
}

function saveLogs(root, logs) {
    try { root.localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, MAX_LOGS))); } catch {}
}

class MessageCorrector {
    constructor(root) {
        this.root = root;
        this.enabled = false;
        this.newOnly = true;
        this.bound = false;
        this.scanning = false;
        this.skipChatScanUntil = 0;
        this.handlers = [];
        this.chatScanTimer = null;
    }

    context() {
        return getContext(this.root);
    }

    names() {
        const ctx = this.context();
        return { userName: ctx?.name1 || '', charName: ctx?.name2 || '' };
    }

    record(messageId, changes, source) {
        if (!changes.length) return;
        const logs = loadLogs(this.root);
        logs.unshift({
            at: Date.now(),
            messageId,
            source,
            count: changes.length,
            changes: changes.slice(0, 12).map(change => ({
                line: change.line,
                reason: change.reason,
                before: clip(change.before),
                after: clip(change.after),
            })),
        });
        saveLogs(this.root, logs);
    }

    correctMessage(messageId, source = 'new') {
        const ctx = this.context();
        const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        const message = chat[messageId];
        if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') return 0;
        const result = correctSameLayerMessage(message.mes, this.names());
        if (!result.changes.length) return 0;
        message.mes = result.text;
        this.record(messageId, result.changes, source);
        return result.changes.length;
    }

    async onMessage(payload) {
        if (!this.enabled) return;
        const ctx = this.context();
        const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        const messageId = resolveMessageId(payload, chat);
        if (messageId < 0) return;
        const count = this.correctMessage(messageId, 'new');
        if (count) {
            await ctx.saveChat?.();
            if (this.context()?.chat === chat) ctx.updateMessageBlock?.(messageId, chat[messageId]);
        }
    }

    async scanCurrentChat({ notify = true } = {}) {
        if (this.scanning) return { messages: 0, changes: 0 };
        const ctx = this.context();
        const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        this.scanning = true;
        let messages = 0;
        let changes = 0;
        const names = this.names();
        const sameChat = () => this.context()?.chat === chat
            && this.names().userName === names.userName && this.names().charName === names.charName;
        const pending = [];
        try {
            for (let index = 0; index < chat.length; index += 1) {
                if (!sameChat()) return { messages: 0, changes: 0, cancelled: true };
                const message = chat[index];
                if (message && !message.is_user && !message.is_system && typeof message.mes === 'string') {
                    const before = message.mes;
                    const result = correctSameLayerMessage(before, names);
                    if (result.changes.length) pending.push({ index, message, before, result });
                }
                if (index > 0 && index % 30 === 0) await waitFrame(this.root);
            }
            if (!sameChat() || pending.some(item => chat[item.index] !== item.message || item.message.mes !== item.before)) {
                return { messages: 0, changes: 0, cancelled: true };
            }
            for (const item of pending) {
                item.message.mes = item.result.text;
                this.record(item.index, item.result.changes, 'history');
                messages++;
                changes += item.result.changes.length;
            }
            if (changes) {
                await ctx.saveChat?.();
                if (!sameChat()) return { messages, changes, cancelled: true };
                if (typeof ctx.reloadCurrentChat === 'function') {
                    this.skipChatScanUntil = Date.now() + 1200;
                    await ctx.reloadCurrentChat();
                }
            }
            if (notify) {
                const toast = this.root.toastr;
                const text = changes ? `已校正 ${messages} 条消息中的 ${changes} 处问题` : '当前聊天没有发现可确定的同层身份错误';
                toast?.[changes ? 'success' : 'info']?.(text);
            }
            return { messages, changes };
        } finally {
            this.scanning = false;
        }
    }

    bind() {
        if (this.bound) return;
        const ctx = this.context();
        const { eventSource } = ctx || {};
        const event_types = ctx?.event_types || ctx?.eventTypes;
        if (!eventSource?.on || !event_types) throw new Error('酒馆消息事件尚未就绪');
        const incoming = payload => this.onMessage(payload).catch(error => console.error('[yuyuan-message-corrector]', error));
        const chatChanged = () => {
            this.root.clearTimeout?.(this.chatScanTimer);
            if (!this.enabled || this.newOnly || Date.now() < this.skipChatScanUntil) return;
            const chat = this.context()?.chat;
            this.chatScanTimer = this.root.setTimeout(() => {
                this.chatScanTimer = null;
                if (!this.enabled || this.newOnly || this.context()?.chat !== chat) return;
                this.scanCurrentChat({ notify: false }).catch(error => console.error('[yuyuan-message-corrector]', error));
            }, 80);
        };
        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, incoming);
            this.handlers.push([event_types.MESSAGE_RECEIVED, incoming]);
        }
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, chatChanged);
            this.handlers.push([event_types.CHAT_CHANGED, chatChanged]);
        }
        this.bound = true;
    }

    setEnabled(value) {
        this.enabled = !!value;
        if (!this.enabled) this.root.clearTimeout?.(this.chatScanTimer);
        if (this.enabled) this.bind();
        return this.enabled;
    }

    async setNewOnly(value) {
        this.newOnly = !!value;
        if (this.newOnly) this.root.clearTimeout?.(this.chatScanTimer);
        if (this.enabled && !this.newOnly) await this.scanCurrentChat({ notify: true });
        return this.newOnly;
    }

    openLog() {
        const doc = this.root.document;
        const previous = findOverlay(this.root, 'yuyuan-corrector-log');
        releaseViewportOverlay(previous);
        previous?.remove();
        const logs = loadLogs(this.root);
        const overlay = doc.createElement('div');
        overlay.id = 'yuyuan-corrector-log';
        overlay.innerHTML = `
            <section class="ycmc-card" role="dialog" aria-modal="true" aria-labelledby="ycmc-title">
                <header><div><small>YUYUAN TOOLS</small><h2 id="ycmc-title">同层消息校正记录</h2></div><button type="button" data-ycmc-close aria-label="关闭">×</button></header>
                <div class="ycmc-list">${logs.length ? logs.map(log => `
                    <article>
                        <div class="ycmc-log-head"><b>${new Date(log.at).toLocaleString()}</b><span>消息 ${escapeHtml(log.messageId)} · ${escapeHtml(log.count)} 处</span></div>
                        ${(log.changes || []).map(change => `<div class="ycmc-change"><em>第 ${escapeHtml(change.line)} 行 · ${escapeHtml(change.reason)}</em><del>${escapeHtml(change.before)}</del><ins>${escapeHtml(change.after)}</ins></div>`).join('')}
                    </article>`).join('') : '<div class="ycmc-empty">还没有校正记录</div>'}</div>
                <footer><span>记录只保存在当前设备</span><button type="button" data-ycmc-clear ${logs.length ? '' : 'disabled'}>清空记录</button></footer>
            </section>`;
        const close = () => {
            releaseViewportOverlay(overlay);
            overlay.remove();
        };
        protectHostDrawer(overlay);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.querySelector('[data-ycmc-close]').addEventListener('click', close);
        overlay.querySelector('[data-ycmc-clear]').addEventListener('click', () => {
            saveLogs(this.root, []);
            this.openLog();
        });
        mountViewportOverlay(this.root, overlay);
        return overlay;
    }
}

function ensureStyle(root) {
    if (root.document.getElementById('yuyuan-message-corrector-css')) return;
    const link = root.document.createElement('link');
    link.id = 'yuyuan-message-corrector-css';
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    (root.document.head || root.document.documentElement).appendChild(link);
}

export async function init({ root = globalThis.top || globalThis, enabled = false, newOnly = true } = {}) {
    ensureStyle(root);
    if (!instance) instance = new MessageCorrector(root);
    instance.newOnly = !!newOnly;
    instance.setEnabled(enabled);
    return instance;
}

export async function setEnabled(enabled, options = {}) {
    const manager = await init({ ...options, enabled });
    manager.setEnabled(enabled);
    return manager;
}

export async function setNewOnly(newOnly, options = {}) {
    const manager = await init({ ...options, enabled: options.enabled ?? instance?.enabled ?? false, newOnly });
    await manager.setNewOnly(newOnly);
    return manager;
}

export async function scanCurrentChat(options = {}) {
    const manager = await init(options);
    return await manager.scanCurrentChat({ notify: options.notify !== false });
}

export async function openLog(options = {}) {
    const manager = await init(options);
    return manager.openLog();
}
