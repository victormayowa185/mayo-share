import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";

// Replace with your actual Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDSxv2Qi_MtyEHqwwQSyd-Q8e9mkoR1u-Q",
  authDomain: "mayo-share.firebaseapp.com",
  projectId: "mayo-share",
  storageBucket: "mayo-share.firebasestorage.app",
  messagingSenderId: "886360954373",
  appId: "1:886360954373:web:c0d4d230bbb18d3d412e6c",
  measurementId: "G-N7G8MWP8PG",
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export async function saveRating(ratingData: {
  rating: number;
  timestamp: string;
  appVersion: string;
}) {
  return addDoc(collection(db, "ratings"), ratingData);
}
