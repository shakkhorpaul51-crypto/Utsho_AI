
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  deleteDoc,
  updateDoc,
  increment,
  Timestamp,
  Firestore
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  Auth 
} from 'firebase/auth';
import { UserProfile, ChatSession, Message, ApiKeyHealth } from '../types';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const ADMIN_EMAIL = 'shakkhorpaul50@gmail.com';
const DEBI_EMAIL = 'nitebiswaskotha@gmail.com';

const isConfigValid = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

let db: Firestore | null = null;
let auth: Auth | null = null;

if (isConfigValid) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
}

export const isDatabaseEnabled = () => !!db;
export const isAdmin = (email: string) => email.toLowerCase().trim() === ADMIN_EMAIL;
export const isDebi = (email: string) => email.toLowerCase().trim() === DEBI_EMAIL;

export const loginWithGoogle = async (): Promise<UserProfile | null> => {
  if (!auth) throw new Error("Auth not initialized");
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  if (user && user.email) {
    return {
      name: user.displayName || 'User',
      email: user.email,
      picture: user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=4f46e5&color=fff`,
      gender: 'male', // Default, will be updated in onboarding
      age: 0,        // Default, will be updated in onboarding
      googleId: user.uid
    };
  }
  return null;
};

export const saveUserProfile = async (profile: UserProfile) => {
  if (!db || !profile.email) return;
  const userRef = doc(db, 'users', profile.email);
  await setDoc(userRef, {
    name: profile.name,
    email: profile.email,
    gender: profile.gender,
    age: profile.age,
    picture: profile.picture,
    googleId: profile.googleId || '',
    customApiKey: profile.customApiKey || ''
  }, { merge: true });
};

export const getUserProfile = async (email: string): Promise<UserProfile | null> => {
  if (!db) return null;
  const userRef = doc(db, 'users', email);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) return userSnap.data() as UserProfile;
  return null;
};

export const logApiKeyFailure = async (key: string, errorMessage: string) => {
  if (!db) return;
  const keyId = `key_${key.slice(-6)}`;
  const healthRef = doc(db, 'system', 'api_health', 'keys', keyId);
  let status: 'expired' | 'rate-limited' = 'rate-limited';
  if (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('invalid')) status = 'expired';
  await setDoc(healthRef, {
    keyId, lastError: errorMessage, failureCount: increment(1), lastChecked: Timestamp.now(), status: status
  }, { merge: true });
};

export const getApiKeyHealthReport = async (): Promise<ApiKeyHealth[]> => {
  if (!db) throw new Error("No database.");
  const healthRef = collection(db, 'system', 'api_health', 'keys');
  const snap = await getDocs(healthRef);
  return snap.docs.map(d => ({ ...d.data(), lastChecked: d.data().lastChecked.toDate() } as ApiKeyHealth));
};

export const adminListAllUsers = async (): Promise<any[]> => {
  if (!db) return [];
  const usersRef = collection(db, 'users');
  const querySnapshot = await getDocs(usersRef);
  return querySnapshot.docs.map(doc => ({ email: doc.id, ...doc.data() }));
};

const sanitizeMessages = (messages: Message[]) => {
  return messages.map(m => {
    // Completely remove huge binary data before saving to cloud
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { imagePart, imageUrl, ...rest } = m; 
    
    // Only keep imageUrl if it's a real HTTP URL, not a base64 data: string
    const cleanedImageUrl = (m.imageUrl && m.imageUrl.startsWith('http')) ? m.imageUrl : undefined;

    return {
      ...rest,
      imageUrl: cleanedImageUrl,
      timestamp: Timestamp.fromDate(new Date(m.timestamp))
    };
  });
};

export const saveSession = async (email: string, session: ChatSession) => {
  if (!db) return;
  const sessionRef = doc(db, 'users', email, 'sessions', session.id);
  await setDoc(sessionRef, {
    id: session.id,
    title: session.title,
    createdAt: Timestamp.fromDate(new Date(session.createdAt)),
    messages: sanitizeMessages(session.messages)
  });
};

export const updateSessionMessages = async (email: string, sessionId: string, messages: Message[]) => {
  if (!db) return;
  const sessionRef = doc(db, 'users', email, 'sessions', sessionId);
  try {
    await setDoc(sessionRef, { messages: sanitizeMessages(messages) }, { merge: true });
  } catch (e) {
    console.error("Firestore Save Error:", e);
    throw e;
  }
};

export const getSessions = async (email: string): Promise<ChatSession[]> => {
  if (!db) return [];
  const sessionsRef = collection(db, 'users', email, 'sessions');
  const q = query(sessionsRef, orderBy('createdAt', 'desc'));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      ...data,
      createdAt: (data.createdAt as Timestamp).toDate(),
      messages: (data.messages as any[]).map(m => ({ ...m, timestamp: (m.timestamp as Timestamp).toDate() }))
    } as ChatSession;
  });
};

export const deleteSession = async (email: string, sessionId: string) => {
  if (!db) return;
  const sessionRef = doc(db, 'users', email, 'sessions', sessionId);
  await deleteDoc(sessionRef);
};
