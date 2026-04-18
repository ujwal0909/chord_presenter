import { db } from './firebase-config.js';
import { 
    doc, 
    getDoc,
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ALIASES = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };

// Local sync for same-machine navigation (zero backend)
const syncChannel = new BroadcastChannel('chord_presenter_local_sync');

let lastLocalUpdateAt = 0;
const SYNC_GRACE_PERIOD = 2000;
let resizeTimer;

window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        fitTextToContainer();
    }, 100);
});

function escapeHtml(str) {
    if (!str) return '';
    return str
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function transposeChord(chordText, steps) {
    if (steps === 0) return chordText;
    return chordText.replace(/([A-G][b#]?)(.*)/i, (match, root, rest) => {
        let rootUpper = root.charAt(0).toUpperCase() + root.slice(1);
        let note = ALIASES[rootUpper] || rootUpper;
        let index = NOTES.indexOf(note);
        if (index === -1) return match;
        let newIndex = (index + steps) % 12;
        if (newIndex < 0) newIndex += 12;
        return NOTES[newIndex] + rest;
    });
}

function parseLyricsWithChords(rawText, transposeStep = 0, mode = 'scroll', slideIndex = 0) {
    if (mode === 'slides') {
        const paragraphs = rawText.split(/\n\s*\n/);
        rawText = paragraphs[slideIndex] || '';
    }
    const lines = rawText.split('\n');
    let html = '';
    for (const line of lines) {
        if (line.trim() === '') {
            html += '<div class="chord-line"><br/></div>';
            continue;
        }
        let lineHtml = '<div class="chord-line">';
        const parts = line.split(/\[(.*?)\]/);
        if (parts[0]) {
            lineHtml += `<span class="lyric-text">${escapeHtml(parts[0])}</span>`;
        }
        for (let i = 1; i < parts.length; i += 2) {
            const chord = parts[i];
            const textAfter = parts[i+1] || '';
            const transposedChord = transposeChord(chord, transposeStep);
            lineHtml += `
            <span class="chord-wrapper">
                <span class="chord-label">${escapeHtml(transposedChord)}</span>
                <span class="lyric-text">${escapeHtml(textAfter)}</span>
            </span>`;
        }
        lineHtml += '</div>';
        html += lineHtml;
    }
    return html;
}

function fitTextToContainer() {
    if (!lastKnownState || lastKnownState.mode !== 'slides') {
        viewLyrics.style.fontSize = ''; // Reset to CSS default for scrolling
        return;
    }

    let min = 10;
    let max = 200;
    let optimal = min;

    // Use binary search for efficiency
    while (min <= max) {
        let mid = Math.floor((min + max) / 2);
        viewLyrics.style.fontSize = mid + 'px';
        
        // Check for overflow
        const isOverflowing = (document.documentElement.scrollHeight > window.innerHeight) || 
                             (document.documentElement.scrollWidth > window.innerWidth);
        
        if (!isOverflowing) {
            optimal = mid;
            min = mid + 1;
        } else {
            max = mid - 1;
        }
    }
    
    viewLyrics.style.fontSize = (optimal - 1) + 'px'; // -1 for safety margin
}

const viewTitle = document.getElementById('viewTitle');
const viewArtist = document.getElementById('viewArtist');
const viewLyrics = document.getElementById('viewLyrics');
const container = document.getElementById('presenterContainer');

let lastKnownState = null;

function renderView() {
    if (!lastKnownState) return;
    const { song, transpose, layout, mode, slideIndex, chordOnlyMode } = lastKnownState;
    
    if (song) {
        viewTitle.textContent = song.title;
        viewArtist.textContent = song.artist || '';
        viewLyrics.innerHTML = parseLyricsWithChords(song.content, transpose, mode, slideIndex);
    } else {
        viewTitle.textContent = 'No Song Selected';
        viewArtist.textContent = '';
        viewLyrics.innerHTML = '';
    }
    
    container.className = `presenter-layout ${layout || 'vertical'}`;
    if (chordOnlyMode) viewLyrics.classList.add('chords-only');
    else viewLyrics.classList.remove('chords-only');

    // Trigger auto-sizing
    fitTextToContainer();
}

window.addEventListener('keydown', (e) => {
    if (!lastKnownState || lastKnownState.mode !== 'slides' || !lastKnownState.song) return;
    
    const paragraphs = lastKnownState.song.content.split(/\n\s*\n/);
    if (e.key === 'ArrowLeft') {
        if (lastKnownState.slideIndex > 0) {
            lastKnownState.slideIndex--;
            lastLocalUpdateAt = Date.now();
            renderView(); 
            syncChannel.postMessage({ action: 'NAVIGATE_SLIDE', direction: 'prev' });
        }
    } else if (e.key === 'ArrowRight') {
        if (lastKnownState.slideIndex < paragraphs.length - 1) {
            lastKnownState.slideIndex++;
            lastLocalUpdateAt = Date.now();
            renderView();
            syncChannel.postMessage({ action: 'NAVIGATE_SLIDE', direction: 'next' });
        }
    }
});

function autoScrollLoop() {
    if (lastKnownState && lastKnownState.mode === 'scroll' && lastKnownState.autoScroll) {
        const speedMultiplier = lastKnownState.scrollSpeed * 0.15;
        window.scrollBy(0, speedMultiplier);
    }
    requestAnimationFrame(autoScrollLoop);
}
requestAnimationFrame(autoScrollLoop);

// Resolve Room Code or UID
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
const uidParam = urlParams.get('uid');

async function initSync() {
    let targetUid = uidParam;

    if (roomCode) {
        viewTitle.textContent = `Connecting to Room ${roomCode}...`;
        const roomDoc = await getDoc(doc(db, "rooms", roomCode.toUpperCase()));
        if (roomDoc.exists()) {
            targetUid = roomDoc.data().userId;
        } else {
            viewTitle.textContent = 'Error: Invalid Room Code';
            return;
        }
    }

    if (targetUid) {
        onSnapshot(doc(db, "states", targetUid), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                
                // --- Sync Fighting Prevention ---
                // If we just navigated locally, ignore incoming syncs for 2 seconds 
                // UNLESS the incoming sync has finally caught up to our local state.
                const timeSinceLocalUpdate = Date.now() - lastLocalUpdateAt;
                const isSyncCaughtUp = lastKnownState && data.slideIndex === lastKnownState.slideIndex && data.song?.id === lastKnownState.song?.id;

                if (timeSinceLocalUpdate < SYNC_GRACE_PERIOD && !isSyncCaughtUp) {
                    console.log("Ignoring sync (grace period)");
                    return;
                }

                if (lastKnownState && 
                    data.song?.id === lastKnownState.song?.id && 
                    data.slideIndex === lastKnownState.slideIndex &&
                    data.transpose === lastKnownState.transpose) {
                    return;
                }
                lastKnownState = data;
                renderView();
            } else {
                viewTitle.textContent = 'Waiting for state...';
            }
        });
    } else {
        viewTitle.textContent = 'Error: No Room or User ID provided';
    }
}

initSync();
