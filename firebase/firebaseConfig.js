const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCst1R5C_Nbm4LfONZy_DW0JNXzlH3LL7U",
  authDomain: "voiceagent-c8f98.firebaseapp.com",
  databaseURL: "https://voiceagent-c8f98-default-rtdb.firebaseio.com",
  projectId: "voiceagent-c8f98",
  storageBucket: "voiceagent-c8f98.firebasestorage.app",
  messagingSenderId: "905853488691",
  appId: "1:905853488691:web:6f68e799b5f3232803dd46",
  measurementId: "G-507J5FBX74"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

module.exports = { db };