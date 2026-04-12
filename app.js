import { auth, db } from './firebase-config.js';
import { 
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut,
    GoogleAuthProvider,
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    collection, 
    doc, 
    setDoc, 
    onSnapshot, 
    query, 
    where, 
    addDoc, 
    updateDoc, 
    deleteDoc,
    getDocs,
    getDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ALIASES = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };

// Local sync for same-machine navigation (zero backend)
const syncChannel = new BroadcastChannel('chord_presenter_local_sync');

syncChannel.onmessage = (event) => {
    if (event.data.action === 'NAVIGATE_SLIDE') {
        if (event.data.direction === 'next') handleNextSlide();
        if (event.data.direction === 'prev') handlePrevSlide();
    }
};

// --- HELPERS ---

function detectKey(content) {
    if (!content) return null;
    const match = content.match(/\[([A-G][b#]?)/);
    if (!match) return null;
    const note = match[1];
    return ALIASES[note] || note;
}

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

// --- STATE ---
let currentUser = null;
let songs = [];
let activeSongId = null;
let currentTranspose = 0;
let presenterLayout = 'vertical';
let currentMode = 'slides';
let currentSlideIndex = 0;
let currentAutoScroll = false;
let currentScrollSpeed = 5;
let chordOnlyMode = false;

// --- DOM ELEMENTS ---
const songListEl = document.getElementById('songList');
const addSongBtn = document.getElementById('addSongBtn');
const editSongBtn = document.getElementById('editSongBtn');
const deleteSongBtn = document.getElementById('deleteSongBtn');
const saveSongBtn = document.getElementById('saveSongBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const launchPresenterBtn = document.getElementById('launchPresenterBtn');
const layoutToggle = document.getElementById('layoutToggle');
const modeToggle = document.getElementById('modeToggle');
const slideControls = document.getElementById('slideControls');
const prevSlideBtn = document.getElementById('prevSlideBtn');
const nextSlideBtn = document.getElementById('nextSlideBtn');
const slideIndicator = document.getElementById('slideIndicator');
const scrollControls = document.getElementById('scrollControls');
const autoScrollToggle = document.getElementById('autoScrollToggle');
const scrollSpeedSlider = document.getElementById('scrollSpeedSlider');
const transposeDownBtn = document.getElementById('transposeDownBtn');
const transposeUpBtn = document.getElementById('transposeUpBtn');
const transposeBadgeEl = document.getElementById('transposeBadge');
const keyDisplayEl = document.getElementById('keyDisplay');
const chordsOnlyBtn = document.getElementById('chordsOnlyBtn');
const songViewer = document.getElementById('songViewer');
const songEditor = document.getElementById('songEditor');
const viewTitle = document.getElementById('viewTitle');
const viewArtist = document.getElementById('viewArtist');
const viewLyrics = document.getElementById('viewLyrics');
const editTitle = document.getElementById('editTitle');
const editArtist = document.getElementById('editArtist');
const editContent = document.getElementById('editContent');
const shareSongBtn = document.getElementById('shareSongBtn');
const shareBanner = document.getElementById('shareBanner');
const shareUrlInput = document.getElementById('shareUrlInput');
const copyShareBtn = document.getElementById('copyShareBtn');
const closeShareBtn = document.getElementById('closeShareBtn');

// Auth UI Elements
const loginShowBtn = document.getElementById('loginShowBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfoEl = document.getElementById('userInfo');
const userEmailEl = document.getElementById('userEmail');
const roomCodeDisplayEl = document.getElementById('roomCodeDisplay');
const authModal = document.getElementById('authModal');
const googleLoginBtn = document.getElementById('googleLoginBtn');
const closeAuthBtn = document.getElementById('closeAuthBtn');
const authErrorEl = document.getElementById('authError');

// --- FIREBASE LOGIC ---

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        userInfoEl.style.display = 'flex';
        userEmailEl.textContent = user.email;
        loginShowBtn.style.display = 'none';
        authModal.style.display = 'none';
        
        // Load songs
        const q = query(collection(db, "songs"), where("userId", "==", user.uid));
        onSnapshot(q, (snapshot) => {
            songs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (songs.length > 0 && !activeSongId) {
                activeSongId = songs[0].id;
            }
            updateSongList();
            renderView();
        });

        // Room Code Logic
        await handleRoomCode(user.uid);

        // Migrate localStorage if any
        await migrateLocalStorage(user.uid);
    } else {
        userInfoEl.style.display = 'none';
        loginShowBtn.style.display = 'block';
        roomCodeDisplayEl.textContent = '';
        songs = [];
        activeSongId = null;
        updateSongList();
        renderView();
    }
});

async function handleRoomCode(uid) {
    // Check if user already has a room code
    const q = query(collection(db, "rooms"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    
    let roomCode;
    if (snapshot.empty) {
        // Generate new 6-char code
        roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        await setDoc(doc(db, "rooms", roomCode), {
            userId: uid,
            createdAt: serverTimestamp()
        });
    } else {
        roomCode = snapshot.docs[0].id;
    }
    
    roomCodeDisplayEl.textContent = `Room: ${roomCode}`;
    roomCodeDisplayEl.dataset.code = roomCode;
}

async function migrateLocalStorage(uid) {
    const localSongs = JSON.parse(localStorage.getItem('songs'));
    if (localSongs && localSongs.length > 0) {
        for (const song of localSongs) {
            // Check if already exists (simple title check)
            const exists = songs.find(s => s.title === song.title);
            if (!exists) {
                await addDoc(collection(db, "songs"), {
                    title: song.title,
                    artist: song.artist,
                    content: song.content,
                    userId: uid,
                    createdAt: serverTimestamp()
                });
            }
        }
        localStorage.removeItem('songs');
    }
}

async function broadcastState() {
    if (!currentUser) return;
    const activeSong = songs.find(s => s.id === activeSongId);
    if (!activeSong) return;

    try {
        await setDoc(doc(db, "states", currentUser.uid), {
            song: activeSong,
            transpose: currentTranspose,
            layout: presenterLayout,
            mode: currentMode,
            slideIndex: currentSlideIndex,
            autoScroll: currentAutoScroll,
            scrollSpeed: currentScrollSpeed,
            chordOnlyMode: chordOnlyMode,
            updatedAt: serverTimestamp()
        });
    } catch (err) {
        console.error("Error broadcasting state:", err);
    }
}

// --- APP LOGIC ---

function updateSongList() {
    songListEl.innerHTML = '';
    songs.forEach(song => {
        const li = document.createElement('li');
        li.textContent = song.title || 'Untitled';
        if (song.id === activeSongId) li.classList.add('active');
        li.addEventListener('click', () => {
            activeSongId = song.id;
            currentTranspose = 0;
            chordOnlyMode = false;
            if (chordsOnlyBtn) {
                chordsOnlyBtn.textContent = 'Chords Only';
                chordsOnlyBtn.classList.remove('toggle-active');
            }
            renderView();
            updateSongList();
        });
        songListEl.appendChild(li);
    });
}

function renderView() {
    const activeSong = songs.find(s => s.id === activeSongId);
    if (activeSong) {
        viewTitle.textContent = activeSong.title;
        viewArtist.textContent = activeSong.artist;
        viewLyrics.innerHTML = parseLyricsWithChords(activeSong.content, currentTranspose, 'scroll', 0);
        
        const baseKey = detectKey(activeSong.content);
        if (keyDisplayEl) {
            if (baseKey) {
                const currentKey = transposeChord(baseKey, currentTranspose);
                keyDisplayEl.textContent = `Key: ${currentKey}`;
                keyDisplayEl.style.display = 'inline-flex';
            } else {
                keyDisplayEl.style.display = 'none';
            }
        }
        
        if (transposeBadgeEl) {
            const sign = currentTranspose > 0 ? '+' : '';
            transposeBadgeEl.textContent = `${sign}${currentTranspose}`;
            transposeBadgeEl.style.color = currentTranspose !== 0 ? 'var(--accent)' : '';
        }
        
        if (chordOnlyMode) viewLyrics.classList.add('chords-only');
        else viewLyrics.classList.remove('chords-only');
        
        if (currentMode === 'slides') {
            const paragraphs = activeSong.content.split(/\n\s*\n/);
            if (slideControls) slideControls.style.display = 'flex';
            if (scrollControls) scrollControls.style.display = 'none';
            if (slideIndicator) slideIndicator.textContent = `Slide ${currentSlideIndex + 1} / ${paragraphs.length}`;
        } else {
            if (slideControls) slideControls.style.display = 'none';
            if (scrollControls) scrollControls.style.display = 'flex';
        }
        
        songViewer.classList.add('active');
        songEditor.classList.remove('active');
        editSongBtn.style.display = 'inline-flex';
        deleteSongBtn.style.display = 'inline-flex';
    } else {
        viewTitle.textContent = 'No Song Selected';
        viewArtist.textContent = currentUser ? 'Select or add a song to begin.' : 'Please login to manage songs.';
        viewLyrics.innerHTML = '';
        if (keyDisplayEl) keyDisplayEl.style.display = 'none';
        if (transposeBadgeEl) transposeBadgeEl.textContent = '0';
        editSongBtn.style.display = 'none';
        deleteSongBtn.style.display = 'none';
    }
    broadcastState();
}

// --- LISTENERS ---

addSongBtn.addEventListener('click', () => {
    if (!currentUser) { alert("Please login first"); return; }
    activeSongId = null;
    currentTranspose = 0;
    editTitle.value = '';
    editArtist.value = '';
    editContent.value = '';
    songViewer.classList.remove('active');
    songEditor.classList.add('active');
    updateSongList();
});

editSongBtn.addEventListener('click', () => {
    const activeSong = songs.find(s => s.id === activeSongId);
    if (!activeSong) return;
    editTitle.value = activeSong.title;
    editArtist.value = activeSong.artist;
    editContent.value = activeSong.content;
    songViewer.classList.remove('active');
    songEditor.classList.add('active');
});

saveSongBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    const title = editTitle.value.trim();
    const artist = editArtist.value.trim();
    const content = editContent.value;
    
    if (!title) { alert("Title is required"); return; }
    
    try {
        if (activeSongId) {
            await updateDoc(doc(db, "songs", activeSongId), { title, artist, content });
        } else {
            const docRef = await addDoc(collection(db, "songs"), {
                title, artist, content, userId: currentUser.uid, createdAt: serverTimestamp()
            });
            activeSongId = docRef.id;
        }
        renderView();
    } catch (err) {
        alert("Error saving song");
    }
});

cancelEditBtn.addEventListener('click', () => {
    if (songs.length > 0 && !activeSongId) activeSongId = songs[0].id;
    renderView();
});

deleteSongBtn.addEventListener('click', async () => {
    if (!activeSongId) return;
    if (confirm('Are you sure you want to delete this song?')) {
        try {
            await deleteDoc(doc(db, "songs", activeSongId));
            activeSongId = songs.length > 0 ? songs[0].id : null;
            currentTranspose = 0;
            renderView();
        } catch (err) {
            alert("Error deleting song");
        }
    }
});

transposeUpBtn.addEventListener('click', () => { if (activeSongId) { currentTranspose++; renderView(); } });
transposeDownBtn.addEventListener('click', () => { if (activeSongId) { currentTranspose--; renderView(); } });

layoutToggle.addEventListener('change', (e) => { presenterLayout = e.target.value; broadcastState(); });
modeToggle.addEventListener('change', (e) => { currentMode = e.target.value; currentSlideIndex = 0; renderView(); });

if (autoScrollToggle) autoScrollToggle.addEventListener('change', (e) => { currentAutoScroll = e.target.checked; broadcastState(); });
if (scrollSpeedSlider) scrollSpeedSlider.addEventListener('input', (e) => { currentScrollSpeed = parseInt(e.target.value, 10); broadcastState(); });

function handlePrevSlide() {
    if (currentMode !== 'slides' || currentSlideIndex <= 0) return;
    currentSlideIndex--;
    renderView();
}

function handleNextSlide() {
    if (currentMode !== 'slides') return;
    const activeSong = songs.find(s => s.id === activeSongId);
    if (!activeSong) return;
    const paragraphs = activeSong.content.split(/\n\s*\n/);
    if (currentSlideIndex < paragraphs.length - 1) {
        currentSlideIndex++;
        renderView();
    }
}

if (prevSlideBtn) prevSlideBtn.addEventListener('click', handlePrevSlide);
if (nextSlideBtn) nextSlideBtn.addEventListener('click', handleNextSlide);

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (currentMode === 'slides') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrevSlide(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); handleNextSlide(); }
    }
});

launchPresenterBtn.addEventListener('click', () => {
    if (!currentUser) { alert("Login to sync with presenter"); return; }
    const roomCode = roomCodeDisplayEl.dataset.code;
    if (roomCode) {
        window.open(`presenter.html?room=${roomCode}`, 'ChordPresenterDisplay', 'width=1280,height=720');
    } else {
        alert("Room code not ready. Try again in a moment.");
    }
});

if (chordsOnlyBtn) {
    chordsOnlyBtn.addEventListener('click', () => {
        chordOnlyMode = !chordOnlyMode;
        chordsOnlyBtn.textContent = chordOnlyMode ? 'Show Lyrics' : 'Chords Only';
        chordsOnlyBtn.classList.toggle('toggle-active', chordOnlyMode);
        renderView();
    });
}

// --- SHARE LOGIC ---

shareSongBtn.addEventListener('click', async () => {
    const activeSong = songs.find(s => s.id === activeSongId);
    if (!activeSong) { alert('Select a song first'); return; }

    try {
        const shareRef = await addDoc(collection(db, "shares"), {
            song: activeSong,
            createdAt: serverTimestamp()
        });
        const shareUrl = `${window.location.origin}${window.location.pathname}?share=${shareRef.id}`;
        shareUrlInput.value = shareUrl;
        shareBanner.style.display = 'flex';
    } catch (err) {
        alert('Failed to generate share link');
    }
});

copyShareBtn.addEventListener('click', () => {
    shareUrlInput.select();
    document.execCommand('copy');
    copyShareBtn.textContent = 'Copied!';
    setTimeout(() => copyShareBtn.textContent = 'Copy', 2000);
});

closeShareBtn.addEventListener('click', () => shareBanner.style.display = 'none');

// --- AUTH UI HANDLERS ---

loginShowBtn.addEventListener('click', () => {
    authModal.style.display = 'flex';
    authErrorEl.style.display = 'none';
});

closeAuthBtn.addEventListener('click', () => authModal.style.display = 'none');

googleLoginBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        authErrorEl.textContent = err.message;
        authErrorEl.style.display = 'block';
    }
});

logoutBtn.addEventListener('click', () => signOut(auth));

// --- LOAD SHARED SONG ---

const urlParams = new URLSearchParams(window.location.search);
const shareId = urlParams.get('share');
if (shareId) {
    const loadShare = async () => {
        const shareDoc = await getDoc(doc(db, "shares", shareId));
        if (shareDoc.exists()) {
            const sharedSong = shareDoc.data().song;
            if (currentUser) {
                // Save to their library
                const exists = songs.find(s => s.title === sharedSong.title);
                if (!exists) {
                    const docRef = await addDoc(collection(db, "songs"), {
                        ...sharedSong,
                        userId: currentUser.uid,
                        createdAt: serverTimestamp()
                    });
                    activeSongId = docRef.id;
                } else {
                    activeSongId = exists.id;
                }
            } else {
                // Temporary view? For now let's just push it to a local list if not logged in
                // or force login. Let's just alert.
                alert("Login to save this shared song to your library.");
            }
            // Clean URL
            const newUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, '', newUrl);
        }
    };
    loadShare();
}
