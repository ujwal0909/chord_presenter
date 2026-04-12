import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyAZZXPAiZS8K7oNidyOKEpZyllArGwav9o",
  authDomain: "chord-presenter.firebaseapp.com",
  projectId: "chord-presenter",
  storageBucket: "chord-presenter.firebasestorage.app",
  messagingSenderId: "567365552441",
  appId: "1:567365552441:web:600d730cc0f63a313040e8",
  measurementId: "G-4RXWD81MK1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const analytics = getAnalytics(app);

export { auth, db, analytics };
