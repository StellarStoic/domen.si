// Global variables to track current state
let navigationStack = []; // Stack to track navigation history
let currentInterests = []; // Current level being displayed
// The podcast list currently on the board, if any: a podcast opened from it steps back to it.
let podcastBoardContext = null;
// The path down to the cube in the panel, by name: the breadcrumb used to print one
// arrow glyph per level, and in this font that glyph reads as the digit 4.
let interestTrail = [];

// ── the board as a surface you can move ───────────────────────────────────
// The cubes live in one layer so the board can be panned and magnified without
// dragging the panels with it. Relying on the browser's own pinch zoom does not
// work here: `body { overflow-x: hidden }` leaves the page with no horizontal
// scroll room at all, so on a phone a zoomed board can only be nudged a few
// hundred pixels vertically and then sits on black. One finger pans, two pinch,
// ctrl+wheel zooms (a trackpad pinch arrives as ctrl+wheel).
const boardView = { scale: 1, x: 0, y: 0, min: 0.5, max: 3, dragging: false };

function boardLayer() {
    const container = document.getElementById('brain-container');
    if (!container) return null;
    let layer = container.querySelector(':scope > .board-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'board-layer';
        container.insertBefore(layer, container.firstChild);
    }
    return layer;
}

/** Keep the board covering its container: no drifting onto empty black. */
function clampBoardView() {
    const container = document.getElementById('brain-container');
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const scaledWidth = width * boardView.scale;
    const scaledHeight = height * boardView.scale;

    if (scaledWidth <= width) {
        boardView.x = (width - scaledWidth) / 2;
    } else {
        boardView.x = Math.min(0, Math.max(width - scaledWidth, boardView.x));
    }
    if (scaledHeight <= height) {
        boardView.y = (height - scaledHeight) / 2;
    } else {
        boardView.y = Math.min(0, Math.max(height - scaledHeight, boardView.y));
    }
}

function applyBoardView() {
    const layer = boardLayer();
    if (!layer) return;
    clampBoardView();
    layer.style.transformOrigin = '0 0';
    layer.style.transform = `translate(${boardView.x}px, ${boardView.y}px) scale(${boardView.scale})`;
    // At 1:1 a drag over the board should still scroll the page; once the board is
    // magnified it owns the gesture, or the page scrolls instead of the board moving.
    const zoomed = boardView.scale > 1.001;
    layer.style.touchAction = zoomed ? 'none' : 'pan-y';
    let chip = document.querySelector('#brain-container .board-zoom');
    if (!chip) {
        ensureZoomControl();
        chip = document.querySelector('#brain-container .board-zoom');
    }
    if (chip) {
        chip.hidden = !zoomed && !boardView.pinching;
        chip.textContent = `${Math.round(boardView.scale * 100)} %`;
        chip.title = 'Nazaj na 100 %';
    }
}

/** A control, not only a gesture: whatever happens to the pinch, this resets. */
function ensureZoomControl() {
    const container = document.getElementById('brain-container');
    if (!container || container.querySelector('.board-zoom')) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-zoom';
    chip.hidden = true;
    chip.setAttribute('aria-label', 'Ponastavi povečavo na 100 %');
    chip.addEventListener('click', event => {
        event.stopPropagation();
        resetBoardView();
    });
    // the board's own touch handlers must not eat the finger that lands on the chip
    chip.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
    chip.addEventListener('touchend', event => event.stopPropagation(), { passive: true });
    container.appendChild(chip);
}

function resetBoardView() {
    boardView.scale = 1;
    boardView.x = 0;
    boardView.y = 0;
    applyBoardView();
}

/** Zoom about a point in container coordinates, so it stays under the finger. */
function zoomBoardAt(clientX, clientY, factor) {
    const container = document.getElementById('brain-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pointX = clientX - rect.left;
    const pointY = clientY - rect.top;
    const next = Math.min(boardView.max, Math.max(boardView.min, boardView.scale * factor));
    if (next === boardView.scale) return;
    // the board point under the cursor must not move while the scale changes
    boardView.x = pointX - (pointX - boardView.x) * (next / boardView.scale);
    boardView.y = pointY - (pointY - boardView.y) * (next / boardView.scale);
    boardView.scale = next;
    applyBoardView();
}

function setupBoardPanZoom() {
    const container = document.getElementById('brain-container');
    if (!container || container.dataset.panZoom === 'on') return;
    container.dataset.panZoom = 'on';
    ensureZoomControl();

    let suppressClick = false;
    let touchMode = null;            // 'pan' | 'pinch'
    let start = null;
    let pinch = null;

    const point = touch => ({ x: touch.clientX, y: touch.clientY });
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const onTouchStart = event => {
        if (!event.touches.length) return;
        // A touch that starts on a view or the panel is not the board's business.
        if (event.target.closest('.polistat-view, .feed-view, .day86400-view, .pod-inspector-view, .xdeleter-view, .keytool-view, .keymaker-view, .open-eyes-view, .knjige-view, .nips-view, .verify-view, .lncheck-view, .radio-view')) return;
        if (event.touches.length === 1) {
            touchMode = 'pan';
            start = { point: point(event.touches[0]), x: boardView.x, y: boardView.y };
        } else {
            touchMode = 'pinch';
            const [a, b] = event.touches;
            pinch = {
                distance: distance(point(a), point(b)),
                middle: middle(point(a), point(b)),
                scale: boardView.scale,
                x: boardView.x,
                y: boardView.y,
            };
        }
        suppressClick = false;
    };

    const onTouchMove = event => {
        if (touchMode === 'pan' && event.touches.length === 1 && start) {
            if (boardView.scale <= 1.001) return;   // at 1:1 the page scrolls, not the board
            const now = point(event.touches[0]);
            const dx = now.x - start.point.x;
            const dy = now.y - start.point.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) suppressClick = true;
            boardView.x = start.x + dx;
            boardView.y = start.y + dy;
            applyBoardView();
            event.preventDefault();
        } else if (touchMode === 'pinch' && pinch && event.touches.length >= 2) {
            const [a, b] = event.touches;
            const spread = distance(point(a), point(b));
            const where = middle(point(a), point(b));
            const next = Math.min(boardView.max,
                Math.max(boardView.min, pinch.scale * (spread / Math.max(1, pinch.distance))));
            // keep the point that was between the fingers between the fingers
            const rect = container.getBoundingClientRect();
            const pointX = pinch.middle.x - rect.left;
            const pointY = pinch.middle.y - rect.top;
            boardView.x = (where.x - rect.left) - (pointX - pinch.x) * (next / pinch.scale);
            boardView.y = (where.y - rect.top) - (pointY - pinch.y) * (next / pinch.scale);
            boardView.scale = next;
            applyBoardView();
            suppressClick = true;
            event.preventDefault();
        }
    };

    const onTouchEnd = () => {
        touchMode = null;
        start = null;
        pinch = null;
        // the click caused by the gesture arrives immediately; anything later is a real tap
        window.setTimeout(() => { suppressClick = false; }, 350);
    };

    const onMouseDown = event => {
        if (event.button !== 0) return;
        if (event.target.closest('.polistat-view, .feed-view, .day86400-view, .pod-inspector-view, .xdeleter-view, .keytool-view, .keymaker-view, .open-eyes-view, .knjige-view, .nips-view, .verify-view, .lncheck-view, .radio-view, .podcast-board')) return;
        start = { point: { x: event.clientX, y: event.clientY }, x: boardView.x, y: boardView.y };
        boardView.dragging = false;
        const onMove = moveEvent => {
            const dx = moveEvent.clientX - start.point.x;
            const dy = moveEvent.clientY - start.point.y;
            if (!boardView.dragging && Math.hypot(dx, dy) > 4) boardView.dragging = true;
            if (!boardView.dragging) return;
            boardView.x = start.x + dx;
            boardView.y = start.y + dy;
            applyBoardView();
        };
        const onUp = () => {
            suppressClick = boardView.dragging;
            boardView.dragging = false;
            start = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const onWheel = event => {
        // a trackpad pinch arrives as ctrl+wheel; a plain wheel keeps scrolling the page
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoomBoardAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    };

    // a drag must not end by opening the cube it started on
    container.addEventListener('click', event => {
        // the control is inside this container; a pinch must not make it untappable
        if (event.target.closest('.board-zoom')) {
            suppressClick = false;
            return;
        }
        if (!suppressClick) return;
        suppressClick = false;
        event.stopPropagation();
        event.preventDefault();
    }, true);

    // Safari does not honour touch-action for pinch: it zooms the page and leaves the
    // board unpannable behind it, which is a state with no way out but a reload.
    let gestureBase = null;
    const onGestureStart = event => {
        event.preventDefault();
        gestureBase = { scale: boardView.scale, x: boardView.x, y: boardView.y };
    };
    const onGestureChange = event => {
        event.preventDefault();
        if (!gestureBase) return;
        const rect = container.getBoundingClientRect();
        const next = Math.min(boardView.max,
            Math.max(boardView.min, gestureBase.scale * (event.scale || 1)));
        const midX = (event.clientX || rect.left + rect.width / 2) - rect.left;
        const midY = (event.clientY || rect.top + rect.height / 2) - rect.top;
        boardView.x = midX - (midX - gestureBase.x) * (next / gestureBase.scale);
        boardView.y = midY - (midY - gestureBase.y) * (next / gestureBase.scale);
        boardView.scale = next;
        applyBoardView();
    };
    const onGestureEnd = event => {
        event.preventDefault();
        gestureBase = null;
    };
    container.addEventListener('gesturestart', onGestureStart);
    container.addEventListener('gesturechange', onGestureChange);
    container.addEventListener('gestureend', onGestureEnd);

    // two quick taps on empty board space also return to 100 %
    let lastTap = 0;
    const onTapEnd = event => {
        if (event.touches.length) return;
        if (event.target.closest('.cube, .back-button, .board-zoom')) { lastTap = 0; return; }
        const now = Date.now();
        if (now - lastTap < 320) {
            resetBoardView();
            lastTap = 0;
        } else {
            lastTap = now;
        }
    };
    container.addEventListener('touchend', onTapEnd, { passive: true });

    // desktop: Escape or 0 resets, so a zoomed board is never a trap there either
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' || event.key === '0') {
            if (boardView.scale !== 1) {
                resetBoardView();
                event.preventDefault();
            }
        }
    });

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('wheel', onWheel, { passive: false });
    // a double click on empty board space is the quick way back out
    container.addEventListener('dblclick', event => {
        if (event.target.closest('.cube, .back-button, .polistat-view, .feed-view, .day86400-view, .pod-inspector-view, .xdeleter-view, .keytool-view, .keymaker-view, .open-eyes-view, .knjige-view, .nips-view, .verify-view, .lncheck-view, .radio-view, .day86400-view')) return;
        resetBoardView();
    });
    window.addEventListener('resize', applyBoardView);
}
let activeGalleryImages = []; // Images currently shown in the lightbox
let activeGalleryIndex = 0; // Selected lightbox image index
let sintraPriceSocket = null; // Active Sintra WebSocket used for live Bitcoin prices.
let latestBitcoinPrices = {}; // Latest Sintra prices keyed by lowercase currency code.
let selectedBitcoinCurrency = 'eur'; // Currency currently displayed in the Bitcoin price cube.

// Define the currencies supplied by Sintra and the symbols shown in the price panel.
const bitcoinCurrencies = {
    usd: { code: 'USD', symbol: '$', locale: 'en-US' },
    eur: { code: 'EUR', symbol: '€', locale: 'de-DE' },
    gbp: { code: 'GBP', symbol: '£', locale: 'en-GB' },
    cad: { code: 'CAD', symbol: 'C$', locale: 'en-CA' },
    aud: { code: 'AUD', symbol: 'A$', locale: 'en-AU' }
};

// Initialize the portfolio
async function initPortfolio() {
    await loadInterestsData();
    await refreshBitcoinMetrics();
    renderBrain();
    setupBoardPanZoom();
    setupEventListeners();
    connectSintraPriceStream();

    // Refresh slower-changing network data without rebuilding the current cube layout.
    window.setInterval(refreshBitcoinMetrics, 60000);
}

// Find an interest anywhere in the loaded tree by its stable id.
function findInterestById(interests, targetId) {
    for (const interest of interests || []) {
        if (interest.id === targetId) {
            return interest;
        }

        const nestedInterest = findInterestById(interest.subInterests, targetId);
        if (nestedInterest) {
            return nestedInterest;
        }
    }

    return null;
}

// Format large network hashrates using the most readable SI unit.
function formatHashrate(hashesPerSecond) {
    const units = [
        { value: 1e18, label: 'EH/s' },
        { value: 1e15, label: 'PH/s' },
        { value: 1e12, label: 'TH/s' }
    ];
    const unit = units.find(candidate => hashesPerSecond >= candidate.value) || units[units.length - 1];

    return `${(hashesPerSecond / unit.value).toFixed(0)} ${unit.label}`;
}

// Resize a live metric cube after its text changes without changing its saved position.
function resizeMetricCube(cube) {
    const isVertical = cube.dataset.orientation === 'vertical';
    const currentPosition = {
        x: parseFloat(cube.style.left),
        y: parseFloat(cube.style.top)
    };

    // Measure the updated label horizontally, then apply that length to the active orientation.
    cube.dataset.orientation = 'horizontal';
    cube.style.width = 'max-content';
    cube.style.height = '50px';
    const measuredTextWidth = Math.ceil(cube.getBoundingClientRect().width);
    cube.dataset.orientation = isVertical ? 'vertical' : 'horizontal';
    cube.style.width = `${isVertical ? 50 : measuredTextWidth}px`;
    cube.style.height = `${isVertical ? measuredTextWidth : 50}px`;

    const container = document.getElementById('brain-container');
    const boundedPosition = clampPositionToContainer(
        currentPosition,
        cube.offsetWidth,
        cube.offsetHeight,
        { width: container.clientWidth, height: container.clientHeight }
    );
    cube.style.left = `${boundedPosition.x}px`;
    cube.style.top = `${boundedPosition.y}px`;

    // The label changed, so the box did too, and a box that grew out of a 50px square can now sit
    // on the cube next to it. Move this one rather than repaint the whole board around it.
    const spans = occupiedSpans(cube);
    if (checkRectangleCollisionPixels(boundedPosition, cube.offsetWidth, cube.offsetHeight, spans)) {
        const spot = findFreeSpot(cube.offsetWidth, cube.offsetHeight, spans, boardBox());
        if (spot.exact) {
            cube.style.left = `${Math.round(spot.position.x)}px`;
            cube.style.top = `${Math.round(spot.position.y)}px`;
        } else {
            repackLevel(Array.from(boardLayer().querySelectorAll('.cube')), {gapped: false});
        }
    }
}

// Update one metric in memory and on its visible cube without recreating the layout.
function updateBitcoinMetric(metricId, name, description) {
    const interest = findInterestById(interestsData.mainInterests, metricId);
    if (!interest) {
        return;
    }

    interest.name = name;
    interest.description = description;

    const visibleCube = document.querySelector(`.cube[data-id="${metricId}"]`);
    if (visibleCube) {
        visibleCube.textContent = name;
        resizeMetricCube(visibleCube);

        // Save any boundary adjustment so returning to this level restores the same position.
        interest.cubeLayout = {
            orientation: visibleCube.dataset.orientation,
            x: parseFloat(visibleCube.style.left),
            y: parseFloat(visibleCube.style.top)
        };
    }
}

// Format and display the currently selected Sintra currency in the cube and open panel.
function updateBitcoinPriceDisplay() {
    const currency = bitcoinCurrencies[selectedBitcoinCurrency];
    const price = latestBitcoinPrices[selectedBitcoinCurrency];

    if (!currency || !Number.isFinite(price)) {
        return;
    }

    const formattedPrice = new Intl.NumberFormat(currency.locale, {
        style: 'currency',
        currency: currency.code,
        maximumFractionDigits: 0
    }).format(price);

    updateBitcoinMetric(
        'bitcoin-price',
        `PRICE ${formattedPrice}`,
        `One Bitcoin currently costs approximately ${formattedPrice}. Live price data is provided by Sintra.`
    );

    // Refresh the visible price text without rebuilding the rest of the information panel.
    const infoContent = document.getElementById('info-content');
    if (infoContent.dataset.interestId === 'bitcoin-price') {
        infoContent.querySelector('h3').textContent = `PRICE ${formattedPrice}`;
        infoContent.querySelector('.description').textContent =
            `One Bitcoin currently costs approximately ${formattedPrice}. Live price data is provided by Sintra.`;

        infoContent.querySelectorAll('.currency-button').forEach(button => {
            button.classList.toggle('is-active', button.dataset.currency === selectedBitcoinCurrency);
        });
    }
}

// Render controls for every currency available in Sintra's live price event.
function renderBitcoinCurrencyControls() {
    return `
        <section class="currency-selector" aria-label="Select Bitcoin price currency">
            <span class="currency-selector__label">Currency:</span>
            <div class="currency-selector__buttons">
                ${Object.entries(bitcoinCurrencies).map(([key, currency]) => `
                    <button
                        class="currency-button${key === selectedBitcoinCurrency ? ' is-active' : ''}"
                        type="button"
                        data-currency="${key}"
                        aria-label="Show Bitcoin price in ${currency.code}"
                        title="${currency.code}"
                    >${currency.symbol}</button>
                `).join('')}
            </div>
        </section>
    `;
}

// Connect price-panel currency buttons to the live Bitcoin cube.
function setupBitcoinCurrencyControls(root) {
    root.querySelectorAll('.currency-button').forEach(button => {
        button.addEventListener('click', () => {
            selectedBitcoinCurrency = button.dataset.currency;
            updateBitcoinPriceDisplay();
        });
    });
}

// Convert feed-provided HTML descriptions into safe readable plain text.
// Podcast names and artwork URLs come from the OPML export, so they are escaped before they reach
// markup — an ampersand in a show's title must not break the row it sits in.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getPlainTextFromHtml(html) {
    const documentFragment = new DOMParser().parseFromString(html || '', 'text/html');
    return documentFragment.body.textContent.replace(/\s+/g, ' ').trim();
}

// Extract a podcast-level description from common RSS and Atom feed elements.
function getPodcastDescriptionFromFeed(feedText) {
    const feedDocument = new DOMParser().parseFromString(feedText, 'application/xml');
    if (feedDocument.querySelector('parsererror')) {
        throw new Error('The podcast feed is not valid XML');
    }

    const channel = feedDocument.querySelector('channel');
    const rawDescription = channel?.querySelector(':scope > description')?.textContent
        || channel?.getElementsByTagName('itunes:summary')[0]?.textContent
        || feedDocument.querySelector('feed > subtitle')?.textContent
        || feedDocument.querySelector('feed > description')?.textContent;

    return getPlainTextFromHtml(rawDescription);
}

// Ask the reader for one feed's channel description.
//
// The reader is the only path that works for the majority of these shows (their hosts refuse a
// browser by CORS), so it is tried first here rather than last: a direct fetch that succeeds but
// carries no description used to leave the panel saying "unavailable" while the reader had one.
async function podcastDescriptionFromReader(feedUrl) {
    const reader = window.podcastFeedView?.reader?.() || 'https://feeds.domen.si';
    const response = await fetch(`${reader}/feed?url=${encodeURIComponent(feedUrl)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
        // The reader names what went wrong — "the feed answered HTTP 410", "the feed could not be
        // reached" — and that sentence is worth more to a reader than "unavailable".
        throw new Error(payload?.error || `the reader answered HTTP ${response.status}`);
    }
    return {
        description: getPlainTextFromHtml(payload.feed?.description),
        title: String(payload.feed?.title || '').trim(),
    };
}

// Load a podcast's own description when its panel is opened, and say why if there is none.
//
// Three outcomes, and the panel used to show the same sentence for all of them: the feed answers and
// describes itself, the feed answers but publishes no description of its own, or the feed cannot be
// read at all. Measured over the 100 subscriptions in the OPML, 88 carry a description, two are dead
// (HTTP 404/410), three refuse Tor exits, and the rest answer on a second try — so a failure is
// usually worth one retry rather than being remembered as permanent.
async function loadPodcastDescription(interest, root) {
    if (!interest.feedUrl) {
        return;
    }

    const descriptionElement = root.querySelector('.description');
    if (interest.podcastDescriptionLoaded) {
        descriptionElement.textContent = interest.description;
        return;
    }

    let description = '';
    let failure = '';
    let title = '';

    // The reader first: it is the only route that works for most of these hosts.
    try {
        const fromReader = await podcastDescriptionFromReader(interest.feedUrl);
        description = fromReader.description;
        title = fromReader.title;
    } catch (readerError) {
        failure = readerError.message;
        // And the direct fetch second, for a host that likes browsers but not the reader's exit node.
        try {
            const direct = await fetch(interest.feedUrl);
            if (!direct.ok) throw new Error(`the feed answered HTTP ${direct.status}`);
            description = getPodcastDescriptionFromFeed(await direct.text());
            failure = '';
        } catch (directError) {
            failure = failure || directError.message;
        }
    }

    let shown;
    if (description) {
        shown = description;
        interest.description = description;
        interest.podcastDescriptionLoaded = true;
    } else if (failure) {
        // Not cached: a timeout or a blocked exit node is not a property of the show, so the next
        // visit asks again instead of repeating tonight's bad luck forever.
        shown = `${title || interest.name} cannot be read right now — ${failure}. `
            + 'Press RSS Feed to try again, or use the RSS link in the list.';
        interest.podcastDescriptionLoaded = false;
    } else {
        shown = `${title || interest.name} does not describe itself in its feed. `
            + 'Its episodes and their own descriptions are under RSS Feed.';
        interest.podcastDescriptionLoaded = true;
    }

    interest.description = shown;
    if (root.dataset.interestId === interest.id) {
        descriptionElement.textContent = shown;
    }
}

// Connect to Sintra's static-site-friendly WebSocket for live Bitcoin prices.
function connectSintraPriceStream() {
    if (sintraPriceSocket && sintraPriceSocket.readyState < WebSocket.CLOSING) {
        return;
    }

    sintraPriceSocket = new WebSocket('wss://api.sintra.fi/ws');

    sintraPriceSocket.addEventListener('message', event => {
        try {
            const message = JSON.parse(event.data);
            const prices = message?.data?.prices;

            if (message.event !== 'data' || !prices) {
                return;
            }

            // Keep only supported numeric prices before updating the selected display.
            latestBitcoinPrices = Object.fromEntries(
                Object.keys(bitcoinCurrencies)
                    .filter(currency => Number.isFinite(prices[currency]))
                    .map(currency => [currency, prices[currency]])
            );
            updateBitcoinPriceDisplay();
        } catch (error) {
            console.error('Error reading the Sintra price stream:', error);
        }
    });

    sintraPriceSocket.addEventListener('close', () => {
        // Reconnect after temporary network interruptions without reloading the page.
        window.setTimeout(connectSintraPriceStream, 5000);
    });

    sintraPriceSocket.addEventListener('error', () => {
        sintraPriceSocket.close();
    });
}

// Load block height and hashrate from mempool.space independently.
async function refreshBitcoinMetrics() {
    const metricRequests = [
        fetch('https://mempool.space/api/blocks/tip/height')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Block-height API returned HTTP ${response.status}`);
                }
                return response.text();
            })
            .then(height => {
                const parsedHeight = Number.parseInt(height, 10);
                if (!Number.isInteger(parsedHeight)) {
                    throw new Error('Block-height API returned an invalid value');
                }

                const formattedHeight = new Intl.NumberFormat('en-US').format(parsedHeight);
                updateBitcoinMetric(
                    'bitcoin-block-height',
                    `BLOCK ${formattedHeight}`,
                    `The latest confirmed Bitcoin block is ${formattedHeight}. Block data is provided by mempool.space and refreshed every minute.`
                );
            }),
        fetch('https://mempool.space/api/v1/mining/hashrate/3d')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Hashrate API returned HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!Number.isFinite(data.currentHashrate)) {
                    throw new Error('Hashrate API returned an invalid value');
                }

                const formattedHashrate = formatHashrate(data.currentHashrate);
                updateBitcoinMetric(
                    'bitcoin-hashrate',
                    `HASHRATE ${formattedHashrate}`,
                    `The estimated Bitcoin network hashrate is ${formattedHashrate}. Hashrate data is provided by mempool.space and refreshed every minute.`
                );
            })
    ];

    // Keep successful metrics visible even if one network endpoint is temporarily unavailable.
    const results = await Promise.allSettled(metricRequests);
    results.forEach(result => {
        if (result.status === 'rejected') {
            console.error('Error loading a Bitcoin metric:', result.reason);
        }
    });
}

// Treat missing visible values as public, while accepting boolean or string false.
function isInterestVisible(interest) {
    if (interest.visible === undefined) {
        return true;
    }

    if (typeof interest.visible === 'string') {
        return interest.visible.toLowerCase() !== 'false';
    }

    return interest.visible !== false;
}

// Return only the interests that should be rendered as cubes or listed in the panel.
function getVisibleInterests(interests) {
    return (interests || []).filter(isInterestVisible);
}

// Render the main brain shape with cubes
function renderBrain() {
    const container = document.getElementById('brain-container');
    // The board rebuilds its cubes by clearing this container, which would take the feed view with it and
    // leave the dimming class behind — the cubes came back at 8 % opacity with nothing on top of them.
    // Closing here means the state always matches the board, whichever door the reader left by.
    window.xdeleterView?.close?.();
    window.keytoolView?.close?.();
    window.keymakerView?.close?.();
    // OPEN YOUR EYES: the video view covers the container exactly as the others do.
    window.openEyesView?.close?.();
    window.knjigeView?.close?.();
    window.nipsView?.close?.();
    window.verifyDownloadView?.close?.();
    window.lnCheckView?.close?.();
    // RADIO EXPLORER: reads and curates radio-browser.info.
    window.radioView?.close?.();
    window.podcastFeedView?.close?.();
    window.polistatView?.close?.();
    window.day86400View?.close?.();
    window.podInspectorView?.close?.();
    window.contactGateView?.close?.();
    podcastBoardContext = null;
    container.innerHTML = ''; // Clear container
    resetBoardView();

    // Start with main interests
    currentInterests = getVisibleInterests(interestsData.mainInterests);

    // Decide whether to use mobile mode (narrow screens).
    // mobileRandom === true -> place cubes randomly (with collision avoidance) even on mobile.
    // This ensures cubes are not left unpositioned when grid-mode was removed.
    const mobileRandom = window.innerWidth <= 768;

    // Create cubes for each main interest
    currentInterests.forEach((interest, index) => {
        // pass the mobileRandom flag through the createCube call via the depth param (we'll accept extra arg)
        // NOTE: next code change modifies createCube signature to accept mobileRandom.
        const cube = createCube(interest, index, false, null, 0, mobileRandom);
        boardLayer().appendChild(cube);
    });

    // The render is not finished until the board is provably clear: placement per cube cannot see
    // a cube that is added after it, so the level is checked as a whole.
    ensureNoOverlaps();
    initShakeToMix();
}

// Keep a position fully inside the brain container, including a visible edge margin.
function clampPositionToContainer(position, cubeWidth, cubeHeight, containerRect) {
    const margin = 10;
    const maxX = Math.max(margin, containerRect.width - cubeWidth - margin);
    const maxY = Math.max(margin, containerRect.height - cubeHeight - margin);

    return {
        x: Math.max(margin, Math.min(maxX, position.x)),
        y: Math.max(margin, Math.min(maxY, position.y))
    };
}

// ── Where a cube may sit ────────────────────────────────────────────────────────────────
// One engine decides it, and it is the only code allowed to. Three things used to overlap
// cubes: a saved layout was restored with no collision check at all (a position remembered on a
// wide screen was clamped into a narrow one, straight on top of a neighbour), the "container is
// full" branch deliberately stacked cubes diagonally, and a metric cube resized itself after it
// had been placed. Nothing here guesses: a cube either gets a spot that the collision test
// accepts, or the whole level is repacked, and packing a level cannot overlap by construction.

const CUBE_GAP = 8;        // enforced gap between cubes, in board pixels
const EDGE_MARGIN = 10;    // kept clear at the container's edges

function boardBox() {
    const container = document.getElementById('brain-container');
    return {width: container.clientWidth, height: container.clientHeight};
}

function cubeSpan(cube) {
    return {
        width: Math.ceil(cube.offsetWidth) || 50,
        height: Math.ceil(cube.offsetHeight) || 30
    };
}

// Measured from the elements, never from remembered numbers: a cube's real size depends on its
// own text, so the style attributes and the rendered box disagree often enough to matter.
function occupiedSpans(exclude = null) {
    const layer = boardLayer();
    const spans = [];
    for (const cube of layer.querySelectorAll('.cube')) {
        if (cube === exclude) continue;
        const x = parseFloat(cube.style.left);
        const y = parseFloat(cube.style.top);
        if (Number.isNaN(x) || Number.isNaN(y)) continue;
        spans.push({x, y, ...cubeSpan(cube)});
    }
    return spans;
}

function overlapsAny(position, width, height, spans) {
    return checkRectangleCollisionPixels(position, width, height, spans);
}

// Try random spots, then a fine grid scan. `exact` says whether the answer is genuinely free.
function findFreeSpot(width, height, spans, box) {
    const maxX = Math.max(EDGE_MARGIN, box.width - width - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, box.height - height - EDGE_MARGIN);

    for (let attempt = 0; attempt < 400; attempt++) {
        const position = {
            x: EDGE_MARGIN + Math.random() * Math.max(0, maxX - EDGE_MARGIN),
            y: EDGE_MARGIN + Math.random() * Math.max(0, maxY - EDGE_MARGIN)
        };
        if (!overlapsAny(position, width, height, spans)) return {position, exact: true};
    }

    for (let y = EDGE_MARGIN; y <= maxY; y += 6) {
        for (let x = EDGE_MARGIN; x <= maxX; x += 6) {
            const position = {x, y};
            if (!overlapsAny(position, width, height, spans)) return {position, exact: true};
        }
    }

    // Nothing free at this size. The caller repacks the level rather than stacking this cube on
    // top of something — an overlapping board reads as a rendering fault.
    return {position: {x: EDGE_MARGIN, y: EDGE_MARGIN}, exact: false};
}

function getRandomNonOverlappingPosition(cubeWidth, cubeHeight, containerRect, existingPositions = null) {
    const spans = existingPositions || occupiedSpans();
    const box = containerRect || boardBox();
    return findFreeSpot(cubeWidth, cubeHeight, spans, box).position;
}

// Shelf packing: rows as tall as their tallest cube. It cannot overlap, and it is the guaranteed
// answer when the container is too small for a scatter.
function packSpans(spans, boxWidth, gap) {
    const rows = [];
    let row = null;
    for (const span of spans) {
        const needed = row ? row.width + gap + span.width : span.width;
        if (row && needed > boxWidth - EDGE_MARGIN * 2) {
            rows.push(row);
            row = null;
        }
        if (!row) {
            row = {spans: [], width: span.width, height: span.height};
            rows.push(row);
        } else {
            row.width += gap + span.width;
            row.height = Math.max(row.height, span.height);
        }
        row.spans.push(span);
    }
    const height = rows.reduce((total, current, index) => total + current.height + (index ? gap : 0), 0);
    const width = rows.reduce((widest, current) => Math.max(widest, current.width), 0);
    return {rows, height, width};
}

function fitPacking(spans, box) {
    // Tighten the gap before anything is allowed outside the container.
    for (const gap of [CUBE_GAP, 6, 4, 2, 1]) {
        const packed = packSpans(spans, box.width, gap);
        if (packed.height <= box.height - EDGE_MARGIN) return {...packed, gap};
    }
    return {...packSpans(spans, box.width, 1), gap: 1};
}

// Repack every cube of the current level. Used when a level is genuinely too crowded for a
// scatter, and by the shake, which asks for a fresh arrangement outright.
function repackLevel(cubes, {gapped = true} = {}) {
    const box = boardBox();
    const entries = cubes.map(cube => ({cube, ...cubeSpan(cube)}));
    const packed = fitPacking(entries, box);
    const gap = packed.gap;

    let y = EDGE_MARGIN;
    for (const row of packed.rows) {
        // a row is laid out from the left, with a small jitter so it does not read as a table
        let x = EDGE_MARGIN + (gapped ? Math.random() * Math.max(0, box.width - row.width - EDGE_MARGIN * 2) : 0);
        for (const span of row.spans) {
            span.cube.style.left = `${Math.round(x)}px`;
            span.cube.style.top = `${Math.round(y + (row.height - span.height) / 2)}px`;
            x += span.width + gap;
        }
        y += row.height + gap;
    }
    // A board taller than its container is reached by the board's own pan, so nothing is lost.
    const layer = boardLayer();
    layer.style.minHeight = `${Math.max(box.height, Math.ceil(y - gap + EDGE_MARGIN))}px`;
    saveVisibleLayouts();
    return packed;
}

function saveVisibleLayouts() {
    const layer = boardLayer();
    for (const cube of layer.querySelectorAll('.cube')) {
        const id = cube.dataset.id;
        if (!id) continue;
        const interest = findInterestById(currentInterests, id) || findInterestById(interestsData.mainInterests, id);
        if (!interest) continue;
        interest.cubeLayout = {
            orientation: cube.dataset.orientation || 'horizontal',
            x: parseFloat(cube.style.left),
            y: parseFloat(cube.style.top)
        };
    }
}

// Do any two cubes of this level actually overlap on screen? Measured, because the placement code
// believing it succeeded is exactly what was wrong before.
function overlappingPairs(cubes) {
    const pairs = [];
    for (let i = 0; i < cubes.length; i += 1) {
        const a = cubes[i];
        const ax = parseFloat(a.style.left);
        const ay = parseFloat(a.style.top);
        const as = cubeSpan(a);
        for (let j = i + 1; j < cubes.length; j += 1) {
            const b = cubes[j];
            const bx = parseFloat(b.style.left);
            const by = parseFloat(b.style.top);
            const bs = cubeSpan(b);
            if (ax < bx + bs.width && ax + as.width > bx && ay < by + bs.height && ay + as.height > by) {
                pairs.push([a.dataset.id || a.textContent, b.dataset.id || b.textContent]);
            }
        }
    }
    return pairs;
}

// The last thing every level render does: move the fewest cubes that make the board clear.
//
// A whole-level repack is the last resort, not the first answer. Cubes are restored from layouts
// remembered on an earlier visit, and a container that has since changed size (a phone rotated, an
// info panel opened) makes one of them collide after clamping — repacking all of them for that one
// cube shuffles a board the reader had already arranged and expects to find again.
function ensureNoOverlaps() {
    const cubes = Array.from(boardLayer().querySelectorAll('.cube'));
    if (cubes.length < 2) return [];

    const overlapPairs = overlappingPairs(cubes);
    if (!overlapPairs.length) return [];

    const box = boardBox();
    const accepted = [];
    let moved = 0;
    let stuck = false;

    for (const cube of cubes) {
        const span = cubeSpan(cube);
        const position = {x: parseFloat(cube.style.left), y: parseFloat(cube.style.top)};
        if (!overlapsAny(position, span.width, span.height, accepted)) {
            accepted.push({x: position.x, y: position.y, ...span});
            continue;
        }
        const spot = findFreeSpot(span.width, span.height, accepted, box);
        if (!spot.exact) {
            stuck = true;
            break;
        }
        cube.style.left = `${Math.round(spot.position.x)}px`;
        cube.style.top = `${Math.round(spot.position.y)}px`;
        accepted.push({x: spot.position.x, y: spot.position.y, ...span});
        moved += 1;
    }

    if (stuck) {
        repackLevel(cubes, {gapped: false});
        return overlapPairs;
    }
    if (moved) saveVisibleLayouts();
    return overlapPairs;
}

// Reposition rendered cubes after the brain container changes width or height.
function repositionVisibleCubes() {
    const container = document.getElementById('brain-container');
    const cubes = Array.from(container.querySelectorAll('.cube'));
    const containerRect = {
        width: container.clientWidth,
        height: container.clientHeight
    };
    const placedPositions = [];

    // Place each existing cube against only the cubes already repositioned in this pass.
    cubes.forEach(cube => {
        const cubeWidth = cube.offsetWidth;
        const cubeHeight = cube.offsetHeight;
        const position = getRandomNonOverlappingPosition(
            cubeWidth,
            cubeHeight,
            containerRect,
            placedPositions
        );

        cube.style.left = `${position.x}px`;
        cube.style.top = `${position.y}px`;
        placedPositions.push({
            ...position,
            width: cubeWidth,
            height: cubeHeight
        });
    });
}


// Create a cube element with pixel-perfect collision detection
// ---------------------- REPLACE createCube(...) ----------------------
/*
  createCube(interest, index, isSubCube = false, parentPosition = null, depth = 0, mobileRandom = false)
  - mobileRandom: when true, treat mobile the same as desktop and place cubes via random non-overlapping pixels.
  - Returns a DOM element with width/height and left/top set.
*/
function createCube(interest, index, isSubCube = false, parentPosition = null, depth = 0, mobileRandom = false) {
    const cube = document.createElement('div');
    cube.className = 'cube';
    cube.textContent = interest.name;
    cube.dataset.id = interest.id;
    cube.dataset.depth = depth;
    cube.dataset.interestIndex = index;

    // Mark live-data cubes so their changing values are visually identifiable.
    if (interest.metric) {
        cube.classList.add('metric-cube');
    }

    // Choose an orientation once and reuse it whenever this interest is rendered again.
    const savedLayout = interest.cubeLayout;
    const useVertical = savedLayout
        ? savedLayout.orientation === 'vertical'
        : interest.name.length <= 4 || Math.random() > 0.7;
    cube.dataset.orientation = useVertical ? 'vertical' : 'horizontal';
    cube.style.width = 'max-content';
    cube.style.height = '50px';
    cube.style.visibility = 'hidden';

    // Measure horizontally first so vertical cubes can use the text length as their height.
    cube.dataset.orientation = 'horizontal';
    const container = document.getElementById('brain-container');
    container.appendChild(cube);
    const measuredTextWidth = Math.ceil(cube.getBoundingClientRect().width);
    cube.remove();

    // Horizontal cubes grow in width; vertical cubes grow in height.
    const cubeWidth = useVertical ? 50 : measuredTextWidth;
    const cubeHeight = useVertical ? measuredTextWidth : 50;
    cube.dataset.orientation = useVertical ? 'vertical' : 'horizontal';
    cube.style.width = `${cubeWidth}px`;
    cube.style.height = `${cubeHeight}px`;
    cube.style.visibility = '';

    // Read the actual inner container dimensions used by the placement algorithm.
    const containerRect = {
        width: container.clientWidth,
        height: container.clientHeight
    };

    // ---------- POSITIONING LOGIC ----------
    // If this is a sub-cube and a parent position is provided, try to place near parent using collision avoidance.
    // Otherwise, place randomly inside container using collision avoidance.
    // MobileRandom forces random placement on small screens too (fixes blank mobile result).
    if (savedLayout) {
        // A remembered position is a hint, not an instruction: it was measured on whatever screen
        // the level was first opened on, so restoring it unchecked is how cubes ended up stacked on
        // a narrow one. Keep it when it is still free, otherwise place this cube properly.
        const saved = clampPositionToContainer(
            {x: savedLayout.x, y: savedLayout.y},
            cubeWidth,
            cubeHeight,
            containerRect
        );
        const free = !checkRectangleCollisionPixels(saved, cubeWidth, cubeHeight, getExistingCubePositionsPixels());
        if (free) {
            cube.style.left = `${saved.x}px`;
            cube.style.top = `${saved.y}px`;
        } else {
            const spot = getRandomNonOverlappingPosition(cubeWidth, cubeHeight, containerRect);
            cube.style.left = `${spot.x}px`;
            cube.style.top = `${spot.y}px`;
        }
    } else {
        // Root cubes, and sub-cubes that carry no remembered position, are scattered with the
        // collision test on. The parent no longer matters for placement: a cube placed close to its
        // parent but on top of a sibling is worse than one placed across the board.
        const spot = getRandomNonOverlappingPosition(cubeWidth, cubeHeight, containerRect);
        cube.style.left = `${spot.x}px`;
        cube.style.top = `${spot.y}px`;
    }

    // Remember the generated layout on the interest object for future visits.
    interest.cubeLayout = {
        orientation: useVertical ? 'vertical' : 'horizontal',
        x: parseFloat(cube.style.left),
        y: parseFloat(cube.style.top)
    };

    // Scale and depth visual tweaks - unchanged
    if (interest.color === 'orange' && depth === 0) {
        cube.classList.add('orange');
    }
    
    if (depth > 3) {
        cube.style.opacity = `${1 - (depth * 0.1)}`;
    }
    
    if (interest.url) {
        cube.dataset.hasUrl = "true";
    }

    // Keep the matching sub-interest list item highlighted while hovering the cube.
    cube.addEventListener('mouseenter', () => {
        const listItem = document.querySelector(`.sub-interest-item[data-interest-index="${index}"]`);
        listItem?.classList.add('is-highlighted');
    });

    cube.addEventListener('mouseleave', () => {
        const listItem = document.querySelector(`.sub-interest-item[data-interest-index="${index}"]`);
        listItem?.classList.remove('is-highlighted');
    });

    // Show information first; visitors can open external sources from the information panel.
    cube.addEventListener('click', (event) => {
        event.stopPropagation();

        // A podcast root has no sub-cubes but still opens something on the board itself: its list.
        // POLISTAT has no sub-cubes either: its board view is the chart, and pressing the
        // cube should land on it rather than on a panel with a button to press next.
        const opensBoardView = (Array.isArray(interest.podcastList) && interest.podcastList.length > 0)
            || interest.stats === 'polistat'
            || interest.stats === 'day86400'
            || interest.stats === 'podInspector'
            || interest.stats === 'contactGate'
            || interest.stats === 'xdeleter'
            || interest.stats === 'keytool'
            || interest.stats === 'keymaker'
            || interest.stats === 'openEyes'
            || interest.stats === 'knjige'
            || interest.stats === 'nips'
            || interest.stats === 'verifyDownload'
            || interest.stats === 'lnCheck'
            || interest.stats === 'radioExplorer';

        if (opensBoardView || getVisibleInterests(interest.subInterests).length > 0) {
            // Get current position in pixels for navigation (if not set this will produce NaN)
            // but we always set left/top now so parseFloat should be valid.
            const currentX = parseFloat(cube.style.left);
            const currentY = parseFloat(cube.style.top);
            handleCubeClick(interest, { x: currentX, y: currentY }, depth);
        } else {
            showInfoPanel(interest, depth);
        }
    });

    return cube;
}


// PIXEL-BASED collision detection
function checkRectangleCollisionPixels(position, width, height, existingPositions) {
    for (const existing of existingPositions) {
        // Add collision buffer (5px gap between cubes)
        const buffer = 5;
        
        const horizontalOverlap = position.x < existing.x + existing.width + buffer && 
                                 position.x + width + buffer > existing.x;
        
        const verticalOverlap = position.y < existing.y + existing.height + buffer && 
                               position.y + height + buffer > existing.y;
        
        if (horizontalOverlap && verticalOverlap) {
            return true; // Collision detected
        }
    }
    return false; // No collision
}


// PIXEL-BASED boundary checking
function isWithinContainerPixels(position, width, height, containerRect) {
    const margin = 10;
    return position.x >= margin &&
           position.x <= (containerRect.width - margin - width) &&
           position.y >= margin &&
           position.y <= (containerRect.height - margin - height);
}

// Get positions of all existing cubes in PIXELS
function getExistingCubePositionsPixels() {
    const cubes = document.querySelectorAll('.cube');
    const positions = [];
    const container = document.getElementById('brain-container');
    const containerRect = container.getBoundingClientRect();
    
    cubes.forEach(cube => {
        const x = parseFloat(cube.style.left);
        const y = parseFloat(cube.style.top);
        const width = parseInt(cube.style.width) || 40;
        const height = parseInt(cube.style.height) || 40;
        
        if (!isNaN(x) && !isNaN(y)) {
            positions.push({ 
                x, 
                y, 
                width, 
                height
            });
        }
    });
    
    return positions;
}

// Enhanced collision detection with depth awareness, considers cube sizes and dynamic minimum distance
function checkCollision(position, existingPositions, minDistance) {
    for (const existingPos of existingPositions) {
        const distance = Math.sqrt(
            Math.pow(position.x - existingPos.x, 2) + 
            Math.pow(position.y - existingPos.y, 2)
        );
        
        // Much more conservative minimum distance
        const sizeFactor = Math.max(
            (existingPos.width || 40) / 30,  // Increased divisor
            (existingPos.height || 40) / 30
        );
        const effectiveMinDistance = minDistance * sizeFactor * 1.2; // Added multiplier
        
        if (distance < effectiveMinDistance) {
            return true;
        }
    }
    return false;
}

// function to avoid parent position
// Update createBackCube to use PIXELS
function createBackCube(parentPosition, depth) {
    const backCube = document.createElement('div');
    backCube.className = 'cube orange';
    backCube.textContent = 'BACK';
    
    // Set fixed size for back cube
    backCube.style.width = '50px';
    backCube.style.height = '30px';
    
    // Get container and existing positions in PIXELS
    const container = document.getElementById('brain-container');
    const containerRect = container.getBoundingClientRect();
    const existingPositions = getExistingCubePositionsPixels();
    
    const backWidth = 50;
    const backHeight = 30;
    
    let backPosition;

    // Convert parent position to pixels if needed
    const parentXPixels = typeof parentPosition.x === 'string' ? 
        (parseFloat(parentPosition.x) / 100) * containerRect.width : parentPosition.x;
    const parentYPixels = typeof parentPosition.y === 'string' ? 
        (parseFloat(parentPosition.y) / 100) * containerRect.height : parentPosition.y;
    
    // BACK is placed by the same engine as everything else. Its old ring-around-the-parent search
    // walked itself into a corner and then took whatever position it had reached, which on a full
    // board meant sitting on a cube; a control that hides another cube is worse than one placed far
    // from the parent.
    const backSpot = getRandomNonOverlappingPosition(
        backWidth,
        backHeight,
        {width: container.clientWidth, height: container.clientHeight},
        existingPositions
    );
    backPosition = backSpot;
    
    backCube.style.left = `${backPosition.x}px`;
    backCube.style.top = `${backPosition.y}px`;
    
    // Scale back button based on depth
    const scale = Math.max(0.7, 1 - (depth * 0.05));
    backCube.style.transform = `scale(${scale})`;
    backCube.style.fontSize = `${1 * scale}rem`;
    backCube.style.zIndex = '50';
    
    backCube.addEventListener('click', (event) => {
        event.stopPropagation();
        goBack();
    });
    
    return backCube;
}

// ── Shake the phone, mix the board ───────────────────────────────────────────────────────
// On a phone the board is a scatter, and a scatter the reader cannot rearrange is a lottery: the
// one cube they want can end up under the thumb. A shake now repacks the level with a fresh
// arrangement — the same engine, so nothing overlaps afterwards.
//
// Android and desktop browsers hand out `devicemotion` without asking. iOS 13+ requires
// `DeviceMotionEvent.requestPermission()`, which only works inside a user gesture, so the request
// is made on the first touch or click and the feature simply starts working once it is granted; if
// it is refused, nothing is broken and nothing is nagged about.
const shakeState = {last: 0, hits: [], enabled: false, cooldownMs: 1200};
const SHAKE_THRESHOLD = 22;        // m/s² of acceleration change, well above handling the phone
const SHAKE_HITS_REQUIRED = 2;     // a deliberate shake, not one bump against a table
const SHAKE_WINDOW_MS = 700;

function boardCubes() {
    return Array.from(boardLayer().querySelectorAll('.cube'));
}

// Mix the current level: forget where these cubes were, then place them again.
function mixCubes({save = true} = {}) {
    const cubes = boardCubes();
    if (!cubes.length) return 0;
    for (const cube of cubes) {
        const id = cube.dataset.id;
        if (!id) continue;
        const interest = findInterestById(currentInterests, id)
            || findInterestById(interestsData.mainInterests, id);
        if (interest && interest.cubeLayout) delete interest.cubeLayout;
    }
    // Scatter first, exactly as a fresh level is placed; a level too crowded to scatter is packed.
    const placed = [];
    const box = boardBox();
    for (const cube of cubes) {
        const span = cubeSpan(cube);
        const spot = findFreeSpot(span.width, span.height, placed, box);
        if (!spot.exact) {
            repackLevel(cubes, {gapped: true});
            if (save) saveVisibleLayouts();
            return cubes.length;
        }
        cube.style.left = `${Math.round(spot.position.x)}px`;
        cube.style.top = `${Math.round(spot.position.y)}px`;
        placed.push({x: spot.position.x, y: spot.position.y, ...span});
    }
    if (save) saveVisibleLayouts();
    return cubes.length;
}

function shakeMagnitude(event) {
    const acceleration = event.acceleration || event.accelerationIncludingGravity;
    if (!acceleration) return 0;
    const {x = 0, y = 0, z = 0} = acceleration;
    // gravity is included on some devices; the magnitude of the change is what a shake looks like
    return Math.hypot(x, y, z);
}

function handleMotion(event) {
    if (!shakeState.enabled) return;
    const magnitude = shakeMagnitude(event);
    if (magnitude < SHAKE_THRESHOLD) return;
    const now = Date.now();
    if (now - shakeState.last < shakeState.cooldownMs) return;
    shakeState.hits = shakeState.hits.filter(stamp => now - stamp <= SHAKE_WINDOW_MS);
    shakeState.hits.push(now);
    if (shakeState.hits.length < SHAKE_HITS_REQUIRED) return;
    shakeState.hits = [];
    shakeState.last = now;
    if (mixCubes() > 0) flashBoard();
}

// A short nudge so the reader knows the shake was heard and not merely survived.
function flashBoard() {
    const layer = boardLayer();
    layer.classList.remove('is-mixed');
    // restart the animation even when two shakes arrive inside one animation
    void layer.offsetWidth;
    layer.classList.add('is-mixed');
    window.setTimeout(() => layer.classList.remove('is-mixed'), 420);
}

async function requestShakePermission() {
    if (shakeState.enabled) return true;
    const api = window.DeviceMotionEvent;
    if (!api) return false;
    if (typeof api.requestPermission === 'function') {
        try {
            const answer = await api.requestPermission();
            shakeState.enabled = answer === 'granted';
        } catch {
            shakeState.enabled = false;
        }
        return shakeState.enabled;
    }
    shakeState.enabled = true;
    return true;
}

// Reachable for tests and for a desktop check: the shake is the phone's door to it, not the only
// one. `boardShuffle.mix()` mixes the level on screen and returns how many cubes moved.
// In-view BACK controls call this. The board's BACK cube sits at z-index 50 and a view covers the board at
// 60, so a view that fills the container has to offer its own way out — and it must leave through the same
// function the cube uses, or BACK would close the view without the board knowing.
window.goBack = goBack;

window.boardShuffle = {
    mix: mixCubes,
    heading: () => Array.from(boardLayer().querySelectorAll('.cube'))
        .map(cube => ({id: cube.dataset.id, x: parseFloat(cube.style.left), y: parseFloat(cube.style.top)})),
    overlaps: () => overlappingPairs(boardCubes())
};

function initShakeToMix() {
    if (!window.DeviceMotionEvent) return;
    window.addEventListener('devicemotion', handleMotion, {passive: true});
    // Android and most desktop browsers need no permission at all.
    requestShakePermission();
    // iOS: the request has to sit inside a gesture, so it is attached to the first one.
    const ask = () => {
        requestShakePermission().then(granted => {
            if (granted) window.removeEventListener('touchend', ask);
        });
    };
    window.addEventListener('touchend', ask, {once: false, passive: true});
    window.addEventListener('click', ask, {passive: true});
}

// Handle cube clicks with depth tracking
function handleCubeClick(interest, position, depth) {
    // Show info in panel regardless of sub-interests
    showInfoPanel(interest, depth);

    // A podcast root has no cubes to show: the subscriptions take the board over as one list, which is
    // still a step into the board, so BACK returns to the cubes as it does everywhere else.
    if (Array.isArray(interest.podcastList) && interest.podcastList.length > 0) {
        openPodcastList(interest, position, depth);
        return;
    }

    // The numbers this site keeps itself are the cube's content: pressing it draws them.
    if (interest.stats === 'polistat') {
        window.polistatView?.open?.();
        return;
    }

    // 86400 is a view as well: the CZ bulletin and the last day of police reporting.
    if (interest.stats === 'day86400') {
        window.day86400View?.open?.();
        return;
    }

    // The Pod Inspector is a tool, not a link: pressing it opens the input and the code view.
    if (interest.stats === 'podInspector') {
        window.podInspectorView?.open?.();
        return;
    }

    // NIPS: the mirrored repository — the explainer on the board, the two indexes in the panel.
    if (interest.stats === 'nips') {
        window.nipsView?.open?.(interest);
        return;
    }

    // VERIFY: check a download against its signature and manifest, entirely in the browser.
    if (interest.stats === 'verifyDownload') {
        window.verifyDownloadView?.open?.(interest);
        return;
    }

    // LN CHECK: read an invoice, an lnurl or a Lightning address.
    if (interest.stats === 'lnCheck') {
        window.lnCheckView?.open?.(interest);
        return;
    }

    // RADIO EXPLORER: search radio-browser.info, play what the browser can play, curate the directory.
    if (interest.stats === 'radioExplorer') {
        window.radioView?.open?.(interest);
        return;
    }

    // THE GATE: a small game whose prize is the contact address, which the cube carries.
    if (interest.stats === 'contactGate') {
        window.contactGateView?.open?.(interest);
        return;
    }

    // XDELETER: the archive planner. It deletes nothing itself — it hands over the script that does.
    if (interest.stats === 'xdeleter') {
        window.xdeleterView?.open?.(interest);
        return;
    }

    // KEYTOOL: the key converter. It is the one view that handles a secret, so it clears itself on close.
    if (interest.stats === 'keytool') {
        window.keytoolView?.open?.(interest);
        return;
    }

    // KEY MAKER: create keys, optionally locked with a password. Nothing it makes outlives the panel.
    if (interest.stats === 'keymaker') {
        window.keymakerView?.open?.(interest);
        return;
    }

    // OPEN YOUR EYES: the recordings list takes the board, and each recording plays in it.
    if (interest.stats === 'knjige') {
        window.knjigeView?.open?.(interest, depth);
        return;
    }
    if (interest.stats === 'openEyes') {
        window.openEyesView?.open?.(interest, depth);
        return;
    }

    // If the interest has sub-interests, navigate deeper
    if (getVisibleInterests(interest.subInterests).length > 0) {
        navigateToSubInterests(interest, position, depth);
    }
}

// Navigate to sub-interests of a cube
function navigateToSubInterests(interest, parentPosition, parentDepth) {
    const container = document.getElementById('brain-container');
    
    // Save current state to navigation stack
    navigationStack.push({
        interests: currentInterests,
        parentPosition: parentPosition,
        depth: parentDepth
    });
    
    // Update current interests
    currentInterests = getVisibleInterests(interest.subInterests);
    
    // Clear container
    container.innerHTML = '';
    

    // Create sub-interest cubes first so BACK can avoid their final positions.
    currentInterests.forEach((subInterest, index) => {
        const cube = createCube(subInterest, index, true, parentPosition, parentDepth + 1);
        boardLayer().appendChild(cube);
    });

    // Place BACK only after all interest cubes participate in its collision check.
    const backCube = createBackCube(parentPosition, parentDepth);
    boardLayer().appendChild(backCube);
    ensureNoOverlaps();
}

// Go back to previous level
// The list is a level of the board, so anything that steps back onto it must find it drawn. The episode
// view lives inside the container and a rebuild clears the container, which is how the panel could show
// the list while the board showed cubes.
function ensurePodcastListOnBoard() {
    if (!podcastBoardContext) {
        return false;
    }
    const container = document.getElementById('brain-container');
    if (container.querySelector('.podcast-board')) {
        return true;
    }
    if (currentInterests.length > 0) {
        return false;
    }
    container.appendChild(buildPodcastListBoard(podcastBoardContext.interest, podcastBoardContext.depth));
    return true;
}

/**
 * The overlays added most recently. BACK leaves whichever is open before anything else happens, and
 * keeping them in one place means goBack() stays short enough for the board tests to read it.
 */
function leaveNewestOverlays() {
    // OPEN YOUR EYES steps out of a recording before it steps out of the view, so it is the one overlay
    // whose BACK can be spent without closing anything — the shell stays, showing the list again.
    if (window.openEyesView?.isOpen?.()) {
        const shell = document.querySelector('#brain-container .open-eyes-view');
        const wasOnScreen = !!shell && !shell.hidden;
        if (!wasOnScreen) {
            window.openEyesView.close();
        } else if (window.openEyesView.back()) {
            return true;
        }
    }

    for (const [view, selector] of [
        ['knjigeView', '#brain-container .knjige-view'],
        ['nipsView', '#brain-container .nips-view'],
        ['verifyDownloadView', '#brain-container .verify-view'],
        ['lnCheckView', '#brain-container .lncheck-view'],
        ['radioView', '#brain-container .radio-view'],
        ['keymakerView', '#brain-container .keymaker-view'],
        ['keytoolView', '#brain-container .keytool-view'],
        ['xdeleterView', '#brain-container .xdeleter-view'],
    ]) {
        const overlay = window[view];
        if (!overlay?.isOpen?.()) continue;
        const shell = document.querySelector(selector);
        const wasOnScreen = !!shell && !shell.hidden;
        overlay.close();
        if (wasOnScreen) return true;
    }
    return false;
}

function goBack() {
    // the two newest overlays first: BACK leaves whatever covers the container before it navigates
    if (leaveNewestOverlays()) {
        return;
    }

    // THE GATE covers the container like the other views, so BACK leaves it first.
    if (window.contactGateView?.isOpen?.()) {
        const shell = document.querySelector('#brain-container .contact-gate-view');
        const wasOnScreen = !!shell && !shell.hidden;
        window.contactGateView.close();
        if (wasOnScreen) {
            return;
        }
    }

    // The Pod Inspector covers the container like the other views, so BACK leaves it first.
    if (window.podInspectorView?.isOpen?.()) {
        const shell = document.querySelector('#brain-container .pod-inspector-view');
        const wasOnScreen = !!shell && !shell.hidden;
        window.podInspectorView.close();
        if (wasOnScreen) {
            return;
        }
    }

    // 86400 and POLISTAT cover the whole container, so whichever is open is the topmost layer and
    // BACK has to leave it before the press can mean anything else.
    if (window.day86400View?.isOpen?.()) {
        const shell = document.querySelector('#brain-container .day86400-view');
        const wasOnScreen = !!shell && !shell.hidden;
        window.day86400View.close();
        if (wasOnScreen) {
            return;
        }
    }

    // POLISTAT covers the whole container, so it is the topmost layer when it is open, and BACK
    // has to leave it before it can mean anything else.
    if (window.polistatView?.isOpen?.()) {
        const shell = document.querySelector('#brain-container .polistat-view');
        const wasOnScreen = !!shell && !shell.hidden;
        window.polistatView.close();
        if (wasOnScreen) {
            return;
        }
    }




    // The episode view is the topmost thing on the board. Stepping back closes it and leaves the list,
    // the panel and the scroll position where the reader left them — it used to pop the navigation
    // stack instead, which threw the reader onto the homepage cubes *and* left the board dimmed with
    // the cubes refusing the pointer, because nothing had closed the view.
    if (window.podcastFeedView?.isOpen?.()) {
        // A board rebuild can take the episode view's shell out of the document while the view still
        // believes it is open. Closing it then changes nothing on screen, so this press has to step back
        // for real instead of being spent on a view that is not there.
        const shell = document.querySelector('#brain-container .feed-view');
        const wasOnScreen = !!shell && !shell.hidden;
        window.podcastFeedView.close();
        if (wasOnScreen) {
            return;
        }
    }

    // A podcast opened from the list steps back to that list: the panel names it AND the board draws it,
    // because a panel showing the list over a board of cubes is not a step back — it is two disagreeing
    // halves of one screen.
    // Membership, not a prefix: an opaque `startsWith('podcast-')` test also matched the OPML cell
    // itself (whose id used to be `podcast-opml`), so BACK from the list redrew the list forever.
    const shownInterestId = document.getElementById('info-content')?.dataset.interestId || '';
    const shownIsOneOfTheList = !!podcastBoardContext
        && Array.isArray(podcastBoardContext.interest?.podcastList)
        && podcastBoardContext.interest.podcastList.some(entry => entry.id === shownInterestId);
    if (shownIsOneOfTheList) {
        ensurePodcastListOnBoard();
        showInfoPanel(podcastBoardContext.interest, podcastBoardContext.depth);
        return;
    }

    // At the root level, BACK closes the open information panel.
    if (navigationStack.length === 0) {
        podcastBoardContext = null;
        hideInfoPanel();
        return;
    }

    if (navigationStack.length > 0) {
        const previousState = navigationStack.pop();
        const container = document.getElementById('brain-container');
        
        currentInterests = previousState.interests;
        

        // Clear container
        container.innerHTML = '';
        resetBoardView();

        // Check if we're at the root level
        if (navigationStack.length === 0) {
            podcastBoardContext = null;
            // Recreate main brain
            currentInterests.forEach((interest, index) => {
                const cube = createCube(interest, index, false, null, 0);
                boardLayer().appendChild(cube);
                            });
            ensureNoOverlaps();
            // Hide info panel when back at root level
            hideInfoPanel();
        } else {
            // We're at a sub-level, recreate previous sub-interests
            // Recreate interest cubes first using their saved positions.
            currentInterests.forEach((interest, index) => {
                const cube = createCube(
                    interest, 
                    index, 
                    true, 
                    previousState.parentPosition, 
                    previousState.depth
                );
                boardLayer().appendChild(cube);
            });

            // Recalculate BACK after restored cubes exist, preventing any overlap.
            const backCube = createBackCube(
                previousState.parentPosition,
                previousState.depth
            );
            boardLayer().appendChild(backCube);
            ensureNoOverlaps();
            
            // Update info panel for the parent interest
            if (navigationStack.length > 0) {
                const parentState = navigationStack[navigationStack.length - 1];
                const parentInterest = parentState.interests.find(interest => 
                    interest.subInterests === currentInterests
                );
                if (parentInterest) {
                    showInfoPanel(parentInterest, previousState.depth);
                }
            }
        }
    }
}

// Show information in the side panel with depth indicator
// The podcast subscriptions as one list, A to Z. Each row is a button onto that podcast's own panel.
// The subscriptions as one list inside the cubes container — the board is where a cube leads, so the
// list takes the board over rather than squeezing into the panel beside it. Built as an element so the
// rows can carry their own listeners; names and artwork come from the OPML and are escaped.
function buildPodcastListBoard(interest, depth) {
    const board = document.createElement('div');
    board.className = 'podcast-board';
    board.innerHTML = `
        <div class="podcast-board__head">
            <strong>${escapeHtml(interest.name)} — ${interest.podcastList.length} podcasts, A to Z</strong>
            <span class="podcast-board__hint">A name opens its description, RSS feed and episodes</span>
            <button type="button" class="podcast-board__back">← BACK</button>
        </div>
        <ol class="podcast-board__items">
            ${interest.podcastList.map((podcast, index) => `
                <li class="podcast-board__item" data-podcast-index="${index}" tabindex="0" role="button">
                    ${podcast.imageUrl
                        ? `<img class="podcast-board__art" src="${escapeHtml(podcast.imageUrl)}" alt="" loading="lazy">`
                        : ''}
                    <span class="podcast-board__name">${escapeHtml(podcast.name)}</span>
                </li>
            `).join('')}
        </ol>`;

    board.querySelectorAll('.podcast-board__item').forEach(item => {
        const podcast = interest.podcastList[Number(item.dataset.podcastIndex)];
        if (!podcast) {
            return;
        }
        // The panel is where the podcast's own description, RSS Feed link and Episodes button live.
        const openPodcast = () => showInfoPanel(podcast, depth + 1);
        item.addEventListener('click', openPodcast);
        item.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                // Space would scroll the list instead of activating the row.
                event.preventDefault();
                openPodcast();
            }
        });
    });

    // BACK is part of the list, not a cube floating over it: the board's BACK cube has z-index 50 and
    // would paint above the list (and above the episode view), which is exactly what D found annoying.
    board.querySelector('.podcast-board__back')?.addEventListener('click', () => goBack());

    // Artwork in the OPML can be stale or blocked; drop it rather than leaving a broken icon in every
    // row, exactly as the podcast panel already does for its own cover.
    board.querySelectorAll('.podcast-board__art').forEach(image => {
        image.addEventListener('error', () => image.remove());
    });

    return board;
}

// Take the board over with the list. The navigation stack entry is the same shape a sub-interest level
// pushes, so the BACK cube and goBack() need no special case.
function openPodcastList(interest, position, depth) {
    const container = document.getElementById('brain-container');
    navigationStack.push({
        interests: currentInterests,
        parentPosition: position,
        depth: depth
    });

    podcastBoardContext = { interest, depth };
    currentInterests = [];
    container.innerHTML = '';
    // No BACK cube here: the list carries its own BACK in the header. The cube version floats over the
    // list (and over the episode view) and read as clutter.
    container.appendChild(buildPodcastListBoard(interest, depth));
}

function showInfoPanel(interest, depth) {
    const infoPanel = document.getElementById('info-panel');
    const infoContent = document.getElementById('info-content');
    const visibleSubInterests = getVisibleInterests(interest.subInterests);
    infoContent.dataset.interestId = interest.id;
    
    // Create clickable breadcrumb navigation, by name
    interestTrail[depth] = interest.name;
    interestTrail.length = depth + 1;
    let breadcrumb = '<span class="breadcrumb-item" data-depth="0">ROOT</span>';
    for (let level = 0; level < depth; level += 1) {
        const label = escapeHtml(interestTrail[level] || '');
        if (!label) continue;
        breadcrumb += ` > <span class="breadcrumb-item" data-depth="${level + 1}">${label}</span>`;
    }
    
    infoContent.innerHTML = `
        <div class="breadcrumb">${breadcrumb}</div>
        <h3>${interest.name}</h3>
        ${interest.imageUrl ?
            `<img class="podcast-artwork" src="${interest.imageUrl}" alt="${interest.name} podcast artwork" loading="lazy">` :
            ''
        }
        <p class="description">${interest.description}</p>
        ${interest.metadata ? `<p class="interest-metadata">${interest.metadata}</p>` : ''}
        <div class="depth-indicator">Depth: ${depth + 1}</div>
        ${interest.url ? 
            `<a href="${interest.url}" target="_blank" rel="noopener noreferrer" class="article-link">Visit Source</a>` :
            ''
        }
        ${interest.feedUrl ?
            // The raw feed stays exactly what it always was: a link to the XML in a new tab. Episodes is
            // the new door — the feed read and drawn here, where the cubes are.
            `<a href="${interest.feedUrl}" target="_blank" rel="noopener noreferrer" class="article-link article-link--secondary">RSS Feed</a>` +
            `<button type="button" class="article-link feed-episodes">Episodes</button>` :
            ''
        }
        ${interest.id === 'bitcoin-price' ? renderBitcoinCurrencyControls() : ''}
        ${interest.gallery ? renderGallery(interest.gallery) : ''}
        ${Array.isArray(interest.podcastList) && interest.podcastList.length > 0
            ? `<p class="leaf-node">↳ ${interest.podcastList.length} subscriptions, listed A to Z on the board.</p>`
            : visibleSubInterests.length > 0
                ? `<div class="sub-interests">
                    <strong>Contains ${visibleSubInterests.length} visible sub-interests:</strong>
                    <ul>
                        ${visibleSubInterests.map((subInterest, index) => `
                            <li class="sub-interest-item" data-interest-index="${index}" tabindex="0" role="button">
                                ${subInterest.name}
                            </li>
                        `).join('')}
                    </ul>
                </div>`
                : '<p class="leaf-node">↳ This is a leaf node (no further sub-interests)</p>'
        }
    `;
    // Add click event listeners to breadcrumb items
    const breadcrumbItems = infoContent.querySelectorAll('.breadcrumb-item');
    breadcrumbItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetDepth = parseInt(item.dataset.depth);
            navigateToDepth(targetDepth);
        });
    });

    // Make each list item highlight and activate the same cube shown in the brain.
    infoContent.querySelectorAll('.sub-interest-item').forEach(item => {
        const interestIndex = item.dataset.interestIndex;
        const getMatchingCube = () => document.querySelector(`.cube[data-interest-index="${interestIndex}"]`);

        item.addEventListener('mouseenter', () => {
            getMatchingCube()?.classList.add('is-highlighted');
        });

        item.addEventListener('mouseleave', () => {
            getMatchingCube()?.classList.remove('is-highlighted');
        });

        item.addEventListener('focus', () => {
            getMatchingCube()?.classList.add('is-highlighted');
        });

        item.addEventListener('blur', () => {
            getMatchingCube()?.classList.remove('is-highlighted');
        });

        item.addEventListener('click', () => {
            getMatchingCube()?.click();
        });

        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                // Prevent Space from scrolling while activating the selected sub-interest.
                event.preventDefault();
                getMatchingCube()?.click();
            }
        });
    });


    // Episodes opens the feed where the cubes are: the list, each episode's description, its times and
    // a player that starts where a pressed time says. The address is handed over as data, never built
    // into the markup, so a feed's own text cannot end up an attribute here.
    infoContent.querySelector('.feed-episodes')?.addEventListener('click', event => {
        if (!window.podcastFeedView?.open) {
            // The view module did not load (an old cached script, a blocked request). Say so rather
            // than leaving a button that does nothing when pressed.
            const note = document.createElement('p');
            note.className = 'leaf-node';
            note.textContent = 'The episode view did not load on this page. Reload the page, or use the RSS Feed link.';
            event.currentTarget.replaceWith(note);
            return;
        }
        window.podcastFeedView.open({
            name: interest.name,
            feedUrl: interest.feedUrl,
            imageUrl: interest.imageUrl,
            url: interest.url
        });
    });

    // Allow the Bitcoin price panel to switch the live cube between Sintra currencies.
    setupBitcoinCurrencyControls(infoContent);

    // Hide stale or blocked artwork URLs instead of leaving a broken image indicator.
    const podcastArtwork = infoContent.querySelector('.podcast-artwork');
    podcastArtwork?.addEventListener('error', () => {
        podcastArtwork.remove();
    });

    // Enrich podcast details on demand without delaying the initial OPML import.
    loadPodcastDescription(interest, infoContent);

    // Attach thumbnail events after the gallery HTML is added to the panel.
    setupGalleryThumbnails(infoContent, interest.gallery);
    
    infoPanel.classList.add('active');
}

// Build gallery image data from a compact JSON range definition.
function getGalleryImages(gallery) {
    if (!gallery) {
        return [];
    }

    if (gallery.files && gallery.files.length > 0) {
        // Use an explicit file list for folders with hand-picked or non-sequential images.
        return gallery.files.map((fileName, index) => ({
            src: `${gallery.path}/${fileName}`,
            alt: `${gallery.alt || 'Gallery image'} ${index + 1}`,
            caption: `${gallery.alt || 'Gallery image'} ${index + 1}`
        }));
    }

    const images = [];
    const extension = gallery.extension || 'jpg';
    const pad = gallery.pad || 0;

    for (let number = gallery.start; number <= gallery.end; number++) {
        // Create filenames like Image00001.jpg from the configured prefix and padding.
        const fileNumber = String(number).padStart(pad, '0');
        const src = `${gallery.path}/${gallery.prefix}${fileNumber}.${extension}`;
        images.push({
            src,
            alt: `${gallery.alt || 'Gallery image'} ${number}`,
            caption: `${gallery.alt || 'Gallery image'} ${number}`
        });
    }

    return images;
}

// Sort filenames by the number inside them so Image0002 appears before Image0010.
function sortImagesByFilenameCount(images) {
    return images.sort((first, second) => {
        const firstNumber = parseInt(first.src.match(/\d+/)?.[0] || '0', 10);
        const secondNumber = parseInt(second.src.match(/\d+/)?.[0] || '0', 10);

        return firstNumber - secondNumber || first.src.localeCompare(second.src);
    });
}

// Read image links from a directory listing when the server exposes one.
async function getGalleryImagesFromFolder(gallery) {
    const response = await fetch(`${gallery.path}/`);
    if (!response.ok) {
        // GitHub Pages answers 404 here: it serves no directory listing at all. A gallery with no file
        // list therefore has no images on the live site, whatever the folder holds.
        throw new Error(`folder listing not available (HTTP ${response.status})`);
    }
    const directoryHtml = await response.text();
    const directoryDocument = new DOMParser().parseFromString(directoryHtml, 'text/html');
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|avif)$/i;

    // Convert same-folder links from the directory index into gallery image records.
    const images = Array.from(directoryDocument.querySelectorAll('a'))
        .map(link => decodeURIComponent(link.getAttribute('href') || ''))
        .filter(href => imageExtensions.test(href))
        .map((href, index) => {
            const fileName = href.split('/').pop();

            return {
                src: `${gallery.path}/${fileName}`,
                alt: `${gallery.alt || 'Gallery image'} ${index + 1}`,
                caption: `${gallery.alt || 'Gallery image'} ${index + 1}`
            };
        });

    return sortImagesByFilenameCount(images);
}

// Render clickable thumbnails for a gallery-enabled interest.
function renderGallery(gallery) {
    const images = getGalleryImages(gallery);

    if (images.length === 0 && gallery.path) {
        return `
            <section class="gallery" aria-label="Image gallery" data-gallery-path="${gallery.path}">
                <h4 class="gallery__title">Gallery / loading</h4>
                <div class="gallery__grid"></div>
                <p class="gallery__status">Reading folder...</p>
            </section>
        `;
    }

    if (images.length === 0) {
        return '';
    }

    return `
        <section class="gallery" aria-label="Image gallery">
            <h4 class="gallery__title">Gallery / ${images.length} images</h4>
            <div class="gallery__grid">
                ${images.map((image, index) => `
                    <button class="gallery__thumb" type="button" data-gallery-index="${index}" aria-label="Open ${image.alt}">
                        <img src="${image.src}" alt="${image.alt}" loading="lazy">
                    </button>
                `).join('')}
            </div>
        </section>
    `;
}

// Connect rendered thumbnails to the shared lightbox controls.
async function setupGalleryThumbnails(root, gallery) {
    activeGalleryImages = getGalleryImages(gallery);

    if (gallery && gallery.path && activeGalleryImages.length === 0) {
        const galleryElement = root.querySelector('.gallery');
        const galleryGrid = root.querySelector('.gallery__grid');
        const galleryTitle = root.querySelector('.gallery__title');
        const galleryStatus = root.querySelector('.gallery__status');

        try {
            // Folder-only galleries depend on the web server exposing a directory listing.
            activeGalleryImages = gallery.files && gallery.files.length
                ? getGalleryImages(gallery)
                : await getGalleryImagesFromFolder(gallery);
            galleryGrid.innerHTML = activeGalleryImages.map((image, index) => `
                <button class="gallery__thumb" type="button" data-gallery-index="${index}" aria-label="Open ${image.alt}">
                    <img src="${image.src}" alt="${image.alt}" loading="lazy">
                </button>
            `).join('');
            galleryTitle.textContent = `Gallery / ${activeGalleryImages.length} images`;
            galleryStatus.remove();
        } catch (error) {
            galleryElement.innerHTML = '<p class="gallery__status">Folder listing is not available on this server.</p>';
            console.error('Error loading gallery folder:', error);
        }
    }

    root.querySelectorAll('.gallery__thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
            const index = parseInt(thumb.dataset.galleryIndex, 10);
            openGalleryLightbox(index);
        });
    });
}

// Show one gallery image in the full-screen lightbox.
function openGalleryLightbox(index) {
    if (activeGalleryImages.length === 0) {
        return;
    }

    activeGalleryIndex = index;
    updateGalleryLightbox();

    const lightbox = document.getElementById('gallery-lightbox');
    lightbox.classList.add('is-active');
    lightbox.setAttribute('aria-hidden', 'false');
}

// Refresh the lightbox image, alt text, and caption for the active index.
function updateGalleryLightbox() {
    const image = activeGalleryImages[activeGalleryIndex];
    const lightboxImage = document.getElementById('gallery-lightbox-image');
    const caption = document.getElementById('gallery-lightbox-caption');

    lightboxImage.src = image.src;
    lightboxImage.alt = image.alt;
    caption.textContent = `${image.caption} / ${activeGalleryIndex + 1} of ${activeGalleryImages.length}`;
}

// Move through the gallery while wrapping around at either end.
function moveGallery(step) {
    if (activeGalleryImages.length === 0) {
        return;
    }

    activeGalleryIndex = (activeGalleryIndex + step + activeGalleryImages.length) % activeGalleryImages.length;
    updateGalleryLightbox();
}

// Hide the lightbox and clear the current full-size image source.
function closeGalleryLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    const lightboxImage = document.getElementById('gallery-lightbox-image');

    lightbox.classList.remove('is-active');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImage.src = '';
}

// Function to navigate to specific depth level
function navigateToDepth(targetDepth) {
    if (targetDepth === 0) {
        // Navigate to root level
        while (navigationStack.length > 0) {
            goBack();
        }
    } else {
        // Navigate to specific depth level
        while (navigationStack.length > targetDepth) {
            goBack();
        }
    }
}

// Hide information panel
function hideInfoPanel() {
    const infoPanel = document.getElementById('info-panel');
    infoPanel.classList.remove('active');
}

/* ── Theme ──────────────────────────────────────────────────────────────────────────────────────
   style.css carries two palettes: the dark board in :root, and the white one under
   [data-theme="light"] — a white page with black cubes, white text and the orange edge. index.html
   applies the stored choice before the first paint; everything here flips it afterwards and keeps
   the control's own label honest, because a button that says "WHITE THEME" while the board is
   already white is worse than no button. */
const THEME_STORAGE_KEY = 'domen:theme';

function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function renderThemeControl(theme) {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const next = theme === 'light' ? 'dark' : 'light';
    button.textContent = next === 'light' ? 'WHITE THEME' : 'DARK THEME';
    button.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    button.setAttribute('aria-label', 'Switch to the ' + next + ' theme');
    button.title = 'Switch to the ' + next + ' theme';
}

function applyTheme(theme) {
    // Dark is the palette's own :root, so it is the absence of the attribute rather than a second block.
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) { /* private mode: the choice lasts the session, which is the honest behaviour */ }
    renderThemeControl(theme);
}

function toggleTheme() {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
}

// Set up event listeners
function setupEventListeners() {
    const backButton = document.getElementById('back-button');
    backButton.addEventListener('click', goBack);

    renderThemeControl(currentTheme());
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

    const galleryClose = document.getElementById('gallery-close');
    const galleryPrev = document.getElementById('gallery-prev');
    const galleryNext = document.getElementById('gallery-next');
    const galleryLightbox = document.getElementById('gallery-lightbox');

    // Reflow cubes when responsive layout changes alter the brain dimensions.
    window.addEventListener('resize', repositionVisibleCubes);

    // Wire shared gallery controls once because the thumbnails change with the active interest.
    galleryClose.addEventListener('click', closeGalleryLightbox);
    galleryPrev.addEventListener('click', () => moveGallery(-1));
    galleryNext.addEventListener('click', () => moveGallery(1));
    galleryLightbox.addEventListener('click', (event) => {
        if (event.target === galleryLightbox) {
            closeGalleryLightbox();
        }
    });
    
    // Add keyboard navigation support
    document.addEventListener('keydown', (event) => {
        const lightboxOpen = document.getElementById('gallery-lightbox').classList.contains('is-active');

        if (lightboxOpen && event.key === 'Escape') {
            closeGalleryLightbox();
            return;
        }

        if (lightboxOpen && event.key === 'ArrowLeft') {
            moveGallery(-1);
            return;
        }

        if (lightboxOpen && event.key === 'ArrowRight') {
            moveGallery(1);
            return;
        }

        if (event.key === 'Escape' && navigationStack.length > 0) {
            goBack();
        }
    });
    
    // Add click outside support to close deep navigation
    document.addEventListener('click', (event) => {
        if (navigationStack.length > 0 && !event.target.closest('.cube')) {
            // Optional: Add behavior for clicking outside cubes
        }
    });
}

// Utility function to visualize the entire tree structure (for debugging)
function visualizeTree(interests, depth = 0) {
    let output = '';
    const indent = '  '.repeat(depth);
    
    interests.forEach(interest => {
        // Hidden interests are skipped from the debug tree just like the visible UI.
        if (!isInterestVisible(interest)) {
            return;
        }

        output += `${indent}${interest.name} (Depth: ${depth})\n`;
        if (interest.subInterests) {
            output += visualizeTree(getVisibleInterests(interest.subInterests), depth + 1);
        }
    });
    
    return output;
}


// Initialize when page loads
/**
 * Keep --brain-height equal to the board's real height.
 *
 * The side panel scrolls inside a box no taller than the brain cell, and CSS cannot ask a sibling how
 * tall it is. A ResizeObserver on the container republishes the number whenever the board grows, the
 * window changes, or a view swaps its contents, so the panel always ends where the board ends.
 */
function publishBrainHeight() {
    const board = document.getElementById('brain-container');
    if (!board) return;
    const height = Math.round(board.getBoundingClientRect().height);
    if (height > 0) {
        document.documentElement.style.setProperty('--brain-height', `${height}px`);
    }
}

if (typeof ResizeObserver === 'function') {
    const board = document.getElementById('brain-container');
    if (board) new ResizeObserver(publishBrainHeight).observe(board);
}
window.addEventListener('resize', publishBrainHeight);
window.addEventListener('load', publishBrainHeight);

document.addEventListener('DOMContentLoaded', () => {
    publishBrainHeight();
    initPortfolio();
});

// Export functions for potential extension
window.portfolio = {
    goBack,
    navigateToSubInterests,
    getCurrentDepth: () => navigationStack.length,
    getMaxDepth: () => {
        let maxDepth = 0;
        function checkDepth(interests, currentDepth) {
            maxDepth = Math.max(maxDepth, currentDepth);
            if (interests.subInterests) {
                getVisibleInterests(interests.subInterests).forEach(sub => checkDepth(sub, currentDepth + 1));
            }
        }
        getVisibleInterests(interestsData.mainInterests).forEach(interest => checkDepth(interest, 1));
        return maxDepth;
    }
};
