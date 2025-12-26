
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Plus, MessageSquare, Trash2, Github, Settings, Menu, X, Sparkles, AlertCircle } from 'lucide-react';
import { ChatSession, Message, Role } from './types';
import { streamChatResponse } from './services/geminiService';

const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isApiKeyMissing, setIsApiKeyMissing] = useState(!process.env.API_KEY);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize with a default session if none exist
  useEffect(() => {
    const saved = localStorage.getItem('chat_sessions');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Re-convert date strings to Date objects
      const formatted = parsed.map((s: any) => ({
        ...s,
        createdAt: new Date(s.createdAt),
        messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
      }));
      setSessions(formatted);
      if (formatted.length > 0) setActiveSessionId(formatted[0].id);
    } else {
      createNewSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('chat_sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId]);

  const createNewSession = () => {
    const newId = crypto.randomUUID();
    const newSession: ChatSession = {
      id: newId,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
    if (sessions.length <= 1) {
      localStorage.removeItem('chat_sessions');
      createNewSession();
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading || !activeSessionId || isApiKeyMissing) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputText,
      timestamp: new Date(),
    };

    const currentInput = inputText;
    setInputText('');
    setIsLoading(true);

    // Update active session locally
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        const updatedMessages = [...s.messages, userMessage];
        // Auto-update title if it's the first message
        const newTitle = s.messages.length === 0 ? currentInput.slice(0, 30) + (currentInput.length > 30 ? '...' : '') : s.title;
        return { ...s, messages: updatedMessages, title: newTitle };
      }
      return s;
    }));

    // Placeholder for AI response
    const aiMessageId = crypto.randomUUID();
    const aiPlaceholder: Message = {
      id: aiMessageId,
      role: 'model',
      content: '',
      timestamp: new Date(),
    };

    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [...s.messages, aiPlaceholder] };
      }
      return s;
    }));

    await streamChatResponse(
      [...(activeSession?.messages || []), userMessage],
      (chunk) => {
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => m.id === aiMessageId ? { ...m, content: m.content + chunk } : m)
            };
          }
          return s;
        }));
      },
      (fullContent) => {
        setIsLoading(false);
      },
      (error) => {
        setIsLoading(false);
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => m.id === aiMessageId ? { ...m, content: "⚠️ Sorry, an error occurred while generating the response. Please check your API key or connection." } : m)
            };
          }
          return s;
        }));
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 z-40 flex items-center justify-between px-4">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors">
          <Menu size={20} />
        </button>
        <div className="font-semibold flex items-center gap-2">
          <Sparkles size={18} className="text-indigo-400" />
          <span>Gemini Chat</span>
        </div>
        <button onClick={createNewSession} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors">
          <Plus size={20} />
        </button>
      </div>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-4 flex items-center justify-between">
          <button 
            onClick={createNewSession}
            className="flex-1 flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 py-2.5 px-4 rounded-xl font-medium hover:bg-zinc-200 transition-all hover:scale-[0.98] active:scale-95"
          >
            <Plus size={18} />
            <span>New Chat</span>
          </button>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 ml-2 hover:bg-zinc-800 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          <div className="px-2 mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Recent History</div>
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => {
                setActiveSessionId(session.id);
                if (window.innerWidth < 768) setIsSidebarOpen(false);
              }}
              className={`
                group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all relative
                ${activeSessionId === session.id ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'}
              `}
            >
              <MessageSquare size={18} className={activeSessionId === session.id ? 'text-indigo-400' : 'text-zinc-500'} />
              <div className="flex-1 truncate pr-6 text-sm font-medium">{session.title}</div>
              <button 
                onClick={(e) => deleteSession(e, session.id)}
                className="absolute right-2 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-500 hover:text-red-400 transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 space-y-3">
          <div className="flex items-center gap-3 p-2 text-sm text-zinc-400">
            <Settings size={18} />
            <span>Settings</span>
          </div>
          <div className="flex items-center gap-3 p-2 text-sm text-zinc-400">
            <Github size={18} />
            <span>Source Code</span>
          </div>
          <div className="mt-2 flex items-center gap-3 bg-zinc-800/50 p-3 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center font-bold text-xs">U</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">Free User</div>
              <div className="text-[10px] text-zinc-500 truncate">Shared API Active</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        {/* API Key Warning */}
        {isApiKeyMissing && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 p-3 flex items-center justify-center gap-3 text-amber-200 text-sm">
            <AlertCircle size={18} />
            <p>Cloudflare environment missing <code>API_KEY</code>. The bot might not respond.</p>
          </div>
        )}

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-3xl mx-auto space-y-8">
            {activeSession?.messages.length === 0 ? (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in zoom-in duration-700">
                <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl flex items-center justify-center text-indigo-400">
                  <Sparkles size={40} />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold tracking-tight">How can I help you today?</h2>
                  <p className="text-zinc-500 max-w-sm">I'm a Gemini-powered AI here to help you brainstorm, code, and learn new things.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-md pt-4">
                  {[
                    "Write a recipe for chocolate cake",
                    "Explain quantum physics in simple terms",
                    "Help me write a React component",
                    "Write a short poem about space"
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInputText(suggestion)}
                      className="text-left p-4 bg-zinc-900 border border-zinc-800 rounded-2xl text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeSession?.messages.map((message) => (
                <div 
                  key={message.id} 
                  className={`flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'model' && (
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 mt-1">
                      <Sparkles size={16} />
                    </div>
                  )}
                  <div className={`
                    max-w-[85%] md:max-w-[75%] p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                    ${message.role === 'user' 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/10' 
                      : 'bg-zinc-900 text-zinc-200 border border-zinc-800'}
                  `}>
                    {message.content || (isLoading && <div className="flex gap-1 py-1"><div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.2s]"></div><div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.4s]"></div></div>)}
                  </div>
                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0 mt-1">
                      U
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-8 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent">
          <div className="max-w-3xl mx-auto relative group">
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Gemini..."
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 py-4 pl-4 pr-14 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none shadow-2xl"
              style={{ maxHeight: '200px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputText.trim() || isLoading || isApiKeyMissing}
              className={`
                absolute right-3 bottom-3 p-2.5 rounded-xl transition-all
                ${inputText.trim() && !isLoading && !isApiKeyMissing
                  ? 'bg-zinc-100 text-zinc-950 hover:scale-105 active:scale-95'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}
              `}
            >
              <Send size={18} />
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 text-center mt-3">
            Gemini can make mistakes. Check important info. Shared public API access.
          </p>
        </div>
      </main>
    </div>
  );
};

export default App;
