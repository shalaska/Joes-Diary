import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCxJXwXV_WGmpRcfid_2yrd9AIfW5QD9GQ',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'joesdiary-d8211.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'joesdiary-d8211',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'joesdiary-d8211.firebasestorage.app',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '837714540398',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:837714540398:web:2fd44cc5f44e844ddfb37f',
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-H5MY1ZQ7L9'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
