
# Gemini Shared Chat

A sleek chatbot powered by Gemini 3 Flash.

## 🚀 Deployment to Cloudflare Pages

1. **GitHub**: Push this code to a new GitHub repository.
2. **Cloudflare Dashboard**:
   - Go to **Workers & Pages** > **Pages** > **Connect to Git**.
   - Pick your repo.
3. **Build Settings**:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. **Environment Variables**:
   - Add `API_KEY` with your Google AI Studio key.
5. **Finish**: Deploy!

## Local Development

```bash
npm install
npm run dev
```
