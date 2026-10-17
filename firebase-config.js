// Public Firebase web config for the SleepLab project. Not a secret: every visitor's browser gets
// it anyway. What protects the data is firestore.rules (owner's UID only, whitelisted paths) plus
// the API key's HTTP-referrer and API restrictions in Google Cloud Console.
export const firebaseConfig = {
  apiKey: "AIzaSyDuj4_4lsiZXtodtiP8oVC0icBMWHtXDMk",
  authDomain: "sleeplab-59eb4.firebaseapp.com",
  projectId: "sleeplab-59eb4",
  storageBucket: "sleeplab-59eb4.firebasestorage.app",
  messagingSenderId: "254090270002",
  appId: "1:254090270002:web:ac20dc14c18614861c732b"
};
