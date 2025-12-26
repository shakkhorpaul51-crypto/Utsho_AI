
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const SYSTEM_INSTRUCTION = `You are a helpful, creative, and clever AI assistant powered by Gemini. 
Your goal is to provide accurate and helpful information while maintaining a professional yet friendly tone.
Use markdown for formatting when appropriate (lists, code blocks, bold text).
If you are asked to write code, always specify the language for syntax highlighting.`;

export const streamChatResponse = async (
  history: Message[],
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void
) => {
  try {
    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });

    // Convert internal history format to Gemini's expected format if needed
    // However, for simplicity and to avoid complex state management, we can also just send the last message
    // or manually build the history. Gemini chats.create doesn't take history directly in this simplified wrapper,
    // we would usually send all previous messages to chat.sendMessage or initialize with history.
    
    // For this implementation, we'll use the last message as the prompt, 
    // and if history is needed we would pass it to the chat constructor.
    const lastUserMessage = history[history.length - 1].content;
    
    const streamResponse = await chat.sendMessageStream({ message: lastUserMessage });
    
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    
    onComplete(fullText);
  } catch (error) {
    console.error("Gemini API Error:", error);
    onError(error);
  }
};
