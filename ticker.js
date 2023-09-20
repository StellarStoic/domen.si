document.addEventListener('DOMContentLoaded', function () {
    let tickerText = document.getElementById("ticker-text");
    let tickerContainer = document.getElementById("ticker-container");
    let currentData = "";
    
    // Fetch a random quote
    function fetchQuote() {
        // List of quote authors
            const wiseAuthors = [
                // Ancient Stoics
                'Marcus Aurelius',     // Roman Emperor and Stoic philosopher
                'Seneca',              // Roman Stoic philosopher, statesman, and dramatist
                'Epictetus',           // Greek Stoic philosopher
                'Zeno of Citium',      // Founder of the Stoic school of philosophy
                'Cleanthes',           // Second head of the Stoic school
                'Chrysippus',          // Third head of the Stoic school
                'Cato the Younger',    // Roman statesman and Stoic philosopher
                'Hierocles',           // Stoic philosopher
                'Musonius Rufus',      // Roman Stoic philosopher
                'Diogenes of Babylon', // Stoic philosopher and scholarch of the Stoic school
                'Arrian',            // A student of Epictetus who recorded his teachings
                'Gaius Musonius Rufus', // Sometimes referred to by his full name
                'Persius',           // A Stoic poet
                'Cornutus',          // A Stoic philosopher who was a teacher of Persius
                'Posidonius',        // Stoic philosopher, influenced both the Stoics and the school of Middle Platonism
                'Panaetius',         // Brought Stoicism to Rome
                'Paconius Agrippinus', // A Roman Stoic mentioned by Epictetus
                'Epictetus of Hierapolis', // Sometimes referred to by his place of origin
                'Sphaerus',          // Early Stoic philosopher who was a student of Zeno of Citium
                'Herillus',          // An early Stoic who differed on some points from the mainstream Stoics
                'Apollonius of Chalcedon', // Teacher of Emperor Marcus Aurelius
                'Junius Rusticus',   // Mentor to Marcus Aurelius
                'Fabius Maximus',    // Though not strictly a Stoic philosopher, his Stoic-like virtues were admired by many Stoics
                'Jason of Nysa',     // A Stoic philosopher who lived in the time of Augustus
                'Seneca the Elder',  // Father of Seneca, not a Stoic but his works provide context for Stoicism in Rome
                'Dionysius of Heraclea', // Originally a student of Zeno, later renounced Stoicism

                // Modern Stoics
                'Massimo Pigliucci',   // Philosopher and author of "How to Be a Stoic"
                'Donald Robertson',    // Cognitive-behavioral therapist and author of "Stoicism and the Art of Happiness"
                'Ryan Holiday',        // Author of "The Daily Stoic" and "Ego is the Enemy"
                'William B. Irvine',   // Author of "A Guide to the Good Life: The Ancient Art of Stoic Joy"
                
                // Eastern Philosophers
                'Lao Tzu',             // Founder of Taoism
                'Confucius',           // Founder of Confucianism
                'Chuang Tzu',          // Important figure in Taoism
                'Sun Tzu',             // Author of "The Art of War"
                
                // Other Wise Figures
                'Alan Watts',          // British-American philosopher known for popularizing Eastern philosophy in the West
                'Rumi',                // 13th-century Persian poet and Sufi mystic
                'Socrates',            // Classical Greek philosopher and founder of Western philosophy
                'Plato',               // Student of Socrates and founder of the Academy in Athens
                'Aristotle',           // Student of Plato and tutor to Alexander the Great
                'Thich Nhat Hanh',     // Vietnamese Zen Buddhist monk and peace activist
                'Dalai Lama',          // Spiritual leader of Tibetan Buddhism
                'Desiderius Erasmus',  // Dutch philosopher and Christian scholar
                'Ralph Waldo Emerson', // American essayist and leader of the Transcendentalist movement
                'Henry David Thoreau', // American essayist and Transcendentalist
                'Friedrich Nietzsche', // German philosopher known for his critiques of traditional European morality and religion
                'Immanuel Kant',       // German philosopher known for his work in epistemology and ethics
                'Jean-Jacques Rousseau', // French philosopher known for his social contract theory
                'John Locke',          // English philosopher and physician
                'Blaise Pascal'        // French mathematician, physicist, and religious philosopher
                ];

            // Convert array to pipe-separated string
            const AuthorsString = wiseAuthors.join('|');

            return fetch(`https://api.quotable.io/random?author=${encodeURIComponent(AuthorsString)}`)
                .then(response => response.json())
                .then(data => `${data.content} - ${data.author}`);
            }
  
    // Fetch a random joke (Example API, replace with real one)
    // function fetchJoke() {
    //   return fetch('https://v2.jokeapi.dev/joke/Programming,Miscellaneous?blacklistFlags=nsfw,religious,political,racist,sexist,explicit&type=single')
    //     .then(response => response.json())
    //     .then(data => data.joke);
    // }

    // Add more fetch functions for stocks, currency, etc.

    // Fetch all data and concatenate
    function fetchData() {
      Promise.all([fetchQuote()/*, fetchJoke()  , fetchStocks(), fetchCurrency() */])
        .then(dataArray => {
          currentData = dataArray.join("   ||   ");
          tickerText.textContent = currentData;
          startTicker();
        })
        .catch(error => console.error(error));
    }
  
    function startTicker() {
        let position = tickerContainer.offsetWidth;
        function scroll() {
          tickerText.style.left = position + "px";
          position -= 2;
          
          if (position < -tickerText.offsetWidth) {
            // Do not reset the position here. Fetch new data first.
            fetchData();
          } else {
            requestAnimationFrame(scroll);
          }
        }
        scroll();
      }
  
    fetchData();
  });
  































// document.addEventListener('DOMContentLoaded', function () {
//     let tickerText = document.getElementById("ticker-text");
//     let tickerContainer = document.getElementById("ticker-container");
//     let currentQuote = "";
  
//     function fetchQuote() {
//       fetch('https://api.quotable.io/random')
//         .then(response => response.json())
//         .then(data => {
//           currentQuote = `${data.content} - ${data.author}`;
//           tickerText.textContent = currentQuote;
//           startTicker();
//         })
//         .catch(error => console.error(error));
//     }
  
//     function startTicker() {
//       let position = tickerContainer.offsetWidth;
//       function scroll() {
//         tickerText.style.left = position + "px";
//         position -= 2;
//         if (position < -tickerText.offsetWidth) {
//           position = tickerContainer.offsetWidth;
//           fetchQuote();
//         }
//         requestAnimationFrame(scroll);
//       }
//       scroll();
//     }
  
//     fetchQuote();
//   });
  