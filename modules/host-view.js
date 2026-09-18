// Synchronous DOM updates can clamp an ancestor's scroll offset while its
// children are temporarily empty. Restore before paint, never on a timer that
// could undo the user's next swipe.
export function preserveScroll(element, update) {
    const scroll = [];
    for (let node = element; node; node = node.parentElement) {
        scroll.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
    const result = update();
    scroll.reverse().forEach(({ node, top, left }) => {
        if (!node.isConnected) return;
        if (node.scrollTop !== top) node.scrollTop = top;
        if (node.scrollLeft !== left) node.scrollLeft = left;
    });
    return result;
}

const renderedHtml = new WeakMap();
export function updateHtml(element, html) {
    if (!element || renderedHtml.get(element) === html) return;
    preserveScroll(element, () => { element.innerHTML = html; });
    renderedHtml.set(element, html);
}

function collectScrollState(element) {
    if (!element) return [];
    return [element, ...element.querySelectorAll('*')]
        .filter(node => node.scrollTop || node.scrollLeft)
        .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
}

/**
 * Remember the SillyTavern drawer underneath one of our full-screen panels.
 * ST closes every unpinned drawer when a click bubbles from outside it. On
 * mobile that exposes the chat list, which looks like a page redirect.
 */
export function captureHostView(root) {
    const doc = root?.document;
    if (!doc) return null;
    const drawers = Array.from(doc.querySelectorAll('.drawer-content.openDrawer'))
        .map(content => ({
            content,
            drawer: content.closest('.drawer'),
            scroll: collectScrollState(content),
        }));
    return {
        drawers,
        pageX: root.scrollX || 0,
        pageY: root.scrollY || 0,
    };
}

function restoreScroll(root, snapshot) {
    snapshot?.drawers?.forEach(({ scroll }) => {
        scroll.forEach(({ node, top, left }) => {
            if (!node?.isConnected) return;
            node.scrollTop = top;
            node.scrollLeft = left;
        });
    });
    try { root.scrollTo(snapshot.pageX, snapshot.pageY); } catch {}
}

/** Restore the drawer directly instead of clicking its toggle. This avoids
 * closing another pinned drawer and is safe because the same drawer instance
 * was open immediately before our panel appeared. */
export function restoreHostView(root, snapshot) {
    if (!snapshot?.drawers?.length) return;
    snapshot.drawers.forEach(({ content, drawer }) => {
        if (!content?.isConnected) return;
        content.classList.remove('closedDrawer');
        content.classList.add('openDrawer');
        const icon = drawer?.querySelector(':scope > .drawer-toggle .drawer-icon');
        icon?.classList.remove('closedIcon');
        icon?.classList.add('openIcon');
    });
    restoreScroll(root, snapshot);
    root.requestAnimationFrame?.(() => restoreScroll(root, snapshot));
    root.setTimeout?.(() => restoreScroll(root, snapshot), 120);
}

/** Keep clicks inside an extension overlay away from ST's document-level
 * "click outside to close every drawer" handler. */
export function protectHostDrawer(element) {
    element?.addEventListener('click', event => event.stopPropagation());
}

export function findOverlay(root, id) {
    return root.document.getElementById(`${id}-host`)?.shadowRoot?.getElementById(id)
        || root.document.getElementById(id);
}

function isolateOverlay(root, element) {
    if (element.__yuyuanStyleHost?.isConnected) return;
    const files = {
        'yuyuan-preset-editor': ['./preset-editor/style.css', 2147483300],
        'yuyuan-regex-groups': ['./regex-groups/style.css', 2147483200],
        'yuyuan-update-popup': ['../style.css', 2147483647],
        'yuyuan-corrector-log': ['./message-corrector/style.css', 2147483646],
    };
    const config = files[element.id];
    if (!config) { (root.document.documentElement || root.document.body).appendChild(element); return; }
    const host = root.document.createElement('div');
    host.id = `${element.id}-host`;
    // Reset the host too: a theme's universal selectors still reach this node.
    host.style.cssText = `all:initial!important;position:fixed!important;inset:0!important;display:block!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;filter:none!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;z-index:${config[1]}!important;`;
    const shadow = host.attachShadow({ mode: 'open' });
    const base = root.document.createElement('style');
    base.textContent = ':host::before,:host::after{content:none!important} :host{color-scheme:light} *{box-sizing:border-box} [hidden]{display:none!important} :where(button,input,select,textarea){font:inherit}';
    shadow.appendChild(base);
    element.style.setProperty('pointer-events', 'auto');
    element.style.setProperty('visibility', 'hidden');
    const ready = [config[0], './overlay-theme.css'].map(file => new Promise((resolve, reject) => {
        const link = root.document.createElement('link');
        link.rel = 'stylesheet'; link.href = new URL(file, import.meta.url).href;
        link.onload = resolve;
        link.onerror = () => reject(new Error(`面板样式加载失败：${file}`));
        shadow.appendChild(link);
    }));
    shadow.appendChild(element);
    (root.document.documentElement || root.document.body).appendChild(host);
    element.__yuyuanStyleHost = host;
    element.__yuyuanStyleReady = Promise.all(ready).then(() => { element.style.removeProperty('visibility'); });
    // Keep failed style loading explicit; callers can await and surface it.
    element.__yuyuanStyleReady.catch(error => root.console?.error(error));
}

/**
 * Mount a full-screen panel against the browser's visual viewport.
 *
 * Mobile Safari can keep `position: fixed` relative to a transformed host
 * container or to the larger layout viewport while its address bar changes
 * size.  Putting the panel directly under <html> and following
 * `visualViewport` keeps it inside the part of the page the user can
 * actually see.  Desktop browsers and Tauri fall back to innerWidth/height.
 */
export function mountViewportOverlay(root, element) {
    if (!root?.document || !element) return () => {};
    element.__yuyuanViewportCleanup?.();

    const doc = root.document;
    isolateOverlay(root, element);
    let frame = 0;
    let layoutHeight = 0, layoutWidth = 0, cardHeight = 0;
    let lastHeight = 0, lastFocus = null;
    const editable = node => element.contains(node) && node.matches('input:not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]');

    const revealFocus = () => {
        const input = element.getRootNode().activeElement || doc.activeElement;
        if (!editable(input)) return;
        // Safari may scroll clipped grid/card ancestors when focusing a field.
        // Only the actual scroll panes should move; headers and footers stay put.
        for (let node = input.parentElement; node; node = node === element ? null : node.parentElement) {
            const overflow = (root.getComputedStyle || doc.defaultView.getComputedStyle).call(doc.defaultView, node).overflowY;
            if (overflow === 'hidden' || overflow === 'clip') node.scrollTop = 0;
            if (!/^(auto|scroll)$/.test(overflow) || node.scrollHeight <= node.clientHeight) continue;
            const box = node.getBoundingClientRect(), field = input.getBoundingClientRect();
            // Tall textareas retain their own caret scrolling.
            const bottom = Math.min(field.bottom, field.top + Math.min(field.height, node.clientHeight - 16));
            if (field.top < box.top + 8) node.scrollTop -= box.top + 8 - field.top;
            else if (bottom > box.bottom - 8) node.scrollTop += bottom - box.bottom + 8;
        }
    };

    const sync = () => {
        frame = 0;
        if (!element.isConnected) return;
        const viewport = root.visualViewport;
        const width = Math.max(1, Math.round(viewport?.width || root.innerWidth || doc.documentElement.clientWidth || 1));
        const height = Math.max(1, Math.round(viewport?.height || root.innerHeight || doc.documentElement.clientHeight || 1));
        const left = Math.round(viewport?.offsetLeft || 0);
        const top = Math.round(viewport?.offsetTop || 0);
        const focus = element.getRootNode().activeElement || doc.activeElement;
        const card = element.querySelector('.ype-card,.yrg-panel');
        // A keyboard reduces the visible viewport, not the user's chosen
        // panel layout. Keep the card's existing height and scroll the outer
        // viewport instead of squeezing its lists and menus out of existence.
        if (!layoutHeight || Math.abs(width - layoutWidth) > 80 || (!editable(focus) && element.dataset.yuyuanKeyboard !== 'true')) {
            layoutHeight = height; layoutWidth = width;
        }
        const keyboard = !!card && (editable(focus) || element.dataset.yuyuanKeyboard === 'true') && height < layoutHeight - 120;
        if (!keyboard && height >= layoutHeight && card) {
            cardHeight = card.getBoundingClientRect().height;
            element.style.setProperty('--yuyuan-keyboard-card-height', `${cardHeight}px`);
            if (element.dataset.yuyuanEditing !== 'true') {
                const style = (root.getComputedStyle || doc.defaultView.getComputedStyle).call(doc.defaultView, element);
                const gap = card.getBoundingClientRect().top - element.getBoundingClientRect().top - parseFloat(style.paddingTop || 0);
                element.style.setProperty('--yuyuan-focus-card-gap', `${Math.max(0, gap)}px`);
            }
        }
        element.dataset.yuyuanEditing = String(editable(focus) || keyboard);
        element.dataset.yuyuanKeyboard = String(keyboard);
        element.style.setProperty('position', 'fixed', 'important');
        element.style.setProperty('inset', 'auto', 'important');
        element.style.setProperty('left', `${left}px`, 'important');
        element.style.setProperty('top', `${top}px`, 'important');
        element.style.setProperty('width', `${width}px`, 'important');
        element.style.setProperty('height', `${height}px`, 'important');
        element.style.setProperty('max-width', 'none', 'important');
        element.style.setProperty('max-height', 'none', 'important');
        // Host themes can add margins/transforms to overlays. They must not
        // shift the visual-viewport rectangle after its coordinates are set.
        element.style.setProperty('margin', '0', 'important');
        element.style.setProperty('transform', 'none', 'important');
        element.style.setProperty('box-sizing', 'border-box', 'important');
        element.style.setProperty('min-width', '0', 'important');
        element.style.setProperty('min-height', '0', 'important');
        // Share safe-area handling across regex, presets and update prompts,
        // including landscape notches. Leave a gap in addition to the inset.
        for (const side of ['top', 'right', 'bottom', 'left']) {
            element.style.setProperty(`padding-${side}`,
                `calc(var(--yuyuan-overlay-gap, 12px) + env(safe-area-inset-${side}, 0px))`, 'important');
        }
        element.dataset.yuyuanCompact = String(height < 480);
        if (height !== lastHeight || focus !== lastFocus) revealFocus();
        lastHeight = height; lastFocus = focus;
        element.dispatchEvent(new doc.defaultView.Event('yuyuan-viewport'));
    };
    const schedule = () => {
        if (frame) return;
        frame = root.requestAnimationFrame?.(sync) || root.setTimeout(sync, 0);
    };
    const viewport = root.visualViewport;
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    root.addEventListener?.('resize', schedule);
    root.addEventListener?.('orientationchange', schedule);
    root.addEventListener?.('pageshow', schedule);
    // Capture the full card synchronously, before Safari starts keyboard resize frames.
    const onFocus = () => { sync(); };
    element.addEventListener('focusin', onFocus);

    const cleanup = () => {
        if (frame) {
            try { root.cancelAnimationFrame?.(frame); } catch {}
            try { root.clearTimeout?.(frame); } catch {}
        }
        viewport?.removeEventListener('resize', schedule);
        viewport?.removeEventListener('scroll', schedule);
        root.removeEventListener?.('resize', schedule);
        root.removeEventListener?.('orientationchange', schedule);
        root.removeEventListener?.('pageshow', schedule);
        element.removeEventListener('focusin', onFocus);
        if (element.__yuyuanViewportCleanup === cleanup) delete element.__yuyuanViewportCleanup;
    };
    element.__yuyuanViewportCleanup = cleanup;
    sync();
    element.__yuyuanStyleReady?.then(sync, () => {});
    return cleanup;
}

export function releaseViewportOverlay(element) {
    element?.__yuyuanViewportCleanup?.();
    element?.__yuyuanStyleHost?.remove();
}
