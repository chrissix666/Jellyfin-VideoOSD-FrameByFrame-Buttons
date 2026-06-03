(function () {
    'use strict';

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

            @media all and (max-width: 50em) {
                .videoOsdBottom .${CONTAINER_CLASS} {
                    display: none !important;
                }
            }
        `;

        document.head.appendChild(style);
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

        const container = document.createElement('div');
        container.className = CONTAINER_CLASS;

        container.appendChild(createButton('first_page', 'Previous Frame', -1));
        container.appendChild(createButton('last_page', 'Next Frame', 1));

        transportBar.insertAdjacentElement('afterend', container);

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
})();
