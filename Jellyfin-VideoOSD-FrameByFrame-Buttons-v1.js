(function () {
    'use strict';

    // ---- PLUGIN ADAPTER: config source, retrofit for VideoOSD Tweaks and Candy ----
    const PLUGIN_GUID = '468b1980-7a6c-4e45-a129-24825085ece4';

    const CONFIG = {
        // ============================================================
        // == SHARED VALUE (both standalone and plugin usage) ==
        // Standalone: this mod never had a "hide on narrow window"
        // setting before this retrofit at all, only a permanently
        // fixed CSS media rule -- true here reproduces that exact
        // original always-on behavior. Editable by hand here.
        // Plugin: overwritten by applyPluginConfig() with the
        // admin's "Hide on Narrow Window" setting once fetched.
        // ============================================================
        hideOnNarrowWindow: true,

        // ============================================================
        // == SHARED VALUE, correct for both cases here ==
        // This mod never had ANY configurable spacing before this
        // retrofit, only a permanently fixed .25em CSS margin (see
        // applySpacing() below). 0 is correct as both the standalone
        // default (produces an empty inline style, so the plain CSS
        // .25em rule applies untouched, exactly like before) and the
        // plugin's own "opt-in, not opt-out" baseline. No dual-mode
        // branch needed here, same reasoning as Speed-Buttons: there
        // was no pre-existing visible behavior at a nonzero default
        // to preserve.
        // ============================================================
        centeredGapEm: 0
    };

    async function fetchPluginConfig() {
        if (!window.ApiClient || typeof ApiClient.getPluginConfiguration !== 'function') {
            return null;
        }
        try {
            return await ApiClient.getPluginConfiguration(PLUGIN_GUID);
        } catch (err) {
            return null;
        }
    }

    function applyPluginConfig(pluginConfig) {
        if (!pluginConfig) return;

        if (typeof pluginConfig.FrameByFrameHideOnNarrowWindow === 'boolean') {
            CONFIG.hideOnNarrowWindow = pluginConfig.FrameByFrameHideOnNarrowWindow;
        }

        CONFIG.centeredGapEm = pluginConfig.FrameByFrameIndividualCenteredGapOverride
            ? (Number(pluginConfig.FrameByFrameCenteredGapValue) || 0)
            : (Number(pluginConfig.GeneralCenteredGap) || 0);
    }
    // ---- END PLUGIN ADAPTER ----

    const ADDON_ID = 'jfb-frame-buttons';
    const ADDON_NAME = 'Frame Buttons';

    const CUSTOMS_API_NAME = 'JellyfinVideoOSDCustomsMenu';
    const CUSTOMS_WAIT_MS = 300;
    const CUSTOMS_WAIT_TRIES = 120;
    const CUSTOMS_STORAGE_KEY =
        CUSTOMS_API_NAME + '.addon.' + ADDON_ID;

    const BUTTON_CLASS = 'jfb-frame-step-button';
    const CONTAINER_CLASS = 'jfb-frame-step-container';
    const STYLE_ID = 'jfb-frame-step-style';
    const RESPONSIVE_STYLE_ID = 'jfb-frame-step-responsive-style';

    function isCustomsAvailable() {
        const api = window[CUSTOMS_API_NAME];
        return !!api && typeof api.registerAddon === 'function';
    }

    function isEnabledByCustomsState() {
        return localStorage.getItem(CUSTOMS_STORAGE_KEY) !== 'false';
    }

    let cachedFps = null;
    let cachedItemName = null;

    let enabled = false;
    let observer = null;
    let registeredWithCustoms = false;
    let customsRegisterTimer = null;



    let ignoreStoredCustomsState = false;

    function stop(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function getVideo() {
        return document.querySelector('video');
    }

    function getTransportBar() {
        return document.querySelector('.buttons.focuscontainer-x > div[dir="ltr"]');
    }

    function parseFps(value) {
        if (!value) return null;
        if (typeof value === 'number' && value > 0) return value;

        const v = String(value).replace(',', '.').trim();

        if (v.includes('/')) {
            const [a, b] = v.split('/').map(Number);
            if (a > 0 && b > 0) return a / b;
        }

        const n = Number(v);
        return n > 0 ? n : null;
    }

    function fpsFromNowPlayingItem(item) {
        const stream = item?.MediaStreams?.find(s =>
            s?.Type === 'Video' ||
            s?.type === 'Video' ||
            s?.CodecType === 'Video'
        );

        if (!stream) return null;

        return (
            parseFps(stream.RealFrameRate) ||
            parseFps(stream.AverageFrameRate) ||
            parseFps(stream.FrameRate)
        );
    }

    async function getFpsFromSession() {
        if (!window.ApiClient?.getSessions) return null;

        const sessions = await ApiClient.getSessions();

        const session =
            sessions.find(s => s.NowPlayingItem && s.PlayState) ||
            sessions.find(s => s.NowPlayingItem);

        const item = session?.NowPlayingItem;
        if (!item) return null;

        const itemName = item.Name || item.Id || 'unknown';

        if (cachedFps && cachedItemName === itemName) {
            return cachedFps;
        }

        const fps = fpsFromNowPlayingItem(item);
        if (!fps) return null;

        cachedFps = fps;
        cachedItemName = itemName;

        return fps;
    }

    async function stepFrame(direction) {
        const video = getVideo();
        if (!video) return;

        const fps = await getFpsFromSession();
        if (!fps) return;

        video.pause();

        const step = 1 / fps;
        const oldTime = video.currentTime;

        video.currentTime = Math.max(
            0,
            Math.min(video.duration || Infinity, oldTime + direction * step)
        );

        setTimeout(() => video.pause(), 30);
    }

    function createButton(icon, title, direction) {
        const button = document.createElement('button');

        button.type = 'button';
        button.className = BUTTON_CLASS + ' autoSize paper-icon-button-light';
        button.title = title;
        button.setAttribute('aria-label', title);

        const span = document.createElement('span');
        span.className = 'xlargePaperIconButton material-icons';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = icon;

        button.appendChild(span);

        [
            'pointerdown',
            'pointerup',
            'mousedown',
            'mouseup',
            'touchstart',
            'touchend',
            'dblclick'
        ].forEach(type => {
            button.addEventListener(type, stop, true);
        });

        button.addEventListener('click', function (e) {
            stop(e);
            stepFrame(direction);
        }, true);

        return button;
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${CONTAINER_CLASS} {
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 6.4em;
                min-width: 6.4em;
                max-width: 6.4em;
                height: 0;
                min-height: 0;
                max-height: 0;
                margin-left: .25em;
                margin-right: .25em;
                padding: 0;
                overflow: visible;
                flex: 0 0 6.4em;
                vertical-align: middle;
            }

            .${BUTTON_CLASS} {
                border: 0;
                background: transparent;
                color: inherit;
                cursor: pointer;
                padding: 0;
                width: 3.2em;
                height: 3.2em;
                min-height: 3.2em;
                max-height: 3.2em;
                line-height: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 3.2em;
            }

            .${BUTTON_CLASS} .material-icons,
            .${BUTTON_CLASS} .xlargePaperIconButton {
                line-height: 1;
            }

            .${BUTTON_CLASS}:hover {
                background: rgba(255, 255, 255, .18);
                border-radius: 50%;
            }

            .${BUTTON_CLASS}:active {
                transform: scale(.94);
            }
        `;
        // Note: the "@media (max-width: 50em) { display: none }" rule that
        // used to live inline in this same stylesheet has been pulled out
        // into its own separate, independently toggleable style tag, see
        // refreshResponsiveStyle() below, same pattern as Speed-Buttons.

        document.head.appendChild(style);
    }

    // New: previously this behavior was permanently baked into injectStyle()
    // above with no way to turn it off. Same pattern as A-B-Loop/Speed-Buttons.
    function refreshResponsiveStyle() {
        const existing = document.getElementById(RESPONSIVE_STYLE_ID);
        if (!CONFIG.hideOnNarrowWindow) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const style = document.createElement('style');
        style.id = RESPONSIVE_STYLE_ID;
        style.textContent = `@media all and (max-width: 50em) { .videoOsdBottom .${CONTAINER_CLASS} { display: none !important; } }`;
        document.head.appendChild(style);
    }

    // New: applies the General/Individual Centered Gap on top of the
    // container's existing baseline .25em margin. Same pattern as
    // Speed-Buttons -- clears back to the plain CSS baseline when the
    // configured gap is 0.
    function applySpacing(container) {
        const gapEm = CONFIG.centeredGapEm || 0;
        if (gapEm <= 0) {
            container.style.marginLeft = '';
            container.style.marginRight = '';
            return;
        }
        const baseMarginEm = 0.25;
        container.style.marginLeft = (baseMarginEm + gapEm) + 'em';
        container.style.marginRight = (baseMarginEm + gapEm) + 'em';
    }

    function removeButtons() {
        document
            .querySelectorAll('.' + CONTAINER_CLASS)
            .forEach(el => el.remove());
    }

    function injectButtons() {
        if (!enabled) return;

        const video = getVideo();
        const transportBar = getTransportBar();

        if (!video || !transportBar) return;

        const parent = transportBar.parentElement;
        if (!parent || parent.querySelector('.' + CONTAINER_CLASS)) return;

        injectStyle();
        refreshResponsiveStyle();

        const container = document.createElement('div');
        container.className = CONTAINER_CLASS;

        container.appendChild(createButton('first_page', 'Previous Frame', -1));
        container.appendChild(createButton('last_page', 'Next Frame', 1));

        transportBar.insertAdjacentElement('afterend', container);
        applySpacing(container);

        console.log('[Jellyfin Frame Buttons] Buttons inserted.');
    }

    function startObserver() {
        if (observer) return;

        observer = new MutationObserver(() => {
            injectButtons();
            tryRegisterWithCustoms();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }

    function stopObserver() {
        if (!observer) return;

        observer.disconnect();
        observer = null;
    }

    function enable() {
        enabled = true;
        startObserver();
        injectButtons();

        console.log('[Jellyfin Frame Buttons] Enabled.');
    }

    function disable() {
        enabled = false;
        stopObserver();
        removeButtons();

        console.log('[Jellyfin Frame Buttons] Disabled.');
    }

    function tryRegisterWithCustoms() {
        if (registeredWithCustoms) return false;

        const api = window[CUSTOMS_API_NAME];

        if (!api || typeof api.registerAddon !== 'function') {
            return false;
        }

        registeredWithCustoms = true;

        if (localStorage.getItem(CUSTOMS_STORAGE_KEY) === null) {
            localStorage.setItem(CUSTOMS_STORAGE_KEY, 'true');
        }

        api.registerAddon({
            id: ADDON_ID,
            name: ADDON_NAME,

            enable() {
                ignoreStoredCustomsState = false;
                enable();
            },

            disable() {
                ignoreStoredCustomsState = false;
                disable();
            }
        });



        if (!ignoreStoredCustomsState) {
            if (isEnabledByCustomsState()) {
                enable();
            } else {
                disable();
            }
        } else {
            enable();
        }

        console.log('[Jellyfin Frame Buttons] Registered with Customs.');

        return true;
    }

    function startCustomsRegistrationWatcher() {
        tryRegisterWithCustoms();

        if (registeredWithCustoms) return;

        let tries = 0;

        customsRegisterTimer = setInterval(() => {
            tries += 1;
            tryRegisterWithCustoms();

            if (registeredWithCustoms || tries >= CUSTOMS_WAIT_TRIES) {
                clearInterval(customsRegisterTimer);
                customsRegisterTimer = null;
            }
        }, CUSTOMS_WAIT_MS);
    }

    function start() {
        if (isCustomsAvailable()) {
            ignoreStoredCustomsState = false;
            tryRegisterWithCustoms();
        } else {
            ignoreStoredCustomsState = true;
            enable();
        }

        startCustomsRegistrationWatcher();

        console.log('[Jellyfin Frame Buttons] Script loaded.');
    }

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, {
            once: true
        });
    }

    // ---- PLUGIN ADAPTER: apply fetched config once it arrives ----
    fetchPluginConfig().then(function (pluginConfig) {
        applyPluginConfig(pluginConfig);
        refreshResponsiveStyle();
        const container = document.querySelector('.' + CONTAINER_CLASS);
        if (container) applySpacing(container);
    });
    // ---- END PLUGIN ADAPTER ----
})();
