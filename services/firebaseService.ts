
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
  
  provider.addScope('https://www.googleapis.com/auth/user.birthday.read');
  provider.addScope('https://www.googleapis.com/auth/user.gender.read');
  
  const result = await signInWithPopup(auth, provider);
  const user = result.user;
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;

  let gender: 'male' | 'female' = 'male';
  let age = 20;

  if (token) {
    try {
      const response = await fetch('https://people.googleapis.com/v1/people/me?personFields=birthdays,genders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.genders && data.genders.length > 0) {
        gender = data.genders[0].value === 'female' ? 'female' : 'male';
      }
      if (data.birthdays && data.birthdays.length > 0) {
        const birthday = data.birthdays.find((b: any) => b.date && b.date.year);
        if (birthday) {
          const currentYear = new Date().getFullYear();
          age = currentYear - birthday.date.year;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch extra profile info from Google:", e);
    }
  }

  if (user && user.email) {
    return {
      name: user.displayName || 'User',
      email: user.email,
      picture: user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=4f46e5&color=fff`,
      gender: gender,
      age: age,
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
  if (userSnap.exists()) {
    return userSnap.data() as UserProfile;
  }
  return null;
};

// Admin reporting: Log failure of a shared key
export const logApiKeyFailure = async (key: string, errorMessage: string) => {
  if (!db) return;
  const keyId = `key_${key.slice(-6)}`;
  const healthRef = doc(db, 'system', 'api_health', 'keys', keyId);
  
  let status: 'expired' | 'rate-limited' = 'rate-limited';
  if (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('invalid')) {
    status = 'expired';
  }

  await setDoc(healthRef, {
    keyId,
    lastError: errorMessage,
    failureCount: increment(1),
    lastChecked: Timestamp.now(),
    status: status
  }, { merge: true });
};

// Admin reporting: Get all key health data
export const getApiKeyHealthReport = async (): Promise<ApiKeyHealth[]> => {
  if (!db) throw new Error("Database connection not established.");
  
  try {
    const healthRef = collection(db, 'system', 'api_health', 'keys');
    const snap = await getDocs(healthRef);
    if (snap.empty) return [];
    
    return snap.docs.map(d => {
      const data = d.data();
      return {
        keyId: data.keyId,
        lastError: data.lastError,
        failureCount: data.failureCount,
        lastChecked: data.lastChecked.toDate(),
        status: data.status
      } as ApiKeyHealth;
    });
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      throw new Error("Missing Firestore permissions for the system collection. Check the Rules tab in Firebase.");
    }
    throw err;
  }
};

export const adminListAllUsers = async (): Promise<any[]> => {
  if (!db) return [];
  const usersRef = collection(db, 'users');
  const querySnapshot = await getDocs(usersRef);
  return querySnapshot.docs.map(doc => ({
    email: doc.id,
    ...doc.data()
  }));
};

// Helper to sanitize messages for Firestore (strips base64 image data)
const sanitizeMessages = (messages: Message[]) => {
  return messages.map(m => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { imagePart, ...rest } = m; // Remove imagePart to save space
    return {
      ...rest,
      timestamp: Timestamp.fromDate(new Date(m.timestamp))
    };
  });
};

export const saveSession = async (email: string, session: ChatSession) => {
  if (!db) return;
  const sessionRef = doc(db, 'users', email, 'sessions', session.id);
  const serializedMessages = sanitizeMessages(session.messages);

  await setDoc(sessionRef, {
    id: session.id,
    title: session.title,
    createdAt: Timestamp.fromDate(new Date(session.createdAt)),
    messages: serializedMessages
  });
};

export const updateSessionMessages = async (email: string, sessionId: string, messages: Message[]) => {
  if (!db) return;
  const sessionRef = doc(db, 'users', email, 'sessions', sessionId);
  const serializedMessages = sanitizeMessages(messages);
  
  try {
    // Using setDoc with merge:true is often safer than updateDoc
    await setDoc(sessionRef, { messages: serializedMessages }, { merge: true });
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
      id: data.id,
      title: data.title,
      createdAt: (data.createdAt as Timestamp).toDate(),
      messages: (data.messages as any[]).map(m => ({
        ...m,
        timestamp: (m.timestamp as Timestamp).toDate()
      }))
    };
  });
};

export const deleteSession = async (email: string, sessionId: string) => {
  if (!db) return;
  const sessionRef = doc(db, 'users', email, 'sessions', sessionId);
  await deleteDoc(sessionRef);
};
