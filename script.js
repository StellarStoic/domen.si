// Global variables to track current state
let navigationStack = []; // Stack to track navigation history
let currentInterests = []; // Current level being displayed
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

// Load and cache a podcast's feed description only when its information panel is opened.
async function loadPodcastDescription(interest, root) {
    if (!interest.feedUrl) {
        return;
    }

    const descriptionElement = root.querySelector('.description');
    if (interest.podcastDescriptionLoaded) {
        descriptionElement.textContent = interest.description;
        return;
    }

    try {
        let podcastDescription = '';

        try {
            // Parse xmlUrl directly when the podcast host allows browser cross-origin requests.
            const feedResponse = await fetch(interest.feedUrl);
            if (!feedResponse.ok) {
                throw new Error(`Podcast feed returned HTTP ${feedResponse.status}`);
            }

            podcastDescription = getPodcastDescriptionFromFeed(await feedResponse.text());
        } catch (directFeedError) {
            // Many podcast hosts block browser CORS, so use a CORS-enabled parser as fallback.
            const endpoint = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(interest.feedUrl)}`;
            const metadataResponse = await fetch(endpoint);
            if (!metadataResponse.ok) {
                throw new Error(`Podcast metadata API returned HTTP ${metadataResponse.status}`);
            }

            const data = await metadataResponse.json();
            podcastDescription = getPlainTextFromHtml(data.feed?.description);
            console.info(`Direct podcast feed access was unavailable for "${interest.name}".`, directFeedError);
        }

        if (!podcastDescription) {
            throw new Error('The podcast feed does not contain a description');
        }

        // Cache the description on the interest so reopening it does not repeat the request.
        interest.description = podcastDescription;
        interest.podcastDescriptionLoaded = true;

        // Avoid replacing another interest's description if the visitor navigated away mid-request.
        if (root.dataset.interestId === interest.id) {
            descriptionElement.textContent = podcastDescription;
        }
    } catch (error) {
        interest.description = 'Podcast description is unavailable. Use the source or RSS link for more information.';
        interest.podcastDescriptionLoaded = true;

        if (root.dataset.interestId === interest.id) {
            descriptionElement.textContent = interest.description;
        }
        console.error(`Error loading podcast description for "${interest.name}":`, error);
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
    container.innerHTML = ''; // Clear container

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
        container.appendChild(cube);
    });
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

// Find a bounded non-overlapping position, using a grid scan if random placement fails.
function getRandomNonOverlappingPosition(cubeWidth, cubeHeight, containerRect, existingPositions = null) {
    const margin = 10;
    const maxAttempts = 300;
    const occupiedPositions = existingPositions || getExistingCubePositionsPixels();
    const maxX = Math.max(margin, containerRect.width - cubeWidth - margin);
    const maxY = Math.max(margin, containerRect.height - cubeHeight - margin);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Choose a fully bounded random coordinate inside the container.
        const pos = {
            x: margin + Math.random() * Math.max(0, maxX - margin),
            y: margin + Math.random() * Math.max(0, maxY - margin)
        };

        // Check whether the random position collides with an already placed cube.
        const collision = checkRectangleCollisionPixels(
            pos,
            cubeWidth,
            cubeHeight,
            occupiedPositions
        );

        // Return immediately when a clean random position is available.
        if (!collision) {
            return pos;
        }
    }

    // Scan the full container so failed random attempts never stack cubes at one fallback point.
    const scanStep = 5;
    for (let y = margin; y <= maxY; y += scanStep) {
        for (let x = margin; x <= maxX; x += scanStep) {
            const pos = { x, y };

            if (!checkRectangleCollisionPixels(pos, cubeWidth, cubeHeight, occupiedPositions)) {
                return pos;
            }
        }
    }

    // When the container is genuinely full, distribute the cube within bounds instead of hiding it.
    const fallbackIndex = occupiedPositions.length;
    return clampPositionToContainer({
        x: margin + (fallbackIndex * (cubeWidth + margin)),
        y: margin + (fallbackIndex * (cubeHeight + margin))
    }, cubeWidth, cubeHeight, containerRect);
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
        // Restore the previous position so navigating away and back does not shuffle cubes.
        const savedPosition = clampPositionToContainer(
            { x: savedLayout.x, y: savedLayout.y },
            cubeWidth,
            cubeHeight,
            containerRect
        );
        cube.style.left = `${savedPosition.x}px`;
        cube.style.top = `${savedPosition.y}px`;
    } else if (isSubCube && parentPosition) {
        // Convert parent position to pixels if it's in percentage or a string
        const parentXPixels = typeof parentPosition.x === 'string' ? 
            (parseFloat(parentPosition.x) / 100) * containerRect.width : parentPosition.x;
        const parentYPixels = typeof parentPosition.y === 'string' ? 
            (parseFloat(parentPosition.y) / 100) * containerRect.height : parentPosition.y;

        // Attempt to place near parent with spiral fallback (re-uses your spiral helper)
        let finalPosition;
        let attempts = 0;
        const maxAttempts = 300;
        const existingPositions = getExistingCubePositionsPixels();

        do {
            // choose a random candidate in a hemisphere around parent for visual separation
            const useLeft = Math.random() > 0.5;
            const edgePadding = 10;
            // pick random offset from parent
            const offsetX = (Math.random() - 0.5) * containerRect.width * 0.3;
            const offsetY = (Math.random() - 0.5) * containerRect.height * 0.3;
            finalPosition = {
                x: parentXPixels + offsetX,
                y: parentYPixels + offsetY
            };

            // clamp to container
            finalPosition.x = Math.max(edgePadding, Math.min(containerRect.width - edgePadding - cubeWidth, finalPosition.x));
            finalPosition.y = Math.max(edgePadding, Math.min(containerRect.height - edgePadding - cubeHeight, finalPosition.y));

            // collision?
            const hasCollision = checkRectangleCollisionPixels(finalPosition, cubeWidth, cubeHeight, existingPositions);
            attempts++;

            if (!hasCollision) break;

            if (attempts >= maxAttempts) {
                // spiral fallback: this function already returns a safe pixel position or a random fallback
                finalPosition = getRandomNonOverlappingPosition(
                    cubeWidth,
                    cubeHeight,
                    containerRect,
                    existingPositions
                );
                break;
            }
        } while (attempts < maxAttempts);

        // Clamp the final result in case the container changed during placement.
        finalPosition = clampPositionToContainer(finalPosition, cubeWidth, cubeHeight, containerRect);
        cube.style.left = `${finalPosition.x}px`;
        cube.style.top = `${finalPosition.y}px`;
    } else {
        // Not a sub-cube (root or normal). Use random non-overlapping placement for both desktop and mobileRandom.
        // This ensures root cubes are randomly placed on mobile as you requested.
        const pos = getRandomNonOverlappingPosition(cubeWidth, cubeHeight, containerRect);
        cube.style.left = `${pos.x}px`;
        cube.style.top = `${pos.y}px`;
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

        if (getVisibleInterests(interest.subInterests).length > 0) {
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
    let attempts = 0;
    const maxAttempts = 100;
    
    // Convert parent position to pixels if needed
    const parentXPixels = typeof parentPosition.x === 'string' ? 
        (parseFloat(parentPosition.x) / 100) * containerRect.width : parentPosition.x;
    const parentYPixels = typeof parentPosition.y === 'string' ? 
        (parseFloat(parentPosition.y) / 100) * containerRect.height : parentPosition.y;
    
    // Try to position back cube away from other cubes
    do {
        // Position back cube in a ring around parent
        const angle = (attempts / maxAttempts) * 2 * Math.PI;
        const radius = 30 + (attempts * 2); // Larger radius in pixels
        
        backPosition = {
            x: parentXPixels + radius * Math.cos(angle),
            y: parentYPixels + radius * Math.sin(angle)
        };
        
        // Ensure within bounds in PIXELS
        backPosition.x = Math.max(10, Math.min(containerRect.width - 10 - backWidth, backPosition.x));
        backPosition.y = Math.max(10, Math.min(containerRect.height - 10 - backHeight, backPosition.y));
        
        attempts++;
        
        if (attempts >= maxAttempts) {
            // Scan the container for a guaranteed bounded fallback that avoids every visible cube.
            backPosition = getRandomNonOverlappingPosition(
                backWidth,
                backHeight,
                {
                    width: container.clientWidth,
                    height: container.clientHeight
                },
                existingPositions
            );
            break;
        }
    } while (checkRectangleCollisionPixels(backPosition, backWidth, backHeight, existingPositions));
    
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

// Handle cube clicks with depth tracking
function handleCubeClick(interest, position, depth) {
    // Show info in panel regardless of sub-interests
    showInfoPanel(interest, depth);
    
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
        container.appendChild(cube);
    });

    // Place BACK only after all interest cubes participate in its collision check.
    const backCube = createBackCube(parentPosition, parentDepth);
    container.appendChild(backCube);
}

// Go back to previous level
function goBack() {
    // At the root level, BACK closes the open information panel.
    if (navigationStack.length === 0) {
        hideInfoPanel();
        return;
    }

    if (navigationStack.length > 0) {
        const previousState = navigationStack.pop();
        const container = document.getElementById('brain-container');
        
        currentInterests = previousState.interests;
        

        // Clear container
        container.innerHTML = '';
        
        // Check if we're at the root level
        if (navigationStack.length === 0) {
            // Recreate main brain
            currentInterests.forEach((interest, index) => {
                const cube = createCube(interest, index, false, null, 0);
                container.appendChild(cube);
                            });
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
                container.appendChild(cube);
            });

            // Recalculate BACK after restored cubes exist, preventing any overlap.
            const backCube = createBackCube(
                previousState.parentPosition,
                previousState.depth
            );
            container.appendChild(backCube);
            
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
function showInfoPanel(interest, depth) {
    const infoPanel = document.getElementById('info-panel');
    const infoContent = document.getElementById('info-content');
    const visibleSubInterests = getVisibleInterests(interest.subInterests);
    infoContent.dataset.interestId = interest.id;
    
    // Create clickable breadcrumb navigation
    let breadcrumb = '<span class="breadcrumb-item" data-depth="0">ROOT</span>';
    if (depth > 0) {
        // Create clickable depth markers
        const depthMarkers = Array(depth).fill(0).map((_, index) => 
            `<span class="breadcrumb-item" data-depth="${index + 1}">↳</span>`
        );
        breadcrumb += ' > ' + depthMarkers.join(' > ');
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
            `<a href="${interest.feedUrl}" target="_blank" rel="noopener noreferrer" class="article-link article-link--secondary">RSS Feed</a>` :
            ''
        }
        ${interest.id === 'bitcoin-price' ? renderBitcoinCurrencyControls() : ''}
        ${interest.gallery ? renderGallery(interest.gallery) : ''}
        ${visibleSubInterests.length > 0 ? 
            `<div class="sub-interests">
                <strong>Contains ${visibleSubInterests.length} visible sub-interests:</strong>
                <ul>
                    ${visibleSubInterests.map((subInterest, index) => `
                        <li class="sub-interest-item" data-interest-index="${index}" tabindex="0" role="button">
                            ${subInterest.name}
                        </li>
                    `).join('')}
                </ul>
            </div>` : 
            '<p class="leaf-node">↳ This is a leaf node (no further sub-interests)</p>'
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
            activeGalleryImages = await getGalleryImagesFromFolder(gallery);
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

// Set up event listeners
function setupEventListeners() {
    const backButton = document.getElementById('back-button');
    backButton.addEventListener('click', goBack);

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
document.addEventListener('DOMContentLoaded', initPortfolio);

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
