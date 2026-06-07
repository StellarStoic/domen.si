// Function to generate random positions within brain-shaped area
function generateBrainPositions(count) {
    const positions = [];
    const usedPositions = new Set();
    
    // Brain shape boundaries (approximate)
    const brainBounds = {
        left: 10,   // 10% from left
        right: 85,  // 85% from left  
        top: 10,    // 10% from top
        bottom: 80  // 80% from top
    };
    
    // More dense areas (left and right hemispheres)
    const leftHemisphere = { x: [15, 45], y: [15, 75] };
    const rightHemisphere = { x: [55, 85], y: [15, 75] };
    
    for (let i = 0; i < count; i++) {
        let position;
        let attempts = 0;
        const maxAttempts = 100;
        
        do {
            // Alternate between hemispheres for better distribution
            const useLeftHemisphere = i % 2 === 0;
            const hemisphere = useLeftHemisphere ? leftHemisphere : rightHemisphere;
            
            position = {
                x: Math.random() * (hemisphere.x[1] - hemisphere.x[0]) + hemisphere.x[0],
                y: Math.random() * (hemisphere.y[1] - hemisphere.y[0]) + hemisphere.y[0]
            };
            
            // Ensure minimum distance between cubes
            let tooClose = false;
            for (const existingPos of positions) {
                const distance = Math.sqrt(
                    Math.pow(position.x - existingPos.x, 2) + 
                    Math.pow(position.y - existingPos.y, 2)
                );
                if (distance < 8) { // Minimum 8% distance
                    tooClose = true;
                    break;
                }
            }
            
            if (!tooClose) break;
            attempts++;
        } while (attempts < maxAttempts);
        
        // If we can't find a good position, use a fallback
        if (attempts >= maxAttempts) {
            const hemisphere = i % 2 === 0 ? leftHemisphere : rightHemisphere;
            position = {
                x: Math.random() * (hemisphere.x[1] - hemisphere.x[0]) + hemisphere.x[0],
                y: Math.random() * (hemisphere.y[1] - hemisphere.y[0]) + hemisphere.y[0]
            };
        }
        
        positions.push(position);
        usedPositions.add(`${Math.round(position.x)},${Math.round(position.y)}`);
    }
    
    return positions;
}

// Utility function to count total depth (for testing)
function getMaxDepth(interests, currentDepth = 1) {
    let maxDepth = currentDepth;
    
    if (interests.subInterests) {
        for (const subInterest of interests.subInterests) {
            const depth = getMaxDepth(subInterest, currentDepth + 1);
            maxDepth = Math.max(maxDepth, depth);
        }
    }
    
    return maxDepth;
}

// Store all root interests loaded from the JSON files in the interests folder.
let interestsData = { mainInterests: [] };

// Discover JSON files from a server directory listing when directory browsing is enabled.
async function getInterestFilesFromDirectory() {
    const response = await fetch('interests/');

    if (!response.ok) {
        throw new Error(`Directory listing is unavailable (${response.status})`);
    }

    const directoryHtml = await response.text();
    const directoryDocument = new DOMParser().parseFromString(directoryHtml, 'text/html');

    // Keep only direct JSON file links and exclude the fallback manifest.
    return Array.from(directoryDocument.querySelectorAll('a'))
        .map(link => decodeURIComponent(link.getAttribute('href') || '').split('/').pop())
        .filter(fileName => fileName && fileName !== 'index.json' && fileName.toLowerCase().endsWith('.json'))
        .sort((first, second) => first.localeCompare(second));
}

// Fall back to the generated manifest on static hosts that do not expose directory listings.
async function getInterestFiles() {
    try {
        const discoveredFiles = await getInterestFilesFromDirectory();

        if (discoveredFiles.length > 0) {
            return discoveredFiles;
        }
    } catch (error) {
        console.info('Using the generated interests manifest:', error.message);
    }

    const manifestResponse = await fetch('interests/index.json');

    if (!manifestResponse.ok) {
        throw new Error(`Could not load interests manifest (${manifestResponse.status})`);
    }

    return await manifestResponse.json();
}

// Load every discovered root-interest JSON file.
async function loadInterestsData() {
    try {
        const interestFiles = await getInterestFiles();

        // Load files independently so one broken interest does not hide all other interests.
        const loadedInterests = await Promise.all(interestFiles.map(async (fileName) => {
            try {
                const response = await fetch(`interests/${encodeURIComponent(fileName)}`);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`Error loading interest file "${fileName}":`, error);
                return null;
            }
        }));

        // Ignore failed files and expose the valid root interests to the existing renderer.
        interestsData.mainInterests = loadedInterests.filter(Boolean);
        
        // Generate positions for all successfully loaded root interests.
        const mainPositions = generateBrainPositions(interestsData.mainInterests.length);
        
        // Assign a generated position to each root interest.
        interestsData.mainInterests.forEach((interest, index) => {
            interest.position = mainPositions[index];
        });
        
    } catch (error) {
        console.error('Error loading interests data:', error);
    }
}
