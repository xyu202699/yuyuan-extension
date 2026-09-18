import { mountViewportOverlay, releaseViewportOverlay, findOverlay, protectHostDrawer } from '../host-view.js';

const REMOTE_MANIFEST_URL = 'https://raw.githubusercontent.com/xyu202699/yuyuan-extension/main/manifest.json';
const EXTENSION_FOLDER = 'yuyuan-extension';
const DISMISSED_VERSION_KEY = 'yuyuan_extension_update_dismissed_v1';

let activeCheck = null;

export function compareVersions(left, right) {
    const normalize = value => String(value || '')
        .trim()
        .replace(/^v/i, '')
        .split(/[+-]/, 1)[0]
        .split('.')
        .map(part => Number.parseInt(part, 10) || 0);
    const a = normalize(left);
    const b = normalize(right);
    const length = Math.max(a.length, b.length, 3);
    for (let index = 0; index < length; index++) {
        const difference = (a[index] || 0) - (b[index] || 0);
        if (difference !== 0) return difference > 0 ? 1 : -1;
    }
    return 0;
}

function closePopup(root) {
    const popup = findOverlay(root, 'yuyuan-update-popup');
    releaseViewportOverlay(popup);
    popup?.remove();
}

function createPopup(root, currentVersion, latestVersion) {
    closePopup(root);
    const overlay = root.document.createElement('div');
    overlay.id = 'yuyuan-update-popup';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'yuyuan-update-title');
    overlay.innerHTML = `
        <div class="yuyuan-update-card">
            <h2 id="yuyuan-update-title">芋圆小屋♡°.•有新版本</h2>
            <p class="yuyuan-update-copy">更新完成后需要刷新页面</p>
            <div class="yuyuan-update-version"><span class="yuyuan-update-current"></span><i></i><strong class="yuyuan-update-latest"></strong></div>
            <div class="yuyuan-update-state" aria-live="polite"></div>
            <div class="yuyuan-update-actions">
                <button type="button" class="yuyuan-update-button yuyuan-update-later">暂不更新</button>
                <button type="button" class="yuyuan-update-button yuyuan-update-now">立即更新</button>
            </div>
        </div>`;
    overlay.querySelector('.yuyuan-update-current').textContent = `v${currentVersion}`;
    overlay.querySelector('.yuyuan-update-latest').textContent = `v${latestVersion}`;
    mountViewportOverlay(root, overlay);
    protectHostDrawer(overlay);
    return overlay;
}

async function requestHeaders() {
    const module = await import('/script.js');
    if (typeof module.getRequestHeaders !== 'function') throw new Error('当前 SillyTavern 没有提供扩展更新接口');
    return module.getRequestHeaders();
}

async function findInstallation(root) {
    const response = await root.fetch('/api/extensions/discover', { cache: 'no-store' });
    if (!response.ok) throw new Error(`无法读取扩展列表（${response.status}）`);
    const extensions = await response.json();
    const item = Array.isArray(extensions) ? extensions.find(extension => {
        const name = String(extension?.name || '').replace(/\\/g, '/');
        return name === EXTENSION_FOLDER || name === `third-party/${EXTENSION_FOLDER}` || name.endsWith(`/${EXTENSION_FOLDER}`);
    }) : null;
    if (!item) throw new Error('酒馆扩展列表里没有找到芋圆小屋♡°.•');
    const name = String(item.name || '').replace(/^third-party/, '');
    return { extensionName: name, global: item.type === 'global' };
}

async function fetchRemoteManifest(root) {
    const url = new URL(REMOTE_MANIFEST_URL);
    url.searchParams.set('_', String(Date.now()));
    const response = await root.fetch(url.href, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`无法读取新版信息（${response.status}）`);
    const manifest = await response.json();
    if (!manifest?.version) throw new Error('新版信息里没有版本号');
    return manifest;
}

async function updateInstallation(root, installation) {
    const response = await root.fetch('/api/extensions/update', {
        method: 'POST',
        headers: await requestHeaders(),
        body: JSON.stringify(installation),
    });
    if (!response.ok) {
        const detail = String(await response.text()).trim();
        throw new Error(detail || `更新失败（${response.status}）`);
    }
    return await response.json();
}

function openUpdatePrompt({ root, currentVersion, latestVersion, installation, notify, reloadReady = false }) {
    if (findOverlay(root, 'yuyuan-update-popup')) return;
    const popup = createPopup(root, currentVersion, latestVersion);
    const later = popup.querySelector('.yuyuan-update-later');
    const update = popup.querySelector('.yuyuan-update-now');
    const state = popup.querySelector('.yuyuan-update-state');

    const showReload = message => {
        state.textContent = message;
        state.dataset.tone = 'ok';
        update.disabled = false;
        update.textContent = '立即刷新';
        update.dataset.mode = 'reload';
        later.disabled = false;
        later.textContent = '稍后刷新';
        later.dataset.mode = 'close';
    };
    if (reloadReady) showReload('此版本已完成更新，刷新页面即可载入，无需再次更新。');

    later.addEventListener('click', () => {
        if (later.dataset.mode === 'close') {
            closePopup(root);
            return;
        }
        try { root.localStorage.setItem(DISMISSED_VERSION_KEY, latestVersion); } catch {}
        closePopup(root);
    });
    update.addEventListener('click', async () => {
        if (update.dataset.mode === 'reload') {
            root.location.reload();
            return;
        }
        later.disabled = true;
        update.disabled = true;
        update.textContent = '正在更新…';
        state.textContent = '正在从 GitHub 拉取新版，请不要关闭页面。';
        state.dataset.tone = 'loading';
        try {
            const result = await updateInstallation(root, installation);
            root.__YUYUAN_EXTENSION_UPDATED_VERSION__ = latestVersion;
            try { root.localStorage.removeItem(DISMISSED_VERSION_KEY); } catch {}
            showReload(result?.isUpToDate
                ? '扩展文件已经是最新版，刷新页面即可重新载入。'
                : '更新完成，刷新页面后新版生效。');
        } catch (error) {
            console.error('[yuyuan-extension] update failed', error);
            const detail = String(error?.message || error);
            const tauriGitFailure = !!root.__TAURITAVERN__ && /git|handshake|I\/O|server/i.test(detail);
            state.textContent = tauriGitFailure
                ? 'Tauri 没有连上 GitHub 的 Git 服务。请确认网络后在“扩展 → 管理扩展”重试；这不是芋圆小屋♡°.•页面加载失败。'
                : `更新失败：${detail}。可前往“扩展 → 管理扩展”重试。`;
            state.dataset.tone = 'error';
            later.disabled = false;
            later.textContent = '关闭';
            update.disabled = false;
            update.textContent = '重试';
            notify?.(tauriGitFailure ? 'Tauri 的 Git 连接失败，请检查网络后重试' : `芋圆小屋♡°.•更新失败：${detail}`, 'error');
        }
    });
}

async function runCheck(options) {
    const { root, currentVersion, notify, manual = false } = options;
    try {
        const remote = await fetchRemoteManifest(root);
        const latestVersion = String(remote.version);
        if (compareVersions(latestVersion, currentVersion) <= 0) {
            if (manual) notify?.(`芋圆机 v${currentVersion} 已是最新版`, 'success');
            return { updateAvailable: false, latestVersion };
        }
        const updatedVersion = root.__YUYUAN_EXTENSION_UPDATED_VERSION__;
        if (updatedVersion && compareVersions(updatedVersion, latestVersion) >= 0) {
            if (manual) openUpdatePrompt({ root, currentVersion, latestVersion: updatedVersion, notify, reloadReady: true });
            return { updateAvailable: false, reloadRequired: true, latestVersion: updatedVersion };
        }
        if (!manual) {
            let dismissed = '';
            try { dismissed = root.localStorage.getItem(DISMISSED_VERSION_KEY) || ''; } catch {}
            if (dismissed === latestVersion) return { updateAvailable: true, dismissed: true, latestVersion };
        }
        const installation = await findInstallation(root);
        openUpdatePrompt({ root, currentVersion, latestVersion, installation, notify });
        return { updateAvailable: true, latestVersion };
    } catch (error) {
        console.warn('[yuyuan-extension] update check failed', error);
        if (manual) notify?.(`检查更新失败：${error.message}`, 'error');
        return { updateAvailable: false, error };
    }
}

export async function checkForUpdates(options) {
    if (!activeCheck) activeCheck = runCheck(options).finally(() => { activeCheck = null; });
    return await activeCheck;
}

export function scheduleUpdateCheck(options) {
    const root = options.root;
    if (root.__YUYUAN_UPDATE_CHECK_SCHEDULED__) return;
    root.__YUYUAN_UPDATE_CHECK_SCHEDULED__ = true;
    [1200, 12000, 45000].forEach(delay => {
        root.setTimeout(async () => {
            if (root.__YUYUAN_UPDATE_CHECK_DONE__) return;
            const result = await checkForUpdates({ ...options, manual: false });
            if (!result?.error) root.__YUYUAN_UPDATE_CHECK_DONE__ = true;
        }, delay);
    });
}
