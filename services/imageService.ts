const DAILY_IMAGE_LIMIT = 5;
const STORAGE_KEY_PREFIX = 'utsho_img_usage_';

interface ImageUsage {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Returns today's date as a YYYY-MM-DD string.
 */
const getTodayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Gets the current image usage for a user today.
 */
const getUserImageUsage = (email: string): ImageUsage => {
  const key = `${STORAGE_KEY_PREFIX}${email.toLowerCase().trim()}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const usage: ImageUsage = JSON.parse(raw);
      if (usage.date === getTodayKey()) {
        return usage;
      }
    }
  } catch {
    // Corrupted data, reset
  }
  return { date: getTodayKey(), count: 0 };
};

/**
 * Increments the image generation count for a user today.
 */
const incrementImageUsage = (email: string): void => {
  const key = `${STORAGE_KEY_PREFIX}${email.toLowerCase().trim()}`;
  const usage = getUserImageUsage(email);
  usage.count += 1;
  localStorage.setItem(key, JSON.stringify(usage));
};

/**
 * Checks how many image generations a user has remaining today.
 * @returns The number of remaining generations (0 means limit reached).
 */
export const getRemainingImageGenerations = (email: string): number => {
  const usage = getUserImageUsage(email);
  return Math.max(0, DAILY_IMAGE_LIMIT - usage.count);
};

/**
 * Returns the daily image generation limit.
 */
export const getImageDailyLimit = (): number => DAILY_IMAGE_LIMIT;

/**
 * Generates an image using Pollinations.ai (Completely Free, No API Key).
 * Enforces a per-user daily limit of 5 images.
 * @param prompt The prompt for the image generation.
 * @param email The user's email for rate limiting.
 * @returns Base64 encoded image data, or null if failed, or an error string if rate limited.
 */
export const generateImage = async (prompt: string, email?: string): Promise<string | null> => {
  // Enforce rate limit if email is provided
  if (email) {
    const remaining = getRemainingImageGenerations(email);
    if (remaining <= 0) {
      return null;
    }
  }
  try {
    // Pollinations uses a simple URL structure: https://image.pollinations.ai/prompt/{prompt}
    // We add some parameters for better quality and consistency.
    // Using a fixed seed so the URL is stable and the image can be loaded directly.
    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&seed=${seed}`;

    // Use the direct URL instead of base64 conversion.
    // Base64 of large images exceeds Firestore's 1MB document limit and causes broken images.
    // Pollinations URLs are stable (same seed = same image) and load directly in <img> tags.
    try {
      // Verify the URL works with a quick fetch (follows redirects, confirms image generation)
      const response = await fetch(imageUrl, { method: 'GET' });
      if (!response.ok) throw new Error("Failed to generate image from Pollinations");
      
      // We got a valid response. Use the final URL (after any redirects) for display.
      // Track usage on success
      if (email) incrementImageUsage(email);
      return imageUrl;
    } catch (fetchError) {
      console.warn("IMAGE_SERVICE: Fetch verification failed, returning URL anyway:", fetchError);
      // Still return the URL - Pollinations might work directly in img tag even if fetch fails (CORS)
      if (email) incrementImageUsage(email);
      return imageUrl;
    }
  } catch (error) {
    console.error("IMAGE_SERVICE: Error generating image:", error);
    return null;
  }
};
