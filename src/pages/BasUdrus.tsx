import { useState, useEffect, useRef, useMemo, memo } from "react";
import { motion } from "framer-motion";
import { supabase, getSessionCached } from "@/lib/supabase";
import type { Profile, Message, HelpRequest } from "@/lib/supabase";
import { clearAllMemory } from "@/lib/ai-memory";
import { logError, setErrorUserId, trackEvent, trackClick } from "@/services/analytics";
import { useApp } from "@/context/AppContext";
import { loadUniData, isUniDataReady, getUniversities, normalizeUni, uniMatches, majorMatches, getAllMajors, getMajorsForUni, getCourseGroups, getUniCards } from "@/services/uniData";
import { renderMarkdown } from "@/shared/renderMarkdown";
import { makeCSS } from "@/shared/makeCSS";
import { withRetry } from "@/shared/retry";
import { useAdmin } from "@/features/admin/useAdmin";
import { AdminScreen } from "@/features/admin/AdminScreen";
import { useRooms } from "@/features/rooms/useRooms";
import { RoomsScreen } from "@/features/rooms/RoomsScreen";
import { useAI } from "@/features/ai/useAI";
import { useProfile } from "@/features/profile/useProfile";
import { useDiscover } from "@/features/discover/useDiscover";
import { useMessages } from "@/features/messaging/useMessages";
import { useAuth } from "@/features/auth/useAuth";
import { usePomodoro } from "@/features/pomodoro/usePomodoro";
import { useNotifications } from "@/features/notifications/useNotifications";

import {
  AVATAR_COLORS, BADGES_DEF, getMeetIcon, getMeetLabel,
  statusColor
} from "@/lib/constants";
import type { Theme } from "@/lib/constants";

// ─── Helper: initials from name ──────────────────────────────────────────────
const initials = (n: string) => n ? n.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase() : "ME";

// ─── Stable sub-components (outside render to prevent remount) ───────────────
const FallbackCircle = ({name, color, size, ringStyle}: {name:string; color:string; size:number; ringStyle?:React.CSSProperties}) => (
  <div style={{width:size,height:size,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:size*0.31,boxShadow:`0 3px 14px ${color}55`,flexShrink:0,...(ringStyle||{})}}>
    {initials(name||"")}
  </div>
);

// Ref callback that detects already-cached images (React onLoad doesn't fire for cached imgs)
const useCachedImg = (src: string | null | undefined) => {
  const [state, setState] = useState<"loading"|"loaded"|"error">(src ? "loading" : "loaded");
  useEffect(() => { if (src) setState("loading"); }, [src]);
  const ref = (el: HTMLImageElement | null) => {
    if (!el || !src) return;
    if (el.complete) {
      if (el.naturalWidth > 0) setState(s => s === "loaded" ? s : "loaded");
      else setState(s => s === "error" ? s : "error");
    }
  };
  return { state, setState, ref };
};

const UserAvatar = memo(({p, size=48, ring=false, T}: {p:Partial<Profile>; size?:number; ring?:boolean; T:Theme}) => {
  const bg = p.avatar_color||"#6C8EF5";
  const ringStyle = ring?{outline:`3px solid ${T.accent}`,outlineOffset:2}:{};
  const hasPhoto = p.photo_mode==="photo"&&!!p.photo_url;
  const { state, setState, ref } = useCachedImg(hasPhoto ? p.photo_url : null);
  if (hasPhoto&&state!=="error") return (
    <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,boxShadow:"0 3px 14px rgba(0,0,0,0.15)",position:"relative",background:bg,color:"#fff",fontWeight:700,fontSize:size*0.31,...ringStyle}}>
      <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>{initials(p.name||"")}</span>
      <img ref={ref} src={p.photo_url!} alt={p.name?`${p.name}'s photo`:"Photo"} width={size} height={size} decoding="async" style={{position:"relative",width:"100%",height:"100%",objectFit:"cover",opacity:state==="loaded"?1:0,transition:"opacity 0.25s"}} onLoad={()=>setState("loaded")} onError={()=>setState("error")}/>
    </div>
  );
  return <FallbackCircle name={p.name||""} color={bg} size={size} ringStyle={ringStyle}/>;
});

const Avatar = memo(({s, size=48, T}: {s:Profile; size?:number; T:Theme}) => {
  const hasPhoto = s.photo_mode==="photo"&&!!s.photo_url;
  const { state, setState, ref } = useCachedImg(hasPhoto ? s.photo_url : null);
  const bg = s.avatar_color||"#6C8EF5";
  return (
  <div style={{position:"relative",flexShrink:0}}>
    {hasPhoto&&state!=="error" ? (
      <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",boxShadow:"0 3px 14px rgba(0,0,0,0.15)",position:"relative",background:bg,color:"#fff",fontWeight:700,fontSize:size*0.3}}>
        <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>{initials(s.name)}</span>
        <img ref={ref} src={s.photo_url!} alt={s.name?`${s.name}'s photo`:"Photo"} width={size} height={size} decoding="async" style={{position:"relative",width:"100%",height:"100%",objectFit:"cover",opacity:state==="loaded"?1:0,transition:"opacity 0.25s"}} onLoad={()=>setState("loaded")} onError={()=>setState("error")}/>
      </div>
    ) : (
      <div style={{width:size,height:size,borderRadius:"50%",background:bg,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:size*0.3,boxShadow:`0 3px 14px ${bg}55`}}>
        {initials(s.name)}
      </div>
    )}
    {s.online&&<div style={{position:"absolute",bottom:1,right:1,width:size*0.23,height:size*0.23,background:T.green,borderRadius:"50%",border:"2px solid "+T.surface}}/>}
  </div>
  );
});

const CourseSearch = memo(({value, onChange, placeholder, T}: {value:string; onChange:(v:string)=>void; uniFilter?:string; majorFilter?:string; placeholder?:string; T:Theme}) => {
  const [csSearch, setCsSearch] = useState("");
  const [csOpen, setCsOpen] = useState(false);
  const csRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (csRef.current && !csRef.current.contains(e.target as Node)) setCsOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const allCourses = useMemo(() => {
    const raw = getCourseGroups().flatMap(([group, courses]) => courses.map(c => ({course:c, group})));
    const seen = new Set<string>();
    return raw.filter(c => { if (seen.has(c.course)) return false; seen.add(c.course); return true; });
  }, []);
  const filtered = useMemo(() => {
    if (!csSearch) return allCourses.slice(0, 80);
    const q = csSearch.toLowerCase();
    const starts: typeof allCourses = [];
    const wordStarts: typeof allCourses = [];
    const contains: typeof allCourses = [];
    for (const opt of allCourses) {
      const name = opt.course.toLowerCase();
      if (name.startsWith(q)) starts.push(opt);
      else if (name.split(/[\s(&]/).some(w => w.startsWith(q))) wordStarts.push(opt);
      else if (name.includes(q)) contains.push(opt);
    }
    return [...starts, ...wordStarts, ...contains].slice(0, 80);
  }, [csSearch, allCourses]);
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of filtered) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item.course);
    }
    return Array.from(map.entries());
  }, [filtered]);
  return (
    <div ref={csRef} style={{position:"relative"}}>
      <div style={{display:"flex",alignItems:"center",border:`1.5px solid ${csOpen?T.accent:T.border}`,borderRadius:12,padding:"0 12px",background:T.bg,transition:"border-color 0.15s"}}>
        <span style={{fontSize:14,marginRight:6,opacity:0.5}}>🔍</span>
        <input placeholder={placeholder||"Search any course..."} value={csOpen?csSearch:value}
          onChange={e=>{setCsSearch(e.target.value);setCsOpen(true);}}
          onFocus={()=>setCsOpen(true)}
          style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:16,padding:"11px 0",color:T.text,minWidth:0,width:"100%"}}/>
        {(csSearch||value)&&<span style={{cursor:"pointer",fontSize:16,color:T.muted,padding:4}} onMouseDown={e=>{e.preventDefault();setCsSearch("");onChange("");}}>×</span>}
      </div>
      {csOpen&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.12)",maxHeight:260,overflowY:"auto",zIndex:50}}>
          {grouped.length===0?(
            <div style={{padding:"16px 14px",textAlign:"center",fontSize:13,color:T.muted}}>{csSearch?`No courses match "${csSearch}"`:"No courses available"}</div>
          ):(
            grouped.map(([cat, courses])=>(
              <div key={cat}>
                <div style={{padding:"8px 14px 4px",fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",position:"sticky",top:0,background:T.surface,zIndex:1}}>{cat}</div>
                {courses.map(course=>(
                  <div key={course} onMouseDown={e=>{e.preventDefault();onChange(course);setCsSearch("");setCsOpen(false);}}
                    style={{padding:"8px 14px 8px 24px",cursor:"pointer",fontSize:13,color:course===value?T.accent:T.text,fontWeight:course===value?700:400,background:course===value?T.accentSoft:"transparent"}}
                    onMouseEnter={e=>{if(course!==value)(e.currentTarget as HTMLDivElement).style.background=T.border;}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=course===value?T.accentSoft:"transparent";}}>
                    {course}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

const timeAgo = (dateStr: string) => {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff/60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function BasUdrus() {
  const { user, setUser, profile, setProfile, darkMode, setDarkMode, T, screen, setScreen, showNotif, notif, isOnline, isAdmin, loading, setLoading } = useApp();

  const streak = profile.streak ?? 0;
  const xp = profile.xp ?? 0;
  const earnedBadges: string[] = profile.badges ?? [];
  const [newBadge, setNewBadge] = useState<typeof BADGES_DEF[0] | null>(null);
  const [passwordModal, setPasswordModal] = useState(false);

  const {
    notifications, setNotifications,
    showNotifPanel, setShowNotifPanel,
    notifPanelRef,
    unreadCount,
    loadNotifications, sendNotification, markNotifRead,
  } = useNotifications();
  const connectTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const connectingRef = useRef(false);
  const resetAIRef = useRef<() => void>(() => {});
  // Mirror of activeChat.id + screen that the realtime handler can read even
  // though its closure captures state from the original render.
  const viewingChatRef = useRef<{ partnerId: string | null; screen: string }>({ partnerId: null, screen: "landing" });
  const [uniDataReady, setUniDataReady] = useState(isUniDataReady());

  // Load university/major/course data from Supabase on mount
  useEffect(() => {
    if (isUniDataReady()) { setUniDataReady(true); return; }
    loadUniData().then(() => setUniDataReady(true)).catch((e) => logError("loadUniData", e));
  }, []);

  const {
    pomodoroActive, setPomodoroActive,
    pomodoroRunning, pomodoroSeconds, setPomodoroSeconds,
    pomodoroMode, setPomodoroMode,
    pomodoroCount,
    pomodoroConfig, pomodoroProgress, formatTime,
    startPomodoro, pausePomodoro, resetPomodoro,
  } = usePomodoro();

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);
  const dragScroll = useRef(0);
  const dragMoved = useRef(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const aiChatScrollRef = useRef<HTMLDivElement>(null);

  // ── Network status (offline detection) ──────────────────────────────
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  useEffect(() => {
    if (!isOnline) { setShowOfflineBanner(true); }
    else {
      const t = setTimeout(() => setShowOfflineBanner(false), 2000);
      return () => clearTimeout(t);
    }
  }, [isOnline]);


  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (courseDropRef.current && !courseDropRef.current.contains(e.target as Node)) {
        setCourseDropOpen(false);
      }
      if (editCourseDropRef.current && !editCourseDropRef.current.contains(e.target as Node)) {
        setEditCourseDropOpen(false);
        setEditCourseSearch("");
      }
      if (onboardMajorRef.current && !onboardMajorRef.current.contains(e.target as Node)) {
        setOnboardMajorOpen(false);
        setOnboardMajorSearch("");
      }
      if (editMajorRef.current && !editMajorRef.current.contains(e.target as Node)) {
        setEditMajorOpen(false);
        setEditMajorSearch("");
      }
      if (majorFilterRef.current && !majorFilterRef.current.contains(e.target as Node)) {
        setMajorFilterOpen(false);
        setMajorFilterSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Smart auto-scroll: only scroll to bottom if user is already near the bottom.
  // This keeps the user's reading position when the AI replies with a long answer.
  const smartScroll = (endRef: React.RefObject<HTMLDivElement | null>) => {
    const el = endRef.current;
    if (!el) return;
    const scroller = el.closest(".chat-scroll, .page-scroll, .scroll-col") as HTMLElement | null;
    if (scroller) {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      // Only auto-scroll if the user is within 120px of the bottom
      if (distanceFromBottom > 120) return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // ── Auth listener ────────────────────────────────────────────────────
  useEffect(() => {
    const loadTimeout = setTimeout(() => setLoading(false), 5000);
    getSessionCached().then(async ({ data: { session } }) => {
      clearTimeout(loadTimeout);
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? "" });
        setErrorUserId(session.user.id);
        // Capture name from OAuth provider metadata (Google, Apple, etc.)
        const meta = session.user.user_metadata;
        const oauthName = meta?.full_name || meta?.name || meta?.preferred_username || "";
        if (oauthName) {
          setProfile(p => ({ ...p, name: p.name || oauthName }));
          setAuthForm(f => ({ ...f, name: f.name || oauthName }));
        }
        const p = await loadProfile(session.user.id);
        // Profile auto-created by DB trigger on signup — treat empty uni as needing onboarding
        setScreen((p && p.uni) ? "discover" : "onboard");
      }
      setLoading(false);
    }).catch((e) => { logError("getSession", e); clearTimeout(loadTimeout); setLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setScreen("auth");
        setAuthMode("new-password");
        return;
      }
      // Skip token refresh events — they just renew the JWT, no need to reload profile
      if (event === "TOKEN_REFRESHED") return;
      if (event === "INITIAL_SESSION") return; // handled by getSession above
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? "" });
        setErrorUserId(session.user.id);
        // Capture name from OAuth provider metadata (Google, Apple, etc.)
        const meta = session.user.user_metadata;
        const oauthName = meta?.full_name || meta?.name || meta?.preferred_username || "";
        if (oauthName) {
          setProfile(p => ({ ...p, name: p.name || oauthName }));
          setAuthForm(f => ({ ...f, name: f.name || oauthName }));
        }
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          const p = await loadProfile(session.user.id);
          if (!p || !p.uni) trackEvent("signup");  // New or incomplete user
          // Profile auto-created by DB trigger — treat empty uni as needing onboarding
          setScreen((p && p.uni) ? "discover" : "onboard");
        }
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setProfile({ name:"", uni:"", major:"", course:"", year:"", meet_type:"flexible", bio:"", avatar_emoji:"🫶", avatar_color:"#6C8EF5", photo_mode:"initials", photo_url:null, streak:0, xp:0, badges:[], sessions:0, rating:0, subjects:[] });
        setConnections([]);
        setMessages({});
        setAllStudents([]);
        setSubjectHistory([]);
        setHelpRequests([]);
        setGroups([]);
        setNotifications([]);
        setCanPost(false);
        setActiveChat(null);
        setDismissed({});
        setRatings({});
        resetAIRef.current();
        try { clearAllMemory(); } catch (_) {}
        setScreen("landing");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Set online=false when user closes/leaves tab
  useEffect(() => {
    if (!user) return;
    const setOffline = () => {
      // Get the current session token for proper RLS auth
      getSessionCached().then(({ data: { session } }) => {
        const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${token}`,
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ online: false }),
          keepalive: true,
        }).catch(() => {});
      }).catch(() => {});
    };
    const onVisChange = () => {
      if (document.visibilityState === "hidden") setOffline();
      else if (document.visibilityState === "visible" && user) {
        supabase.from("profiles").update({ online: true }).eq("id", user.id).then(() => {});
      }
    };
    window.addEventListener("beforeunload", setOffline);
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      window.removeEventListener("beforeunload", setOffline);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    // Fire all data loads in parallel for faster initial load
    Promise.all([
      loadConnections(),
      loadHelpRequests(),
      loadGroups(),
      loadSubjectHistory(),
      loadAllStudents(),
      loadMatchQuiz(),
      loadSavedPlans(),
      loadUnreadCounts(),
      loadLastReceivedTimestamps(),
      loadPartnersWithMessages(),
    ]).catch((e) => logError("initialDataLoad", e));
  }, [user?.id]);


  // ── Data loaders ─────────────────────────────────────────────────────
  const loadProfile = async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await withRetry<Profile>(() =>
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
      );
      if (error) { logError("loadProfile", error); return null; }
      if (!data) return null;
      setProfile(data);
      return data;
    } catch (e) { logError("loadProfile", e); return null; }
  };

  const loadSubjectHistory = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("subject_history").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
      if (error) { return; }
      if (data) setSubjectHistory(data);
    } catch { }
  };

  // ── Award badge ───────────────────────────────────────────────────────
  const awardBadge = async (id: string) => {
    if (!user || earnedBadges.includes(id)) return;
    const b = BADGES_DEF.find(b=>b.id===id);
    if (!b) return;
    try {
      const newBadges = [...earnedBadges, id];
      let latestXp = 0;
      setProfile(p => {
        latestXp = (p.xp || 0) + b.xp;
        return { ...p, badges: newBadges, xp: latestXp };
      });
      // Use setTimeout(0) to ensure setProfile updater has run and latestXp is populated
      await new Promise(r => setTimeout(r, 0));
      const { error } = await supabase.from("profiles").update({ badges: newBadges, xp: latestXp }).eq("id", user.id);
      if (!error) setNewBadge(b);
    } catch { }
  };

  const {
    groups, setGroups, showGrpModal, setShowGrpModal, newGrp, setNewGrp,
    editingRoom, setEditingRoom, editGrp, setEditGrp,
    confirmDeleteRoom, setConfirmDeleteRoom, roomActionLoading,
    loadGroups, submitGroup, openEditRoom, saveEditRoom, deleteRoom, toggleJoinGroup,
    viewingMembersRoom, roomMembers, loadingMembers, openRoomMembers, closeRoomMembers,
  } = useRooms(awardBadge);

  const {
    connections, setConnections,
    ratings, setRatings,
    rateModal, setRateModal,
    hoverStar, setHoverStar,
    activeChat, setActiveChat,
    messages, setMessages,
    newMsg, setNewMsg,
    chatEndRef,
    schedModal, setSchedModal,
    schedForm, setSchedForm,
    isRecording, recordingTime,
    chatFileRef,
    pendingMsgs,
    unreadCounts, setUnreadCounts, totalUnread,
    lastReceivedAt, setLastReceivedAt,
    partnersWithMessages, setPartnersWithMessages,
    loadUnreadCounts, loadLastReceivedTimestamps, loadPartnersWithMessages, markAsRead,
    loadConnections, loadMessages,
    sendMessage, startRecording, stopRecording,
    handleChatFileSelect, submitRating,
  } = useMessages(awardBadge);

  // ── Chat scroll + realtime (must be after useMessages) ──
  const activeChatMsgCount = (activeChat ? (messages[activeChat.id] || []).length : 0);
  useEffect(() => { smartScroll(chatEndRef); }, [activeChat, activeChatMsgCount]);

  useEffect(() => {
    if (!user || !activeChat) return;
    loadMessages(activeChat.id).then(() => {
      // Force scroll to bottom when opening a conversation
      setTimeout(() => { chatEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" }); }, 50);
    });
    // Mark all messages from this partner as read, clear unread badge
    markAsRead(activeChat.id);
  }, [user?.id, activeChat?.id]);

  // Keep viewingChatRef in sync so the realtime handler knows if the user
  // is currently looking at a conversation with this sender.
  useEffect(() => {
    viewingChatRef.current = { partnerId: activeChat?.id || null, screen };
    // When user actively enters the connect tab for this chat, also mark read
    if (screen === "connect" && activeChat && user) {
      markAsRead(activeChat.id);
    }
  }, [activeChat?.id, screen, user?.id]);

  // Reload connections when switching to connect tab (catches new connections from other users)
  useEffect(() => {
    if (screen === "connect" && user) {
      loadConnections();
    }
  }, [screen, user?.id]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`msgs-all-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `receiver_id=eq.${user.id}`,
      }, (payload) => {
        const msg = payload.new as Message;
        const partnerId = msg.sender_id;
        // If this sender isn't in our connections, reload connections
        setConnections(prev => {
          if (!prev.some(c => c.id === partnerId)) {
            // Trigger a full reload to get the new connection's profile
            loadConnections();
          }
          return prev;
        });
        // Remember that we now have a conversation with this partner
        setPartnersWithMessages(prev => prev.has(partnerId) ? prev : new Set(prev).add(partnerId));
        // Track when this partner last messaged us (for inbox sort)
        setLastReceivedAt(prev => ({ ...prev, [partnerId]: msg.created_at || new Date().toISOString() }));
        setMessages(prev => {
          const existing = prev[partnerId] || [];
          if (existing.some(m => m.id === msg.id)) return prev;
          return { ...prev, [partnerId]: [...existing, msg] };
        });
        // Bump unread count unless the user is actively viewing this chat.
        // Use ref (not closed-over state) so we see the CURRENT view, not the value from when this handler was set up.
        const vc = viewingChatRef.current;
        const isViewingThisChat = vc.partnerId === partnerId && vc.screen === "connect";
        if (!isViewingThisChat) {
          setUnreadCounts(prev => ({ ...prev, [partnerId]: (prev[partnerId] || 0) + 1 }));
        } else {
          // User is actively in this chat — mark the new message read immediately
          supabase.from("messages").update({ read: true }).eq("id", msg.id).then(() => {});
        }
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `sender_id=eq.${user.id}`,
      }, (payload) => {
        const msg = payload.new as Message & { client_id?: string };
        setMessages(prev => {
          const partnerId = msg.receiver_id;
          const existing = prev[partnerId] || [];
          if (existing.some(m => m.id === msg.id)) return prev;
          if (msg.client_id) {
            const expectedTempId = `temp-${msg.client_id}`;
            if (pendingMsgs.current.has(msg.client_id)) {
              pendingMsgs.current.delete(msg.client_id);
              if (existing.some(m => m.id === expectedTempId)) {
                return { ...prev, [partnerId]: existing.map(m => m.id === expectedTempId ? msg : m) };
              }
              return prev;
            }
            if (existing.some(m => m.id === expectedTempId)) {
              return { ...prev, [partnerId]: existing.map(m => m.id === expectedTempId ? msg : m) };
            }
            return prev;
          }
          const tempIdx = existing.findIndex(m => m.id.startsWith("temp-") && m.text === msg.text);
          if (tempIdx >= 0) {
            const updated = [...existing];
            updated[tempIdx] = msg;
            return { ...prev, [partnerId]: updated };
          }
          return { ...prev, [partnerId]: [...existing, msg] };
        });
      })
      // Also listen for new connections added to this user
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "connections",
        filter: `user_id=eq.${user.id}`,
      }, () => {
        loadConnections();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const {
    editProfile, setEditProfile,
    editCourseSearch, setEditCourseSearch,
    editCourseDropOpen, setEditCourseDropOpen,
    editCourseDropRef,
    editMajorSearch, setEditMajorSearch,
    editMajorOpen, setEditMajorOpen,
    editMajorRef,
    profileTab, setProfileTab,
    parseCourses, serializeCourses,
    editCoursesList, editFilteredCourseOptions,
    subjectHistory, setSubjectHistory,
    showSubModal, setShowSubModal,
    newSub, setNewSub,
    profileSaveLoading,
    photoInputRef, cropModal, setCropModal,
    cropZoom, setCropZoom, cropPos, setCropPos,
    cropCanvasRef, cropDragging, cropLastPos,
    cropImgDims, cropInitialZoom,
    reportModal, setReportModal, reportReason, setReportReason,
    viewingProfile, setViewingProfile,
    handlePhotoUpload, cropAndUpload, saveProfile,
    submitSubject, markSubjectDone, submitReport,
  } = useProfile(awardBadge, uniDataReady);

  const {
    allStudents, setAllStudents,
    helpRequests, setHelpRequests,
    canPost, setCanPost, postLoading,
    dismissed, setDismissed,
    subjectFilter, setSubjectFilter,
    uniFilter, setUniFilter,
    majorFilter, setMajorFilter,
    majorFilterSearch, setMajorFilterSearch,
    majorFilterOpen, setMajorFilterOpen,
    majorFilterRef,
    typeFilter, setTypeFilter,
    courseSearch, setCourseSearch,
    courseDropOpen, setCourseDropOpen,
    courseDropRef,
    flyCard, setFlyCard,
    allCourseOptions, filteredCourseOptions,
    showReqModal, setShowReqModal,
    newReq, setNewReq,
    loadAllStudents, loadHelpRequests, enablePosting,
    openReqModal, submitRequest, handleReject,
  } = useDiscover(awardBadge, uniDataReady);

  const {
    authMode, setAuthMode,
    authForm, setAuthForm,
    authError, setAuthError,
    authLoading,
    resetEmail, setResetEmail,
    newPassword, setNewPassword,
    onboardMajorSearch, setOnboardMajorSearch,
    onboardMajorOpen, setOnboardMajorOpen,
    onboardMajorRef,
    step, setStep,
    onboardLoading,
    handleAuth, handleOAuth, handleResetPassword, handleNewPassword, handleOnboard,
  } = useAuth(loadProfile, loadAllStudents);

  const { adminTab, setAdminTab, adminReports, adminPosts, adminAnalytics, loadAdminData, adminDeletePost, loadAdminAnalytics } = useAdmin(
    (postId) => setHelpRequests(p => p.filter(x => x.id !== postId))
  );

  const openStudentProfile = (userId: string, cachedProfile?: Profile) => {
    trackClick("post_click", { target_user: userId });
    if (userId === user?.id) { setScreen("profile"); return; }
    const cached = cachedProfile
      || (allStudents as any[]).find((s: any) => s.id === userId)
      || connections.find(c => c.id === userId);
    if (cached) {
      setViewingProfile(cached as Profile);
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
        .then(({ data }) => { if (data) setViewingProfile(prev => prev?.id === userId ? data as Profile : prev); });
      return;
    }
    if (!navigator.onLine) { showNotif("You're offline — can't load this profile right now.", "err"); return; }
    setViewingProfile({ id: userId, name: "Loading...", email: "", uni: "", major: "", year: "", course: "", meet_type: "", bio: "", avatar_emoji: "⏳", avatar_color: "#ccc", photo_mode: "initials", photo_url: null, streak: 0, xp: 0, badges: [], online: false, sessions: 0, rating: 0, subjects: [], created_at: "" } as Profile);
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
      .then(({ data }) => {
        setViewingProfile(prev => {
          if (!prev || prev.id !== userId) return prev;
          if (data) return data as Profile;
          showNotif(!navigator.onLine ? "Can't load profile — you're offline." : "Profile not found", "err");
          return null;
        });
      });
  };

  const {
    aiTab, setAiTab, aiLang, setAiLang,
    tutorMsgs, setTutorMsgs, tutorInput, setTutorInput,
    tutorLoading, tutorSubject, setTutorSubject,
    tutorFile, setTutorFile, tutorFileRef, tutorEndRef,
    matchScores, matchLoading, matchQuiz, setMatchQuiz, matchQuizSaved,
    planSubjects, setPlanSubjects, planExamDates, setPlanExamDates,
    planResult, setPlanResult, planLoading, savedPlans,
    aiVersion, aiUserTier,
    wellbeingMsgs, setWellbeingMsgs, wellbeingInput, setWellbeingInput,
    wellbeingLoading, wellbeingMood, setWellbeingMood,
    wellbeingMode, setWellbeingMode, wellbeingEndRef,
    aiLimitModal, setAiLimitModal, earlyAccessEmail, setEarlyAccessEmail, earlyAccessSent, setEarlyAccessSent,
    loadSavedPlans, savePlanAsNote, loadMatchQuiz, saveMatchQuiz,
    sendTutorMessage, sendWellbeingMessage, loadMatchScores, generateStudyPlan,
    resetAI,
  } = useAI(allStudents);
  resetAIRef.current = resetAI;

  useEffect(() => { smartScroll(tutorEndRef); }, [tutorMsgs]);
  useEffect(() => { smartScroll(wellbeingEndRef); }, [wellbeingMsgs]);

  // ── Connect / Reject ──────────────────────────────────────────────────
  const handleConnect = async (s: Profile & {_postId?: string; _postSubject?: string}) => {
    if (!user || connectingRef.current) return;
    if (!navigator.onLine) { showNotif("You're offline — can't connect right now. Try again when online.", "err"); return; }
    connectingRef.current = true;
    const key = s._postId || s.id;

    // Open the chat immediately — user lands in the messages view right away.
    // DB upsert happens in the background; on failure we roll back.
    setFlyCard({id:key,dir:"up"});
    setConnections(prev => prev.some(c=>(c as any).id===s.id||(c as any).partner_id===s.id) ? prev : [...prev, s]);
    setDismissed(prev=>({...prev,[key]:true}));
    setActiveChat(s);
    setScreen("connect");

    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(async () => {
      try {
        const { data: { session } } = await getSessionCached();
        if (!session) {
          showNotif("Session expired — please sign in again", "err");
          setFlyCard(null); connectingRef.current = false; setScreen("auth");
          return;
        }
        const { error } = await supabase.from("connections").upsert([
          { user_id: user.id, partner_id: s.id },
          { user_id: s.id, partner_id: user.id },
        ], { onConflict: "user_id,partner_id" });
        if (error) {
          logError("handleConnect:upsert", error);
          showNotif("Connection failed — try again", "err");
          setConnections(prev => prev.filter(c => (c as any).id !== s.id));
          setDismissed(prev => { const n = { ...prev }; delete n[key]; return n; });
          setActiveChat(null);
          setScreen("discover");
          setFlyCard(null); connectingRef.current = false;
          return;
        }
        setFlyCard(null);
        setProfile(p => {
          const newXp = (p.xp || 0) + 20;
          supabase.from("profiles").update({ xp: newXp }).eq("id", user.id).then(() => {});
          return { ...p, xp: newXp };
        });
        showNotif(`You matched with ${s.name}! 🎉`);
        trackEvent("connect", { partner_id: s.id });
        if (!earnedBadges.includes("first_connect")) awardBadge("first_connect");
        // Match emails are not implemented server-side yet — dead fetch removed.
      } catch (e) {
        logError("handleConnect", e);
        showNotif("Connection failed — check your internet", "err");
        setConnections(prev => prev.filter(c => (c as any).id !== s.id));
        setActiveChat(null);
        setScreen("discover");
        setFlyCard(null);
      }
      connectingRef.current = false;
    }, 200);
  };



  // ── Schedule session ──────────────────────────────────────────────────
  const submitSchedule = async () => {
    if (!schedForm.date||!schedForm.time||!user||!schedModal) return showNotif("Pick a date and time","err");
    try {
      const text = `📅 Session booked: ${schedForm.date} at ${schedForm.time} — ${getMeetLabel(schedForm.type)}${schedForm.note?" | "+schedForm.note:""}`;
      const { error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: schedModal.id,
        text,
        message_type: "text",
      });
      if (error) { showNotif("Failed to schedule — try again", "err"); return; }
      // Email notification — server verifies session + connection and looks
      // up the receiver email itself; we only pass receiverId + preview.
      if (user) {
        (async () => {
          try {
            const { data: { session: notifSess } } = await getSessionCached();
            if (!notifSess?.access_token) return;
            await fetch("/api/notify/message", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${notifSess.access_token}`,
              },
              body: JSON.stringify({ receiverId: schedModal.id, messagePreview: text }),
            });
          } catch { /* best-effort */ }
        })();
      }
      await loadMessages(schedModal.id);
      setSchedModal(null);
      setSchedForm({date:"",time:"",type:"online",note:""});
      showNotif("Session scheduled! ✅");
    } catch { showNotif("Failed to schedule", "err"); }
  };


  useEffect(() => {
    if (!newBadge) return;
    const t = setTimeout(() => setNewBadge(null), 3500);
    return () => clearTimeout(t);
  }, [newBadge]);

  const handleSignOut = async () => {
    // 1. Set user offline in DB (while session is still valid for RLS)
    if (user) {
      try { await supabase.from("profiles").update({ online: false }).eq("id", user.id); } catch {}
    }
    // 2. Tell Supabase to sign out FIRST (needs session token to revoke server-side)
    try { await supabase.auth.signOut({ scope: "global" }); } catch (_) { /* session may already be gone */ }
    // 3. Clear ALL Supabase storage AFTER signOut — prevents stale session on reload
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth")) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth")) sessionStorage.removeItem(k);
    });
    // 4. Clear AI memory
    try { clearAllMemory(); } catch (_) {}
    // 5. Reset ALL app state
    setErrorUserId(null);
    setUser(null);
    setProfile({ name:"", uni:"", major:"", course:"", year:"", meet_type:"flexible", bio:"", avatar_emoji:"🫶", avatar_color:"#6C8EF5", photo_mode:"initials", photo_url:null, streak:0, xp:0, badges:[], sessions:0, rating:0, subjects:[] });
    setConnections([]);
    setMessages({});
    setAllStudents([]);
    setSubjectHistory([]);
    setHelpRequests([]);
    setGroups([]);
    setNotifications([]);
    setCanPost(false);
    setActiveChat(null);
    setDismissed({});
    setRatings({});
    setScreen("landing");
    // 5. Hard reload to fully reset — small delay so state updates flush
    setTimeout(() => { window.location.href = window.location.origin; }, 150);
  };


  // Derived discover deck — each entry is a post (help_request + profile)
  const connectionIds = useMemo(() => new Set(connections.map(c=>c.id)), [connections]);
  const filteredPool = useMemo(() => allStudents.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => {
    const subjectMatch = !subjectFilter || (s._postSubject && s._postSubject.trim().toLowerCase() === subjectFilter.trim().toLowerCase());
    const uniMatch     = uniMatches(s.uni || "", uniFilter);
    const majorMatch   = majorMatches(s.major || "", majorFilter);
    const typeMatch    = !typeFilter    || (s._postMeetType || s.meet_type) === typeFilter;
    return subjectMatch && uniMatch && majorMatch && typeMatch;
  }), [allStudents, subjectFilter, uniFilter, majorFilter, typeFilter]);
  const visibleDeck = useMemo(() => filteredPool.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => s._isOwn || !dismissed[s._postId || s.id]), [filteredPool, dismissed]);
  const nonOwnPool = useMemo(() => filteredPool.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => !s._isOwn), [filteredPool]);
  const allDismissed = nonOwnPool.length > 0 && visibleDeck.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => !s._isOwn).length === 0;
  const noFilterResults = filteredPool.length === 0 && allStudents.length > 0;
  const curTab = screen;

  const completionFields = [profile.name, profile.uni, profile.major, profile.year, profile.bio];
  const completionPct = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);

  // ── Sub-components (stateless, kept in render for closure access to T/user/profile) ──
  const Logo = ({size=21, compact=false}: {size?:number; compact?:boolean}) => {
    const scale = size / 21;
    const w = Math.round(160 * scale);
    const h = compact ? Math.round(32 * scale) : Math.round(64 * scale);
    const vb = compact ? "60 30 280 70" : "0 0 400 160";
    return (
      <span style={{cursor:"pointer",display:"inline-flex",alignItems:"center"}} onClick={()=>!user&&setScreen("landing")}>
        <svg width={w} height={h} viewBox={vb}><text x="200" y="88" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="500" fontSize="52" fill={T.navy} letterSpacing="-1">Bas Udrus</text><circle cx="318" cy="50" r="5" fill="#4F7EF7"/><line x1="130" y1="105" x2="270" y2="105" stroke="#4F7EF7" strokeWidth="2"/>{!compact && <text x="200" y="124" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="11" fill="#888888" letterSpacing="4">STUDY SMARTER</text>}</svg>
      </span>
    );
  };

  const Stars = ({rating, size=14}: {rating:number; size?:number}) => (
    <span style={{color:T.gold,fontSize:size}}>{"★".repeat(Math.floor(rating))}{"☆".repeat(5-Math.floor(rating))} <span style={{color:T.muted,fontSize:size-2}}>{rating.toFixed(1)}</span></span>
  );

  const StreakBadge = () => (
    <div className="streak-badge pulse">🔥 {streak} day streak</div>
  );

  const XPBar = () => {
    const level = Math.floor((xp||0)/500)+1;
    const pct = (((xp||0)%500)/500)*100;
    return (
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{background:T.accentSoft,color:T.accent,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>Lv.{level}</div>
        <div style={{flex:1,height:6,background:T.border,borderRadius:99,overflow:"hidden"}}>
          <div className="xp-bar-fill" style={{width:"100%",transform:`scaleX(${pct/100})`}}/>
        </div>
        <span style={{fontSize:11,color:T.muted,fontWeight:600}}>{xp||0} XP</span>
      </div>
    );
  };

  if (loading) return (
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:20}}>
      <style>{makeCSS(T)}</style>
      <div style={{textAlign:"center",animation:"fadeIn 0.6s ease"}}>
        <svg width="280" height="112" viewBox="0 0 400 160" style={{marginBottom:16}}><text x="200" y="88" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="500" fontSize="52" fill={T.navy} letterSpacing="-1">Bas Udrus</text><circle cx="318" cy="50" r="5" fill="#4F7EF7"/><line x1="130" y1="105" x2="270" y2="105" stroke="#4F7EF7" strokeWidth="2"/><text x="200" y="124" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="11" fill="#888888" letterSpacing="4">STUDY SMARTER</text></svg>
        <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:8}}>
          {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:T.accent,opacity:0.6,animation:`pulse ${0.8+i*0.2}s ease-in-out infinite`}}/>)}
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // LANDING
  // ═══════════════════════════════════════════════════════════════════════════════
  if (screen==="landing") return (
    <div style={{minHeight:"100dvh",background:T.bg,transition:"background-color 0.3s",overflowX:"hidden",position:"relative"}}>
      <style>{makeCSS(T)}</style>
      {/* ── Full-screen background glow ── */}
      <div className="mesh-glow" style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:0,pointerEvents:"none"}} />
      {/* ── STICKY NAV ── */}
      <nav className="landing-nav" style={{padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.navBg,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:50,backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)"}}>
        <Logo size={22} compact/>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button className="btn-ghost" style={{padding:"8px 16px",fontSize:12,borderRadius:99}} onClick={()=>{setAuthMode("login");setScreen("auth");}}>Log in</button>
          <button className="btn-primary" style={{padding:"8px 18px",fontSize:12,borderRadius:99,background:"#E8722A",boxShadow:"0 4px 16px rgba(232,114,42,0.3)"}} onClick={()=>{setAuthMode("signup");setScreen("auth");}}>Get started free</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="landing-hero" style={{maxWidth:960,margin:"0 auto",padding:"72px 24px 48px",display:"flex",flexDirection:"column",alignItems:"center",gap:36,position:"relative"}}>

        <div style={{textAlign:"center",maxWidth:720,zIndex:1,position:"relative"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:T.surface,border:`1px solid ${T.border}`,padding:"6px 16px",borderRadius:99,fontSize:11,color:T.textSoft,marginBottom:24,boxShadow:"0 2px 12px rgba(0,0,0,0.04)"}}>
            <span style={{width:7,height:7,background:T.green,borderRadius:"50%",display:"inline-block",boxShadow:`0 0 0 3px ${T.greenSoft}`}}/>
            Built for Jordanian university students
          </div>
          <h1 style={{fontSize:"clamp(56px, 10vw, 84px)",fontWeight:800,letterSpacing:"-0.04em",lineHeight:1.05,color:T.navy,marginBottom:20,zIndex:1,position:"relative"}}>
            Find your ultimate <span style={{background:"linear-gradient(135deg, #4A7CF7, #43C59E)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>study partner</span>
          </h1>
          <p style={{fontSize:18,color:T.textSoft,lineHeight:1.75,maxWidth:540,marginBottom:32,textAlign:"center",margin:"0 auto 32px"}}>
            Match with students at your university who take the exact same course — study together online or on campus. Free, fast, and built just for you.
          </p>
          <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:16}}>
            <button className="btn-primary hero-cta" style={{padding:"18px 48px",fontSize:18,background:"#E8722A",boxShadow:"0 6px 24px rgba(232,114,42,0.3)",border:"none",color:"#fff",borderRadius:16,fontWeight:700,cursor:"pointer",letterSpacing:"-0.01em"}} onClick={()=>{setAuthMode("signup");setScreen("auth");}}>Find my study partner →</button>
          </div>
          <p style={{fontSize:13,color:T.muted}}>Free forever · No credit card · 60 seconds to sign up</p>
        </div>
        {/* Trust indicators — horizontal row below */}
        <div style={{display:"flex",flexDirection:"column",gap:14,alignItems:"center",width:"100%",maxWidth:800}}>
          <div className="hero-trust" style={{width:"100%",background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,padding:"24px 28px",boxShadow:"0 4px 24px rgba(0,0,0,0.06)",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:20}}>
            {[
              {bg:T.accentSoft,icon:"📚",title:"Course-level matching",desc:"Same class, same exams, same struggle"},
              {bg:T.greenSoft,icon:"🤖",title:"AI study tools",desc:"Tutor, planner, and mental health support"},
              {bg:T.goldSoft||T.accentSoft,icon:"🇯🇴",title:"Made in Jordan",desc:"Your courses, your campus, your language"},
            ].map((item,i)=>(
              <div key={i} className="hero-trust-item" style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="hero-trust-icon" style={{width:42,height:42,borderRadius:14,background:item.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{item.icon}</div>
                <div>
                  <div className="hero-trust-title" style={{fontSize:13,fontWeight:700,color:T.navy}}>{item.title}</div>
                  <div className="hero-trust-desc" style={{fontSize:11,color:T.muted}}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"center",alignItems:"center"}}>
            {(getUniCards().length > 0 ? getUniCards().map(u=>u.uni) : ["PSUT","UJ","GJU","AAU","ASU","MEU","AUM"]).map(u=>(
              <div key={u} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"8px 16px",fontSize:12,fontWeight:700,color:T.navy,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>{u}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── SOCIAL PROOF TICKER ── */}
      <div style={{background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,padding:"14px 20px",textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",gap:24,flexWrap:"wrap",fontSize:13,color:T.muted}}>
          <span style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,background:T.green,borderRadius:"50%",display:"inline-block"}}/>Students online now</span>
          <span>🤝 Matches made daily</span>
          <span>🎓 8 Universities</span>
          <span>📚 27,000+ Courses</span>
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <div className="landing-section" style={{background:T.bg,padding:"56px 24px"}}>
        <div style={{maxWidth:900,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:36}}>
            <div style={{display:"inline-block",background:T.accentSoft,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>How It Works</div>
            <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Three steps to your <span style={{fontStyle:"italic",color:T.accent}}>study partner</span></h2>
            <p className="section-subtitle" style={{fontSize:14,color:T.textSoft,maxWidth:460,margin:"0 auto",lineHeight:1.7}}>Takes less than a minute. No complicated setup.</p>
          </div>
          <div className="landing-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16}}>
            {[
              {step:"1",icon:"✍️",title:"Create your profile",desc:"Sign up with your email, pick your university and courses. Tell us how you like to study."},
              {step:"2",icon:"🎯",title:"Get matched",desc:"Our AI finds students in your exact courses who match your style — online, in-person, or both."},
              {step:"3",icon:"💬",title:"Study together",desc:"Message your partner, schedule sessions, and use our AI tutor to ace your exams as a team."}
            ].map((item,i)=>(
              <motion.div key={i} className="landing-step" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5,delay:i*0.1}} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:"28px 22px",textAlign:"left",position:"relative",overflow:"hidden",boxShadow:"0 2px 16px rgba(0,0,0,0.04)",transition:"transform 0.2s,box-shadow 0.2s"}}>
                <div className="landing-step-num" style={{width:34,height:34,borderRadius:10,background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:T.accent,marginBottom:14}}>{item.step}</div>
                <div className="landing-step-icon" style={{fontSize:24,marginBottom:10}}>{item.icon}</div>
                <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:6}}>{item.title}</h3>
                <p style={{fontSize:13,color:T.textSoft,lineHeight:1.7,margin:0}}>{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <div className="landing-section" style={{padding:"56px 24px",background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
        <div style={{maxWidth:960,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:36}}>
            <div style={{display:"inline-block",background:T.greenSoft,color:T.green,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>Features</div>
            <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Everything you need to <span style={{fontStyle:"italic",color:T.accent}}>study smarter</span></h2>
            <p className="section-subtitle" style={{fontSize:14,color:T.textSoft,maxWidth:500,margin:"0 auto",lineHeight:1.7}}>More than a matching app — a complete study ecosystem built around Jordanian students.</p>
          </div>
          <div className="bento-grid">
            {[
              {icon:"🤝",title:"Study Partner Matching",desc:"AI pairs you with students in your exact course, matching study style and schedule preferences."},
              {icon:"🎓",title:"AI Tutor — Ustaz",desc:"Your personal AI teaching assistant. Upload course materials, ask questions, get explanations 24/7."},
              {icon:"💚",title:"Mental Health Support",desc:"A caring AI companion for when stress hits. Breathing exercises, coping tools, and gentle bilingual support."},
              {icon:"🏠",title:"Study Rooms",desc:"Create or join group study sessions. Set times, invite classmates, and keep each other accountable."},
              {icon:"📅",title:"AI Study Planner",desc:"Get a personalized weekly study schedule based on your courses, exams, and available time."},
              {icon:"🎯",title:"Smart Matchmaking",desc:"Psychology-based questionnaire finds your ideal study partner based on learning style and personality."}
            ].map((feat,i)=>(
              <motion.div key={i} className="landing-feat" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5,delay:i*0.1}} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:18,padding:"26px 22px",textAlign:"left",boxShadow:"0 2px 12px rgba(0,0,0,0.03)",transition:"transform 0.2s,box-shadow 0.2s"}}>
                <div className="landing-feat-icon" style={{fontSize:30,marginBottom:12}}>{feat.icon}</div>
                <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:6}}>{feat.title}</h3>
                <p style={{fontSize:13,color:T.textSoft,lineHeight:1.7,margin:0}}>{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* ── UNIVERSITIES ── */}
      <div className="landing-section" style={{background:T.bg,padding:"56px 24px"}}>
        <div style={{maxWidth:900,margin:"0 auto",textAlign:"center"}}>
          <div style={{display:"inline-block",background:T.goldSoft||T.accentSoft,color:T.gold||T.accent,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>Universities</div>
          <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Built for <span style={{fontStyle:"italic",color:T.accent}}>your campus</span></h2>
          <p className="section-subtitle" style={{fontSize:14,color:T.textSoft,maxWidth:500,margin:"0 auto 32px",lineHeight:1.7}}>Every course, every major, every campus. We built Bas Udrus from the ground up for Jordanian universities.</p>
          <div className="landing-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:18,marginBottom:32}}>
            {getUniCards().map((u,i)=>(
              <motion.div key={i} className="landing-uni-card" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5,delay:i*0.1}} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:"28px 22px",textAlign:"center",boxShadow:"0 2px 16px rgba(0,0,0,0.04)",transition:"transform 0.2s,box-shadow 0.2s"}}>
                <div className="landing-uni-emoji" style={{fontSize:34,marginBottom:10}}>{u.emoji}</div>
                <div className="landing-uni-name" style={{fontSize:22,fontWeight:800,color:T.navy,marginBottom:4}}>{u.uni}</div>
                <div style={{fontSize:13,color:T.textSoft,lineHeight:1.5}}>{u.full}</div>
              </motion.div>
            ))}
          </div>
          <p style={{fontSize:13,color:T.muted}}>7 Jordanian universities and growing — request yours after signing up!</p>
        </div>
      </div>

      {/* ── ABOUT US ── */}
      <div className="landing-section" style={{padding:"56px 24px",background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
        <div style={{maxWidth:720,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{display:"inline-block",background:T.accentSoft,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:2,padding:"5px 14px",borderRadius:99,marginBottom:14,textTransform:"uppercase"}}>About Us</div>
            <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(26px,5.5vw,44px)",color:T.navy,marginBottom:8,lineHeight:1.12}}>Built by a student, <span style={{fontStyle:"italic",color:T.accent}}>for students</span></h2>
          </div>
          <motion.div className="landing-about" initial={{opacity:0,y:40}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{duration:0.5}} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:20,padding:"28px 24px",boxShadow:"0 4px 24px rgba(0,0,0,0.05)"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:20,flexWrap:"wrap"}}>
              <div className="bu-logo" style={{width:52,height:52,borderRadius:16,background:"linear-gradient(135deg,#4A7CF7,#6C8EF5)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:18,flexShrink:0}}>BU</div>
              <div style={{flex:1,minWidth:200}}>
                <div className="story-title" style={{fontSize:17,fontWeight:800,color:T.navy,marginBottom:6}}>Our Story</div>
                <p className="story-text" style={{fontSize:14,color:T.textSoft,lineHeight:1.8,margin:"0 0 12px"}}>
                  Bas Udrus started from a simple frustration: studying alone in Jordan is hard. You sit in a lecture hall with hundreds of students, yet finding someone to review with before the exam feels impossible.
                </p>
                <p className="story-text" style={{fontSize:14,color:T.textSoft,lineHeight:1.8,margin:"0 0 12px"}}>
                  We built this platform at PSUT because we believe every Jordanian student deserves a study partner who understands their courses, their campus, and their challenges — whether it is Calculus at UJ, Data Structures at PSUT, Engineering at GJU, or Pharmacy at AAU.
                </p>
                <p className="story-text" style={{fontSize:14,color:T.textSoft,lineHeight:1.8,margin:0}}>
                  Bas Udrus is not a big company. It is a student project that grew into something real. We are still building, still improving, and every suggestion from our users makes it better.
                </p>
              </div>
            </div>
            <div style={{borderTop:`1px solid ${T.border}`,paddingTop:20,display:"flex",gap:24,flexWrap:"wrap"}}>
              {[
                {icon:"🎯",label:"Mission",value:"Every student finds their study partner"},
                {icon:"🇯🇴",label:"Origin",value:"Built in Amman, Jordan"},
                {icon:"💡",label:"Status",value:"Active development — your feedback shapes us"},
              ].map(item=>(
                <div key={item.label} style={{flex:"1 1 160px",minWidth:140}}>
                  <div style={{fontSize:20,marginBottom:6}}>{item.icon}</div>
                  <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{item.label}</div>
                  <div style={{fontSize:14,color:T.navy,fontWeight:600,lineHeight:1.5}}>{item.value}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── FINAL CTA ── */}
      <div className="landing-cta-section" style={{padding:"60px 24px",textAlign:"center",background:`linear-gradient(180deg,${T.bg} 0%,${T.accentSoft} 100%)`}}>
        <div style={{maxWidth:580,margin:"0 auto"}}>
          <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(28px,6vw,48px)",color:T.navy,marginBottom:14,lineHeight:1.08,letterSpacing:"-0.02em"}}>Ready to find your <span style={{fontStyle:"italic",color:T.accent}}>study partner?</span></h2>
          <p style={{fontSize:16,color:T.textSoft,lineHeight:1.75,maxWidth:420,margin:"0 auto 28px"}}>Join Jordanian students who stopped studying alone. It is free, takes 60 seconds, and might just save your GPA.</p>
          <button className="btn-primary hero-cta" style={{padding:"15px 36px",fontSize:16,background:"#E8722A",boxShadow:"0 6px 28px rgba(232,114,42,0.3)",border:"none",color:"#fff",borderRadius:14,fontWeight:700,cursor:"pointer"}} onClick={()=>{setAuthMode("signup");setScreen("auth");}}>Get started free →</button>
          <p style={{fontSize:12,color:T.muted,marginTop:16}}>Free forever · No credit card required</p>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="landing-footer" style={{borderTop:`1px solid ${T.border}`,padding:"40px 24px",textAlign:"center",background:T.surface}}>
        <div style={{fontSize:15,color:T.muted,lineHeight:2}}>
          <span style={{fontWeight:700,color:T.navy,fontSize:16}}>Bas Udrus</span> — Study Smarter, Together.
          <br/>Made with care in Amman, Jordan.
          <br/>
          <span style={{fontSize:13}}>Questions? Contact us at <a href="mailto:basudrusjo@gmail.com" style={{color:T.accent,textDecoration:"none",fontWeight:600}}>basudrusjo@gmail.com</a></span>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════════════════════
  if (screen==="auth") return (
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <style>{makeCSS(T)}</style>
      <nav className="nav-inner" style={{padding:"16px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.navBg,borderBottom:`1px solid ${T.border}`}}>
        <Logo size={21} compact/>
      </nav>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
        <div className="fade-in card auth-card" style={{padding:36,width:"100%",maxWidth:420,boxShadow:"0 8px 48px rgba(0,0,0,0.10)"}}>

          {/* ── New Password (after reset link clicked) ── */}
          {authMode==="new-password"&&(
            <>
              <h2 style={{fontSize:22,fontWeight:700,color:T.navy,marginBottom:4}}>Set new password</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>Choose a strong password for your account.</p>
              <div className="field" style={{marginBottom:authError?10:24}}>
                <label>New Password</label>
                <input type="password" placeholder="Min. 6 characters" value={newPassword} onChange={e=>setNewPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleNewPassword()} maxLength={128}/>
              </div>
              {authError&&<div style={{background:T.redSoft,border:`1px solid ${T.red}33`,borderRadius:11,padding:"10px 14px",fontSize:13,color:T.red,marginBottom:16}}>{authError}</div>}
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14,opacity:authLoading?0.7:1}} onClick={handleNewPassword} disabled={authLoading}>
                {authLoading?"Updating...":"Update Password →"}
              </button>
            </>
          )}

          {/* ── Reset sent confirmation ── */}
          {authMode==="reset-sent"&&(
            <>
              <div style={{fontSize:48,textAlign:"center",marginBottom:16}}>📬</div>
              <h2 style={{fontSize:20,fontWeight:700,color:T.navy,textAlign:"center",marginBottom:8}}>Check your inbox</h2>
              <p style={{fontSize:13,color:T.muted,textAlign:"center",marginBottom:24,lineHeight:1.7}}>We sent a password reset link to <strong>{resetEmail}</strong>. Click the link in the email to set a new password.</p>
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14}} onClick={()=>{setAuthMode("login");setAuthError("");}}>
                Back to Log In →
              </button>
            </>
          )}

          {/* ── Forgot password form ── */}
          {authMode==="reset"&&(
            <>
              <h2 style={{fontSize:22,fontWeight:700,color:T.navy,marginBottom:4}}>Reset password</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>Enter your email and we'll send you a reset link.</p>
              <div className="field" style={{marginBottom:authError?10:24}}>
                <label>Email Address</label>
                <input type="email" placeholder="you@university.edu" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleResetPassword()} maxLength={254}/>
              </div>
              {authError&&<div style={{background:T.redSoft,border:`1px solid ${T.red}33`,borderRadius:11,padding:"10px 14px",fontSize:13,color:T.red,marginBottom:16}}>{authError}</div>}
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14,opacity:authLoading?0.7:1}} onClick={handleResetPassword} disabled={authLoading}>
                {authLoading?"Sending...":"Send Reset Link →"}
              </button>
              <p style={{textAlign:"center",marginTop:16,fontSize:13,color:T.accent,cursor:"pointer",fontWeight:600}} onClick={()=>{setAuthMode("login");setAuthError("");}}>← Back to Log In</p>
            </>
          )}

          {/* ── Sign up / Log in form ── */}
          {(authMode==="signup"||authMode==="login")&&(
            <>
              <div style={{display:"flex",background:T.bg,borderRadius:13,padding:4,marginBottom:28,border:`1px solid ${T.border}`}}>
                {(["signup","login"] as const).map(m=>(
                  <button key={m} onClick={()=>{setAuthMode(m);setAuthError("");}}
                    style={{flex:1,padding:"9px 0",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",transition:"background-color 0.2s,color 0.2s,box-shadow 0.2s",background:authMode===m?T.surface:"transparent",color:authMode===m?T.navy:T.muted,boxShadow:authMode===m?"0 2px 8px rgba(0,0,0,0.08)":"none"}}>
                    {m==="signup"?"Create Account":"Log In"}
                  </button>
                ))}
              </div>

              {/* Social buttons */}
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
                <button onClick={()=>handleOAuth("google")} disabled={authLoading}
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"12px 0",border:`1.5px solid ${T.border}`,borderRadius:12,background:T.surface,cursor:"pointer",fontSize:14,fontWeight:600,color:T.navy,transition:"box-shadow 0.2s",opacity:authLoading?0.7:1}}>
                  <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.97 6.19C12.43 13.72 17.74 9.5 24 9.5z"/></svg>
                  Continue with Google
                </button>
              </div>

              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <div style={{flex:1,height:1,background:T.border}}/>
                <span style={{fontSize:12,color:T.muted,flexShrink:0}}>or continue with email</span>
                <div style={{flex:1,height:1,background:T.border}}/>
              </div>

              {authMode==="signup"&&(
                <div className="field"><label>Full Name</label><input placeholder="e.g. Ahmad Khalil" value={authForm.name} onChange={e=>setAuthForm(p=>({...p,name:e.target.value}))} maxLength={100}/></div>
              )}
              <div className="field"><label>Email Address</label><input type="email" placeholder="you@university.edu" value={authForm.email} onChange={e=>setAuthForm(p=>({...p,email:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleAuth()} maxLength={254}/></div>
              <div className="field" style={{marginBottom:2}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <label style={{margin:0}}>Password</label>
                  {authMode==="login"&&(
                    <span style={{fontSize:12,color:T.accent,cursor:"pointer",fontWeight:600}} onClick={()=>{setAuthMode("reset");setResetEmail(authForm.email);setAuthError("");}}>Forgot password?</span>
                  )}
                </div>
                <input type="password" placeholder={authMode==="signup"?"Min. 6 characters":"Your password"} value={authForm.password} onChange={e=>setAuthForm(p=>({...p,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleAuth()} maxLength={128}/>
              </div>
              {authError&&(
                <div style={{background:T.redSoft,border:`1px solid ${T.red}33`,borderRadius:11,padding:"10px 14px",fontSize:13,color:T.red,marginTop:10,marginBottom:6}}>{authError}</div>
              )}
              <button className="btn-primary" style={{width:"100%",padding:14,fontSize:15,borderRadius:14,marginTop:18,opacity:authLoading?0.7:1}} onClick={handleAuth} disabled={authLoading}>
                {authLoading ? "Please wait..." : authMode==="signup"?"Find my study partner 🎯":"Log in →"}
              </button>
              <p style={{textAlign:"center",marginTop:16,fontSize:13,color:T.muted}}>
                {authMode==="signup"?"Already have an account? ":"Don't have an account? "}
                <span style={{color:T.accent,cursor:"pointer",fontWeight:700}} onClick={()=>{setAuthMode(authMode==="signup"?"login":"signup");setAuthError("");}}>
                  {authMode==="signup"?"Log in":"Join free →"}
                </span>
              </p>
            </>
          )}

          <p style={{textAlign:"center",marginTop:12,fontSize:12,color:T.muted,cursor:"pointer"}} onClick={()=>setScreen("landing")}>← Back to home</p>
        </div>
      </div>
      <div style={{borderTop:`1px solid ${T.border}`,padding:"14px 20px",textAlign:"center",background:T.surface,marginTop:"auto"}}>
        <div style={{fontSize:11,color:T.muted,lineHeight:1.6}}>
          <span style={{fontWeight:700,color:T.navy}}>Bas Udrus</span> — Study Smarter, Together. · Made in Amman 🇯🇴
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // ONBOARDING
  // ═══════════════════════════════════════════════════════════════════════════════
  if (screen==="onboard") return (
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <style>{makeCSS(T)}</style>
      {notif&&<div className="notif" style={{background:notif.type==="err"?T.red:T.navy,color:"#fff"}}>{notif.msg}</div>}
      <nav className="nav-inner" style={{padding:"16px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",background:T.navBg,borderBottom:`1px solid ${T.border}`}}>
        <Logo size={21} compact/>
        <div style={{display:"flex",gap:6}}>
          {[1,2].map(i=><div key={i} style={{width:32,height:5,borderRadius:99,background:step>=i?T.accent:T.border,transition:"background-color 0.3s"}}/>)}
        </div>
        <span style={{fontSize:13,color:T.muted}}>Step {step} of 2</span>
      </nav>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
        <div className="fade-in card" style={{padding:36,width:"100%",maxWidth:440,boxShadow:"0 8px 48px rgba(0,0,0,0.10)"}}>
          {step===1&&(
            <>
              <div style={{fontSize:32,marginBottom:10}}>👋</div>
              <h2 style={{fontSize:21,fontWeight:700,color:T.navy,marginBottom:4}}>Hey {(profile.name||authForm.name).split(" ")[0]}!</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>Tell us about yourself — we'll match you with the right people.</p>
              <div className="field"><label>University *</label>
                <select value={profile.uni||""} onChange={e=>setProfile(p=>({...p,uni:e.target.value}))}>
                  <option value="">Select your university</option>
                  {getUniversities().map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="field"><label>Major *</label>
                <div ref={onboardMajorRef} style={{position:"relative"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"12px 14px",border:`1.5px solid ${profile.major?T.accent:T.border}`,borderRadius:14,fontSize:16,background:T.surface,cursor:"text"}} onClick={()=>setOnboardMajorOpen(true)}>
                    <span style={{fontSize:15,flexShrink:0}}>🎓</span>
                    <input type="text" placeholder={profile.major||"Search your major..."} value={onboardMajorOpen?onboardMajorSearch:(profile.major||"")} onChange={e=>{setOnboardMajorSearch(e.target.value);setOnboardMajorOpen(true);}} onFocus={()=>{setOnboardMajorOpen(true);setOnboardMajorSearch("");}} style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:16,fontWeight:profile.major&&!onboardMajorOpen?600:400,color:T.text,minWidth:0,width:"100%"}}/>
                    {profile.major&&(<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();setProfile(p=>({...p,major:""}));setOnboardMajorSearch("");setOnboardMajorOpen(false);}} style={{background:"none",border:"none",cursor:"pointer",color:T.muted,fontSize:17,padding:0,lineHeight:1,flexShrink:0}}>×</button>)}
                  </div>
                  {onboardMajorOpen&&(()=>{
                    const majors = profile.uni ? getMajorsForUni(profile.uni) : getAllMajors();
                    const q = onboardMajorSearch.toLowerCase();
                    const filtered = q ? majors.filter(m=>m.toLowerCase().includes(q)) : majors;
                    return (<div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:300,background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.13)",maxHeight:220,overflowY:"auto"}}>
                      {filtered.length===0?(<div style={{padding:"20px 14px",textAlign:"center",fontSize:13,color:T.muted}}>No majors match "{onboardMajorSearch}"</div>):(
                        filtered.map(m=>(<div key={m} onMouseDown={e=>{e.preventDefault();setProfile(p=>({...p,major:m}));setOnboardMajorSearch("");setOnboardMajorOpen(false);}} style={{padding:"9px 14px",cursor:"pointer",fontSize:13,color:m===profile.major?T.accent:T.text,fontWeight:m===profile.major?700:400,background:m===profile.major?T.accentSoft:"transparent"}} onMouseEnter={e=>{if(m!==profile.major)(e.currentTarget as HTMLDivElement).style.background=T.border;}} onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=m===profile.major?T.accentSoft:"transparent";}}>{m}</div>))
                      )}
                    </div>);
                  })()}
                </div>
              </div>
              <div className="field"><label>Year *</label>
                <select value={profile.year||""} onChange={e=>setProfile(p=>({...p,year:e.target.value}))}>
                  <option value="">Select year</option>
                  {["Year 1","Year 2","Year 3","Year 4","Year 5"].map(y=><option key={y}>{y}</option>)}
                </select>
              </div>
              <button className="btn-primary" style={{width:"100%",padding:13,fontSize:15,borderRadius:14,marginTop:4}}
                onClick={()=>{if(!profile.uni||!profile.major||!profile.year)return showNotif("Please fill all required fields","err");setStep(2);}}>
                Next →
              </button>
            </>
          )}
          {step===2&&(
            <>
              <div style={{fontSize:32,marginBottom:10}}>📝</div>
              <h2 style={{fontSize:21,fontWeight:700,color:T.navy,marginBottom:4}}>How do you want to study?</h2>
              <p style={{fontSize:13,color:T.muted,marginBottom:24}}>This helps others decide if you're a good match for them.</p>
              <div className="field"><label>Meet preference</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[["online","🎥","Online"],["face","📍","On Campus"],["flexible","💬","Flexible"]].map(([val,icon,lbl])=>(
                    <div key={val} className={`meet-opt ${profile.meet_type===val?"active":""}`} onClick={()=>setProfile(p=>({...p,meet_type:val}))}>
                      <div style={{fontSize:22}}>{icon}</div>
                      <div style={{fontSize:11,fontWeight:700,marginTop:4,color:profile.meet_type===val?T.accent:T.textSoft}}>{lbl}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="field"><label>Short bio (optional)</label>
                <textarea rows={3} placeholder="e.g. I need help with Calculus before finals, available weekends." value={profile.bio||""} onChange={e=>setProfile(p=>({...p,bio:e.target.value}))} maxLength={500}/>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setStep(1)}>← Back</button>
                <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14,opacity:onboardLoading?0.7:1}} onClick={handleOnboard} disabled={onboardLoading}>{onboardLoading?"Saving...":"Let's go! 🎯"}</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div style={{borderTop:`1px solid ${T.border}`,padding:"14px 20px",textAlign:"center",background:T.surface,marginTop:"auto"}}>
        <div style={{fontSize:11,color:T.muted,lineHeight:1.6}}>
          <span style={{fontWeight:700,color:T.navy}}>Bas Udrus</span> — Study Smarter, Together. · Made in Amman 🇯🇴
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // MAIN APP
  // ═══════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{height:"100dvh",background:T.bg,display:"flex",flexDirection:"column",transition:"background-color 0.3s",overflow:"hidden"}}>
      <style>{makeCSS(T)}</style>

      {notif&&<div className="notif" style={{background:notif.type==="err"?T.red:T.navy,color:"#fff"}}>{notif.msg}</div>}

      {/* ── Offline / Back-online banner ── */}
      {showOfflineBanner&&(
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:10000,padding:"10px 16px",textAlign:"center",fontSize:13,fontWeight:700,color:"#fff",background:isOnline?"#22c55e":"#ef4444",transition:"background 0.3s",animation:"slideDown 0.3s ease"}}>
          {isOnline ? "✅ Back online" : "📡 No internet connection — some features won't work"}
        </div>
      )}

      {newBadge&&(
        <div style={{position:"fixed",top:72,left:"50%",transform:"translateX(-50%)",background:T.goldSoft,border:`2px solid ${T.gold}`,borderRadius:20,padding:"16px 24px",zIndex:9998,display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 32px rgba(0,0,0,0.15)",animation:"bounceIn 0.45s ease"}}>
          <span style={{fontSize:36}}>{newBadge.icon}</span>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:T.navy}}>Badge Unlocked! 🎉</div>
            <div style={{fontSize:13,color:T.textSoft}}>{newBadge.name} — +{newBadge.xp} XP</div>
          </div>
        </div>
      )}

      {/* ── Password change modal ── */}
      {passwordModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setPasswordModal(false)}>
          <div className="modal" style={{maxWidth:380}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>🔑 Change Password</h3>
              <button onClick={()=>setPasswordModal(false)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <div className="field"><label>New Password</label><input type="password" placeholder="Min 6 characters" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoFocus/></div>
            <button className="btn-primary" style={{width:"100%",marginTop:12}} onClick={async ()=>{
              if(newPassword.trim().length<6){showNotif("Password must be at least 6 characters","err");return;}
              const{error}=await supabase.auth.updateUser({password:newPassword.trim()});
              if(error)showNotif("Error: "+error.message,"err");
              else{showNotif("Password updated!");setPasswordModal(false);setNewPassword("");}
            }}>Update Password</button>
          </div>
        </div>
      )}

      {/* ── Session scheduler modal ── */}
      {schedModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setSchedModal(null)}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>📅 Schedule Session</h3><p style={{fontSize:12,color:T.muted,marginTop:2}}>with {schedModal.name}</p></div>
              <button onClick={()=>setSchedModal(null)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <div className="field"><label>Date</label><input type="date" value={schedForm.date} onChange={e=>setSchedForm(p=>({...p,date:e.target.value}))}/></div>
            <div className="field"><label>Time</label><input type="time" value={schedForm.time} onChange={e=>setSchedForm(p=>({...p,time:e.target.value}))}/></div>
            <div className="field"><label>Session type</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[["online","🎥","Online"],["face","📍","On Campus"],["flexible","💬","TBD"]].map(([val,icon,lbl])=>(
                  <div key={val} className={`meet-opt ${schedForm.type===val?"active":""}`} onClick={()=>setSchedForm(p=>({...p,type:val}))}>
                    <div style={{fontSize:18}}>{icon}</div><div style={{fontSize:11,fontWeight:700,marginTop:3,color:schedForm.type===val?T.accent:T.textSoft}}>{lbl}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="field"><label>Note (optional)</label><textarea rows={2} placeholder="e.g. Zoom link or campus room" value={schedForm.note} onChange={e=>setSchedForm(p=>({...p,note:e.target.value}))} maxLength={500}/></div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setSchedModal(null)}>Cancel</button>
              <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={submitSchedule}>Book Session ✅</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rate modal ── */}
      {rateModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setRateModal(null)}>
          <div className="modal" style={{textAlign:"center"}}>
            <div style={{fontSize:48,marginBottom:8}}>⭐</div>
            <h3 style={{fontSize:18,fontWeight:700,color:T.navy,marginBottom:6}}>Rate your session</h3>
            <p style={{fontSize:13,color:T.muted,marginBottom:20}}>How was your study session with {rateModal.name}?</p>
            <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:24}}>
              {[1,2,3,4,5].map(n=>(
                <span key={n} className="star" style={{color:n<=(hoverStar||ratings[rateModal.id]||0)?T.gold:"#ccc",fontSize:36}} onMouseEnter={()=>setHoverStar(n)} onMouseLeave={()=>setHoverStar(0)} onClick={()=>submitRating(rateModal.id,n)}>★</span>
              ))}
            </div>
            <button className="btn-ghost" onClick={()=>setRateModal(null)}>Skip for now</button>
          </div>
        </div>
      )}

      {/* ── Help request modal ── */}
      <input ref={photoInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhotoUpload}/>

      {/* ── Photo Crop Modal ── */}
      {cropModal&&(
        <div className="modal-bg" onClick={()=>setCropModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:440,padding:28}}>
            <h3 style={{fontSize:18,fontWeight:800,color:T.navy,marginBottom:2,textAlign:"center"}}>Adjust Your Photo</h3>
            <p style={{fontSize:12,color:T.muted,textAlign:"center",marginBottom:20}}>Drag to reposition · Pinch or slide to zoom</p>

            {/* Preview circle — 260px for better visibility */}
            <div style={{width:260,height:260,margin:"0 auto 20px",borderRadius:"50%",overflow:"hidden",border:`3px solid ${T.accent}`,position:"relative",cursor:cropDragging.current?"grabbing":"grab",background:T.bg,touchAction:"none",boxShadow:`0 0 0 4px ${T.bg}, 0 0 0 5px ${T.border}, 0 8px 32px rgba(0,0,0,0.12)`}}
              onMouseDown={e=>{e.preventDefault();cropDragging.current=true;cropLastPos.current={x:e.clientX,y:e.clientY};}}
              onMouseMove={e=>{if(!cropDragging.current)return;const dx=e.clientX-cropLastPos.current.x;const dy=e.clientY-cropLastPos.current.y;setCropPos(p=>({x:p.x+dx,y:p.y+dy}));cropLastPos.current={x:e.clientX,y:e.clientY};}}
              onMouseUp={()=>{cropDragging.current=false;}}
              onMouseLeave={()=>{cropDragging.current=false;}}
              onTouchStart={e=>{const t=e.touches[0];cropDragging.current=true;cropLastPos.current={x:t.clientX,y:t.clientY};}}
              onTouchMove={e=>{if(!cropDragging.current)return;const t=e.touches[0];const dx=t.clientX-cropLastPos.current.x;const dy=t.clientY-cropLastPos.current.y;setCropPos(p=>({x:p.x+dx,y:p.y+dy}));cropLastPos.current={x:t.clientX,y:t.clientY};}}
              onTouchEnd={()=>{cropDragging.current=false;}}
              onWheel={e=>{e.preventDefault();const delta=e.deltaY>0?-0.02:0.02;setCropZoom(z=>Math.max(0.1,Math.min(5,z+delta)));}}
            >
              {cropImgDims && (
                <img src={cropModal.src} alt="Crop preview" draggable={false} style={{
                  position:"absolute",
                  left:"50%",top:"50%",
                  width: cropImgDims.w * cropZoom,
                  height: cropImgDims.h * cropZoom,
                  transform:`translate(-50%,-50%) translate(${cropPos.x}px,${cropPos.y}px)`,
                  pointerEvents:"none",
                  userSelect:"none",
                }}/>
              )}
            </div>

            {/* Zoom controls */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"0 8px"}}>
              <button onClick={()=>setCropZoom(z=>Math.max(0.1,z-0.05))} style={{width:32,height:32,borderRadius:8,border:`1.5px solid ${T.border}`,background:T.surface,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",color:T.text}}>−</button>
              <input type="range" min={cropInitialZoom*0.3} max={cropInitialZoom*4} step="0.005" value={cropZoom}
                onChange={e=>setCropZoom(parseFloat(e.target.value))}
                style={{flex:1,accentColor:T.accent,height:6}}/>
              <button onClick={()=>setCropZoom(z=>Math.min(5,z+0.05))} style={{width:32,height:32,borderRadius:8,border:`1.5px solid ${T.border}`,background:T.surface,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",color:T.text}}>+</button>
              <span style={{fontSize:11,color:T.muted,fontWeight:700,minWidth:40,textAlign:"right"}}>{cropImgDims?Math.round((cropZoom/cropInitialZoom)*100):100}%</span>
            </div>

            {/* Quick presets */}
            <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:20}}>
              {[
                {label:"Fill",val:cropInitialZoom,icon:"📐"},
                {label:"Close-up",val:cropInitialZoom*1.5,icon:"🔍"},
                {label:"Zoomed",val:cropInitialZoom*2.2,icon:"🎯"},
              ].map(z=>(
                <button key={z.label} onClick={()=>{setCropZoom(z.val);setCropPos({x:0,y:0});}}
                  style={{padding:"7px 14px",borderRadius:99,fontSize:11,fontWeight:700,border:`1.5px solid ${Math.abs(cropZoom-z.val)<0.02?T.accent:T.border}`,background:Math.abs(cropZoom-z.val)<0.02?T.accentSoft:"transparent",color:Math.abs(cropZoom-z.val)<0.02?T.accent:T.muted,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                  <span>{z.icon}</span> {z.label}
                </button>
              ))}
              <button onClick={()=>{setCropZoom(cropInitialZoom);setCropPos({x:0,y:0});}}
                style={{padding:"7px 14px",borderRadius:99,fontSize:11,fontWeight:700,border:`1.5px solid ${T.border}`,background:"transparent",color:T.muted,cursor:"pointer"}}>
                ↺ Reset
              </button>
            </div>

            {/* Actions */}
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:1,padding:13,borderRadius:14}} onClick={()=>setCropModal(null)}>Cancel</button>
              <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={cropAndUpload}>💾 Save Photo</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Student profile modal ── */}
      {viewingProfile&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setViewingProfile(null)}>
          <div className="modal" style={{maxWidth:480}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>Student Profile</h3>
              <button onClick={()=>setViewingProfile(null)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18}}>
              <UserAvatar p={viewingProfile} size={72} ring T={T}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:20,color:T.navy}}>{viewingProfile.name}</div>
                <div style={{fontSize:14,color:T.textSoft,marginTop:3}}>{viewingProfile.uni} · {viewingProfile.year}</div>
                {viewingProfile.major&&<div style={{fontSize:13,color:T.muted,marginTop:2}}>📖 {viewingProfile.major}</div>}
                <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
                  <span style={{fontSize:13,fontWeight:700,color:viewingProfile.online?T.green:T.muted}}>{viewingProfile.online?"🟢 Online":"⚪ Offline"}</span>
                  {viewingProfile.rating>0&&<Stars rating={viewingProfile.rating} size={13}/>}
                </div>
              </div>
            </div>
            {viewingProfile.bio&&<p style={{fontSize:14,color:T.textSoft,lineHeight:1.72,marginBottom:14,background:T.bg,borderRadius:12,padding:"12px 16px"}}>{viewingProfile.bio}</p>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              {(viewingProfile.subjects?.length?viewingProfile.subjects:parseCourses(viewingProfile.course ?? "")).filter(Boolean).map(sub=>(
                <span key={sub} style={{background:T.accentSoft,color:T.accent,padding:"5px 12px",borderRadius:99,fontSize:12,fontWeight:700}}>📚 {sub}</span>
              ))}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              <div style={{background:T.bg,borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:600,color:T.textSoft}}>{getMeetIcon(viewingProfile.meet_type||"flexible")} {getMeetLabel(viewingProfile.meet_type||"flexible")}</div>
              <div style={{background:T.bg,borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:600,color:T.textSoft}}>🔥 {viewingProfile.streak||0} day streak</div>
              <div style={{background:T.bg,borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:600,color:T.textSoft}}>⚡ {viewingProfile.xp||0} XP</div>
              <div style={{background:T.bg,borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:600,color:T.textSoft}}>📊 {viewingProfile.sessions||0} sessions</div>
            </div>
            {viewingProfile.badges?.length>0&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Badges</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {viewingProfile.badges.map((bid:string)=>{const b=BADGES_DEF.find(x=>x.id===bid);return b?<span key={bid} title={b.name+": "+b.desc} style={{background:T.goldSoft,border:`1px solid ${T.gold}33`,borderRadius:9,padding:"5px 10px",fontSize:14}}>{b.icon} <span style={{fontSize:11,fontWeight:700}}>{b.name}</span></span>:null;})}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setViewingProfile(null)}>Close</button>
              {connections.find(c=>c.id===viewingProfile.id)?(
                <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={()=>{const c=connections.find(c=>c.id===viewingProfile.id);if(c){setActiveChat(c);setScreen("connect");loadMessages(c.id);setViewingProfile(null);}}}>Message →</button>
              ):(
                <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={()=>{handleConnect(viewingProfile);setViewingProfile(null);}}>Connect →</button>
              )}
            </div>
            {viewingProfile.id!==user?.id&&(
              <button style={{background:"none",border:"none",color:T.red,fontSize:12,fontWeight:600,cursor:"pointer",marginTop:12,opacity:0.7}} onClick={()=>{setReportModal({userId:viewingProfile.id,name:viewingProfile.name});setViewingProfile(null);}}>🚩 Report this account</button>
            )}
          </div>
        </div>
      )}

      {/* ── Report modal ── */}
      {/* ── AI Limit — Premium Upsell Modal ── */}
      {aiLimitModal.show&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setAiLimitModal({show:false,reason:"",endpoint:""})} style={{zIndex:9999}}>
          <div className="modal fade-in" style={{maxWidth:420,textAlign:"center",padding:"40px 32px",borderRadius:24,background:`linear-gradient(145deg, ${T.surface}, ${T.bg})`,border:`1.5px solid ${T.accent}30`,boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
            {/* Decorative top accent */}
            <div style={{width:64,height:64,borderRadius:20,background:`linear-gradient(135deg, ${T.accent}, ${T.navy})`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:28,boxShadow:`0 8px 24px ${T.accent}40`}}>
              {aiLimitModal.endpoint==="wellbeing"?"💙":"🎓"}
            </div>

            <h3 style={{fontSize:20,fontWeight:800,color:T.navy,marginBottom:8,letterSpacing:"-0.3px"}}>
              {aiLimitModal.reason==="daily_limit" ? "You've reached today's limit" : "Time for a short break"}
            </h3>

            <p style={{fontSize:14,color:T.muted,lineHeight:1.7,marginBottom:24,maxWidth:320,margin:"0 auto 24px"}}>
              {aiLimitModal.reason==="daily_limit"
                ? `You've used all your free ${aiLimitModal.endpoint==="wellbeing"?"wellbeing":"tutor"} messages for today. Your limit resets tomorrow.`
                : "You've been studying hard! Your messages will refresh in about an hour."
              }
            </p>

            {/* Coming soon badge */}
            <div style={{display:"inline-flex",alignItems:"center",gap:6,background:`linear-gradient(135deg, ${T.accent}15, ${T.navy}15)`,padding:"8px 18px",borderRadius:99,marginBottom:20,border:`1px solid ${T.accent}25`}}>
              <span style={{fontSize:13}}>✨</span>
              <span style={{fontSize:13,fontWeight:700,color:T.accent}}>Unlimited Plan — Coming Soon</span>
            </div>

            <p style={{fontSize:13,color:T.textSoft,lineHeight:1.6,marginBottom:24}}>
              We're building a premium plan with unlimited AI access, priority responses, and exclusive features. Be the first to know.
            </p>

            {/* Early access form */}
            {!earlyAccessSent ? (
              <div style={{display:"flex",gap:8,marginBottom:20}}>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={earlyAccessEmail}
                  onChange={e=>setEarlyAccessEmail(e.target.value)}
                  style={{flex:1,padding:"12px 16px",borderRadius:14,border:`1.5px solid ${T.border}`,fontSize:14,background:T.surface,color:T.text,outline:"none"}}
                  onFocus={e=>{e.currentTarget.style.borderColor=T.accent;}}
                  onBlur={e=>{e.currentTarget.style.borderColor=T.border;}}
                />
                <button
                  onClick={async()=>{
                    if(!earlyAccessEmail.includes("@")){showNotif("Enter a valid email","err");return;}
                    try{
                      await supabase.from("notifications").insert({user_id:user?.id||"00000000-0000-0000-0000-000000000000",from_id:user?.id||"00000000-0000-0000-0000-000000000000",type:"early_access",subject:earlyAccessEmail,post_id:null});
                    }catch{}
                    setEarlyAccessSent(true);
                    showNotif("You're on the list!");
                  }}
                  style={{padding:"12px 20px",borderRadius:14,background:`linear-gradient(135deg, ${T.accent}, ${T.navy})`,color:"#fff",border:"none",fontSize:14,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",boxShadow:`0 4px 12px ${T.accent}40`}}
                >
                  Notify Me
                </button>
              </div>
            ) : (
              <div style={{padding:"14px 20px",borderRadius:14,background:T.greenSoft,color:T.green,fontWeight:700,fontSize:14,marginBottom:20}}>
                🎉 You're on the early access list!
              </div>
            )}

            {/* Action buttons */}
            <div style={{display:"flex",gap:10}}>
              <button
                onClick={()=>setAiLimitModal({show:false,reason:"",endpoint:""})}
                style={{flex:1,padding:"13px",borderRadius:14,border:`1.5px solid ${T.border}`,background:T.surface,color:T.text,fontSize:14,fontWeight:600,cursor:"pointer"}}
              >
                Got it
              </button>
              <button
                onClick={()=>{setAiLimitModal({show:false,reason:"",endpoint:""});setScreen("discover");}}
                style={{flex:1,padding:"13px",borderRadius:14,border:"none",background:T.navy,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}
              >
                Browse Posts
              </button>
            </div>

            <p style={{fontSize:11,color:T.muted,marginTop:16,opacity:0.6}}>
              Free users get 30 AI messages per day • Resets at midnight
            </p>
          </div>
        </div>
      )}

      {reportModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setReportModal(null)}>
          <div className="modal" style={{maxWidth:420}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>🚩 Report Account</h3>
              <button onClick={()=>setReportModal(null)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <p style={{fontSize:13,color:T.muted,marginBottom:14}}>Reporting <strong>{reportModal.name}</strong>. Please describe the issue:</p>
            <div className="field">
              <textarea rows={3} placeholder="Describe why you're reporting this account..." value={reportReason} onChange={e=>setReportReason(e.target.value)} style={{fontSize:14}} maxLength={500}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:0.45}} onClick={()=>{setReportModal(null);setReportReason("");}}>Cancel</button>
              <button className="btn-danger" style={{flex:1,padding:13,borderRadius:14,opacity:reportReason.trim()?1:0.45,cursor:reportReason.trim()?"pointer":"not-allowed"}} onClick={reportReason.trim()?submitReport:undefined}>Submit Report</button>
            </div>
          </div>
        </div>
      )}

      {showReqModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setShowReqModal(false)}>
          <div className="modal" style={{maxWidth:420}}>
            {/* Header with accent icon */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
              <div style={{width:42,height:42,borderRadius:13,background:"linear-gradient(135deg,#4F7EF7,#6C8EF5)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:20,color:"#fff",fontWeight:700,lineHeight:1}}>+</span>
              </div>
              <div style={{flex:1}}>
                <h3 style={{fontSize:17,fontWeight:700,color:T.navy,margin:0}}>Post a Study Request</h3>
                <p style={{fontSize:12,color:T.muted,marginTop:2}}>Students in your course will see this</p>
              </div>
              <button onClick={()=>setShowReqModal(false)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted,padding:4}}>×</button>
            </div>

            {/* Course field */}
            <div className="field" style={{marginBottom:14}}>
              <label style={{display:"flex",alignItems:"center",gap:5}}>
                Course <span style={{color:T.red,fontSize:13,fontWeight:700}}>*</span>
              </label>
              <CourseSearch T={T} value={newReq.subject} onChange={v=>setNewReq(p=>({...p,subject:v}))} uniFilter={profile.uni||""} majorFilter={profile.major||""} placeholder="e.g. Calculus 2, Data Structures..."/>
            </div>

            {/* Detail field */}
            <div className="field" style={{marginBottom:14}}>
              <label style={{display:"flex",alignItems:"center",gap:5}}>
                What do you need? <span style={{color:T.red,fontSize:13,fontWeight:700}}>*</span>
              </label>
              <textarea rows={2} placeholder="e.g. Struggling with integration by parts before Friday's exam" value={newReq.detail} onChange={e=>setNewReq(p=>({...p,detail:e.target.value}))} maxLength={500} style={{lineHeight:1.5}}/>
            </div>

            {/* Meet preference — compact */}
            <div style={{marginBottom:18}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>How do you want to meet?</div>
              <div style={{display:"flex",gap:8}}>
                {[["online","🎥","Online"],["face","📍","Campus"],["flexible","💬","Either"]].map(([val,icon,lbl])=>(
                  <button key={val} onClick={()=>setNewReq(p=>({...p,meetType:val}))}
                    style={{flex:1,padding:"10px 8px",borderRadius:12,border:`1.5px solid ${newReq.meetType===val?T.accent:T.border}`,background:newReq.meetType===val?T.accentSoft:"transparent",cursor:"pointer",textAlign:"center",transition:"all 0.15s"}}>
                    <div style={{fontSize:16}}>{icon}</div>
                    <div style={{fontSize:11,fontWeight:newReq.meetType===val?700:500,marginTop:3,color:newReq.meetType===val?T.accent:T.textSoft}}>{lbl}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button className="btn-primary" onClick={(newReq.subject&&newReq.detail?.trim())?submitRequest:undefined}
              style={{width:"100%",padding:14,borderRadius:14,fontSize:15,fontWeight:700,opacity:(newReq.subject&&newReq.detail?.trim())?1:0.45,cursor:(newReq.subject&&newReq.detail?.trim())?"pointer":"not-allowed",background:(newReq.subject&&newReq.detail?.trim())?"linear-gradient(135deg,#4F7EF7,#6C8EF5)":undefined,boxShadow:(newReq.subject&&newReq.detail?.trim())?"0 4px 20px rgba(74,124,247,0.3)":"none"}}>
              {postLoading?"Posting...":"Post Request"}
            </button>
          </div>
        </div>
      )}

      {/* ── Subject modal ── */}
      {showSubModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setShowSubModal(false)}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>📚 Add Subject to History</h3>
              <button onClick={()=>setShowSubModal(false)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <div className="field"><label>Subject *</label>
              <CourseSearch T={T} value={newSub.subject} onChange={v=>setNewSub(p=>({...p,subject:v}))} uniFilter={profile.uni||""} majorFilter={profile.major||""} placeholder="Search for a subject..."/>
            </div>
            <div className="field"><label>Status</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[["active","🔥","Active"],["paused","⏸","Paused"],["done","✅","Done"]].map(([val,icon,lbl])=>(
                  <div key={val} className={`meet-opt ${newSub.status===val?"active":""}`} onClick={()=>setNewSub(p=>({...p,status:val}))}>
                    <div style={{fontSize:18}}>{icon}</div><div style={{fontSize:11,fontWeight:700,marginTop:3,color:newSub.status===val?T.accent:T.textSoft}}>{lbl}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="field"><label>Note (optional)</label><textarea rows={2} placeholder="e.g. Finished with help from Sara" value={newSub.note} onChange={e=>setNewSub(p=>({...p,note:e.target.value}))} maxLength={500}/></div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setShowSubModal(false)}>Cancel</button>
              <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={submitSubject}>Add Subject ✅</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Group room modal ── */}
      {showGrpModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setShowGrpModal(false)}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>🎓 Create Study Room</h3><p style={{fontSize:12,color:T.muted,marginTop:2}}>Invite others to study with you</p></div>
              <button onClick={()=>setShowGrpModal(false)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <div className="field"><label>Subject *</label>
              <CourseSearch T={T} value={newGrp.subject} onChange={v=>setNewGrp(p=>({...p,subject:v}))} placeholder="Search for a subject..."/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="field"><label>Date *</label><input type="date" value={newGrp.date} onChange={e=>setNewGrp(p=>({...p,date:e.target.value}))}/></div>
              <div className="field"><label>Time *</label><input type="time" value={newGrp.time} onChange={e=>setNewGrp(p=>({...p,time:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Type</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[["online","🎥","Online"],["face","📍","Campus"],["flexible","💬","Flexible"]].map(([val,icon,lbl])=>(
                  <div key={val} className={`meet-opt ${newGrp.type===val?"active":""}`} onClick={()=>setNewGrp(p=>({...p,type:val}))}>
                    <div style={{fontSize:18}}>{icon}</div><div style={{fontSize:11,fontWeight:700,marginTop:3,color:newGrp.type===val?T.accent:T.textSoft}}>{lbl}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="field"><label>Max spots</label><input type="number" min={2} max={20} value={newGrp.spots} onChange={e=>setNewGrp(p=>({...p,spots:Number(e.target.value)}))}/></div>
              <div className="field"><label>{newGrp.type==="face"?"Location":"Meeting link"}</label><input placeholder={newGrp.type==="face"?"Library Room 4":"zoom.us/j/..."} value={newGrp.type==="face"?newGrp.location:newGrp.link} onChange={e=>setNewGrp(p=>({...p,[newGrp.type==="face"?"location":"link"]:e.target.value}))} maxLength={500}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setShowGrpModal(false)}>Cancel</button>
              <button className="btn-primary" disabled={roomActionLoading} style={{flex:1,padding:13,borderRadius:14,opacity:roomActionLoading?0.6:1}} onClick={submitGroup}>{roomActionLoading?"Creating...":"Create Room 🎓"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit room modal ── */}
      {editingRoom&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setEditingRoom(null)}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>✏️ Edit Study Room</h3><p style={{fontSize:12,color:T.muted,marginTop:2}}>Update your room details</p></div>
              <button onClick={()=>setEditingRoom(null)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <div className="field"><label>Subject *</label>
              <CourseSearch T={T} value={editGrp.subject} onChange={v=>setEditGrp(p=>({...p,subject:v}))} placeholder="Search for a subject..."/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="field"><label>Date *</label><input type="date" value={editGrp.date} onChange={e=>setEditGrp(p=>({...p,date:e.target.value}))}/></div>
              <div className="field"><label>Time *</label><input type="time" value={editGrp.time} onChange={e=>setEditGrp(p=>({...p,time:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Type</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[["online","🎥","Online"],["face","📍","Campus"],["flexible","💬","Flexible"]].map(([val,icon,lbl])=>(
                  <div key={val} className={`meet-opt ${editGrp.type===val?"active":""}`} onClick={()=>setEditGrp(p=>({...p,type:val}))}>
                    <div style={{fontSize:18}}>{icon}</div><div style={{fontSize:11,fontWeight:700,marginTop:3,color:editGrp.type===val?T.accent:T.textSoft}}>{lbl}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="field"><label>Max spots</label><input type="number" min={2} max={20} value={editGrp.spots} onChange={e=>setEditGrp(p=>({...p,spots:Number(e.target.value)}))}/></div>
              <div className="field"><label>{editGrp.type==="face"?"Location":"Meeting link"}</label><input placeholder={editGrp.type==="face"?"Library Room 4":"zoom.us/j/..."} value={editGrp.type==="face"?editGrp.location:editGrp.link} onChange={e=>setEditGrp(p=>({...p,[editGrp.type==="face"?"location":"link"]:e.target.value}))} maxLength={500}/></div>
            </div>
            {editingRoom.filled > 0 && <div style={{background:"rgba(251,191,36,0.12)",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#b45309",marginBottom:4}}>⚠️ {editingRoom.filled} student{editingRoom.filled!==1?"s have":" has"} already joined this room</div>}
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setEditingRoom(null)}>Cancel</button>
              <button className="btn-primary" disabled={roomActionLoading} style={{flex:1,padding:13,borderRadius:14,opacity:roomActionLoading?0.6:1}} onClick={saveEditRoom}>{roomActionLoading?"Saving...":"Save Changes ✅"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete room confirmation ── */}
      {confirmDeleteRoom&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setConfirmDeleteRoom(null)}>
          <div className="modal" style={{maxWidth:380}}>
            <div style={{textAlign:"center",padding:"12px 0 8px"}}>
              <div style={{fontSize:40,marginBottom:12}}>🗑</div>
              <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:8}}>Delete this room?</h3>
              <p style={{fontSize:13,color:T.muted,lineHeight:1.5,marginBottom:4}}>This will permanently remove the room and all members will be removed.</p>
              {(()=>{const r=groups.find(g=>g.id===confirmDeleteRoom);return r&&r.filled>0?<p style={{fontSize:12,color:"#ef4444",fontWeight:600,marginTop:6}}>⚠️ {r.filled} student{r.filled!==1?"s are":" is"} currently in this room</p>:null})()}
            </div>
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button className="btn-ghost" style={{flex:1}} onClick={()=>setConfirmDeleteRoom(null)}>Cancel</button>
              <button disabled={roomActionLoading} style={{flex:1,padding:12,borderRadius:14,background:"#ef4444",color:"#fff",border:"none",fontSize:13,fontWeight:700,cursor:"pointer",opacity:roomActionLoading?0.6:1}} onClick={()=>deleteRoom(confirmDeleteRoom)}>{roomActionLoading?"Deleting...":"Delete Room"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── FLOATING ACTION BUTTON — Post a study request ── */}
      {["discover","connections","chat","rooms"].includes(curTab)&&(
        <>
        {canPost?(
          <button className="fab-post" onClick={openReqModal} aria-label="Post a study request"
            style={{position:"fixed",bottom:28,right:24,background:"linear-gradient(135deg,#4F7EF7,#6C8EF5)",color:"#fff",border:"none",width:56,height:56,borderRadius:18,fontSize:26,fontWeight:300,cursor:"pointer",boxShadow:"0 6px 28px rgba(74,124,247,0.4),0 2px 8px rgba(0,0,0,0.1)",zIndex:90,display:"flex",alignItems:"center",justifyContent:"center",transition:"transform 0.2s,box-shadow 0.2s",lineHeight:1}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1.08) translateY(-2px)";(e.currentTarget as HTMLElement).style.boxShadow="0 10px 36px rgba(74,124,247,0.5),0 3px 12px rgba(0,0,0,0.15)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1)";(e.currentTarget as HTMLElement).style.boxShadow="0 6px 28px rgba(74,124,247,0.4),0 2px 8px rgba(0,0,0,0.1)";}}>
            +
          </button>
        ):(
          <button className="fab-post" onClick={enablePosting} aria-label="Enable posting to help others"
            style={{position:"fixed",bottom:28,right:24,background:"linear-gradient(135deg,#2ECC8D,#00B894)",color:"#fff",border:"none",width:56,height:56,borderRadius:18,fontSize:26,fontWeight:300,cursor:"pointer",boxShadow:"0 6px 28px rgba(46,204,141,0.4),0 2px 8px rgba(0,0,0,0.1)",zIndex:90,display:"flex",alignItems:"center",justifyContent:"center",transition:"transform 0.2s,box-shadow 0.2s",lineHeight:1}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1.08) translateY(-2px)";(e.currentTarget as HTMLElement).style.boxShadow="0 10px 36px rgba(46,204,141,0.5),0 3px 12px rgba(0,0,0,0.15)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1)";(e.currentTarget as HTMLElement).style.boxShadow="0 6px 28px rgba(46,204,141,0.4),0 2px 8px rgba(0,0,0,0.1)";}}>
            +
          </button>
        )}
        <div className="fab-tooltip">{canPost?"Post a study request":"Start helping others"}</div>
        </>
      )}

      {/* ── TOP NAV ── */}
      <nav className="nav-inner" style={{padding:"13px 22px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.navBg,borderBottom:`1.5px solid ${T.border}`,position:"sticky",top:0,zIndex:100,gap:10,boxShadow:"0 1px 12px rgba(0,0,0,0.04)"}}>
        <Logo size={22} compact/>
        <div className="tab-nav top-tabs" style={{flex:1,maxWidth:540,margin:"0 10px"}}>
          {([["discover","🔍","Discover"],["connect","💬","Connect"],["rooms","🎓","Rooms"],["ai","🤖","AI"],["profile","👤","Me"],...(isAdmin?[["admin","🛡️","Admin"]]:[])]).map(([tab,icon,lbl])=>(
            <button key={tab} className={`tab-btn ${curTab===tab?"active":""}`} style={{position:"relative"}} onClick={()=>{setScreen(tab);if(tab==="connect")setActiveChat(null);if(tab==="admin"){loadAdminData();loadAdminAnalytics();}}}>
              <span className="tab-icon">{icon} </span>{lbl}
              {tab==="connect"&&totalUnread>0&&(
                <span style={{position:"absolute",top:2,right:4,background:T.red,color:"#fff",borderRadius:99,minWidth:18,height:18,padding:"0 5px",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,border:"2px solid "+T.navBg}}>
                  +{totalUnread>99?"99":totalUnread}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <div ref={notifPanelRef} style={{position:"relative"}}>
            <button onClick={()=>setShowNotifPanel(p=>!p)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,position:"relative",padding:"10px 12px",minWidth:44,minHeight:44,display:"flex",alignItems:"center",justifyContent:"center"}}>
              🔔
              {unreadCount>0&&<span style={{position:"absolute",top:0,right:0,background:T.red,color:"#fff",borderRadius:"50%",width:18,height:18,fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid "+T.navBg}}>{unreadCount>9?"9+":unreadCount}</span>}
            </button>
            {showNotifPanel&&(
              <div style={{position:"absolute",top:"100%",right:-40,width:320,maxWidth:"90vw",maxHeight:380,overflowY:"auto",background:T.surface,border:`1px solid ${T.border}`,borderRadius:16,boxShadow:"0 8px 32px rgba(0,0,0,0.12)",zIndex:200,padding:0}}>
                <div style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:700,fontSize:15,color:T.navy}}>🔔 Notifications</span>
                  {unreadCount>0&&<span style={{fontSize:11,color:T.accent,fontWeight:700}}>{unreadCount} new</span>}
                </div>
                {notifications.length===0?(
                  <div style={{padding:"36px 20px",textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:8}}>🔕</div>
                    <div style={{fontSize:13,color:T.muted}}>No notifications yet</div>
                  </div>
                ):(
                  notifications.map(n=>{
                    const fp = n.from_profile as Profile | undefined;
                    return(
                      <div key={n.id} onClick={()=>{markNotifRead(n.id);if(fp){const conn=connections.find(c=>c.id===fp.id);if(conn){setActiveChat(conn);setScreen("connect");loadMessages(conn.id);}}setShowNotifPanel(false);}}
                        style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,cursor:"pointer",background:n.read?"transparent":T.accentSoft+"40",transition:"background-color 0.2s"}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=T.bg;}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=n.read?"transparent":T.accentSoft+"40";}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                          <div style={{width:36,height:36,borderRadius:"50%",background:fp?.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:12,flexShrink:0,overflow:"hidden"}}>
                            {fp?.photo_mode==="photo"&&fp?.photo_url?<img src={fp.photo_url} alt={fp?.name?`${fp.name}'s photo`:"User photo"} width={44} height={44} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";((e.target as HTMLImageElement).parentElement||{} as HTMLElement).textContent=initials(fp?.name||"?");}}/>:initials(fp?.name||"?")}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,color:T.navy,lineHeight:1.45}}>
                              <strong>{fp?.name||"Someone"}</strong> offered to help with <strong style={{color:T.accent}}>{n.subject}</strong>
                            </div>
                            <div style={{fontSize:11,color:T.muted,marginTop:3}}>{timeAgo(n.created_at)}</div>
                          </div>
                          {!n.read&&<div style={{width:8,height:8,borderRadius:"50%",background:T.accent,flexShrink:0,marginTop:6}}/>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div style={{cursor:"pointer"}} onClick={()=>setScreen("profile")}><UserAvatar p={profile} size={32} ring={curTab==="profile"} T={T}/></div>
        </div>
      </nav>

      {/* ── BOTTOM TAB BAR (mobile only) ── */}
      <nav className="bot-nav">
        {([
          ["discover","🔍","Discover"],
          ["connect","💬","Connect"],
          ["rooms","🎓","Rooms"],
          ["ai","🤖","AI"],
          ["profile","👤","Me"],
        ] as const).map(([tab,icon,lbl])=>(
          <button key={tab} className={`bot-tab ${curTab===tab?"active":""}`} style={{position:"relative"}}
            onClick={()=>{setScreen(tab);setViewingProfile(null);if(tab==="connect")setActiveChat(null);}}>
            <span className="bi" style={{position:"relative",display:"inline-block"}}>
              {icon}
              {tab==="connect"&&totalUnread>0&&(
                <span style={{position:"absolute",top:-4,right:-8,background:T.red,color:"#fff",borderRadius:99,minWidth:18,height:18,padding:"0 5px",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,border:"2px solid "+T.navBg}}>
                  +{totalUnread>99?"99":totalUnread}
                </span>
              )}
            </span>
            {lbl}
          </button>
        ))}
      </nav>

      {/* ══════════════ DISCOVER ══════════════ */}
      {curTab==="discover"&&(
        <div className="dis-page" style={{flex:1,paddingTop:16,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
          <div className="dis-header" style={{maxWidth:560,margin:"0 auto",padding:"20px 18px 14px",flexShrink:0}}>
            <h2 style={{fontSize:22,fontWeight:800,color:T.navy,marginBottom:4,letterSpacing:"-0.02em"}}>Study Feed</h2>
            <p style={{fontSize:14,color:T.muted,marginBottom:12}}>Students looking for study partners — connect or post your own</p>
            {canPost&&<button onClick={openReqModal} style={{marginBottom:14,padding:"10px 20px",borderRadius:99,background:T.accentSoft,border:`1.5px solid ${T.accent}33`,color:T.accent,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s",display:"inline-flex",alignItems:"center",gap:6}} onMouseEnter={e=>{(e.currentTarget).style.background=T.accent;(e.currentTarget).style.color="#fff";}} onMouseLeave={e=>{(e.currentTarget).style.background=T.accentSoft;(e.currentTarget).style.color=T.accent;}}>Need help with a course? Post a request →</button>}
            <div className="dis-filter-row" style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <select className="dis-filter-sel" value={uniFilter} style={{flex:"1 1 160px",minWidth:160,padding:"9px 12px",border:`1.5px solid ${uniFilter?T.accent:T.border}`,borderRadius:12,fontSize:16,fontWeight:600,color:T.text,background:T.surface,cursor:"pointer",outline:"none"}}
                onChange={e=>{setUniFilter(e.target.value);setMajorFilter("");setSubjectFilter("");setCourseSearch("");setCourseDropOpen(false);}}>
                <option value="">🏫 All unis</option>
                {getUniversities().map(u=><option key={u} value={u}>{u}</option>)}
              </select>
              <div ref={majorFilterRef} style={{position:"relative",flex:"1 1 160px",minWidth:160}}>
                <div
                  style={{display:"flex",alignItems:"center",gap:5,padding:"9px 12px",border:`1.5px solid ${majorFilter?T.accent:T.border}`,borderRadius:12,fontSize:16,background:T.surface,cursor:"text"}}
                  onClick={()=>setMajorFilterOpen(true)}
                >
                  <span style={{fontSize:15,flexShrink:0}}>🎓</span>
                  <input
                    type="text"
                    placeholder={majorFilter||"All majors"}
                    value={majorFilterOpen ? majorFilterSearch : (majorFilter || "")}
                    onChange={e=>{setMajorFilterSearch(e.target.value);setMajorFilterOpen(true);}}
                    onFocus={()=>{setMajorFilterOpen(true);if(majorFilter&&!majorFilterSearch)setMajorFilterSearch("");}}
                    style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:16,fontWeight:majorFilter&&!majorFilterOpen?600:400,color:T.text,minWidth:0,width:"100%"}}
                  />
                  {majorFilter&&(
                    <button
                      onMouseDown={e=>{e.preventDefault();e.stopPropagation();setMajorFilter("");setMajorFilterSearch("");setMajorFilterOpen(false);setSubjectFilter("");setCourseSearch("");setCourseDropOpen(false);}}
                      style={{background:"none",border:"none",cursor:"pointer",color:T.muted,fontSize:17,padding:0,lineHeight:1,flexShrink:0}}
                    >×</button>
                  )}
                </div>
                {majorFilterOpen&&(()=>{
                  const allMajors = getMajorsForUni(uniFilter);
                  const q = majorFilterSearch.toLowerCase();
                  const filtered = q ? allMajors.filter(m=>m.toLowerCase().includes(q)) : allMajors;
                  return (
                    <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:300,background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.13)",maxHeight:280,overflowY:"auto"}}>
                      <div
                        onMouseDown={e=>{e.preventDefault();setMajorFilter("");setMajorFilterSearch("");setMajorFilterOpen(false);setSubjectFilter("");setCourseSearch("");setCourseDropOpen(false);}}
                        style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:T.muted,fontWeight:500,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,background:T.surface,zIndex:1}}
                      >🎓 All majors</div>
                      {filtered.length===0?(
                        <div style={{padding:"20px 14px",textAlign:"center",fontSize:13,color:T.muted}}>No majors match "{majorFilterSearch}"</div>
                      ):(
                        filtered.map(m=>(
                          <div
                            key={m}
                            onMouseDown={e=>{e.preventDefault();setMajorFilter(m);setMajorFilterSearch("");setMajorFilterOpen(false);setSubjectFilter("");setCourseSearch("");setCourseDropOpen(false);}}
                            style={{padding:"9px 14px",cursor:"pointer",fontSize:13,color:m===majorFilter?T.accent:T.text,fontWeight:m===majorFilter?700:400,background:m===majorFilter?T.accentSoft:"transparent"}}
                            onMouseEnter={e=>{if(m!==majorFilter)(e.currentTarget as HTMLDivElement).style.background=T.border;}}
                            onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=m===majorFilter?T.accentSoft:"transparent";}}
                          >{m}</div>
                        ))
                      )}
                    </div>
                  );
                })()}
              </div>
              <div ref={courseDropRef} className="dis-course-box" style={{position:"relative",flex:"2 1 220px",minWidth:220}}>
                <div
                  style={{display:"flex",alignItems:"center",gap:5,padding:"9px 12px",border:`1.5px solid ${subjectFilter?T.accent:T.border}`,borderRadius:12,fontSize:16,background:T.surface,cursor:"text"}}
                  onClick={()=>setCourseDropOpen(true)}
                >
                  <span style={{fontSize:15,flexShrink:0}}>📚</span>
                  <input
                    type="text"
                    placeholder={subjectFilter||(majorFilter?"Filter courses…":"Search all courses…")}
                    value={courseDropOpen ? courseSearch : (subjectFilter ? subjectFilter : courseSearch)}
                    onChange={e=>{setCourseSearch(e.target.value);setSubjectFilter("");setCourseDropOpen(true);}}
                    onFocus={()=>{setCourseDropOpen(true);if(subjectFilter&&!courseSearch)setCourseSearch("");}}
                    style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:16,fontWeight:subjectFilter&&!courseDropOpen?600:400,color:subjectFilter&&!courseDropOpen?T.text:T.text,minWidth:0,width:"100%"}}
                  />
                  {(courseSearch||subjectFilter)&&(
                    <button
                      onMouseDown={e=>{e.preventDefault();e.stopPropagation();setCourseSearch("");setSubjectFilter("");setCourseDropOpen(false);}}
                      style={{background:"none",border:"none",cursor:"pointer",color:T.muted,fontSize:17,padding:0,lineHeight:1,flexShrink:0}}
                    >×</button>
                  )}
                </div>
                {courseDropOpen&&(
                  <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:300,background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.13)",maxHeight:280,overflowY:"auto"}}>
                    <div
                      onMouseDown={e=>{e.preventDefault();setSubjectFilter("");setCourseSearch("");setCourseDropOpen(false);}}
                      style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:T.muted,fontWeight:500,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,background:T.surface,zIndex:1}}
                    >
                      📚 {majorFilter?"All courses":"All subjects"}
                    </div>
                    {filteredCourseOptions.length===0?(
                      <div style={{padding:"20px 14px",textAlign:"center",fontSize:13,color:T.muted}}>No courses match "{courseSearch}"</div>
                    ):(
                      filteredCourseOptions.map(({course,group})=>(
                        <div
                          key={`${group}::${course}`}
                          onMouseDown={e=>{e.preventDefault();setSubjectFilter(course);setCourseSearch("");setCourseDropOpen(false);}}
                          style={{padding:"9px 14px",cursor:"pointer",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,color:course===subjectFilter?T.accent:T.text,fontWeight:course===subjectFilter?700:400,background:course===subjectFilter?T.accentSoft:"transparent"}}
                          onMouseEnter={e=>{if(course!==subjectFilter)(e.currentTarget as HTMLDivElement).style.background=T.border;}}
                          onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=course===subjectFilter?T.accentSoft:"transparent";}}
                        >
                          <span>{course}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <select className="dis-filter-sel dis-filter-meet" value={typeFilter} style={{flex:"1 1 140px",minWidth:140,padding:"9px 12px",border:`1.5px solid ${typeFilter?T.accent:T.border}`,borderRadius:12,fontSize:16,fontWeight:600,color:T.text,background:T.surface,cursor:"pointer",outline:"none"}} onChange={e=>setTypeFilter(e.target.value)}>
                <option value="">💬 Any type</option>
                <option value="online">🎥 Online</option>
                <option value="face">📍 On Campus</option>
                <option value="flexible">💬 Flexible</option>
              </select>
              {(subjectFilter || uniFilter || majorFilter || typeFilter || courseSearch) && (
                <button className="dis-clear-btn" onClick={()=>{setSubjectFilter("");setUniFilter("");setMajorFilter("");setTypeFilter("");setCourseSearch("");setCourseDropOpen(false);}} style={{padding:"12px 16px",borderRadius:14,border:`1.5px solid ${T.red}`,background:T.redSoft,color:T.red,fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Clear ×</button>
              )}
            </div>
          </div>
          <div style={{height:6}}/>
          {allStudents.length === 0 ? (
            <div style={{textAlign:"center",padding:"60px 24px"}} className="fade-in">
              <div style={{width:72,height:72,borderRadius:18,background:"linear-gradient(135deg,#4F7EF7,#6C8EF5)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",boxShadow:"0 6px 24px rgba(74,124,247,0.25)"}}>
                <span style={{fontSize:32,color:"#fff",fontWeight:300,lineHeight:1}}>+</span>
              </div>
              <div style={{fontWeight:700,fontSize:18,color:T.navy,marginBottom:6}}>No posts yet</div>
              <div style={{fontSize:13,color:T.muted,marginBottom:20,maxWidth:280,margin:"0 auto 20px",lineHeight:1.5}}>Be the first to post a study request and find partners in your course!</div>
              {canPost?(
                <button className="btn-primary" onClick={openReqModal} style={{background:"linear-gradient(135deg,#4F7EF7,#6C8EF5)",boxShadow:"0 4px 20px rgba(74,124,247,0.3)",padding:"14px 32px",fontSize:15}}>
                  + Post a Study Request
                </button>
              ):(
                <button className="btn-primary" onClick={enablePosting} style={{padding:"14px 32px",fontSize:15}}>
                  Get Started
                </button>
              )}
            </div>
          ) : noFilterResults ? (
            <div style={{textAlign:"center",padding:"60px 24px"}} className="fade-in">
              <div style={{fontSize:44,marginBottom:12}}>🔍</div>
              <div style={{fontWeight:700,fontSize:17,color:T.navy,marginBottom:8}}>No posts match these filters</div>
              <button className="btn-ghost" onClick={()=>{setSubjectFilter("");setUniFilter("");setMajorFilter("");setTypeFilter("");}}>Clear filters</button>
            </div>
          ) : allDismissed && visibleDeck.length === 0 ? (
            <div style={{textAlign:"center",padding:"80px 24px"}} className="fade-in">
              <div style={{fontSize:52,marginBottom:14}}>🎉</div>
              <div style={{fontWeight:700,fontSize:18,color:T.navy,marginBottom:8}}>You've reviewed all posts!</div>
              <div style={{fontSize:14,color:T.muted,marginBottom:24}}>Check your connections and start chatting</div>
              <button className="btn-primary" onClick={()=>setScreen("connect")}>View My Connections →</button>
            </div>
          ) : (
            <>
            <div className="scroll-col" ref={scrollRef}
              onMouseDown={e=>{dragStart.current=e.pageY;dragScroll.current=scrollRef.current!.scrollTop;dragMoved.current=false;(scrollRef.current as HTMLDivElement).style.cursor="grabbing";}}
              onMouseMove={e=>{if(!dragStart.current)return;const dist=Math.abs(e.pageY-dragStart.current);if(dist>5)dragMoved.current=true;scrollRef.current!.scrollTop=dragScroll.current-(e.pageY-dragStart.current);}}
              onMouseUp={()=>{dragStart.current=0;if(scrollRef.current)scrollRef.current.style.cursor="grab";}}
              onMouseLeave={()=>{dragStart.current=0;dragMoved.current=false;if(scrollRef.current)scrollRef.current.style.cursor="grab";}}>
              {visibleDeck.map((s: Profile & {_postId?: string; _postSubject?: string; _postDetail?: string; _postMeetType?: string; _postCreatedAt?: string; _isOwn?: boolean})=>{
                const cardKey = s._postId || s.id;
                const flying=flyCard?.id===cardKey;
                const postSubject = s._postSubject || "";
                const postDetail = s._postDetail || "";
                const postMeetType = s._postMeetType || s.meet_type;
                const postTime = s._postCreatedAt ? timeAgo(s._postCreatedAt) : "";
                const isOwn = s._isOwn;
                const isConnected = connectionIds.has(s.id);
                return(
                  <div key={cardKey} className={`s-card ${flying?(flyCard?.dir==="up"?"fly-up":"fly-down"):""}`} style={isOwn?{border:`2px solid ${T.accent}40`}:undefined}>
                    <div className="dis-card-hdr" style={{background:isOwn?`linear-gradient(135deg,${T.accent}15,${T.accent}25)`:`linear-gradient(135deg,${s.avatar_color||"#6C8EF5"}20,${s.avatar_color||"#6C8EF5"}40)`,padding:"20px 24px 16px",borderBottom:`1px solid ${T.border}`,cursor:isOwn?undefined:"pointer"}} onClick={()=>{if(dragMoved.current||isOwn)return;openStudentProfile(s.id, s as Profile);}}>
                      <div style={{display:"flex",alignItems:"center",gap:14}}>
                        <div className="dis-avatar" style={{flexShrink:0}}><Avatar s={s} size={58} T={T}/></div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div className="dis-name" style={{fontWeight:700,fontSize:16,color:T.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                            {isOwn&&<span style={{background:T.accent,color:"#fff",padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>Your Post</span>}
                            {!isOwn&&isConnected&&<span style={{background:T.greenSoft,color:T.green,padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>Connected</span>}
                            {!isOwn&&s.online&&<span style={{width:7,height:7,borderRadius:"50%",background:T.green,display:"inline-block",boxShadow:`0 0 0 2px ${T.greenSoft}`,flexShrink:0}}/>}
                          </div>
                          <div className="dis-uni" style={{fontSize:12,color:T.muted,marginTop:2,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.uni} · {s.major} · {s.year}</div>
                        </div>
                        {postTime&&<div style={{fontSize:11,color:T.muted,flexShrink:0,whiteSpace:"nowrap"}}>{postTime}</div>}
                      </div>
                    </div>
                    <div className="dis-card-body" style={{padding:"16px 24px",cursor:isOwn?undefined:"pointer"}} onClick={()=>{if(dragMoved.current||isOwn)return;openStudentProfile(s.id, s as Profile);}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                        <span className="dis-chip" style={{background:T.accentSoft,color:T.accent,padding:"6px 14px",borderRadius:99,fontSize:13,fontWeight:700}}>📚 {postSubject}</span>
                        <span className="dis-meet-pill" style={{display:"inline-flex",alignItems:"center",gap:4,background:T.surface,padding:"4px 12px",borderRadius:99,fontSize:12,fontWeight:600,color:T.textSoft,border:`1px solid ${T.border}`}}>
                          {getMeetIcon(postMeetType)} {getMeetLabel(postMeetType)}
                        </span>
                        {!isOwn&&s.rating>0&&<Stars rating={s.rating} size={12}/>}
                      </div>
                      <p className="dis-bio" style={{fontSize:14,color:T.text,lineHeight:1.7,marginBottom:12}}>{postDetail}</p>
                      {!isOwn&&s.badges?.length>0&&(
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                          {s.badges.slice(0,4).map((bid:string)=>{
                            const b=BADGES_DEF.find(x=>x.id===bid);
                            return b?<span key={bid} title={b.name} style={{background:T.goldSoft,border:`1px solid ${T.gold}33`,borderRadius:9,padding:"3px 8px",fontSize:13}}>{b.icon}</span>:null;
                          })}
                        </div>
                      )}
                    </div>
                    <div className="dis-card-btns" style={{padding:"0 20px 18px",display:"flex",gap:12}} onClick={e=>e.stopPropagation()}>
                      {isOwn?(
                        <button className="btn-danger" style={{flex:1,padding:"13px 0",fontSize:15,borderRadius:16}} onClick={async()=>{
                          if(!confirm("Delete this post?"))return;
                          if(!user)return;
                          // Delete related notifications first (ignore errors — notifications are secondary)
                          try{await supabase.from("notifications").delete().eq("post_id",s._postId);}catch{}
                          const {error,count}=await supabase.from("help_requests").delete({count:"exact"}).eq("id",s._postId).eq("user_id",user.id);
                          if(error){showNotif("Delete failed: "+error.message,"err");return;}
                          if(count===0){showNotif("Could not delete — try signing out and back in","err");return;}
                          setAllStudents(prev=>prev.filter((x:any)=>x._postId!==s._postId));
                          setHelpRequests(prev=>prev.filter((x:any)=>x.id!==s._postId));
                          showNotif("Post deleted");
                        }}>🗑 Delete Post</button>
                      ):isConnected?(
                        <>
                          <button className="btn-accent" style={{flex:1,padding:"13px 0",fontSize:15,borderRadius:16}} onClick={async()=>{
                            const conn=connections.find(c=>c.id===s.id);
                            if(conn){
                              if(user) await sendNotification(s.id, user.id, "offer_help", postSubject, s._postId || null);
                              setActiveChat(conn);setScreen("connect");loadMessages(conn.id);
                              showNotif("Offer sent! They'll be notified");
                            }
                          }}>💬 Offer Help →</button>
                        </>
                      ):(
                        <>
                          <button className="btn-danger" style={{flex:1,padding:"13px 0",fontSize:15,borderRadius:16}} onClick={(e)=>{e.stopPropagation();if(dragMoved.current)return;handleReject(s);}}>✕ Pass</button>
                          <button className="btn-success" style={{flex:2,padding:"13px 0",fontSize:15,borderRadius:16,background:T.navy,color:T.bg,border:"none",fontWeight:700}} onClick={(e)=>{e.stopPropagation();if(dragMoved.current)return;handleConnect(s);}}>✓ Study Together →</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{flex:"0 0 20px"}}/>
            </div>
            </>
          )}
        </div>
      )}


      {/* ══════════════ CONNECT (merged connections + chat) ══════════════ */}
      {curTab==="connect"&&(() => {
        // Connect tab shows EVERY connection. People with active chats sort to the
        // top, brand-new matches (no messages exchanged yet) show at the bottom
        // with a "New — say hi" hint so the user can start the conversation.
        const chatPartners = connections;
        // Sort order: unread first, then by oldest-unanswered received message
        // (so someone waiting on a reply bubbles up), then alphabetical for new
        // matches with no messages yet.
        const sortedChatPartners = [...chatPartners].sort((a, b) => {
          const ua = unreadCounts[a.id] || 0;
          const ub = unreadCounts[b.id] || 0;
          if (ua !== ub) return ub - ua; // higher unread first
          const ta = lastReceivedAt[a.id] || "";
          const tb = lastReceivedAt[b.id] || "";
          // Those with a received message come before those without
          if (!ta && tb) return 1;
          if (ta && !tb) return -1;
          if (!ta && !tb) return (a.name || "").localeCompare(b.name || "");
          // ASCENDING: older timestamp (waited longer) first, newest at end
          return ta.localeCompare(tb);
        });
        const hasChats = sortedChatPartners.length > 0;
        // Track which partners are brand-new (no message history with them).
        const isNewMatch = (id: string) =>
          !partnersWithMessages.has(id) && (unreadCounts[id] || 0) === 0;
        return (
        <div className="chat-wrap" style={{maxWidth:1200,margin:"0 auto",width:"100%",flex:1,display:"flex",height:"calc(100dvh - 62px)"}}>
          {/* Left sidebar — contact list (only partners with messages) */}
          <div className={`chat-sidebar${!hasChats?" chat-sidebar-empty":""}`} style={{width:260,borderRight:`1px solid ${T.border}`,background:T.navBg,overflowY:"auto",flexShrink:0,display:"flex",flexDirection:"column"}}>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${T.border}`}}>
              <div style={{fontSize:14,fontWeight:700,color:T.navy}}>Messages</div>
              <div style={{fontSize:10,color:T.muted,marginTop:1}}>{sortedChatPartners.length} match{sortedChatPartners.length!==1?"es":""}{totalUnread>0?` · +${totalUnread} new`:""}</div>
            </div>
            {!hasChats?(
              <div style={{padding:"24px 14px",textAlign:"center"}}>
                <div style={{fontSize:26,marginBottom:6}}>💬</div>
                <div style={{fontSize:12,color:T.muted,lineHeight:1.5,marginBottom:12}}>No conversations yet.{connections.length>0?" Send your first message from Discover.":""}</div>
                <button className="btn-primary" style={{padding:"7px 14px",fontSize:11}} onClick={()=>setScreen("discover")}>Find Partners →</button>
              </div>
            ):(
              <div style={{flex:1,overflowY:"auto",padding:"8px 8px"}}>
                {sortedChatPartners.map(s=>{
                  const unread = unreadCounts[s.id] || 0;
                  const isNew = isNewMatch(s.id);
                  return (
                  <div key={s.id} className={`conn-row conn-row-mini ${activeChat?.id===s.id?"active":""}`}
                    style={{padding:"10px 12px",borderRadius:12,marginBottom:4,cursor:"pointer",display:"flex",alignItems:"center",gap:10,position:"relative"}}
                    onClick={()=>{setActiveChat(s);loadMessages(s.id);trackEvent("chat_open",{partner_id:s.id});}}>
                    <Avatar s={s} size={38} T={T}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:unread>0?800:600,color:T.navy,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
                      <div style={{fontSize:11,color:isNew?T.accent:(s.online?T.green:T.muted),marginTop:1,fontWeight:isNew?700:400}}>{isNew?"✨ New match · Say hi":`${s.online?"● Online":"● Offline"}${parseCourses(s.course ?? "").length > 0 ? ` · ${parseCourses(s.course ?? "")[0]}` : ""}`}</div>
                    </div>
                    {unread>0&&(
                      <span style={{background:T.red,color:"#fff",borderRadius:99,minWidth:26,height:22,padding:"0 8px",fontSize:11,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,boxShadow:`0 2px 8px ${T.red}55`}}>
                        +{unread>99?"99":unread}
                      </span>
                    )}
                    {ratings[s.id]&&unread===0&&!isNew&&<div style={{fontSize:11,color:"#F5A623"}}>{ratings[s.id]}★</div>}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Right panel — chat or conversation cards */}
          <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,minWidth:0,minHeight:0}}>
            {!activeChat?(
              !hasChats?(
                <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,color:T.muted,padding:16}}>
                  <div style={{fontSize:32}}>💬</div>
                  <div style={{fontSize:15,fontWeight:600,color:T.navy}}>No conversations yet</div>
                  <div style={{fontSize:12,color:T.muted,textAlign:"center",maxWidth:300}}>{connections.length>0?`You have ${connections.length} match${connections.length===1?"":"es"}. Start a chat with them from Discover.`:"Match with students from Discover to start chatting."}</div>
                  <button className="btn-primary" style={{marginTop:6,padding:"9px 18px",fontSize:13}} onClick={()=>setScreen("discover")}>Go to Discover →</button>
                </div>
              ):(
                <div style={{flex:1,overflowY:"auto",padding:20}}>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:4}}>{totalUnread>0?`Select a conversation (+${totalUnread} unread):`:`Your matches (${sortedChatPartners.length}):`}</div>
                  </div>
                  <div className="chat-partner-cards" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
                    {sortedChatPartners.map(s=>{
                      const unread = unreadCounts[s.id] || 0;
                      const isNew = isNewMatch(s.id);
                      return (
                      <div key={s.id} className="card fade-in" style={{padding:16,cursor:"pointer",position:"relative",border:unread>0?`2px solid ${T.red}`:(isNew?`1.5px solid ${T.accent}55`:undefined),boxShadow:unread>0?`0 4px 20px ${T.red}33`:undefined}} onClick={()=>{setActiveChat(s);loadMessages(s.id);trackEvent("chat_open",{partner_id:s.id});}}>
                        {/* Prominent unread pill in the top-right corner */}
                        {unread>0&&(
                          <div style={{position:"absolute",top:-10,right:-6,background:T.red,color:"#fff",borderRadius:99,padding:"4px 12px",fontSize:12,fontWeight:800,display:"flex",alignItems:"center",gap:4,boxShadow:`0 4px 14px ${T.red}55`,border:"2px solid "+T.surface,letterSpacing:"0.02em",zIndex:2}}>
                            <span style={{fontSize:14,lineHeight:1}}>💬</span>
                            +{unread>99?"99":unread} new
                          </div>
                        )}
                        {isNew&&unread===0&&(
                          <div style={{position:"absolute",top:-8,right:-4,background:T.accent,color:"#fff",borderRadius:99,padding:"3px 10px",fontSize:10,fontWeight:700,boxShadow:`0 3px 10px ${T.accent}55`,border:"2px solid "+T.surface,letterSpacing:"0.02em",zIndex:2}}>
                            ✨ New
                          </div>
                        )}
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                          <Avatar s={s} size={42} T={T}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:unread>0?800:700,fontSize:13,color:T.navy,cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} onClick={e=>{e.stopPropagation();openStudentProfile(s.id, s as Profile);}}>
                              {s.name}
                            </div>
                            <div style={{fontSize:11,color:T.muted}}>{s.uni}</div>
                          </div>
                        </div>
                        {isNew&&(
                          <div style={{fontSize:11,color:T.accent,fontWeight:600,marginBottom:8,padding:"6px 10px",background:T.accentSoft,borderRadius:8,textAlign:"center"}}>
                            👋 Tap to say hi
                          </div>
                        )}
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <span style={{background:T.accentSoft,color:T.accent,padding:"3px 10px",borderRadius:99,fontSize:10,fontWeight:600}}>{getMeetIcon(s.meet_type)} {getMeetLabel(s.meet_type)}</span>
                          <button style={{background:"none",border:"none",color:T.accent,fontSize:11,fontWeight:600,cursor:"pointer"}} onClick={e=>{e.stopPropagation();setRateModal(s);setHoverStar(0);}}>Rate ⭐</button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )
            ):(
              <>
                <div className="chat-header-bar" style={{background:T.navBg,padding:"12px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                  <button onClick={()=>setActiveChat(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted,padding:"2px 6px",display:"flex",alignItems:"center",flexShrink:0}}>←</button>
                  <Avatar s={activeChat} size={38} T={T}/>
                  <div style={{flex:1,cursor:"pointer",minWidth:0}} onClick={()=>openStudentProfile(activeChat.id, activeChat)}>
                    <div className="chat-header-name" style={{fontWeight:700,fontSize:15,color:T.navy,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeChat.name}</div>
                    <div className="chat-header-status" style={{fontSize:12,color:activeChat.online?T.green:T.muted,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeChat.online?"● Online now":"● Offline"}{parseCourses(activeChat.course ?? "").length > 0 ? ` · ${parseCourses(activeChat.course ?? "")[0]}` : ""}</div>
                  </div>
                  <div className="chat-header-actions" style={{display:"flex",gap:6,flexShrink:0}}>
                    <button className="btn-accent" style={{padding:"7px 14px",fontSize:12,borderRadius:99}} onClick={()=>setSchedModal(activeChat)}>📅 Schedule</button>
                    <button style={{background:T.goldSoft,color:T.gold,border:"none",padding:"7px 14px",borderRadius:99,fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={()=>{setRateModal(activeChat);setHoverStar(0);}}>⭐ Rate</button>
                  </div>
                </div>
                <div className="chat-scroll" style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:8,minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain"}}>
                  {(messages[activeChat.id]||[]).length===0&&(
                    <div style={{textAlign:"center",padding:"40px 20px",color:T.muted}}>
                      <div style={{fontSize:28,marginBottom:8}}>👋</div>
                      <div style={{fontSize:14}}>Say hello to {activeChat.name.split(" ")[0]}!</div>
                    </div>
                  )}
                  {(messages[activeChat.id]||[]).map(m=>{
                    // XSS HARDENING: reject any file_url that isn't an https:// URL
                    // from a host we trust. `javascript:` / `data:text/html` URLs
                    // cannot end up in src= / href= / window.open() even if an
                    // attacker crafts a message row directly via PostgREST.
                    const safeFileUrl = (() => {
                      if (!m.file_url || typeof m.file_url !== "string") return null;
                      try {
                        const u = new URL(m.file_url);
                        if (u.protocol !== "https:") return null;
                        // Allow our Supabase storage host + common CDNs we control
                        if (!/\.supabase\.co$|supabase\.in$|basudrus\.com$/.test(u.hostname)) return null;
                        return u.toString();
                      } catch { return null; }
                    })();
                    const mt = (m.message_type||"text");
                    return (
                    <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:m.sender_id===user?.id?"flex-end":"flex-start",maxWidth:"100%"}}>
                      <div className={m.sender_id===user?.id?"msg-mine msg-bubble":"msg-theirs msg-bubble"} style={{maxWidth:"82%",padding:mt==="image"?"4px":"11px 15px",borderRadius:18,fontSize:15,lineHeight:1.5,overflow:"hidden",wordWrap:"break-word",overflowWrap:"break-word"}}>
                        {mt==="voice"&&safeFileUrl?(
                          <div style={{display:"flex",alignItems:"center",gap:8,padding:0}}>
                            <span style={{fontSize:18}}>🎤</span>
                            <audio controls preload="metadata" style={{height:36,maxWidth:"100%",width:220}} src={safeFileUrl}/>
                          </div>
                        ):mt==="image"&&safeFileUrl?(
                          <img src={safeFileUrl} alt={m.file_name||"Image"} loading="lazy" style={{maxWidth:"100%",maxHeight:280,borderRadius:12,display:"block",cursor:"pointer"}} onClick={()=>window.open(safeFileUrl,"_blank","noopener,noreferrer")}/>
                        ):mt==="file"&&safeFileUrl?(
                          <a href={safeFileUrl} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:10,color:"inherit",textDecoration:"none"}}>
                            <span style={{fontSize:24}}>📄</span>
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{fontWeight:600,fontSize:14,wordBreak:"break-word"}}>{m.file_name||"File"}</div>
                              <div style={{fontSize:12,opacity:0.7,marginTop:2}}>Tap to open</div>
                            </div>
                          </a>
                        ):(mt==="voice"||mt==="image"||mt==="file")&&!safeFileUrl?(
                          // Media message with missing/invalid URL — show a safe placeholder
                          <span style={{opacity:0.6,fontSize:13}}>[unavailable attachment]</span>
                        ):(
                          <>{m.text}</>
                        )}
                      </div>
                      <div style={{fontSize:11,color:T.muted,marginTop:4}}>{new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                    </div>
                    );
                  })}
                  <div ref={chatEndRef}/>
                </div>
                <input ref={chatFileRef} type="file" accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt" style={{display:"none"}} onChange={handleChatFileSelect}/>
                <div className="chat-msg-input" style={{padding:"12px 16px",background:T.navBg,borderTop:`1px solid ${T.border}`,display:"flex",gap:6,alignItems:"center"}}>
                  {isRecording?(
                    <div style={{flex:1,display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:T.redSoft,borderRadius:99,border:`1.5px solid ${T.red}33`}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:T.red,animation:"orbPulse 1s infinite"}}/>
                      <span style={{fontSize:14,fontWeight:600,color:T.red,flex:1}}>Recording... {formatTime(recordingTime)}</span>
                      <button onClick={stopRecording} style={{padding:"8px 18px",borderRadius:99,background:T.red,color:"#fff",border:"none",fontSize:13,fontWeight:700,cursor:"pointer"}}>Send 🎤</button>
                    </div>
                  ):(
                    <>
                      <button onClick={()=>chatFileRef.current?.click()} title="Attach file"
                        style={{width:42,height:42,borderRadius:"50%",border:`1.5px solid ${T.border}`,background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",flexShrink:0,color:T.textSoft,transition:"all 0.15s"}}
                        onMouseEnter={e=>{(e.currentTarget).style.background=T.accentSoft;(e.currentTarget).style.borderColor=T.accent;}}
                        onMouseLeave={e=>{(e.currentTarget).style.background="transparent";(e.currentTarget).style.borderColor=T.border;}}>
                        📎
                      </button>
                      <input style={{flex:1,padding:"12px 17px",border:`1.5px solid ${T.border}`,borderRadius:99,fontSize:16,outline:"none",color:T.text,background:T.bg,transition:"border-color 0.2s,box-shadow 0.2s"}}
                        placeholder={`Message ${activeChat.name.split(" ")[0]}...`} value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMessage(activeChat.id)} maxLength={2000}
                        onFocus={e=>{(e.target as HTMLInputElement).style.borderColor=T.accent;(e.target as HTMLInputElement).style.boxShadow=`0 0 0 3px ${T.accentSoft}`;}}
                        onBlur={e=>{(e.target as HTMLInputElement).style.borderColor=T.border;(e.target as HTMLInputElement).style.boxShadow="none";}}/>
                      {newMsg.trim()?(
                        <button className="btn-primary" style={{padding:"12px 20px",borderRadius:99,flexShrink:0}} onClick={()=>sendMessage(activeChat.id)}>Send →</button>
                      ):(
                        <button onClick={startRecording} title="Record voice message"
                          style={{width:42,height:42,borderRadius:"50%",border:"none",background:"linear-gradient(135deg,#ef4444,#f97316)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",flexShrink:0,boxShadow:"0 2px 10px rgba(239,68,68,0.3)",transition:"all 0.15s"}}
                          onMouseEnter={e=>{(e.currentTarget).style.transform="scale(1.08)";}}
                          onMouseLeave={e=>{(e.currentTarget).style.transform="scale(1)";}}>
                          🎤
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* ══════════════ GROUP ROOMS ══════════════ */}
      {curTab==="rooms"&&(
        <RoomsScreen T={T} user={user} groups={groups} setShowGrpModal={setShowGrpModal}
          openEditRoom={openEditRoom} setConfirmDeleteRoom={setConfirmDeleteRoom}
          toggleJoinGroup={toggleJoinGroup} openStudentProfile={openStudentProfile} initials={initials}
          openRoomMembers={openRoomMembers} />
      )}

      {/* ══════════════ ROOM MEMBERS MODAL (host clicks "Members" on their room) ══════════════ */}
      {viewingMembersRoom&&(
        <div className="modal-bg" onClick={closeRoomMembers}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:480}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:18,fontWeight:800,color:T.navy}}>👥 Members</div>
                <div style={{fontSize:12,color:T.muted,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{viewingMembersRoom.subject} · {viewingMembersRoom.date} at {viewingMembersRoom.time}</div>
              </div>
              <button onClick={closeRoomMembers} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted,padding:"0 4px",lineHeight:1}}>✕</button>
            </div>
            <div style={{fontSize:11,color:T.muted,margin:"10px 0 14px"}}>{loadingMembers?"Loading...":`${roomMembers.length} ${roomMembers.length===1?"person has":"people have"} joined`}</div>
            {loadingMembers?(
              <div style={{textAlign:"center",padding:"30px 10px",color:T.muted,fontSize:13}}>Loading members...</div>
            ):roomMembers.length===0?(
              <div style={{textAlign:"center",padding:"30px 10px"}}>
                <div style={{fontSize:36,marginBottom:8}}>🪑</div>
                <div style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:4}}>No one has joined yet</div>
                <div style={{fontSize:12,color:T.muted}}>Members will show up here as they join your room.</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"55vh",overflowY:"auto"}}>
                {roomMembers.map(m=>{
                  const alreadyConnected = connections.some(c => c.id === m.id);
                  return (
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:14,border:`1px solid ${T.border}`,background:T.surface}}>
                    <div onClick={()=>{closeRoomMembers();openStudentProfile(m.id, m);}} style={{cursor:"pointer",flexShrink:0}}>
                      <Avatar s={m} size={42} T={T}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div onClick={()=>{closeRoomMembers();openStudentProfile(m.id, m);}} style={{fontSize:14,fontWeight:700,color:T.navy,cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.name||"Student"}</div>
                      <div style={{fontSize:11,color:T.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.uni||""}{m.major?` · ${m.major}`:""}</div>
                    </div>
                    <button
                      className="btn-primary"
                      style={{padding:"8px 14px",fontSize:12,borderRadius:99,flexShrink:0}}
                      onClick={()=>{
                        if(alreadyConnected){
                          const c = connections.find(x=>x.id===m.id);
                          if(c){ setActiveChat(c); setScreen("connect"); loadMessages(c.id); }
                        } else {
                          handleConnect(m as any);
                        }
                        closeRoomMembers();
                      }}>
                      {alreadyConnected?"💬 Message":"💬 Connect"}
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
            <div style={{marginTop:14,fontSize:11,color:T.muted,textAlign:"center",lineHeight:1.5,padding:"10px 8px",background:T.bg,borderRadius:10}}>
              💡 Tap "Connect" to add them and start a chat — or "Message" if you're already matched.
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ AI HUB — Smart Study Companion ══════════════ */}
      {curTab==="ai"&&(
        !aiTab ? (
        /* ── SELECTION VIEW — dark header + 4 cards + quick start + footer ── */
        <div className="page-scroll" style={{background:T.bg}}>
          <div style={{background:"linear-gradient(180deg,#0f172a 0%,#1e1b4b 100%)",paddingBottom:24}}>
          <div style={{padding:"28px 20px 0",maxWidth:720,margin:"0 auto"}}>
            <div style={{textAlign:"center",paddingBottom:20}}>
              <div className="fade-in" style={{marginBottom:20}}>
                <div style={{
                  width:80,height:80,borderRadius:"50%",margin:"0 auto 16px",
                  background:"radial-gradient(circle at 35% 30%,#fb923c 0%,#f97316 12%,#f43f5e 28%,#c026d3 48%,#8b5cf6 68%,#6366f1 88%,#4f46e5 100%)",
                  boxShadow:"0 0 60px rgba(251,146,60,0.3),0 0 120px rgba(139,92,246,0.15),0 8px 32px rgba(0,0,0,0.3)",
                  animation:"orbPulse 4s ease-in-out infinite",
                }}/>
                <h2 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-0.03em",marginBottom:6}}>
                  {(() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; })()}{profile.name ? `, ${profile.name.split(" ")[0]}` : ""} ✨
                </h2>
                <p style={{fontSize:15,color:"rgba(255,255,255,0.6)",maxWidth:360,margin:"0 auto",lineHeight:1.6}}>
                  Your AI-powered study companion. What would you like to do?
                </p>
              </div>
            </div>
          </div>
          </div>

          {/* ── Action Cards ── */}
            <div style={{maxWidth:720,margin:"0 auto",padding:"20px 20px 24px"}}>
              <div className="ai-tab-row fade-in" style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
                {([
                  ["wellbeing","🌿","I need to talk","Wellbeing companion","linear-gradient(135deg,#059669,#10b981)","rgba(16,185,129,0.12)"],
                  ["tutor","🎓","Help me study","AI tutor for any subject","linear-gradient(135deg,#4f46e5,#6366f1)","rgba(99,102,241,0.12)"],
                  ["match","🎯","Find a partner","Smart study matching","linear-gradient(135deg,#7c3aed,#8b5cf6)","rgba(139,92,246,0.12)"],
                  ["plan","📅","Plan my week","AI study scheduler","linear-gradient(135deg,#dc2626,#ef4444)","rgba(239,68,68,0.12)"],
                ] as const).map(([tab,icon,title,desc,grad,bgTint])=>(
                  <button key={tab} onClick={()=>setAiTab(tab)} className="slide-in" style={{
                    display:"flex",flexDirection:"column",alignItems:"flex-start",gap:10,padding:"22px 20px",
                    borderRadius:20,border:`1px solid ${T.border}`,
                    background:bgTint,
                    backdropFilter:"blur(20px)",
                    boxShadow:"0 4px 24px rgba(0,0,0,0.06),0 1px 3px rgba(0,0,0,0.04)",
                    cursor:"pointer",transition:"all 0.25s",textAlign:"left",
                  }}
                  onMouseEnter={e=>{(e.currentTarget).style.transform="translateY(-4px)";(e.currentTarget).style.boxShadow="0 8px 32px rgba(0,0,0,0.1),0 2px 6px rgba(0,0,0,0.06)";}}
                  onMouseLeave={e=>{(e.currentTarget).style.transform="translateY(0)";(e.currentTarget).style.boxShadow="0 4px 24px rgba(0,0,0,0.06),0 1px 3px rgba(0,0,0,0.04)";}}>
                    <div style={{width:48,height:48,borderRadius:14,background:grad,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,boxShadow:"0 4px 16px rgba(0,0,0,0.15)"}}>
                      {icon}
                    </div>
                    <div>
                      <div style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:3}}>{title}</div>
                      <div style={{fontSize:12,color:T.muted,lineHeight:1.4}}>{desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div style={{marginTop:20,textAlign:"center"}}>
                <div style={{fontSize:11,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Quick Start</div>
                <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                  {["I'm stressed about exams","Explain recursion","Find a Calculus partner","Plan my study week"].map((q,i)=>(
                    <button key={q} onClick={()=>{setAiTab(i===0?"wellbeing":i===1?"tutor":i===2?"match":"plan");if(i===0)setWellbeingInput(q);if(i===1)setTutorInput(q);}}
                      style={{padding:"9px 16px",borderRadius:99,border:`1px solid ${T.border}`,background:T.surface,fontSize:12,color:T.textSoft,cursor:"pointer",fontWeight:500,transition:"all 0.15s",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}
                      onMouseEnter={e=>{(e.currentTarget).style.borderColor=T.accent;(e.currentTarget).style.color=T.accent;}}
                      onMouseLeave={e=>{(e.currentTarget).style.borderColor=T.border;(e.currentTarget).style.color=T.textSoft;}}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{marginTop:28,textAlign:"center",padding:"0 10px"}}>
                <div style={{fontSize:11,color:T.muted,opacity:0.5,lineHeight:1.8}}>
                  Powered by Dulaimi AI · Privacy first · Never stored · Built for Jordan 🇯🇴
                </div>
              </div>
            </div>
        </div>
        ) : (aiTab==="tutor"||aiTab==="wellbeing") ? (
        /* ── IMMERSIVE CHAT VIEW — full height, topbar + messages + input ── */
        <div className="ai-chat-wrap">
          <div className="ai-chat-topbar" style={{flexWrap:"wrap"}}>
            <button onClick={()=>setAiTab("")} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.muted,padding:4,display:"flex",alignItems:"center"}}>←</button>
            <div style={{width:28,height:28,borderRadius:9,background:aiTab==="tutor"?"linear-gradient(135deg,#6366f1,#4f46e5)":"linear-gradient(135deg,#059669,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{aiTab==="tutor"?"🎓":"🌿"}</div>
            <div style={{flex:1,minWidth:60}}>
              <div style={{fontWeight:700,fontSize:14,color:T.navy,lineHeight:1.2}}>{aiTab==="tutor"?"AI Tutor":"Noor"}</div>
            </div>
            {aiTab==="tutor"&&(
              <select value={tutorSubject} onChange={e=>setTutorSubject(e.target.value)}
                style={{padding:"5px 8px",border:`1.5px solid ${T.border}`,borderRadius:8,fontSize:11,fontWeight:600,color:T.text,background:T.bg,outline:"none",maxWidth:120,flexShrink:1}}>
                <option value="">General</option>
                {getCourseGroups().map(([cat,list])=>(
                  <optgroup key={cat} label={cat}>{list.map((c,i)=><option key={i} value={c}>{c}</option>)}</optgroup>
                ))}
              </select>
            )}
            <div style={{display:"flex",gap:2}}>
              {([["auto","🔄"],["en","🇬🇧"],["ar","🇯🇴"]] as const).map(([val,flag])=>(
                <button key={val} onClick={()=>setAiLang(val)}
                  style={{padding:"4px 8px",borderRadius:99,fontSize:11,fontWeight:aiLang===val?700:400,
                    background:aiLang===val?T.accentSoft:"transparent",
                    border:`1px solid ${aiLang===val?T.accent+"44":T.border}`,
                    color:aiLang===val?T.accent:T.muted,
                    cursor:"pointer",transition:"all 0.15s"}}>
                  {flag}
                </button>
              ))}
            </div>
            {((aiTab==="wellbeing"&&wellbeingMsgs.length>0)||(aiTab==="tutor"&&tutorMsgs.length>0))&&(
              <button onClick={()=>{if(aiTab==="wellbeing"){setWellbeingMsgs([]);setWellbeingMood("");setWellbeingMode("");}else{setTutorMsgs([]);}}} style={{padding:"4px 10px",borderRadius:99,border:`1px solid ${T.border}`,background:"transparent",color:T.muted,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>↺ New</button>
            )}
          </div>

          {/* ── Messages area (shared scroll container for both tutor & wellbeing) ── */}
          <div className="ai-chat-messages chat-scroll" ref={aiChatScrollRef} style={{position:"relative"}}
            onScroll={e=>{const el=e.currentTarget;const dist=el.scrollHeight-el.scrollTop-el.clientHeight;setShowScrollBottom(dist>200);}}>

            {aiTab==="wellbeing" ? (
              <>
                {wellbeingMsgs.length===0&&(wellbeingMood||wellbeingMode)&&(
                  <div style={{padding:"8px 14px",background:darkMode?"rgba(16,185,129,0.1)":"linear-gradient(135deg,#f0fdf4,#ecfdf5)",borderRadius:12,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    {wellbeingMood&&<span style={{padding:"4px 12px",borderRadius:99,background:darkMode?"rgba(16,185,129,0.2)":"#d1fae5",fontSize:12,fontWeight:700,color:darkMode?"#6ee7b7":"#065f46"}}>Feeling: {wellbeingMood}</span>}
                    {wellbeingMode&&<span style={{padding:"4px 12px",borderRadius:99,background:darkMode?"rgba(16,185,129,0.25)":"#a7f3d0",fontSize:12,fontWeight:700,color:darkMode?"#6ee7b7":"#064e3b"}}>{wellbeingMode}</span>}
                    <span style={{fontSize:12,color:darkMode?"#6ee7b7":"#047857",fontWeight:500}}>Ready when you are</span>
                  </div>
                )}
                {wellbeingMsgs.length===0&&(()=>{
                  return (
                    <div style={{textAlign:"center",padding:"30px 20px",color:T.muted,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flex:1}}>
                      <div style={{
                        width:72,height:72,borderRadius:"50%",marginBottom:20,
                        background:"radial-gradient(circle at 35% 30%,#34d399 0%,#10b981 30%,#059669 60%,#047857 100%)",
                        boxShadow:"0 0 40px rgba(16,185,129,0.2),0 8px 24px rgba(16,185,129,0.15)",
                        animation:"orbPulse 4s ease-in-out infinite",
                      }}/>
                      <div style={{fontSize:20,fontWeight:800,color:T.navy,letterSpacing:"-0.02em"}}>How are you feeling?</div>
                      <div style={{fontSize:14,color:T.muted,marginTop:8,maxWidth:300,lineHeight:1.6}}>I'm Noor — your wellbeing companion. Type anything, in Arabic or English.</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",marginTop:20}}>
                        {["I'm stressed","Feeling anxious","Need to vent","Help me relax"].map(q=>(
                          <button key={q} onClick={()=>setWellbeingInput(q)}
                            style={{padding:"10px 18px",borderRadius:99,border:"none",background:darkMode?"rgba(16,185,129,0.15)":"#ecfdf5",fontSize:13,color:darkMode?"#6ee7b7":"#065f46",cursor:"pointer",fontWeight:600,transition:"all 0.15s"}}
                            onMouseEnter={e=>{(e.currentTarget).style.background=darkMode?"rgba(16,185,129,0.25)":"#d1fae5";}}
                            onMouseLeave={e=>{(e.currentTarget).style.background=darkMode?"rgba(16,185,129,0.15)":"#ecfdf5";}}>
                            {q}
                          </button>
                        ))}
                      </div>
                      {/* Mood & Mode selectors inside empty state */}
                      <div style={{width:"100%",maxWidth:500,marginTop:24,background:T.surface,borderRadius:18,border:`1px solid ${T.border}`,padding:18,textAlign:"left"}}>
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:13,fontWeight:700,color:T.navy,marginBottom:10}}>How are you feeling right now?</div>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                            {[["😊","Good"],["😐","Okay"],["😔","Down"],["😰","Anxious"],["😤","Frustrated"],["😩","Exhausted"],["😶","Numb"]].map(([emoji,label])=>(
                              <button key={label} onClick={()=>setWellbeingMood(wellbeingMood===label?"":label)}
                                style={{padding:"8px 14px",borderRadius:12,border:`1.5px solid ${wellbeingMood===label?"#059669":"#6ee7b755"}`,background:wellbeingMood===label?(darkMode?"rgba(16,185,129,0.2)":"#d1fae5"):"transparent",fontSize:13,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:58,transition:"border-color 0.15s,background-color 0.15s"}}>
                                <span style={{fontSize:22}}>{emoji}</span>
                                <span style={{fontSize:10,fontWeight:wellbeingMood===label?700:400,color:wellbeingMood===label?(darkMode?"#6ee7b7":"#065f46"):T.muted}}>{label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:T.navy,marginBottom:10}}>What kind of support do you need?</div>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                            {[["💭","I want to vent","Just listen, I need to get this out"],["💡","I want advice","Help me think through a problem"],["🧘","Coping tool","Guide me through a calming exercise"]].map(([icon,label,desc])=>(
                              <button key={label} onClick={()=>setWellbeingMode(wellbeingMode===label?"":label)}
                                style={{flex:1,minWidth:120,padding:"10px 12px",borderRadius:13,border:`1.5px solid ${wellbeingMode===label?"#059669":"#6ee7b755"}`,background:wellbeingMode===label?(darkMode?"rgba(16,185,129,0.2)":"#d1fae5"):T.bg,cursor:"pointer",textAlign:"left",transition:"border-color 0.15s,background-color 0.15s"}}>
                                <div style={{fontSize:18,marginBottom:3}}>{icon}</div>
                                <div style={{fontSize:12,fontWeight:700,color:wellbeingMode===label?(darkMode?"#6ee7b7":"#065f46"):T.navy}}>{label}</div>
                                <div style={{fontSize:10,color:T.muted,marginTop:2,lineHeight:1.4}}>{desc}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {/* Quick prompts inside empty state */}
                      <div style={{width:"100%",maxWidth:500,marginTop:16,textAlign:"left"}}>
                        <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Tap something that feels real to you</div>
                        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                          {[
                            ["📚 Study pressure","I've been staring at my notes for hours and nothing is going in — I feel like everyone else gets it but me"],
                            ["😰 Exam panic","My exams are coming and I'm convinced I'm going to fail and disappoint my family"],
                            ["😶 Lonely on campus","I feel invisible at university — like I don't belong here and nobody would notice if I disappeared"],
                            ["👨‍👩‍👦 Family weight","بابا وماما بشوفوا فيني كل أملهم — that pressure is suffocating me and I don't know how to talk to them"],
                            ["🔋 Empty","I'm running on empty. I can't find a single reason to open my books today."],
                            ["🌬️ Help me breathe","I'm overwhelmed right now — guide me through a calming exercise"],
                            ["💭 Just vent","بدي أحكي بس ما في حدا يسمعني — I just need someone to listen, no advice"],
                            ["🤔 Wrong major","I think I chose the wrong major and I'm terrified to tell my family"],
                            ["😴 Post-tawjihi","I worked so hard for tawjihi but university feels even harder — I'm losing confidence"],
                            ["💔 Comparison","Everyone around me seems to have it together and I keep wondering what's wrong with me"],
                          ].map(([label,msg])=>(
                            <button key={label} onClick={()=>setWellbeingInput(msg)}
                              style={{padding:"7px 13px",borderRadius:99,border:"1.5px solid #6ee7b755",background:darkMode?"rgba(16,185,129,0.1)":"#f0fdf4",fontSize:12,color:darkMode?"#6ee7b7":"#047857",cursor:"pointer",fontWeight:500,textAlign:"left",lineHeight:1.4}}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Privacy notice */}
                      <div style={{width:"100%",maxWidth:500,marginTop:16,padding:"11px 14px",borderRadius:13,background:T.bg,border:`1px solid ${T.border}`,fontSize:11,color:T.muted,lineHeight:1.7,display:"flex",gap:8,alignItems:"flex-start",textAlign:"left"}}>
                        <span style={{flexShrink:0}}>🔒</span>
                        <span><strong>Private &amp; confidential.</strong> This AI uses CBT, MI, DBT &amp; ACT frameworks and is a supportive companion — not a licensed therapist. For serious difficulties, please reach out to a professional.</span>
                      </div>
                    </div>
                  );
                })()}
                {wellbeingMsgs.map((m,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",alignItems:"flex-end",gap:8}}>
                    {m.role==="assistant"&&(
                      <div style={{width:32,height:32,borderRadius:11,background:"linear-gradient(135deg,#059669,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,marginBottom:2}}>🌿</div>
                    )}
                    <div style={{maxWidth:"80%",padding:"14px 18px",borderRadius:m.role==="user"?"20px 20px 4px 20px":"20px 20px 20px 4px",background:m.role==="user"?"linear-gradient(135deg,#059669,#10b981)":T.surface,color:m.role==="user"?"#fff":T.text,border:m.role==="assistant"?`1px solid ${T.border}`:"none",fontSize:15,lineHeight:1.7,boxShadow:m.role==="assistant"?"0 1px 4px rgba(0,0,0,0.04)":"0 2px 8px rgba(5,150,105,0.15)",...(m.role==="user"?{whiteSpace:"pre-wrap" as const}:{})}}>
                      {m.content ? (m.role==="assistant" ? renderMarkdown(m.content) : m.content) : <span style={{opacity:0.4}}>▌</span>}
                    </div>
                  </div>
                ))}
                {wellbeingLoading&&wellbeingMsgs[wellbeingMsgs.length-1]?.role==="user"&&(
                  <div style={{display:"flex",alignItems:"flex-end",gap:8}}>
                    <div style={{width:32,height:32,borderRadius:11,background:"linear-gradient(135deg,#059669,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🌿</div>
                    <div style={{display:"flex",gap:5,padding:"13px 18px",background:T.surface,border:`1px solid #6ee7b733`,borderRadius:"18px 18px 18px 4px"}}>
                      {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#10b981",animation:`pulse ${0.8+i*0.15}s ease-in-out infinite`}}/>)}
                    </div>
                  </div>
                )}
                <div ref={wellbeingEndRef}/>
                {/* ── Crisis Resources (scrolls with messages) ── */}
                <details style={{marginTop:16}}>
                  <summary style={{fontSize:13,fontWeight:700,color:T.navy,cursor:"pointer",padding:"10px 0",display:"flex",alignItems:"center",gap:8}}>
                    <span>🆘</span> Crisis Resources &amp; Self-Care Toolkit
                  </summary>
                  <div style={{padding:"16px 18px",borderRadius:16,background:darkMode?"rgba(251,146,60,0.08)":"linear-gradient(135deg,#fff7ed,#fffbf0)",border:darkMode?"1.5px solid rgba(251,146,60,0.3)":"1.5px solid #fed7aa",marginTop:8}}>
                    <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:14}}>
                      <div style={{width:40,height:40,borderRadius:12,background:darkMode?"rgba(251,146,60,0.2)":"#fed7aa",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🆘</div>
                      <div>
                        <div style={{fontSize:13,fontWeight:800,color:darkMode?"#fdba74":"#92400e",marginBottom:6}}>الدعم موجود — Help is always available</div>
                        <div style={{fontSize:12,color:darkMode?"#fed7aa":"#78350f",lineHeight:2}}>
                          🇯🇴 Jordan Mental Health Hotline: <strong style={{fontFamily:"monospace"}}>06-550-8888</strong><br/>
                          🚨 Emergency: <strong>911</strong><br/>
                          📱 <strong>"Relax" App</strong> — free, anonymous, Arabic support<br/>
                          🏫 Your university counseling center is free &amp; confidential
                        </div>
                      </div>
                    </div>
                    <div style={{borderTop:darkMode?"1px solid rgba(251,146,60,0.2)":"1px solid #fed7aa88",paddingTop:14}}>
                      <div style={{fontSize:12,fontWeight:700,color:darkMode?"#fdba74":"#92400e",marginBottom:10}}>📚 Trusted Mental Health Resources</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {[
                          {icon:"🏛️",name:"PSUT Counseling Center",desc:"Free sessions for all PSUT students"},
                          {icon:"🎓",name:"UJ Student Counseling",desc:"University of Jordan psychological support"},
                          {icon:"🌍",name:"GJU Student Support",desc:"German-Jordanian University wellness office"},
                          {icon:"🏫",name:"AAU Student Support",desc:"Amman Al-Ahliyya University counseling"},
                          {icon:"📘",name:"ASU Student Services",desc:"Applied Science University support center"},
                          {icon:"🎯",name:"MEU Student Wellbeing",desc:"Middle East University counseling services"},
                          {icon:"🌿",name:"AUM Student Affairs",desc:"American University of Madaba student support"},
                          {icon:"🧠",name:"WHO Mental Health",desc:"World Health Organization — self-help resources"},
                          {icon:"📖",name:"Harvard Health — Mental Wellness",desc:"Evidence-based guides for students"},
                          {icon:"🌱",name:"Stanford Wellbeing",desc:"Tips for academic stress & resilience"},
                        ].map(r=>(
                          <div key={r.name} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,background:darkMode?"rgba(251,146,60,0.06)":"rgba(255,255,255,0.6)"}}>
                            <span style={{fontSize:18,flexShrink:0}}>{r.icon}</span>
                            <div>
                              <div style={{fontSize:12,fontWeight:700,color:darkMode?"#fed7aa":"#78350f"}}>{r.name}</div>
                              <div style={{fontSize:11,color:darkMode?"#fdba74":"#92400e"}}>{r.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{borderTop:darkMode?"1px solid rgba(251,146,60,0.2)":"1px solid #fed7aa88",paddingTop:14,marginTop:14}}>
                      <div style={{fontSize:12,fontWeight:700,color:darkMode?"#fdba74":"#92400e",marginBottom:10}}>🧘 Self-Care Toolkit</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {[
                          ["🫁","Breathing","4-7-8 technique"],
                          ["😴","Sleep","Hygiene tips"],
                          ["⏰","Pomodoro","Focus method"],
                          ["🧘","Mindfulness","Ground yourself"],
                          ["📝","Journaling","Express feelings"],
                          ["🚶","Movement","Walk & reset"],
                        ].map(([icon,title,desc])=>(
                          <div key={title} style={{flex:"1 1 90px",padding:"10px 12px",borderRadius:10,background:darkMode?"rgba(251,146,60,0.06)":"rgba(255,255,255,0.6)",textAlign:"center",minWidth:85}}>
                            <div style={{fontSize:20,marginBottom:3}}>{icon}</div>
                            <div style={{fontSize:11,fontWeight:700,color:darkMode?"#fed7aa":"#78350f"}}>{title}</div>
                            <div style={{fontSize:10,color:darkMode?"#fdba74":"#92400e"}}>{desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
                <div style={{marginTop:10,padding:"11px 14px",borderRadius:13,background:T.bg,border:`1px solid ${T.border}`,fontSize:11,color:T.muted,lineHeight:1.7,display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={{flexShrink:0}}>🔒</span>
                  <span><strong>Private &amp; confidential.</strong> This AI uses CBT, MI, DBT &amp; ACT frameworks and is a supportive companion — not a licensed therapist. For serious difficulties, please reach out to a professional. You deserve real support.</span>
                </div>
              </>
            ) : (
              /* ── Tutor messages (immersive layout) ── */
              <>
                {tutorMsgs.length===0&&(
                  <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"30px 20px"}}>
                    {/* Orb */}
                    <div style={{
                      width:72,height:72,borderRadius:"50%",marginBottom:20,
                      background:"radial-gradient(circle at 35% 30%,#818cf8 0%,#6366f1 40%,#4f46e5 80%)",
                      boxShadow:"0 0 40px rgba(99,102,241,0.2),0 8px 24px rgba(99,102,241,0.15)",
                      animation:"orbPulse 4s ease-in-out infinite",
                    }}/>
                    <div style={{fontSize:20,fontWeight:800,color:T.navy,letterSpacing:"-0.02em"}}>What do you need help with?</div>
                    <div style={{fontSize:14,color:T.muted,textAlign:"center",maxWidth:320,marginTop:8,lineHeight:1.6}}>I'm Ustaz — your AI tutor. Ask about any concept, problem, or course material.</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",marginTop:20}}>
                      {["Explain recursion","Solve integrals","Newton's 2nd law","Ohm's Law"].map(q=>(
                        <button key={q} onClick={()=>setTutorInput(q)}
                          style={{padding:"10px 18px",borderRadius:99,border:"none",background:darkMode?"rgba(99,102,241,0.15)":"#eef2ff",fontSize:13,color:darkMode?"#a5b4fc":"#4338ca",cursor:"pointer",fontWeight:600,transition:"all 0.15s"}}
                          onMouseEnter={e=>{(e.currentTarget).style.background=darkMode?"rgba(99,102,241,0.25)":"#e0e7ff";}}
                          onMouseLeave={e=>{(e.currentTarget).style.background=darkMode?"rgba(99,102,241,0.15)":"#eef2ff";}}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {tutorMsgs.map((m,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",alignItems:"flex-end",gap:8}}>
                    {m.role==="assistant"&&(
                      <div style={{width:32,height:32,borderRadius:11,background:"linear-gradient(135deg,#6366f1,#4f46e5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,marginBottom:2,boxShadow:"0 2px 8px rgba(99,102,241,0.2)"}}>🎓</div>
                    )}
                    <div style={{maxWidth:"80%",padding:"14px 18px",borderRadius:m.role==="user"?"20px 20px 4px 20px":"20px 20px 20px 4px",background:m.role==="user"?"linear-gradient(135deg,#6366f1,#4f46e5)":T.surface,color:m.role==="user"?"#fff":T.text,border:m.role==="assistant"?`1px solid ${T.border}`:"none",fontSize:15,lineHeight:1.7,boxShadow:m.role==="user"?"0 2px 8px rgba(99,102,241,0.15)":"0 1px 4px rgba(0,0,0,0.04)",...(m.role==="user"?{whiteSpace:"pre-wrap" as const}:{})}}>
                      {m.content ? (m.role==="assistant" ? renderMarkdown(m.content) : m.content) : <span style={{opacity:0.5}}>▌</span>}
                    </div>
                  </div>
                ))}
                {tutorLoading&&tutorMsgs[tutorMsgs.length-1]?.role==="user"&&(
                  <div style={{display:"flex",alignItems:"flex-end",gap:8}}>
                    <div style={{width:32,height:32,borderRadius:11,background:"linear-gradient(135deg,#6366f1,#4f46e5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🎓</div>
                    <div style={{display:"flex",gap:5,padding:"13px 18px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"18px 18px 18px 4px"}}>
                      {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#6366f1",animation:`pulse ${0.8+i*0.15}s ease-in-out infinite`}}/>)}
                    </div>
                  </div>
                )}
                <div ref={tutorEndRef}/>
              </>
            )}

            {showScrollBottom&&<button className="scroll-to-bottom" onClick={()=>{(aiTab==="wellbeing"?wellbeingEndRef:tutorEndRef).current?.scrollIntoView({behavior:"smooth"});}}>↓</button>}
          </div>

          {/* File attachment bar for tutor */}
          {aiTab==="tutor"&&tutorFile&&(
            <div style={{padding:"8px 16px",borderTop:`1px solid ${T.border}`,background:T.accentSoft,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>📎</span>
              <span style={{fontSize:12,fontWeight:600,color:T.accent,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tutorFile.name}</span>
              <span style={{fontSize:11,color:T.muted}}>{tutorFile.text.length>500?`${(tutorFile.text.length/1000).toFixed(1)}k chars`:`${tutorFile.text.length} chars`}</span>
              <button onClick={()=>setTutorFile(null)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:16,padding:2}} aria-label="Remove file">×</button>
            </div>
          )}

          {/* ── Input bar ── */}
          <div className="ai-chat-input">
            {aiTab==="tutor"&&(
              <>
                <input type="file" ref={tutorFileRef} accept=".txt,.pdf,.md,.csv,.json,.js,.ts,.py,.java,.c,.cpp,.html,.css,.tex,.rtf,.log,.xml,.yaml,.yml,.sql,.r,.go,.rs,.swift,.kt,.rb,.php,.sh" style={{display:"none"}}
                  onChange={async e=>{
                    const f=e.target.files?.[0];if(!f)return;
                    e.target.value="";
                    // 40 MB hard ceiling.
                    const MAX_FILE_BYTES = 40 * 1024 * 1024;
                    if(f.size > MAX_FILE_BYTES){
                      showNotif(`File too large — max 40 MB (you sent ${(f.size/1024/1024).toFixed(1)} MB)`, "err");
                      return;
                    }
                    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
                    const sizeMB = (f.size/1024/1024).toFixed(1);
                    if (isPdf) {
                      // Extract actual text from the PDF via pdfjs-dist loaded from a CDN.
                      // Previously readAsText() was used, which produced binary garbage that
                      // made the tutor hang on an empty response bubble.
                      showNotif("📄 Reading PDF...", "ok");
                      try {
                        // @ts-expect-error — dynamic CDN import, no bundled types
                        const pdfjs: any = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.mjs");
                        pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs";
                        const buf = await f.arrayBuffer();
                        const pdf = await pdfjs.getDocument({ data: buf }).promise;
                        let fullText = "";
                        const maxPages = Math.min(pdf.numPages, 60); // safety cap
                        for (let i = 1; i <= maxPages; i++) {
                          const page = await pdf.getPage(i);
                          const content = await page.getTextContent();
                          const pageText = content.items.map((it: any) => it.str).join(" ");
                          fullText += `\n\n--- Page ${i} ---\n${pageText}`;
                          if (fullText.length > 60000) break; // cap total size
                        }
                        const cleaned = fullText.trim();
                        if (!cleaned || cleaned.length < 20) {
                          showNotif("Couldn't extract text — PDF may be image-only (scanned). Try a text-based PDF or paste the content.", "err");
                          return;
                        }
                        setTutorFile({ name: f.name, text: cleaned });
                        showNotif(`📄 ${f.name} loaded (${pdf.numPages} pages)`, "ok");
                      } catch (err) {
                        showNotif("Couldn't read PDF — try a different file, or copy the text and paste it.", "err");
                      }
                      return;
                    }
                    // Non-PDF: read as text (works for .txt, .md, .csv, .json, .js/.ts/.py/etc.)
                    const reader=new FileReader();
                    reader.onerror=()=>showNotif("Couldn't read the file — try a different one","err");
                    reader.onload=()=>{
                      const text = (reader.result as string) || "";
                      if (!text.trim()) {
                        showNotif("File looks empty — try a different one", "err");
                        return;
                      }
                      setTutorFile({name:f.name, text});
                      if(text.length > 40000){
                        showNotif(`Loaded ${sizeMB} MB — AI will read the first ~40k characters`, "ok");
                      } else {
                        showNotif(`📄 ${f.name} loaded`, "ok");
                      }
                    };
                    reader.readAsText(f);
                  }}/>
                <button onClick={()=>tutorFileRef.current?.click()} title="Upload course material"
                  style={{width:46,height:46,borderRadius:14,border:`1.5px solid ${T.border}`,background:tutorFile?T.accentSoft:T.bg,color:tutorFile?T.accent:T.muted,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
                  📎
                </button>
              </>
            )}
            {aiTab==="tutor" ? (
              <input value={tutorInput} onChange={e=>setTutorInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendTutorMessage()}
                placeholder={tutorFile?"Ask about the uploaded file...":"Ask your AI tutor anything..."} maxLength={2000}
                style={{flex:1,padding:"12px 16px",border:`1.5px solid ${T.border}`,borderRadius:16,fontSize:16,color:T.text,background:T.bg,outline:"none",transition:"border-color 0.2s,box-shadow 0.2s",lineHeight:1.6,fontFamily:"inherit"}}
                onFocus={e=>{(e.target as HTMLInputElement).style.borderColor="#6366f1";(e.target as HTMLInputElement).style.boxShadow="0 0 0 3px rgba(99,102,241,0.1)";}}
                onBlur={e=>{(e.target as HTMLInputElement).style.borderColor=T.border;(e.target as HTMLInputElement).style.boxShadow="none";}}/>
            ) : (
              <textarea value={wellbeingInput} onChange={e=>setWellbeingInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),sendWellbeingMessage())}
                placeholder={wellbeingMode==="Coping tool"?"Guide me through a calming technique...":wellbeingMode==="I want to vent"?"This is your space. Start wherever.":"Type — Arabic, English, or both."}
                rows={2}
                style={{flex:1,padding:"12px 16px",border:`1.5px solid ${T.border}`,borderRadius:16,fontSize:16,color:T.text,background:T.bg,outline:"none",resize:"none",lineHeight:1.6,fontFamily:"inherit",transition:"border-color 0.2s,box-shadow 0.2s"}}
                onFocus={e=>{(e.target as HTMLTextAreaElement).style.borderColor="#10b981";(e.target as HTMLTextAreaElement).style.boxShadow="0 0 0 3px rgba(16,185,129,0.1)";}}
                onBlur={e=>{(e.target as HTMLTextAreaElement).style.borderColor=T.border;(e.target as HTMLTextAreaElement).style.boxShadow="none";}}
                maxLength={2000}/>
            )}
            <button type="button"
              onClick={aiTab==="tutor"?sendTutorMessage:sendWellbeingMessage}
              disabled={aiTab==="tutor"?(tutorLoading||!tutorInput.trim()):(wellbeingLoading||!wellbeingInput.trim())}
              style={{width:46,height:46,borderRadius:14,
                background:(aiTab==="tutor"?(tutorLoading||!tutorInput.trim()):(wellbeingLoading||!wellbeingInput.trim()))?T.border:(aiTab==="tutor"?"linear-gradient(135deg,#6366f1,#4f46e5)":"linear-gradient(135deg,#059669,#10b981)"),
                color:(aiTab==="tutor"?(tutorLoading||!tutorInput.trim()):(wellbeingLoading||!wellbeingInput.trim()))?T.muted:"#fff",
                border:"none",
                cursor:(aiTab==="tutor"?(tutorLoading||!tutorInput.trim()):(wellbeingLoading||!wellbeingInput.trim()))?"not-allowed":"pointer",
                fontSize:18,fontWeight:700,transition:"all 0.2s",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                boxShadow:(aiTab==="tutor"?(tutorLoading||!tutorInput.trim()):(wellbeingLoading||!wellbeingInput.trim()))?"none":(aiTab==="tutor"?"0 3px 12px rgba(99,102,241,0.25)":"0 3px 12px rgba(16,185,129,0.25)")}}>
              {(aiTab==="tutor"?tutorLoading:wellbeingLoading)?"···":"↑"}
            </button>
          </div>
        </div>
        ) : (
        /* ── MATCH / PLAN — page-scroll layout with topbar ── */
        <div className="page-scroll" style={{background:T.bg}}>
          <div style={{background:"linear-gradient(180deg,#0f172a 0%,#1e1b4b 100%)",padding:"16px 20px 20px",display:"flex",alignItems:"center",gap:12}}>
            <button onClick={()=>setAiTab("")} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"rgba(255,255,255,0.7)",padding:4,display:"flex",alignItems:"center"}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:16,color:"#fff"}}>{aiTab==="match"?"Smart Match":"Study Planner"}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.5)"}}>{aiTab==="match"?"Find your ideal study partner":"AI-powered weekly schedule"}</div>
            </div>
            <div style={{display:"flex",gap:3}}>
              {([["auto","🔄"],["en","🇬🇧"],["ar","🇯🇴"]] as const).map(([val,flag])=>(
                <button key={val} onClick={()=>setAiLang(val)}
                  style={{padding:"5px 10px",borderRadius:99,fontSize:11,fontWeight:aiLang===val?700:400,
                    background:aiLang===val?"rgba(255,255,255,0.15)":"transparent",
                    border:`1px solid ${aiLang===val?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.1)"}`,
                    color:aiLang===val?"#fff":"rgba(255,255,255,0.5)",
                    cursor:"pointer",transition:"all 0.15s"}}>
                  {flag}
                </button>
              ))}
            </div>
          </div>
          <div style={{maxWidth:720,margin:"0 auto",padding:"20px 20px 24px"}}>

            {/* ── SMART MATCH ── */}
            {aiTab==="match"&&(
              <div className="slide-in">
                {/* ── Study Partner Questionnaire ── */}
                <div style={{background:T.surface,borderRadius:24,padding:24,marginBottom:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04),0 8px 40px rgba(139,92,246,0.06)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6}}>
                    <div style={{width:42,height:42,borderRadius:13,background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:"0 4px 14px rgba(139,92,246,0.25)"}}>🧠</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:15,color:T.navy}}>Study Partner Questionnaire</div>
                      <div style={{fontSize:12,color:T.muted}}>Help us find your ideal study partner based on psychology-backed compatibility</div>
                    </div>
                    {matchQuizSaved&&<span style={{fontSize:11,fontWeight:700,color:T.green,background:T.greenSoft,padding:"3px 10px",borderRadius:99}}>Saved</span>}
                  </div>
                  <details open={!matchQuizSaved} style={{marginTop:14}}>
                    <summary style={{cursor:"pointer",fontSize:13,fontWeight:600,color:T.accent,marginBottom:12}}>{matchQuizSaved?"Edit your answers":"Answer these 7 questions for better matches"}</summary>
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      {([
                        {key:"study_style",q:"How do you prefer to study?",opts:["Visual (diagrams, videos)","Reading/Writing (notes, textbooks)","Auditory (discussions, lectures)","Hands-on (practice problems, labs)"]},
                        {key:"schedule",q:"When are you most productive?",opts:["Early morning (6-10 AM)","Midday (10 AM-2 PM)","Afternoon (2-6 PM)","Evening/Night (6 PM+)"]},
                        {key:"pace",q:"What's your study pace?",opts:["Fast — cover topics quickly","Moderate — balanced speed","Slow & thorough — deep understanding"]},
                        {key:"group_size",q:"Ideal group size?",opts:["1-on-1 only","Small group (3-4)","Any size is fine"]},
                        {key:"motivation",q:"What motivates you most?",opts:["Grades & GPA","Understanding the material","Career preparation","Peer accountability"]},
                        {key:"communication",q:"How do you prefer to communicate?",opts:["Text/Chat only","Voice/Video calls","In person","Mix of everything"]},
                        {key:"personality",q:"In a study session, you tend to…",opts:["Lead and organize","Follow along and contribute","Teach others","Ask lots of questions"]}
                      ] as const).map(({key,q,opts})=>(
                        <div key={key}>
                          <div style={{fontSize:13,fontWeight:600,color:T.navy,marginBottom:6}}>{q}</div>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {opts.map(o=>(
                              <button key={o} onClick={()=>setMatchQuiz(p=>({...p,[key]:o}))}
                                style={{padding:"7px 14px",borderRadius:99,fontSize:12,fontWeight:matchQuiz[key]===o?700:500,
                                  background:matchQuiz[key]===o?T.accent:T.bg,color:matchQuiz[key]===o?"#fff":T.textSoft,
                                  border:`1.5px solid ${matchQuiz[key]===o?T.accent:T.border}`,cursor:"pointer",transition:"all 0.15s"}}>
                                {o}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                      <button onClick={saveMatchQuiz} disabled={Object.keys(matchQuiz).length<4}
                        className="btn-primary" style={{width:"100%",padding:12,borderRadius:14,marginTop:4}}>
                        {matchQuizSaved?"Update My Preferences":"Save My Preferences"}
                      </button>
                      {Object.keys(matchQuiz).length<4&&<p style={{fontSize:11,color:T.muted,textAlign:"center"}}>Answer at least 4 questions to save</p>}
                    </div>
                  </details>
                </div>

                {/* ── AI Smart Matching ── */}
                <div style={{background:T.surface,borderRadius:24,border:`1px solid ${T.border}`,padding:22,marginBottom:16,boxShadow:"0 4px 32px rgba(0,0,0,0.08),0 1px 3px rgba(0,0,0,0.04)",position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",top:"-30%",right:"-20%",width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,rgba(46,204,141,0.1),transparent 70%)",filter:"blur(40px)",pointerEvents:"none"}}/>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,position:"relative"}}>
                    <div style={{width:42,height:42,borderRadius:13,background:"linear-gradient(135deg,#2ECC8D,#00B894)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🎯</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:15,color:T.navy}}>AI-Powered Smart Matching</div>
                      <div style={{fontSize:12,color:T.muted}}>{matchQuizSaved?"Using your questionnaire + profile for best results":"Complete the questionnaire above for better matches"}</div>
                    </div>
                  </div>
                  <button onClick={loadMatchScores} disabled={matchLoading||allStudents.length===0}
                    className="btn-primary" style={{width:"100%",padding:13,borderRadius:14}}>
                    {matchLoading?"🔄 Analyzing compatibility...":Object.keys(matchScores).length>0?"🔄 Re-run Smart Match":"🎯 Find My Best Matches"}
                  </button>
                  {allStudents.length===0&&<p style={{fontSize:12,color:T.muted,marginTop:8,textAlign:"center"}}>No other students to match with yet. Check back soon!</p>}
                </div>

                {Object.keys(matchScores).length>0&&(
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:12}}>Ranked by AI Compatibility</div>
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {allStudents
                        .filter(s=>matchScores[s.id])
                        .sort((a,b)=>(matchScores[b.id]?.score||0)-(matchScores[a.id]?.score||0))
                        .map((s,idx)=>{
                          const ms=matchScores[s.id];
                          const scoreClass=ms.score>=75?"match-score-high":ms.score>=50?"match-score-mid":"match-score-low";
                          const isConn=connectionIds.has(s.id);
                          return(
                            <div key={s.id} style={{background:T.surface,borderRadius:16,padding:"14px 16px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:14}} className="card">
                              <div style={{width:24,height:24,borderRadius:"50%",background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:T.accent,flexShrink:0}}>#{idx+1}</div>
                              <div style={{width:42,height:42,borderRadius:13,background:s.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14,flexShrink:0}}>
                                {(s.name||"?").split(" ").map((x:string)=>x[0]).join("").slice(0,2).toUpperCase()}
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontWeight:700,fontSize:14,color:T.navy,cursor:"pointer"}} onClick={e=>{e.stopPropagation();openStudentProfile(s.id, s as Profile);}}>{s.name}</div>
                                <div style={{fontSize:12,color:T.muted,marginTop:1}}>{s.major} · {s.uni}</div>
                                <div style={{fontSize:11,color:T.textSoft,marginTop:2,fontStyle:"italic"}}>"{ms.reason}"</div>
                              </div>
                              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
                                <div className={scoreClass} style={{padding:"4px 10px",borderRadius:99,fontSize:12,fontWeight:800}}>{ms.score}%</div>
                                {isConn?(
                                  <button onClick={()=>{const c=connections.find(x=>x.id===s.id);if(c){setActiveChat(c);setScreen("connect");loadMessages(c.id);}}}
                                    style={{padding:"5px 12px",borderRadius:99,background:T.greenSoft,border:"none",color:T.green,fontSize:11,fontWeight:700,cursor:"pointer"}}>Chat →</button>
                                ):(
                                  <button onClick={()=>{setScreen("discover");}}
                                    style={{padding:"5px 12px",borderRadius:99,background:T.accentSoft,border:"none",color:T.accent,fontSize:11,fontWeight:700,cursor:"pointer"}}>Connect</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── STUDY PLAN ── */}
            {aiTab==="plan"&&(
              <div className="slide-in">
                <div style={{background:T.surface,borderRadius:24,padding:24,marginBottom:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04),0 8px 40px rgba(99,102,241,0.06)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
                    <div style={{width:42,height:42,borderRadius:13,background:"linear-gradient(135deg,#8b5cf6,#6366f1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:"0 4px 14px rgba(99,102,241,0.25)"}}>📅</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:15,color:T.navy}}>AI Study Plan Generator</div>
                      <div style={{fontSize:12,color:T.muted}}>Get a personalized weekly study schedule</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Subjects to study (e.g. Calculus 2, Data Structures, Physics)</label>
                    <textarea rows={2} value={planSubjects} onChange={e=>setPlanSubjects(e.target.value)}
                      placeholder="List your subjects, separated by commas..." maxLength={500}
                      style={{width:"100%",padding:"11px 14px",border:`1.5px solid ${T.border}`,borderRadius:12,fontSize:13,color:T.text,background:T.surface,resize:"none",outline:"none"}}/>
                  </div>
                  <div className="field">
                    <label>Upcoming exams / deadlines (optional)</label>
                    <input value={planExamDates} onChange={e=>setPlanExamDates(e.target.value)}
                      placeholder="e.g. Calculus exam on April 5, OS project due April 10..." maxLength={500}
                      style={{width:"100%",padding:"11px 14px",border:`1.5px solid ${T.border}`,borderRadius:12,fontSize:13,color:T.text,background:T.surface,outline:"none"}}/>
                  </div>
                  {profile.major&&<div style={{fontSize:12,color:T.textSoft,marginBottom:14,display:"flex",alignItems:"center",gap:6}}><span>📚</span> Using your profile: <strong>{profile.year||""} {profile.major}</strong></div>}
                  <button onClick={generateStudyPlan} disabled={planLoading||!planSubjects.trim()}
                    className="btn-primary" style={{width:"100%",padding:14,borderRadius:16,background:planLoading||!planSubjects.trim()?undefined:"linear-gradient(135deg,#8b5cf6,#6366f1,#4f46e5)",boxShadow:planLoading||!planSubjects.trim()?"none":"0 4px 20px rgba(99,102,241,0.3)",fontSize:15,fontWeight:700,letterSpacing:"-0.01em"}}>
                    {planLoading?"🔄 Generating your plan...":"✨ Generate My Study Plan"}
                  </button>
                </div>

                {/* ── Pomodoro Study Timer ── */}
                <div style={{background:T.surface,borderRadius:24,padding:24,marginBottom:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04),0 8px 40px rgba(239,68,68,0.06)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:pomodoroActive?18:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{width:42,height:42,borderRadius:13,background:"linear-gradient(135deg,#ef4444,#f97316)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:"0 4px 14px rgba(239,68,68,0.25)"}}>⏱️</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:15,color:T.navy}}>Study Timer</div>
                        <div style={{fontSize:12,color:T.muted}}>Pomodoro technique — focus in {"\u00B7"} 25 min blocks</div>
                      </div>
                    </div>
                    {!pomodoroActive&&(
                      <button onClick={()=>{setPomodoroActive(true);setPomodoroMode("work");setPomodoroSeconds(25*60);}}
                        className="btn-primary" style={{padding:"10px 20px",borderRadius:99,fontSize:13,background:"linear-gradient(135deg,#ef4444,#f97316)",boxShadow:"0 3px 14px rgba(239,68,68,0.25)"}}>
                        Start Session ▶
                      </button>
                    )}
                  </div>
                  {pomodoroActive&&(
                    <div className="fade-in" style={{textAlign:"center"}}>
                      {/* Circular Progress */}
                      <div style={{position:"relative",width:180,height:180,margin:"0 auto 16px"}}>
                        <svg width="180" height="180" viewBox="0 0 180 180" style={{transform:"rotate(-90deg)"}}>
                          <circle cx="90" cy="90" r="80" stroke={T.border} strokeWidth="8" fill="none"/>
                          <circle cx="90" cy="90" r="80" stroke={pomodoroMode==="work"?"#ef4444":pomodoroMode==="break"?"#22c55e":"#6366f1"} strokeWidth="8" fill="none"
                            strokeDasharray={2*Math.PI*80} strokeDashoffset={2*Math.PI*80*(1-pomodoroProgress/100)} strokeLinecap="round"
                            style={{transition:"stroke-dashoffset 1s linear"}}/>
                        </svg>
                        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
                          <div style={{fontSize:38,fontWeight:800,color:T.navy,fontVariantNumeric:"tabular-nums",letterSpacing:"-0.02em"}}>{formatTime(pomodoroSeconds)}</div>
                          <div style={{fontSize:12,fontWeight:700,color:pomodoroMode==="work"?"#ef4444":pomodoroMode==="break"?"#22c55e":"#6366f1",textTransform:"uppercase",letterSpacing:"0.05em",marginTop:2}}>
                            {pomodoroMode==="work"?"Focus Time":pomodoroMode==="break"?"Short Break":"Long Break"}
                          </div>
                        </div>
                      </div>
                      {/* Controls */}
                      <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:14}}>
                        {pomodoroRunning?(
                          <button onClick={pausePomodoro} style={{padding:"12px 28px",borderRadius:99,background:T.surface,border:`1.5px solid ${T.border}`,color:T.navy,fontSize:14,fontWeight:700,cursor:"pointer"}}>⏸ Pause</button>
                        ):(
                          <button onClick={startPomodoro} style={{padding:"12px 28px",borderRadius:99,border:"none",background:"linear-gradient(135deg,#ef4444,#f97316)",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 3px 14px rgba(239,68,68,0.25)"}}>▶ {pomodoroSeconds===pomodoroConfig[pomodoroMode]?"Start":"Resume"}</button>
                        )}
                        <button onClick={resetPomodoro} style={{padding:"12px 20px",borderRadius:99,border:`1.5px solid ${T.border}`,background:"transparent",color:T.muted,fontSize:13,fontWeight:600,cursor:"pointer"}}>Reset ✕</button>
                      </div>
                      {/* Session counter */}
                      <div style={{display:"flex",justifyContent:"center",gap:6,alignItems:"center"}}>
                        {[0,1,2,3].map(i=>(
                          <div key={i} style={{width:12,height:12,borderRadius:"50%",background:i<pomodoroCount%4?"#ef4444":T.border,transition:"background 0.3s"}}/>
                        ))}
                        <span style={{fontSize:12,color:T.muted,marginLeft:6}}>{pomodoroCount} session{pomodoroCount!==1?"s":""} done</span>
                      </div>
                      <div style={{marginTop:12,fontSize:11,color:T.textSoft}}>
                        25 min focus → 5 min break → repeat → long break after 4 sessions
                      </div>
                    </div>
                  )}
                </div>

                {planResult&&(
                  <div style={{background:T.surface,borderRadius:20,border:`1px solid ${T.border}`,padding:22,boxShadow:"0 2px 20px rgba(0,0,0,0.05)",marginBottom:16}} className="fade-in">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div style={{fontWeight:700,fontSize:15,color:T.navy}}>📋 Your Study Plan</div>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={savePlanAsNote}
                          style={{padding:"6px 14px",borderRadius:99,border:"none",background:T.accent,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>💾 Save as Note</button>
                        <button onClick={()=>{setPlanResult("");setPlanSubjects("");setPlanExamDates("");}}
                          style={{padding:"6px 14px",borderRadius:99,border:`1px solid ${T.border}`,background:"transparent",color:T.muted,fontSize:12,cursor:"pointer"}}>Reset</button>
                      </div>
                    </div>
                    <div className="plan-output">{planResult}</div>
                    <div style={{marginTop:18,padding:"14px 16px",borderRadius:13,background:T.accentSoft,border:`1px solid ${T.accent}22`}}>
                      <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:6}}>🤝 Find study partners for these subjects</div>
                      <div style={{fontSize:12,color:T.textSoft}}>Go to the Discover tab and filter by each subject to connect with classmates studying the same material.</div>
                      <button onClick={()=>setScreen("discover")} style={{marginTop:10,padding:"8px 16px",borderRadius:99,background:T.accent,color:"#fff",border:"none",fontSize:12,fontWeight:700,cursor:"pointer"}}>Go to Discover →</button>
                    </div>
                  </div>
                )}

                {/* ── Saved Study Plans ── */}
                {savedPlans.length>0&&(
                  <div style={{background:T.surface,borderRadius:20,border:`1px solid ${T.border}`,padding:22,boxShadow:"0 2px 20px rgba(0,0,0,0.05)"}}>
                    <div style={{fontWeight:700,fontSize:15,color:T.navy,marginBottom:14}}>📝 Saved Study Plans</div>
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {savedPlans.map(sp=>(
                        <details key={sp.id} style={{background:T.bg,borderRadius:14,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                          <summary style={{padding:"12px 16px",cursor:"pointer",fontSize:13,fontWeight:600,color:T.navy,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span>📅 {sp.subjects.slice(0,50)}{sp.subjects.length>50?"...":""}</span>
                            <span style={{fontSize:11,color:T.muted,fontWeight:500}}>{new Date(sp.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                          </summary>
                          <div style={{padding:"0 16px 14px",fontSize:13,color:T.textSoft,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{sp.plan}</div>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Minimal footer inside feature view ── */}
            <div style={{marginTop:20,textAlign:"center",padding:"10px 0"}}>
              <div style={{fontSize:11,color:T.muted,opacity:0.7}}>Bas Udrus AI · {aiVersion} · Private & secure</div>
            </div>
          </div>
        </div>
        )
      )}

      {/* ══════════════ PROFILE ══════════════ */}
      {curTab==="profile"&&(
        <div className="page-scroll">
          <div style={{maxWidth:680,margin:"0 auto",padding:"24px 20px"}}>
            <div style={{background:T.surface,borderRadius:22,padding:24,border:`1px solid ${T.border}`,marginBottom:18,boxShadow:"0 2px 20px rgba(0,0,0,0.05)"}}>
              <div className="prof-hdr" style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
                <div className="profile-avatar-wrap"><UserAvatar p={editProfile||profile} size={64} ring T={T}/></div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="prof-name" style={{fontWeight:800,fontSize:18,color:T.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:"-0.01em"}}>{profile.name||"Your Name"}</div>
                  <div style={{fontSize:13,color:T.muted,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.major||"--"} · {profile.uni||"--"}</div>
                  <div style={{fontSize:12,color:T.muted,marginTop:1,display:"flex",alignItems:"center",gap:6}}>
                    {profile.year}
                    {(profile.online??true)&&<span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,color:T.green}}><span style={{width:6,height:6,background:T.green,borderRadius:"50%",display:"inline-block"}}/>Online</span>}
                  </div>
                </div>
              </div>
              <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                <StreakBadge/>
                <div style={{flex:1,minWidth:140}}><XPBar/></div>
              </div>
              {completionPct<100&&(
                <div style={{background:T.accentSoft,borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:5}}>Profile {completionPct}% complete — full profiles get more matches ✨</div>
                    <div className="progress-track"><div className="xp-bar-fill" style={{width:"100%",transform:`scaleX(${completionPct/100})`}}/></div>
                  </div>
                </div>
              )}
              <div>
                <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Your Badges</div>
                <div className="badge-grid" style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {BADGES_DEF.map(b=>{
                    const earned=earnedBadges.includes(b.id);
                    return(
                      <div key={b.id} title={b.name+": "+b.desc} style={{background:earned?T.goldSoft:T.bg,border:`1px solid ${earned?T.gold+"44":T.border}`,borderRadius:10,padding:"5px 8px",display:"flex",alignItems:"center",gap:5,opacity:earned?1:0.4,transition:"opacity 0.2s,background-color 0.2s"}}>
                        <span style={{fontSize:14}}>{b.icon}</span>
                        <div><div style={{fontSize:10,fontWeight:700,color:T.navy}}>{b.name}</div><div style={{fontSize:9,color:T.muted}}>+{b.xp} XP</div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Quick stats row */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:18}}>
              {[
                {icon:"🤝",label:"Connections",value:connections.length},
                {icon:"📢",label:"Posts",value:helpRequests.filter(r=>r.user_id===user?.id).length},
                {icon:"📊",label:"Sessions",value:profile.sessions||0},
              ].map(s=>(
                <div key={s.label} style={{background:T.bg,borderRadius:14,padding:"12px 10px",textAlign:"center",border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
                  <div style={{fontSize:18,fontWeight:800,color:T.navy}}>{s.value}</div>
                  <div style={{fontSize:10,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{display:"flex",gap:3,marginBottom:18,background:T.bg,padding:4,borderRadius:99,width:"100%",border:`1px solid ${T.border}`,overflowX:"auto",WebkitOverflowScrolling:"touch",scrollbarWidth:"none"}}>
              {[["edit","✏️ Edit Profile"],["history","📋 My Posts"],["settings","⚙️ Settings"]].map(([tab,lbl])=>(
                <button key={tab} className={`sub-tab ${profileTab===tab?"active":""}`} style={{flex:1,whiteSpace:"nowrap"}} onClick={()=>setProfileTab(tab)}>{lbl}</button>
              ))}
            </div>

            {profileTab==="edit"&&(
              <div className="slide-in">
                {editProfile?(
                  <div className="card" style={{padding:24}}>
                    <h3 style={{fontSize:15,fontWeight:700,color:T.navy,marginBottom:18}}>Edit Your Profile</h3>
                    <div style={{marginBottom:20}}>
                      <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Profile Photo</div>
                      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
                        <UserAvatar p={editProfile||profile} size={64} ring T={T}/>
                        <div>
                          <button className="btn-primary" style={{padding:"8px 16px",fontSize:12,borderRadius:10,marginBottom:6}} onClick={()=>photoInputRef.current?.click()}>Upload Photo</button>
                          {(editProfile?.photo_mode==="photo"||profile.photo_mode==="photo")&&(
                            <button className="btn-ghost" style={{padding:"6px 12px",fontSize:11,borderRadius:8,marginLeft:8}} onClick={async()=>{
                              if(!user)return;
                              await supabase.from("profiles").update({photo_mode:"initials",photo_url:null}).eq("id",user.id);
                              setProfile(p=>({...p,photo_mode:"initials",photo_url:null}));
                              if(editProfile)setEditProfile(p=>({...p!,photo_mode:"initials",photo_url:null}));
                              showNotif("Photo removed");
                            }}>Remove</button>
                          )}
                          <div style={{fontSize:11,color:T.muted,marginTop:4}}>JPG or PNG, max 5 MB</div>
                        </div>
                      </div>
                    </div>
                    <div style={{marginBottom:20}}>
                      <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Avatar Color</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {AVATAR_COLORS.map(c=>(<div key={c} className={`color-dot ${editProfile.avatar_color===c?"sel":""}`} style={{background:c}} onClick={()=>setEditProfile(p=>({...p!,avatar_color:c}))}/>))}
                      </div>
                    </div>
                    <div className="field"><label>Full Name</label><input value={editProfile.name||""} onChange={e=>setEditProfile(p=>({...p!,name:e.target.value}))} maxLength={100}/></div>
                    <div className="field"><label>University</label>
                      <select value={editProfile.uni||""} onChange={e=>setEditProfile(p=>({...p!,uni:e.target.value}))}>
                        <option value="">Select university</option>{getUniversities().map(u=><option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="field"><label>Major</label>
                      <div ref={editMajorRef} style={{position:"relative"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,padding:"12px 14px",border:`1.5px solid ${editProfile.major?T.accent:T.border}`,borderRadius:14,fontSize:16,background:T.surface,cursor:"text"}} onClick={()=>setEditMajorOpen(true)}>
                          <span style={{fontSize:15,flexShrink:0}}>🎓</span>
                          <input type="text" placeholder={editProfile.major||"Search major..."} value={editMajorOpen?editMajorSearch:(editProfile.major||"")} onChange={e=>{setEditMajorSearch(e.target.value);setEditMajorOpen(true);}} onFocus={()=>{setEditMajorOpen(true);setEditMajorSearch("");}} style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:16,fontWeight:editProfile.major&&!editMajorOpen?600:400,color:T.text,minWidth:0,width:"100%"}}/>
                          {editProfile.major&&(<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();setEditProfile(p=>({...p!,major:""}));setEditMajorSearch("");setEditMajorOpen(false);}} style={{background:"none",border:"none",cursor:"pointer",color:T.muted,fontSize:17,padding:0,lineHeight:1,flexShrink:0}}>×</button>)}
                        </div>
                        {editMajorOpen&&(()=>{
                          const majors = editProfile.uni ? getMajorsForUni(editProfile.uni) : getAllMajors();
                          const q = editMajorSearch.toLowerCase();
                          const filtered = q ? majors.filter(m=>m.toLowerCase().includes(q)) : majors;
                          return (<div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:300,background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.13)",maxHeight:220,overflowY:"auto"}}>
                            {filtered.length===0?(<div style={{padding:"20px 14px",textAlign:"center",fontSize:13,color:T.muted}}>No majors match "{editMajorSearch}"</div>):(
                              filtered.map(m=>(<div key={m} onMouseDown={e=>{e.preventDefault();setEditProfile(p=>({...p!,major:m}));setEditMajorSearch("");setEditMajorOpen(false);}} style={{padding:"9px 14px",cursor:"pointer",fontSize:13,color:m===editProfile.major?T.accent:T.text,fontWeight:m===editProfile.major?700:400,background:m===editProfile.major?T.accentSoft:"transparent"}} onMouseEnter={e=>{if(m!==editProfile.major)(e.currentTarget as HTMLDivElement).style.background=T.border;}} onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background=m===editProfile.major?T.accentSoft:"transparent";}}>{m}</div>))
                            )}
                          </div>);
                        })()}
                      </div>
                    </div>
                    <div className="field"><label>Year</label>
                      <select value={editProfile.year||""} onChange={e=>setEditProfile(p=>({...p!,year:e.target.value}))}>
                        <option value="">Select year</option>{["Year 1","Year 2","Year 3","Year 4","Year 5"].map(y=><option key={y}>{y}</option>)}
                      </select>
                    </div>
                    <div className="field"><label>Courses (search any course — not limited to your major)</label>
                      {editCoursesList.length > 0 && (
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                          {editCoursesList.map(c => (
                            <span key={c} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:99,background:T.accentSoft,color:T.accent,fontSize:12,fontWeight:600}}>
                              {c}
                              <span style={{cursor:"pointer",fontSize:14,lineHeight:1,opacity:0.7}} onClick={() => {
                                const updated = editCoursesList.filter(x => x !== c);
                                setEditProfile(p => ({...p!, course: serializeCourses(updated)}));
                              }}>×</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div ref={editCourseDropRef} style={{position:"relative"}}>
                        <div style={{display:"flex",alignItems:"center",border:`1.5px solid ${editCourseDropOpen?T.accent:T.border}`,borderRadius:12,padding:"0 12px",background:T.bg,transition:"border-color 0.15s"}}
                          onClick={() => setEditCourseDropOpen(true)}>
                          <span style={{fontSize:14,marginRight:6,opacity:0.5}}>🔍</span>
                          <input
                            placeholder="Search any course (e.g. Calculus, Data Structures, Physics 2…)"
                            value={editCourseDropOpen ? editCourseSearch : ""}
                            onChange={e => {setEditCourseSearch(e.target.value);setEditCourseDropOpen(true);}}
                            onFocus={() => setEditCourseDropOpen(true)}
                            style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:14,padding:"11px 0",color:T.text,minWidth:0,width:"100%"}}
                          />
                          {editCourseSearch && (
                            <span style={{cursor:"pointer",fontSize:16,color:T.muted,padding:4}}
                              onMouseDown={e => {e.preventDefault();e.stopPropagation();setEditCourseSearch("");}}
                            >×</span>
                          )}
                        </div>
                        {editCourseDropOpen && (()=>{
                          // Group filtered options by category for display
                          const grouped = new Map<string, string[]>();
                          for (const {course, group} of editFilteredCourseOptions) {
                            if (!grouped.has(group)) grouped.set(group, []);
                            grouped.get(group)!.push(course);
                          }
                          const entries = Array.from(grouped.entries());
                          return (
                          <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.12)",maxHeight:260,overflowY:"auto",zIndex:50}}>
                            {entries.length === 0 ? (
                              <div style={{padding:"16px 14px",textAlign:"center",fontSize:13,color:T.muted}}>
                                {editCourseSearch ? `No courses match "${editCourseSearch}"` : "Start typing to search courses…"}
                              </div>
                            ) : (
                              entries.map(([cat, courses]) => (
                                <div key={cat}>
                                  <div style={{padding:"8px 14px 4px",fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",position:"sticky",top:0,background:T.surface,zIndex:1}}>{cat}</div>
                                  {courses.map(course => (
                                    <div
                                      key={course}
                                      onMouseDown={e => {
                                        e.preventDefault();
                                        const updated = [...editCoursesList, course];
                                        setEditProfile(p => ({...p!, course: serializeCourses(updated)}));
                                        setEditCourseSearch("");
                                      }}
                                      style={{padding:"8px 14px 8px 24px",cursor:"pointer",fontSize:13,color:T.text}}
                                      onMouseEnter={e => (e.currentTarget.style.background = T.accentSoft)}
                                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                    >
                                      {course}
                                    </div>
                                  ))}
                                </div>
                              ))
                            )}
                          </div>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="field"><label>Meet preference</label>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                        {[["online","🎥","Online"],["face","📍","Campus"],["flexible","💬","Flexible"]].map(([val,icon,lbl])=>(
                          <div key={val} className={`meet-opt ${editProfile.meet_type===val?"active":""}`} onClick={()=>setEditProfile(p=>({...p!,meet_type:val}))}>
                            <div style={{fontSize:18}}>{icon}</div><div style={{fontSize:11,fontWeight:700,marginTop:3,color:editProfile.meet_type===val?T.accent:T.textSoft}}>{lbl}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="field"><label>Bio</label><textarea rows={3} placeholder="Tell others a bit about yourself..." value={editProfile.bio||""} onChange={e=>setEditProfile(p=>({...p!,bio:e.target.value}))} maxLength={500}/></div>
                    <div style={{display:"flex",gap:10}}>
                      <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setEditProfile(null)}>Cancel</button>
                      <button className="btn-primary" disabled={profileSaveLoading} style={{flex:1,padding:13,borderRadius:14,opacity:profileSaveLoading?0.6:1}} onClick={saveProfile}>{profileSaveLoading?"Saving...":"Save Changes"}</button>
                    </div>
                  </div>
                ):(
                  <div className="card" style={{padding:24}}>
                    <h3 style={{fontSize:15,fontWeight:700,color:T.navy,marginBottom:18}}>Your Info</h3>
                    {[["Email",user?.email||"--"],["University",profile.uni||"--"],["Major",profile.major||"--"],["Year",profile.year||"--"],["Courses",parseCourses(profile.course).join(", ")||"None added"],["Meet",getMeetLabel(profile.meet_type||"flexible")]].map(([lbl,val])=>(
                      <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
                        <span style={{fontSize:13,color:T.muted,fontWeight:500}}>{lbl}</span>
                        <span style={{fontSize:13,color:T.navy,fontWeight:700}}>{val}</span>
                      </div>
                    ))}
                    {profile.bio&&<div style={{marginTop:14}}><div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Bio</div><p style={{fontSize:13,color:T.textSoft,lineHeight:1.68}}>{profile.bio}</p></div>}
                    <button className="btn-primary" style={{width:"100%",padding:12,marginTop:20,borderRadius:14}} onClick={()=>{setEditProfile({...profile});setEditCourseSearch("");setEditCourseDropOpen(false);}}>Edit Profile ✏️</button>
                  </div>
                )}
              </div>
            )}

            {profileTab==="history"&&(
              <div className="slide-in">
                {(()=>{
                  const myPosts=helpRequests.filter(r=>r.user_id===user?.id);
                  const now=Date.now();
                  const DAY=86400000;
                  const activePosts=myPosts.filter(r=>now-new Date(r.created_at).getTime()<7*DAY);
                  const pastPosts=myPosts.filter(r=>now-new Date(r.created_at).getTime()>=7*DAY);
                  return(<>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div><h3 style={{fontSize:15,fontWeight:700,color:T.navy}}>My Discover Posts</h3><p style={{fontSize:12,color:T.muted,marginTop:2}}>{myPosts.length} post{myPosts.length!==1?"s":""}</p></div>
                      <button className="btn-primary" style={{padding:"9px 16px",fontSize:13,flexShrink:0}} onClick={()=>{setScreen("discover");setShowReqModal(true);}}>+ New Post</button>
                    </div>
                    {[["active","🟢 Active Posts",activePosts],["past","📁 Past Posts",pastPosts]].map(([key,label,items])=>{
                      const list=items as HelpRequest[];
                      if(list.length===0)return null;
                      return(
                        <div key={key as string} style={{marginBottom:22}}>
                          <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>{label as string}</div>
                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            {list.map(r=>(
                              <div key={r.id} style={{background:T.surface,borderRadius:14,padding:"14px 16px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:14,opacity:key==="past"?0.65:1}}>
                                <div style={{width:42,height:42,borderRadius:12,background:key==="active"?T.greenSoft:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>
                                  {key==="active"?"📢":"📁"}
                                </div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontWeight:700,fontSize:14,color:T.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.subject}</div>
                                  <div style={{fontSize:12,color:T.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.detail}</div>
                                  <div style={{fontSize:11,color:T.muted,marginTop:4}}>{new Date(r.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {r.meet_type==="online"?"🌐 Online":r.meet_type==="in_person"?"📍 In Person":"🔄 Flexible"}</div>
                                </div>
                                {key==="active"&&(
                                  <button onClick={async()=>{
                                    if(!user)return;
                                    try{await supabase.from("notifications").delete().eq("post_id",r.id);}catch{}
                                    const{error}=await supabase.from("help_requests").delete().eq("id",r.id).eq("user_id",user.id);
                                    if(!error){setHelpRequests(prev=>prev.filter(x=>x.id!==r.id));setAllStudents(prev=>prev.filter((x:any)=>x._postId!==r.id));showNotif("Post removed");}
                                    else showNotif("Error removing post","err");
                                  }} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.muted,cursor:"pointer",flexShrink:0}}>Remove ✕</button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {myPosts.length===0&&(
                      <div style={{textAlign:"center",padding:"60px 20px"}}>
                        <div style={{fontSize:36,marginBottom:12}}>📭</div>
                        <div style={{fontWeight:600,fontSize:15,color:T.navy}}>No posts yet</div>
                        <p style={{fontSize:13,color:T.muted,marginTop:6}}>Your Discover posts will appear here</p>
                        <button className="btn-primary" style={{marginTop:16}} onClick={()=>{setScreen("discover");setShowReqModal(true);}}>Create Your First Post</button>
                      </div>
                    )}
                  </>);
                })()}
              </div>
            )}

            {profileTab==="settings"&&(
              <div className="slide-in">
                <div className="card" style={{padding:24}}>
                  {/* User summary header */}
                  <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24,padding:"18px 20px",background:`linear-gradient(135deg,${T.accentSoft},${T.surface})`,borderRadius:16,border:`1px solid ${T.border}`}}>
                    <UserAvatar p={profile} size={56} ring T={T}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:800,fontSize:17,color:T.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name||"Your Name"}</div>
                      <div style={{fontSize:13,color:T.textSoft,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.email}</div>
                      <div style={{fontSize:12,color:T.muted,marginTop:2}}>{profile.uni} · {profile.year}</div>
                    </div>
                  </div>

                  {/* Appearance */}
                  <div style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Appearance</div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 18px",background:T.surface,borderRadius:14,border:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:14}}>
                        <div style={{width:44,height:44,borderRadius:14,background:darkMode?T.navy:T.goldSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,border:`1px solid ${T.border}`}}>{darkMode?"🌙":"☀️"}</div>
                        <div>
                          <div style={{fontWeight:700,fontSize:14,color:T.navy}}>{darkMode?"Dark Mode":"Light Mode"}</div>
                          <div style={{fontSize:12,color:T.muted,marginTop:2}}>{darkMode?"Easy on the eyes at night":"Clean and bright"}</div>
                        </div>
                      </div>
                      <div onClick={()=>setDarkMode(d=>!d)} role="switch" aria-checked={darkMode} aria-label="Toggle dark mode" style={{width:52,height:28,borderRadius:99,background:darkMode?T.accent:T.border,cursor:"pointer",position:"relative",transition:"background-color 0.3s",flexShrink:0}}>
                        <div style={{position:"absolute",top:3,left:darkMode?26:3,width:22,height:22,borderRadius:"50%",background:"#fff",boxShadow:"0 2px 6px rgba(0,0,0,0.2)",transition:"left 0.25s cubic-bezier(0.4,0,0.2,1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>{darkMode?"🌙":"☀️"}</div>
                      </div>
                    </div>
                  </div>

                  {/* Notifications preference */}
                  <div style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Notifications</div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",background:T.surface,borderRadius:14,border:`1px solid ${T.border}`,marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:14}}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🔔</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Push Notifications</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>Get notified about matches & messages</div></div>
                      </div>
                      <span style={{fontSize:12,color:T.green,fontWeight:700}}>On</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",background:T.surface,borderRadius:14,border:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:14}}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>📧</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Email Notifications</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>Receive emails for new matches</div></div>
                      </div>
                      <span style={{fontSize:12,color:T.green,fontWeight:700}}>On</span>
                    </div>
                  </div>

                  {/* Privacy */}
                  <div style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Privacy</div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",background:T.surface,borderRadius:14,border:`1px solid ${T.border}`,marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:14}}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.greenSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🟢</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Online Status</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>Show others when you're online</div></div>
                      </div>
                      <div onClick={async()=>{
                        const newStatus=!(profile.online??true);
                        setProfile(p=>({...p,online:newStatus}));
                        if(user)await supabase.from("profiles").update({online:newStatus}).eq("id",user.id);
                        showNotif(newStatus?"You appear online now":"You appear offline now");
                      }} role="switch" aria-checked={profile.online??true} style={{width:52,height:28,borderRadius:99,background:(profile.online??true)?T.green:T.border,cursor:"pointer",position:"relative",transition:"background-color 0.3s",flexShrink:0}}>
                        <div style={{position:"absolute",top:3,left:(profile.online??true)?26:3,width:22,height:22,borderRadius:"50%",background:"#fff",boxShadow:"0 2px 6px rgba(0,0,0,0.2)",transition:"left 0.25s cubic-bezier(0.4,0,0.2,1)"}}/>
                      </div>
                    </div>
                  </div>

                  {/* Account */}
                  <div style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Account</div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      <button className="btn-ghost" style={{width:"100%",textAlign:"left",padding:"14px 18px",borderRadius:14,display:"flex",alignItems:"center",gap:12}} onClick={()=>{const newEmail=prompt("Enter your new email address:");if(newEmail&&newEmail.trim()){supabase.auth.updateUser({email:newEmail.trim()}).then(({error})=>{if(error)showNotif("Error: "+error.message,"err");else showNotif("Confirmation email sent to "+newEmail.trim());});}}}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>📧</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Change Email</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>Update your email address</div></div>
                      </button>
                      <button className="btn-ghost" style={{width:"100%",textAlign:"left",padding:"14px 18px",borderRadius:14,display:"flex",alignItems:"center",gap:12}} onClick={()=>{setPasswordModal(true);setNewPassword("");}}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🔑</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Change Password</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>Set a new secure password</div></div>
                      </button>
                      <button className="btn-ghost" style={{width:"100%",textAlign:"left",padding:"14px 18px",borderRadius:14,display:"flex",alignItems:"center",gap:12}} onClick={()=>{if(user?.email){supabase.auth.resetPasswordForEmail(user.email).then(({error})=>{if(error)showNotif("Error: "+error.message,"err");else showNotif("Reset email sent to "+user.email);});}}}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.accentSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🔄</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Reset Password</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>Receive a reset link via email</div></div>
                      </button>
                    </div>
                  </div>

                  {/* Support & Feedback */}
                  <div style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Support</div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      <a href="mailto:basudrusjo@gmail.com" style={{textDecoration:"none",display:"flex",alignItems:"center",gap:12,padding:"14px 18px",borderRadius:14,border:`1.5px solid ${T.border}`,background:"transparent",transition:"border-color 0.2s"}}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.greenSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>💬</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Contact Us</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>basudrusjo@gmail.com</div></div>
                      </a>
                      <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",borderRadius:14,border:`1.5px solid ${T.border}`,cursor:"pointer"}} onClick={()=>showNotif("Thank you! We'd love to hear from you — email us at basudrusjo@gmail.com")}>
                        <span style={{width:40,height:40,borderRadius:12,background:T.goldSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>⭐</span>
                        <div><div style={{fontWeight:600,fontSize:13,color:T.navy}}>Send Feedback</div><div style={{fontSize:11,color:T.muted,marginTop:2}}>Help us improve Bas Udrus</div></div>
                      </div>
                    </div>
                  </div>

                  {/* Sign Out — at the very bottom */}
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Session</div>
                    <button className="btn-danger" style={{width:"100%",padding:"14px 18px",borderRadius:14,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}} onClick={handleSignOut}>
                      <span>🚪</span> Sign Out
                    </button>
                  </div>

                  {/* App info */}
                  <div style={{marginTop:24,textAlign:"center",padding:"16px 0",borderTop:`1px solid ${T.border}`}}>
                    <div style={{fontSize:12,color:T.muted,fontWeight:600}}>Bas Udrus v1.0</div>
                    <div style={{fontSize:11,color:T.muted,marginTop:4}}>Made with ❤️ in Amman, Jordan</div>
                    <div style={{fontSize:10,color:T.muted,marginTop:6,opacity:0.6}}>© 2024-2026 Bas Udrus. All rights reserved.</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ══════════════ ADMIN DASHBOARD ══════════════ */}
      {curTab==="admin"&&isAdmin&&(
        <AdminScreen T={T} darkMode={darkMode} adminTab={adminTab} setAdminTab={setAdminTab}
          adminReports={adminReports} adminPosts={adminPosts} adminAnalytics={adminAnalytics}
          adminDeletePost={adminDeletePost} setViewingProfile={setViewingProfile} initials={initials} />
      )}

    </div>
  );
}
