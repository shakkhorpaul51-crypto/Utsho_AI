
import { GoogleGenAI } from "@google/genai";

const getApiKey = () => process.env.GEMINI_API_KEY || "";

export const generateImage = async (prompt: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Gemini API Key not found in environment.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K"
        }
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64EncodeString = part.inlineData.data;
        return `data:image/png;base64,${base64EncodeString}`;
      }
    }
    
    throw new Error("No image data returned from Gemini.");
  } catch (error: any) {
    console.error("GEMINI_IMAGE_GEN_ERROR:", error);
    throw error;
  }
};
