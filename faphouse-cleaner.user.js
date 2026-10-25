// ==UserScript==
// @name         FapHouse Premium Video Hider
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Hide premium, paid, VR, ignored, blocked channels and watched videos from feed
// @author       Common-Fool
// @homepageURL  https://github.com/Common-Fool/Faphouse-cleaner
// @supportURL   https://github.com/Common-Fool/Faphouse-cleaner/issues
// @updateURL    https://raw.githubusercontent.com/Common-Fool/Faphouse-cleaner/main/faphouse-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/Common-Fool/Faphouse-cleaner/main/faphouse-cleaner.user.js
// @match        https://faphouse.com/*
// @match        https://ru.faphouse.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== Data ====================

    let hidePremium = GM_getValue('hidePremium', true);
    let hidePaid = GM_getValue('hidePaid', true);
    let hideVR = GM_getValue('hideVR', false);
    let hideIgnored = GM_getValue('hideIgnored', true);
    let hideBlockedChannels = GM_getValue('hideBlockedChannels', true);
    let hideWatched = GM_getValue('hideWatched', true);
    let hideAds = GM_getValue('hideAds', true);
    let ignoredVideos = GM_getValue('ignoredVideos', []);
    let blockedChannels = GM_getValue('blockedChannels', []);
    let watchedVideos = GM_getValue('watchedVideos', []);
    let panelState = GM_getValue('panelState', 1);
    if (panelState !== 0) panelState = 1;

    // First automatic showing comes one interval after install
    let donateLastShown = GM_getValue('donateLastShown', 0);
    if (!donateLastShown) {
        donateLastShown = Date.now();
        GM_setValue('donateLastShown', donateLastShown);
    }

    // ==================== Lookup indexes (Set) ====================

    let ignoredIds = new Set();
    let watchedCodes = new Set();
    let watchedIds = new Set();
    let blockedNames = new Set();

    function rebuildLookups() {
        ignoredIds = new Set(ignoredVideos.map(v => v.id).filter(Boolean));
        watchedCodes = new Set(watchedVideos.map(v => v.code).filter(Boolean));
        watchedIds = new Set(watchedVideos.map(v => v.id).filter(Boolean));
        blockedNames = new Set(blockedChannels.map(c => c.name).filter(Boolean));
    }

    rebuildLookups();

    // ==================== Cross-tab sync ====================

    const toggleKeys = {
        hidePremium:        v => { hidePremium = v; },
        hidePaid:           v => { hidePaid = v; },
        hideVR:             v => { hideVR = v; },
        hideIgnored:        v => { hideIgnored = v; },
        hideBlockedChannels:v => { hideBlockedChannels = v; },
        hideWatched:        v => { hideWatched = v; },
        hideAds:            v => { hideAds = v; },
    };

    const AD_SELECTOR = '.header-banner, .moments-main-page, .exclusive-scenes-section__container';

    const toggleDefs = [
        { id: 'fhc-premium-toggle',          countId: 'fhc-cnt-premium',  key: 'hidePremium',         label: 'Premium',        get: () => hidePremium },
        { id: 'fhc-paid-toggle',             countId: 'fhc-cnt-paid',     key: 'hidePaid',            label: 'Paid',           get: () => hidePaid },
        { id: 'fhc-vr-toggle',               countId: 'fhc-cnt-vr',       key: 'hideVR',              label: 'VR',             get: () => hideVR },
        { id: 'fhc-ignored-toggle',          countId: 'fhc-cnt-ignored',  key: 'hideIgnored',         label: 'Ignored',        get: () => hideIgnored },
        { id: 'fhc-blocked-channels-toggle', countId: 'fhc-cnt-channels', key: 'hideBlockedChannels', label: 'Channels',       get: () => hideBlockedChannels },
        { id: 'fhc-watched-toggle',          countId: 'fhc-cnt-watched',  key: 'hideWatched',         label: 'Watched',        get: () => hideWatched },
        { id: 'fhc-ads-toggle',              countId: 'fhc-cnt-ads',      key: 'hideAds',             label: 'Ads',            get: () => hideAds },
    ];

    for (const [key, setter] of Object.entries(toggleKeys)) {
        GM_addValueChangeListener(key, (name, oldVal, newVal, remote) => {
            if (remote) { setter(newVal); syncTogglesUI(); filterVideos(); }
        });
    }

    const dataKeys = {
        ignoredVideos:  v => { ignoredVideos = v; },
        blockedChannels:v => { blockedChannels = v; },
        watchedVideos:  v => { watchedVideos = v; },
    };

    for (const [key, setter] of Object.entries(dataKeys)) {
        GM_addValueChangeListener(key, (name, oldVal, newVal, remote) => {
            if (remote) { setter(newVal); rebuildLookups(); filterVideos(); }
        });
    }

    // Dismissing the donate banner in one tab hides it in the others
    GM_addValueChangeListener('donateLastShown', (name, oldVal, newVal, remote) => {
        if (remote) { donateLastShown = newVal; hideDonateBanner(); }
    });

    // ==================== Donations ====================

    const DONATE_INTERVAL = 7 * 24 * 60 * 60 * 1000;

    const donateLinks = [
        { label: 'Monobank',   note: 'jar, any bank card', url: 'https://send.monobank.ua/jar/6m4nBQCW9B' },
        { label: 'Ko-fi',      note: 'card, PayPal',       url: 'https://ko-fi.com/commonfool' },
        { label: 'Crypto',     note: 'NOWPayments',        url: 'https://nowpayments.io/donation/commonfool' },
    ];

    // QR code for the Monobank jar link
    const DONATE_QR_PATH = 'M0 0h7v1H0zM8 0h4v1H8zM15 0h2v1H15zM19 0h2v1H19zM22 0h7v1H22zM0 1h1v1H0zM6 1h1v1H6zM8 1h6v1H8zM16 1h3v1H16zM20 1h1v1H20zM22 1h1v1H22zM28 1h1v1H28zM0 2h1v1H0zM2 2h3v1H2zM6 2h1v1H6zM10 2h1v1H10zM12 2h1v1H12zM14 2h1v1H14zM16 2h1v1H16zM18 2h1v1H18zM20 2h1v1H20zM22 2h1v1H22zM24 2h3v1H24zM28 2h1v1H28zM0 3h1v1H0zM2 3h3v1H2zM6 3h1v1H6zM8 3h4v1H8zM17 3h1v1H17zM19 3h1v1H19zM22 3h1v1H22zM24 3h3v1H24zM28 3h1v1H28zM0 4h1v1H0zM2 4h3v1H2zM6 4h1v1H6zM9 4h1v1H9zM14 4h1v1H14zM17 4h1v1H17zM19 4h2v1H19zM22 4h1v1H22zM24 4h3v1H24zM28 4h1v1H28zM0 5h1v1H0zM6 5h1v1H6zM9 5h4v1H9zM14 5h1v1H14zM16 5h1v1H16zM19 5h2v1H19zM22 5h1v1H22zM28 5h1v1H28zM0 6h7v1H0zM8 6h1v1H8zM10 6h1v1H10zM12 6h1v1H12zM14 6h1v1H14zM16 6h1v1H16zM18 6h1v1H18zM20 6h1v1H20zM22 6h7v1H22zM8 7h2v1H8zM11 7h5v1H11zM17 7h4v1H17zM0 8h1v1H0zM2 8h2v1H2zM5 8h3v1H5zM9 8h2v1H9zM13 8h1v1H13zM17 8h1v1H17zM22 8h1v1H22zM25 8h1v1H25zM27 8h2v1H27zM2 9h1v1H2zM4 9h2v1H4zM10 9h1v1H10zM12 9h1v1H12zM17 9h6v1H17zM24 9h1v1H24zM28 9h1v1H28zM0 10h1v1H0zM3 10h2v1H3zM6 10h1v1H6zM9 10h2v1H9zM12 10h1v1H12zM14 10h1v1H14zM18 10h1v1H18zM20 10h4v1H20zM26 10h2v1H26zM0 11h1v1H0zM3 11h1v1H3zM8 11h2v1H8zM11 11h1v1H11zM13 11h1v1H13zM16 11h1v1H16zM18 11h1v1H18zM20 11h1v1H20zM23 11h1v1H23zM28 11h1v1H28zM1 12h6v1H1zM10 12h2v1H10zM15 12h1v1H15zM17 12h1v1H17zM19 12h1v1H19zM25 12h2v1H25zM0 13h1v1H0zM5 13h1v1H5zM8 13h8v1H8zM19 13h1v1H19zM22 13h1v1H22zM26 13h3v1H26zM0 14h1v1H0zM2 14h1v1H2zM5 14h3v1H5zM9 14h1v1H9zM11 14h1v1H11zM14 14h1v1H14zM16 14h2v1H16zM19 14h3v1H19zM24 14h1v1H24zM26 14h3v1H26zM1 15h3v1H1zM5 15h1v1H5zM8 15h1v1H8zM11 15h1v1H11zM13 15h1v1H13zM16 15h1v1H16zM18 15h1v1H18zM23 15h1v1H23zM27 15h1v1H27zM2 16h3v1H2zM6 16h2v1H6zM10 16h1v1H10zM15 16h1v1H15zM18 16h1v1H18zM20 16h2v1H20zM23 16h3v1H23zM27 16h1v1H27zM1 17h1v1H1zM4 17h2v1H4zM7 17h2v1H7zM11 17h3v1H11zM15 17h1v1H15zM20 17h1v1H20zM23 17h1v1H23zM25 17h3v1H25zM0 18h1v1H0zM2 18h2v1H2zM5 18h2v1H5zM9 18h1v1H9zM11 18h1v1H11zM15 18h1v1H15zM18 18h1v1H18zM22 18h3v1H22zM26 18h1v1H26zM4 19h2v1H4zM9 19h1v1H9zM11 19h1v1H11zM16 19h7v1H16zM26 19h1v1H26zM1 20h3v1H1zM5 20h2v1H5zM9 20h5v1H9zM17 20h10v1H17zM8 21h3v1H8zM12 21h3v1H12zM20 21h1v1H20zM24 21h5v1H24zM0 22h7v1H0zM8 22h2v1H8zM11 22h3v1H11zM16 22h1v1H16zM19 22h2v1H19zM22 22h1v1H22zM24 22h2v1H24zM27 22h1v1H27zM0 23h1v1H0zM6 23h1v1H6zM8 23h4v1H8zM20 23h1v1H20zM24 23h2v1H24zM27 23h2v1H27zM0 24h1v1H0zM2 24h3v1H2zM6 24h1v1H6zM9 24h1v1H9zM14 24h1v1H14zM17 24h2v1H17zM20 24h5v1H20zM26 24h2v1H26zM0 25h1v1H0zM2 25h3v1H2zM6 25h1v1H6zM8 25h1v1H8zM11 25h1v1H11zM13 25h4v1H13zM19 25h1v1H19zM21 25h1v1H21zM23 25h3v1H23zM28 25h1v1H28zM0 26h1v1H0zM2 26h3v1H2zM6 26h1v1H6zM8 26h1v1H8zM11 26h1v1H11zM16 26h3v1H16zM20 26h1v1H20zM23 26h1v1H23zM26 26h1v1H26zM28 26h1v1H28zM0 27h1v1H0zM6 27h1v1H6zM9 27h1v1H9zM11 27h1v1H11zM13 27h2v1H13zM16 27h1v1H16zM20 27h1v1H20zM22 27h2v1H22zM25 27h1v1H25zM27 27h1v1H27zM0 28h7v1H0zM8 28h1v1H8zM10 28h2v1H10zM14 28h1v1H14zM16 28h1v1H16zM19 28h2v1H19zM22 28h2v1H22zM25 28h1v1H25zM27 28h1v1H27z';

    // ==================== Utilities ====================

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function extractVideoCode(url) {
        if (!url) return null;
        const cleanUrl = url.split('#')[0].split('?')[0];
        const videosMatch = cleanUrl.match(/\/videos\/(.+)$/);
        if (!videosMatch) return null;
        const path = videosMatch[1];
        if (path.includes('-')) {
            const lastPart = path.split('-').pop();
            if (/^[A-Za-z0-9]{3,16}$/.test(lastPart)) return lastPart;
        }
        if (/^[A-Za-z0-9]{3,16}$/.test(path)) return path;
        return null;
    }

    function cleanUrl(url) {
        return url ? url.split('#')[0].split('?')[0] : '';
    }

    // ==================== Styles ====================

    GM_addStyle(`
        .fhc-hidden {
            display: none !important;
        }

        html.fhc-hide-ads .header-banner,
        html.fhc-hide-ads .moments-main-page,
        html.fhc-hide-ads .exclusive-scenes-section__container {
            display: none !important;
        }

        #fhc-control-panel {
            position: fixed;
            bottom: 8px;
            right: 8px;
            width: 152px;
            max-height: calc(100vh - 16px);
            overflow-y: auto;
            box-sizing: border-box;
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 6px;
            padding: 7px 8px;
            z-index: 9999;
            color: #fff;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11px;
            line-height: 1.3;
            text-align: left;
            box-shadow: 0 3px 10px rgba(0,0,0,0.5);
        }

        #fhc-control-panel * {
            box-sizing: border-box;
            text-align: left;
        }

        #fhc-control-panel h3 {
            margin: 0;
            padding: 0;
            font-size: 11px;
            font-weight: bold;
            color: #00d4ff;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
        }

        #fhc-control-panel h3 .fhc-collapse-btn {
            background: none;
            border: none;
            color: #00d4ff;
            font-size: 10px;
            font-family: inherit;
            cursor: pointer;
            padding: 0;
            margin: 0;
            line-height: 1;
        }

        #fhc-control-panel h3 .fhc-collapse-btn:hover {
            color: #fff;
        }

        #fhc-panel-body {
            margin-top: 6px;
        }

        .fhc-head-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
            font-size: 10px;
            color: #7a7a7a;
            padding: 0 0 3px 18px;
            margin: 0 0 3px 0;
            border-bottom: 1px solid #2a2a2a;
        }

        .fhc-toggle {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0;
            padding: 2px 0;
            cursor: pointer;
            user-select: none;
        }

        .fhc-toggle_master {
            padding-bottom: 4px;
            margin-bottom: 3px;
            border-bottom: 1px solid #2a2a2a;
        }

        .fhc-toggle label {
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            line-height: 1.2;
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .fhc-toggle_master label {
            color: #ddd;
        }

        #fhc-control-panel .fhc-count {
            flex: 0 0 auto;
            min-width: 16px;
            font-size: 11px;
            color: #9a9a9a;
            text-align: right;
        }

        #fhc-control-panel .fhc-toggle_master .fhc-count {
            color: #00d4ff;
            font-weight: bold;
        }

        #fhc-control-panel input[type="checkbox"] {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            flex: 0 0 auto;
            width: 12px;
            height: 12px;
            margin: 0;
            padding: 0;
            border: 1px solid #555;
            border-radius: 2px;
            background: #101010;
            cursor: pointer;
            position: relative;
        }

        #fhc-control-panel input[type="checkbox"]:hover {
            border-color: #00d4ff;
        }

        #fhc-control-panel input[type="checkbox"]:checked {
            background: #00d4ff;
            border-color: #00d4ff;
        }

        #fhc-control-panel input[type="checkbox"]:checked::after {
            content: '';
            position: absolute;
            left: 3px;
            top: 0px;
            width: 3px;
            height: 7px;
            border: solid #101010;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }

        #fhc-control-panel input[type="checkbox"]:indeterminate {
            background: #101010;
            border-color: #00d4ff;
        }

        #fhc-control-panel input[type="checkbox"]:indeterminate::after {
            content: '';
            position: absolute;
            left: 2px;
            top: 2px;
            width: 6px;
            height: 6px;
            border-radius: 1px;
            background: #00d4ff;
        }

        #fhc-lists-block {
            margin-top: 6px;
            padding-top: 5px;
            border-top: 1px solid #2a2a2a;
        }

        .fhc-btn {
            background: #00d4ff;
            color: #000;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-top: 10px;
            width: 100%;
            font-weight: bold;
        }

        .fhc-btn:hover {
            background: #00b8e6;
        }

        .fhc-list-link {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
            background: none;
            border: none;
            width: 100%;
            text-align: left;
            color: #7a7a7a;
            font-size: 10px;
            font-family: inherit;
            padding: 2px 0;
            margin: 0;
            cursor: pointer;
            transition: color 0.2s;
        }

        .fhc-list-link:hover {
            color: #00d4ff;
        }

        .fhc-list-link span {
            color: #00d4ff;
        }

        .fhc-ignore-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            width: 64px;
            height: 64px;
            background: rgba(0, 0, 0, 0.5);
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.2s, background 0.2s;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .thumb.tv:hover .fhc-ignore-btn {
            opacity: 1;
        }

        .fhc-ignore-btn:hover {
            background: rgba(0, 0, 0, 0.8);
            border-color: rgba(255, 255, 255, 0.6);
        }

        .fhc-ignore-btn::before,
        .fhc-ignore-btn::after {
            content: '';
            position: absolute;
            width: 32px;
            height: 4px;
            background: #fff;
        }

        .fhc-ignore-btn::before { transform: rotate(45deg); }
        .fhc-ignore-btn::after { transform: rotate(-45deg); }

        .fhc-block-channel-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            background: rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            cursor: pointer;
            margin-left: 6px;
            opacity: 0;
            transition: opacity 0.2s, background 0.2s;
            vertical-align: middle;
            position: relative;
        }

        .t-ti:hover .fhc-block-channel-btn {
            opacity: 1;
        }

        .fhc-block-channel-btn:hover {
            background: rgba(0, 0, 0, 0.8);
            border-color: rgba(255, 255, 255, 0.6);
        }

        .fhc-block-channel-btn::before,
        .fhc-block-channel-btn::after {
            content: '';
            position: absolute;
            width: 10px;
            height: 1.5px;
            background: #fff;
        }

        .fhc-block-channel-btn::before { transform: rotate(45deg); }
        .fhc-block-channel-btn::after { transform: rotate(-45deg); }

        .fhc-modal {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: rgba(0, 0, 0, 0.8) !important;
            z-index: 999998 !important;
            display: none !important;
            align-items: center !important;
            justify-content: center !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }

        .fhc-modal.active {
            display: flex !important;
            visibility: visible !important;
            pointer-events: auto !important;
        }

        .fhc-modal-content {
            background: #1a1a1a !important;
            border: 2px solid #333 !important;
            border-radius: 8px !important;
            padding: 20px !important;
            max-width: 600px !important;
            max-height: 80vh !important;
            overflow-y: auto !important;
            color: #fff !important;
            z-index: 999999 !important;
            pointer-events: auto !important;
            position: relative !important;
        }

        .fhc-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .fhc-modal-header h2 {
            margin: 0;
            font-size: 18px;
            color: #00d4ff;
        }

        .fhc-modal-close {
            background: #ff4444;
            color: #fff;
            border: none;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
        }

        .fhc-modal-close:hover {
            background: #ff6666;
        }

        .fhc-modal-actions {
            margin-bottom: 15px;
            display: flex;
            gap: 10px;
        }

        .fhc-modal-actions .fhc-btn {
            margin-top: 0;
            width: auto;
        }

        .fhc-ignored-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .fhc-ignored-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            background: #252525;
            margin-bottom: 8px;
            border-radius: 4px;
        }

        .fhc-ignored-item-title {
            flex: 1;
            font-size: 13px;
            margin-right: 10px;
        }

        .fhc-ignored-item-title a {
            color: #00d4ff;
            text-decoration: none;
        }

        .fhc-ignored-item-title a:hover {
            text-decoration: underline;
        }

        .fhc-remove-btn {
            background: #ff4444;
            color: #fff;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }

        .fhc-remove-btn:hover {
            background: #ff6666;
        }

        .fhc-empty-list {
            text-align: center;
            color: #888;
            padding: 20px;
        }

        .fhc-list-link.fhc-support-link,
        .fhc-list-link.fhc-support-link span {
            color: #ff8fab;
        }

        .fhc-list-link.fhc-support-link:hover {
            color: #ffb3c6;
        }

        #fhc-donate {
            position: fixed;
            bottom: 8px;
            left: 8px;
            width: 250px;
            box-sizing: border-box;
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 6px;
            padding: 10px 12px;
            z-index: 9999;
            color: #ddd;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11px;
            line-height: 1.4;
            text-align: left;
            box-shadow: 0 3px 10px rgba(0,0,0,0.5);
        }

        #fhc-donate * {
            box-sizing: border-box;
        }

        #fhc-donate h4 {
            margin: 0 18px 4px 0;
            padding: 0;
            font-size: 12px;
            font-weight: bold;
            color: #00d4ff;
        }

        #fhc-donate p {
            margin: 0 0 8px 0;
            padding: 0;
            color: #aaa;
        }

        .fhc-donate-close {
            position: absolute;
            top: 6px;
            right: 8px;
            background: none;
            border: none;
            color: #777;
            font-size: 16px;
            font-family: inherit;
            line-height: 1;
            cursor: pointer;
            padding: 0;
        }

        .fhc-donate-close:hover {
            color: #fff;
        }

        .fhc-donate-row {
            display: flex;
            gap: 10px;
            align-items: flex-start;
        }

        .fhc-donate-links {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        #fhc-donate a.fhc-donate-link {
            display: block;
            padding: 4px 7px;
            background: #252525;
            border-radius: 4px;
            color: #00d4ff;
            font-weight: bold;
            text-decoration: none;
        }

        #fhc-donate a.fhc-donate-link:hover {
            background: #303030;
        }

        #fhc-donate a.fhc-donate-link small {
            display: block;
            font-size: 9px;
            font-weight: normal;
            color: #888;
        }

        .fhc-donate-qr {
            flex: 0 0 auto;
            text-align: center;
            font-size: 9px;
            color: #888;
        }

        .fhc-donate-qr svg {
            display: block;
            width: 86px;
            height: 86px;
            margin-bottom: 2px;
            border-radius: 3px;
        }
    `);

    // ==================== CRUD operations ====================

    function ignoreVideo(videoId, videoTitle, videoUrl) {
        if (ignoredIds.has(videoId)) return;
        ignoredVideos.push({ id: videoId, title: videoTitle, url: cleanUrl(videoUrl), date: new Date().toISOString() });
        GM_setValue('ignoredVideos', ignoredVideos);
        rebuildLookups();
        filterVideos();
    }

    function unignoreVideo(videoId) {
        ignoredVideos = ignoredVideos.filter(v => v.id !== videoId);
        GM_setValue('ignoredVideos', ignoredVideos);
        rebuildLookups();
        filterVideos();
        updateIgnoredListModal();
    }

    function blockChannel(channelName, channelUrl) {
        if (blockedNames.has(channelName)) return;
        blockedChannels.push({ name: channelName, url: cleanUrl(channelUrl), date: new Date().toISOString() });
        GM_setValue('blockedChannels', blockedChannels);
        rebuildLookups();
        filterVideos();
    }

    function unblockChannel(channelName) {
        blockedChannels = blockedChannels.filter(c => c.name !== channelName);
        GM_setValue('blockedChannels', blockedChannels);
        rebuildLookups();
        filterVideos();
        updateBlockedChannelsModal();
    }

    function markAsWatched(videoId, videoTitle, videoUrl) {
        const videoCode = extractVideoCode(videoUrl);
        if (watchedIds.has(videoId) || (videoCode && watchedCodes.has(videoCode))) return;
        watchedVideos.push({ id: videoId, code: videoCode, title: videoTitle, url: cleanUrl(videoUrl), date: new Date().toISOString() });
        GM_setValue('watchedVideos', watchedVideos);
        rebuildLookups();
    }

    function unmarkAsWatched(identifier) {
        watchedVideos = watchedVideos.filter(v => v.id !== identifier && v.code !== identifier);
        GM_setValue('watchedVideos', watchedVideos);
        rebuildLookups();
        filterVideos();
        updateWatchedListModal();
    }

    // ==================== Video DOM buttons ====================

    function addClickWatcher(videoElement) {
        const videoLink = videoElement.querySelector('.t-vl');
        if (!videoLink || videoLink.dataset.fhcWatcherAdded) return;
        videoLink.dataset.fhcWatcherAdded = 'true';

        const videoId = videoElement.getAttribute('data-id');
        const videoTitle = videoElement.querySelector('.t-tv')?.textContent || 'Untitled';
        const videoUrl = videoLink.getAttribute('href') || '';

        const handler = () => {
            markAsWatched(videoId, videoTitle, videoUrl);
            setTimeout(() => { if (hideWatched) videoElement.classList.add('fhc-hidden'); }, 100);
        };

        videoLink.addEventListener('click', handler);
        videoLink.addEventListener('auxclick', (e) => { if (e.button === 1) handler(); });
    }

    function addIgnoreButton(videoElement) {
        if (videoElement.querySelector('.fhc-ignore-btn')) return;

        const videoId = videoElement.getAttribute('data-id');
        const videoTitle = videoElement.querySelector('.t-tv')?.textContent || 'Untitled';
        const videoUrl = videoElement.querySelector('.t-vl')?.getAttribute('href') || '';

        const ignoreBtn = document.createElement('div');
        ignoreBtn.className = 'fhc-ignore-btn';
        ignoreBtn.title = 'Ignore this video';
        ignoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            ignoreVideo(videoId, videoTitle, videoUrl);
            videoElement.classList.add('fhc-hidden');
        });

        const thumbMedia = videoElement.querySelector('.t-m');
        if (thumbMedia) {
            thumbMedia.style.position = 'relative';
            thumbMedia.appendChild(ignoreBtn);
        }
    }

    function addBlockChannelButton(videoElement) {
        const channelLink = videoElement.querySelector('.t-ti-s');
        if (!channelLink || channelLink.parentElement.querySelector('.fhc-block-channel-btn')) return;

        const channelName = channelLink.textContent.trim();
        const channelUrl = channelLink.getAttribute('href') || '';

        const blockBtn = document.createElement('span');
        blockBtn.className = 'fhc-block-channel-btn';
        blockBtn.title = `Block channel ${channelName}`;
        blockBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            blockChannel(channelName, channelUrl);
            videoElement.classList.add('fhc-hidden');
        });

        channelLink.parentElement.appendChild(blockBtn);
    }

    // ==================== Filtering ====================

    function filterVideos() {
        const videos = document.querySelectorAll('.thumb.tv');
        let hiddenPremium = 0, hiddenPaid = 0, hiddenVR = 0;
        let hiddenIgnored = 0, hiddenByChannel = 0, hiddenWatched = 0;

        videos.forEach(video => {
            const videoId = video.getAttribute('data-id');
            const videoLink = video.querySelector('.t-vl');
            const videoUrl = videoLink?.getAttribute('href') || '';
            const videoCode = extractVideoCode(videoUrl);

            const isPremium = video.querySelector('.btn_square-fan');
            const isPaid = video.querySelector('.btn_square-vod');
            const isVR = video.querySelector('.vr-label');
            const isIgnored = ignoredIds.has(videoId);
            const isWatched = (videoCode && watchedCodes.has(videoCode)) || watchedIds.has(videoId);
            const channelName = video.querySelector('.t-ti-s')?.textContent.trim();
            const isChannelBlocked = blockedNames.has(channelName);

            let shouldHide = false;
            let hideReason = null;

            if (isPremium && hidePremium)              { shouldHide = true; hideReason = 'premium'; }
            else if (isPaid && hidePaid)                { shouldHide = true; hideReason = 'paid'; }
            else if (isVR && hideVR)                    { shouldHide = true; hideReason = 'vr'; }
            else if (isIgnored && hideIgnored)          { shouldHide = true; hideReason = 'ignored'; }
            else if (isChannelBlocked && hideBlockedChannels) { shouldHide = true; hideReason = 'channel'; }
            else if (isWatched && hideWatched)          { shouldHide = true; hideReason = 'watched'; }

            if (shouldHide) {
                video.classList.add('fhc-hidden');
                if (hideReason === 'premium') hiddenPremium++;
                else if (hideReason === 'paid') hiddenPaid++;
                else if (hideReason === 'vr') hiddenVR++;
                else if (hideReason === 'ignored') hiddenIgnored++;
                else if (hideReason === 'channel') hiddenByChannel++;
                else if (hideReason === 'watched') hiddenWatched++;
            } else {
                video.classList.remove('fhc-hidden');
            }

            addIgnoreButton(video);
            addBlockChannelButton(video);
            addClickWatcher(video);
        });

        applyAdsVisibility();
        updateStats(hiddenPremium, hiddenPaid, hiddenVR, hiddenIgnored, hiddenByChannel, hiddenWatched);
    }

    function applyAdsVisibility() {
        document.documentElement.classList.toggle('fhc-hide-ads', hideAds);

        const el = document.getElementById('fhc-cnt-ads');
        if (el) el.textContent = hideAds ? document.querySelectorAll(AD_SELECTOR).length : 0;
    }

    function updateStats(hiddenPremium, hiddenPaid, hiddenVR, hiddenIgnored, hiddenByChannel, hiddenWatched) {
        const total = hiddenPremium + hiddenPaid + hiddenVR + hiddenIgnored + hiddenByChannel + hiddenWatched;

        const counts = {
            'fhc-cnt-total':    total,
            'fhc-cnt-premium':  hiddenPremium,
            'fhc-cnt-paid':     hiddenPaid,
            'fhc-cnt-vr':       hiddenVR,
            'fhc-cnt-ignored':  hiddenIgnored,
            'fhc-cnt-channels': hiddenByChannel,
            'fhc-cnt-watched':  hiddenWatched,
        };

        for (const [id, value] of Object.entries(counts)) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }

        const linkIgnored = document.getElementById('fhc-link-ignored-count');
        const linkChannels = document.getElementById('fhc-link-channels-count');
        const linkWatched = document.getElementById('fhc-link-watched-count');
        if (linkIgnored) linkIgnored.textContent = ignoredVideos.length;
        if (linkChannels) linkChannels.textContent = blockedChannels.length;
        if (linkWatched) linkWatched.textContent = watchedVideos.length;
    }

    // ==================== Modals ====================

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.setProperty('display', 'none', 'important');
            modal.style.setProperty('visibility', 'hidden', 'important');
            modal.style.setProperty('pointer-events', 'none', 'important');
            modal.classList.remove('active');
        }
    }

    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            const content = modal.querySelector('.fhc-modal-content');

            modal.style.setProperty('display', 'flex', 'important');
            modal.style.setProperty('visibility', 'visible', 'important');
            modal.style.setProperty('opacity', '1', 'important');
            modal.style.setProperty('pointer-events', 'auto', 'important');

            if (content) {
                content.style.setProperty('pointer-events', 'auto', 'important');
            }

            modal.classList.add('active');

            if (modalId === 'fhc-ignored-modal') {
                updateIgnoredListModal();
            } else if (modalId === 'fhc-blocked-channels-modal') {
                updateBlockedChannelsModal();
            } else if (modalId === 'fhc-watched-modal') {
                updateWatchedListModal();
            }
        }
    }

    function createIgnoredListModal() {
        const modal = document.createElement('div');
        modal.className = 'fhc-modal';
        modal.id = 'fhc-ignored-modal';
        modal.innerHTML = `
            <div class="fhc-modal-content">
                <div class="fhc-modal-header">
                    <h2>📝 Ignored videos</h2>
                    <button class="fhc-modal-close">×</button>
                </div>
                <div class="fhc-modal-actions">
                    <button class="fhc-btn" id="fhc-clear-ignored" style="background: #ff4444;">🗑️ Clear list</button>
                </div>
                <ul class="fhc-ignored-list" id="fhc-ignored-list"></ul>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.fhc-modal-close').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal('fhc-ignored-modal');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal('fhc-ignored-modal');
        });

        document.getElementById('fhc-clear-ignored').addEventListener('click', () => {
            if (confirm(`Clear the ignored videos list?\n\nEntries in the list: ${ignoredVideos.length}`)) {
                ignoredVideos = [];
                GM_setValue('ignoredVideos', ignoredVideos);
                rebuildLookups();
                filterVideos();
                updateIgnoredListModal();
            }
        });

        updateIgnoredListModal();

        setTimeout(() => {
            modal.style.setProperty('display', 'none', 'important');
            modal.style.setProperty('visibility', 'hidden', 'important');
            modal.style.setProperty('pointer-events', 'none', 'important');
        }, 100);
    }

    function createBlockedChannelsModal() {
        const modal = document.createElement('div');
        modal.className = 'fhc-modal';
        modal.id = 'fhc-blocked-channels-modal';
        modal.innerHTML = `
            <div class="fhc-modal-content">
                <div class="fhc-modal-header">
                    <h2>🚫 Blocked channels</h2>
                    <button class="fhc-modal-close">×</button>
                </div>
                <div class="fhc-modal-actions">
                    <button class="fhc-btn" id="fhc-clear-channels" style="background: #ff4444;">🗑️ Clear list</button>
                </div>
                <ul class="fhc-ignored-list" id="fhc-blocked-channels-list"></ul>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.fhc-modal-close').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal('fhc-blocked-channels-modal');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal('fhc-blocked-channels-modal');
        });

        document.getElementById('fhc-clear-channels').addEventListener('click', () => {
            if (confirm(`Clear the blocked channels list?\n\nEntries in the list: ${blockedChannels.length}`)) {
                blockedChannels = [];
                GM_setValue('blockedChannels', blockedChannels);
                rebuildLookups();
                filterVideos();
                updateBlockedChannelsModal();
            }
        });

        updateBlockedChannelsModal();

        setTimeout(() => {
            modal.style.setProperty('display', 'none', 'important');
            modal.style.setProperty('visibility', 'hidden', 'important');
            modal.style.setProperty('pointer-events', 'none', 'important');
        }, 100);
    }

    function createWatchedListModal() {
        const modal = document.createElement('div');
        modal.className = 'fhc-modal';
        modal.id = 'fhc-watched-modal';
        modal.innerHTML = `
            <div class="fhc-modal-content">
                <div class="fhc-modal-header">
                    <h2>👁️ Watched videos</h2>
                    <button class="fhc-modal-close">×</button>
                </div>
                <div class="fhc-modal-actions">
                    <button class="fhc-btn" id="fhc-clear-watched" style="background: #ff4444;">🗑️ Clear list</button>
                    <button class="fhc-btn" id="fhc-import-history" style="background: #ff9800;">📥 Import from history</button>
                </div>
                <input type="file" id="fhc-file-input" accept=".csv,.txt" style="display: none;">
                <ul class="fhc-ignored-list" id="fhc-watched-list"></ul>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.fhc-modal-close').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal('fhc-watched-modal');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal('fhc-watched-modal');
        });

        document.getElementById('fhc-clear-watched').addEventListener('click', () => {
            if (confirm(`Clear the watched videos list?\n\nEntries in the list: ${watchedVideos.length}`)) {
                watchedVideos = [];
                GM_setValue('watchedVideos', watchedVideos);
                rebuildLookups();
                filterVideos();
                updateWatchedListModal();
            }
        });

        const fileInput = document.getElementById('fhc-file-input');

        document.getElementById('fhc-import-history').addEventListener('click', () => {
            fileInput.click();
        });

        // Export
        const exportBtn = document.createElement('button');
        exportBtn.className = 'fhc-btn';
        exportBtn.style.background = '#4CAF50';
        exportBtn.textContent = '📤 Export';
        exportBtn.addEventListener('click', () => {
            const data = JSON.stringify(watchedVideos, null, 2);
            const blob = new Blob([data], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'faphouse_watched.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        document.querySelector('#fhc-watched-modal .fhc-modal-actions').appendChild(exportBtn);

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                const lines = content.split('\n');
                let imported = 0;
                let skipped = 0;

                lines.forEach(line => {
                    const url = line.replace(/^"|"$/g, '').trim();
                    if (!url || !url.includes('/videos/')) return;

                    const videoCode = extractVideoCode(url);
                    if (!videoCode) return;

                    if (!watchedCodes.has(videoCode)) {
                        watchedVideos.push({
                            id: null,
                            code: videoCode,
                            title: 'Imported from history',
                            url: url.split('#')[0],
                            date: new Date().toISOString()
                        });
                        watchedCodes.add(videoCode);
                        imported++;
                    } else {
                        skipped++;
                    }
                });

                GM_setValue('watchedVideos', watchedVideos);
                rebuildLookups();
                filterVideos();
                updateWatchedListModal();
                alert(`Import complete!\n\nAdded: ${imported}\nSkipped (duplicates): ${skipped}\nTotal watched: ${watchedVideos.length}`);

                fileInput.value = '';
            };

            reader.readAsText(file);
        });

        updateWatchedListModal();

        setTimeout(() => {
            modal.style.setProperty('display', 'none', 'important');
            modal.style.setProperty('visibility', 'hidden', 'important');
            modal.style.setProperty('pointer-events', 'none', 'important');
        }, 100);
    }

    // ==================== Modal content updates ====================

    function updateIgnoredListModal() {
        const list = document.getElementById('fhc-ignored-list');
        const modal = document.getElementById('fhc-ignored-modal');
        if (!list || !modal) return;

        modal.querySelector('h2').textContent = `📝 Ignored videos (${ignoredVideos.length})`;

        if (ignoredVideos.length === 0) {
            list.innerHTML = '<div class="fhc-empty-list">The list is empty</div>';
            return;
        }

        list.innerHTML = ignoredVideos.map(video => `
            <li class="fhc-ignored-item">
                <div class="fhc-ignored-item-title">
                    <a href="${escapeHtml(video.url)}" target="_blank">${escapeHtml(video.title)}</a>
                </div>
                <button class="fhc-remove-btn" data-video-id="${escapeHtml(video.id)}">Remove</button>
            </li>
        `).join('');

        list.querySelectorAll('.fhc-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                unignoreVideo(btn.getAttribute('data-video-id'));
            });
        });
    }

    function updateBlockedChannelsModal() {
        const list = document.getElementById('fhc-blocked-channels-list');
        const modal = document.getElementById('fhc-blocked-channels-modal');
        if (!list || !modal) return;

        modal.querySelector('h2').textContent = `🚫 Blocked channels (${blockedChannels.length})`;

        if (blockedChannels.length === 0) {
            list.innerHTML = '<div class="fhc-empty-list">The list is empty</div>';
            return;
        }

        list.innerHTML = blockedChannels.map(channel => `
            <li class="fhc-ignored-item">
                <div class="fhc-ignored-item-title">
                    <a href="${escapeHtml(channel.url)}" target="_blank">${escapeHtml(channel.name)}</a>
                </div>
                <button class="fhc-remove-btn" data-channel-name="${escapeHtml(channel.name)}">Remove</button>
            </li>
        `).join('');

        list.querySelectorAll('.fhc-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                unblockChannel(btn.getAttribute('data-channel-name'));
            });
        });
    }

    function updateWatchedListModal() {
        const list = document.getElementById('fhc-watched-list');
        const modal = document.getElementById('fhc-watched-modal');
        if (!list || !modal) return;

        modal.querySelector('h2').textContent = `👁️ Watched videos (${watchedVideos.length})`;

        if (watchedVideos.length === 0) {
            list.innerHTML = '<div class="fhc-empty-list">The list is empty</div>';
            return;
        }

        const sortedVideos = [...watchedVideos].sort((a, b) => new Date(b.date) - new Date(a.date));

        list.innerHTML = sortedVideos.slice(0, 100).map(video => `
            <li class="fhc-ignored-item">
                <div class="fhc-ignored-item-title">
                    <a href="${escapeHtml(video.url)}" target="_blank">${escapeHtml(video.title)}</a>
                </div>
                <button class="fhc-remove-btn" data-video-id="${escapeHtml(video.code || video.id || '')}">Remove</button>
            </li>
        `).join('');

        if (watchedVideos.length > 100) {
            list.innerHTML += `<div class="fhc-empty-list">...and ${watchedVideos.length - 100} more</div>`;
        }

        list.querySelectorAll('.fhc-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                unmarkAsWatched(btn.getAttribute('data-video-id'));
            });
        });
    }

    // ==================== Control panel ====================

    function updatePanelView() {
        const body = document.getElementById('fhc-panel-body');
        const btn = document.querySelector('.fhc-collapse-btn');
        const expanded = panelState === 1;

        if (body) body.style.display = expanded ? 'block' : 'none';
        if (btn) {
            btn.textContent = expanded ? '▼' : '▲';
            btn.title = expanded ? 'Collapse' : 'Expand';
        }
    }

    function syncTogglesUI() {
        toggleDefs.forEach(t => {
            const cb = document.getElementById(t.id);
            if (cb) cb.checked = t.get();
        });
        updateMasterToggle();
    }

    function updateMasterToggle() {
        const master = document.getElementById('fhc-master-toggle');
        if (!master) return;

        const on = toggleDefs.filter(t => t.get()).length;
        master.checked = on === toggleDefs.length;
        master.indeterminate = on > 0 && on < toggleDefs.length;
    }

    function createControlPanel() {
        const togglesHtml = toggleDefs.map(t => `
            <div class="fhc-toggle">
                <input type="checkbox" id="${t.id}" ${t.get() ? 'checked' : ''}>
                <label for="${t.id}">${t.label}</label>
                <span class="fhc-count" id="${t.countId}">0</span>
            </div>
        `).join('');

        const panel = document.createElement('div');
        panel.id = 'fhc-control-panel';
        panel.innerHTML = `
            <h3>
                <span>🎬 FapHouse Filter</span>
                <button class="fhc-collapse-btn">▼</button>
            </h3>
            <div id="fhc-panel-body">
                <div id="fhc-toggles-block">
                    <div class="fhc-head-row">
                        <span>Hide</span>
                        <span>Hidden</span>
                    </div>
                    <div class="fhc-toggle fhc-toggle_master">
                        <input type="checkbox" id="fhc-master-toggle">
                        <label for="fhc-master-toggle">All</label>
                        <span class="fhc-count" id="fhc-cnt-total">0</span>
                    </div>
                    ${togglesHtml}
                </div>
                <div id="fhc-lists-block">
                    <button class="fhc-list-link" id="fhc-show-ignored">Ignored videos<span id="fhc-link-ignored-count">${ignoredVideos.length}</span></button>
                    <button class="fhc-list-link" id="fhc-show-blocked-channels">Blocked channels<span id="fhc-link-channels-count">${blockedChannels.length}</span></button>
                    <button class="fhc-list-link" id="fhc-show-watched">Watched<span id="fhc-link-watched-count">${watchedVideos.length}</span></button>
                    <button class="fhc-list-link fhc-support-link" id="fhc-show-donate">Support the project<span>♥</span></button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        panel.querySelector('.fhc-collapse-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            panelState = panelState === 1 ? 0 : 1;
            GM_setValue('panelState', panelState);
            updatePanelView();
        });

        toggleDefs.forEach(t => {
            document.getElementById(t.id).addEventListener('change', (e) => {
                toggleKeys[t.key](e.target.checked);
                GM_setValue(t.key, e.target.checked);
                updateMasterToggle();
                filterVideos();
            });
        });

        document.getElementById('fhc-master-toggle').addEventListener('change', (e) => {
            const on = e.target.checked;
            toggleDefs.forEach(t => {
                toggleKeys[t.key](on);
                GM_setValue(t.key, on);
                const cb = document.getElementById(t.id);
                if (cb) cb.checked = on;
            });
            updateMasterToggle();
            filterVideos();
        });

        document.getElementById('fhc-show-ignored').addEventListener('click', () => openModal('fhc-ignored-modal'));
        document.getElementById('fhc-show-blocked-channels').addEventListener('click', () => openModal('fhc-blocked-channels-modal'));
        document.getElementById('fhc-show-watched').addEventListener('click', () => openModal('fhc-watched-modal'));
        document.getElementById('fhc-show-donate').addEventListener('click', showDonateBanner);

        updateMasterToggle();
        updatePanelView();
    }

    // ==================== Donate banner ====================

    function showDonateBanner() {
        if (document.getElementById('fhc-donate')) return;

        const linksHtml = donateLinks.map(l => `
            <a class="fhc-donate-link" href="${l.url}" target="_blank" rel="noopener">${l.label}<small>${l.note}</small></a>
        `).join('');

        const banner = document.createElement('div');
        banner.id = 'fhc-donate';
        banner.innerHTML = `
            <button class="fhc-donate-close" title="Close">×</button>
            <h4>♥ Enjoying FapHouse Cleaner?</h4>
            <p>It's free and kept up to date in my spare time. If it saves you some scrolling, consider buying me a coffee.</p>
            <div class="fhc-donate-row">
                <div class="fhc-donate-links">${linksHtml}</div>
                <div class="fhc-donate-qr">
                    <svg viewBox="-2 -2 33 33" shape-rendering="crispEdges"><rect x="-2" y="-2" width="33" height="33" fill="#fff"/><path d="${DONATE_QR_PATH}" fill="#000"/></svg>
                    Monobank
                </div>
            </div>
        `;

        document.body.appendChild(banner);

        // Closing or following any link postpones the next showing by a full interval
        const dismiss = () => {
            donateLastShown = Date.now();
            GM_setValue('donateLastShown', donateLastShown);
        };

        banner.querySelector('.fhc-donate-close').addEventListener('click', () => {
            dismiss();
            hideDonateBanner();
        });
        banner.querySelectorAll('.fhc-donate-link').forEach(a => a.addEventListener('click', dismiss));
    }

    function hideDonateBanner() {
        document.getElementById('fhc-donate')?.remove();
    }

    function maybeShowDonateBanner() {
        if (Date.now() - donateLastShown >= DONATE_INTERVAL) showDonateBanner();
    }

    // ==================== DOM observer ====================

    function observeVideoList() {
        const observer = new MutationObserver((mutations) => {
            let shouldFilter = false;
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && (node.classList?.contains('thumb') || node.querySelector?.('.thumb.tv'))) {
                        shouldFilter = true;
                    }
                });
            });
            if (shouldFilter) filterVideos();
        });

        observer.observe(document.body, { childList: true, subtree: true });

        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(filterVideos, 100);
        });
    }

    // ==================== Data cleanup ====================

    function cleanupWatchedList() {
        const before = watchedVideos.length;

        watchedVideos = watchedVideos.filter(v => v.id || v.code);

        const seenCodes = new Set();
        const seenIds = new Set();
        watchedVideos = watchedVideos.filter(v => {
            if ((v.code && seenCodes.has(v.code)) || (v.id && seenIds.has(v.id))) return false;
            if (v.code) seenCodes.add(v.code);
            if (v.id) seenIds.add(v.id);
            return true;
        });

        if (watchedVideos.length !== before) {
            GM_setValue('watchedVideos', watchedVideos);
            console.log(`[FH Filter] Cleanup watched: ${before} → ${watchedVideos.length}`);
        }
    }

    // ==================== Initialization ====================

    function getVideoId(thumb) {
        return thumb.getAttribute('data-id')
            || thumb.querySelector('[data-el-video-id]')?.getAttribute('data-el-video-id')
            || null;
    }

    function installIgnoreDelegate() {
        const swallow = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick'];

        swallow.forEach(type => {
            window.addEventListener(type, (e) => {
                if (e.target.closest?.('.fhc-ignore-btn')) e.stopImmediatePropagation();
            }, true);
        });

        window.addEventListener('click', (e) => {
            const btn = e.target.closest?.('.fhc-ignore-btn');
            if (!btn) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            const thumb = btn.closest('.thumb.tv');
            if (!thumb) return;

            const id = getVideoId(thumb);
            const title = thumb.querySelector('.t-tv')?.textContent || 'Untitled';
            const url = thumb.querySelector('.t-vl')?.getAttribute('href') || '';

            ignoreVideo(id, title, url);

            if (thumb.classList.contains('big-hover')) thumb.style.display = 'none';
            else thumb.classList.add('fhc-hidden');
        }, true);
    }

    function init() {
        cleanupWatchedList();
        rebuildLookups();
        createControlPanel();
        createIgnoredListModal();
        createBlockedChannelsModal();
        createWatchedListModal();
        filterVideos();
        installIgnoreDelegate();
        observeVideoList();
        maybeShowDonateBanner();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();