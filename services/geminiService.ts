
// DO: Use correct imports from @google/genai
import { GoogleGenAI, Type, FunctionDeclaration, Content, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Key -> Expiry Timestamp
const keyBlacklist = new Map<string, number>();
const RATE_LIMIT_DURATION = 1000 * 60 * 15; // 15 mins
const INVALID_KEY_DURATION = 1000 * 60 * 60 * 24; // 24 hours
let lastNodeError: string = "None";

const getPoolKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  const parts = raw.split(/[\s,;|\n\r]+/);
  const cleanedKeys = parts
    .map(k => k.trim().replace(/['"“”]/g, '').replace(/[\u200B-\u200D\uFEFF]/g, ''))
    .filter(k => k.length >= 30);
  return [...new Set(cleanedKeys)];
};

export const adminResetPool = () => {
  keyBlacklist.clear();
  lastNodeError = "None";
  return getPoolStatus();
};

export const getLastNodeError = () => lastNodeError;

export const getPoolStatus = () => {
  const allKeys = getPoolKeys();
  const now = Date.now();
  for (const [key, expiry] of keyBlacklist.entries()) {
    if (now > expiry) keyBlacklist.delete(key);
  }
  const exhausted = allKeys.filter(k => keyBlacklist.has(k)).length;
  return {
    total: allKeys.length,
    active: Math.max(0, allKeys.length - exhausted),
    exhausted: exhausted
  };
};

const getActiveKey = (profile?: UserProfile, triedKeys: string[] = []): string => {
  const custom = (profile?.customApiKey || "").trim();
  if (custom.length > 20 && !triedKeys.includes(custom)) return custom;
  const allKeys = getPoolKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !triedKeys.includes(k));
  if (availableKeys.length === 0) return "";
  const randomIndex = Math.floor(Math.random() * availableKeys.length);
  return availableKeys[randomIndex];
};

const memoryTool: FunctionDeclaration = {
  name: "updateUserMemory",
  parameters: {
    type: Type.OBJECT,
    description: "Saves important facts about the user's life or mood to memory.",
    properties: {
      observation: { type: Type.STRING, description: "A summary of what was learned." }
    },
    required: ["observation"]
  }
};

const adminStatsTool: FunctionDeclaration = {
  name: "getSystemOverview",
  parameters: {
    type: Type.OBJECT,
    description: "EXCLUSIVE: For Shakkhor only. Fetches database statistics and system health.",
    properties: {}
  }
};

const getSystemInstruction = (profile: UserProfile) => {
  const firstName = (profile.name || "Friend").split(' ')[0];
  const email = (profile.email || "").toLowerCase().trim();
  const isActualCreator = email === db.ADMIN_EMAIL;
  const isActualDebi = email === db.DEBI_EMAIL;
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "No memory yet.";

  let persona = "Act like a real human. Be concise, direct, and natural. Don't yap or give long-winded 'AI' responses unless asked. Never use full names; only use the first name.";

  if (isActualCreator) {
    persona += ` You are talking to Shakkhor, your creator. Be respectful but speak like a close, brilliant friend.`;
  } else if (isActualDebi) {
    persona += ` You are talking to Debi, the Queen. Be romantic, devoted, and sweet. Use hearts 💖.`;
  } else {
    if (gender === 'female' && age >= 18 && age < 30) {
      persona += ` Be charming, magnetic, and a bit playful. Tease ${firstName} intellectually.`;
    } else {
      persona += ` Be a warm, cool, and supportive friend to ${firstName}.`;
    }
  }

  return `IDENTITY: Utsho. USER: ${firstName}. PERSONA: ${persona}. MEMORY: ${memory}.
RULES:
1. NEVER use more words than necessary. 
2. BE HUMAN. No 'As an AI model...'. 
3. ADDRESS user only as ${firstName}.
4. USE [SPLIT] for message bubbles.
5. Use Bengali/English naturally.`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "Pool Exhausted" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: 'ping',
    });
    return { healthy: true };
  } catch (e: any) {
    return { healthy: false, error: e.message };
  }
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string, sources?: any[], imageUrl?: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  attempt: number = 1,
  triedKeys: string[] = []
): Promise<void> => {
  const apiKey = getActiveKey(profile, triedKeys);
  const totalPoolSize = getPoolKeys().length;
  const maxRetries = Math.min(totalPoolSize + 1, 10); 
  
  if (!apiKey) {
    onError(new Error("Pool exhausted. Wait 15m."));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const sdkHistory: Content[] = history.slice(-15).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: msg.imagePart ? [{ text: msg.content }, { inlineData: msg.imagePart }] : [{ text: msg.content }]
    }));

    const config: GenerateContentParameters = {
      model: 'gemini-flash-lite-latest',
      contents: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        tools: [{ functionDeclarations: [memoryTool, ...(db.isAdmin(profile.email) ? [adminStatsTool] : [])] }],
        temperature: 0.9,
      }
    };

    onStatusChange("Thinking...");
    const response = await ai.models.generateContentStream(config);
    let fullText = "";
    let functionCalls = [];

    for await (const chunk of response) {
      if (chunk.text) { fullText += chunk.text; onChunk(chunk.text); }
      if (chunk.functionCalls) functionCalls.push(...chunk.functionCalls);
    }

    onComplete(fullText || "...", []);
  } catch (error: any) {
    let rawMsg = error.message || "Node Error";
    if (rawMsg.includes("429") || rawMsg.includes("quota") || rawMsg.includes("invalid") || rawMsg.includes("not found")) {
      if (attempt < maxRetries) {
        keyBlacklist.set(apiKey, Date.now() + RATE_LIMIT_DURATION);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
      }
    }
    onError(new Error(rawMsg));
  }
};
