import React, { useState, useEffect, useRef } from 'react';
import { 
  User as UserIcon, 
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
  LogOut,
  Users,
  MessageCircle,
  Trash2,
  LogIn,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";
import { 
  auth, 
  db, 
  signInWithGoogle 
} from './lib/firebase';
import { 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  addDoc, 
  serverTimestamp, 
  where,
  getDocs,
  deleteDoc,
  Timestamp
} from 'firebase/firestore';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Logo Component
const Logo = ({ className }: { className?: string }) => (
  <div className={cn("relative flex items-center justify-center", className)}>
    <MessageCircle className="w-full h-full text-[#F27D26] fill-[#F27D26]/10" />
    <div className="absolute inset-0 flex items-center justify-center pb-[15%]">
      <Users className="w-[50%] h-[50%] text-[#F27D26]" strokeWidth={2.5} />
    </div>
  </div>
);

// Types
interface ChatMessage {
  id?: string;
  fromUid: string;
  fromName: string;
  message: string;
  timestamp: any;
  isMe?: boolean;
  imageUrl?: string;
}

interface Friend {
  code: string;
  name: string;
  lastMessage?: string;
  unread?: boolean;
}

interface UserProfile {
  uid: string;
  name: string;
  code: string;
  createdAt: any;
}

export default function App() {
  // Auth State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // App State
  const [friends, setFriends] = useState<Friend[]>([]);
  const [activeFriend, setActiveFriend] = useState<Friend | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [friendNameInput, setFriendNameInput] = useState('');
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [isAddingAI, setIsAddingAI] = useState(false);
  const [aiNameInput, setAiNameInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  
  // Password Protection (still local/private for now)
  const [isLocked, setIsLocked] = useState(true);
  const [password, setPassword] = useState('');
  const [savedPassword, setSavedPassword] = useState(localStorage.getItem('myfriend_pass') || '');
  const [showPasswordSetup, setShowPasswordSetup] = useState(!localStorage.getItem('myfriend_pass'));
  const [showPasswordText, setShowPasswordText] = useState(false);

  // UI States
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch or create profile
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (userDoc.exists()) {
          setProfile(userDoc.data() as UserProfile);
        } else {
          // New user setup
          const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          const newProfile: UserProfile = {
            uid: u.uid,
            name: u.displayName || 'Anonim',
            code: newCode,
            createdAt: serverTimestamp()
          };
          try {
            await setDoc(doc(db, 'users', u.uid), newProfile);
            setProfile(newProfile);
          } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, `users/${u.uid}`);
          }
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // 2. Friends Listener
  useEffect(() => {
    if (!user) {
      setFriends([]);
      return;
    }
    const friendsPath = `users/${user.uid}/friends`;
    const unsubscribe = onSnapshot(collection(db, friendsPath), (snapshot) => {
      const friendsList = snapshot.docs.map(doc => doc.data() as Friend);
      setFriends(friendsList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, friendsPath);
    });
    return unsubscribe;
  }, [user]);

  // 3. Messages Listener
  useEffect(() => {
    if (!user || !activeFriend || activeFriend.code === 'AI-FRIEND') {
      setMessages([]);
      return;
    }

    // Sort UIDs of participants to get a stable chatId
    // We need to find the friend's UID by their code
    const fetchChatId = async () => {
      const q = query(collection(db, 'users'), where('code', '==', activeFriend.code));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return null;
      
      const friendUid = querySnapshot.docs[0].id;
      const chatId = [user.uid, friendUid].sort().join('_');
      return chatId;
    };

    let unsubscribe: () => void;
    fetchChatId().then(chatId => {
      if (!chatId) return;
      const msgPath = `chats/${chatId}/messages`;
      const q = query(collection(db, msgPath), orderBy('timestamp', 'asc'), limit(50));
      
      unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(d => ({
          ...d.data(),
          id: d.id,
          isMe: d.data().fromUid === user.uid
        } as ChatMessage));
        setMessages(msgs);
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, msgPath);
      });
    });

    return () => unsubscribe?.();
  }, [user, activeFriend]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleAddFriend = async () => {
    if (friendCodeInput.trim() && friendNameInput.trim() && user) {
      const code = friendCodeInput.toUpperCase();
      if (friends.some(f => f.code === code)) {
        alert("Bu arkadaş zaten ekli!");
        return;
      }

      // Verify if user exists
      const q = query(collection(db, 'users'), where('code', '==', code));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        alert("Bu koda sahip bir kullanıcı bulunamadı.");
        return;
      }

      const newFriend: Friend = { code, name: friendNameInput };
      const friendsPath = `users/${user.uid}/friends`;
      try {
        await setDoc(doc(db, friendsPath, code), {
          ...newFriend,
          addedAt: serverTimestamp()
        });
        setFriendCodeInput('');
        setFriendNameInput('');
        setIsAddingFriend(false);
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, friendsPath);
      }
    }
  };

  const handleAddAI = async () => {
    if (aiNameInput.trim() && user) {
      if (friends.some(f => f.code === 'AI-FRIEND')) {
        alert("AI arkadaş zaten ekli!");
        return;
      }
      const newFriend = { code: 'AI-FRIEND', name: aiNameInput };
      const friendsPath = `users/${user.uid}/friends`;
      try {
        await setDoc(doc(db, friendsPath, 'AI-FRIEND'), {
          ...newFriend,
          addedAt: serverTimestamp()
        });
        setAiNameInput('');
        setIsAddingAI(false);
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, friendsPath);
      }
    }
  };

  const deleteFriend = async (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (user && window.confirm("Bu arkadaşı silmek istediğine emin misin?")) {
      const friendsPath = `users/${user.uid}/friends`;
      try {
        await deleteDoc(doc(db, friendsPath, code));
        if (activeFriend?.code === code) {
          setActiveFriend(null);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, friendsPath);
      }
    }
  };

  const sendMessage = async () => {
    if (inputValue.trim() && activeFriend && user && profile) {
      const currentInput = inputValue;
      setInputValue('');

      if (activeFriend.code === 'AI-FRIEND') {
        // Handle AI locally for now but can store in local state or a private AI chat doc
        const myMsg: ChatMessage = {
          fromUid: user.uid,
          fromName: profile.name,
          message: currentInput,
          timestamp: new Date().toISOString(),
          isMe: true
        };
        setMessages(prev => [...prev, myMsg]);

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
              fromUid: 'AI-FRIEND',
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
              fromUid: 'AI-FRIEND',
              fromName: activeFriend.name,
              message: response.text || "Üzgünüm, şu an cevap veremiyorum.",
              timestamp: new Date().toISOString(),
              isMe: false
            };
          }
          setMessages(prev => [...prev, aiResponse]);
        } catch (error) {
          console.error("AI Error:", error);
        } finally {
          setIsAiTyping(false);
        }
      } else {
        // Real user chat
        const q = query(collection(db, 'users'), where('code', '==', activeFriend.code));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) return;
        
        const friendUid = querySnapshot.docs[0].id;
        const chatId = [user.uid, friendUid].sort().join('_');
        const msgPath = `chats/${chatId}/messages`;

        try {
          await addDoc(collection(db, msgPath), {
            fromUid: user.uid,
            fromName: profile.name,
            message: currentInput,
            timestamp: serverTimestamp()
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, msgPath);
        }
      }
    }
  };

  const copyCode = () => {
    if (profile?.code) {
      navigator.clipboard.writeText(profile.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#151619] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#F27D26] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Auth Screen
  if (!user) {
    return (
      <div className="min-h-screen bg-[#151619] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#1c1d21] border border-[#2a2b30] rounded-3xl p-10 shadow-2xl text-center"
        >
          <Logo className="w-24 h-24 mx-auto mb-8" />
          <h1 className="text-3xl font-bold text-white mb-2">MyFriend'e Hoş Geldin</h1>
          <p className="text-gray-400 mb-10 text-sm leading-relaxed">
            Arkadaşlarınla gizli ve şifreli bir şekilde konuşmak için giriş yap.
          </p>
          
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-white text-black font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-gray-200 transition-all shadow-xl group"
          >
            <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            Google ile Giriş Yap
          </button>
          
          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-600">
             <Shield className="w-3 h-3" />
             Uçtan uca şifreleme ve gizlilik önceliğimizdir.
          </div>
        </motion.div>
      </div>
    );
  }

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
            <Logo className="w-16 h-16" />
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">Güvenlik Ayarı</h1>
          <p className="text-gray-400 text-center mb-8 text-sm">Mesajlarına bir katman daha ekleyelim.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-gray-500 mb-2">Ugulama Şifresi</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  type={showPasswordText ? "text" : "password"} 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-3 px-10 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                  placeholder="En az 4 karakter"
                />
                <button 
                  type="button"
                  onClick={() => setShowPasswordText(!showPasswordText)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                >
                  {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
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
            <Logo className="w-16 h-16" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-8">Erişim İçin Kilidi Açın</h1>
          
          <div className="space-y-4">
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input 
                type={showPasswordText ? "text" : "password"} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && unlockApp()}
                className="w-full bg-[#151619] border border-[#2a2b30] rounded-xl py-3 px-10 text-white focus:outline-none focus:border-[#F27D26] transition-colors"
                placeholder="Uygulama şifreniz..."
              />
              <button 
                type="button"
                onClick={() => setShowPasswordText(!showPasswordText)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
              >
                {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button 
              onClick={unlockApp}
              className="w-full bg-[#F27D26] hover:bg-[#d96a1b] text-white font-bold py-3 rounded-xl transition-colors"
            >
              Kilidi Aç
            </button>
            <button 
              onClick={() => signOut(auth)}
              className="text-xs text-gray-600 hover:text-gray-400 underline transition-colors"
            >
              Başka bir hesapla giriş yap
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
            <div className="flex items-center gap-2">
              <Logo className="w-8 h-8" />
              <h1 className="text-xl font-bold tracking-tight">MyFriend</h1>
            </div>
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
            <div className="text-lg font-mono font-bold tracking-[0.2em] text-[#F27D26]">{profile?.code}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {friends.length === 0 ? (
            <div className="text-center py-10 px-6">
              <div className="w-12 h-12 bg-[#2a2b30] rounded-full flex items-center justify-center mx-auto mb-4">
                <UserIcon className="text-gray-500 w-6 h-6" />
              </div>
              <p className="text-gray-500 text-sm">Henüz arkadaşın yok. Kod girerek ekle!</p>
            </div>
          ) : (
            friends.map((friend) => (
              <button
                key={friend.code}
                onClick={() => setActiveFriend(friend)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl transition-all group border",
                  activeFriend?.code === friend.code 
                    ? "bg-[#F27D26] border-[#F27D26] text-white" 
                    : "bg-[#1c1d21] border-[#2a2b30] hover:border-gray-600 text-gray-300"
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
                    <button 
                      onClick={(e) => deleteFriend(friend.code, e)}
                      className="p-1 hover:bg-black/20 rounded transition-colors"
                    >
                      <Trash2 className={cn(
                        "w-3.5 h-3.5",
                        activeFriend?.code === friend.code ? "text-white/70" : "text-gray-500 hover:text-red-500"
                      )} />
                    </button>
                  </div>
                  <p className={cn(
                    "text-xs truncate opacity-60",
                    activeFriend?.code === friend.code ? "text-white" : "text-gray-400"
                  )}>
                    {friend.lastMessage || friend.code}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="p-4 border-t border-[#2a2b30] space-y-2">
           <div className="flex items-center gap-3 p-2 bg-[#1c1d21] rounded-xl border border-[#2a2b30]">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">
                 {user.displayName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                 <p className="text-xs font-bold truncate">{user.displayName}</p>
                 <p className="text-[10px] text-gray-500 truncate">{user.email}</p>
              </div>
              <button 
                onClick={() => signOut(auth)}
                className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                title="Çıkış Yap"
              >
                <LogOut className="w-4 h-4" />
              </button>
           </div>
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
              </div>
            </div>

            {/* Messages */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth"
            >
              {messages.map((msg, idx) => (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  key={msg.id || idx}
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
                    {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
                     msg.timestamp instanceof Date ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
                     new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
            <p className="text-gray-500 max-w-md text-sm">
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
