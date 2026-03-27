import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  User, 
  MessageSquare, 
  Phone, 
  Lock, 
  Key, 
  Send, 
  UserPlus, 
  ChevronRight, 
  Shield, 
  X,
  Copy,
  Check,
  Bot,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Types
interface ChatMessage {
  fromCode: string;
  fromName: string;
  message: string;
  timestamp: string;
  isMe?: boolean;
  imageUrl?: string;
}

interface Friend {
  code: string;
  name: string;
  lastMessage?: string;
  unread?: boolean;
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myCode, setMyCode] = useState('');
  const [myName, setMyName] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [activeFriend, setActiveFriend] = useState<Friend | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [inputValue, setInputValue] = useState('');
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [friendNameInput, setFriendNameInput] = useState('');
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [isAddingAI, setIsAddingAI] = useState(false);
  const [aiNameInput, setAiNameInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  
  // Password Protection
  const [isLocked, setIsLocked] = useState(true);
  const [password, setPassword] = useState('');
  const [savedPassword, setSavedPassword] = useState(localStorage.getItem('myfriend_pass') || '');
  const [showPasswordSetup, setShowPasswordSetup] = useState(!localStorage.getItem('myfriend_pass'));

  // UI States
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate code if not exists
    let storedCode = localStorage.getItem('myfriend_code');
    let storedName = localStorage.getItem('myfriend_name');
    
    if (!storedCode) {
      storedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      localStorage.setItem('myfriend_code', storedCode);
    }
    if (storedName) {
      setMyName(storedName);
    }
    setMyCode(storedCode);

    // Load friends
    const storedFriends = localStorage.getItem('myfriend_friends');
    if (storedFriends) {
      setFriends(JSON.parse(storedFriends));
    }

    // Connect to socket
    const newSocket = io();
    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (socket && isRegistered) {
      socket.on('receive-message', (data: ChatMessage) => {
        setMessages(prev => {
          const friendMsgs = prev[data.fromCode] || [];
          return {
            ...prev,
            [data.fromCode]: [...friendMsgs, data]
          };
        });

        // Update friends list with last message
        setFriends(prev => {
          const updated = prev.map(f => {
            if (f.code === data.fromCode) {
              return { ...f, lastMessage: data.message, unread: activeFriend?.code !== f.code };
            }
            return f;
          });
          localStorage.setItem('myfriend_friends', JSON.stringify(updated));
          return updated;
        });
      });

      return () => {
        socket.off('receive-message');
      };
    }
  }, [socket, isRegistered, activeFriend]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeFriend]);

  const handleRegister = () => {
    if (myName.trim() && socket) {
      localStorage.setItem('myfriend_name', myName);
      socket.emit('register', { code: myCode, name: myName });
      setIsRegistered(true);
    }
  };

  const handleAddFriend = () => {
    if (friendCodeInput.trim() && friendNameInput.trim()) {
      const newFriend = { code: friendCodeInput.toUpperCase(), name: friendNameInput };
      const updatedFriends = [...friends, newFriend];
      setFriends(updatedFriends);
      localStorage.setItem('myfriend_friends', JSON.stringify(updatedFriends));
      setFriendCodeInput('');
      setFriendNameInput('');
      setIsAddingFriend(false);
    }
  };

  const handleAddAI = () => {
    if (aiNameInput.trim()) {
      const newFriend = { code: 'AI-FRIEND', name: aiNameInput };
      const updatedFriends = [...friends, newFriend];
      setFriends(updatedFriends);
      localStorage.setItem('myfriend_friends', JSON.stringify(updatedFriends));
      setAiNameInput('');
      setIsAddingAI(false);
    }
  };

  const sendMessage = async () => {
    if (inputValue.trim() && activeFriend && socket) {
      const currentInput = inputValue;
      const msgData: ChatMessage = {
        fromCode: myCode,
        fromName: myName,
        message: currentInput,
        timestamp: new Date().toISOString(),
        isMe: true
      };

      setInputValue('');

      if (activeFriend.code !== 'AI-FRIEND') {
        socket.emit('send-message', {
          toCode: activeFriend.code,
          message: currentInput,
          fromCode: myCode,
          fromName: myName
        });
      }

      setMessages(prev => {
        const friendMsgs = prev[activeFriend.code] || [];
        return {
          ...prev,
          [activeFriend.code]: [...friendMsgs, msgData]
        };
      });

      setFriends(prev => {
        const updated = prev.map(f => {
          if (f.code === activeFriend.code) {
            return { ...f, lastMessage: currentInput };
          }
          return f;
        });
        localStorage.setItem('myfriend_friends', JSON.stringify(updated));
        return updated;
      });

      // AI Logic
      if (activeFriend.code === 'AI-FRIEND') {
        setIsAiTyping(true);
        try {
          const isImageRequest = /çiz|resim|görsel|oluştur|yap/i.test(currentInput) && currentInput.length > 5;
          
          let aiResponse: ChatMessage;

          if (isImageRequest) {
            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: [{ text: currentInput }],
            });

            let imageUrl = "";
            const candidates = response.candidates;
            if (candidates && candidates.length > 0) {
              for (const part of candidates[0].content.parts) {
                if (part.inlineData) {
                  imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                  break;
                }
              }
            }

            aiResponse = {
              fromCode: 'AI-FRIEND',
              fromName: activeFriend.name,
              message: imageUrl ? "İşte istediğin görsel:" : "Üzgünüm, görsel oluştururken bir sorun oluştu.",
              imageUrl: imageUrl || undefined,
              timestamp: new Date().toISOString(),
              isMe: false
            };
          } else {
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: currentInput,
              config: {
                systemInstruction: `Senin adın ${activeFriend.name}. MyFriend uygulamasında bir AI arkadaşsın. Samimi, yardımsever ve arkadaş canlısı bir tonla Türkçe konuş. Kısa ve öz cevaplar ver.`
              }
            });

            aiResponse = {
              fromCode: 'AI-FRIEND',
              fromName: activeFriend.name,
              message: response.text || "Üzgünüm, şu an cevap veremiyorum.",
              timestamp: new Date().toISOString(),
              isMe: false
            };
          }

          setMessages(prev => {
            const friendMsgs = prev['AI-FRIEND'] || [];
            return {
              ...prev,
              ['AI-FRIEND']: [...friendMsgs, aiResponse]
            };
          });

          setFriends(prev => {
            const updated = prev.map(f => {
              if (f.code === 'AI-FRIEND') {
                return { ...f, lastMessage: aiResponse.message };
              }
              return f;
            });
            localStorage.setItem('myfriend_friends', JSON.stringify(updated));
            return updated;
          });
        } catch (error) {
          console.error("AI Error:", error);
        } finally {
          setIsAiTyping(false);
        }
      }
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(myCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const unlockApp = () => {
    if (password === savedPassword) {
      setIsLocked(false);
      setPassword('');
    } else {
      alert("Yanlış şifre!");
    }
  };

  const setupPassword = () => {
    if (password.length >= 4) {
      localStorage.setItem('myfriend_pass', password);
      setSavedPassword(password);
      setShowPasswordSetup(false);
      setIsLocked(false);
    } else {
      alert("Şifre en az 4 karakter olmalıdır.");
    }
  };

  // Password Setup Screen
  if (showPasswordSetup) {
    return (
      <div className="min-h-screen bg-[#151619] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#1c1d21] border border-[#2a2b30] rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#F27D26]/10 rounded-full flex items-center justify-center">
              <Shield className="text-[#F27D26] w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">MyFriend'e Hoş Geldin</h1>
          <p className="text-gray-400 text-center mb-8">Konuşmalarını korumak için bir şifre belirle.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-gray-500 mb-2">Yeni Şifre</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>
            <button 
              onClick={setupPassword}
              className="w-full bg-[#F27D26] hover:bg-[#d96a1b] text-white font-bold py-3 rounded-xl transition-colors"
            >
              Şifreyi Kaydet
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Lock Screen
  if (isLocked) {
    return (
      <div className="min-h-screen bg-[#151619] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#1c1d21] border border-[#2a2b30] rounded-2xl p-8 shadow-2xl text-center"
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#F27D26]/10 rounded-full flex items-center justify-center">
              <Lock className="text-[#F27D26] w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-8">Uygulama Kilitli</h1>
          
          <div className="space-y-4">
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && unlockApp()}
                className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                placeholder="Şifreni gir..."
              />
            </div>
            <button 
              onClick={unlockApp}
              className="w-full bg-[#F27D26] hover:bg-[#d96a1b] text-white font-bold py-3 rounded-xl transition-colors"
            >
              Kilidi Aç
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Registration Screen
  if (!isRegistered) {
    return (
      <div className="min-h-screen bg-[#151619] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md bg-[#1c1d21] border border-[#2a2b30] rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#F27D26]/10 rounded-full flex items-center justify-center">
              <User className="text-[#F27D26] w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">Profilini Oluştur</h1>
          <p className="text-gray-400 text-center mb-8">Arkadaşlarının seni tanıması için bir isim seç.</p>
          
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-gray-500 mb-2">Senin Kodun</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-[#151619] border border-[#2a2b30] rounded-xl py-3 px-4 text-[#F27D26] font-mono font-bold text-lg tracking-widest text-center">
                  {myCode}
                </div>
                <button 
                  onClick={copyCode}
                  className="bg-[#2a2b30] hover:bg-[#3a3b40] text-white p-3 rounded-xl transition-colors"
                >
                  {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-gray-500 mb-2">İsmin</label>
              <input 
                type="text" 
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-3 px-4 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                placeholder="Örn: Ahmet"
              />
            </div>

            <button 
              onClick={handleRegister}
              disabled={!myName.trim()}
              className="w-full bg-[#F27D26] hover:bg-[#d96a1b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors"
            >
              Giriş Yap
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#151619] text-white overflow-hidden">
      {/* Sidebar */}
      <div className={cn(
        "w-full md:w-80 border-r border-[#2a2b30] flex flex-col transition-all duration-300",
        activeFriend ? "hidden md:flex" : "flex"
      )}>
        <div className="p-6 border-bottom border-[#2a2b30]">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-bold tracking-tight">MyFriend</h1>
            <div className="flex gap-2">
              <button 
                onClick={() => setIsAddingAI(true)}
                className="p-2 bg-[#F27D26]/10 text-[#F27D26] rounded-lg hover:bg-[#F27D26]/20 transition-colors"
                title="AI Arkadaş Ekle"
              >
                <Bot className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsAddingFriend(true)}
                className="p-2 bg-[#F27D26]/10 text-[#F27D26] rounded-lg hover:bg-[#F27D26]/20 transition-colors"
                title="Arkadaş Ekle"
              >
                <UserPlus className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="bg-[#1c1d21] rounded-xl p-4 border border-[#2a2b30]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Senin Kodun</span>
              <button onClick={copyCode} className="text-[#F27D26] hover:text-[#d96a1b]">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            <div className="text-lg font-mono font-bold tracking-[0.2em] text-[#F27D26]">{myCode}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {friends.length === 0 ? (
            <div className="text-center py-10 px-6">
              <div className="w-12 h-12 bg-[#2a2b30] rounded-full flex items-center justify-center mx-auto mb-4">
                <User className="text-gray-500 w-6 h-6" />
              </div>
              <p className="text-gray-500 text-sm">Henüz arkadaşın yok. Kod girerek ekle!</p>
            </div>
          ) : (
            friends.map((friend) => (
              <button
                key={friend.code}
                onClick={() => {
                  setActiveFriend(friend);
                  setFriends(prev => prev.map(f => f.code === friend.code ? { ...f, unread: false } : f));
                }}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl transition-all group",
                  activeFriend?.code === friend.code 
                    ? "bg-[#F27D26] text-white" 
                    : "bg-[#1c1d21] hover:bg-[#2a2b30] text-gray-300"
                )}
              >
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0",
                  activeFriend?.code === friend.code ? "bg-white/20" : "bg-[#2a2b30]"
                )}>
                  {friend.name[0].toUpperCase()}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold truncate">{friend.name}</span>
                    {friend.unread && (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>
                  <p className={cn(
                    "text-xs truncate opacity-60",
                    activeFriend?.code === friend.code ? "text-white" : "text-gray-400"
                  )}>
                    {friend.lastMessage || friend.code}
                  </p>
                </div>
                <ChevronRight className={cn(
                  "w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity",
                  activeFriend?.code === friend.code ? "text-white" : "text-[#F27D26]"
                )} />
              </button>
            ))
          )}
        </div>

        <div className="p-4 border-t border-[#2a2b30]">
          <button 
            onClick={() => {
              setIsLocked(true);
              setPassword('');
            }}
            className="w-full flex items-center justify-center gap-2 py-3 text-gray-500 hover:text-white transition-colors"
          >
            <Lock className="w-4 h-4" />
            <span className="text-xs font-mono uppercase tracking-widest">Uygulamayı Kilitle</span>
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col bg-[#151619] relative",
        !activeFriend ? "hidden md:flex" : "flex"
      )}>
        {activeFriend ? (
          <>
            {/* Chat Header */}
            <div className="h-20 border-b border-[#2a2b30] flex items-center justify-between px-6 shrink-0">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setActiveFriend(null)}
                  className="md:hidden p-2 hover:bg-[#2a2b30] rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="w-10 h-10 bg-[#F27D26] rounded-full flex items-center justify-center font-bold">
                  {activeFriend.name[0].toUpperCase()}
                </div>
                <div>
                  <h2 className="font-bold text-lg leading-none mb-1">{activeFriend.name}</h2>
                  <p className="text-[10px] font-mono text-gray-500 tracking-widest">{activeFriend.code}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setActiveFriend(null)}
                  className="p-3 bg-[#2a2b30] hover:bg-red-500/10 hover:text-red-500 rounded-xl transition-all text-gray-400 flex items-center gap-2"
                  title="Sohbetten Çık"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="hidden lg:inline text-xs font-bold uppercase tracking-wider">Çıkış</span>
                </button>
                <button className="p-3 bg-[#2a2b30] hover:bg-[#3a3b40] rounded-xl transition-colors text-[#F27D26]">
                  <Phone className="w-5 h-5" />
                </button>
                <button className="p-3 bg-[#2a2b30] hover:bg-[#3a3b40] rounded-xl transition-colors text-gray-400">
                  <MessageSquare className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth"
            >
              {(messages[activeFriend.code] || []).map((msg, idx) => (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  key={idx}
                  className={cn(
                    "flex flex-col max-w-[80%]",
                    msg.isMe ? "ml-auto items-end" : "items-start"
                  )}
                >
                  <div className={cn(
                    "px-4 py-3 rounded-2xl text-sm overflow-hidden",
                    msg.isMe 
                      ? "bg-[#F27D26] text-white rounded-tr-none" 
                      : "bg-[#1c1d21] text-gray-200 border border-[#2a2b30] rounded-tl-none"
                  )}>
                    {msg.message}
                    {msg.imageUrl && (
                      <div className="mt-2 rounded-lg overflow-hidden border border-white/10">
                        <img 
                          src={msg.imageUrl} 
                          alt="AI Generated" 
                          referrerPolicy="no-referrer"
                          className="w-full h-auto object-cover"
                        />
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 mt-1 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </motion.div>
              ))}
              {isAiTyping && activeFriend.code === 'AI-FRIEND' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-start"
                >
                  <div className="bg-[#1c1d21] text-gray-400 border border-[#2a2b30] px-4 py-3 rounded-2xl rounded-tl-none text-xs italic flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    {activeFriend.name} yazıyor...
                  </div>
                </motion.div>
              )}
            </div>

            {/* Input */}
            <div className="p-6 border-t border-[#2a2b30]">
              <div className="flex gap-4 items-center">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Mesajını yaz..."
                    className="w-full bg-[#1c1d21] border border-[#2a2b30] rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                  />
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!inputValue.trim()}
                  className="w-14 h-14 bg-[#F27D26] hover:bg-[#d96a1b] disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl flex items-center justify-center transition-colors shadow-lg shadow-[#F27D26]/20"
                >
                  <Send className="w-6 h-6 text-white" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <div className="w-24 h-24 bg-[#1c1d21] rounded-3xl border border-[#2a2b30] flex items-center justify-center mb-8 rotate-3">
              <MessageSquare className="w-10 h-10 text-[#F27D26]" />
            </div>
            <h2 className="text-3xl font-bold mb-4">Sohbete Başla</h2>
            <p className="text-gray-500 max-w-md">
              Soldaki listeden bir arkadaşını seç veya yeni bir arkadaşının kodunu girerek özel konuşmaya başla.
            </p>
          </div>
        )}
      </div>

      {/* Add Friend Modal */}
      <AnimatePresence>
        {isAddingFriend && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md bg-[#1c1d21] border border-[#2a2b30] rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold">Arkadaş Ekle</h2>
                <button onClick={() => setIsAddingFriend(false)} className="text-gray-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Arkadaşının Kodu</label>
                  <input
                    type="text"
                    value={friendCodeInput}
                    onChange={(e) => setFriendCodeInput(e.target.value.toUpperCase())}
                    className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-4 px-6 text-white font-mono text-lg tracking-widest focus:outline-none focus:border-[#F27D26] transition-colors"
                    placeholder="ABC123"
                    maxLength={6}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Arkadaşının İsmi</label>
                  <input
                    type="text"
                    value={friendNameInput}
                    onChange={(e) => setFriendNameInput(e.target.value)}
                    className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-4 px-6 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                    placeholder="Örn: Mehmet"
                  />
                </div>
                <button
                  onClick={handleAddFriend}
                  disabled={!friendCodeInput.trim() || !friendNameInput.trim()}
                  className="w-full bg-[#F27D26] hover:bg-[#d96a1b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-colors text-lg"
                >
                  Arkadaş Listesine Ekle
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add AI Modal */}
      <AnimatePresence>
        {isAddingAI && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md bg-[#1c1d21] border border-[#2a2b30] rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F27D26]/10 rounded-xl flex items-center justify-center">
                    <Bot className="text-[#F27D26] w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold">AI Arkadaş Ekle</h2>
                </div>
                <button onClick={() => setIsAddingAI(false)} className="text-gray-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <p className="text-gray-400 text-sm">
                  Sana her zaman cevap verecek, özel bir yapay zeka arkadaş oluştur. Ona istediğin ismi verebilirsin.
                </p>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">AI Arkadaşının İsmi</label>
                  <input
                    type="text"
                    value={aiNameInput}
                    onChange={(e) => setAiNameInput(e.target.value)}
                    className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-4 px-6 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                    placeholder="Örn: MyBot, Asistan, Dostum..."
                  />
                </div>
                <button
                  onClick={handleAddAI}
                  disabled={!aiNameInput.trim()}
                  className="w-full bg-[#F27D26] hover:bg-[#d96a1b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-colors text-lg"
                >
                  AI Arkadaşı Oluştur
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
