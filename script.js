const text = document.getElementById('text');
let hideTimeoutId = null;
const highlightedWords = document.getElementById('highlighted-words');
const slider = document.getElementById("myRange");
const displayedSentences = new Set();
let imageIndex = 0;
let currentWord = null;
const sentences = [
    // Remember to not add special characters after the word we select because it won't appear
    'Hi!',
    'I\'m a senior millennial',
    'Interested in everything interesting',
    'A hobbyist "coder"',
    'I like building stuff', 
    'Stuff like this 4 example',
    'Lets\'s say, I know my ways around tech',
    // 'A list of podcasts I\'m subscribed to;',
    // 'goes to infinity',
    'I also fly sometimes,',
    'or hike around',
    'I really enjoy being in nature,',
    'and taking pictures of it',
    'I love the song of birds',
    'They are the music of the wild',
    'Weather interests me so,',
    'I\'ve created a bot to track it',
    'In Bitcoin I trust',
    'it represents freedom',
    'and because of their shenanigans',
    'I\'m not shy about my ordinals collection either',
    'I named them wordinals',
    // 'I\'m a minimalist at heart',
    // 'but keep failing it in practice',
    'I find joy in simplicity',
    'privacy is something I greatly cherish',
    'Boredom does not exist in my vocabulary',
    'thus, my mind is always occupied',
    'Believing in equal access to information',
    'Free speech is a right',
    'not a privilege!',
    'that\'s why nostr matters',
    'uncorrupted science holds the answers',
    'but the system is mostly rigged',
    '#mementoMori'
];
let index = -1;

const wordToUrl = {    
    'millennial': 'https://highline.huffingtonpost.com/articles/en/poor-millennials/',
    '"coder"': 'https://github.com/StellarStoic',
    'nostr': 'https://nostr-resources.com/',
    'podcasts':'/constructionSite.html',
    'example': 'https://jeba.si',
    'music': new Audio('/audio/Song-bird-sounds.mp3'),
    'bot':'https://t.me/vremenkoBot',
    'Bitcoin': 'https://www.lopp.net/bitcoin-information/getting-started.html',
    'wordinals': 'https://wordinals.art',
    // 'facts':'', 
    // 'system':'https://bitcoinmagazine.com/culture/imf-world-bank-repress-poor-countries',
    // 'minimalist':'https://www.oprahdaily.com/life/a30530266/what-is-a-minimalist-lifestyle/'
};

// Only add IDs of the videos NOT the whole URL !!! 
const wordToVideo = {
    'system':'e0plyXEc1Ak',
    'freedom': 'qiLKdyo5QZs',
    'shenanigans': 'EpMLAQbSYAw'
}

const wordToImage = {
    // 'fly': ['/pics/flying/Fly1_vertical.jpeg'],
    // 'hike': ['/pics/hike/hike_vertical.jpeg' ],
    'mind': ['/pics/site/thinking.png'],
    'pictures': [
        "/pics/pics/Image00001.jpg",
        "/pics/pics/Image00002.jpg",
        "/pics/pics/Image00003.jpg",
        "/pics/pics/Image00004.jpg",
        "/pics/pics/Image00005.jpg",
        "/pics/pics/Image00006.jpg",
        "/pics/pics/Image00007.jpg",
        "/pics/pics/Image00008.jpg",
        "/pics/pics/Image00009.jpg",
        "/pics/pics/Image00010.jpg",
        "/pics/pics/Image00011.jpg",
        "/pics/pics/Image00012.jpg",
        "/pics/pics/Image00013.jpg",
        "/pics/pics/Image00014.jpg",
        "/pics/pics/Image00015.jpg",
        "/pics/pics/Image00016.jpg",
        "/pics/pics/Image00017.jpg",
        "/pics/pics/Image00018.jpg",
        "/pics/pics/Image00019.jpg",
        "/pics/pics/Image00020.jpg",
        "/pics/pics/Image00021.jpg",
        "/pics/pics/Image00022.jpg",
        "/pics/pics/Image00023.jpg",
        "/pics/pics/Image00024.jpg",
        "/pics/pics/Image00025.jpg",
        "/pics/pics/Image00026.jpg",
        "/pics/pics/Image00027.jpg",
        "/pics/pics/Image00028.jpg",
        "/pics/pics/Image00029.jpg",
        "/pics/pics/Image00030.jpg",
        "/pics/pics/Image00031.jpg",
        "/pics/pics/Image00032.jpg",
        "/pics/pics/Image00033.jpg",
        "/pics/pics/Image00034.jpg",
        "/pics/pics/Image00035.jpg",
        "/pics/pics/Image00036.jpg",
        "/pics/pics/Image00037.jpg",
        "/pics/pics/Image00038.jpg",
        "/pics/pics/Image00039.jpg",
        "/pics/pics/Image00040.jpg",
        "/pics/pics/Image00041.jpg",
        "/pics/pics/Image00042.jpg",
        "/pics/pics/Image00043.jpg",
        "/pics/pics/Image00044.jpg",
        "/pics/pics/Image00045.jpg",
        "/pics/pics/Image00046.jpg",
        "/pics/pics/Image00047.jpg",
        "/pics/pics/Image00048.jpg",
        "/pics/pics/Image00049.jpg",
        "/pics/pics/Image00050.jpg",
        "/pics/pics/Image00051.jpg",
        "/pics/pics/Image00052.jpg",
        "/pics/pics/Image00053.jpg",
        "/pics/pics/Image00054.jpg",
        "/pics/pics/Image00055.jpg",
        "/pics/pics/Image00056.jpg",
        "/pics/pics/Image00057.jpg",
        "/pics/pics/Image00058.jpg",
        "/pics/pics/Image00059.jpg",
        "/pics/pics/Image00060.jpg",
        "/pics/pics/Image00061.jpg",
        "/pics/pics/Image00062.jpg",
        "/pics/pics/Image00063.jpg",
        "/pics/pics/Image00064.jpg",
        "/pics/pics/Image00065.jpg",
        "/pics/pics/Image00066.jpg",
        "/pics/pics/Image00067.jpg",
        "/pics/pics/Image00068.jpg",
        "/pics/pics/Image00069.jpg",
        "/pics/pics/Image00070.jpg",
        "/pics/pics/Image00071.jpg",
        "/pics/pics/Image00072.jpg",
        "/pics/pics/Image00073.jpg",
        "/pics/pics/Image00074.jpg",
        "/pics/pics/Image00075.jpg",
        "/pics/pics/Image00076.jpg",
        "/pics/pics/Image00077.jpg",
        "/pics/pics/Image00078.jpg",
        "/pics/pics/Image00079.jpg",
        "/pics/pics/Image00080.jpg",
        "/pics/pics/Image00081.jpg",
        "/pics/pics/Image00082.jpg",
        "/pics/pics/Image00083.jpg",
        "/pics/pics/Image00084.jpg",
        "/pics/pics/Image00085.jpg",
        "/pics/pics/Image00086.jpg",
        "/pics/pics/Image00087.jpg",
        "/pics/pics/Image00088.jpg",
        "/pics/pics/Image00089.jpg",
        "/pics/pics/Image00090.jpg",
        "/pics/pics/Image00091.jpg",
        "/pics/pics/Image00092.jpg",
        "/pics/pics/Image00093.jpg",
        "/pics/pics/Image00094.jpg",
        "/pics/pics/Image00095.jpg"
        ]
    
};

const wordToWord = {
    'facts': [''],
    
    'privacy': ['<h2>Cypherpunk\'s Manifesto</h2>\
<p style="font-style: italic;">by Eric Hughes</p>\
<p>Privacy is necessary for an open society in the electronic age. Privacy is not secrecy. A private matter is something one doesn\'t want the whole world to know, but a secret matter is something one doesn\'t want anybody to know. Privacy is the power to selectively reveal oneself to the world.</p>\
<p>If two parties have some sort of dealings, then each has a memory of their interaction. Each party can speak about their own memory of this; how could anyone prevent it? One could pass laws against it, but the freedom of speech, even more than privacy, is fundamental to an open society; we seek not to restrict any speech at all. If many parties speak together in the same forum, each can speak to all the others and aggregate together knowledge about individuals and other parties. The power of electronic communications has enabled such group speech, and it will not go away merely because we might want it to.</p>\
<p>Since we desire privacy, we must ensure that each party to a transaction have knowledge only of that which is directly necessary for that transaction. Since any information can be spoken of, we must ensure that we reveal as little as possible. In most cases personal identity is not salient. When I purchase a magazine at a store and hand cash to the clerk, there is no need to know who I am. When I ask my electronic mail provider to send and receive messages, my provider need not know to whom I am speaking or what I am saying or what others are saying to me; my provider only need know how to get the message there and how much I owe them in fees. When my identity is revealed by the underlying mechanism of the transaction, I have no privacy. I cannot here selectively reveal myself; I must always reveal myself.</p>\
<p>Therefore, privacy in an open society requires anonymous transaction systems. Until now, cash has been the primary such system. An anonymous transaction system is not a secret transaction system. An anonymous system empowers individuals to reveal their identity when desired and only when desired; this is the essence of privacy.</p>\
<p>Privacy in an open society also requires cryptography. If I say something, I want it heard only by those for whom I intend it. If the content of my speech is available to the world, I have no privacy. To encrypt is to indicate the desire for privacy, and to encrypt with weak cryptography is to indicate not too much desire for privacy. Furthermore, to reveal one\'s identity with assurance when the default is anonymity requires the cryptographic signature.</p>\
<p>We cannot expect governments, corporations, or other large, faceless organizations to grant us privacy out of their beneficence. It is to their advantage to speak of us, and we should expect that they will speak. To try to prevent their speech is to fight against the realities of information. Information does not just want to be free, it longs to be free. Information expands to fill the available storage space. Information is Rumor\'s younger, stronger cousin; Information is fleeter of foot, has more eyes, knows more, and understands less than Rumor.</p>\
<p>We must defend our own privacy if we expect to have any. We must come together and create systems which allow anonymous transactions to take place. People have been defending their own privacy for centuries with whispers, darkness, envelopes, closed doors, secret handshakes, and couriers. The technologies of the past did not allow for strong privacy, but electronic technologies do.</p>\
<p>We the Cypherpunks are dedicated to building anonymous systems. We are defending our privacy with cryptography, with anonymous mail forwarding systems, with digital signatures, and with electronic money.</p>\
<p>Cypherpunks write code. We know that someone has to write software to defend privacy, and since we can\'t get privacy unless we all do, we\'re going to write it. We publish our code so that our fellow Cypherpunks may practice and play with it. Our code is free for all to use, worldwide. We don\'t much care if you don\'t approve of the software we write. We know that software can\'t be destroyed and that a widely dispersed system can\'t be shut down.</p>\
<p>Cypherpunks deplore regulations on cryptography, for encryption is fundamentally a private act. The act of encryption, in fact, removes information from the public realm. Even laws against cryptography reach only so far as a nation\'s border and the arm of its violence. Cryptography will ineluctably spread over the whole globe, and with it the anonymous transactions systems that it makes possible.</p>\
<p>For privacy to be widespread it must be part of a social contract. People must come and together deploy these systems for the common good. Privacy only extends so far as the cooperation of one\'s fellows in society. We the Cypherpunks seek your questions and your concerns and hope we may engage you so that we do not deceive ourselves. We will not, however, be moved out of our course because some may disagree with our goals.</p>\
<p>The Cypherpunks are actively engaged in making the networks safer for privacy. Let us proceed together apace.</p>\
<p>Onward.</p>\
<p>Eric Hughes <hughes@soda.berkeley.edu></p>\
<p>9 March 1993</p>'],

    '#mementoMori': ['<h4>Think of yourself as dead. You have lived your life. Now take what\'s left and live it properly.</h4>\
    <p style="text-align: right;">~ Marcus Aurelius</p>']
};

// image to background when selected word appear in text
const imageToBackground = {
    'trust': '/pics/site/hungryBTC.gif',
    // 'myself': '/pics/hatching-g0e210b46b_1280.webp',
};

// Get the modal
const modal = document.getElementById("myModal");

// Get the image and insert it inside the modal
const img = document.getElementById("img01");

// Get the <span> element that closes the modal
const span = document.getElementsByClassName("close")[0];

let playIcon = '🔇';
let stopIcon = '🔈';  

// text in the modal 
function displayModalText(textContent) {
    // Hide the ostrich image
    ostrichImage.style.display = "none";
    // Hide the image and show the text container
    img.style.display = 'none';
    const modalText = document.getElementById('modal-text');
    modalText.style.display = 'block';
    modalText.innerHTML = textContent;
    modal.style.display = 'block';
}

function updateHighlightedWords() {
    // Check if the index is within the valid range
    if (index < 0 || index >= sentences.length) {
        return;
    }

    // Add a class to the text element based on the current index
    text.className = 'text sentence-' + index; 

    // Check if the sentence contains a highlighted word
    if (!displayedSentences.has(sentences[index])) {
        const words = sentences[index].split(' ');

        // Remove the 'blink' class from all highlighted words
        for (let i = 0; i < highlightedWords.children.length; i++) {
            highlightedWords.children[i].classList.remove('blink');
        }
        
        for (let i = 0; i < words.length; i++) {
            let word = words[i];
            let nextWord = words[i + 1];
            if (wordToUrl[word + ' ' + nextWord]) {
                // Handle two-word links
                const newElement = document.createElement('a');
                newElement.textContent = word + ' ' + nextWord;
                newElement.href = wordToUrl[word + ' ' + nextWord];
                newElement.target = '_blank'; // makes the link open in a new tab
                highlightedWords.appendChild(newElement);
                // const lineBreak = document.createElement('br');
                // highlightedWords.appendChild(lineBreak);
                i++; // Skip the next word

            } else if (wordToUrl[word]) {
                // Handle one-word links
                if (wordToUrl[word]) {
                    const newElement = document.createElement('a');
                    newElement.textContent = word;
                    if (wordToUrl[word] instanceof Audio) {
                        newElement.href = '#'; // This prevents the link from opening a new window
                        newElement.onclick = function(event) {
                            event.preventDefault(); // This prevents the link from following the href
                            if (wordToUrl[word].paused) {
                                wordToUrl[word].play();
                                newElement.textContent = word + ' ' + stopIcon; // Add the stop icon next to the word
                            } else {
                                wordToUrl[word].pause();
                                newElement.textContent = word + ' ' + playIcon; // Add the play icon next to the word
                            }
                        };
                    } else {
                        newElement.href = wordToUrl[word];
                        newElement.target = '_blank'; // This makes the link open in a new tab
                    }
                    highlightedWords.appendChild(newElement);
                    const lineBreak = document.createElement('br');
                    highlightedWords.appendChild(lineBreak);
                }

            } else if (wordToImage[word]) {
                // Handle one-word images
                const newElement = document.createElement('a');
                newElement.textContent = word;
                newElement.href = '#';
                newElement.onclick = function() {
                    toggleTickerContainer('none');  // Hide the tickerContainer
                    //  // Hide the ostrich image
                    toggleFooter('none');  // Hide the footer
                    ostrichImage.style.display = "none";
                    resetModal(); // Clear any previous content
                    imageIndex = 0; // Reset the image index
                    currentWord = word; // Set the current word
                    img.style.display = 'block';  // Show the image container
                    // Fetch the image and set the src to a blob URL instead of the image path
                    fetch(wordToImage[currentWord][imageIndex])
                        .then(response => response.blob())
                        .then(blob => {
                            img.src = URL.createObjectURL(blob);
                        });
                    modal.style.display = "block"; // Show the modal
                    // Set the context menu to null to disable right-clicking
                    img.oncontextmenu = function() {
                        return false;
                    };

                    
                };
                highlightedWords.appendChild(newElement);
                const lineBreak = document.createElement('br');
                highlightedWords.appendChild(lineBreak);

            } else if (wordToWord[word]) {
                // Handle one-word texts
                const newElement = document.createElement('a');
                newElement.textContent = word;
                newElement.href = '#';
                newElement.onclick = function() {
                    toggleTickerContainer('none');  // Hide the tickerContainer
                    toggleFooter('none');  // Hide the footer
                    displayModalText(wordToWord[word]);
                };
                highlightedWords.appendChild(newElement);
                const lineBreak = document.createElement('br');
                highlightedWords.appendChild(lineBreak);
            }
            
            if (imageToBackground[word]) {
                // Handle one-word background images
                changeBackground(imageToBackground[word]);
            }

            else if (wordToVideo[word]) {
                const newElement = document.createElement('a');
                newElement.textContent = word;
                newElement.href = '#';
                newElement.onclick = function() {
                    toggleTickerContainer('none');  // Hide the tickerContainer
                    // Hide the ostrich image
                    toggleFooter('none');  // Hide the footer
                    ostrichImage.style.display = "none";
                    resetModal(); // Clear any previous content
                    const modalVideo = document.getElementById('modal-video');
                    modalVideo.innerHTML = `<iframe class="centered-video" width="560" height="315" src="https://www.youtube.com/embed/${wordToVideo[word]}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
                    modal.style.display = "block";
                };
                highlightedWords.appendChild(newElement);
                const lineBreak = document.createElement('br');
                highlightedWords.appendChild(lineBreak);
            }

        } 
        // Add the sentence to the list of displayed sentences
        displayedSentences.add(sentences[index]);
    }
    highlightedWords.scrollTop = highlightedWords.scrollHeight; // Scroll to the bottom

    // Add the 'blink' class to the associated word
    for (let i = 0; i < highlightedWords.children.length; i++) {
        if (sentences[index].includes(highlightedWords.children[i].textContent)) {
            highlightedWords.children[i].classList.add('blink');
        } else {
            highlightedWords.children[i].classList.remove('blink');
        }
    }
}

// side sentences slider

slider.max = sentences.length - 1;  // Set the maximum value of the slider to the number of sentences

slider.addEventListener("input", function() {
    // Disable the slider
    slider.disabled = true;

    // Calculate the new index based on the slider's value
    let newIndex = Math.round((this.value / this.max) * (sentences.length - 1));

    // Check if the new index is different from the current index
    if (newIndex !== index) {
        text.style.opacity = '0';  // fade out
        text.style.display = 'none';  // hide the text

        setTimeout(() => {
            index = newIndex;  // Update the index
            text.textContent = sentences[index];  // Update the text
            text.style.opacity = '1';  // fade in
            text.style.display = '';  // show the text
            updateHighlightedWords();  // Update the highlighted words

            // Clear the previous timeout
            if (hideTimeoutId !== null) {
                clearTimeout(hideTimeoutId);
            }

            // After 4 seconds, set the opacity of the text to 0
            hideTimeoutId = setTimeout(function() {
                text.style.opacity = '0';
                text.style.display = 'none';  // hide the text
            }, 2500);

            // Re-enable the slider after all operations have been completed
            slider.disabled = false;
        }, 500);  // change the text after 0.5 seconds
    } else {
        // Re-enable the slider if newIndex is the same as index
        slider.disabled = false;
    }
});

document.addEventListener('keydown', (event) => {
    // Check if the modal is not displayed
    if (modal.style.display !== "block") {
        // Check if the key press was space bar
        if (event.code === "Space") {
            text.style.opacity = '0'; // fade out
            text.style.display = 'none'; // hide the text
            setTimeout(() => {
                // Check if the shift key was also pressed
                if (event.shiftKey) {
                    // The key press was shift+space bar
                    if (index > 0) {
                        index--;
                    }
                } else {
                    // The key press was space bar
                    if (index < sentences.length - 1) {
                        index++;
                    }
                }
                text.textContent = sentences[index];
                text.style.opacity = '1'; // fade in
                text.style.display = ''; // show the text
                updateHighlightedWords(); // Update the highlighted words
                
                // Clear the previous timeout
                if (hideTimeoutId !== null) {
                    clearTimeout(hideTimeoutId);
                }

                // After 4 seconds, set the opacity of the text to 0
                hideTimeoutId = setTimeout(function() {
                    text.style.opacity = '0';
                    text.style.display = 'none'; // hide the text
                }, 2500);

                // Update the slider's value
                slider.value = (index / (sentences.length - 1)) * slider.max;

            }, 500); // change the text after 0.2 seconds
        }
    }
}); // This closes the keydown event listener function

// function goToNextSentence() {
//     text.style.opacity = '0'; // fade out
//     text.style.display = 'none'; // hide the text
//     setTimeout(() => {
//         if (index < sentences.length - 1) {
//         index++;
//         }
//         text.textContent = sentences[index];
//         text.style.opacity = '1'; // fade in
//         text.style.display = ''; // show the text
//         updateHighlightedWords(); // Update the highlighted words
    
//         setTimeout(() => {
//             // Check if the shift key was also pressed
//             if (shiftKey) {
//                 // The key press was shift+space bar
//                 if (index > 0) {
//                     index--;
//                 }
//             } else {
//                 // The key press was space bar
//                 if (index < sentences.length - 1) {
//                     index++;
//                 }
//             }
//             text.textContent = sentences[index];
//             text.style.opacity = '1'; // fade in
//             text.style.display = ''; // show the text
//             updateHighlightedWords(); // Update the highlighted words
            
//             // Clear the previous timeout
//             if (hideTimeoutId !== null) {
//                 clearTimeout(hideTimeoutId);
//             }

//             // After 4 seconds, set the opacity of the text to 0
//             hideTimeoutId = setTimeout(function() {
//                 text.style.opacity = '0';
//                 text.style.display = 'none'; // hide the text
//             }, 2500);

//             // Update the slider's value
//             slider.value = (index / (sentences.length - 1)) * slider.max;
    
//         }, 500); // change the text after 0.2 seconds
//     })
// }

document.addEventListener('DOMContentLoaded', function() {
    const textElement = document.querySelector('.text');
    textElement.addEventListener('touchend', function(event) {
        event.stopPropagation();
    }, false);
}, false);

let lastTap = 0;  // To hold the time of the last tap
let isFirstLoad = true; // To indicate if it's the first load of the sentences

// Function to check if the device is mobile
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function goToNextSentence(event) {

    const currentTime = new Date().getTime();
    const timeDifference = currentTime - lastTap;
    lastTap = currentTime;

    if (timeDifference < 500) {
        return;
    }

    text.style.opacity = '0'; 
    text.style.display = 'none'; 

    setTimeout(() => {
        if (index < sentences.length - 1) {
            index++;
        }

        // Update the slider's value here
        slider.value = (index / (sentences.length - 1)) * slider.max;

        text.textContent = sentences[index];
        text.style.opacity = '1'; 
        text.style.display = ''; 
        updateHighlightedWords();

        // Additional code for mobile behavior
        if (isMobile()) {

            // Only proceed if the clicked element has the class 'text'
            if (!event.target.classList.contains('text')) {
                return;
            }


            // If it's the first load, don't set any timeout to hide the text
            if (isFirstLoad) {
                isFirstLoad = false;
                return;
            }

            // If it's the last sentence, hide it after 3000 milliseconds
            if (index === sentences.length - 1) {
                setTimeout(() => {
                    text.style.opacity = '0';
                    text.style.display = 'none'; 
                }, 3000);
            }
        } else {
            // Existing code for non-mobile behavior
            setTimeout(() => {
                if (event.shiftKey) {
                    if (index > 0) {
                        index--;
                    }
                }

                text.textContent = sentences[index];
                text.style.opacity = '1';
                text.style.display = ''; 
                updateHighlightedWords();
                
                if (hideTimeoutId !== null) {
                    clearTimeout(hideTimeoutId);
                }

                hideTimeoutId = setTimeout(function() {
                    text.style.opacity = '0';
                    text.style.display = 'none'; 
                }, 2500);

                slider.value = (index / (sentences.length - 1)) * slider.max;
            }, 500);
        }
    }, 500);
}

// Attach the function to click and touch events
text.addEventListener('click', goToNextSentence);

// Commenting out touch event because if enabled, we can click on highlighted...
// words even if sentences are above them on mobile devices!
// text.addEventListener('touchstart', goToNextSentence); 


// Get the forward and backward buttons
const forwardButton = document.getElementById('nextBtn');
const backwardButton = document.getElementById('prevBtn');

// Set up the click event handlers for the buttons
forwardButton.onclick = function() {
    if (wordToImage[currentWord] && wordToImage[currentWord].length > 1) {
        imageIndex = Math.floor(Math.random() * wordToImage[currentWord].length);
        img.src = wordToImage[currentWord][imageIndex];
    }
    console.log("btn >> Clicked");
};

backwardButton.onclick = function() {
    if (wordToImage[currentWord] && wordToImage[currentWord].length > 1) {
        imageIndex = Math.floor(Math.random() * wordToImage[currentWord].length);
        img.src = wordToImage[currentWord][imageIndex];
    }
    console.log("btn << Clicked");
};

// Change Image based on a keyword in sentances
function changeBackground(imageUrl) {
    // Get the div
    const backgroundImageDiv = document.getElementById('background-image');

    // Change the background to the new image
    backgroundImageDiv.style.backgroundImage = `url(${imageUrl})`;

    // After 2 seconds, remove the hungry Bitcoin background image
    setTimeout(function() {
        backgroundImageDiv.style.backgroundImage = 'none';
    }, 3500);
}

// Get the close button
const closeButton = document.getElementsByClassName("close")[0];

// Get the ostrich image element by its ID
const ostrichImage = document.getElementById('running-ostrich');

// When the user clicks on the close button, close the modal
closeButton.onclick = function() {
    URL.revokeObjectURL(img.src);
    toggleTickerContainer('block');  // Show the tickerContainer again
    toggleFooter('block');  // Show the footer again
    modal.style.display = "none";
    resetModal();  // Clear any previous content
    // Show the ostrich image
    ostrichImage.style.display = "block";
}

// When the user clicks anywhere outside of the modal, close it
window.onclick = function(event) {
    if (event.target == modal) {
        toggleTickerContainer('block');  // Show the tickerContainer again
        toggleFooter('block');  // Show the footer again
        modal.style.display = "none";
        resetModal();  // Clear any previous content
        // Show the ostrich image
        ostrichImage.style.display = "block";
    }
}


// hide footer when the modal is open
function toggleFooter(visibility) {
    const footer = document.getElementById('footer');
    footer.style.display = visibility;
  }

// hide ticker-container when the modal is open
function toggleTickerContainer(visibility) {
    const tickerContainer = document.getElementById('ticker-container');
    tickerContainer.style.display = visibility;
  }
//   toggleTickerContainer('block');  // Show the tickerContainer again
//   toggleTickerContainer('none');  // Hide the tickerContainer

// Clear any previous content from modal
function resetModal() {
    console.log("Resetting modal");
    // Hide the image, text, and video containers
    img.style.display = 'none';
    const modalText = document.getElementById('modal-text');
    modalText.style.display = 'none';
    const modalVideo = document.getElementById('modal-video');
    modalVideo.innerHTML = '';  // Remove the YouTube iframe

    // Revoke the blob URL to free memory
    if (img.src.startsWith('blob:')) {
        URL.revokeObjectURL(img.src);
    }

    // Clear the image src
    img.src = '';
}

// Listen for window resize
// window.addEventListener('resize', toggleScrollerAndButton);

// document.getElementById('content').innerHTML = wordToWord['privacy'][0];
// document.getElementById('copyright-year').textContent = new Date().getFullYear();

