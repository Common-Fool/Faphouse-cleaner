// ==UserScript==
// @name         FapHouse Premium Video Hider
// @namespace    http://tampermonkey.net/
// @version      1.6
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

    // ==================== Данные ====================

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

    // ==================== Lookup-индексы (Set) ====================

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

    // ==================== Синхронизация между вкладками ====================

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
        { id: 'fh-premium-toggle',          countId: 'fh-cnt-premium',  key: 'hidePremium',         label: 'Премиум',       get: () => hidePremium },
        { id: 'fh-paid-toggle',             countId: 'fh-cnt-paid',     key: 'hidePaid',            label: 'Платные',       get: () => hidePaid },
        { id: 'fh-vr-toggle',               countId: 'fh-cnt-vr',       key: 'hideVR',              label: 'VR',            get: () => hideVR },
        { id: 'fh-ignored-toggle',          countId: 'fh-cnt-ignored',  key: 'hideIgnored',         label: 'Игнор',         get: () => hideIgnored },
        { id: 'fh-blocked-channels-toggle', countId: 'fh-cnt-channels', key: 'hideBlockedChannels', label: 'Каналы',        get: () => hideBlockedChannels },
        { id: 'fh-watched-toggle',          countId: 'fh-cnt-watched',  key: 'hideWatched',         label: 'Просмотренные', get: () => hideWatched },
        { id: 'fh-ads-toggle',              countId: 'fh-cnt-ads',      key: 'hideAds',             label: 'Реклама',       get: () => hideAds },
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

    // ==================== Утилиты ====================

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

    // ==================== Стили ====================

    GM_addStyle(`
        .fh-hidden {
            display: none !important;
        }

        html.fh-hide-ads .header-banner,
        html.fh-hide-ads .moments-main-page,
        html.fh-hide-ads .exclusive-scenes-section__container {
            display: none !important;
        }

        #fh-control-panel {
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

        #fh-control-panel * {
            box-sizing: border-box;
            text-align: left;
        }

        #fh-control-panel h3 {
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

        #fh-control-panel h3 .fh-collapse-btn {
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

        #fh-control-panel h3 .fh-collapse-btn:hover {
            color: #fff;
        }

        #fh-panel-body {
            margin-top: 6px;
        }

        .fh-head-row {
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

        .fh-toggle {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0;
            padding: 2px 0;
            cursor: pointer;
            user-select: none;
        }

        .fh-toggle_master {
            padding-bottom: 4px;
            margin-bottom: 3px;
            border-bottom: 1px solid #2a2a2a;
        }

        .fh-toggle label {
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            line-height: 1.2;
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .fh-toggle_master label {
            color: #ddd;
        }

        #fh-control-panel .fh-count {
            flex: 0 0 auto;
            min-width: 16px;
            font-size: 11px;
            color: #9a9a9a;
            text-align: right;
        }

        #fh-control-panel .fh-toggle_master .fh-count {
            color: #00d4ff;
            font-weight: bold;
        }

        #fh-control-panel input[type="checkbox"] {
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

        #fh-control-panel input[type="checkbox"]:hover {
            border-color: #00d4ff;
        }

        #fh-control-panel input[type="checkbox"]:checked {
            background: #00d4ff;
            border-color: #00d4ff;
        }

        #fh-control-panel input[type="checkbox"]:checked::after {
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

        #fh-control-panel input[type="checkbox"]:indeterminate {
            background: #101010;
            border-color: #00d4ff;
        }

        #fh-control-panel input[type="checkbox"]:indeterminate::after {
            content: '';
            position: absolute;
            left: 2px;
            top: 2px;
            width: 6px;
            height: 6px;
            border-radius: 1px;
            background: #00d4ff;
        }

        #fh-lists-block {
            margin-top: 6px;
            padding-top: 5px;
            border-top: 1px solid #2a2a2a;
        }

        .fh-btn {
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

        .fh-btn:hover {
            background: #00b8e6;
        }

        .fh-list-link {
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

        .fh-list-link:hover {
            color: #00d4ff;
        }

        .fh-list-link span {
            color: #00d4ff;
        }

        .fh-ignore-btn {
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

        .thumb.tv:hover .fh-ignore-btn {
            opacity: 1;
        }

        .fh-ignore-btn:hover {
            background: rgba(0, 0, 0, 0.8);
            border-color: rgba(255, 255, 255, 0.6);
        }

        .fh-ignore-btn::before,
        .fh-ignore-btn::after {
            content: '';
            position: absolute;
            width: 32px;
            height: 4px;
            background: #fff;
        }

        .fh-ignore-btn::before { transform: rotate(45deg); }
        .fh-ignore-btn::after { transform: rotate(-45deg); }

        .fh-block-channel-btn {
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

        .t-ti:hover .fh-block-channel-btn {
            opacity: 1;
        }

        .fh-block-channel-btn:hover {
            background: rgba(0, 0, 0, 0.8);
            border-color: rgba(255, 255, 255, 0.6);
        }

        .fh-block-channel-btn::before,
        .fh-block-channel-btn::after {
            content: '';
            position: absolute;
            width: 10px;
            height: 1.5px;
            background: #fff;
        }

        .fh-block-channel-btn::before { transform: rotate(45deg); }
        .fh-block-channel-btn::after { transform: rotate(-45deg); }

        .fh-modal {
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

        .fh-modal.active {
            display: flex !important;
            visibility: visible !important;
            pointer-events: auto !important;
        }

        .fh-modal-content {
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

        .fh-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .fh-modal-header h2 {
            margin: 0;
            font-size: 18px;
            color: #00d4ff;
        }

        .fh-modal-close {
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

        .fh-modal-close:hover {
            background: #ff6666;
        }

        .fh-modal-actions {
            margin-bottom: 15px;
            display: flex;
            gap: 10px;
        }

        .fh-modal-actions .fh-btn {
            margin-top: 0;
            width: auto;
        }

        .fh-ignored-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .fh-ignored-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            background: #252525;
            margin-bottom: 8px;
            border-radius: 4px;
        }

        .fh-ignored-item-title {
            flex: 1;
            font-size: 13px;
            margin-right: 10px;
        }

        .fh-ignored-item-title a {
            color: #00d4ff;
            text-decoration: none;
        }

        .fh-ignored-item-title a:hover {
            text-decoration: underline;
        }

        .fh-remove-btn {
            background: #ff4444;
            color: #fff;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }

        .fh-remove-btn:hover {
            background: #ff6666;
        }

        .fh-empty-list {
            text-align: center;
            color: #888;
            padding: 20px;
        }
    `);

    // ==================== CRUD операции ====================

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

    // ==================== DOM-кнопки на видео ====================

    function addClickWatcher(videoElement) {
        const videoLink = videoElement.querySelector('.t-vl');
        if (!videoLink || videoLink.dataset.fhWatcherAdded) return;
        videoLink.dataset.fhWatcherAdded = 'true';

        const videoId = videoElement.getAttribute('data-id');
        const videoTitle = videoElement.querySelector('.t-tv')?.textContent || 'Без названия';
        const videoUrl = videoLink.getAttribute('href') || '';

        const handler = () => {
            markAsWatched(videoId, videoTitle, videoUrl);
            setTimeout(() => { if (hideWatched) videoElement.classList.add('fh-hidden'); }, 100);
        };

        videoLink.addEventListener('click', handler);
        videoLink.addEventListener('auxclick', (e) => { if (e.button === 1) handler(); });
    }

    function addIgnoreButton(videoElement) {
        if (videoElement.querySelector('.fh-ignore-btn')) return;

        const videoId = videoElement.getAttribute('data-id');
        const videoTitle = videoElement.querySelector('.t-tv')?.textContent || 'Без названия';
        const videoUrl = videoElement.querySelector('.t-vl')?.getAttribute('href') || '';

        const ignoreBtn = document.createElement('div');
        ignoreBtn.className = 'fh-ignore-btn';
        ignoreBtn.title = 'Игнорировать это видео';
        ignoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            ignoreVideo(videoId, videoTitle, videoUrl);
            videoElement.classList.add('fh-hidden');
        });

        const thumbMedia = videoElement.querySelector('.t-m');
        if (thumbMedia) {
            thumbMedia.style.position = 'relative';
            thumbMedia.appendChild(ignoreBtn);
        }
    }

    function addBlockChannelButton(videoElement) {
        const channelLink = videoElement.querySelector('.t-ti-s');
        if (!channelLink || channelLink.parentElement.querySelector('.fh-block-channel-btn')) return;

        const channelName = channelLink.textContent.trim();
        const channelUrl = channelLink.getAttribute('href') || '';

        const blockBtn = document.createElement('span');
        blockBtn.className = 'fh-block-channel-btn';
        blockBtn.title = `Заблокировать канал ${channelName}`;
        blockBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            blockChannel(channelName, channelUrl);
            videoElement.classList.add('fh-hidden');
        });

        channelLink.parentElement.appendChild(blockBtn);
    }

    // ==================== Фильтрация ====================

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
                video.classList.add('fh-hidden');
                if (hideReason === 'premium') hiddenPremium++;
                else if (hideReason === 'paid') hiddenPaid++;
                else if (hideReason === 'vr') hiddenVR++;
                else if (hideReason === 'ignored') hiddenIgnored++;
                else if (hideReason === 'channel') hiddenByChannel++;
                else if (hideReason === 'watched') hiddenWatched++;
            } else {
                video.classList.remove('fh-hidden');
            }

            addIgnoreButton(video);
            addBlockChannelButton(video);
            addClickWatcher(video);
        });

        applyAdsVisibility();
        updateStats(hiddenPremium, hiddenPaid, hiddenVR, hiddenIgnored, hiddenByChannel, hiddenWatched);
    }

    function applyAdsVisibility() {
        document.documentElement.classList.toggle('fh-hide-ads', hideAds);

        const el = document.getElementById('fh-cnt-ads');
        if (el) el.textContent = hideAds ? document.querySelectorAll(AD_SELECTOR).length : 0;
    }

    function updateStats(hiddenPremium, hiddenPaid, hiddenVR, hiddenIgnored, hiddenByChannel, hiddenWatched) {
        const total = hiddenPremium + hiddenPaid + hiddenVR + hiddenIgnored + hiddenByChannel + hiddenWatched;

        const counts = {
            'fh-cnt-total':    total,
            'fh-cnt-premium':  hiddenPremium,
            'fh-cnt-paid':     hiddenPaid,
            'fh-cnt-vr':       hiddenVR,
            'fh-cnt-ignored':  hiddenIgnored,
            'fh-cnt-channels': hiddenByChannel,
            'fh-cnt-watched':  hiddenWatched,
        };

        for (const [id, value] of Object.entries(counts)) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }

        const linkIgnored = document.getElementById('fh-link-ignored-count');
        const linkChannels = document.getElementById('fh-link-channels-count');
        const linkWatched = document.getElementById('fh-link-watched-count');
        if (linkIgnored) linkIgnored.textContent = ignoredVideos.length;
        if (linkChannels) linkChannels.textContent = blockedChannels.length;
        if (linkWatched) linkWatched.textContent = watchedVideos.length;
    }

    // ==================== Модальные окна ====================

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
            const content = modal.querySelector('.fh-modal-content');

            modal.style.setProperty('display', 'flex', 'important');
            modal.style.setProperty('visibility', 'visible', 'important');
            modal.style.setProperty('opacity', '1', 'important');
            modal.style.setProperty('pointer-events', 'auto', 'important');

            if (content) {
                content.style.setProperty('pointer-events', 'auto', 'important');
            }

            modal.classList.add('active');

            if (modalId === 'fh-ignored-modal') {
                updateIgnoredListModal();
            } else if (modalId === 'fh-blocked-channels-modal') {
                updateBlockedChannelsModal();
            } else if (modalId === 'fh-watched-modal') {
                updateWatchedListModal();
            }
        }
    }

    function createIgnoredListModal() {
        const modal = document.createElement('div');
        modal.className = 'fh-modal';
        modal.id = 'fh-ignored-modal';
        modal.innerHTML = `
            <div class="fh-modal-content">
                <div class="fh-modal-header">
                    <h2>📝 Игнор-лист видео</h2>
                    <button class="fh-modal-close">×</button>
                </div>
                <div class="fh-modal-actions">
                    <button class="fh-btn" id="fh-clear-ignored" style="background: #ff4444;">🗑️ Очистить список</button>
                </div>
                <ul class="fh-ignored-list" id="fh-ignored-list"></ul>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.fh-modal-close').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal('fh-ignored-modal');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal('fh-ignored-modal');
        });

        document.getElementById('fh-clear-ignored').addEventListener('click', () => {
            if (confirm(`Очистить игнор-лист видео?\n\nСейчас в списке: ${ignoredVideos.length} записей`)) {
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
        modal.className = 'fh-modal';
        modal.id = 'fh-blocked-channels-modal';
        modal.innerHTML = `
            <div class="fh-modal-content">
                <div class="fh-modal-header">
                    <h2>🚫 Заблокированные каналы</h2>
                    <button class="fh-modal-close">×</button>
                </div>
                <div class="fh-modal-actions">
                    <button class="fh-btn" id="fh-clear-channels" style="background: #ff4444;">🗑️ Очистить список</button>
                </div>
                <ul class="fh-ignored-list" id="fh-blocked-channels-list"></ul>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.fh-modal-close').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal('fh-blocked-channels-modal');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal('fh-blocked-channels-modal');
        });

        document.getElementById('fh-clear-channels').addEventListener('click', () => {
            if (confirm(`Очистить список каналов?\n\nСейчас в списке: ${blockedChannels.length} записей`)) {
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
        modal.className = 'fh-modal';
        modal.id = 'fh-watched-modal';
        modal.innerHTML = `
            <div class="fh-modal-content">
                <div class="fh-modal-header">
                    <h2>👁️ Просмотренные видео</h2>
                    <button class="fh-modal-close">×</button>
                </div>
                <div class="fh-modal-actions">
                    <button class="fh-btn" id="fh-clear-watched" style="background: #ff4444;">🗑️ Очистить список</button>
                    <button class="fh-btn" id="fh-import-history" style="background: #ff9800;">📥 Импорт из истории</button>
                </div>
                <input type="file" id="fh-file-input" accept=".csv,.txt" style="display: none;">
                <ul class="fh-ignored-list" id="fh-watched-list"></ul>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.fh-modal-close').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal('fh-watched-modal');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal('fh-watched-modal');
        });

        document.getElementById('fh-clear-watched').addEventListener('click', () => {
            if (confirm(`Очистить список просмотренных?\n\nСейчас в списке: ${watchedVideos.length} записей`)) {
                watchedVideos = [];
                GM_setValue('watchedVideos', watchedVideos);
                rebuildLookups();
                filterVideos();
                updateWatchedListModal();
            }
        });

        const fileInput = document.getElementById('fh-file-input');

        document.getElementById('fh-import-history').addEventListener('click', () => {
            fileInput.click();
        });

        // Экспорт
        const exportBtn = document.createElement('button');
        exportBtn.className = 'fh-btn';
        exportBtn.style.background = '#4CAF50';
        exportBtn.textContent = '📤 Экспорт';
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
        document.querySelector('#fh-watched-modal .fh-modal-actions').appendChild(exportBtn);

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
                            title: 'Импортировано из истории',
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
                alert(`Импорт завершён!\n\nДобавлено: ${imported}\nПропущено (дубликаты): ${skipped}\nВсего просмотренных: ${watchedVideos.length}`);

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

    // ==================== Обновление содержимого модалок ====================

    function updateIgnoredListModal() {
        const list = document.getElementById('fh-ignored-list');
        const modal = document.getElementById('fh-ignored-modal');
        if (!list || !modal) return;

        modal.querySelector('h2').textContent = `📝 Игнор-лист видео (${ignoredVideos.length})`;

        if (ignoredVideos.length === 0) {
            list.innerHTML = '<div class="fh-empty-list">Список пуст</div>';
            return;
        }

        list.innerHTML = ignoredVideos.map(video => `
            <li class="fh-ignored-item">
                <div class="fh-ignored-item-title">
                    <a href="${escapeHtml(video.url)}" target="_blank">${escapeHtml(video.title)}</a>
                </div>
                <button class="fh-remove-btn" data-video-id="${escapeHtml(video.id)}">Удалить</button>
            </li>
        `).join('');

        list.querySelectorAll('.fh-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                unignoreVideo(btn.getAttribute('data-video-id'));
            });
        });
    }

    function updateBlockedChannelsModal() {
        const list = document.getElementById('fh-blocked-channels-list');
        const modal = document.getElementById('fh-blocked-channels-modal');
        if (!list || !modal) return;

        modal.querySelector('h2').textContent = `🚫 Заблокированные каналы (${blockedChannels.length})`;

        if (blockedChannels.length === 0) {
            list.innerHTML = '<div class="fh-empty-list">Список пуст</div>';
            return;
        }

        list.innerHTML = blockedChannels.map(channel => `
            <li class="fh-ignored-item">
                <div class="fh-ignored-item-title">
                    <a href="${escapeHtml(channel.url)}" target="_blank">${escapeHtml(channel.name)}</a>
                </div>
                <button class="fh-remove-btn" data-channel-name="${escapeHtml(channel.name)}">Удалить</button>
            </li>
        `).join('');

        list.querySelectorAll('.fh-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                unblockChannel(btn.getAttribute('data-channel-name'));
            });
        });
    }

    function updateWatchedListModal() {
        const list = document.getElementById('fh-watched-list');
        const modal = document.getElementById('fh-watched-modal');
        if (!list || !modal) return;

        modal.querySelector('h2').textContent = `👁️ Просмотренные видео (${watchedVideos.length})`;

        if (watchedVideos.length === 0) {
            list.innerHTML = '<div class="fh-empty-list">Список пуст</div>';
            return;
        }

        const sortedVideos = [...watchedVideos].sort((a, b) => new Date(b.date) - new Date(a.date));

        list.innerHTML = sortedVideos.slice(0, 100).map(video => `
            <li class="fh-ignored-item">
                <div class="fh-ignored-item-title">
                    <a href="${escapeHtml(video.url)}" target="_blank">${escapeHtml(video.title)}</a>
                </div>
                <button class="fh-remove-btn" data-video-id="${escapeHtml(video.code || video.id || '')}">Убрать</button>
            </li>
        `).join('');

        if (watchedVideos.length > 100) {
            list.innerHTML += `<div class="fh-empty-list">...и ещё ${watchedVideos.length - 100} видео</div>`;
        }

        list.querySelectorAll('.fh-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                unmarkAsWatched(btn.getAttribute('data-video-id'));
            });
        });
    }

    // ==================== Панель управления ====================

    function updatePanelView() {
        const body = document.getElementById('fh-panel-body');
        const btn = document.querySelector('.fh-collapse-btn');
        const expanded = panelState === 1;

        if (body) body.style.display = expanded ? 'block' : 'none';
        if (btn) {
            btn.textContent = expanded ? '▼' : '▲';
            btn.title = expanded ? 'Свернуть' : 'Развернуть';
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
        const master = document.getElementById('fh-master-toggle');
        if (!master) return;

        const on = toggleDefs.filter(t => t.get()).length;
        master.checked = on === toggleDefs.length;
        master.indeterminate = on > 0 && on < toggleDefs.length;
    }

    function createControlPanel() {
        const togglesHtml = toggleDefs.map(t => `
            <div class="fh-toggle">
                <input type="checkbox" id="${t.id}" ${t.get() ? 'checked' : ''}>
                <label for="${t.id}">${t.label}</label>
                <span class="fh-count" id="${t.countId}">0</span>
            </div>
        `).join('');

        const panel = document.createElement('div');
        panel.id = 'fh-control-panel';
        panel.innerHTML = `
            <h3>
                <span>🎬 FapHouse Filter</span>
                <button class="fh-collapse-btn">▼</button>
            </h3>
            <div id="fh-panel-body">
                <div id="fh-toggles-block">
                    <div class="fh-head-row">
                        <span>Скрыть</span>
                        <span>Скрыто</span>
                    </div>
                    <div class="fh-toggle fh-toggle_master">
                        <input type="checkbox" id="fh-master-toggle">
                        <label for="fh-master-toggle">Все</label>
                        <span class="fh-count" id="fh-cnt-total">0</span>
                    </div>
                    ${togglesHtml}
                </div>
                <div id="fh-lists-block">
                    <button class="fh-list-link" id="fh-show-ignored">Игнор видео<span id="fh-link-ignored-count">${ignoredVideos.length}</span></button>
                    <button class="fh-list-link" id="fh-show-blocked-channels">Игнор каналов<span id="fh-link-channels-count">${blockedChannels.length}</span></button>
                    <button class="fh-list-link" id="fh-show-watched">Просмотрено<span id="fh-link-watched-count">${watchedVideos.length}</span></button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        panel.querySelector('.fh-collapse-btn').addEventListener('click', (e) => {
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

        document.getElementById('fh-master-toggle').addEventListener('change', (e) => {
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

        document.getElementById('fh-show-ignored').addEventListener('click', () => openModal('fh-ignored-modal'));
        document.getElementById('fh-show-blocked-channels').addEventListener('click', () => openModal('fh-blocked-channels-modal'));
        document.getElementById('fh-show-watched').addEventListener('click', () => openModal('fh-watched-modal'));

        updateMasterToggle();
        updatePanelView();
    }

    // ==================== Наблюдатель DOM ====================

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

    // ==================== Очистка БД ====================

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

    // ==================== Инициализация ====================

    function getVideoId(thumb) {
        return thumb.getAttribute('data-id')
            || thumb.querySelector('[data-el-video-id]')?.getAttribute('data-el-video-id')
            || null;
    }

    function installIgnoreDelegate() {
        const swallow = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick'];

        swallow.forEach(type => {
            window.addEventListener(type, (e) => {
                if (e.target.closest?.('.fh-ignore-btn')) e.stopImmediatePropagation();
            }, true);
        });

        window.addEventListener('click', (e) => {
            const btn = e.target.closest?.('.fh-ignore-btn');
            if (!btn) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            const thumb = btn.closest('.thumb.tv');
            if (!thumb) return;

            const id = getVideoId(thumb);
            const title = thumb.querySelector('.t-tv')?.textContent || 'Без названия';
            const url = thumb.querySelector('.t-vl')?.getAttribute('href') || '';

            ignoreVideo(id, title, url);

            if (thumb.classList.contains('big-hover')) thumb.style.display = 'none';
            else thumb.classList.add('fh-hidden');
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();