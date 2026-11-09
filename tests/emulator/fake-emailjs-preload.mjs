// QA-only transport: the real EmailJS host is never contacted. Never import from application code.
if (process.env.QUOTEFORGE_USE_EMULATORS !== "true" || process.env.FIREBASE_PROJECT_ID !== "demo-quoteforge" || process.env.EMAILJS_PUBLIC_KEY !== "public-test" || process.env.EMAILJS_PRIVATE_KEY !== "private-test" || process.env.NODE_ENV === "production") throw new Error("Fake email transport requires isolated development emulator credentials.");
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return original(url === "https://api.emailjs.com/api/v1.0/email/send" ? "http://127.0.0.1:9444/capture" : input, init);
};
