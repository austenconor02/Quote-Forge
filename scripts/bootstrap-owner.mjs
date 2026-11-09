import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID;
const uid = process.env.QUOTEFORGE_OWNER_UID;
const email = "austenconor02@gmail.com";
if (projectId !== "quote-forge-54595" || !uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Set the exact QuoteForge project and intended Firebase Auth UID; emulators are not accepted by this administrator tool.");
const app = initializeApp({projectId, credential: applicationDefault()}, "owner-bootstrap");
const auth = getAuth(app), db = getFirestore(app);
const user = await auth.getUser(uid);
if (user.email?.toLowerCase() !== email || !user.emailVerified || user.disabled || !user.providerData.some(provider => provider.providerId === "google.com")) throw new Error("This UID does not belong to the verified designated Google account.");
await db.runTransaction(async transaction => {const reference = db.doc("platform/config"); const current = await transaction.get(reference); if (current.exists && current.data()?.ownerUid !== uid) throw new Error("An established owner cannot be replaced by this tool."); if (!current.exists) transaction.create(reference, {ownerUid: uid, ownerEmail: email, createdAt: new Date().toISOString()});});
await auth.setCustomUserClaims(uid, {...user.customClaims, platformOwner: true});
console.log("Verified owner UID anchored and owner claim configured. Sign in again; keep runtime bootstrap disabled.");
await db.terminate();
