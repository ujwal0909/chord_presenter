# Chord Presenter - Documentation

Chord Presenter is a "serverless" web application designed for musicians to manage song libraries, transpose chords in real-time, and synchronize lyrics with an external display (TV/Projector) using a simple 6-digit **Room Code**.

## 🚀 Architecture & Tech Stack

The application is built entirely as a **Frontend-only** app that leverages **Firebase** for all backend requirements.

-   **Frontend**: Vanilla HTML5, CSS3, and JavaScript (ES Modules).
-   **Authentication**: Firebase Auth (Email/Password).
-   **Database**: Cloud Firestore (Real-time storage for songs and shared states).
-   **Sync Engine**: Firestore `onSnapshot` listeners provide instant, low-latency updates between the control panel and the presenter view.

---

## 🛠 Features

### 1. Song Management
- Add, edit, and delete songs with inline chords (e.g., `[G] Amazing [C] Grace`).
- Automatic migration: Your first login will automatically upload any songs previously saved in your browser's local storage to the cloud.

### 2. Transposition & Formatting
- **Transpose**: Change keys on the fly using the `+` and `-` buttons. The app handles sharp/flat logic automatically.
- **Display Modes**: Toggle between **Slides** (paragraph by paragraph) and **Scroll** (continuous flow).
- **Chords Only**: A specialized mode to hide lyrics and show only chords for advanced musicians.

### 3. Real-time Presenter Sync (Option B)
- **Room Codes**: Every user is assigned a unique 6-character Room Code (e.g., `B4X9KL`) upon login.
- **Remote Link**: Open `presenter.html?room=XXXXXX` on any internet-connected screen to follow the active song and transposition from the control panel.

---

## 💻 How to Run Locally

The application acts as a Single Page Application (SPA) that communicates directly with Firebase.

### Setup Checklist
1.  **Google Auth**: Enable Google Sign-In in your Firebase Console.
2.  **Firestore**:
    - Creation: Initialize Firestore in **Production Mode**.
    - Security: Use the provided **[firestore.rules](file:///Users/ujwal/.gemini/antigravity/scratch/chord-presenter/firestore.rules)**. 
3.  **Local Server**: Run a static server in the project root:
    ```bash
    npx live-server
    ```
    or
    ```bash
    python3 -m http.server 8000
    ```

---

## 📁 Project Configuration

The project includes pre-configured files for security and hosting:

-   **[firebase-config.js](file:///Users/ujwal/.gemini/antigravity/scratch/chord-presenter/firebase-config.js)**: Contains your Firebase SDK settings.
-   **[firestore.rules](file:///Users/ujwal/.gemini/antigravity/scratch/chord-presenter/firestore.rules)**: Defines data access permissions.
-   **[firebase.json](file:///Users/ujwal/.gemini/antigravity/scratch/chord-presenter/firebase.json)**: Configuration for Firebase Hosting.

---

## 🌍 Deployment

Since the app is "serverless" (no Python backend needed!), it is ready to be hosted on **Firebase Hosting**:

1.  **Initialize**:
    ```bash
    firebase login
    firebase init
    ```
    - Select `Hosting`.
    - Choose your existing project `chord-presenter`.
    - For the public directory, use `.` (current folder).
    - If prompted to overwrite `firebase.json` or `index.html`, select **No**.
2.  **Deploy**:
    ```bash
    firebase deploy
    ```
