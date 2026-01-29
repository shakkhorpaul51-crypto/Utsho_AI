
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, Sparkles, LogOut, RefreshCcw, Settings, ExternalLink, Globe, AlertCircle, Activity, Paperclip, X } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender } from './types';
import { streamChatResponse, checkApiHealth, getPoolStatus, adminResetPool, getLastNodeError } from './services/geminiService';
import * as db from './services/firebaseService';

const App: React.FC = () => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiStatusText, setApiStatusText] = useState<string>('Ready');
  const [connectionHealth, setConnectionHealth] = useState<'perfect' | 'error'>('perfect');
  const [poolInfo, setPoolInfo] = useState({ total: 0, active: 0, exhausted: 0 });
  const [lastErrorDiagnostic, setLastErrorDiagnostic] = useState<string>("None");
  
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 4>(1);
  const [tempAge, setTempAge] = useState<string>('');
  const [tempGender, setTempGender] = useState<Gender | null>(null);
  const [customKeyInput, setCustomKeyInput] = useState('');
  
  const [selectedImage, setSelectedImage] = useState<{ data: string, mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = userProfile ? db.isAdmin(userProfile.email) : false;
  const isUserDebi = userProfile?.email.toLowerCase().trim() === 'nitebiswaskotha@gmail.com';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isLoading]);

  useEffect(() => {
    const bootApp = async () => {
      const localProfileStr = localStorage.getItem('utsho_profile');
      if (localProfileStr) {
        const localProfile = JSON.parse(localProfileStr) as UserProfile;
        setUserProfile(localProfile);
        setCustomKeyInput(localProfile.customApiKey || '');
        
        // If profile is incomplete, show onboarding
        if (!localProfile.age || !localProfile.gender) {
          setOnboardingStep(2);
        } else {
          setOnboardingStep(4);
        }
        
        if (db.isDatabaseEnabled()) {
          try {
            const cloudProfile = await db.getUserProfile(localProfile.email);
            if (cloudProfile) setUserProfile(cloudProfile);
            const cloudSessions = await db.getSessions(localProfile.email);
            setSessions(cloudSessions);
            if (cloudSessions.length > 0) setActiveSessionId(cloudSessions[0].id);
          } catch (e) {}
        }
        await performHealthCheck(localProfile);
      }
    };
    bootApp();
    const interval = setInterval(() => {
      setPoolInfo(getPoolStatus());
      setLastErrorDiagnostic(getLastNodeError());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleGoogleLogin = async () => {
    const googleUser = await db.loginWithGoogle();
    if (googleUser) {
      const cloud = await db.getUserProfile(googleUser.email);
      if (cloud && cloud.age > 0) {
        setUserProfile(cloud);
        localStorage.setItem('utsho_profile', JSON.stringify(cloud));
        setOnboardingStep(4);
        const s = await db.getSessions(googleUser.email);
        setSessions(s);
        if (s.length > 0) setActiveSessionId(s[0].id); else createNewSession(googleUser.email);
      } else {
        setUserProfile(googleUser);
        setOnboardingStep(2);
      }
    }
  };

  const finalizePersonalization = async () => {
    if (!userProfile || !tempGender || !tempAge) return;
    const final: UserProfile = { ...userProfile, age: parseInt(tempAge) || 20, gender: tempGender };
    setUserProfile(final);
    localStorage.setItem('utsho_profile', JSON.stringify(final));
    if (db.isDatabaseEnabled()) await db.saveUserProfile(final);
    setOnboardingStep(4);
    if (sessions.length === 0) createNewSession(final.email);
    await performHealthCheck(final);
  };

  const performHealthCheck = async (profile?: UserProfile) => {
    setApiStatusText('Scanning...');
    const { healthy, error } = await checkApiHealth(profile || userProfile || undefined);
    setConnectionHealth(healthy ? 'perfect' : 'error');
    setApiStatusText(healthy ? 'Active' : 'Sync Error');
    setPoolInfo(getPoolStatus());
    if (error) setLastErrorDiagnostic(error);
  };

  const handleResetPool = () => {
    adminResetPool();
    performHealthCheck();
  };

  const saveSettings = async () => {
    if (!userProfile) return;
    const updated = { ...userProfile, customApiKey: customKeyInput.trim() };
    setUserProfile(updated);
    localStorage.setItem('utsho_profile', JSON.stringify(updated));
    if (db.isDatabaseEnabled()) await db.saveUserProfile(updated);
    setIsSettingsOpen(false);
    await performHealthCheck(updated);
  };

  const createNewSession = (emailOverride?: string) => {
    const sid = crypto.randomUUID();
    const newSession = { id: sid, title: 'New Chat', messages: [], createdAt: new Date() };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(sid);
    if (db.isDatabaseEnabled()) db.saveSession(emailOverride || userProfile!.email, newSession).catch(console.error);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      setSelectedImage({ data: base64, mimeType: file.type });
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || isLoading || !activeSessionId || !userProfile) return;
    
    const userMsg: Message = { 
      id: crypto.randomUUID(), 
      role: 'user', 
      content: inputText, 
      timestamp: new Date(),
      imagePart: selectedImage || undefined,
      imageUrl: imagePreview || undefined
    };
    
    const currentSession = sessions.find(s => s.id === activeSessionId)!;
    const history = [...currentSession.messages, userMsg];
    
    setInputText('');
    setSelectedImage(null);
    setImagePreview(null);
    setIsLoading(true);
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: history } : s));

    if (db.isDatabaseEnabled()) {
      db.updateSessionMessages(userProfile.email, activeSessionId, history).catch(console.error);
    }

    await streamChatResponse(
      history,
      userProfile,
      () => {},
      (fullText, sources, imageUrl) => {
        setIsLoading(false);
        const parts = fullText.split('[SPLIT]').map(p => p.trim()).filter(p => p.length > 0);
        const newMessages: Message[] = parts.map((p, i) => ({
          id: crypto.randomUUID(),
          role: 'model',
          content: p,
          timestamp: new Date(),
          sources: i === parts.length - 1 ? sources : undefined,
          imageUrl: i === 0 ? imageUrl : undefined
        }));
        
        const updatedMessages = [...history, ...newMessages];
        const newTitle = currentSession.messages.length === 0 ? userMsg.content.slice(0, 30) || "Image Analysis" : currentSession.title;
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: updatedMessages, title: newTitle } : s));
        
        if (db.isDatabaseEnabled()) {
          db.updateSessionMessages(userProfile.email, activeSessionId, updatedMessages).catch(console.error);
        }
        setPoolInfo(getPoolStatus());
      },
      (err) => {
        setIsLoading(false);
        const errMsg = err.message || "Connection Error";
        setLastErrorDiagnostic(errMsg);
        const errorMsg: Message = { id: crypto.randomUUID(), role: 'model', content: `Failure: ${errMsg}`, timestamp: new Date() };
        const finalMessages = [...history, errorMsg];
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: finalMessages } : s));
        if (db.isDatabaseEnabled()) db.updateSessionMessages(userProfile.email, activeSessionId, finalMessages).catch(console.error);
      },
      (status) => setApiStatusText(status)
    );
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // STEP 1: LOGIN
  if (onboardingStep === 1) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[3rem] p-12 shadow-2xl space-y-8 text-center animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-indigo-600 rounded-3xl mx-auto flex items-center justify-center text-white floating-ai shadow-[0_0_20px_rgba(79,70,229,0.3)]"><Sparkles size={40} /></div>
        <div className="space-y-2">
          <h1 className="text-3xl font-black">Utsho AI</h1>
          <p className="text-zinc-500">High Performance Intelligence</p>
        </div>
        <button onClick={handleGoogleLogin} className="w-full bg-white text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="" /> Sign in with Google
        </button>
      </div>
    </div>
  );

  // STEP 2: PERSONALIZATION
  if (onboardingStep === 2) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-300">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-black">Personalize Utsho</h2>
          <p className="text-zinc-500 text-sm">Help Utsho know how to talk to you.</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Select Gender</label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setTempGender('male')} className={`py-4 rounded-2xl border-2 font-bold transition-all ${tempGender === 'male' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>Male</button>
              <button onClick={() => setTempGender('female')} className={`py-4 rounded-2xl border-2 font-bold transition-all ${tempGender === 'female' ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>Female</button>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Enter Age</label>
            <input type="number" value={tempAge} onChange={e => setTempAge(e.target.value)} placeholder="e.g. 24" className="w-full bg-zinc-800 border border-zinc-700 p-4 rounded-2xl outline-none focus:border-indigo-500 text-white font-bold" />
          </div>

          <button 
            onClick={finalizePersonalization} 
            disabled={!tempGender || !tempAge} 
            className={`w-full font-bold py-4 rounded-2xl active:scale-95 transition-all ${(!tempGender || !tempAge) ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-white text-zinc-950 shadow-xl'}`}
          >
            Start Chatting
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-['Hind_Siliguri',_sans-serif]">
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/50">
           <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl w-full max-w-md space-y-6 shadow-2xl">
              <h3 className="text-xl font-bold flex items-center gap-2"><Settings size={20} className="text-indigo-500" /> Settings</h3>
              <div className="space-y-2">
                 <label className="text-xs font-bold text-zinc-500">PERSONAL GEMINI API KEY</label>
                 <input type="password" value={customKeyInput} onChange={e => setCustomKeyInput(e.target.value)} placeholder="Paste key here..." className="w-full bg-zinc-800 border border-zinc-700 p-4 rounded-xl outline-none focus:border-indigo-500" />
              </div>
              <div className="flex gap-3">
                 <button onClick={() => setIsSettingsOpen(false)} className="flex-1 py-3 font-bold border border-zinc-700 rounded-xl hover:bg-zinc-800">Cancel</button>
                 <button onClick={saveSettings} className="flex-1 py-3 font-bold bg-indigo-600 rounded-xl hover:bg-indigo-700">Save</button>
              </div>
           </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 flex flex-col gap-4">
          <button onClick={() => createNewSession()} className="bg-zinc-100 text-zinc-950 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg hover:bg-white transition-colors"><Plus size={18} /> New Chat</button>
          
          {isAdmin && (
            <div className="p-3 bg-zinc-950/50 rounded-2xl border border-zinc-800 space-y-3">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <Activity size={12} className="text-emerald-500" />
                     <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Pool Health</span>
                  </div>
                  <button onClick={handleResetPool} className="p-1 text-zinc-600 hover:text-emerald-400 transition-colors"><RefreshCcw size={14} /></button>
               </div>
               <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                  <div className="bg-zinc-900 p-2 rounded-xl border border-zinc-800">
                    <div className="text-emerald-500">{poolInfo.active}/{poolInfo.total}</div>
                    <div className="text-zinc-500">Alive</div>
                  </div>
                  <div className="bg-zinc-900 p-2 rounded-xl border border-zinc-800">
                    <div className="text-amber-500">{poolInfo.exhausted}</div>
                    <div className="text-zinc-500">Exhausted</div>
                  </div>
               </div>
               <div className="bg-zinc-900 p-2 rounded-xl border border-zinc-800 text-[9px] font-mono text-red-400/80 truncate">
                 Error: {lastErrorDiagnostic}
               </div>
               <div className="text-[9px] text-zinc-600 text-center uppercase tracking-widest font-bold">{apiStatusText}</div>
            </div>
          )}
          
          {!isAdmin && (
             <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/30 rounded-xl border border-zinc-800/50">
               <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${connectionHealth === 'perfect' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">System Ready</span>
               </div>
               <button onClick={() => setIsSettingsOpen(true)} className="text-zinc-700 hover:text-indigo-400"><Settings size={14} /></button>
             </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-hide">
          {sessions.map(s => (
            <div key={s.id} onClick={() => { setActiveSessionId(s.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }} className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer ${activeSessionId === s.id ? 'bg-zinc-800 text-white shadow-xl shadow-indigo-500/5' : 'hover:bg-zinc-800/40 text-zinc-500'}`}>
              <MessageSquare size={16} className={activeSessionId === s.id ? 'text-indigo-400' : ''} /> 
              <div className="flex-1 truncate text-sm font-medium">{s.title}</div>
              <button onClick={(e) => { e.stopPropagation(); db.deleteSession(userProfile!.email, s.id); setSessions(prev => prev.filter(x => x.id !== s.id)); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 flex items-center gap-3 bg-zinc-900/50">
          <img src={userProfile?.picture} className="w-9 h-9 rounded-full border border-zinc-700" alt="" />
          <div className="flex-1 truncate text-[11px] font-bold text-zinc-400">{userProfile?.name} • {userProfile?.age}Y {userProfile?.gender[0].toUpperCase()}</div>
          <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="text-zinc-600 hover:text-red-500"><LogOut size={16} /></button>
        </div>
      </aside>

      {/* Main Chat */}
      <main className="flex-1 flex flex-col relative">
        <div className="md:hidden h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md flex items-center px-4">
          <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-zinc-400"><Menu size={20} /></button>
          <div className="flex-1 text-center font-black tracking-tighter text-indigo-500">UTSHO AI</div>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-3xl mx-auto space-y-6">
            {!activeSession || activeSession.messages.length === 0 ? (
              <div className="h-[60vh] flex flex-col items-center justify-center space-y-6 text-center animate-in fade-in slide-in-from-top-4 duration-500">
                <div className={`w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-2xl floating-ai ${isUserDebi ? 'bg-pink-600 shadow-pink-500/20' : 'bg-indigo-600 shadow-indigo-500/20'}`}><Sparkles size={40} /></div>
                <div className="space-y-2">
                  <h3 className="text-3xl font-black">Welcome back, {userProfile?.name.split(' ')[0]}</h3>
                  <p className="text-sm text-zinc-500">I'm ready to chat with you in your personalized mode.</p>
                </div>
              </div>
            ) : (
              activeSession.messages.map(m => (
                <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in slide-in-from-bottom-2`}>
                   <div className={`flex flex-col gap-2 max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {m.imageUrl && (
                        <img src={m.imageUrl} className="max-w-full h-auto rounded-3xl border border-zinc-800 shadow-2xl mb-1 hover:scale-[1.01] transition-transform" alt="Attachment" />
                      )}
                      {m.content && (
                        <div className={`p-4 rounded-3xl text-[15px] bangla-text shadow-sm ${m.role === 'user' ? (isUserDebi ? 'bg-pink-600' : 'bg-indigo-600 shadow-indigo-500/10') + ' text-white rounded-tr-none' : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-none'}`}>
                          {m.content}
                        </div>
                      )}
                      {m.sources && m.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {m.sources.map((s: any, idx: number) => (
                            <a key={idx} href={s.uri} target="_blank" className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 py-1.5 px-3 rounded-xl text-[10px] text-zinc-400 hover:text-white transition-all">
                              <Globe size={10} /> <span className="max-w-[100px] truncate">{s.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                   </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-8 bg-zinc-950/80 backdrop-blur-md">
          <div className="max-w-3xl mx-auto space-y-3">
            {imagePreview && (
              <div className="relative inline-block animate-in fade-in zoom-in">
                <img src={imagePreview} className="w-20 h-20 object-cover rounded-2xl border-2 border-indigo-500/30" alt="" />
                <button onClick={() => { setSelectedImage(null); setImagePreview(null); }} className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-lg"><X size={12} /></button>
              </div>
            )}
            <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-800 rounded-[2rem] p-2 shadow-2xl">
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageSelect} />
              <button onClick={() => fileInputRef.current?.click()} className="p-3 text-zinc-500 hover:text-indigo-400"><Paperclip size={20} /></button>
              <textarea rows={1} value={inputText} onChange={e => { setInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Talk to Utsho..." className="flex-1 bg-transparent py-3 px-3 outline-none resize-none max-h-40 text-zinc-100 placeholder-zinc-600" />
              <button onClick={handleSendMessage} disabled={(!inputText.trim() && !selectedImage) || isLoading} className={`p-4 rounded-full transition-all active:scale-90 shadow-lg ${ (inputText.trim() || selectedImage) && !isLoading ? (isUserDebi ? 'bg-pink-600 shadow-pink-600/20' : 'bg-indigo-600 shadow-indigo-500/20') : 'bg-zinc-800 text-zinc-600'}`}>
                 {isLoading ? <RefreshCcw size={20} className="animate-spin" /> : <Send size={20} />}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
