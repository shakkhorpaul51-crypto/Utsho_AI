
import { GoogleGenAI } from "@google/genai";

/**
 * Generates an image using Gemini 2.5 Flash Image.
 * Note: This uses the platform-provided Gemini API key.
 */
export const generateImage = async (prompt: string): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `Generate a high-quality image based on this description: ${prompt}. Style: Artistic, detailed, and vibrant.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64EncodeString = part.inlineData.data;
        return `data:image/png;base64,${base64EncodeString}`;
      }
    }
    
    throw new Error("No image data returned from model.");
  } catch (error: any) {
    console.error("IMAGE_SERVICE: Error generating image:", error);
    throw new Error(`Image Generation Failed: ${error.message}`);
  }
};
