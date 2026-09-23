const MODULE_NAME = 'yuyuan-extension';
const EXTENSION_VERSION = '0.9.30';
const REMOTE_CORE_URL = 'https://yuyuan111.pages.dev/yuyuan.js';
const REGEX_GROUPS_MODULE = 'modules/regex-groups/index.js';
const PRESET_EDITOR_MODULE = 'modules/preset-editor/index.js';
const WORLD_INFO_TOOLS_MODULE = 'modules/world-info-tools/index.js';
const MESSAGE_CORRECTOR_MODULE = 'modules/message-corrector/index.js';
const DOCK_MODULE = 'modules/dock/index.js';
const DOCK_STYLE = 'modules/dock/style.css';
const UPDATER_MODULE = 'modules/updater/index.js';
const SAFE_MODE_KEY = 'yuyuan_extension_safe_mode';
const DIAG_KEY = 'yuyuan_extension_diag_v1';
const UI_PREFS_KEY = 'yuyuan_extension_ui_v1';
const STORE_KEY = 'xhs_data_v1';
const DEFAULT_UI_PREFS = Object.freeze({ phoneEnabled: true, floatingBall: true, magicWand: true, quickReplyButton: true, regexManager: true, presetEditor: true, worldInfoTools: true, messageCorrector: false, messageCorrectorNewOnly: true });
const LEGACY_SCRIPT_BUTTONS = new Set(['芋圆机', '芋圆机弹出', '芋圆机按钮']);
const QUICK_BUTTON_ID = 'yuyuan-extension-quick-button';
const QUICK_FALLBACK_ID = 'yuyuan-extension-quick-bar';
let regexGroupsModulePromise = null;
let presetEditorModulePromise = null;
let worldInfoToolsModulePromise = null;
let messageCorrectorModulePromise = null;
let dockModulePromise = null;
let updaterModulePromise = null;

function registerQrAssistantButton() {
    const root = getRootWindow();
    const registry = Array.isArray(root.qrAssistantExtensionApi) ? root.qrAssistantExtensionApi : [];
    root.qrAssistantExtensionApi = registry;
    if (registry.some(item => item?.dom_id === QUICK_BUTTON_ID)) return false;
    registry.push({ dom_id: QUICK_BUTTON_ID, group_name: '芋圆小屋♡°.•', button_name: '芋圆机' });
    root.setTimeout(() => {
        try { root.quickReplyMenu?.applyWhitelistDOMChanges?.(); } catch {}
        try { root.quickReplyMenu?.populateWhitelistManagementUI?.(); } catch {}
    }, 0);
    return true;
}

// Loading order 50 lets the bundled dock claim ownership before an old
// standalone yuyuan-dock (loading order 100) can start its obsolete updater.
try { getRootWindow().__YUYUAN_DOCK_EMBEDDED__ = true; } catch {}

function extensionBaseUrl() {
    const root = getRootWindow();
    const ownScript = Array.from(root.document.scripts).find(script => /\/yuyuan-extension\/index\.js(?:[?#]|$)/.test(script.src));
    return ownScript?.src ? new URL('.', ownScript.src).href : new URL('./scripts/extensions/third-party/yuyuan-extension/', root.location.href).href;
}

async function loadRegexGroupsModule() {
    if (!regexGroupsModulePromise) {
        const url = new URL(REGEX_GROUPS_MODULE, extensionBaseUrl()).href;
        regexGroupsModulePromise = import(url).then(async module => {
            await module.init({ root: getRootWindow() });
            getRootWindow().__YUYUAN_REGEX_GROUPS__ = module;
            return module;
        }).catch(error => {
            regexGroupsModulePromise = null;
            throw error;
        });
    }
    return await regexGroupsModulePromise;
}

async function openRegexGroups(scope) {
    if (!readUiPrefs().regexManager) {
        notify('请先开启正则管理', 'info');
        return null;
    }
    try {
        const module = await loadRegexGroupsModule();
        return await module.open({ root: getRootWindow(), scope });
    } catch (error) {
        console.error(`[${MODULE_NAME}] regex groups failed to load`, error);
        notify(`正则分组加载失败：${error.message}`, 'error');
        return null;
    }
}

async function loadPresetEditorModule() {
    if (!presetEditorModulePromise) {
        const url = new URL(PRESET_EDITOR_MODULE, extensionBaseUrl()).href;
        presetEditorModulePromise = import(url).then(async module => {
            const prefs = readUiPrefs();
            await module.init({ root: getRootWindow(), enabled: prefs.presetEditor });
            return module;
        }).catch(error => {
            presetEditorModulePromise = null;
            throw error;
        });
    }
    return await presetEditorModulePromise;
}

async function openPresetEditor() {
    if (!readUiPrefs().presetEditor) {
        notify('请先开启预设快速编辑', 'info');
        return null;
    }
    try {
        const module = await loadPresetEditorModule();
        return await module.open({ root: getRootWindow() });
    } catch (error) {
        console.error(`[${MODULE_NAME}] preset editor failed to load`, error);
        notify(`预设编辑加载失败：${error.message}`, 'error');
        return null;
    }
}

async function syncPresetEditor(enabled) {
    if (!enabled && !presetEditorModulePromise) return;
    const module = await loadPresetEditorModule();
    await module.setEnabled?.(enabled, { root: getRootWindow() });
}

async function loadWorldInfoToolsModule() {
    if (!worldInfoToolsModulePromise) {
        const url = new URL(WORLD_INFO_TOOLS_MODULE, extensionBaseUrl()).href;
        worldInfoToolsModulePromise = import(url).then(async module => {
            const prefs = readUiPrefs();
            await module.init({ root: getRootWindow(), enabled: prefs.worldInfoTools });
            return module;
        }).catch(error => {
            worldInfoToolsModulePromise = null;
            throw error;
        });
    }
    return await worldInfoToolsModulePromise;
}

async function syncWorldInfoTools(enabled) {
    if (!enabled && !worldInfoToolsModulePromise) return;
    const module = await loadWorldInfoToolsModule();
    await module.setEnabled?.(enabled, { root: getRootWindow() });
}

async function loadMessageCorrectorModule() {
    if (!messageCorrectorModulePromise) {
        const url = new URL(MESSAGE_CORRECTOR_MODULE, extensionBaseUrl()).href;
        messageCorrectorModulePromise = import(url).then(async module => {
            const prefs = readUiPrefs();
            await module.init({
                root: getRootWindow(),
                enabled: prefs.messageCorrector,
                newOnly: prefs.messageCorrectorNewOnly,
            });
            return module;
        }).catch(error => {
            messageCorrectorModulePromise = null;
            throw error;
        });
    }
    return await messageCorrectorModulePromise;
}

async function syncMessageCorrector(enabled) {
    if (!enabled && !messageCorrectorModulePromise) return;
    const module = await loadMessageCorrectorModule();
    const prefs = readUiPrefs();
    await module.setEnabled(enabled, {
        root: getRootWindow(),
        newOnly: prefs.messageCorrectorNewOnly,
    });
}

async function syncMessageCorrectorMode(newOnly) {
    const module = await loadMessageCorrectorModule();
    const prefs = readUiPrefs();
    await module.setNewOnly(newOnly, {
        root: getRootWindow(),
        enabled: prefs.messageCorrector,
    });
}

async function openMessageCorrectorLog() {
    const module = await loadMessageCorrectorModule();
    return await module.openLog({ root: getRootWindow() });
}

async function scanSameLayerMessages() {
    const module = await loadMessageCorrectorModule();
    return await module.scanCurrentChat({ root: getRootWindow(), notify: true });
}

async function loadDockModule(force = false) {
    const root = getRootWindow();
    root.__YUYUAN_DOCK_EMBEDDED__ = true;
    if (force) dockModulePromise = null;
    if (!dockModulePromise) {
        if (!root.document.getElementById('yuyuan-dock-css')) {
            const link = root.document.createElement('link');
            link.id = 'yuyuan-dock-css';
            link.rel = 'stylesheet';
            link.href = new URL(DOCK_STYLE, extensionBaseUrl()).href;
            (root.document.head || root.document.documentElement).appendChild(link);
        }
        const url = new URL(DOCK_MODULE, extensionBaseUrl());
        if (force) url.searchParams.set('embedded', `${EXTENSION_VERSION}-${Date.now()}`);
        dockModulePromise = import(url.href).then(() => {
            if (!root.__ycDock) throw new Error('芋圆收纳没有完成初始化');
            return root.__ycDock;
        }).catch(error => {
            dockModulePromise = null;
            throw error;
        });
    }
    await dockModulePromise;
    return root.__ycDock;
}

function readDockPrefs() {
    try {
        const saved = JSON.parse(getRootWindow().localStorage.getItem('yc_dock_cfg') || '{}') || {};
        return { enabled: saved.enabled !== false, hideHandle: saved.hideHandle !== false };
    } catch {
        return { enabled: true, hideHandle: true };
    }
}

async function syncDock(patch = {}) {
    const dock = await loadDockModule();
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) dock?.setEnabled?.(patch.enabled);
    if (Object.prototype.hasOwnProperty.call(patch, 'hideHandle')) dock?.setHideHandle?.(patch.hideHandle);
    return dock?.getConfig?.() || readDockPrefs();
}

async function openDock() {
    const dock = await loadDockModule();
    if (!dock?.getConfig?.().enabled) {
        notify('请先开启芋圆收纳', 'info');
        return;
    }
    dock.open?.();
}

async function loadUpdaterModule() {
    if (!updaterModulePromise) {
        const url = new URL(UPDATER_MODULE, extensionBaseUrl());
        url.searchParams.set('v', EXTENSION_VERSION);
        updaterModulePromise = import(url.href).catch(error => {
            updaterModulePromise = null;
            throw error;
        });
    }
    return await updaterModulePromise;
}

async function checkExtensionUpdate(manual = false) {
    try {
        const module = await loadUpdaterModule();
        return await module.checkForUpdates({ root: getRootWindow(), currentVersion: EXTENSION_VERSION, notify, manual });
    } catch (error) {
        console.error(`[${MODULE_NAME}] updater failed to load`, error);
        if (manual) notify(`检查更新失败：${error.message}`, 'error');
        return null;
    }
}

async function scheduleExtensionUpdateCheck() {
    try {
        const module = await loadUpdaterModule();
        module.scheduleUpdateCheck({ root: getRootWindow(), currentVersion: EXTENSION_VERSION, notify });
    } catch (error) {
        console.warn(`[${MODULE_NAME}] updater failed to load`, error);
    }
}

function installRegexGroupsLauncher() {
    const root = getRootWindow();
    if (!readUiPrefs().regexManager) return false;
    const toolbar = root.document.querySelector('#regex_container .regex_settings .inline-drawer-content > .flex-container');
    if (!toolbar) return false;
    if (root.document.getElementById('yuyuan-regex-groups-open-native')) return true;
    const button = root.document.createElement('button');
    button.id = 'yuyuan-regex-groups-open-native';
    button.type = 'button';
    button.className = 'menu_button menu_button_icon';
    button.title = '管理正则分组';
    button.innerHTML = '<i class="fa-solid fa-folder-tree"></i><small>分组</small>';
    button.addEventListener('click', () => openRegexGroups());
    toolbar.appendChild(button);
    const importButton = root.document.getElementById('import_regex');
    if (importButton && !importButton.dataset.yrgCaptured) {
        importButton.dataset.yrgCaptured = '1';
        const handler = async event => {
            if (!readUiPrefs().regexManager) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const manager = await openRegexGroups();
            manager?.showDestinationDialog?.('import');
        };
        importButton.__yuyuanRegexImportHandler = handler;
        importButton.addEventListener('click', handler, true);
    }
    return true;
}

function watchRegexGroupsLauncher() {
    const root = getRootWindow();
    if (!readUiPrefs().regexManager) return;
    if (installRegexGroupsLauncher() || root.__YUYUAN_REGEX_LAUNCHER_OBSERVER__) return;
    const observer = new root.MutationObserver(() => {
        if (installRegexGroupsLauncher()) {
            observer.disconnect();
            delete root.__YUYUAN_REGEX_LAUNCHER_OBSERVER__;
        }
    });
    observer.observe(root.document.body || root.document.documentElement, { childList: true, subtree: true });
    root.__YUYUAN_REGEX_LAUNCHER_OBSERVER__ = observer;
    root.setTimeout(() => {
        observer.disconnect();
        if (root.__YUYUAN_REGEX_LAUNCHER_OBSERVER__ === observer) delete root.__YUYUAN_REGEX_LAUNCHER_OBSERVER__;
    }, 15000);
}

async function syncRegexManager(enabled) {
    const root = getRootWindow();
    root.__YUYUAN_REGEX_LAUNCHER_OBSERVER__?.disconnect?.();
    delete root.__YUYUAN_REGEX_LAUNCHER_OBSERVER__;
    if (!enabled) {
        root.document.getElementById('yuyuan-regex-groups-open-native')?.remove();
        const importButton = root.document.getElementById('import_regex');
        if (importButton?.__yuyuanRegexImportHandler) {
            importButton.removeEventListener('click', importButton.__yuyuanRegexImportHandler, true);
            delete importButton.__yuyuanRegexImportHandler;
            delete importButton.dataset.yrgCaptured;
        }
        try {
            const module = await regexGroupsModulePromise;
            module?.destroy?.();
        } catch {}
        syncMagicWand(readUiPrefs());
        return;
    }
    watchRegexGroupsLauncher();
    const module = await loadRegexGroupsModule();
    module.enhanceNative?.({ root });
    syncMagicWand(readUiPrefs());
}

function getRootWindow() {
    let current = window;
    for (let i = 0; i < 6 && current.parent && current.parent !== current; i++) {
        try { void current.parent.document; current = current.parent; } catch { break; }
    }
    return current;
}

function notify(message, type = 'info') {
    try {
        const root = getRootWindow();
        const toast = root.toastr || window.toastr;
        if (toast && typeof toast[type] === 'function') toast[type](message);
    } catch {}
}

function clonePlain(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value ?? {})); }
}

function readUiPrefs() {
    const root = getRootWindow();
    let saved = {};
    try { saved = JSON.parse(root.localStorage.getItem(UI_PREFS_KEY) || '{}') || {}; } catch {}
    delete saved.presetAutoGroup;
    const prefs = { ...DEFAULT_UI_PREFS, ...saved };
    // 与芋圆机内部“隐藏悬浮球”共用同一个状态，两个设置页不会互相打架。
    try {
        prefs.floatingBall = root.localStorage.getItem('xhs_yuyuan_fab_hidden') !== '1';
    } catch {}
    return prefs;
}

function publishUiPrefs(prefs = readUiPrefs()) {
    const root = getRootWindow();
    const actual = { ...DEFAULT_UI_PREFS, ...prefs };
    // The remote core still understands quickReplyButton as a Tavern Helper
    // script button. Keep it off there; this extension owns a native DOM button.
    root.__YUYUAN_EXTENSION_PREFS__ = {
        ...actual,
        quickReplyButton: false,
        nativeQuickReplyButton: !!actual.quickReplyButton,
    };
    return actual;
}

function saveUiPrefs(patch = {}) {
    const root = getRootWindow();
    const next = { ...readUiPrefs(), ...patch };
    try { root.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next)); } catch {}
    publishUiPrefs(next);
    return next;
}

function openPhone() {
    const root = getRootWindow();
    if (!readUiPrefs().phoneEnabled) throw new Error('芋圆机总开关已关闭');
    if (isSafeMode()) { showSafeMode(); return; }
    const api = root.__YUYUAN_API__;
    if (!api) throw new Error('扩展核心尚未就绪');
    return Promise.resolve(api.open()).then(() => paintStatus()).catch(error => {
        console.error(`[${MODULE_NAME}] failed to open phone`, error);
        notify(`芋圆机打开失败：${error.message}；请在扩展设置中重新加载核心`, 'error');
        paintStatus();
    });
}

function removePhoneFloatingBall() {
    const root = getRootWindow();
    const ids = ['xhs-float-btn', 'xhs-fab'];
    ids.forEach(id => root.document.getElementById(id)?.remove());
    try {
        if (typeof root.__ycDock?.removeBall === 'function') ids.forEach(id => root.__ycDock.removeBall(id));
        else {
            const state = JSON.parse(root.localStorage.getItem('yc_dock_v1') || '{}') || {};
            if (state.docked && typeof state.docked === 'object') {
                ids.forEach(id => { delete state.docked[id]; delete state.docked[`foreign:${id}`]; });
                root.localStorage.setItem('yc_dock_v1', JSON.stringify(state));
            }
        }
    } catch (error) { console.warn(`[${MODULE_NAME}] failed to remove floating ball from dock`, error); }
}

function syncFloatingBall(enabled) {
    const root = getRootWindow();
    try { root.localStorage.setItem('xhs_yuyuan_fab_hidden', enabled ? '0' : '1'); } catch {}
    publishUiPrefs();
    try {
        if (typeof root.__YUYUAN_API__?.setFloatingBall === 'function') root.__YUYUAN_API__.setFloatingBall(enabled);
        else if (!enabled) ['xhs-float-btn', 'xhs-fab'].forEach(id => root.document.getElementById(id)?.remove());
    } catch (error) { console.warn(`[${MODULE_NAME}] failed to update floating ball`, error); }
    if (!enabled) removePhoneFloatingBall();
}

function hideLegacyScriptButtons(doc) {
    doc.querySelectorAll('#send_form [id^="script_container_"] .qr--button').forEach(button => {
        if (!LEGACY_SCRIPT_BUTTONS.has(String(button.textContent || '').trim())) return;
        button.dataset.yuyuanLegacyQuickButton = '1';
        button.style.setProperty('display', 'none', 'important');
    });
}

function ensureQuickReplyButton(enabled = readUiPrefs().quickReplyButton) {
    const root = getRootWindow();
    const doc = root.document;
    hideLegacyScriptButtons(doc);

    const existing = doc.getElementById(QUICK_BUTTON_ID);
    const fallback = doc.getElementById(QUICK_FALLBACK_ID);
    enabled = !!enabled && readUiPrefs().phoneEnabled;
    if (!enabled) {
        existing?.remove();
        fallback?.remove();
        return true;
    }
    registerQrAssistantButton();

    const sendForm = doc.getElementById('send_form');
    if (!sendForm) return false;
    const quickBar = sendForm.querySelector('div#qr--bar');
    let destination = quickBar;
    if (quickBar) {
        destination = Array.from(quickBar.children).find(child => child.classList?.contains('qr--buttons')) || quickBar;
        fallback?.remove();
    } else {
        destination = fallback;
        if (!destination) {
            destination = doc.createElement('div');
            destination.id = QUICK_FALLBACK_ID;
            destination.className = 'TH--qr--bar flex-container flexGap5';
            sendForm.prepend(destination);
        }
    }

    let button = doc.getElementById(QUICK_BUTTON_ID);
    if (!button) {
        button = doc.createElement('div');
        button.id = QUICK_BUTTON_ID;
        button.className = 'qr--button menu_button interactable';
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', '打开芋圆机');
        button.title = '打开芋圆机';
        button.textContent = '芋圆机按钮';
        const activate = event => {
            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            try { openPhone(); }
            catch (error) { notify(`芋圆机打开失败：${error.message}`, 'error'); }
        };
        button.addEventListener('click', activate);
        button.addEventListener('keydown', activate);
    }
    if (button.parentElement !== destination) destination.appendChild(button);
    return true;
}

function watchQuickReplyButton() {
    const root = getRootWindow();
    const previous = root.__YUYUAN_QUICK_BUTTON_RUNTIME__;
    if (previous?.version === EXTENSION_VERSION) return previous;
    try { previous?.observer?.disconnect(); } catch {}
    try { root.clearInterval(previous?.timer); } catch {}

    const runtime = { version: EXTENSION_VERSION, form: null, observer: null, timer: null, queued: false };
    const refresh = () => {
        runtime.queued = false;
        const form = root.document.getElementById('send_form');
        if (form !== runtime.form) {
            try { runtime.observer?.disconnect(); } catch {}
            runtime.form = form;
            if (form) {
                runtime.observer = new root.MutationObserver(() => {
                    if (runtime.queued) return;
                    runtime.queued = true;
                    root.requestAnimationFrame(refresh);
                });
                runtime.observer.observe(form, { childList: true, subtree: true });
            }
        }
        ensureQuickReplyButton(readUiPrefs().quickReplyButton);
    };
    runtime.timer = root.setInterval(refresh, 2000);
    root.__YUYUAN_QUICK_BUTTON_RUNTIME__ = runtime;
    refresh();
    return runtime;
}

function syncQuickReplyButton(enabled) {
    if (!readUiPrefs().phoneEnabled || !enabled) return ensureQuickReplyButton(false);
    watchQuickReplyButton();
    return ensureQuickReplyButton(enabled);
}

function syncMagicWand(input = readUiPrefs()) {
    const root = getRootWindow();
    const doc = root.document;
    const prefs = typeof input === 'boolean' ? { ...readUiPrefs(), magicWand: input } : { ...readUiPrefs(), ...(input || {}) };
    const showPhone = !!prefs.phoneEnabled && !!prefs.magicWand;
    const showRegex = !!prefs.regexManager;
    let container = doc.getElementById('yuyuan_wand_container');
    if (!showPhone && !showRegex) {
        container?.remove();
        const menu = doc.getElementById('extensionsMenu');
        if (menu) {
            const hasVisibleItems = Array.from(menu.children).some(child => child.id !== 'yuyuan_wand_container' && root.getComputedStyle(child).display !== 'none' && child.childElementCount > 0);
            if (!hasVisibleItems) doc.getElementById('extensionsMenuButton')?.style.setProperty('display', 'none');
        }
        return true;
    }
    const menu = doc.getElementById('extensionsMenu');
    if (!menu) return false;
    if (!container) {
        container = doc.createElement('div');
        container.id = 'yuyuan_wand_container';
        container.className = 'extension_container';
        menu.appendChild(container);
    }
    const signature = `${Number(showPhone)}:${Number(showRegex)}`;
    if (container.dataset.yuyuanSignature !== signature) {
        container.dataset.yuyuanSignature = signature;
        container.innerHTML = `
            ${showPhone ? `<div id="yuyuanWandMenuItem" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="extensionsMenuExtensionButton fa-solid fa-mobile-screen-button"></div><span>芋圆机</span>
            </div>` : ''}
            ${showRegex ? `<div id="yuyuanRegexWandMenuItem" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="extensionsMenuExtensionButton yuyuan-regex-menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M5 6h5M14 6h5M5 12h9M18 12h1M5 18h2M11 18h8"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg>
                </div><span>正则管理</span>
            </div>` : ''}`;
        const bindMenuItem = (selector, action) => {
            const item = container.querySelector(selector);
            if (!item) return;
            const activate = event => {
                if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
                if (event.type === 'keydown') event.preventDefault();
                action();
            };
            item.addEventListener('click', activate);
            item.addEventListener('keydown', activate);
        };
        bindMenuItem('#yuyuanWandMenuItem', () => {
            try { openPhone(); } catch (error) { notify(`芋圆机打开失败：${error.message}`, 'error'); }
        });
        bindMenuItem('#yuyuanRegexWandMenuItem', () => {
            openRegexGroups().catch(error => notify(`正则管理打开失败：${error.message}`, 'error'));
        });
    }
    doc.getElementById('extensionsMenuButton')?.style.removeProperty('display');
    return true;
}

function syncUiEntrypoints() {
    const prefs = publishUiPrefs();
    if (!prefs.phoneEnabled) {
        ensureQuickReplyButton(false);
        syncMagicWand(prefs);
        removePhoneFloatingBall();
        ['xhs-float', 'yc-mfloat'].forEach(id => {
            try { getRootWindow().document.getElementById(id)?.remove(); } catch {}
        });
        return;
    }
    syncFloatingBall(prefs.floatingBall);
    syncMagicWand(prefs);
    syncQuickReplyButton(prefs.quickReplyButton);
}

async function openLegacyRemoteCore(root) {
    if (root.document.getElementById('xhs-float')) return;
    const slash = root.executeSlashCommandsWithOptions
        || root.SillyTavern?.getContext?.()?.executeSlashCommandsWithOptions;
    if (typeof slash === 'function') {
        try {
            await slash.call(root.SillyTavern?.getContext?.() || root, '/yuyuan');
            if (root.document.getElementById('xhs-float')) return;
        } catch {}
    }
    const wanted = readUiPrefs().floatingBall;
    try { root.localStorage.setItem('xhs_yuyuan_fab_hidden', '0'); } catch {}
    for (let i = 0; i < 28; i++) {
        const launcher = root.document.getElementById('xhs-float-btn') || root.document.getElementById('xhs-fab');
        if (launcher) {
            launcher.click();
            if (!wanted) {
                try { root.localStorage.setItem('xhs_yuyuan_fab_hidden', '1'); } catch {}
            }
            return;
        }
        await new Promise(resolve => root.setTimeout(resolve, 250));
    }
    throw new Error('远程脚本已运行，但没有找到芋圆机打开入口');
}

function installLegacyRemoteBridge(root) {
    if (root.__YUYUAN_API__) return false;
    // A modern core that failed during boot must not be reported as ready.
    if (root.__YUYUAN_RUNTIME__?.source === 'extension') return false;
    if (!root.document.getElementById('xhs-float-btn') && !root.document.getElementById('xhs-fab')) return false;
    root.__YUYUAN_RUNTIME__ = { source: 'extension', version: 'remote-legacy', loadedAt: Date.now() };
    root.__YUYUAN_API__ = {
        open: () => openLegacyRemoteCore(root),
        close: () => root.document.getElementById('xhs-close')?.click(),
        rebind: () => {},
        setFloatingBall: enabled => {
            try { root.localStorage.setItem('xhs_yuyuan_fab_hidden', enabled ? '0' : '1'); } catch {}
            if (!enabled) ['xhs-float-btn', 'xhs-fab'].forEach(id => root.document.getElementById(id)?.remove());
        },
        status: () => ({ alive: true, legacyRemote: true }),
        diagnostics: () => ({ source: 'remote-legacy', url: REMOTE_CORE_URL }),
    };
    return true;
}

function watchMagicWand() {
    const root = getRootWindow();
    if (root.__YUYUAN_EXTENSION_WAND_OBSERVER__) return;
    const observer = new root.MutationObserver(() => {
        if (root.document.getElementById('yuyuan_wand_container')) return;
        const prefs = readUiPrefs();
        if (((prefs.phoneEnabled && prefs.magicWand) || prefs.regexManager) && !root.document.getElementById('yuyuan_wand_container')) syncMagicWand(prefs);
    });
    observer.observe(root.document.documentElement, { childList: true, subtree: true });
    root.__YUYUAN_EXTENSION_WAND_OBSERVER__ = observer;
}

function isSafeMode() {
    try { return getRootWindow().sessionStorage.getItem(SAFE_MODE_KEY) === '1'; } catch { return false; }
}

function readPhoneData() {
    try { return getRootWindow().getVariables?.({ type: 'chat' })?.[STORE_KEY] || null; } catch { return null; }
}

function readDiagnostics() {
    try {
        const raw = getRootWindow().localStorage.getItem(DIAG_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function writeDiagnostics(patch = {}, includeSize = false) {
    const root = getRootWindow();
    try {
        const ctx = root.SillyTavern?.getContext?.();
        // Ordinary click diagnostics only inspect the native reference. Some
        // variable providers clone the entire save; reserve that for explicit
        // diagnostics and errors, never the interaction path.
        const data = includeSize ? readPhoneData() : ctx?.chatMetadata?.variables?.[STORE_KEY];
        const previous = readDiagnostics();
        const next = {
            ...previous,
            version: EXTENSION_VERSION,
            at: new Date().toISOString(),
            mainFloors: Array.isArray(ctx?.chat) ? ctx.chat.length : 0,
            app: String(data?.currentApp || ''),
            route: String(data?.currentRoute || ''),
            dmCount: Array.isArray(data?.dms) ? data.dms.length : 0,
            groupCount: Array.isArray(data?.groups) ? data.groups.length : 0,
            feedCount: Array.isArray(data?.feed) ? data.feed.length : 0,
            momentCount: Array.isArray(data?.moments) ? data.moments.length : 0,
            lastAction: root.__YUYUAN_LAST_ACTION__ || previous.lastAction || '',
            ...patch,
        };
        if (includeSize) {
            const json = data ? JSON.stringify(data) : '';
            next.dataChars = json.length;
            next.dataKiB = Math.round(json.length * 2 / 1024);
            next.domNodes = root.document.querySelectorAll('#xhs-float *').length;
        }
        root.localStorage.setItem(DIAG_KEY, JSON.stringify(next));
        return next;
    } catch (error) {
        return { version: EXTENSION_VERSION, at: new Date().toISOString(), diagnosticError: String(error?.message || error) };
    }
}

function installDiagnostics() {
    const root = getRootWindow();
    if (root.__YUYUAN_DIAGNOSTICS_BOUND__) return;
    root.__YUYUAN_DIAGNOSTICS_BOUND__ = true;
    let timer = 0;
    root.document.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-action],#xhs-float-btn,#yuyuan-extension-open');
        if (!button) return;
        if (button.hasAttribute?.('data-action') && !button.closest('#xhs-float')) return;
        const action = button.getAttribute?.('data-action') || button.id || button.tagName;
        root.__YUYUAN_LAST_ACTION__ = String(action).slice(0, 100);
        if (timer) root.clearTimeout(timer);
        timer = root.setTimeout(() => {
            timer = 0;
            writeDiagnostics({ phase: 'idle' }, false);
        }, 500);
    }, true);
    root.addEventListener('error', event => {
        const message = String(event?.message || event?.error?.message || 'unknown error');
        const stack = String(event?.error?.stack || '');
        if (!/yuyuan|xhs|yc[A-Z_]|芋圆/i.test(`${message}\n${stack}`)) return;
        writeDiagnostics({ phase: 'error', lastError: message.slice(0, 600), lastStack: stack.slice(0, 1600) }, true);
    });
    root.addEventListener('unhandledrejection', event => {
        const reason = event?.reason;
        const message = String(reason?.message || reason || 'unhandled rejection');
        const stack = String(reason?.stack || '');
        if (!/yuyuan|xhs|yc[A-Z_]|芋圆/i.test(`${message}\n${stack}`)) return;
        writeDiagnostics({ phase: 'rejection', lastError: message.slice(0, 600), lastStack: stack.slice(0, 1600) }, true);
    });
}

function cleanupRuntimeFallback() {
    const root = getRootWindow();
    const timerKeys = [
        '__ycFabKeep', '__wxAvTimer', '__xhsClockTimer', '__ycProPoll', '__ycCardSwitchPollT',
        '__ycWeiboKeep', '__ycPhonePollT', '__ycMsPollT', '__ycActFastT', '__ycMuTickIv',
        '__petOutInt', '__focusInt', '__ycNotifTimer', '__ycReadDwellTimer', '__ycMsgPaintT',
        '__ycMsgPaintLateT', '__ycListenLikeTimer', '__ycListenElapsedTimer', '__ycDockHelloTimer',
    ];
    for (const key of timerKeys) {
        try { if (root[key] != null) { root.clearTimeout(root[key]); root.clearInterval(root[key]); } } catch {}
        try { root[key] = null; } catch {}
    }
    try { root.jQuery?.(root.document).off('.xhs'); } catch {}
    try {
        if (root.__xhsChromeEscape) root.document.removeEventListener('click', root.__xhsChromeEscape, true);
        root.__xhsChromeEscape = null;
    } catch {}
    try { root.__ycDockCleanup?.(); } catch {}
    try { root.document.getElementById('yc-music-audio')?.pause?.(); } catch {}
    ['xhs-float-btn', 'xhs-float', 'xhs-fab', 'yc-notify', 'yc-mfloat'].forEach(id => {
        try { root.document.getElementById(id)?.remove(); } catch {}
    });
    root.__YUYUAN_EVENTS_BOUND__ = false;
}

async function destroyRuntime() {
    const root = getRootWindow();
    try { await root.__YUYUAN_API__?.destroy?.(); } catch (error) { console.warn(`[${MODULE_NAME}] core cleanup was partial`, error); }
    cleanupRuntimeFallback();
    try { root.document.getElementById('yuyuan-extension-core')?.remove(); } catch {}
    delete root.__YUYUAN_API__;
    delete root.__YUYUAN_RUNTIME__;
    delete root.__YUYUAN_EXTENSION_LOAD_PROMISE__;
}

async function resetCurrentView() {
    const root = getRootWindow();
    const all = clonePlain(root.getVariables?.({ type: 'chat' }) || {});
    const data = all[STORE_KEY];
    if (!data || typeof data !== 'object') throw new Error('当前聊天没有芋圆机存档');
    data.currentApp = '';
    data.currentRoute = '';
    data.routeContext = {};
    all[STORE_KEY] = data;
    await root.replaceVariables(all, { type: 'chat' });
    writeDiagnostics({ phase: 'view-reset', app: '', route: '', lastAction: 'safe-reset-view' }, true);
}

function diagnosticsText(reason = 'manual') {
    const root = getRootWindow();
    let core = {};
    try { core = root.__YUYUAN_API__?.diagnostics?.() || {}; } catch {}
    return JSON.stringify({ extension: writeDiagnostics({ phase: reason }, true), core }, null, 2);
}

function showSafeMode() {
    const root = getRootWindow();
    const doc = root.document;
    let box = doc.getElementById('yuyuan-safe-mode');
    if (!box) {
        box = doc.createElement('div');
        box.id = 'yuyuan-safe-mode';
        box.innerHTML = `
            <div class="yuyuan-safe-card">
                <div class="yuyuan-safe-kicker">RECOVERY MODE</div>
                <h2>芋圆机安全模式</h2>
                <p>核心界面和常驻任务已停止。这里可以修复卡住的页面入口，聊天和其他内容不会被删除。</p>
                <div class="yuyuan-safe-actions">
                    <button id="yuyuan-safe-reset" class="menu_button">重置当前页面入口</button>
                    <button id="yuyuan-safe-copy" class="menu_button">复制诊断信息</button>
                    <button id="yuyuan-safe-resume" class="menu_button primary">恢复正常启动</button>
                    <button id="yuyuan-safe-hide" class="menu_button quiet">暂时收起</button>
                </div>
                <pre id="yuyuan-safe-diagnostics"></pre>
            </div>`;
        doc.body.appendChild(box);
        box.querySelector('#yuyuan-safe-reset').addEventListener('click', async () => {
            try { await resetCurrentView(); notify('当前页面入口已重置，聊天内容未删除', 'success'); }
            catch (error) { notify(`修复失败：${error.message}`, 'error'); }
            box.querySelector('#yuyuan-safe-diagnostics').textContent = diagnosticsText('safe-reset');
        });
        box.querySelector('#yuyuan-safe-copy').addEventListener('click', async () => {
            const text = diagnosticsText('safe-copy');
            try { await root.navigator.clipboard.writeText(text); notify('诊断信息已复制', 'success'); }
            catch { root.prompt('复制下面的诊断信息', text); }
            box.querySelector('#yuyuan-safe-diagnostics').textContent = text;
        });
        box.querySelector('#yuyuan-safe-resume').addEventListener('click', async () => {
            try {
                root.sessionStorage.removeItem(SAFE_MODE_KEY);
                box.remove();
                await loadCore({ force: true });
                notify('芋圆机已恢复正常运行', 'success');
            } catch (error) { notify(`恢复失败：${error.message}`, 'error'); showSafeMode(); }
            paintStatus();
        });
        box.querySelector('#yuyuan-safe-hide').addEventListener('click', () => { box.style.display = 'none'; });
    }
    box.style.display = 'flex';
    box.querySelector('#yuyuan-safe-diagnostics').textContent = diagnosticsText('safe-mode');
    paintStatus();
}

async function enterSafeMode() {
    const root = getRootWindow();
    writeDiagnostics({ phase: 'enter-safe-mode', lastAction: 'enter-safe-mode' }, true);
    root.sessionStorage.setItem(SAFE_MODE_KEY, '1');
    await destroyRuntime();
    root.__YUYUAN_EXTENSION_ACTIVE__ = { version: EXTENSION_VERSION, startedAt: Date.now(), safeMode: true };
    showSafeMode();
}

function installNativeShims() {
    const root = getRootWindow();
    const context = () => root.SillyTavern?.getContext?.();
    const helper = () => root.TavernHelper;
    // Explicit settings saves wait for persistence; ordinary navigation stays batched.
    root.__YUYUAN_FLUSH_SETTINGS__ = async () => {
        const ctx = context();
        if (!ctx?.chatMetadata) throw new Error('当前聊天尚未就绪，请稍后保存');
        const saveChat = ctx.saveMetadata || ctx.saveChat;
        if (typeof saveChat !== 'function') throw new Error('当前酒馆未提供聊天保存接口');
        const saveGlobal = ctx.saveSettings || (await import('/script.js')).saveSettings;
        if (typeof saveGlobal !== 'function') throw new Error('当前酒馆未提供设置保存接口');
        await saveChat.call(ctx);
        await saveGlobal.call(ctx);
    };
    if (typeof root.getCharData !== 'function') {
        root.getCharData = () => {
            const ctx = context();
            if (Array.isArray(ctx?.characters)) {
                const id = ctx.characterId;
                return id == null || id === '' ? undefined : ctx.characters[id];
            }
            return helper()?.getCharData?.();
        };
    }
    const apiBase = (value) => {
        const text = String(value || '').trim().replace(/\/+$/, '');
        let url;
        try { url = new URL(text); } catch { throw new Error('API 地址无效，请填写完整的 http 或 https 地址'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API 地址格式不支持，请把密钥填写到 Key 栏');
        return text;
    };
    const requestJson = async (path, body, timeout = 30000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            let headers = context()?.getRequestHeaders?.();
            if (!headers) {
                const csrf = await root.fetch('/csrf-token', { signal: controller.signal });
                if (!csrf.ok) throw new Error('无法取得酒馆请求凭据，请刷新页面后重试');
                const token = (await csrf.json()).token;
                headers = { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
            }
            const response = await root.fetch(path, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('接口请求失败（HTTP ' + response.status + '），请检查 API 地址、Key 和连接状态');
            let json;
            try { json = await response.json(); } catch { throw new Error('接口返回的不是 JSON，请检查 API 地址是否填成了网页地址'); }
            if (!json || json.error) throw new Error('接口返回错误，请检查 API 地址、Key、模型权限或服务状态');
            return json;
        } catch (error) {
            if (controller.signal.aborted) throw new Error('接口请求超时，请稍后重试');
            throw error;
        } finally { clearTimeout(timer); }
    };
    const modelNames = (value) => {
        const list = Array.isArray(value) ? value : (value?.data ?? value?.models);
        if (!Array.isArray(list)) throw new Error('模型列表格式不正确，请检查 API 地址');
        return [...new Set(list.map(item => typeof item === 'string' ? item.trim() : String(item?.id || item?.name || '').trim()).filter(Boolean))].sort();
    };
    if (typeof root.getModelList !== 'function') {
        root.getModelList = async (options = {}) => {
            const apiurl = apiBase(options.apiurl);
            if (typeof helper()?.getModelList === 'function') return modelNames(await helper().getModelList({ ...options, apiurl }));
            return modelNames(await requestJson('/api/backends/chat-completions/status', {
                chat_completion_source: 'openai', reverse_proxy: apiurl, proxy_password: options.key || '',
            }));
        };
    }
    if (typeof root.getVariables !== 'function') {
        root.getVariables = (options = {}) => {
            const ctx = context();
            if (!ctx) return {};
            if (options.type === 'global') {
                ctx.extensionSettings.variables ||= {};
                ctx.extensionSettings.variables.global ||= {};
                return ctx.extensionSettings.variables.global;
            }
            ctx.chatMetadata.variables ||= {};
            return ctx.chatMetadata.variables;
        };
    }
    if (typeof root.replaceVariables !== 'function') {
        root.replaceVariables = async (variables, options = {}) => {
            const ctx = context();
            if (!ctx) throw new Error('当前酒馆上下文尚未就绪');
            const next = clonePlain(variables || {});
            if (options.type === 'global') {
                ctx.extensionSettings.variables ||= {};
                ctx.extensionSettings.variables.global = next;
                await ctx.saveSettingsDebounced?.();
                return next;
            }
            if (!ctx.chatMetadata || typeof ctx.chatMetadata !== 'object') {
                throw new Error('当前聊天尚未就绪，请打开聊天后重试');
            }
            // A variable save must retain the active chat metadata identity.
            // updateChatMetadata replaces that object, making pending core saves
            // mistake this write for a chat switch and skip card-wide settings.
            ctx.chatMetadata.variables = next;
            // Match Tavern Helper: commit the variables now and let the host batch
            // disk/network persistence. Waiting for saveMetadata blocks every app
            // and conversation click on a full chat save.
            if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
            else await ctx.saveMetadata?.();
            return next;
        };
    }
    if (typeof root.generateRaw !== 'function') {
        root.generateRaw = async (options = {}) => {
            if (typeof helper()?.generateRaw === 'function') return await helper().generateRaw(options);
            const ctx = context();
            if (options.custom_api) {
                const custom = { ...options.custom_api };
                if (custom.proxy_preset) {
                    const proxies = ctx?.proxies || (await import('/scripts/openai.js')).proxies;
                    const preset = proxies?.find(item => item.name === String(custom.proxy_preset).trim());
                    if (!preset) throw new Error('找不到所选连接预设，请重新选择或填写 API 地址和 Key');
                    custom.apiurl = preset.url;
                    custom.key = preset.password || '';
                }
                const source = custom.source || 'openai';
                if (!['openai', 'claude', 'makersuite', 'mistralai', 'deepseek', 'xai', 'moonshot'].includes(source)) throw new Error('当前副 API 类型需要酒馆助手支持，请启用酒馆助手或使用 OpenAI 兼容地址');
                const model = String(custom.model || '').trim();
                if (!model) throw new Error('请先在芋圆机的 API 设置中选择或填写模型');
                const messages = options.ordered_prompts || options.prompt;
                if (!Array.isArray(messages) || messages.some(item => !item || !['system','user','assistant'].includes(item.role))) throw new Error('生成消息格式不支持');
                const body = { chat_completion_source: source, reverse_proxy: apiBase(custom.apiurl), proxy_password: custom.key || '',
                    model, messages, stream: false, max_tokens: Number(custom.max_tokens) || Number(ctx?.chatCompletionSettings?.openai_max_tokens) || 4096 };
                if (custom.temperature != null && Number.isFinite(Number(custom.temperature))) body.temperature = Number(custom.temperature);
                const json = await requestJson('/api/backends/chat-completions/generate', body, 180000);
                const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? json.content;
                const text = Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('') : content;
                if (typeof text !== 'string' || !text.trim()) throw new Error('模型未返回文字，请检查模型或稍后重试');
                return text;
            }
            if (typeof ctx?.generateRaw !== 'function') throw new Error('当前版本酒馆没有提供 generateRaw');
            const nativeOptions = { ...options };
            if (Array.isArray(nativeOptions.ordered_prompts)) {
                nativeOptions.prompt = nativeOptions.ordered_prompts;
                delete nativeOptions.ordered_prompts;
            }
            return await ctx.generateRaw(nativeOptions);
        };
    }
    if (typeof root.createChatMessages !== 'function') {
        root.createChatMessages = async (messages = [], options = {}) => {
            if (typeof helper()?.createChatMessages === 'function') return await helper().createChatMessages(messages, options);
            const ctx = context();
            if (!ctx || !Array.isArray(ctx.chat)) throw new Error('当前聊天尚未就绪');
            const position = options.insert_at ?? options.insert_before ?? 'end';
            if (position !== 'end' && position !== ctx.chat.length) throw new Error('当前运行环境只支持在聊天末尾追加消息');
            const events = ctx.eventTypes || ctx.event_types || {};
            for (const source of messages) {
                const role = source.role || 'system';
                const message = {
                    name: source.name || (role === 'system' ? 'system' : role === 'user' ? ctx.name1 : ctx.name2),
                    is_user: role === 'user',
                    is_system: !!source.is_hidden,
                    send_date: Date.now(),
                    mes: String(source.message ?? source.mes ?? ''),
                    extra: { ...(role === 'system' ? { type: 'narrator' } : {}), ...clonePlain(source.extra || {}) },
                    ...(source.data ? { variables: [clonePlain(source.data)] } : {}),
                };
                const id = ctx.chat.length;
                ctx.chat.push(message);
                if (options.refresh !== 'none' && typeof ctx.addOneMessage === 'function') ctx.addOneMessage(message, { scroll: false });
                const sent = role === 'user' ? events.MESSAGE_SENT : events.MESSAGE_RECEIVED;
                if (sent) await ctx.eventSource?.emit?.(sent, id, 'extension');
                const rendered = role === 'user' ? events.USER_MESSAGE_RENDERED : events.CHARACTER_MESSAGE_RENDERED;
                if (options.refresh !== 'none' && rendered) await ctx.eventSource?.emit?.(rendered, id);
            }
            await ctx.saveChat?.();
            return messages;
        };
    }
    if (typeof root.getCharWorldbookNames !== 'function') {
        root.getCharWorldbookNames = async (name = 'current') => {
            if (typeof helper()?.getCharWorldbookNames === 'function') return await helper().getCharWorldbookNames(name);
            const ctx = context();
            const char = name === 'current' ? ctx?.characters?.[ctx.characterId] : ctx?.characters?.find(item => item.name === name);
            if (!char) return { primary: '', additional: [] };
            const ext = char?.data?.extensions || char?.extensions || {};
            const primary = ext.world || ext.world_info || '';
            let world = ctx?.worldInfo || ctx?.world_info;
            if (!world) {
                try { world = (await import('/scripts/world-info.js')).getWorldInfoSettings().world_info; }
                catch (error) { console.warn(`[${MODULE_NAME}] additional worldbook settings unavailable`, error); }
            }
            const filename = String(char.avatar || '').replace(/\.[^/.]+$/, '');
            const additional = world?.charLore?.find(item => item.name === filename)?.extraBooks;
            return { primary, additional: [...new Set(Array.isArray(additional) ? additional : Array.isArray(ext.extra_books) ? ext.extra_books : [])] };
        };
    }
    if (typeof root.getChatWorldbookName !== 'function') {
        root.getChatWorldbookName = async (name = 'current') => {
            if (typeof helper()?.getChatWorldbookName === 'function') return await helper().getChatWorldbookName(name);
            return context()?.chatMetadata?.world_info || '';
        };
    }
    if (typeof root.getWorldbook !== 'function') {
        root.getWorldbook = async (name) => {
            if (typeof helper()?.getWorldbook === 'function') return await helper().getWorldbook(name);
            const ctx = context();
            if (!name) return [];
            const load = ctx?.loadWorldInfo || (await import('/scripts/world-info.js')).loadWorldInfo;
            if (typeof load !== 'function') throw new Error('当前酒馆未提供世界书读取接口');
            const book = await load(name);
            if (Array.isArray(book)) return book;
            if (Array.isArray(book?.entries)) return book.entries;
            if (book?.entries && typeof book.entries === 'object') return Object.values(book.entries);
            if (book && typeof book === 'object') return Object.values(book).filter(value => value && typeof value === 'object');
            return [];
        };
    }
    if (typeof root.updateWorldbookWith !== 'function') {
        const jobs = new Map();
        root.updateWorldbookWith = (name, updater) => {
            const task = (jobs.get(name) || Promise.resolve()).catch(() => {}).then(async () => {
                if (typeof helper()?.updateWorldbookWith === 'function') return await helper().updateWorldbookWith(name, updater);
                const ctx = context();
                const world = typeof ctx?.loadWorldInfo === 'function' && typeof ctx?.saveWorldInfo === 'function'
                    ? ctx : await import('/scripts/world-info.js');
                if (!name || typeof world.loadWorldInfo !== 'function' || typeof world.saveWorldInfo !== 'function') throw new Error('当前酒馆未提供世界书读写接口');
                const book = await world.loadWorldInfo(name);
                if (!book?.entries || typeof book.entries !== 'object') throw new Error('世界书读取失败，未写入任何内容');
                const entries = await updater(clonePlain(Object.values(book.entries)));
                if (!Array.isArray(entries)) throw new Error('世界书条目格式不正确');
                const used = new Set(entries.filter(e => e?.uid != null).map(e => String(e.uid)));
                const result = {}; let next = 0;
                for (const entry of entries) {
                    const e = clonePlain(entry);
                    if (e.uid == null) {
                        while (used.has(String(next))) next++;
                        e.uid = next++; used.add(String(e.uid));
                    }
                    if (Object.prototype.hasOwnProperty.call(result, e.uid)) throw new Error('世界书条目编号重复，未保存');
                    e.comment ??= e.name || '';
                    e.disable ??= e.enabled === false;
                    e.key ??= e.keys || [];
                    e.keysecondary ??= [];
                    e.order ??= 100; e.position ??= 0;
                    result[e.uid] = e;
                }
                await world.saveWorldInfo(name, { ...book, entries: result }, true);
                return entries;
            });
            jobs.set(name, task);
            task.finally(() => { if (jobs.get(name) === task) jobs.delete(name); }).catch(() => {});
            return task;
        };
    }
}

function getStatus() {
    const root = getRootWindow();
    if (!readUiPrefs().phoneEnabled) return { tone: 'warn', text: '芋圆机已关闭，核心未运行' };
    if (isSafeMode()) return { tone: 'warn', text: '安全模式：核心任务已停止' };
    if (root.__YUYUAN_RUNTIME__?.source === 'script') return { tone: 'warn', text: '检测到旧脚本版，请停用旧脚本后刷新' };
    if (root.__YUYUAN_API__) {
        const status = root.__YUYUAN_API__.status?.() || {};
        if (status.bindError) return { tone: 'error', text: `点击事件未连接：${status.bindError}` };
        if (status.alive === false) return { tone: 'error', text: '核心实例已停止，请恢复正常启动' };
        return { tone: 'ok', text: '扩展核心已加载' };
    }
    if (root.__YUYUAN_EXTENSION_LOAD_PROMISE__) return { tone: 'loading', text: '正在加载扩展核心…' };
    return { tone: 'error', text: '扩展核心未加载' };
}

function paintStatus() {
    const el = getRootWindow().document.getElementById('yuyuan-extension-status');
    if (!el) return;
    const status = getStatus();
    el.dataset.tone = status.tone;
    el.textContent = status.text;
}

function paintUiPrefs(panel = getRootWindow().document.getElementById('yuyuan-extension-settings')) {
    if (!panel) return;
    const prefs = readUiPrefs();
    const dockPrefs = readDockPrefs();
    const phoneEnabled = panel.querySelector('#yuyuan-extension-phone-enabled');
    const floating = panel.querySelector('#yuyuan-extension-floating');
    const wand = panel.querySelector('#yuyuan-extension-wand');
    const quick = panel.querySelector('#yuyuan-extension-quick');
    const regex = panel.querySelector('#yuyuan-extension-regex-enabled');
    const presetEditor = panel.querySelector('#yuyuan-extension-preset-enabled');
    const worldInfoTools = panel.querySelector('#yuyuan-extension-world-info-enabled');
    const messageCorrector = panel.querySelector('#yuyuan-extension-corrector-enabled');
    const messageCorrectorNewOnly = panel.querySelector('#yuyuan-extension-corrector-new-only');
    const dockEnabled = panel.querySelector('#yuyuan-extension-dock-enabled');
    const dockHandle = panel.querySelector('#yuyuan-extension-dock-handle');
    if (phoneEnabled) phoneEnabled.checked = prefs.phoneEnabled;
    if (floating) {
        floating.checked = prefs.floatingBall;
        floating.disabled = !prefs.phoneEnabled;
    }
    if (wand) {
        wand.checked = prefs.magicWand;
        wand.disabled = !prefs.phoneEnabled;
    }
    if (quick) {
        quick.checked = prefs.quickReplyButton;
        quick.disabled = !prefs.phoneEnabled;
    }
    if (regex) regex.checked = prefs.regexManager;
    if (presetEditor) presetEditor.checked = prefs.presetEditor;
    if (worldInfoTools) worldInfoTools.checked = prefs.worldInfoTools;
    if (messageCorrector) messageCorrector.checked = prefs.messageCorrector;
    if (messageCorrectorNewOnly) {
        messageCorrectorNewOnly.checked = prefs.messageCorrectorNewOnly;
        messageCorrectorNewOnly.disabled = !prefs.messageCorrector;
    }
    if (dockEnabled) dockEnabled.checked = dockPrefs.enabled;
    if (dockHandle) {
        dockHandle.checked = dockPrefs.hideHandle;
        dockHandle.disabled = !dockPrefs.enabled;
    }
    panel.querySelector('#yuyuan-extension-regex-groups')?.toggleAttribute('disabled', !prefs.regexManager);
    panel.querySelector('#yuyuan-extension-open')?.toggleAttribute('disabled', !prefs.phoneEnabled);
    panel.querySelector('#yuyuan-extension-rebind')?.toggleAttribute('disabled', !prefs.phoneEnabled);
    panel.querySelector('#yuyuan-extension-safe')?.toggleAttribute('disabled', !prefs.phoneEnabled);
    panel.querySelector('#yuyuan-extension-preset-open')?.toggleAttribute('disabled', !prefs.presetEditor);
    panel.querySelector('#yuyuan-extension-corrector-scan')?.toggleAttribute('disabled', !prefs.messageCorrector);
    panel.querySelector('#yuyuan-extension-dock-open')?.toggleAttribute('disabled', !dockPrefs.enabled);
    panel.querySelector('.yuyuan-ext-module--regex')?.classList.toggle('is-disabled', !prefs.regexManager);
    panel.querySelector('.yuyuan-ext-module--phone')?.classList.toggle('is-disabled', !prefs.phoneEnabled);
    panel.querySelector('.yuyuan-ext-module--preset')?.classList.toggle('is-disabled', !prefs.presetEditor);
    panel.querySelector('.yuyuan-ext-module--world-info')?.classList.toggle('is-disabled', !prefs.worldInfoTools);
    panel.querySelector('.yuyuan-ext-module--corrector')?.classList.toggle('is-disabled', !prefs.messageCorrector);
    panel.querySelector('.yuyuan-ext-module--dock')?.classList.toggle('is-disabled', !dockPrefs.enabled);
    const phoneCount = prefs.phoneEnabled ? [prefs.floatingBall, prefs.magicWand, prefs.quickReplyButton].filter(Boolean).length : 0;
    const states = [
        ['#yuyuan-extension-phone-state', prefs.phoneEnabled, prefs.phoneEnabled ? `${phoneCount} 个入口` : '已关闭'],
        ['#yuyuan-extension-regex-state', prefs.regexManager],
        ['#yuyuan-extension-preset-state', prefs.presetEditor],
        ['#yuyuan-extension-world-info-state', prefs.worldInfoTools],
        ['#yuyuan-extension-corrector-state', prefs.messageCorrector],
        ['#yuyuan-extension-dock-state', dockPrefs.enabled],
    ];
    for (const [selector, enabled, text] of states) {
        const badge = panel.querySelector(selector);
        if (!badge) continue;
        badge.textContent = text || (enabled ? '已开启' : '已关闭');
        badge.dataset.enabled = enabled ? 'true' : 'false';
    }
}

function registerSettingsPanel() {
    const root = getRootWindow();
    const doc = root.document;
    if (doc.getElementById('yuyuan-extension-settings')) { paintStatus(); paintUiPrefs(); return true; }
    const host = doc.getElementById('extensions_settings2') || doc.getElementById('extensions_settings');
    if (!host) return false;
    const panel = doc.createElement('div');
    panel.id = 'yuyuan-extension-settings';
    panel.className = 'extension_container';
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>芋圆小屋♡°.•</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down interactable" tabindex="0"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="yuyuan-ext-topbar">
                    <div class="yuyuan-ext-meta"><b>作者 小芋</b><span>v${EXTENSION_VERSION}</span></div>
                    <button id="yuyuan-extension-update" class="yuyuan-ext-update-button" type="button" aria-label="检查扩展更新" title="检查扩展更新">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.6-2.2L20 11M4 13l2.3 4.2A7 7 0 0 0 18 15"/></svg>
                        <span>检查更新</span>
                    </button>
                </div>
                <div id="yuyuan-extension-status" class="yuyuan-ext-status">正在检查…</div>
                <div class="yuyuan-ext-modules" aria-label="芋圆小屋♡°.•功能模块">
                    <details class="yuyuan-ext-module yuyuan-ext-module--phone" open>
                        <summary class="yuyuan-ext-module-summary"><span class="yuyuan-ext-module-icon"><i class="fa-solid fa-mobile-screen-button"></i></span><span class="yuyuan-ext-module-copy"><b>芋圆机</b><small>手机本体与快捷入口</small></span><span id="yuyuan-extension-phone-state" class="yuyuan-ext-module-state">3 个入口</span><i class="fa-solid fa-chevron-down yuyuan-ext-module-chevron" aria-hidden="true"></i></summary>
                        <div class="yuyuan-ext-module-body">
                            <div class="yuyuan-ext-setting-list" aria-label="芋圆机入口设置">
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-phone-enabled"><span><b>芋圆机总开关</b><small>关闭后不加载芋圆机核心，其他模块仍可使用</small></span><input id="yuyuan-extension-phone-enabled" type="checkbox"><i aria-hidden="true"></i></label>
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-floating"><span><b>悬浮球</b><small>在聊天页面显示悬浮入口</small></span><input id="yuyuan-extension-floating" type="checkbox"><i aria-hidden="true"></i></label>
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-wand"><span><b>魔法棒入口</b><small>在输入栏菜单中显示芋圆机</small></span><input id="yuyuan-extension-wand" type="checkbox"><i aria-hidden="true"></i></label>
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-quick"><span><b>芋圆机按钮</b><small>在快捷回复栏中显示一键打开按钮</small></span><input id="yuyuan-extension-quick" type="checkbox"><i aria-hidden="true"></i></label>
                            </div>
                            <button id="yuyuan-extension-open" class="menu_button yuyuan-ext-primary">打开芋圆机</button>
                            <details class="yuyuan-ext-more"><summary>维护工具</summary><div><button id="yuyuan-extension-rebind" class="menu_button">重新连接界面</button><button id="yuyuan-extension-safe" class="menu_button">安全模式</button><button id="yuyuan-extension-diag" class="menu_button">复制诊断</button></div></details>
                        </div>
                    </details>
                    <details class="yuyuan-ext-module yuyuan-ext-module--regex">
                        <summary class="yuyuan-ext-module-summary"><span class="yuyuan-ext-module-icon"><i class="fa-solid fa-sliders"></i></span><span class="yuyuan-ext-module-copy"><b>正则管理</b><small>分组、批量操作与快速导入</small></span><span id="yuyuan-extension-regex-state" class="yuyuan-ext-module-state">已开启</span><i class="fa-solid fa-chevron-down yuyuan-ext-module-chevron" aria-hidden="true"></i></summary>
                        <div class="yuyuan-ext-module-body">
                            <div class="yuyuan-ext-setting-list">
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-regex-enabled"><span><b>开启正则管理</b><small>增强原生正则页，并自动加入魔法棒入口</small></span><input id="yuyuan-extension-regex-enabled" type="checkbox"><i aria-hidden="true"></i></label>
                            </div>
                            <button id="yuyuan-extension-regex-groups" class="menu_button yuyuan-ext-primary">打开正则管理</button>
                        </div>
                    </details>
                    <details class="yuyuan-ext-module yuyuan-ext-module--preset">
                        <summary class="yuyuan-ext-module-summary"><span class="yuyuan-ext-module-icon"><i class="fa-solid fa-layer-group"></i></span><span class="yuyuan-ext-module-copy"><b>预设快速编辑</b><small>跨预设取用、新建条目与分组兼容</small></span><span id="yuyuan-extension-preset-state" class="yuyuan-ext-module-state">已开启</span><i class="fa-solid fa-chevron-down yuyuan-ext-module-chevron" aria-hidden="true"></i></summary>
                        <div class="yuyuan-ext-module-body">
                            <div class="yuyuan-ext-setting-list">
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-preset-enabled"><span><b>开启预设快速编辑</b><small>在酒馆原生预设条目栏加入快捷按钮</small></span><input id="yuyuan-extension-preset-enabled" type="checkbox"><i aria-hidden="true"></i></label>
                            </div>
                            <button id="yuyuan-extension-preset-open" class="menu_button yuyuan-ext-primary">打开预设快速编辑</button>
                        </div>
                    </details>
                    <details class="yuyuan-ext-module yuyuan-ext-module--world-info">
                        <summary class="yuyuan-ext-module-summary"><span class="yuyuan-ext-module-icon"><i class="fa-solid fa-book-open"></i></span><span class="yuyuan-ext-module-copy"><b>世界书工具</b><small>在单个条目旁加入编辑撤销</small></span><span id="yuyuan-extension-world-info-state" class="yuyuan-ext-module-state">已开启</span><i class="fa-solid fa-chevron-down yuyuan-ext-module-chevron" aria-hidden="true"></i></summary>
                        <div class="yuyuan-ext-module-body">
                            <div class="yuyuan-ext-setting-list">
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-world-info-enabled"><span><b>开启条目撤销</b><small>展开条目后，在复制和删除按钮旁显示撤销</small></span><input id="yuyuan-extension-world-info-enabled" type="checkbox"><i aria-hidden="true"></i></label>
                            </div>
                        </div>
                    </details>
                    <details class="yuyuan-ext-module yuyuan-ext-module--corrector">
                        <summary class="yuyuan-ext-module-summary"><span class="yuyuan-ext-module-icon"><i class="fa-solid fa-arrow-right-arrow-left"></i></span><span class="yuyuan-ext-module-copy"><b>同层消息校正</b><small>只修正明确的 user 身份串向</small></span><span id="yuyuan-extension-corrector-state" class="yuyuan-ext-module-state">已关闭</span><i class="fa-solid fa-chevron-down yuyuan-ext-module-chevron" aria-hidden="true"></i></summary>
                        <div class="yuyuan-ext-module-body">
                            <div class="yuyuan-ext-setting-list">
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-corrector-enabled"><span><b>开启同层消息校正</b><small>此项仅支持芋圆机的同层消息校正，其他插件消息不支持</small></span><input id="yuyuan-extension-corrector-enabled" type="checkbox"><i aria-hidden="true"></i></label>
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-corrector-new-only"><span><b>只校正新消息</b><small>关闭后会检查当前聊天已有消息</small></span><input id="yuyuan-extension-corrector-new-only" type="checkbox"><i aria-hidden="true"></i></label>
                            </div>
                            <div class="yuyuan-ext-split-actions">
                                <button id="yuyuan-extension-corrector-scan" class="menu_button yuyuan-ext-primary">检查当前聊天</button>
                                <button id="yuyuan-extension-corrector-log" class="menu_button">校正记录</button>
                            </div>
                        </div>
                    </details>
                    <details class="yuyuan-ext-module yuyuan-ext-module--dock">
                        <summary class="yuyuan-ext-module-summary"><span class="yuyuan-ext-module-icon"><i class="fa-solid fa-inbox"></i></span><span class="yuyuan-ext-module-copy"><b>芋圆收纳</b><small>集中管理页面上的悬浮入口</small></span><span id="yuyuan-extension-dock-state" class="yuyuan-ext-module-state">已开启</span><i class="fa-solid fa-chevron-down yuyuan-ext-module-chevron" aria-hidden="true"></i></summary>
                        <div class="yuyuan-ext-module-body">
                            <div class="yuyuan-ext-setting-list">
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-dock-enabled"><span><b>开启芋圆收纳</b><small>收纳页面上的第三方悬浮球</small></span><input id="yuyuan-extension-dock-enabled" type="checkbox"><i aria-hidden="true"></i></label>
                                <label class="yuyuan-ext-toggle-row" for="yuyuan-extension-dock-handle"><span><b>隐藏边栏</b><small>通过魔法棒中的“芋圆收纳”打开</small></span><input id="yuyuan-extension-dock-handle" type="checkbox"><i aria-hidden="true"></i></label>
                            </div>
                            <button id="yuyuan-extension-dock-open" class="menu_button yuyuan-ext-primary">打开收纳栏</button>
                        </div>
                    </details>
                </div>
            </div>
        </div>`;
    host.appendChild(panel);
    const modules = [...panel.querySelectorAll('.yuyuan-ext-modules > .yuyuan-ext-module')];
    for (const module of modules) {
        module.addEventListener('toggle', () => {
            if (!module.open) return;
            for (const sibling of modules) {
                if (sibling !== module) sibling.open = false;
            }
        });
    }
    panel.querySelector('#yuyuan-extension-open').addEventListener('click', () => {
        try {
            openPhone();
        } catch (error) {
            console.error(`[${MODULE_NAME}] failed to open`, error);
            notify(`芋圆机打开失败：${error.message}`, 'error');
            paintStatus();
        }
    });
    panel.querySelector('#yuyuan-extension-regex-groups').addEventListener('click', () => openRegexGroups());
    panel.querySelector('#yuyuan-extension-preset-open').addEventListener('click', () => openPresetEditor());
    panel.querySelector('#yuyuan-extension-update').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.classList.add('is-checking');
        try { await checkExtensionUpdate(true); }
        finally { button.disabled = false; button.classList.remove('is-checking'); }
    });
    panel.querySelector('#yuyuan-extension-phone-enabled').addEventListener('change', async event => {
        const enabled = !!event.currentTarget.checked;
        saveUiPrefs({ phoneEnabled: enabled });
        try { root.sessionStorage.removeItem(SAFE_MODE_KEY); } catch {}
        paintUiPrefs(panel);
        if (!enabled) {
            try { await destroyRuntime(); } catch (error) { console.warn(`[${MODULE_NAME}] phone shutdown was partial`, error); }
            syncUiEntrypoints();
        }
        notify(enabled ? '正在启动芋圆机…' : '芋圆机已关闭', enabled ? 'info' : 'success');
        root.setTimeout(() => root.location.reload(), 120);
    });
    panel.querySelector('#yuyuan-extension-floating').addEventListener('change', event => {
        const enabled = !!event.currentTarget.checked;
        saveUiPrefs({ floatingBall: enabled });
        syncFloatingBall(enabled);
        paintUiPrefs(panel);
    });
    panel.querySelector('#yuyuan-extension-wand').addEventListener('change', event => {
        const enabled = !!event.currentTarget.checked;
        const prefs = saveUiPrefs({ magicWand: enabled });
        syncMagicWand(prefs);
        paintUiPrefs(panel);
    });
    panel.querySelector('#yuyuan-extension-quick').addEventListener('change', event => {
        const enabled = !!event.currentTarget.checked;
        saveUiPrefs({ quickReplyButton: enabled });
        syncQuickReplyButton(enabled);
        paintUiPrefs(panel);
    });
    panel.querySelector('#yuyuan-extension-regex-enabled').addEventListener('change', async event => {
        const enabled = !!event.currentTarget.checked;
        saveUiPrefs({ regexManager: enabled });
        paintUiPrefs(panel);
        try { await syncRegexManager(enabled); }
        catch (error) {
            console.error(`[${MODULE_NAME}] regex manager toggle failed`, error);
            notify(`正则管理切换失败：${error.message}`, 'error');
        }
    });
    panel.querySelector('#yuyuan-extension-preset-enabled').addEventListener('change', async event => {
        const enabled = !!event.currentTarget.checked;
        saveUiPrefs({ presetEditor: enabled });
        paintUiPrefs(panel);
        try { await syncPresetEditor(enabled); }
        catch (error) {
            console.error(`[${MODULE_NAME}] preset editor toggle failed`, error);
            notify(`预设编辑切换失败：${error.message}`, 'error');
        }
    });
    panel.querySelector('#yuyuan-extension-world-info-enabled').addEventListener('change', async event => {
        const enabled = !!event.currentTarget.checked;
        saveUiPrefs({ worldInfoTools: enabled });
        paintUiPrefs(panel);
        try { await syncWorldInfoTools(enabled); }
        catch (error) {
            console.error(`[${MODULE_NAME}] world info tools toggle failed`, error);
            notify(`世界书工具切换失败：${error.message}`, 'error');
        }
    });
    panel.querySelector('#yuyuan-extension-corrector-enabled').addEventListener('change', async event => {
        const enabled = !!event.currentTarget.checked;
        saveUiPrefs({ messageCorrector: enabled });
        paintUiPrefs(panel);
        try { await syncMessageCorrector(enabled); }
        catch (error) {
            console.error(`[${MODULE_NAME}] message corrector toggle failed`, error);
            notify(`同层消息校正切换失败：${error.message}`, 'error');
        }
    });
    panel.querySelector('#yuyuan-extension-corrector-new-only').addEventListener('change', async event => {
        const newOnly = !!event.currentTarget.checked;
        saveUiPrefs({ messageCorrectorNewOnly: newOnly });
        paintUiPrefs(panel);
        try { await syncMessageCorrectorMode(newOnly); }
        catch (error) {
            console.error(`[${MODULE_NAME}] message corrector mode failed`, error);
            notify(`校正范围切换失败：${error.message}`, 'error');
        }
    });
    panel.querySelector('#yuyuan-extension-corrector-scan').addEventListener('click', () => {
        scanSameLayerMessages().catch(error => notify(`检查当前聊天失败：${error.message}`, 'error'));
    });
    panel.querySelector('#yuyuan-extension-corrector-log').addEventListener('click', () => {
        openMessageCorrectorLog().catch(error => notify(`校正记录打开失败：${error.message}`, 'error'));
    });
    panel.querySelector('#yuyuan-extension-dock-enabled').addEventListener('change', async event => {
        const enabled = !!event.currentTarget.checked;
        try { await syncDock({ enabled }); }
        catch (error) {
            console.error(`[${MODULE_NAME}] dock toggle failed`, error);
            notify(`芋圆收纳切换失败：${error.message}`, 'error');
        }
        paintUiPrefs(panel);
    });
    panel.querySelector('#yuyuan-extension-dock-handle').addEventListener('change', async event => {
        try { await syncDock({ hideHandle: !!event.currentTarget.checked }); }
        catch (error) {
            console.error(`[${MODULE_NAME}] dock handle toggle failed`, error);
            notify(`边栏设置失败：${error.message}`, 'error');
        }
        paintUiPrefs(panel);
    });
    panel.querySelector('#yuyuan-extension-dock-open').addEventListener('click', () => {
        openDock().catch(error => notify(`芋圆收纳打开失败：${error.message}`, 'error'));
    });
    panel.querySelector('#yuyuan-extension-rebind').addEventListener('click', () => {
        try {
            const api = root.__YUYUAN_API__;
            if (!api) throw new Error('扩展核心尚未就绪');
            api.rebind();
            notify('芋圆机界面已重新连接', 'success');
        } catch (error) {
            console.error(`[${MODULE_NAME}] failed to bind UI`, error);
            notify(`重新连接失败：${error.message}`, 'error');
        }
        paintStatus();
    });
    panel.querySelector('#yuyuan-extension-safe').addEventListener('click', () => {
        if (isSafeMode()) showSafeMode();
        else enterSafeMode().catch(error => notify(`安全模式启动失败：${error.message}`, 'error'));
    });
    panel.querySelector('#yuyuan-extension-diag').addEventListener('click', async () => {
        const text = diagnosticsText('settings-copy');
        try { await root.navigator.clipboard.writeText(text); notify('诊断信息已复制', 'success'); }
        catch { root.prompt('复制下面的诊断信息', text); }
    });
    paintStatus();
    paintUiPrefs(panel);
    return true;
}

function loadCore(options = {}) {
    const root = getRootWindow();
    if (root.__YUYUAN_EXTENSION_START_PROMISE__) return root.__YUYUAN_EXTENSION_START_PROMISE__;
    const task = Promise.resolve().then(() => performCoreLoad(options));
    const pending = task.finally(() => {
        if (root.__YUYUAN_EXTENSION_START_PROMISE__ === pending) delete root.__YUYUAN_EXTENSION_START_PROMISE__;
    });
    root.__YUYUAN_EXTENSION_START_PROMISE__ = pending;
    return pending;
}

async function performCoreLoad(options = {}) {
    const root = getRootWindow();
    const prefs = publishUiPrefs();
    if (!prefs.phoneEnabled) {
        syncUiEntrypoints();
        paintStatus();
        return;
    }
    if (isSafeMode() && !options.force) {
        root.__YUYUAN_EXTENSION_ACTIVE__ = { version: EXTENSION_VERSION, startedAt: Date.now(), safeMode: true };
        showSafeMode();
        return;
    }
    const pending = root.__YUYUAN_EXTENSION_LOAD_PROMISE__;
    if (pending) {
        try { await pending; } catch (error) { if (!options.force) throw error; }
        if (!options.force) return;
    }
    if (options.force) await destroyRuntime();
    let existing = root.__YUYUAN_RUNTIME__;
    if (existing?.source === 'extension') {
        if (root.__YUYUAN_API__ && root.__YUYUAN_API__.status?.()?.alive !== false) return;
        await destroyRuntime();
        existing = null;
    }
    if (existing?.source === 'script') {
        // Disabling a JS-Slash-Runner script leaves its DOM, timers and closures alive.
        // Use the new destroy API when available and the fallback list for older builds.
        await destroyRuntime();
        existing = null;
        notify('扩展版已接管旧脚本留下的悬浮球', 'info');
    }
    if (root.__YUYUAN_EXTENSION_LOAD_PROMISE__) return await root.__YUYUAN_EXTENSION_LOAD_PROMISE__;
    root.__YUYUAN_EXTENSION_ACTIVE__ = { version: EXTENSION_VERSION, startedAt: Date.now() };
    root.__YUYUAN_EXTENSION_CORE_LOADING__ = true;
    root.__YUYUAN_EXTENSION_LOAD_PROMISE__ = new Promise((resolve, reject) => {
        root.document.getElementById('yuyuan-extension-core')?.remove();
        const script = root.document.createElement('script');
        script.id = 'yuyuan-extension-core';
        script.src = REMOTE_CORE_URL;
        script.async = false;
        script.referrerPolicy = 'no-referrer';
        script.dataset.extensionVersion = EXTENSION_VERSION;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`无法加载远程核心：${REMOTE_CORE_URL}`));
        (root.document.head || root.document.documentElement).appendChild(script);
    });
    try {
        await root.__YUYUAN_EXTENSION_LOAD_PROMISE__;
        const legacyRemote = installLegacyRemoteBridge(root);
        if (!root.__YUYUAN_API__) throw new Error('远程核心已加载，但没有完成初始化');
        syncUiEntrypoints();
        if (legacyRemote) notify('远程脚本版本较旧，已启用兼容模式；发布最新版后会自动切回完整扩展模式', 'warning');
        console.info(`[${MODULE_NAME}] loaded v${EXTENSION_VERSION}`);
    } catch (error) {
        delete root.__YUYUAN_EXTENSION_ACTIVE__;
        delete root.__YUYUAN_RUNTIME__;
        console.error(`[${MODULE_NAME}] failed to load`, error);
        notify(`芋圆小屋♡°.•加载失败：${error.message}`, 'error');
        throw error;
    } finally {
        root.__YUYUAN_EXTENSION_CORE_LOADING__ = false;
        delete root.__YUYUAN_EXTENSION_LOAD_PROMISE__;
        paintStatus();
    }
}

function boot() {
    const root = getRootWindow();
    root.__YUYUAN_DOCK_EMBEDDED__ = true;
    const initialPrefs = publishUiPrefs();
    installNativeShims();
    installDiagnostics();
    if (initialPrefs.regexManager) watchRegexGroupsLauncher();
    watchMagicWand();
    scheduleExtensionUpdateCheck();
    syncMagicWand(initialPrefs);
    loadDockModule().catch(error => console.warn(`[${MODULE_NAME}] dock failed to load`, error));
    if (initialPrefs.presetEditor) {
        loadPresetEditorModule().catch(error => console.warn(`[${MODULE_NAME}] preset editor failed to load`, error));
    }
    if (initialPrefs.worldInfoTools) {
        loadWorldInfoToolsModule().catch(error => console.warn(`[${MODULE_NAME}] world info tools failed to load`, error));
    }
    if (initialPrefs.messageCorrector) {
        loadMessageCorrectorModule().catch(error => console.warn(`[${MODULE_NAME}] message corrector failed to load`, error));
    }
    // An older separately installed yuyuan-dock loads after this extension and
    // can overwrite __ycDock. Reclaim it once all extensions have initialized.
    [1800, 4800].forEach(delay => root.setTimeout(() => {
        if (root.__ycDock?.embedded === true) return;
        loadDockModule(true).catch(error => console.warn(`[${MODULE_NAME}] failed to reclaim embedded dock`, error));
    }, delay));
    [300, 1200, 3000].forEach(delay => root.setTimeout(() => {
        const prefs = readUiPrefs();
        syncMagicWand(prefs);
        syncQuickReplyButton(prefs.quickReplyButton);
        if (prefs.regexManager) {
            installRegexGroupsLauncher();
            loadRegexGroupsModule().then(module => module.enhanceNative?.({ root })).catch(error => {
                console.warn(`[${MODULE_NAME}] native regex groups are not ready`, error);
            });
        }
        if (prefs.presetEditor) {
            loadPresetEditorModule().then(module => {
                module.enhanceNative?.(root);
            }).catch(error => console.warn(`[${MODULE_NAME}] preset editor is not ready`, error));
        }
        if (prefs.worldInfoTools) {
            loadWorldInfoToolsModule().then(module => {
                module.enhanceNative?.({ root });
            }).catch(error => console.warn(`[${MODULE_NAME}] world info tools are not ready`, error));
        }
    }, delay));
    if (!registerSettingsPanel()) {
        let tries = 0;
        const timer = root.setInterval(() => {
            if (registerSettingsPanel() || ++tries > 40) root.clearInterval(timer);
        }, 250);
    }
    root.addEventListener('yuyuan:ready', paintStatus);
    if (!initialPrefs.phoneEnabled) {
        syncUiEntrypoints();
        paintStatus();
    } else if (isSafeMode()) showSafeMode();
    else loadCore().catch(() => {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
