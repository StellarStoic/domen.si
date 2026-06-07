// Global variables to track current state
let navigationStack = []; // Stack to track navigation history
let currentInterests = []; // Current level being displayed
let activeGalleryImages = []; // Images currently shown in the lightbox
let activeGalleryIndex = 0; // Selected lightbox image index

// Initialize the portfolio
async function initPortfolio() {
    await loadInterestsData();
    renderBrain();
    setupEventListeners();
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

// Generate a random non-overlapping position inside the container (desktop only)
function getRandomNonOverlappingPosition(cubeWidth, cubeHeight, containerRect) {
    const maxAttempts = 300;  // try many times to avoid collisions
    const existingPositions = getExistingCubePositionsPixels();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {

        // choose a fully random coordinate inside the container
        const pos = {
            x: Math.random() * (containerRect.width - cubeWidth - 10),
            y: Math.random() * (containerRect.height - cubeHeight - 10)
        };

        // check if random position collides with any existing cube
        const collision = checkRectangleCollisionPixels(
            pos,
            cubeWidth,
            cubeHeight,
            existingPositions
        );

        // found a clean spot → return immediately
        if (!collision) {
            return pos;
        }
    }

    // fallback: at least place it somewhere safe near (0,0)
    return { x: 10, y: 10 };
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

    // Calculate dynamic size based on text length
    const textLength = interest.name.length;
    const baseSize = 40; // Base cube size in px
    const charWidth = 8; // Approximate width per character (px)
    const padding = 10; // Padding around text (px)

    // Determine text orientation (vertical/horizontal) - unchanged
    const useVertical = textLength <= 4 || Math.random() > 0.7;
    cube.dataset.orientation = useVertical ? 'vertical' : 'horizontal';

    if (useVertical) {
        // Vertical text layout
        const width = baseSize + padding;
        const height = baseSize + (textLength * 4) + padding;
        cube.style.width = `${width}px`;
        cube.style.height = `${height}px`;
        cube.style.writingMode = 'vertical-rl';
        cube.style.textOrientation = 'mixed';
    } else {
        // Horizontal text layout
        const width = Math.max(baseSize, (textLength * charWidth) + padding);
        const height = baseSize + padding;
        cube.style.width = `${width}px`;
        cube.style.height = `${height}px`;
    }

    // Get container dimensions ONCE
    const container = document.getElementById('brain-container');
    const containerRect = container.getBoundingClientRect();

    // Get cube dimensions in PIXELS (parseInt from style set above)
    const cubeWidth = parseInt(cube.style.width, 10);
    const cubeHeight = parseInt(cube.style.height, 10);

    // ---------- POSITIONING LOGIC ----------
    // If this is a sub-cube and a parent position is provided, try to place near parent using collision avoidance.
    // Otherwise, place randomly inside container using collision avoidance.
    // MobileRandom forces random placement on small screens too (fixes blank mobile result).
    if (isSubCube && parentPosition) {
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
                finalPosition = findSpiralPositionPixels(
                    { x: parentXPixels, y: parentYPixels },
                    existingPositions,
                    cubeWidth,
                    cubeHeight,
                    containerRect
                );
                break;
            }
        } while (attempts < maxAttempts);

        cube.style.left = `${finalPosition.x}px`;
        cube.style.top = `${finalPosition.y}px`;
    } else {
        // Not a sub-cube (root or normal). Use random non-overlapping placement for both desktop and mobileRandom.
        // This ensures root cubes are randomly placed on mobile as you requested.
        const pos = getRandomNonOverlappingPosition(cubeWidth, cubeHeight, containerRect);
        cube.style.left = `${pos.x}px`;
        cube.style.top = `${pos.y}px`;
    }

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

    // click handler unchanged
    cube.addEventListener('click', (event) => {
        event.stopPropagation();

        if (interest.url) {
            window.open(interest.url, '_blank');
        } else if (getVisibleInterests(interest.subInterests).length > 0) {
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
            // Fallback: random position in container
            backPosition = { 
                x: Math.random() * (containerRect.width - backWidth - 20) + 10,
                y: Math.random() * (containerRect.height - backHeight - 20) + 10
            };
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
    

    // Create back cube
    const backCube = createBackCube(parentPosition, parentDepth);
    container.appendChild(backCube);
    
    // Create sub-interest cubes
    currentInterests.forEach((subInterest, index) => {
        const cube = createCube(subInterest, index, true, parentPosition, parentDepth + 1);
        container.appendChild(cube);
    });
}

// Go back to previous level
function goBack() {
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
            const backCube = createBackCube(
                previousState.parentPosition, 
                previousState.depth
            );
            container.appendChild(backCube);
            
            // Recreate interest cubes for this level
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
        <p class="description">${interest.description}</p>
        <div class="depth-indicator">Depth: ${depth + 1}</div>
        ${interest.url ? 
            `<a href="${interest.url}" target="_blank" class="article-link">📖 Read Article</a>` : 
            ''
        }
        ${interest.gallery ? renderGallery(interest.gallery) : ''}
        ${visibleSubInterests.length > 0 ? 
            `<div class="sub-interests">
                <strong>Contains ${visibleSubInterests.length} visible sub-interests:</strong>
                <ul>
                    ${visibleSubInterests.map(si => `<li>${si.name}</li>`).join('')}
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
