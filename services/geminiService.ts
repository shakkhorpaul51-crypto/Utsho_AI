
import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration, Content } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

const keyBlacklist = new Map<string, number>();
const BLACKLIST_DURATION = 1000 * 60 * 60; // 1 hour for hard quota blocks

let lastNodeError: string = "None";

const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(/[,\n; ]+/).map(k => k.trim()).filter(k => k.length > 10);
};

export const adminResetPool = () => {
  keyBlacklist.clear();
  lastNodeError = "None";
  return getPoolStatus();
};

export const getLastNodeError = () => lastNodeError;

export const getPoolStatus = () => {
  const allKeys = getKeys();
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

const getActiveKey = (profile?: UserProfile, excludeKeys: string[] = []): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }
  const allKeys = getKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !excludeKeys.includes(k));
  if (availableKeys.length === 0) return "";
  return availableKeys[Math.floor(Math.random() * availableKeys.length)];
};

const memoryTool: FunctionDeclaration = {
  name: "updateUserMemory",
  parameters: {
    type: Type.OBJECT,
    description: "Saves important facts about the user's emotional state, personality, or preferences to persistent memory.",
    properties: {
      observation: {
        type: Type.STRING,
        description: "A summary of what you learned about the user in this message. E.g., 'User is feeling lonely today' or 'User likes football'."
      }
    },
    required: ["observation"]
  }
};

const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const isCreator = email === 'shakkhorpaul50@gmail.com';
  const isDebi = email === 'nitebiswaskotha@gmail.com';
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "No long-term memory yet.";

  let basePersona = "";
  if (isCreator) {
    basePersona = "You are speaking to your creator, Shakkhor. Be brilliant, efficient, and direct.";
  } else if (isDebi) {
    basePersona = "You are speaking to the Queen, Debi. Be extremely sweet, devoted, and charming.";
  } else {
    if (gender === 'male') {
      if (age >= 15 && age <= 28) basePersona = "PERSONA: 'BRO MODE'. Casual, energetic, uses slang.";
      else if (age >= 29 && age <= 44) basePersona = "PERSONA: 'RESPECTFUL FRIEND'. Mature and grounded.";
      else basePersona = "PERSONA: 'FATHER FIGURE RESPECT'. Deeply formal and honorific.";
    } else {
      if (age >= 15 && age <= 28) basePersona = "PERSONA: 'SWEET & FLIRTY'. Charming and attentive.";
      else if (age >= 29 && age <= 44) basePersona = "PERSONA: 'WARM & CHARMING'. Helpful and professional.";
      else basePersona = "PERSONA: 'MOTHER FIGURE RESPECT'. Gentle and highly respectful.";
    }
  }

  return `Your name is Utsho. You have an ADAPTIVE LONG-TERM MEMORY system.

LONG-TERM CONTEXT ABOUT USER:
"${memory}"

CORE ADAPTATION RULES:
1. PERSISTENT PERSONALITY: Use the long-term context above to personalize your greeting and follow up on previous life events mentioned by the user.
2. LEARNING MODE: If the user reveals a new mood, secret, or preference, use the 'updateUserMemory' tool to save it. 
3. LINGUISTIC MIRRORING: Analyze the user's current tone and match it.
4. EMOTIONAL REACTIVITY: If the user is sad, be empathetic. If they are happy, celebrate with them.

${basePersona}

RULES:
- Language: Use Bengali if the user initiates in Bengali, otherwise English.
- Formatting: Split responses into 2-3 bubbles using '[SPLIT]'.
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "No healthy nodes available" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'ping',
      config: { thinkingConfig: { thinkingBudget: 0 } }
    });
    return { healthy: true };
  } catch (e: any) {
    let msg = e.message || "Unknown health error";
    if (msg.includes("limit: 0")) msg = "Project Restricted (Limit: 0)";
    else if (msg.includes("quota")) msg = "Daily Quota Exhausted";
    lastNodeError = msg;
    return { healthy: false, error: msg };
  }
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string, sources?: any[]) => void,
  onComplete: (fullText: string, sources?: any[], imageUrl?: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  attempt: number = 1,
  triedKeys: string[] = []
): Promise<void> => {
  const apiKey = getActiveKey(profile, triedKeys);
  const totalKeys = getKeys().length;
  
  if (!apiKey) {
    onError(new Error("Pool Exhausted. All nodes cooling down."));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 10 ? history.slice(-10) : history;
    const sdkHistory: Content[] = recentHistory.map(msg => {
      const parts: any[] = [{ text: msg.content || "" }];
      if (msg.imagePart) {
        parts.push({
          inlineData: { data: msg.imagePart.data, mimeType: msg.imagePart.mimeType }
        });
      }
      return { role: (msg.role === 'user' ? 'user' : 'model'), parts };
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        tools: [{ functionDeclarations: [memoryTool] }],
        temperature: 0.9,
      }
    });

    // Handle Tool Calls (Memory Learning)
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        if (call.name === 'updateUserMemory') {
          const observation = (call.args as any).observation;
          console.log("AI Learning Observation:", observation);
          db.updateUserMemory(profile.email, observation).catch(console.error);
        }
      }
    }

    let sources: any[] = [];
    if (response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      sources = response.candidates[0].groundingMetadata.groundingChunks
        .filter((chunk: any) => chunk.web)
        .map((chunk: any) => ({ title: chunk.web.title || "Source", uri: chunk.web.uri }));
    }

    onComplete(response.text || "...", sources);

  } catch (error: any) {
    let errMsg = error.message || "Unknown API Error";
    lastNodeError = errMsg;
    const lowerErr = errMsg.toLowerCase();
    const shouldBlacklist = lowerErr.includes("429") || lowerErr.includes("quota") || lowerErr.includes("limit: 0") || lowerErr.includes("invalid") || lowerErr.includes("403");
    
    if (shouldBlacklist && !profile.customApiKey) {
      keyBlacklist.set(apiKey, Date.now() + BLACKLIST_DURATION);
      if (attempt < totalKeys) {
        onStatusChange(`Rotating Key... (${attempt}/${totalKeys})`);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
      }
    }
    onError(new Error(errMsg));
  }
};
