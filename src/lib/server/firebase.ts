import "server-only";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export const EXPECTED_PROJECT_ID = "quote-forge-54595";
export function adminServices() {
  if (process.env.QUOTEFORGE_FIREBASE_ENABLED !== "true") throw new Error("Firebase is not configured.");
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const emulators = process.env.QUOTEFORGE_USE_EMULATORS === "true";
  if (emulators) {
    if (process.env.NODE_ENV === "production" || projectId !== "demo-quoteforge") throw new Error("Emulators require the isolated development project.");
    for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(process.env[key] || "")) throw new Error("Every emulator must use an explicit loopback address.");
  } else if (projectId !== EXPECTED_PROJECT_ID || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error("Firebase project mismatch or unintended emulator configuration.");
  }
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (emulators ? "demo-quoteforge.appspot.com" : EXPECTED_PROJECT_ID + ".firebasestorage.app");
  if (![projectId + ".appspot.com", projectId + ".firebasestorage.app"].includes(storageBucket)) throw new Error("Storage bucket must belong to this Firebase project.");
  const existing = getApps().find(app => app.name === "quoteforge");
  if (existing && existing.options.projectId !== projectId) throw new Error("An existing Firebase app targets a different project.");
  const credential = emulators ? applicationDefault()
    : process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY
      ? cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") })
      : applicationDefault();
  const app = existing || initializeApp({ projectId, storageBucket, credential }, "quoteforge");
  return { auth: getAuth(app), db: getFirestore(app), bucket: getStorage(app).bucket(storageBucket) };
}
