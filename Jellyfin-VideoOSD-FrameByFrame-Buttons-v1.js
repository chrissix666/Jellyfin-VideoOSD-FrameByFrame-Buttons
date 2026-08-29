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
        const maxAttempts = 120;
        const delayMs = 250;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (window.ApiClient && typeof ApiClient.getPluginConfiguration === 'function') {
                try {
                    const config = await ApiClient.getPluginConfiguration(PLUGIN_GUID);
                    if (config) return config;
                } catch (err) {
                    // fall through, try again after the delay below
                }
            }
            await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
        }
        return null;
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

        // FIX for a real, confirmed bug found live: this used to
        // hardcode "margin-left/right: .25em" here, completely
        // independent of applySpacing()'s own margin logic on the
        // individual first/last buttons. applySpacing() clearing the
        // CONTAINER's own inline margin style only removes an inline
        // override, it can't touch this CSS class rule, so this fixed
        // .25em was silently adding on top of whatever applySpacing()
        // computed, on both sides, all the time, regardless of the
        // configured gap. Removed entirely: applySpacing() is now the
        // single, sole source of truth for this container's spacing.
        //
        // FIX for a second, real, more fundamental bug found live during
        // a later, more thorough review: the explanation above used to
        // live as a "//" comment INSIDE the CSS text below (i.e.
        // actually part of style.textContent, not a real JavaScript
        // comment), which is invalid CSS syntax, confirmed with an
        // actual browser render: a "//" line inside a CSS rule silently
        // drops at least the following declaration, meaning the very
        // "margin-left: 0" fix this comment was documenting had a real
        // chance of never actually taking effect in a real browser,
        // entirely undetected by earlier tests, since those only checked
        // DOM ordering, not the actual rendered CSS margin. Moved out
        // here as a genuine JS comment, the CSS text below is now valid.
        // FIX for the user-reported visual mismatch, same derivation as
        // in the Speed Buttons script (see the detailed comment there,
        // taken directly from the real 10.10.7 source): a native OSD
        // button box is icon (1.66956521739em) + 2 x 0.556em padding =
        // ~2.7816em, and the bluish hover disc IS that box. Our buttons
        // were hardcoded 3.2em, so the disc rendered visibly larger
        // than the native neighbors. Buttons resized to the
        // native-derived 2.7816em; container follows the same math,
        // INCLUDING the buttons' own native 0.29em class margins per
        // side (forgetting these caused a real, user-visible overlap
        // bug, see the Speed Buttons script for the full explanation):
        // 2 x (0.29 + 2.7816 + 0.29) = 6.7232em, zero leftover, zero
        // overflow. This script's own ".BUTTON:hover"
        // and ".BUTTON:active" rules were removed in the same pass:
        // the "paper-icon-button-light" class on the buttons already
        // gets the exact native hover/active styling from the active
        // theme (the old hardcoded white rgba() here didn't even match
        // Speed's hardcoded blue, let alone the theme), and the press
        // scale has no native counterpart.
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${CONTAINER_CLASS} {
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 6.7232em;
                min-width: 6.7232em;
                max-width: 6.7232em;
                height: 0;
                min-height: 0;
                max-height: 0;
                margin-left: 0;
                margin-right: 0;
                padding: 0;
                overflow: visible;
                flex: 0 0 6.7232em;
                vertical-align: middle;
            }

            .${BUTTON_CLASS} {
                border: 0;
                background: transparent;
                color: inherit;
                cursor: pointer;
                padding: 0;
                width: 2.7816em;
                height: 2.7816em;
                min-height: 2.7816em;
                max-height: 2.7816em;
                line-height: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 2.7816em;
            }

            .${BUTTON_CLASS} .material-icons,
            .${BUTTON_CLASS} .xlargePaperIconButton {
                line-height: 1;
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
    // FIX for a real, confirmed inconsistency found live: this only ever
    // set margin on the CONTAINER, but the individual buttons inside it
    // carry their OWN native margin from the "paper-icon-button-light"
    // class (confirmed against the real source: "margin: 0 0.29em" in
    // emby-button.scss), completely unaffected by the container's own
    // margin. At "gap 0" this left a persistent ~0.29em gap on each
    // outer edge regardless, while the ABLoop script (which applies its
    // margin directly to its own single button, correctly overriding
    // that same native class margin) showed a genuinely flush 0 gap,
    // an inconsistency between addons that share this exact setting.
    // Fixed by reaching past the container to the actual first/last
    // button and overriding their own outer-facing margin directly.
    // FIX, corrected after direct discussion with the user and
    // confirmed against the real source: "gap 0" should mean "looks
    // exactly like a native button", not "touching, 0px". Confirmed
    // directly against the real native buttons in the same row: they
    // are NOT flush against each other, each carries "margin: 0 0.29em"
    // (from "paper-icon-button-light"), and ".videoOsdBottom .buttons"
    // has no "gap" property of its own, so per-button margin is the
    // ONLY spacing mechanism, and two adjacent native margins combine to
    // ~0.58em visible gap. Native 0.29em became the fixed baseline here
    // too. (The gap itself no longer rides on these inner margins at
    // all, see the follow-up fix directly below.)
    // FIX for a real, confirmed bug found live, same root cause as in
    // the Speed Buttons script: this container is pinned to a fixed
    // width ("width/min-width/max-width" plus a matching fixed
    // "flex: 0 0 <width>"
    // in injectStyle() above, a deliberate earlier fix against phantom
    // inner padding), so adding the configured gap onto the INNER
    // first/last button margins was swallowed invisibly inside the
    // fixed box and never produced any visible spacing towards the
    // neighbors -- confirmed live by the user: the gap visibly worked
    // on A-B Loop (bare button, margins sit directly on the element)
    // but not here. The interim fix moved the gap onto the container's
    // own OUTER margins -- that insight still stands and is exactly the
    // mechanism the Core uses today, but WHO applies it changed
    // immediately afterwards:
    // CHANGED per the user's final spacing spec ("like the vanilla
    // icons": every gap a custom addon participates in must grow by
    // exactly 1x the configured value, NEVER 2x between two adjacent
    // customs): the configured gap is no longer applied here at all.
    // Symmetric per-element margins double the gap wherever two customs
    // end up side by side, and only the Core script knows the final
    // neighbor situation after its own sorting. The Core's
    // applyCustomGapSpacing() therefore owns the gap entirely
    // (neighbor-aware, re-derived after every sort) and sets the
    // container margins on its own passes; this function only pins the
    // inner first/last buttons to the native 0.29em baseline and
    // leaves the container margins cleared (correct for the standalone
    // case and for the moment between insertion and the Core's next
    // pass).
    function applySpacing(container) {
        const NATIVE_BUTTON_MARGIN_EM = 0.29;
        const buttons = container.querySelectorAll('.' + BUTTON_CLASS);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (first) first.style.marginLeft = NATIVE_BUTTON_MARGIN_EM + 'em';
        if (last) last.style.marginRight = NATIVE_BUTTON_MARGIN_EM + 'em';
        if (container.style.marginLeft !== '') container.style.marginLeft = '';
        if (container.style.marginRight !== '') container.style.marginRight = '';
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

        // FIX for a real, serious bug found live, same as the identical
        // fix applied to the Speed script (see its own comment for the
        // full explanation): this used to insert as a SIBLING of
        // transportBar (one level OUTSIDE it), not inside it, so Core's
        // own sort logic (which only ever looks inside transportBar for
        // these 3 items) could never find this container, silently
        // failing to include it in any configured sort order.
        if (transportBar.querySelector('.' + CONTAINER_CLASS)) return;

        injectStyle();
        refreshResponsiveStyle();

        const container = document.createElement('div');
        container.className = CONTAINER_CLASS;

        container.appendChild(createButton('first_page', 'Previous frame', -1));
        container.appendChild(createButton('last_page', 'Next frame', 1));

        transportBar.appendChild(container);
        applySpacing(container);

        console.log('[Jellyfin Frame Buttons] Buttons inserted.');
    }

    function startObserver() {
        if (observer) return;

        // FIX for a possible cause of a real, live-observed hang: this
        // observer watches the whole document.body subtree for any
        // style/class change, which fires constantly during active video
        // playback (Jellyfin's own progress bar updates style/class very
        // frequently). Previously the callback ran synchronously on
        // EVERY single mutation, and this is one of 3 currently-enabled
        // mods with an essentially identical, independent observer, all
        // reacting to the same mutations simultaneously. Debounced to at
        // most once every 100ms: still responsive enough to catch newly
        // inserted elements quickly, but coalesces a rapid burst of many
        // mutations into a single actual check instead of running the
        // callback hundreds or thousands of times per second.
        let debounceTimer = null;
        observer = new MutationObserver(() => {
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                injectButtons();
                tryRegisterWithCustoms();
            }, 100);
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
