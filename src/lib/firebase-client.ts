"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBL9P793q5z7o6Baqg-o2yuIteYU6IHrug",
  authDomain: "australian-energy-assessments.firebaseapp.com",
  projectId: "australian-energy-assessments",
  storageBucket: "australian-energy-assessments.firebasestorage.app",
  messagingSenderId: "169611555810",
  appId: "1:169611555810:web:4bc06afa3c86cd64a37fbb",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(app);
