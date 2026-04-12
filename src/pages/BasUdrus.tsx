import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import type { Profile, Connection, Message, HelpRequest, GroupRoom, SubjectHistory, Report, Notification } from "@/lib/supabase";
import { getMemory, saveMemory, getStats, incrementStats, getTokenTier, formatMemoryForPrompt, saveTrendingTopic, clearAllMemory } from "@/lib/ai-memory";
import { COURSE_CATEGORIES, ALL_COURSES, getCategoryForCourse } from "@/lib/courses";

const ADMIN_EMAIL = "ahm20250898@std.psut.edu.jo";

import {
  AVATAR_COLORS, BADGES_DEF, getMeetIcon, getMeetLabel,
  statusColor, LIGHT, DARK, type Theme
} from "@/lib/constants";
// ─── MARKDOWN RENDERER ──────────────────────────────────────────────────────
function renderMarkdown(text: string) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ul"|"ol"|null = null;
  let keyIdx = 0;

  function flushList() {
    if (listItems.length === 0) return;
    const Tag = listType === "ol" ? "ol" : "ul";
    elements.push(
      <Tag key={keyIdx++} style={{margin:"6px 0",paddingLeft:22,lineHeight:1.75}}>
        {listItems.map((li,i) => <li key={i} style={{marginBottom:2}}>{inlineFormat(li)}</li>)}
      </Tag>
    );
    listItems = [];
    listType = null;
  }

  function inlineFormat(s: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    // Process inline: bold, italic, code, links
    const regex = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*|_(.+?)_)/g;
    let last = 0;
    let match;
    let pKey = 0;
    while ((match = regex.exec(s)) !== null) {
      if (match.index > last) parts.push(s.slice(last, match.index));
      if (match[2] || match[3]) {
        parts.push(<strong key={pKey++}>{match[2] || match[3]}</strong>);
      } else if (match[4]) {
        parts.push(<code key={pKey++} style={{background:"rgba(0,0,0,0.06)",padding:"1px 5px",borderRadius:4,fontSize:"0.9em",fontFamily:"monospace"}}>{match[4]}</code>);
      } else if (match[5] || match[6]) {
        parts.push(<em key={pKey++}>{match[5] || match[6]}</em>);
      }
      last = match.index + match[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { flushList(); elements.push(<div key={keyIdx++} style={{fontWeight:700,fontSize:15,marginTop:10,marginBottom:4}}>{inlineFormat(h3[1])}</div>); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { flushList(); elements.push(<div key={keyIdx++} style={{fontWeight:800,fontSize:16,marginTop:12,marginBottom:4}}>{inlineFormat(h2[1])}</div>); continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { flushList(); elements.push(<div key={keyIdx++} style={{fontWeight:800,fontSize:17,marginTop:14,marginBottom:6}}>{inlineFormat(h1[1])}</div>); continue; }

    // Horizontal rule
    if (/^[-━─═]{3,}$/.test(line.trim())) { flushList(); elements.push(<hr key={keyIdx++} style={{border:"none",borderTop:"1px solid rgba(0,0,0,0.1)",margin:"8px 0"}}/>); continue; }

    // Unordered list
    const ul = line.match(/^\s*[-•*]\s+(.+)/);
    if (ul) { if (listType === "ol") flushList(); listType = "ul"; listItems.push(ul[1]); continue; }

    // Ordered list
    const ol = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (ol) { if (listType === "ul") flushList(); listType = "ol"; listItems.push(ol[1]); continue; }

    // Empty line
    if (line.trim() === "") { flushList(); elements.push(<div key={keyIdx++} style={{height:6}}/>); continue; }

    // Regular paragraph
    flushList();
    elements.push(<div key={keyIdx++} style={{marginBottom:2}}>{inlineFormat(line)}</div>);
  }
  flushList();
  return <>{elements}</>;
}

// ─── ERROR LOGGING (production-safe) ────────────────────────────────────────
function logError(context: string, error: unknown) {
  if (import.meta.env.DEV) {
    const msg = error instanceof Error ? error.message : typeof error === "object" && error !== null ? JSON.stringify(error).slice(0, 200) : String(error);
    console.error(`[BasUdrus:${context}] ${msg}`);
  }
}

// ─── PERFORMANCE UTILS ──────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ─── DATA (fetched from Supabase) ───────────────────────────────────────────
type UniRow = { id: string; name: string; short_name: string; full_name: string; display_order: number };
type MajorRow = { id: string; university_id: string; name: string; display_order: number };
type CourseRow = { id: string; major_id: string; name: string; display_order: number };

// Loaded at runtime; fallback to empty while loading
let _uniList: UniRow[] = [];
let _majorList: MajorRow[] = [];
let _courseList: CourseRow[] = [];
let _uniDataReady = false;

async function loadUniData() {
  const [uRes, mRes, cRes] = await Promise.all([
    supabase.from("universities").select("*").order("display_order"),
    supabase.from("uni_majors").select("*").order("display_order"),
    supabase.from("uni_courses").select("*").order("display_order"),
  ]);
  _uniList = (uRes.data || []) as UniRow[];
  _majorList = (mRes.data || []) as MajorRow[];
  _courseList = (cRes.data || []) as CourseRow[];
  _uniDataReady = true;
}

function getUniversities(): string[] {
  return _uniList.map(u => u.name);
}

function getAllMajors(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of _majorList) {
    if (!seen.has(m.name)) { seen.add(m.name); result.push(m.name); }
  }
  result.push("Other");
  return result;
}

function getMajorsForUni(uniFilter: string): string[] {
  if (!uniFilter) return getAllMajors();
  const uni = _uniList.find(u => u.name === uniFilter);
  if (!uni) return getAllMajors();
  return _majorList.filter(m => m.university_id === uni.id).map(m => m.name);
}

/**
 * Returns ALL courses grouped by category — global, NOT tied to major.
 * Merges DB courses with the comprehensive hardcoded fallback list.
 * Optional categoryFilter narrows to one category (for optional filtering, not enforced).
 */
function getCourseGroups(_uniFilter?: string, _majorFilter?: string, categoryFilter?: string): [string, string[]][] {
  // Start with the comprehensive global list
  const merged: Record<string, Set<string>> = {};
  for (const [cat, courses] of Object.entries(COURSE_CATEGORIES)) {
    merged[cat] = new Set(courses);
  }
  // Add any DB courses that aren't in the hardcoded list
  for (const c of _courseList) {
    const cat = getCategoryForCourse(c.name);
    if (!merged[cat]) merged[cat] = new Set();
    merged[cat].add(c.name);
  }
  // Build result
  const result: [string, string[]][] = [];
  for (const [cat, courseSet] of Object.entries(merged)) {
    if (categoryFilter && cat !== categoryFilter) continue;
    const sorted = Array.from(courseSet).sort((a, b) => a.localeCompare(b));
    if (sorted.length > 0) result.push([cat, sorted]);
  }
  // Sort categories alphabetically
  result.sort((a, b) => a[0].localeCompare(b[0]));
  return result;
}

function getUniCards(): {uni: string; full: string; emoji: string}[] {
  const emojis: Record<string, string> = {
    "PSUT": "🏛️", "UJ": "🎓", "GJU": "🌍", "AAU": "🏫", "ASU": "📘", "MEU": "🎯", "AUM": "🌿"
  };
  return _uniList.map(u => ({ uni: u.short_name, full: u.full_name, emoji: emojis[u.short_name] || "🏫" }));
}


// Constants imported from @/lib/constants

const makeCSS = (T: Theme) => `
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; -webkit-text-size-adjust:100%; text-size-adjust:100%; touch-action:manipulation; }
  body { font-family:'Plus Jakarta Sans',sans-serif; background:${T.bg}; color:${T.text}; -webkit-font-smoothing:antialiased; transition:background-color 0.3s,color 0.3s; overflow-x:hidden; touch-action:manipulation; }
  /* Kill iOS auto-zoom on input focus — forces all inputs to 16px minimum on mobile */
  @media (max-width: 768px) {
    input, textarea, select { font-size:16px !important; }
  }
  /* Disable double-tap-to-zoom everywhere */
  * { touch-action:manipulation; }
  /* Performance: GPU compositing for animated elements */
  .s-card,.card,.request-card,.modal,.notif { will-change:auto; contain:layout style; }
  /* Prevent iOS zoom on input focus */
  @supports(-webkit-touch-callout:none){ input,select,textarea { font-size:max(16px,1em); } }
  input,select,textarea,button { font-family:'Plus Jakarta Sans',sans-serif; }
  input:focus,select:focus,textarea:focus { outline:none; border-color:${T.accent}!important; box-shadow:0 0 0 3px ${T.accentSoft}!important; }
  ::-webkit-scrollbar { width:4px; height:4px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:99px; }
  .scroll-col { display:flex; flex-direction:column; gap:16px; overflow-y:auto; overflow-x:hidden; padding:8px 16px 120px; scroll-snap-type:y mandatory; -webkit-overflow-scrolling:touch; cursor:grab; flex:1; min-height:0; }
  .scroll-col:active { cursor:grabbing; }
  .page-scroll { overflow-y:auto; height:calc(100dvh - 62px); }
  .s-card { flex:0 0 auto; width:100%; max-width:500px; margin:0 auto; scroll-snap-align:start; background:${T.surface}; border-radius:22px; border:1px solid ${T.border}; box-shadow:0 8px 24px rgba(0,0,0,0.06); overflow:hidden; transition:all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
  .s-card:hover { box-shadow:0 22px 50px rgba(0,0,0,0.12); transform: translateY(-6px) scale(1.02); border:1px solid ${T.accent}44; }
  @keyframes flyUp    { to { transform:translateY(-130%) scale(0.85); opacity:0; } }
  @keyframes flyDown  { to { transform:translateY(130%) scale(0.85); opacity:0; } }
  @keyframes fadeIn   { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  @keyframes slideIn  { from { opacity:0; transform:translateX(24px); } to { opacity:1; transform:translateX(0); } }
  @keyframes popIn    { from { opacity:0; transform:scale(0.93); } to { opacity:1; transform:scale(1); } }
  @keyframes shimmer  { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
  @keyframes pulse    { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
  @keyframes orbFloat { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-8px) scale(1.03)} }
  @keyframes bounceIn { 0%{transform:scale(0.3);opacity:0} 60%{transform:scale(1.05)} 100%{transform:scale(1);opacity:1} }
  .fly-up   { animation:flyUp   0.35s cubic-bezier(0.4,0,0.2,1) forwards; will-change:transform,opacity; }
  .fly-down { animation:flyDown 0.3s cubic-bezier(0.4,0,0.2,1) forwards; will-change:transform,opacity; }
  .fade-in  { animation:fadeIn  0.4s ease forwards; will-change:transform,opacity; }
  .slide-in { animation:slideIn 0.32s ease forwards; will-change:transform,opacity; }
  .pop-in   { animation:popIn   0.28s ease forwards; will-change:transform,opacity; }
  .bounce-in{ animation:bounceIn 0.45s cubic-bezier(0.175,0.885,0.32,1.275) forwards; will-change:transform,opacity; }
  .pulse    { animation:pulse 1.6s ease-in-out infinite; will-change:transform; }
  .btn-primary { background:${T.navy}; color:${T.bg}; border:none; padding:13px 28px; border-radius:99px; font-size:15px; font-weight:600; cursor:pointer; transition:all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); letter-spacing:0.01em; box-shadow: 0 6px 16px rgba(15,27,45,0.15); border-bottom: 2px solid rgba(0,0,0,0.15); }
  .btn-primary:hover { background:${T.navyLight}; transform:translateY(-3px); box-shadow:0 12px 28px rgba(15,27,45,0.25); border-bottom-width: 4px; }
  .btn-primary:active { transform:translateY(1px); border-bottom-width: 0px; box-shadow:0 4px 10px rgba(15,27,45,0.1); }
  .btn-accent  { background:${T.accent}; color:#fff; border:none; padding:13px 28px; border-radius:99px; font-size:15px; font-weight:600; cursor:pointer; transition:all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); box-shadow: 0 6px 16px rgba(74,124,247,0.2); border-bottom: 2px solid rgba(0,0,0,0.1); }
  .btn-accent:hover  { filter:brightness(1.1); transform:translateY(-3px); box-shadow:0 12px 30px rgba(74,124,247,0.35); border-bottom-width: 4px; }
  .btn-ghost   { background:transparent; color:${T.textSoft}; border:1.5px solid ${T.border}; padding:11px 24px; border-radius:99px; font-size:15px; font-weight:500; cursor:pointer; transition:border-color 0.2s,color 0.2s,background-color 0.2s; }
  .btn-ghost:hover { border-color:${T.accent}; color:${T.accent}; background:${T.accentSoft}; }
  .btn-danger  { background:${T.redSoft}; color:${T.red}; border:1.5px solid transparent; padding:12px 20px; border-radius:99px; font-size:14px; font-weight:700; cursor:pointer; transition:border-color 0.2s,transform 0.2s; }
  .btn-danger:hover { border-color:${T.red}; transform:scale(1.02); }
  .btn-success { background:${T.greenSoft}; color:${T.green}; border:1.5px solid transparent; padding:12px 20px; border-radius:99px; font-size:14px; font-weight:700; cursor:pointer; transition:border-color 0.2s,transform 0.2s; }
  .btn-success:hover { border-color:${T.green}; transform:scale(1.02); }
  .field { margin-bottom:18px; }
  .field label { display:block; font-size:12px; font-weight:700; color:${T.muted}; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px; }
  .field input,.field select,.field textarea { width:100%; padding:13px 16px; border:1.5px solid ${T.border}; border-radius:13px; font-size:15px; color:${T.text}; background:${T.surface}; transition:border-color 0.2s,box-shadow 0.2s; }
  .field textarea { resize:none; }
  .tab-nav { display:flex; gap:2px; background:${T.bg}; padding:4px; border-radius:99px; border:1px solid ${T.border}; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
  .tab-nav::-webkit-scrollbar { display:none; }
  .tab-btn { padding:9px 14px; border-radius:99px; cursor:pointer; font-size:13px; font-weight:600; border:none; background:transparent; color:${T.muted}; transition:background-color 0.2s,color 0.2s,box-shadow 0.2s; white-space:nowrap; flex-shrink:0; }
  .tab-btn.active { background:${T.navy}; color:${T.bg}; box-shadow:0 2px 10px rgba(15,27,45,0.2); }
  .sub-tab { padding:9px 18px; border-radius:99px; cursor:pointer; font-size:13px; font-weight:600; border:none; background:transparent; color:${T.muted}; transition:background-color 0.2s,color 0.2s; white-space:nowrap; }
  .sub-tab.active { background:${T.accentSoft}; color:${T.accent}; }
  .msg-mine   { background:${T.accent}; color:#fff; border-bottom-right-radius:4px; }
  .msg-theirs { background:${T.surface}; color:${T.text}; border:1px solid ${T.border}; border-bottom-left-radius:4px; }
  .conn-row { padding:10px 12px; border-radius:13px; cursor:pointer; transition:background-color 0.15s; display:flex; align-items:center; gap:10px; }
  .conn-row:hover,.conn-row.active { background:${T.accentSoft}; }
  .meet-opt { border:1.5px solid ${T.border}; border-radius:13px; padding:14px 8px; cursor:pointer; text-align:center; transition:border-color 0.2s,background-color 0.2s; background:${T.surface}; }
  .meet-opt:hover { border-color:${T.accent}; }
  .meet-opt.active { border-color:${T.accent}; background:${T.accentSoft}; }
  .color-dot { width:28px; height:28px; border-radius:50%; cursor:pointer; border:2.5px solid transparent; transition:border-color 0.15s,transform 0.15s; }
  .color-dot:hover,.color-dot.sel { border-color:${T.text}; transform:scale(1.18); }
  .card { background:${T.surface}; border-radius:18px; border:1px solid ${T.border}; box-shadow: 0 4px 16px rgba(0,0,0,0.04); transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
  .card:hover { box-shadow:0 16px 40px rgba(0,0,0,0.08); transform:translateY(-4px) scale(1.01); }
  .request-card { background:${T.surface}; border-radius:16px; padding:18px; border:1px solid ${T.border}; box-shadow: 0 4px 14px rgba(0,0,0,0.03); transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
  .request-card:hover { box-shadow:0 12px 32px rgba(0,0,0,0.08); transform:translateY(-3px) scale(1.01); }
  .streak-badge { display:inline-flex; align-items:center; gap:5px; background:linear-gradient(135deg,#C44D1A,#B07D00); color:#fff; padding:5px 12px; border-radius:99px; font-size:12px; font-weight:700; }
  .ai-msg { padding:16px 20px; border-radius:24px; font-size:15px; line-height:1.6; max-width:85%; animation:fadeIn 0.3s ease; word-break:break-word; border:1px solid rgba(255,255,255,0.4); box-shadow: 0 4px 16px rgba(0,0,0,0.03); }
  .ai-msg b { font-weight:700; }
  .msg-mine, .ai-msg.user { background: linear-gradient(135deg, ${T.accent}, #6C8EF5); color: #fff; border-bottom-right-radius: 6px; border:none; box-shadow: 0 6px 20px rgba(74, 124, 247, 0.25); }
  .msg-theirs, .ai-msg.assistant { background: linear-gradient(135deg, ${T.surface}, ${T.bg}); color: ${T.text}; border-bottom-left-radius: 6px; }
  .match-score-high { background:linear-gradient(135deg,#0E7E5A,#0A6B4C); color:#fff; }
  .match-score-mid { background:linear-gradient(135deg,#B07D00,#9B6E00); color:#fff; }
  .match-score-low { background:linear-gradient(135deg,#6B7280,#596673); color:#fff; }
  .plan-output { white-space:pre-wrap; font-size:14px; line-height:1.85; color:${T.text}; }
  /* Psychology UX: focus-visible ring for keyboard users (accessibility) */
  button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible { outline:2.5px solid ${T.accent}; outline-offset:2px; }
  /* Reduce motion for users who prefer it */
  @media(prefers-reduced-motion:reduce){ *,*::before,*::after { animation-duration:0.01ms!important; transition-duration:0.01ms!important; } }
  /* Nav glassmorphism */
  .nav-inner { backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
  /* Living AI: orbPulse + aiTyping */
  @keyframes orbPulse {
    0%,100% { transform:scale(1); box-shadow:0 0 50px rgba(251,146,60,0.18),0 0 100px rgba(168,85,247,0.1),0 8px 32px rgba(139,92,246,0.15); }
    50%     { transform:scale(1.08); box-shadow:0 0 70px rgba(251,146,60,0.28),0 0 120px rgba(168,85,247,0.18),0 12px 40px rgba(139,92,246,0.22); }
  }
  @keyframes aiTyping {
    0%,80%,100% { opacity:0.3; transform:scale(0.85); }
    40%         { opacity:1;   transform:scale(1); }
  }
  /* Mesh glow (Siri-style orbit) */
  @keyframes orbit {
    0% { transform: rotate(0deg) translateX(30px) rotate(0deg); }
    100% { transform: rotate(360deg) translateX(30px) rotate(-360deg); }
  }
  .mesh-glow {
    position: absolute;
    top: -20%; left: -10%; right: -10%; bottom: -20%;
    background: radial-gradient(circle at 30% 50%, rgba(74, 124, 247, 0.08), transparent 50%),
                radial-gradient(circle at 70% 30%, rgba(67, 197, 158, 0.08), transparent 50%);
    filter: blur(60px);
    z-index: 0;
    pointer-events: none;
    animation: orbit 15s linear infinite;
  }
  /* Bento Box grid for Features */
  .bento-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }
  @media(min-width: 600px) {
    .bento-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media(min-width: 800px) {
    .bento-grid { grid-template-columns: repeat(3, 1fr); }
    .landing-feat:nth-child(1) { grid-column: span 2; grid-row: span 2; padding: 40px; }
    .landing-feat:nth-child(1) .landing-feat-icon { font-size: 52px; margin-bottom: 24px; }
    .landing-feat:nth-child(1) h3 { font-size: 26px; }
    .landing-feat:nth-child(1) p { font-size: 15px; }
    .landing-feat:nth-child(2) { grid-column: span 1; }
    .landing-feat:nth-child(4) { grid-column: span 2; }
  }
  /* Smooth page transitions */
  .page-scroll > div { animation:fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
  /* Better touch targets (Fitts' law — minimum 44px) */
  details summary { min-height:44px; display:flex; align-items:center; }
  details summary::-webkit-details-marker { display:none; }
  details summary::before { content:"▸"; margin-right:8px; transition:transform 0.2s; font-size:12px; color:${T.muted}; }
  details[open] summary::before { transform:rotate(90deg); }
  .xp-bar-fill { background:linear-gradient(90deg,${T.accent},#6C8EF5); height:100%; border-radius:99px; transition:transform 0.8s cubic-bezier(0.4,0,0.2,1); transform-origin:left; will-change:transform; }
  .star { font-size:18px; cursor:pointer; transition:transform 0.1s; }
  .star:hover { transform:scale(1.2); }
  .notif { position:fixed; top:20px; left:50%; transform:translateX(-50%); padding:13px 26px; border-radius:99px; font-size:14px; font-weight:600; z-index:9999; white-space:nowrap; box-shadow:0 6px 30px rgba(0,0,0,0.18); animation:popIn 0.28s ease; }
  .modal-bg { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:300; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(4px); animation:fadeIn 0.2s ease; }
  .modal { background:${T.surface}; border-radius:24px; padding:28px; width:100%; max-width:460px; box-shadow:0 24px 80px rgba(0,0,0,0.25); animation:popIn 0.28s ease; max-height:92dvh; overflow-y:auto; border:1px solid ${T.border}; }
  .progress-track { background:${T.border}; border-radius:99px; height:6px; overflow:hidden; }
  /* Bottom tab bar — hidden on desktop, shown on mobile */
  .bot-nav { display:none; position:fixed; bottom:0; left:0; right:0; background:${T.navBg}; border-top:1.5px solid ${T.border}; z-index:200; padding:6px 0 calc(6px + env(safe-area-inset-bottom,0px)); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
  .bot-tab { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:6px 2px; background:none; border:none; cursor:pointer; font-size:10px; font-weight:600; color:${T.muted}; transition:color 0.15s; line-height:1; }
  .bot-tab .bi { font-size:22px; line-height:1; display:block; }
  .bot-tab.active { color:${T.accent}; }
  .bot-tab.active .bi { filter:drop-shadow(0 0 6px ${T.accent}44); }
  @media(min-width:621px){
    .top-tabs { display:flex!important; }
    .bot-nav  { display:none!important; }
  }
  @media(max-width:620px){
    .bot-nav  { display:none!important; }
    .top-tabs { display:flex!important; order:3!important; flex-basis:100%!important; overflow-x:auto!important; scrollbar-width:none!important; -webkit-overflow-scrolling:touch!important; gap:2px!important; margin:8px 0 -4px!important; padding:4px!important; background:${T.bg}!important; border:1px solid ${T.border}!important; border-radius:14px!important; box-shadow:0 1px 6px rgba(0,0,0,0.04)!important; }
    .top-tabs::-webkit-scrollbar { display:none; }
    .top-tabs .tab-btn { font-size:13px!important; padding:9px 14px!important; white-space:nowrap!important; flex-shrink:0!important; flex:none!important; justify-content:center!important; border-radius:10px!important; font-weight:600!important; }
    .top-tabs .tab-icon { display:none!important; }
    .hide-mob { display:none!important; }
    .nav-inner{ padding:8px 12px!important; flex-wrap:wrap!important; backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
    .hero-section{ padding:52px 20px 36px!important; }
    .page-scroll { height:calc(100dvh - 52px); padding-bottom:16px; }
    .chat-wrap{ flex-direction:column!important; height:calc(100dvh - 52px)!important; }
    .chat-sidebar{ width:100%!important; max-height:110px!important; flex-direction:row!important; overflow-x:auto!important; overflow-y:hidden!important; border-right:none!important; border-bottom:1.5px solid ${T.border}!important; padding:6px 8px!important; min-height:unset!important; }
    .chat-sidebar > div:first-child { display:none!important; }
    .chat-sidebar > div:nth-child(2) { flex-direction:row!important; overflow-x:auto!important; gap:4px!important; padding:4px!important; }
    .chat-sidebar-empty { display:none!important; height:0!important; border:none!important; padding:0!important; overflow:hidden!important; }
    .conn-row-mini{ min-width:64px; flex-direction:column; gap:2px; padding:6px 4px!important; font-size:11px!important; }
    .conn-row-mini > div { display:none!important; }
    .chat-header-actions { flex-wrap:wrap!important; gap:4px!important; }
    .chat-header-actions button { padding:5px 10px!important; font-size:11px!important; }
    .chat-msg-input { padding:8px 12px!important; }
    .chat-msg-input input { padding:10px 14px!important; font-size:16px!important; }
    .chat-msg-input button { padding:10px 16px!important; font-size:12px!important; }
    .chat-partner-cards { grid-template-columns:1fr!important; gap:8px!important; padding:12px!important; }
    .conn-course-hide{ display:none; }
    /* ── Discover page ── */
    .dis-page  { height:calc(100dvh - 52px)!important; padding-top:0!important; }
    .dis-header{ padding:8px 12px 4px!important; }
    .dis-header h2 { font-size:15px!important; margin-bottom:1px!important; }
    .dis-header p  { display:none!important; }
    /* Filter: 2-column wrap — uni+major on row 1, course full-width on row 2, meet type full-width on row 3 */
    .dis-filter-row{ display:flex!important; flex-wrap:wrap!important; overflow-x:unset!important; gap:6px!important; padding-bottom:0!important; }
    .dis-filter-sel{ flex:0 0 calc(50% - 3px)!important; min-width:0!important; max-width:none!important; padding:9px 10px!important; font-size:12px!important; border-radius:11px!important; }
    /* Course search box + meet type + clear button span full width */
    .dis-course-box { flex:0 0 100%!important; }
    .dis-filter-meet { flex:0 0 100%!important; }
    .dis-clear-btn { flex:0 0 100%!important; }
    .dis-count { padding:0 12px 2px!important; flex-shrink:0; }
    .scroll-col{ min-height:0!important; padding:4px 10px 20px!important; gap:10px!important; }
    /* ── Student card ── */
    .s-card    { border-radius:16px!important; }
    .dis-card-hdr{ padding:14px 14px 10px!important; }
    .dis-card-body{ padding:10px 14px!important; }
    .dis-card-btns{ padding:0 12px 12px!important; gap:8px!important; }
    /* Avatar: slightly smaller */
    .dis-avatar { width:50px!important; height:50px!important; flex-shrink:0!important; }
    /* Name / uni / major text */
    .dis-name  { font-size:15px!important; }
    .dis-uni   { font-size:11px!important; margin-top:2px!important; }
    .dis-major { font-size:11px!important; margin-top:1px!important; }
    /* Online badge */
    .dis-online{ font-size:11px!important; }
    .dis-sessions{ font-size:10px!important; }
    /* Meet-type pill + rating */
    .dis-meet-pill { padding:4px 10px!important; font-size:11px!important; }
    /* Course chips */
    .dis-card-body > div:first-child { gap:5px!important; flex-wrap:wrap!important; }
    .dis-chip { padding:4px 10px!important; font-size:11px!important; }
    /* Bio text */
    .dis-bio { font-size:13px!important; line-height:1.55!important; margin-bottom:10px!important; }
    /* Action buttons */
    .dis-card-btns .btn-danger  { font-size:13px!important; padding:11px 0!important; }
    .dis-card-btns .btn-success { font-size:13px!important; padding:11px 0!important; }
    .fab-post  { bottom:82px!important; right:14px!important; width:50px!important; height:50px!important; border-radius:50%!important; font-size:22px!important; padding:0!important; }
    .sub-tab   { padding:9px 14px!important; font-size:13px!important; }
    .modal     { padding:22px 18px; border-radius:20px; }
    .btn-primary,.btn-ghost,.btn-accent { font-size:13px!important; padding:11px 20px!important; }
    .field label { font-size:11px!important; }
    .field input,.field select,.field textarea { font-size:16px!important; padding:11px 13px!important; }
    .admin-kpi { grid-template-columns:repeat(2,1fr)!important; }
    .admin-grid2 { grid-template-columns:1fr!important; }

    /* ── AI Hub mobile ── */
    .page-scroll>div { padding:16px 14px!important; }
    .page-scroll h2 { font-size:16px!important; }
    .page-scroll h3 { font-size:14px!important; }

    /* ── Profile page mobile ── */
    .profile-avatar-wrap { width:72px!important; height:72px!important; }
    .profile-avatar-wrap>div,.profile-avatar-wrap>img { width:72px!important; height:72px!important; font-size:26px!important; }

    /* ── Rooms mobile ── */
    .request-card { padding:14px!important; }
    .request-card h3 { font-size:14px!important; }

    /* ── Connect/Chat mobile ── */
    .chat-sidebar .conn-row { padding:8px 10px!important; }

    /* ── Bottom nav icons ── */
    .bot-tab .bi { font-size:22px!important; }
    .bot-tab { font-size:9px!important; gap:2px!important; padding:6px 4px 4px!important; }

    /* ── AI Hub sub-tabs — scroll instead of wrap ── */
    .ai-tab-row { flex-wrap:nowrap!important; scrollbar-width:none!important; overflow-x:auto!important; -webkit-overflow-scrolling:touch!important; padding:5px!important; }
    .ai-tab-row::-webkit-scrollbar { display:none; }
    .ai-tab-row .sub-tab { padding:10px 14px!important; font-size:13px!important; white-space:nowrap!important; flex-shrink:0!important; font-weight:600!important; }

    /* ── AI / Wellbeing / Tutor card headers ── */
    .page-scroll [style*="borderRadius:20"] { border-radius:16px!important; }
    .page-scroll [style*="padding:22"] { padding:16px!important; }
    .page-scroll [style*="padding:24"] { padding:16px!important; }

    /* ── Profile card on mobile ── */
    .prof-hdr { gap:10px!important; }
    .prof-name { font-size:15px!important; }

    /* ── Compact nav bar ── */
    .nav-inner .logo { font-size:20px!important; }

    /* ══════ LANDING PAGE MOBILE ══════ */
    .landing-nav { padding:10px 14px!important; }
    .landing-nav .btn-ghost { padding:7px 12px!important; font-size:11px!important; }
    .landing-nav .btn-primary { padding:7px 14px!important; font-size:11px!important; }
    .landing-hero { padding:48px 18px 32px!important; gap:28px!important; flex-direction:column!important; text-align:center!important; }
    .landing-hero > div:first-child { min-width:100%!important; }
    .landing-hero h1 { font-size:clamp(48px,14vw,72px)!important; margin-bottom:14px!important; text-align:center!important; line-height:1.02!important; letter-spacing:-0.04em!important; }
    .landing-hero h1 span { font-size:1.12em!important; }
    .landing-hero p { font-size:15px!important; margin-bottom:20px!important; text-align:center!important; max-width:340px!important; margin-left:auto!important; margin-right:auto!important; line-height:1.65!important; }
    .landing-hero .hero-cta { padding:16px 36px!important; font-size:16px!important; width:100%!important; justify-content:center!important; border-radius:16px!important; }
    .landing-hero > div:first-child > p:last-child { text-align:center!important; }
    .landing-hero > div:first-child > div:first-child { justify-content:center!important; }
    .landing-hero .hero-trust { padding:14px 12px!important; border-radius:14px!important; display:flex!important; flex-direction:column!important; gap:10px!important; }
    .landing-hero .hero-trust-item { gap:10px!important; margin-bottom:0!important; flex-direction:row!important; display:flex!important; }
    .landing-hero .hero-trust-icon { width:32px!important; height:32px!important; font-size:15px!important; border-radius:9px!important; }
    .landing-hero .hero-trust-title { font-size:12px!important; }
    .landing-hero .hero-trust-desc { font-size:10px!important; }
    .landing-section { padding:28px 16px!important; }
    .landing-section h2 { font-size:clamp(20px,5vw,34px)!important; margin-bottom:4px!important; }
    .landing-section p.section-subtitle { font-size:12px!important; }
    .landing-grid { gap:8px!important; grid-template-columns:repeat(2,1fr)!important; }
    .landing-grid > div { padding:14px 12px!important; border-radius:12px!important; }
    .landing-step-num { width:24px!important; height:24px!important; font-size:11px!important; }
    .landing-step-icon { font-size:18px!important; margin-bottom:4px!important; }
    .landing-step h3 { font-size:13px!important; }
    .landing-step p { font-size:10px!important; line-height:1.4!important; }
    .landing-feat-icon { font-size:20px!important; margin-bottom:4px!important; }
    .landing-feat h3 { font-size:12px!important; }
    .landing-feat p { font-size:10px!important; line-height:1.4!important; }
    .landing-uni-card { padding:14px 12px!important; }
    .landing-uni-emoji { font-size:22px!important; }
    .landing-uni-name { font-size:15px!important; }
    .landing-uni-desc { font-size:11px!important; }
    .landing-cta-section { padding:28px 16px!important; }
    .landing-cta-section h2 { font-size:clamp(20px,5.5vw,36px)!important; }
    .landing-cta-section .hero-cta { padding:14px 28px!important; font-size:14px!important; width:100%!important; }
    .landing-about { padding:16px 14px!important; }
    .landing-about .bu-logo { width:38px!important; height:38px!important; font-size:14px!important; }
    .landing-about .story-title { font-size:13px!important; }
    .landing-about .story-text { font-size:11px!important; }
    .landing-footer { padding:16px 14px!important; }

    /* ══════ DISCOVER FILTERS MOBILE ══════ */
    .dis-filter-row {
      display:grid!important;
      grid-template-columns:repeat(6,1fr)!important;
      gap:6px!important;
    }
    .dis-filter-row .dis-filter-sel:first-child { grid-column:1/4; }
    .dis-filter-row > div:nth-child(2) { grid-column:4/7; }
    .dis-filter-row .dis-course-box { grid-column:1/5; }
    .dis-filter-row .dis-filter-meet { grid-column:5/7; }
    .dis-filter-row .dis-filter-sel,
    .dis-filter-row .dis-course-box,
    .dis-filter-row > div[style] {
      min-width:0!important;
      width:100%!important;
    }
    .dis-filter-row .dis-clear-btn {
      grid-column:1/-1;
    }

    /* ══════ AUTH PAGE MOBILE ══════ */
    .auth-card { padding:24px 18px!important; }
    .auth-card h2 { font-size:19px!important; }
  }
`;

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function BasUdrus() {
  const [darkMode, setDarkMode] = useState(false);
  const T = darkMode ? DARK : LIGHT;

  const [screen, setScreen] = useState<string>("landing");
  const [authMode, setAuthMode] = useState<"signup"|"login"|"reset"|"reset-sent"|"new-password">("signup");
  const [authForm, setAuthForm] = useState({ email:"", password:"", name:"" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [user, setUser] = useState<{id:string; email:string} | null>(null);
  const [profile, setProfile] = useState<Partial<Profile>>({
    name:"", uni:"", major:"", course:"", year:"", meet_type:"flexible",
    bio:"", avatar_emoji:"🫶", avatar_color:"#6C8EF5", photo_mode:"initials",
    photo_url:null, streak:4, xp:340, badges:[], sessions:0, rating:0, subjects:[], online:true
  });
  const [editProfile, setEditProfile] = useState<Partial<Profile> | null>(null);
  const [editCourseSearch, setEditCourseSearch] = useState("");
  const [editCourseDropOpen, setEditCourseDropOpen] = useState(false);
  const editCourseDropRef = useRef<HTMLDivElement>(null);
  const [onboardMajorSearch, setOnboardMajorSearch] = useState("");
  const [onboardMajorOpen, setOnboardMajorOpen] = useState(false);
  const onboardMajorRef = useRef<HTMLDivElement>(null);
  const [editMajorSearch, setEditMajorSearch] = useState("");
  const [editMajorOpen, setEditMajorOpen] = useState(false);
  const editMajorRef = useRef<HTMLDivElement>(null);
  const [profileTab, setProfileTab] = useState("edit");
  const [adminTab, setAdminTab] = useState("analytics");
  const [step, setStep] = useState(1);

  const streak = profile.streak ?? 4;
  const xp = profile.xp ?? 340;
  const earnedBadges: string[] = profile.badges ?? [];
  const [newBadge, setNewBadge] = useState<typeof BADGES_DEF[0] | null>(null);

  const [allStudents, setAllStudents] = useState<Profile[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [subjectFilter, setSubjectFilter] = useState("");
  const [uniFilter, setUniFilter] = useState("");
  const [majorFilter, setMajorFilter] = useState("");
  const [majorFilterSearch, setMajorFilterSearch] = useState("");
  const [majorFilterOpen, setMajorFilterOpen] = useState(false);
  const majorFilterRef = useRef<HTMLDivElement>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [courseSearch, setCourseSearch] = useState("");
  const [courseDropOpen, setCourseDropOpen] = useState(false);
  const [flyCard, setFlyCard] = useState<{id:string; dir:string} | null>(null);

  const [connections, setConnections] = useState<Profile[]>([]);
  const [ratings, setRatings] = useState<Record<string,number>>({});
  const [rateModal, setRateModal] = useState<Profile | null>(null);
  const [hoverStar, setHoverStar] = useState(0);

  const [activeChat, setActiveChat] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [newMsg, setNewMsg] = useState("");

  const [schedModal, setSchedModal] = useState<Profile | null>(null);
  const [schedForm, setSchedForm] = useState({ date:"", time:"", type:"online", note:"" });

  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [showReqModal, setShowReqModal] = useState(false);
  const [newReq, setNewReq] = useState({ subject:"", detail:"", meetType:"flexible" });

  const [subjectHistory, setSubjectHistory] = useState<SubjectHistory[]>([]);
  const [showSubModal, setShowSubModal] = useState(false);
  const [newSub, setNewSub] = useState({ subject:"", note:"", status:"active" });

  const [groups, setGroups] = useState<GroupRoom[]>([]);
  const [showGrpModal, setShowGrpModal] = useState(false);
  const [newGrp, setNewGrp] = useState({ subject:"", date:"", time:"", type:"online", spots:4, link:"", location:"", note:"" });

  const [notif, setNotif] = useState<{msg:string; type:string} | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [canPost, setCanPost] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [cropModal, setCropModal] = useState<{src:string; file:File}|null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPos, setCropPos] = useState({x:0,y:0});
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropDragging = useRef(false);
  const cropLastPos = useRef({x:0,y:0});
  const [adminReports, setAdminReports] = useState<Report[]>([]);
  const [adminPosts, setAdminPosts] = useState<HelpRequest[]>([]);
  const [reportModal, setReportModal] = useState<{userId:string;name:string}|null>(null);
  const [reportReason, setReportReason] = useState("");
  const isAdmin = user?.email === ADMIN_EMAIL;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const connectingRef = useRef(false);
  const [uniDataReady, setUniDataReady] = useState(_uniDataReady);

  // Load university/major/course data from Supabase on mount
  useEffect(() => {
    if (_uniDataReady) { setUniDataReady(true); return; }
    loadUniData().then(() => setUniDataReady(true)).catch((e) => logError("loadUniData", e));
  }, []);
  const [adminAnalytics, setAdminAnalytics] = useState<any>(null);

  const [aiTab, setAiTab] = useState<"wellbeing"|"tutor"|"match"|"plan">("wellbeing");
  const [aiLang, setAiLang] = useState<"auto"|"en"|"ar">("auto");
  const [tutorMsgs, setTutorMsgs] = useState<{role:"user"|"assistant";content:string}[]>([]);
  const [tutorInput, setTutorInput] = useState("");
  const [tutorLoading, setTutorLoading] = useState(false);
  const [tutorSubject, setTutorSubject] = useState("");
  const [tutorFile, setTutorFile] = useState<{name:string;text:string}|null>(null);
  const tutorFileRef = useRef<HTMLInputElement>(null);
  const [matchScores, setMatchScores] = useState<Record<string,{score:number;reason:string}>>({});
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchQuiz, setMatchQuiz] = useState<Record<string,string>>({});
  const [matchQuizSaved, setMatchQuizSaved] = useState(false);
  const [planSubjects, setPlanSubjects] = useState("");
  const [planExamDates, setPlanExamDates] = useState("");
  const [planResult, setPlanResult] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [savedPlans, setSavedPlans] = useState<{id:string;plan:string;subjects:string;created_at:string}[]>([]);
  const [aiVersion, setAiVersion] = useState("v1.0");
  const [aiUserTier, setAiUserTier] = useState<{tier:string;interactionCount:number;maxTokens:number}>({tier:"new",interactionCount:0,maxTokens:500});

  // ── Voice & File sharing state ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder|null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);

  // ── Pomodoro Timer state ──
  const [pomodoroActive, setPomodoroActive] = useState(false);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(25 * 60);
  const [pomodoroMode, setPomodoroMode] = useState<"work"|"break"|"longbreak">("work");
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const pomodoroRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const tutorEndRef = useRef<HTMLDivElement>(null);
  const [wellbeingMsgs, setWellbeingMsgs] = useState<{role:"user"|"assistant";content:string}[]>([]);
  const [wellbeingInput, setWellbeingInput] = useState("");
  const [wellbeingLoading, setWellbeingLoading] = useState(false);
  const [wellbeingMood, setWellbeingMood] = useState("");
  const [wellbeingMode, setWellbeingMode] = useState("");
  const wellbeingEndRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);
  const dragScroll = useRef(0);
  const courseDropRef = useRef<HTMLDivElement>(null);

  const allCourseOptions = useMemo(() => {
    const groups = getCourseGroups();
    const results: {course: string; group: string}[] = [];
    const seen = new Set<string>();
    for (const [cat, list] of groups) {
      for (const c of list) {
        if (!seen.has(c)) { seen.add(c); results.push({ course: c, group: cat }); }
      }
    }
    return results;
  }, [uniDataReady]);

  const debouncedCourseSearch = useDebounce(courseSearch, 150);
  const filteredCourseOptions = useMemo(() => {
    if (!debouncedCourseSearch) return allCourseOptions;
    const q = debouncedCourseSearch.toLowerCase();
    const startsWith: typeof allCourseOptions = [];
    const wordStarts: typeof allCourseOptions = [];
    const contains: typeof allCourseOptions = [];
    for (const opt of allCourseOptions) {
      const name = opt.course.toLowerCase();
      if (name.startsWith(q)) startsWith.push(opt);
      else if (name.split(/[\s(&]/).some(w => w.startsWith(q))) wordStarts.push(opt);
      else if (name.includes(q)) contains.push(opt);
    }
    return [...startsWith, ...wordStarts, ...contains];
  }, [allCourseOptions, debouncedCourseSearch]);

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

  function parseCourses(courseStr: string | undefined): string[] {
    if (!courseStr) return [];
    try {
      const parsed = JSON.parse(courseStr);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return courseStr ? [courseStr] : [];
  }

  function serializeCourses(courses: string[]): string {
    if (courses.length === 0) return "";
    if (courses.length === 1) return courses[0];
    return JSON.stringify(courses);
  }

  const editCoursesList = useMemo(() => editProfile ? parseCourses(editProfile.course) : [], [editProfile?.course]);

  const editAllCourseOptions = useMemo(() => {
    if (!editProfile) return [];
    const groups = getCourseGroups();
    const results: {course: string; group: string}[] = [];
    const seen = new Set<string>();
    for (const [cat, list] of groups) {
      for (const c of list) { if (!seen.has(c)) { seen.add(c); results.push({ course: c, group: cat }); } }
    }
    return results;
  }, [uniDataReady, !!editProfile]);

  const editFilteredCourseOptions = useMemo(() => {
    const selected = new Set(editCoursesList);
    const available = editAllCourseOptions.filter(o => !selected.has(o.course));
    if (!editCourseSearch) return available.slice(0, 80); // Show first 80 when not searching
    const q = editCourseSearch.toLowerCase();
    const startsWith: typeof available = [];
    const wordStarts: typeof available = [];
    const contains: typeof available = [];
    for (const opt of available) {
      const name = opt.course.toLowerCase();
      if (name.startsWith(q)) startsWith.push(opt);
      else if (name.split(/[\s(&]/).some(w => w.startsWith(q))) wordStarts.push(opt);
      else if (name.includes(q)) contains.push(opt);
    }
    return [...startsWith, ...wordStarts, ...contains].slice(0, 80);
  }, [editAllCourseOptions, editCourseSearch, editCoursesList]);

  // Smart auto-scroll: only scroll to bottom if user is already near the bottom.
  // This keeps the user's reading position when the AI replies with a long answer.
  const smartScroll = (endRef: React.RefObject<HTMLDivElement>) => {
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
  useEffect(() => { smartScroll(chatEndRef); }, [activeChat, messages]);
  useEffect(() => { smartScroll(tutorEndRef); }, [tutorMsgs]);
  useEffect(() => { smartScroll(wellbeingEndRef); }, [wellbeingMsgs]);

  useEffect(() => {
    fetch("/api/ai/version").then(r=>r.json()).then(d=>{ if(d.version) setAiVersion(d.version); }).catch(()=>{});
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/ai/user-stats/${user.id}`).then(r=>r.json()).then(d=>{ if(d.tier) setAiUserTier(d); }).catch(()=>{});
  }, [user?.id]);

  const showNotif = useCallback((msg: string, type="ok") => {
    setNotif({msg,type});
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    notifTimerRef.current = setTimeout(()=>setNotif(null), 2800);
  }, []);

  const initials = (n: string) => n ? n.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase() : "ME";

  // ── Auth listener ────────────────────────────────────────────────────
  useEffect(() => {
    const loadTimeout = setTimeout(() => setLoading(false), 5000);
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(loadTimeout);
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? "" });
        // Capture name from OAuth provider metadata (Google, Apple, etc.)
        const meta = session.user.user_metadata;
        const oauthName = meta?.full_name || meta?.name || meta?.preferred_username || "";
        if (oauthName) {
          setProfile(p => ({ ...p, name: p.name || oauthName }));
          setAuthForm(f => ({ ...f, name: f.name || oauthName }));
        }
        const p = await loadProfile(session.user.id);
        setScreen(p ? "discover" : "onboard");
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
        // Capture name from OAuth provider metadata (Google, Apple, etc.)
        const meta = session.user.user_metadata;
        const oauthName = meta?.full_name || meta?.name || meta?.preferred_username || "";
        if (oauthName) {
          setProfile(p => ({ ...p, name: p.name || oauthName }));
          setAuthForm(f => ({ ...f, name: f.name || oauthName }));
        }
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          const p = await loadProfile(session.user.id);
          setScreen(p ? "discover" : "onboard");
        }
      } else if (event === "SIGNED_OUT") {
        setUser(null);
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
      supabase.auth.getSession().then(({ data: { session } }) => {
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
    ]).catch((e) => logError("initialDataLoad", e));
  }, [user?.id]);

  // Real-time messages — load when chat opens
  useEffect(() => {
    if (!user || !activeChat) return;
    loadMessages(activeChat.id);
  }, [user?.id, activeChat]);

  // Real-time messages — subscribe once per session, cache for all contacts
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`msgs-inbox-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `receiver_id=eq.${user.id}`,
      }, (payload) => {
        const msg = payload.new as Message;
        setMessages(prev => {
          const existing = prev[msg.sender_id] || [];
          if (existing.find(m => m.id === msg.id)) return prev;
          return { ...prev, [msg.sender_id]: [...existing, msg] };
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // ── Data loaders ─────────────────────────────────────────────────────
  const loadProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (error) { logError("loadProfile", error); return null; }
      if (!data) return null;
      if (data) setProfile(data);
      return data;
    } catch (e) { logError("loadProfile", e); return null; }
  };

  const loadAllStudents = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("help_requests")
        .select("*, profile:profiles!fk_help_requests_user(*)")
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) { return; }
      if (data) {
        const cards = (data as Array<HelpRequest & {profile: Profile}>)
          .filter((r: HelpRequest & {profile: Profile}) => r.profile && r.subject && r.detail?.trim())
          .map((r: HelpRequest & {profile: Profile}) => ({
            ...r.profile,
            _postId: r.id,
            _postSubject: r.subject,
            _postDetail: r.detail,
            _postMeetType: r.meet_type,
            _postCreatedAt: r.created_at,
            _isOwn: r.user_id === user.id,
          }));
        setAllStudents(cards);
      }
    } catch (e) { logError("loadAllStudents", e); }
  };

  const loadConnections = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("connections")
        .select("partner_id, rating, partner:profiles!connections_partner_id_fkey(*)")
        .eq("user_id", user.id);
      if (error) { logError("loadConnections", error); return; }
      if (data) {
        setConnections(data.map((c: any) => c.partner).filter(Boolean));
        const r: Record<string,number> = {};
        data.forEach((c: any) => { if (c.rating) r[c.partner_id] = c.rating; });
        setRatings(r);
      }
    } catch (e) { logError("loadConnections", e); }
  };

  const loadMessages = async (partnerId: string) => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
        .order("created_at", { ascending: true })
        .limit(100);  // Reduced from 200 for faster load; recent messages matter most
      if (error) { logError("loadMessages", error); return; }
      if (data) setMessages(prev => ({ ...prev, [partnerId]: data }));
    } catch (e) { logError("loadMessages", e); }
  };

  const loadHelpRequests = async () => {
    try {
      // Batch the two queries in parallel instead of sequentially
      const [requestsRes, canPostRes] = await Promise.all([
        supabase.from("help_requests")
          .select("*, profile:profiles!fk_help_requests_user(*)")
          .order("created_at", { ascending: false })
          .limit(30),
        user ? supabase.from("profiles").select("can_post").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (requestsRes.error) { logError("loadHelpRequests", requestsRes.error); return; }
      if (requestsRes.data) {
        setHelpRequests(requestsRes.data as HelpRequest[]);
        if (user && (requestsRes.data as HelpRequest[]).some((r: HelpRequest) => r.user_id === user.id)) setCanPost(true);
      }
      if (canPostRes.data?.can_post) setCanPost(true);
    } catch (e) { logError("loadHelpRequests", e); }
  };

  const enablePosting = async () => {
    setCanPost(true);
    showNotif("Posting enabled! You can now create study requests 🎉");
    if (user) {
      try {
        const { error } = await supabase.from("profiles").update({ can_post: true }).eq("id", user.id);
        if (error) return;
      } catch { }
    }
  };

  const loadGroups = async () => {
    if (!user) return;
    try {
      // Fetch groups and user's memberships in parallel
      const [groupRes, joinedRes] = await Promise.all([
        supabase.from("group_rooms")
          .select("*, host:profiles!fk_group_rooms_host(*)")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("group_members").select("group_id").eq("user_id", user.id),
      ]);
      if (groupRes.error) { logError("loadGroups", groupRes.error); return; }
      const joinedSet = new Set((joinedRes.data||[]).map((j:any) => j.group_id));
      if (groupRes.data) setGroups(groupRes.data.map((g:any) => ({ ...g, joined: joinedSet.has(g.id) })));
    } catch (e) { logError("loadGroups", e); }
  };

  const loadSubjectHistory = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("subject_history").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
      if (error) { return; }
      if (data) setSubjectHistory(data);
    } catch { }
  };

  const loadSavedPlans = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from("study_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);
      if (data) setSavedPlans(data);
    } catch { }
  };

  const savePlanAsNote = async () => {
    if (!user || !planResult) return;
    try {
      const { data, error } = await supabase.from("study_plans").insert({ user_id: user.id, plan: planResult, subjects: planSubjects, exams: planExamDates }).select().single();
      if (!error && data) { setSavedPlans(prev => [data, ...prev]); showNotif("Study plan saved as note!"); }
      else showNotif("Could not save plan", "err");
    } catch { showNotif("Error saving plan", "err"); }
  };

  // ─── CHAT HISTORY (persist tutor & wellbeing conversations) ─────────────
  const saveChatHistory = async (feature: "tutor"|"wellbeing", msgs: {role:"user"|"assistant";content:string}[]) => {
    if (!user || msgs.length === 0) return;
    try {
      const { data: existing } = await supabase.from("chat_history").select("id").eq("user_id", user.id).eq("feature", feature).limit(1).maybeSingle();
      if (existing) {
        await supabase.from("chat_history").update({ messages: msgs, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("chat_history").insert({ user_id: user.id, feature, messages: msgs });
      }
    } catch {}
  };

  const loadChatHistory = async (feature: "tutor"|"wellbeing") => {
    if (!user) return [];
    try {
      const { data } = await supabase.from("chat_history").select("messages").eq("user_id", user.id).eq("feature", feature).limit(1).maybeSingle();
      if (data?.messages && Array.isArray(data.messages)) return data.messages as {role:"user"|"assistant";content:string}[];
    } catch {}
    return [];
  };

  // Load chat history when user logs in
  useEffect(() => {
    if (!user) return;
    loadChatHistory("tutor").then(msgs => { if (msgs.length > 0) setTutorMsgs(msgs); });
    loadChatHistory("wellbeing").then(msgs => { if (msgs.length > 0) setWellbeingMsgs(msgs); });
  }, [user?.id]);

  // Auto-save chat history when AI finishes responding
  const tutorSaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const wellbeingSaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(() => {
    if (!user || tutorLoading || tutorMsgs.length === 0) return;
    if (tutorSaveTimer.current) clearTimeout(tutorSaveTimer.current);
    tutorSaveTimer.current = setTimeout(() => saveChatHistory("tutor", tutorMsgs), 1000);
    return () => { if (tutorSaveTimer.current) clearTimeout(tutorSaveTimer.current); };
  }, [tutorMsgs, tutorLoading]);
  useEffect(() => {
    if (!user || wellbeingLoading || wellbeingMsgs.length === 0) return;
    if (wellbeingSaveTimer.current) clearTimeout(wellbeingSaveTimer.current);
    wellbeingSaveTimer.current = setTimeout(() => saveChatHistory("wellbeing", wellbeingMsgs), 1000);
    return () => { if (wellbeingSaveTimer.current) clearTimeout(wellbeingSaveTimer.current); };
  }, [wellbeingMsgs, wellbeingLoading]);

  const loadMatchQuiz = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from("match_quiz").select("answers").eq("user_id", user.id).maybeSingle();
      if (data?.answers) { setMatchQuiz(data.answers); setMatchQuizSaved(true); }
    } catch { }
  };

  const saveMatchQuiz = async () => {
    if (!user) return;
    try {
      const { error } = await supabase.from("match_quiz").upsert({ user_id: user.id, answers: matchQuiz, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (!error) { setMatchQuizSaved(true); showNotif("Study preferences saved! Your matches will improve."); }
      else showNotif("Could not save — " + error.message, "err");
    } catch { showNotif("Error saving preferences", "err"); }
  };

  // ── Auth ──────────────────────────────────────────────────────────────
  const handleAuth = async () => {
    setAuthError("");
    if (!authForm.email || !authForm.password) return setAuthError("Please fill all fields.");
    if (!authForm.email.includes("@")) return setAuthError("Enter a valid email address.");
    if (authForm.password.length < 6) return setAuthError("Password must be at least 6 characters.");
    if (authMode==="signup" && !authForm.name) return setAuthError("Enter your full name.");
    setAuthLoading(true);
    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) { setAuthError(error.message); setAuthLoading(false); return; }
        if (data.user) {
          setUser({ id: data.user.id, email: data.user.email ?? "" });
          setProfile(p => ({ ...p, name: authForm.name, email: authForm.email }));
          setScreen("onboard");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) { setAuthError(error.message); setAuthLoading(false); return; }
        if (data.user) {
          setUser({ id: data.user.id, email: data.user.email ?? "" });
          const p = await loadProfile(data.user.id);
          if (!p) {
            setScreen("onboard");
          } else {
            setScreen("discover");
          }
        }
      }
    } catch { setAuthError("Something went wrong — please try again"); }
    setAuthLoading(false);
  };

  // ── OAuth ─────────────────────────────────────────────────────────────
  const handleOAuth = async (provider: "google" | "apple") => {
    setAuthError("");
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (error) { setAuthError(error.message); setAuthLoading(false); }
    } catch { setAuthError("OAuth failed — please try again"); setAuthLoading(false); }
  };

  // ── Reset password (step 1: send email) ───────────────────────────────
  const handleResetPassword = async () => {
    setAuthError("");
    if (!resetEmail.includes("@")) return setAuthError("Enter a valid email address.");
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) { setAuthError(error.message); }
      else { setAuthMode("reset-sent"); }
    } catch { setAuthError("Failed — please try again"); }
    setAuthLoading(false);
  };

  // ── Reset password (step 2: set new password after redirect) ──────────
  const handleNewPassword = async () => {
    setAuthError("");
    if (newPassword.length < 6) return setAuthError("Password must be at least 6 characters.");
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) { setAuthError(error.message); setAuthLoading(false); return; }
      setNewPassword("");
      showNotif("Password updated! You're logged in.", "ok");
      setScreen("discover");
    } catch { setAuthError("Failed — please try again"); }
    setAuthLoading(false);
  };

  // ── Onboard ───────────────────────────────────────────────────────────
  const handleOnboard = async () => {
    if (!profile.uni||!profile.major||!profile.year) return showNotif("Almost there! Fill required fields 👆","err");
    if (!user) { showNotif("Session expired — please sign in again","err"); setScreen("auth"); return; }
    // Get the best available name (from profile state, authForm, or OAuth metadata)
    const { data: { session } } = await supabase.auth.getSession();
    const meta = session?.user?.user_metadata;
    const bestName = profile.name || authForm.name || meta?.full_name || meta?.name || user.email.split("@")[0];
    // Check if user has a Google/OAuth avatar
    const oauthAvatar = meta?.avatar_url || meta?.picture || null;
    try {
      const profileData: Record<string, unknown> = {
        id: user.id,
        email: user.email,
        name: bestName,
        uni: profile.uni,
        major: profile.major,
        year: profile.year,
        course: profile.course || "",
        meet_type: profile.meet_type || "flexible",
        bio: profile.bio || "",
        avatar_emoji: profile.avatar_emoji || "🫶",
        avatar_color: profile.avatar_color || "#6C8EF5",
        photo_mode: oauthAvatar ? "photo" : "initials",
        photo_url: oauthAvatar || null,
        streak: 4,
        xp: 0,
        badges: [],
        online: true,
        sessions: 0,
        rating: 0,
        subjects: [],
      };
      const { error } = await supabase.from("profiles").upsert(profileData, { onConflict: "id" });
      if (error) { logError("handleOnboard:upsert", error); showNotif("Error saving profile: " + error.message, "err"); return; }
      setProfile(profileData as typeof profile);
      setScreen("discover");
      loadAllStudents().catch(e => logError("loadAllStudents", e));
    } catch (e) { logError("handleOnboard", e); showNotif("Something went wrong — please try again", "err"); }
  };

  // ── Award badge ───────────────────────────────────────────────────────
  const awardBadge = async (id: string) => {
    if (!user || earnedBadges.includes(id)) return;
    const b = BADGES_DEF.find(b=>b.id===id);
    if (!b) return;
    try {
      const newBadges = [...earnedBadges, id];
      const newXp = (profile.xp || 0) + b.xp;
      setProfile(p => ({ ...p, badges: newBadges, xp: newXp }));
      const { error } = await supabase.from("profiles").update({ badges: newBadges, xp: newXp }).eq("id", user.id);
      if (!error) setNewBadge(b);
    } catch { }
  };

  // ── Connect / Reject ──────────────────────────────────────────────────
  const handleConnect = async (s: Profile & {_postId?: string; _postSubject?: string}) => {
    if (!user || connectingRef.current) return;
    connectingRef.current = true; // Lock immediately to prevent double-clicks
    const key = s._postId || s.id;
    setFlyCard({id:key,dir:"up"});
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(async () => {
      try {
        const { error } = await supabase.from("connections").upsert([
          { user_id: user.id, partner_id: s.id },
          { user_id: s.id, partner_id: user.id },
        ], { onConflict: "user_id,partner_id" });
        if (error) { showNotif("Connection failed — try again", "err"); setFlyCard(null); connectingRef.current = false; return; }
        setConnections(prev => prev.find(c=>c.id===s.id) ? prev : [...prev, s]);
        setDismissed(prev=>({...prev,[key]:true}));
        setFlyCard(null);
        const newXp = (profile.xp || 0) + 20;
        setProfile(p => ({ ...p, xp: newXp }));
        supabase.from("profiles").update({ xp: newXp }).eq("id", user.id).then(() => {});
        showNotif(`You matched with ${s.name}! 🎉`);
        setActiveChat(s);
        setScreen("connect");
        if (!earnedBadges.includes("first_connect")) awardBadge("first_connect");
        fetch("/api/notify/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user1Email: user.email,
            user1Name: profile.name || "A student",
            user2Email: s.email || "",
            user2Name: s.name || "A student",
          }),
        }).catch(() => {});
      } catch { showNotif("Connection failed", "err"); setFlyCard(null); }
      connectingRef.current = false;
    }, 360);
  };

  const handleReject = (s: Profile & {_postId?: string}) => {
    const key = s._postId || s.id;
    setFlyCard({id:key,dir:"down"});
    setTimeout(()=>{ setDismissed(prev=>({...prev,[key]:true})); setFlyCard(null); }, 310);
  };

  // ── Chat ──────────────────────────────────────────────────────────────
  const sendMessage = async (partnerId: string) => {
    if (!newMsg.trim() || !user) return;
    const text = newMsg;
    setNewMsg("");
    try {
      const { data, error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: partnerId,
        text,
      }).select().single();
      if (error || !data) {
        logError("sendMessage", error);
        setNewMsg(text);
        showNotif("Couldn't send message — please try again.", "err");
        return;
      }
      setMessages(prev => ({ ...prev, [partnerId]: [...(prev[partnerId]||[]), data] }));
      if (!earnedBadges.includes("ice_breaker")) await awardBadge("ice_breaker");
      const partner = connections.find(c => c.id === partnerId);
      if (partner?.email) {
        const partnerMsgs = messages[partnerId] || [];
        const lastPartnerMsg = partnerMsgs.filter((m: Message) => m.sender_id === partnerId).pop();
        const receiverRecentlyActive = lastPartnerMsg && (Date.now() - new Date(lastPartnerMsg.created_at).getTime()) < 30_000;
        if (!receiverRecentlyActive) {
          fetch("/api/notify/chat-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              senderId: user.id,
              senderName: profile.name,
              receiverEmail: partner.email,
              receiverName: partner.name?.split(" ")[0] || "",
              messagePreview: text,
            }),
          }).catch(() => {});
        }
      }
    } catch { setNewMsg(text); showNotif("Couldn't send message — please try again.", "err"); }
  };

  // ── Voice Recording ─────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4" });
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        if (blob.size < 1000) { setIsRecording(false); setRecordingTime(0); return; }
        await uploadAndSendFile(blob, `voice-${Date.now()}.webm`, "voice");
        setIsRecording(false);
        setRecordingTime(0);
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch (err) {
      logError("startRecording", err);
      showNotif("Microphone access denied. Check browser permissions.", "err");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  // ── File Upload in Chat ─────────────────────────────────────────────
  const handleChatFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showNotif("File too large — max 10MB", "err"); return; }
    const isImage = file.type.startsWith("image/");
    const msgType = isImage ? "image" : "file";
    await uploadAndSendFile(file, file.name, msgType);
    if (chatFileRef.current) chatFileRef.current.value = "";
  };

  const uploadAndSendFile = async (fileOrBlob: File | Blob, fileName: string, msgType: "voice" | "image" | "file") => {
    if (!user || !activeChat) return;
    try {
      const ext = fileName.split(".").pop() || "bin";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-files").upload(path, fileOrBlob, { contentType: fileOrBlob instanceof File ? fileOrBlob.type : "audio/webm" });
      if (upErr) { logError("uploadChatFile", upErr); showNotif("Upload failed — try again", "err"); return; }
      const { data: urlData } = supabase.storage.from("chat-files").getPublicUrl(path);
      const displayText = msgType === "voice" ? "🎤 Voice message" : msgType === "image" ? `📷 ${fileName}` : `📎 ${fileName}`;
      const { data, error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: activeChat.id,
        text: displayText,
        message_type: msgType,
        file_url: urlData.publicUrl,
        file_name: fileName,
      }).select().single();
      if (error || !data) { logError("sendFileMsg", error); showNotif("Couldn't send — try again", "err"); return; }
      setMessages(prev => ({ ...prev, [activeChat.id]: [...(prev[activeChat.id] || []), data] }));
    } catch (err) { logError("uploadAndSendFile", err); showNotif("Upload failed", "err"); }
  };

  // ── Pomodoro Timer ──────────────────────────────────────────────────
  const pomodoroConfig = { work: 25 * 60, break: 5 * 60, longbreak: 15 * 60 };

  const startPomodoro = () => {
    setPomodoroRunning(true);
    pomodoroRef.current = setInterval(() => {
      setPomodoroSeconds(prev => {
        if (prev <= 1) {
          // Timer done
          if (pomodoroRef.current) clearInterval(pomodoroRef.current);
          setPomodoroRunning(false);
          try { new Audio("data:audio/wav;base64,UklGRiQDAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQADAAB/f39/f39/f4B/gH+Af4F/gn+Df4R/hn+If4p/jH+Pf5J/ln+af55/on+mf6p/rn+yf7Z/un++f8J/xn/Jf8x/z3/Sf9V/13/Zf9t/3X/ef99/4H/hf+J/43/kf+V/5n/nf+h/6X/qf+t/7H/tf+5/73/wf/F/8n/zf/R/9X/2f/d/+H/5f/p/+3/8f/1//n//fwCAA").play(); } catch {}
          showNotif(pomodoroMode === "work" ? "⏰ Break time! Great focus session." : "💪 Break over — back to studying!", "ok");
          setPomodoroCount(prev => {
            const next = pomodoroMode === "work" ? prev + 1 : prev;
            // Auto-switch mode
            if (pomodoroMode === "work") {
              if ((next) % 4 === 0) { setPomodoroMode("longbreak"); setPomodoroSeconds(pomodoroConfig.longbreak); }
              else { setPomodoroMode("break"); setPomodoroSeconds(pomodoroConfig.break); }
            } else {
              setPomodoroMode("work"); setPomodoroSeconds(pomodoroConfig.work);
            }
            return next;
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const pausePomodoro = () => {
    setPomodoroRunning(false);
    if (pomodoroRef.current) { clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
  };

  const resetPomodoro = () => {
    pausePomodoro();
    setPomodoroMode("work");
    setPomodoroSeconds(pomodoroConfig.work);
    setPomodoroCount(0);
    setPomodoroActive(false);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const pomodoroProgress = (() => {
    const total = pomodoroConfig[pomodoroMode];
    return ((total - pomodoroSeconds) / total) * 100;
  })();

  // ── Schedule session ──────────────────────────────────────────────────
  const submitSchedule = async () => {
    if (!schedForm.date||!schedForm.time||!user||!schedModal) return showNotif("Pick a date and time","err");
    try {
      const text = `📅 Session booked: ${schedForm.date} at ${schedForm.time} — ${getMeetLabel(schedForm.type)}${schedForm.note?" | "+schedForm.note:""}`;
      const { error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: schedModal.id,
        text,
      });
      if (error) { showNotif("Failed to schedule — try again", "err"); return; }
      if (schedModal.email) {
        fetch("/api/notify/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderName: profile.name,
            receiverEmail: schedModal.email,
            receiverName: schedModal.name?.split(" ")[0] || "",
            messagePreview: text,
          }),
        }).catch(() => {});
      }
      await loadMessages(schedModal.id);
      setSchedModal(null);
      setSchedForm({date:"",time:"",type:"online",note:""});
      showNotif("Session scheduled! ✅");
    } catch { showNotif("Failed to schedule", "err"); }
  };

  // ── Rate partner ──────────────────────────────────────────────────────
  const submitRating = async (partnerId: string, stars: number) => {
    if (!user) return;
    try {
      const { error } = await supabase.from("connections")
        .update({ rating: stars })
        .eq("user_id", user.id)
        .eq("partner_id", partnerId);
      if (error) { showNotif("Rating failed — try again", "err"); return; }
      setRatings(prev=>({...prev,[partnerId]:stars}));
      setRateModal(null);
      // Award top_rated badge to the partner who received the 5-star rating
      if (stars===5) {
        try {
          const { data: partnerProfile } = await supabase.from("profiles").select("badges,xp").eq("id", partnerId).maybeSingle();
          if (partnerProfile && !(partnerProfile.badges || []).includes("top_rated")) {
            const b = BADGES_DEF.find(b=>b.id==="top_rated");
            if (b) {
              const newBadges = [...(partnerProfile.badges || []), "top_rated"];
              await supabase.from("profiles").update({ badges: newBadges, xp: (partnerProfile.xp || 0) + b.xp }).eq("id", partnerId);
            }
          }
        } catch {}
      }
      showNotif("Thanks for rating! ⭐");
    } catch { showNotif("Rating failed", "err"); }
  };

  // ── Help request ──────────────────────────────────────────────────────
  const submitRequest = async () => {
    if (!newReq.subject||!user) return showNotif("Pick a course first","err");
    if (!newReq.detail?.trim()) return showNotif("Write what you need help with","err");
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const { data: existingProfile, error: profileCheckError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .single();

      if (profileCheckError || !existingProfile) {

        showNotif("Please save your profile first before posting", "err");
        setShowReqModal(false);
        setScreen("profile");
        return;
      }

      const { data, error } = await supabase.from("help_requests").insert({
        user_id: user.id,
        subject: newReq.subject,
        detail: newReq.detail.trim(),
        meet_type: newReq.meetType,
      }).select().single();
      if (!error && data) {
        const fullReq = { ...data, profile };
        setHelpRequests(prev=>[fullReq as HelpRequest,...prev]);
        setNewReq({subject:"",detail:"",meetType:"flexible"});
        setShowReqModal(false);
        showNotif("Your post is live! 📢");
        await awardBadge("helper");
      } else if (error) {

        showNotif("Error posting — " + (error.message || "please try again"), "err");
      }
    } catch { showNotif("Error posting — please try again", "err"); }
    setActionLoading(false);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { showNotif("Photo must be under 5 MB", "err"); return; }
    // Open crop modal instead of uploading directly
    const reader = new FileReader();
    reader.onload = () => {
      setCropModal({ src: reader.result as string, file });
      setCropZoom(1);
      setCropPos({ x: 0, y: 0 });
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // reset input so re-selecting same file works
  };

  // Calculate initial zoom to "cover" the circle (fill it without gaps)
  const [cropImgDims, setCropImgDims] = useState<{w:number;h:number}|null>(null);
  const cropInitialZoom = useMemo(() => {
    if (!cropImgDims) return 1;
    const previewSize = 260;
    // Scale to cover the circle — use the LARGER ratio so the full circle is filled
    return Math.max(previewSize / cropImgDims.w, previewSize / cropImgDims.h);
  }, [cropImgDims]);

  // When crop modal opens, measure the image
  useEffect(() => {
    if (!cropModal) { setCropImgDims(null); return; }
    const img = new Image();
    img.onload = () => {
      setCropImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      const previewSize = 260;
      const coverZoom = Math.max(previewSize / img.naturalWidth, previewSize / img.naturalHeight);
      setCropZoom(coverZoom);
      setCropPos({ x: 0, y: 0 });
    };
    img.src = cropModal.src;
  }, [cropModal?.src]);

  const cropAndUpload = async () => {
    if (!cropModal || !user) return;
    try {
      const canvas = document.createElement("canvas");
      const size = 400; // output 400x400
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = cropModal.src;
      });

      // The preview circle is 260px. Canvas is 400px. Scale factor:
      const canvasToPreview = size / 260;
      // Draw the image at the same relative position/zoom as the preview
      const imgW = img.naturalWidth * cropZoom * canvasToPreview;
      const imgH = img.naturalHeight * cropZoom * canvasToPreview;
      const drawX = (size - imgW) / 2 + cropPos.x * canvasToPreview;
      const drawY = (size - imgH) / 2 + cropPos.y * canvasToPreview;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, drawX, drawY, imgW, imgH);

      const blob = await new Promise<Blob|null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) { showNotif("Failed to process image", "err"); return; }

      const path = `${user.id}/avatar.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (error) { showNotif("Upload failed — make sure the 'avatars' bucket exists in Supabase Storage", "err"); return; }
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = publicUrl + "?t=" + Date.now();
      const { error: updateErr } = await supabase.from("profiles").update({ photo_mode: "photo", photo_url: url }).eq("id", user.id);
      if (updateErr) { showNotif("Photo uploaded but profile update failed", "err"); return; }
      setProfile(p => ({ ...p, photo_mode: "photo", photo_url: url }));
      if (editProfile) setEditProfile(p => ({ ...p!, photo_mode: "photo", photo_url: url }));
      setCropModal(null);
      showNotif("Profile photo updated! 📸");
    } catch (e) { logError("cropAndUpload", e); showNotif("Upload failed — please try again", "err"); }
  };

  const openStudentProfile = async (userId: string) => {
    if (userId === user?.id) { setScreen("profile"); return; }
    try {
      const { data, error: profErr } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (profErr) { showNotif("Could not load profile", "err"); return; }
      if (data) setViewingProfile(data as Profile);
      else showNotif("Profile not found", "err");
    } catch { showNotif("Could not load profile", "err"); }
  };

  // ── Open post-request modal (blocks incomplete profiles) ──────────────
  const openReqModal = () => {
    if (!profile.name || !profile.uni || !profile.major) {
      showNotif("Complete your profile first — add your name, university & major 👤", "err");
      setScreen("profile");
      return;
    }
    setShowReqModal(true);
  };

  // ── Subject history ───────────────────────────────────────────────────
  const submitSubject = async () => {
    if (!newSub.subject||!user) return showNotif("Pick a subject","err");
    if (subjectHistory.find(s=>s.subject===newSub.subject)) return showNotif("Already in your history","err");
    try {
      const { data, error } = await supabase.from("subject_history").insert({
        user_id: user.id,
        subject: newSub.subject,
        status: newSub.status,
        note: newSub.note || "",
      }).select().single();
      if (error) { showNotif("Failed to add subject — try again", "err"); return; }
      if (data) {
        const updatedHistory = [data,...subjectHistory];
        setSubjectHistory(updatedHistory);
        setNewSub({subject:"",note:"",status:"active"});
        setShowSubModal(false);
        showNotif("Subject added ✅");
        const done = updatedHistory.filter(x=>x.status==="done").length;
        if (done >= 3) await awardBadge("subject_master");
      }
    } catch { showNotif("Failed to add subject", "err"); }
  };

  const markSubjectDone = async (subId: string) => {
    try {
      const { error } = await supabase.from("subject_history").update({ status:"done" }).eq("id", subId);
      if (error) { showNotif("Failed to update subject", "err"); return; }
      const updated = subjectHistory.map(x=>x.id===subId?{...x,status:"done"}:x);
      setSubjectHistory(updated);
      const done = updated.filter(x=>x.status==="done").length;
      if (done >= 3) await awardBadge("subject_master");
    } catch { }
  };

  // ── Group rooms ───────────────────────────────────────────────────────
  const submitGroup = async () => {
    if (!newGrp.subject||!newGrp.date||!newGrp.time||!user) return showNotif("Fill subject, date and time","err");
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await supabase.from("profiles").upsert({
        id: user.id, email: user.email, name: profile.name||"", uni: profile.uni||"", major: profile.major||"",
        year: profile.year||"", course: profile.course||"", meet_type: profile.meet_type||"flexible",
        bio: profile.bio||"", avatar_emoji: profile.avatar_emoji||"🫶", avatar_color: profile.avatar_color||"#6C8EF5",
        photo_mode: profile.photo_mode||"initials", photo_url: profile.photo_url||null,
        streak: profile.streak??4, xp: profile.xp??0, badges: profile.badges??[], online: true,
        sessions: profile.sessions??0, rating: profile.rating??0, subjects: profile.subjects??[],
      }, { onConflict: "id" });
      const { data, error } = await supabase.from("group_rooms").insert({
        host_id: user.id,
        subject: newGrp.subject,
        date: newGrp.date,
        time: newGrp.time,
        type: newGrp.type,
        spots: Number(newGrp.spots)||4,
        filled: 0,
        link: newGrp.link,
        location: newGrp.location,
      }).select("*, host:profiles!fk_group_rooms_host(*)").single();
      if (error) { showNotif("Failed to create room — " + error.message, "err"); return; }
      if (data) {
        setGroups(prev=>[{...data, joined:false} as GroupRoom,...prev]);
        setNewGrp({subject:"",date:"",time:"",type:"online",spots:4,link:"",location:"",note:""});
        setShowGrpModal(false);
        showNotif("Study room created! 🎓");
        await awardBadge("group_host");
      }
    } catch { showNotif("Failed to create room", "err"); }
    setActionLoading(false);
  };

  const toggleJoinGroup = async (groupId: string, joined: boolean) => {
    if (!user) return;
    try {
      if (joined) {
        const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", user.id);
        if (error) { showNotif("Failed to leave group", "err"); return; }
        const grp = groups.find(g=>g.id===groupId);
        if (grp) await supabase.from("group_rooms").update({ filled: Math.max(0, grp.filled - 1) }).eq("id", groupId);
        setGroups(prev=>prev.map(g=>g.id===groupId?{...g,filled:g.filled-1,joined:false}:g));
      } else {
        const { error } = await supabase.from("group_members").upsert({ group_id: groupId, user_id: user.id }, { onConflict: "group_id,user_id" });
        if (error) { showNotif("Failed to join group", "err"); return; }
        const cur = groups.find(g=>g.id===groupId);
        if (cur) await supabase.from("group_rooms").update({ filled: cur.filled + 1 }).eq("id", groupId);
        setGroups(prev=>prev.map(g=>g.id===groupId?{...g,filled:g.filled+1,joined:true}:g));
        showNotif("You joined the session! 🎓");
      }
    } catch { showNotif("Failed — please try again", "err"); }
  };

  // ── Profile update ────────────────────────────────────────────────────
  const saveProfile = async () => {
    if (!user) { showNotif("Not signed in", "err"); return; }
    if (!editProfile) { showNotif("Nothing to save", "err"); return; }
    setActionLoading(true);
    try {
      // Verify session is still valid (RLS needs a live auth.uid())
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showNotif("Session expired — please sign in again", "err"); return; }

      const merged = { ...profile, ...editProfile };
      const updatePayload: Record<string, unknown> = {
        name: (merged.name || "").trim(),
        uni: merged.uni || "",
        major: merged.major || "",
        year: merged.year || "",
        course: merged.course || "",
        meet_type: merged.meet_type || "flexible",
        bio: (merged.bio || "").trim(),
        avatar_emoji: merged.avatar_emoji || "🫶",
        avatar_color: merged.avatar_color || "#6C8EF5",
        photo_mode: merged.photo_mode || "initials",
        photo_url: merged.photo_url || null,
        subjects: Array.isArray(merged.subjects) ? merged.subjects : [],
      };

      const { data, error } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", user.id)
        .select()
        .single();

      if (error) {
        logError("saveProfile", error);
        showNotif("Save failed: " + (error.message || "unknown error"), "err");
        return;
      }
      if (!data) {
        showNotif("Save failed: no rows updated (permission issue)", "err");
        return;
      }
      setProfile(prev => ({ ...prev, ...updatePayload } as Profile));
      setEditProfile(null);
      showNotif("Profile saved ✅");
    } catch (e) {
      logError("saveProfile", e);
      showNotif("Save failed — please try again", "err");
    } finally {
      setActionLoading(false);
    }
  };

  const submitReport = async () => {
    if (!reportModal || !reportReason.trim() || !user) return;
    try {
      const { error } = await supabase.from("reports").insert({
        reporter_id: user.id,
        reported_id: reportModal.userId,
        reason: reportReason.trim(),
      });
      if (error) { showNotif("Failed to submit report", "err"); }
      else { showNotif("Report submitted. Thank you."); setReportModal(null); setReportReason(""); }
    } catch { showNotif("Failed to submit report", "err"); }
  };

  const loadAdminData = async () => {
    if (!isAdmin) return;
    try {
      const { data: reports, error: rErr } = await supabase
        .from("reports")
        .select("*, reporter:profiles!reports_reporter_id_fkey(*), reported:profiles!reports_reported_id_fkey(*)")
        .order("created_at", { ascending: false });
      if (rErr) return;
      if (reports) setAdminReports(reports as Report[]);
      const { data: posts, error: pErr } = await supabase
        .from("help_requests")
        .select("*, profile:profiles!fk_help_requests_user(*)")
        .order("created_at", { ascending: false });
      if (!pErr && posts) setAdminPosts(posts as HelpRequest[]);
    } catch { }
  };

  const adminDeletePost = async (postId: string) => {
    try {
      await supabase.from("notifications").delete().eq("post_id", postId);
      const { error, count } = await supabase
        .from("help_requests")
        .delete({ count: "exact" })
        .eq("id", postId);
      if (error) {

        showNotif("Delete failed: " + error.message, "err");
      } else if (count === 0) {
        showNotif("Delete blocked — check RLS policy in Supabase", "err");
      } else {
        setAdminPosts(p => p.filter(x => x.id !== postId));
        setHelpRequests(p => p.filter(x => x.id !== postId));
        showNotif("Post deleted");
      }
    } catch { showNotif("Delete failed — please try again", "err"); }
  };

  const loadNotifications = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*, from_profile:profiles!notifications_from_id_fkey(*)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) { return; }
      if (data) setNotifications(data as Notification[]);
    } catch { }
  };

  const sendNotification = async (toUserId: string, fromId: string, type: string, subject: string, postId: string | null) => {
    if (toUserId === fromId) return;
    try {
      const { error } = await supabase.from("notifications").insert({
        user_id: toUserId,
        from_id: fromId,
        type,
        subject,
        post_id: postId,
        read: false,
      });
      if (error) return;
    } catch { }
  };

  const markNotifRead = async (notifId: string) => {
    try {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", notifId);
      if (!error) setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, read: true } : n));
    } catch { }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!user) return;
    loadNotifications();
    const channel = supabase.channel("notif-" + user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, async (payload) => {
        const newNotif = payload.new as Notification;
        const { data: fromProfile } = await supabase.from("profiles").select("*").eq("id", newNotif.from_id).maybeSingle();
        setNotifications(prev => [{ ...newNotif, from_profile: fromProfile } as Notification, ...prev]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) setShowNotifPanel(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!newBadge) return;
    const t = setTimeout(() => setNewBadge(null), 3500);
    return () => clearTimeout(t);
  }, [newBadge]);

  const loadAdminAnalytics = async () => {
    if (!isAdmin) return;
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Use count queries instead of fetching ALL rows (scalable for 2000+ users)
      const [
        totalUsersRes, usersTodayRes, usersWeekRes, usersMonthRes,
        totalPostsRes, postsTodayRes, postsWeekRes, postsMonthRes,
        totalReportsRes, resolvedReportsRes,
        recentPostsRes, topUsersRes,
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", weekStart),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", monthStart),
        supabase.from("help_requests").select("*", { count: "exact", head: true }),
        supabase.from("help_requests").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
        supabase.from("help_requests").select("*", { count: "exact", head: true }).gte("created_at", weekStart),
        supabase.from("help_requests").select("*", { count: "exact", head: true }).gte("created_at", monthStart),
        supabase.from("reports").select("*", { count: "exact", head: true }),
        supabase.from("reports").select("*", { count: "exact", head: true }).eq("resolved", true),
        // Only fetch recent posts for subject analysis (last 200, not ALL)
        supabase.from("help_requests").select("subject, user_id").order("created_at", { ascending: false }).limit(200),
        // Only fetch top 5 active users by XP
        supabase.from("profiles").select("id, name, xp").order("xp", { ascending: false }).limit(5),
      ]);

      const posts = recentPostsRes.data || [];
      const subjectCounts: Record<string, number> = {};
      posts.forEach((p: { subject: string; user_id: string }) => { if (p.subject) subjectCounts[p.subject] = (subjectCounts[p.subject] || 0) + 1; });
      const topSubjects = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const userPostCounts: Record<string, number> = {};
      posts.forEach((p: { subject: string; user_id: string }) => { userPostCounts[p.user_id] = (userPostCounts[p.user_id] || 0) + 1; });

      const topActiveUsers = (topUsersRes.data || []).map((u: { id: string; name: string; xp: number }) => ({
        name: u.name || "Unknown",
        count: userPostCounts[u.id] || 0,
        xp: u.xp || 0,
      }));

      // Approximate monthly data from counts (lightweight)
      const months6: {month:string;posts:number;users:number}[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mLabel = d.toLocaleDateString("en-US", { month: "short" });
        months6.push({ month: mLabel, posts: 0, users: 0 });
      }

      const totalReports = totalReportsRes.count || 0;
      const resolvedReports = resolvedReportsRes.count || 0;

      setAdminAnalytics({
        totalUsers: totalUsersRes.count || 0, usersToday: usersTodayRes.count || 0, usersWeek: usersWeekRes.count || 0, usersMonth: usersMonthRes.count || 0,
        totalPosts: totalPostsRes.count || 0, postsToday: postsTodayRes.count || 0, postsWeek: postsWeekRes.count || 0, postsMonth: postsMonthRes.count || 0,
        totalReports, resolvedReports, unresolvedReports: totalReports - resolvedReports,
        topSubjects, topActiveUsers, months6,
      });
    } catch { }
  };

  const handleSignOut = async () => {
    // 1. Clear ALL Supabase storage FIRST — prevents stale session on reload
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth")) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth")) sessionStorage.removeItem(k);
    });
    // 2. Clear AI memory
    clearAllMemory();
    // 3. Tell Supabase to sign out (global scope revokes token server-side too)
    try { await supabase.auth.signOut({ scope: "global" }); } catch (_) { /* session may already be gone */ }
    // 4. Reset ALL app state
    setUser(null);
    setProfile({ name:"", uni:"", major:"", course:"", year:"", meet_type:"flexible", bio:"", avatar_emoji:"🫶", avatar_color:"#6C8EF5", photo_mode:"initials", photo_url:null, streak:4, xp:0, badges:[], sessions:0, rating:0, subjects:[] });
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

  // ── AI Handlers ───────────────────────────────────────────────────────
  const sendTutorMessage = async () => {
    if (!tutorInput.trim() || tutorLoading) return;
    const msg = tutorInput.trim();
    const fileCtx = tutorFile ? `\n\n[Attached file: ${tutorFile.name}]\n${tutorFile.text.slice(0,4000)}` : "";
    const displayMsg = tutorFile ? `${msg}\n📎 ${tutorFile.name}` : msg;
    setTutorInput("");
    setTutorFile(null);
    const newMsgs = [...tutorMsgs, { role:"user" as const, content:displayMsg }];
    setTutorMsgs(newMsgs);
    setTutorLoading(true);
    setTutorMsgs(prev => [...prev, { role:"assistant" as const, content:"" }]);
    // Save user message to memory
    saveMemory("tutor", "user", msg);
    if (tutorSubject) saveTrendingTopic(tutorSubject);
    try {
      const apiMsgs = fileCtx ? [...tutorMsgs, { role:"user" as const, content:msg+fileCtx }] : newMsgs;
      const memory = formatMemoryForPrompt("tutor");
      const res = await fetch("/api/ai/tutor", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ messages:apiMsgs, subject:tutorSubject, major:profile.major||"", year:profile.year||"", uni:profile.uni||"", userId:user?.id||"", lang:aiLang==="auto"?undefined:aiLang, memory }),
      });
      if (!res.ok || !res.body) throw new Error("AI error");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              assistantMsg += data.content;
              setTutorMsgs(prev => {
                const updated = [...prev];
                updated[updated.length-1] = { role:"assistant", content:assistantMsg };
                return updated;
              });
            }
          } catch {}
        }
      }
      // Save assistant response to memory & update stats
      saveMemory("tutor", "assistant", assistantMsg.slice(0, 300));
      const stats = incrementStats("tutor");
      const tier = getTokenTier(stats);
      setAiUserTier({ tier: tier.tier, interactionCount: stats.totalInteractions, maxTokens: tier.maxTokens });
    } catch {
      setTutorMsgs(prev => prev.slice(0,-1));
      showNotif("AI tutor error. Please try again.", "err");
    } finally {
      setTutorLoading(false);
    }
  };

  const sendWellbeingMessage = async () => {
    if (!wellbeingInput.trim() || wellbeingLoading) return;
    const msg = wellbeingInput.trim();
    setWellbeingInput("");
    const newMsgs = [...wellbeingMsgs, { role:"user" as const, content:msg }];
    setWellbeingMsgs(newMsgs);
    setWellbeingLoading(true);
    setWellbeingMsgs(prev => [...prev, { role:"assistant" as const, content:"" }]);
    // Save user message to memory (wellbeing has limited memory for privacy)
    saveMemory("wellbeing", "user", msg);
    try {
      const memory = formatMemoryForPrompt("wellbeing");
      const res = await fetch("/api/ai/wellbeing", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ messages:newMsgs, name:profile.name||"", mood:wellbeingMood, mode:wellbeingMode, uni:profile.uni||"", major:profile.major||"", userId:user?.id||"", lang:aiLang==="auto"?undefined:aiLang, memory }),
      });
      if (!res.ok || !res.body) throw new Error("AI error: " + res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            if (json.content) {
              assistantMsg += json.content;
              setWellbeingMsgs(prev => {
                const updated = [...prev];
                updated[updated.length-1] = { role:"assistant", content:assistantMsg };
                return updated;
              });
            }
          } catch {}
        }
      }
      // Save assistant response to memory & update stats
      saveMemory("wellbeing", "assistant", assistantMsg.slice(0, 300));
      const stats = incrementStats("wellbeing");
      const tier = getTokenTier(stats);
      setAiUserTier({ tier: tier.tier, interactionCount: stats.totalInteractions, maxTokens: tier.maxTokens });
    } catch {
      setWellbeingMsgs(prev => prev.slice(0,-1));
      showNotif("Could not reach Mental Health AI. Please try again.", "err");
    } finally {
      setWellbeingLoading(false);
    }
  };

  const loadMatchScores = async () => {
    if (matchLoading || allStudents.length === 0) return;
    setMatchLoading(true);
    try {
      const res = await fetch("/api/ai/match", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ myProfile:profile, candidates:allStudents.slice(0,15), userId:user?.id||"" }),
      });
      const data = await res.json();
      const scores: Record<string,{score:number;reason:string}> = {};
      (data.scores||[]).forEach((s: {id:string;score:number;reason:string}) => { scores[s.id] = { score:s.score, reason:s.reason }; });
      setMatchScores(scores);
    } catch { showNotif("Matching error. Try again.", "err"); }
    setMatchLoading(false);
  };

  const generateStudyPlan = async () => {
    if (!planSubjects.trim() || planLoading) return;
    setPlanLoading(true);
    setPlanResult("");
    // Save the plan request to memory & track trending topics
    saveMemory("planner", "user", `Subjects: ${planSubjects}, Exams: ${planExamDates || "none"}`);
    saveTrendingTopic(planSubjects.split(",")[0]?.trim() || planSubjects);
    try {
      const res = await fetch("/api/ai/study-plan", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ subjects:planSubjects, major:profile.major, year:profile.year, uni:profile.uni||"", examDates:planExamDates, userId:user?.id||"", lang:aiLang==="auto"?undefined:aiLang }),
      });
      if (!res.ok || !res.body) { showNotif("Failed to generate plan.", "err"); setPlanLoading(false); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullPlan = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.content) { fullPlan += parsed.content; setPlanResult(fullPlan); }
          } catch {}
        }
      }
      if (!fullPlan) setPlanResult("Failed to generate plan. Please try again.");
      else {
        saveMemory("planner", "assistant", fullPlan.slice(0, 300));
        incrementStats("planner");
      }
    } catch { showNotif("Failed to generate plan.", "err"); }
    setPlanLoading(false);
  };

  // Derived discover deck — each entry is a post (help_request + profile)
  const connectionIds = new Set(connections.map(c=>c.id));
  const filteredPool = allStudents.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => {
    const subjectMatch = !subjectFilter || (s._postSubject && s._postSubject === subjectFilter);
    const uniMatch     = !uniFilter     || s.uni === uniFilter;
    const majorMatch   = !majorFilter   || s.major === majorFilter;
    const typeMatch    = !typeFilter    || (s._postMeetType || s.meet_type) === typeFilter;
    return subjectMatch && uniMatch && majorMatch && typeMatch;
  });
  const visibleDeck = filteredPool.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => s._isOwn || !dismissed[s._postId || s.id]);
  const nonOwnPool = filteredPool.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => !s._isOwn);
  const allDismissed = nonOwnPool.length > 0 && visibleDeck.filter((s: Profile & {_postSubject?: string; _postMeetType?: string; _isOwn?: boolean; _postId?: string}) => !s._isOwn).length === 0;
  const noFilterResults = filteredPool.length === 0 && allStudents.length > 0;
  const curTab = screen;

  const completionFields = [profile.name, profile.uni, profile.major, profile.year, profile.bio];
  const completionPct = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);

  // ── Sub-components ─────────────────────────────────────────────────────
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

  const FallbackCircle = ({name, color, size, ringStyle}: {name:string; color:string; size:number; ringStyle?:React.CSSProperties}) => (
    <div style={{width:size,height:size,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:size*0.31,boxShadow:`0 3px 14px ${color}55`,flexShrink:0,...(ringStyle||{})}}>
      {initials(name||"")}
    </div>
  );

  const UserAvatar = ({p, size=48, ring=false}: {p:Partial<Profile>; size?:number; ring?:boolean}) => {
    const [imgErr, setImgErr] = useState(false);
    const bg = p.avatar_color||"#6C8EF5";
    const ringStyle = ring?{outline:`3px solid ${T.accent}`,outlineOffset:2}:{};
    if (p.photo_mode==="photo"&&p.photo_url&&!imgErr) return (
      <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,boxShadow:"0 3px 14px rgba(0,0,0,0.15)",...ringStyle}}>
        <img src={p.photo_url} alt={p.name ? `${p.name}'s profile photo` : "Profile photo"} width={size} height={size} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={()=>setImgErr(true)}/>
      </div>
    );
    return <FallbackCircle name={p.name||""} color={bg} size={size} ringStyle={ringStyle}/>;
  };

  const Avatar = ({s, size=48}: {s:Profile; size?:number}) => {
    const [imgErr, setImgErr] = useState(false);
    return (
    <div style={{position:"relative",flexShrink:0}}>
      {s.photo_mode==="photo"&&s.photo_url&&!imgErr ? (
        <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",boxShadow:`0 3px 14px rgba(0,0,0,0.15)`}}>
          <img src={s.photo_url} alt={s.name ? `${s.name}'s profile photo` : "Profile photo"} width={size} height={size} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={()=>setImgErr(true)}/>
        </div>
      ) : (
        <div style={{width:size,height:size,borderRadius:"50%",background:s.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:size*0.3,boxShadow:`0 3px 14px ${s.avatar_color||"#6C8EF5"}55`}}>
          {initials(s.name)}
        </div>
      )}
      {s.online&&<div style={{position:"absolute",bottom:1,right:1,width:size*0.23,height:size*0.23,background:T.green,borderRadius:"50%",border:"2px solid "+T.surface}}/>}
    </div>
    );
  };

  const CourseSearch = ({value, onChange, placeholder}: {value:string; onChange:(v:string)=>void; uniFilter?:string; majorFilter?:string; placeholder?:string}) => {
    const [csSearch, setCsSearch] = useState("");
    const [csOpen, setCsOpen] = useState(false);
    const csRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const handler = (e: MouseEvent) => { if (csRef.current && !csRef.current.contains(e.target as Node)) setCsOpen(false); };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);
    // Global course list — not tied to major
    const allCoursesRaw = getCourseGroups().flatMap(([group, courses]) => courses.map(c => ({course:c, group})));
    const seenCs = new Set<string>(); const allCourses = allCoursesRaw.filter(c => { if (seenCs.has(c.course)) return false; seenCs.add(c.course); return true; });
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
    // Group the filtered results by category for display
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

  const timeAgo = (dateStr: string) => {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff/60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins/60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs/24)}d ago`;
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
    <div style={{minHeight:"100dvh",background:T.bg,transition:"background-color 0.3s",overflowX:"hidden"}}>
      <style>{makeCSS(T)}</style>
      {/* ── STICKY NAV ── */}
      <nav className="landing-nav" style={{padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.navBg,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:50,backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)"}}>
        <Logo size={22} compact/>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button className="btn-ghost" style={{padding:"8px 16px",fontSize:12,borderRadius:99}} onClick={()=>{setAuthMode("login");setScreen("auth");}}>Log in</button>
          <button className="btn-primary" style={{padding:"8px 18px",fontSize:12,borderRadius:99,background:"#E8722A",boxShadow:"0 4px 16px rgba(232,114,42,0.3)"}} onClick={()=>{setAuthMode("signup");setScreen("auth");}}>Get started free</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="landing-hero" style={{maxWidth:960,margin:"0 auto",padding:"72px 24px 48px",display:"flex",flexDirection:"column",alignItems:"center",gap:36,position:"relative",overflow:"hidden"}}>
        <div className="mesh-glow" />
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
            {(_uniList.length > 0 ? _uniList.map(u=>u.short_name) : ["PSUT","UJ","GJU","AAU","ASU","MEU","AUM"]).map(u=>(
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
          <span>🎓 7 Universities</span>
          <span>📚 5,800+ Courses</span>
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
                <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={handleOnboard}>Let's go! 🎯</button>
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
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column",transition:"background-color 0.3s"}}>
      <style>{makeCSS(T)}</style>

      {notif&&<div className="notif" style={{background:notif.type==="err"?T.red:T.navy,color:"#fff"}}>{notif.msg}</div>}

      {newBadge&&(
        <div style={{position:"fixed",top:72,left:"50%",transform:"translateX(-50%)",background:T.goldSoft,border:`2px solid ${T.gold}`,borderRadius:20,padding:"16px 24px",zIndex:9998,display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 32px rgba(0,0,0,0.15)",animation:"bounceIn 0.45s ease"}}>
          <span style={{fontSize:36}}>{newBadge.icon}</span>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:T.navy}}>Badge Unlocked! 🎉</div>
            <div style={{fontSize:13,color:T.textSoft}}>{newBadge.name} — +{newBadge.xp} XP</div>
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
            <div style={{width:260,height:260,margin:"0 auto 20px",borderRadius:"50%",overflow:"hidden",border:`3px solid ${T.accent}`,position:"relative",cursor:cropDragging.current?"grabbing":"grab",background:"#f0f0f0",touchAction:"none",boxShadow:`0 0 0 4px ${T.bg}, 0 0 0 5px ${T.border}, 0 8px 32px rgba(0,0,0,0.12)`}}
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
              <UserAvatar p={viewingProfile} size={72} ring/>
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
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><h3 style={{fontSize:17,fontWeight:700,color:T.navy}}>📢 Post a Study Request</h3><p style={{fontSize:12,color:T.muted,marginTop:2}}>Let others know you need help</p></div>
              <button onClick={()=>setShowReqModal(false)} aria-label="Close" style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
            </div>
            <div className="field">
              <label style={{display:"flex",alignItems:"center",gap:5}}>
                Course <span style={{color:T.red,fontSize:13,fontWeight:700}}>*</span>
                {!newReq.subject&&<span style={{fontSize:11,color:T.red,fontWeight:500,marginLeft:2}}>required</span>}
              </label>
              <CourseSearch value={newReq.subject} onChange={v=>setNewReq(p=>({...p,subject:v}))} uniFilter={profile.uni||""} majorFilter={profile.major||""} placeholder="Search for a course..."/>
            </div>
            <div className="field">
              <label style={{display:"flex",alignItems:"center",gap:5}}>
                What do you need help with? <span style={{color:T.red,fontSize:13,fontWeight:700}}>*</span>
                {!newReq.detail?.trim()&&<span style={{fontSize:11,color:T.red,fontWeight:500,marginLeft:2}}>required</span>}
              </label>
              <textarea rows={3} placeholder="e.g. Struggling with integration by parts before Friday's exam." value={newReq.detail} onChange={e=>setNewReq(p=>({...p,detail:e.target.value}))} maxLength={500}/>
            </div>
            <div className="field"><label>Meet preference</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[["online","🎥","Online"],["face","📍","Campus"],["flexible","💬","Flexible"]].map(([val,icon,lbl])=>(
                  <div key={val} className={`meet-opt ${newReq.meetType===val?"active":""}`} onClick={()=>setNewReq(p=>({...p,meetType:val}))}>
                    <div style={{fontSize:18}}>{icon}</div><div style={{fontSize:11,fontWeight:700,marginTop:3,color:newReq.meetType===val?T.accent:T.textSoft}}>{lbl}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" style={{flex:0.45}} onClick={()=>setShowReqModal(false)}>Cancel</button>
              <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14,opacity:(newReq.subject&&newReq.detail?.trim())?1:0.45,cursor:(newReq.subject&&newReq.detail?.trim())?"pointer":"not-allowed"}} onClick={(newReq.subject&&newReq.detail?.trim())?submitRequest:undefined}>Post 📢</button>
            </div>
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
              <CourseSearch value={newSub.subject} onChange={v=>setNewSub(p=>({...p,subject:v}))} uniFilter={profile.uni||""} majorFilter={profile.major||""} placeholder="Search for a subject..."/>
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
              <CourseSearch value={newGrp.subject} onChange={v=>setNewGrp(p=>({...p,subject:v}))} placeholder="Search for a subject..."/>
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
              <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={submitGroup}>Create Room 🎓</button>
            </div>
          </div>
        </div>
      )}

      {/* ── FLOATING BUTTONS ── */}
      {["discover","connections","chat","rooms"].includes(curTab)&&(
        canPost?(
          <button className="fab-post" onClick={openReqModal} aria-label="Post a study request"
            style={{position:"fixed",bottom:28,right:24,background:T.accent,color:"#fff",border:"none",width:56,height:56,borderRadius:"50%",fontSize:26,fontWeight:700,cursor:"pointer",boxShadow:"0 6px 28px rgba(74,124,247,0.45)",zIndex:90,display:"flex",alignItems:"center",justifyContent:"center",transition:"transform 0.2s,box-shadow 0.2s"}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1.08) translateY(-2px)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1)";}}>
            ✏️
          </button>
        ):(
          <button className="fab-post" onClick={enablePosting} aria-label="Enable posting to help others"
            style={{position:"fixed",bottom:28,right:24,background:"linear-gradient(135deg,#2ECC8D,#00B894)",color:"#fff",border:"none",width:56,height:56,borderRadius:"50%",fontSize:26,fontWeight:700,cursor:"pointer",boxShadow:"0 6px 28px rgba(46,204,141,0.45)",zIndex:90,display:"flex",alignItems:"center",justifyContent:"center",transition:"transform 0.2s,box-shadow 0.2s"}}
            title="I can help others!"
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1.08) translateY(-2px)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="scale(1)";}}>
            🤝
          </button>
        )
      )}

      {/* ── TOP NAV ── */}
      <nav className="nav-inner" style={{padding:"13px 22px",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.navBg,borderBottom:`1.5px solid ${T.border}`,position:"sticky",top:0,zIndex:100,gap:10,boxShadow:"0 1px 12px rgba(0,0,0,0.04)"}}>
        <Logo size={22} compact/>
        <div className="tab-nav top-tabs" style={{flex:1,maxWidth:540,margin:"0 10px"}}>
          {([["discover","🔍","Discover"],["connect","💬","Connect"],["rooms","🎓","Rooms"],["ai","🤖","AI"],["profile","👤","Me"],...(isAdmin?[["admin","🛡️","Admin"]]:[])]).map(([tab,icon,lbl])=>(
            <button key={tab} className={`tab-btn ${curTab===tab?"active":""}`} onClick={()=>{setScreen(tab);if(tab==="connect")setActiveChat(null);if(tab==="admin"){loadAdminData();loadAdminAnalytics();}}}><span className="tab-icon">{icon} </span>{lbl}</button>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <div ref={notifPanelRef} style={{position:"relative"}}>
            <button onClick={()=>setShowNotifPanel(p=>!p)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,position:"relative",padding:"3px 5px"}}>
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
          <div style={{cursor:"pointer"}} onClick={()=>setScreen("profile")}><UserAvatar p={profile} size={32} ring={curTab==="profile"}/></div>
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
          <button key={tab} className={`bot-tab ${curTab===tab?"active":""}`}
            onClick={()=>{setScreen(tab);if(tab==="connect")setActiveChat(null);}}>
            <span className="bi">{icon}</span>
            {lbl}
          </button>
        ))}
      </nav>

      {/* ══════════════ DISCOVER ══════════════ */}
      {curTab==="discover"&&(
        <div className="dis-page" style={{flex:1,paddingTop:16,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
          <div className="dis-header" style={{maxWidth:560,margin:"0 auto",padding:"20px 18px 14px",flexShrink:0}}>
            <h2 style={{fontSize:22,fontWeight:800,color:T.navy,marginBottom:4,letterSpacing:"-0.02em"}}>Study Feed</h2>
            <p style={{fontSize:14,color:T.muted,marginBottom:16}}>Students looking for study partners — connect or post your own</p>
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
              <div style={{fontSize:44,marginBottom:12}}>📭</div>
              <div style={{fontWeight:700,fontSize:17,color:T.navy,marginBottom:8}}>No posts yet</div>
              <div style={{fontSize:13,color:T.muted,marginBottom:20}}>Be the first to post a study request and find partners!</div>
              {canPost?<button className="btn-primary" onClick={openReqModal}>Post a Study Request →</button>:<button className="btn-primary" onClick={enablePosting}>Start Posting 🤝</button>}
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
              onMouseDown={e=>{dragStart.current=e.pageY;dragScroll.current=scrollRef.current!.scrollTop;(scrollRef.current as HTMLDivElement).style.cursor="grabbing";}}
              onMouseMove={e=>{if(!dragStart.current)return;scrollRef.current!.scrollTop=dragScroll.current-(e.pageY-dragStart.current);}}
              onMouseUp={()=>{dragStart.current=0;if(scrollRef.current)scrollRef.current.style.cursor="grab";}}
              onMouseLeave={()=>{dragStart.current=0;if(scrollRef.current)scrollRef.current.style.cursor="grab";}}>
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
                    <div className="dis-card-hdr" style={{background:isOwn?`linear-gradient(135deg,${T.accent}15,${T.accent}25)`:`linear-gradient(135deg,${s.avatar_color||"#6C8EF5"}20,${s.avatar_color||"#6C8EF5"}40)`,padding:"20px 24px 16px",borderBottom:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:14}}>
                        <div className="dis-avatar" style={{flexShrink:0}}><Avatar s={s} size={58}/></div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div className="dis-name" style={{fontWeight:700,fontSize:16,color:T.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:isOwn?undefined:"pointer"}} onClick={()=>!isOwn&&openStudentProfile(s.id)}>{s.name}</div>
                            {isOwn&&<span style={{background:T.accent,color:"#fff",padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>Your Post</span>}
                            {!isOwn&&isConnected&&<span style={{background:T.greenSoft,color:T.green,padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>Connected</span>}
                            {!isOwn&&s.online&&<span style={{width:7,height:7,borderRadius:"50%",background:T.green,display:"inline-block",boxShadow:`0 0 0 2px ${T.greenSoft}`,flexShrink:0}}/>}
                          </div>
                          <div className="dis-uni" style={{fontSize:12,color:T.muted,marginTop:2,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.uni} · {s.major} · {s.year}</div>
                        </div>
                        {postTime&&<div style={{fontSize:11,color:T.muted,flexShrink:0,whiteSpace:"nowrap"}}>{postTime}</div>}
                      </div>
                    </div>
                    <div className="dis-card-body" style={{padding:"16px 24px"}}>
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
                    <div className="dis-card-btns" style={{padding:"0 20px 18px",display:"flex",gap:12}}>
                      {isOwn?(
                        <button className="btn-danger" style={{flex:1,padding:"13px 0",fontSize:15,borderRadius:16}} onClick={async()=>{
                          if(!confirm("Delete this post?"))return;
                          await supabase.from("notifications").delete().eq("post_id",s._postId);
                          if(!user)return;
                          const {error,count}=await supabase.from("help_requests").delete({count:"exact"}).eq("id",s._postId).eq("user_id",user.id);
                          if(error){showNotif("Delete failed: "+error.message,"err");return;}
                          if(count===0){showNotif("Could not delete — permission denied. Check Supabase RLS policies.","err");return;}
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
                          <button className="btn-danger" style={{flex:1,padding:"13px 0",fontSize:15,borderRadius:16}} onClick={()=>handleReject(s)}>✕ Pass</button>
                          <button className="btn-success" style={{flex:2,padding:"13px 0",fontSize:15,borderRadius:16,background:T.navy,color:T.bg,border:"none",fontWeight:700}} onClick={()=>handleConnect(s)}>✓ Study Together →</button>
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
      {curTab==="connect"&&(
        <div className="chat-wrap" style={{maxWidth:1200,margin:"0 auto",width:"100%",flex:1,display:"flex",height:"calc(100dvh - 62px)"}}>
          {/* Left sidebar — contact list */}
          <div className={`chat-sidebar${connections.length===0?" chat-sidebar-empty":""}`} style={{width:260,borderRight:`1px solid ${T.border}`,background:T.navBg,overflowY:"auto",flexShrink:0,display:"flex",flexDirection:"column"}}>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${T.border}`}}>
              <div style={{fontSize:14,fontWeight:700,color:T.navy}}>Connections</div>
              <div style={{fontSize:10,color:T.muted,marginTop:1}}>{connections.length} study partner{connections.length!==1?"s":""}</div>
            </div>
            {connections.length===0?(
              <div style={{padding:"24px 14px",textAlign:"center"}}>
                <div style={{fontSize:26,marginBottom:6}}>🤝</div>
                <div style={{fontSize:12,color:T.muted,lineHeight:1.5,marginBottom:12}}>No connections yet</div>
                <button className="btn-primary" style={{padding:"7px 14px",fontSize:11}} onClick={()=>setScreen("discover")}>Find Partners →</button>
              </div>
            ):(
              <div style={{flex:1,overflowY:"auto",padding:"8px 8px"}}>
                {connections.map(s=>(
                  <div key={s.id} className={`conn-row conn-row-mini ${activeChat?.id===s.id?"active":""}`}
                    style={{padding:"10px 12px",borderRadius:12,marginBottom:4,cursor:"pointer",display:"flex",alignItems:"center",gap:10}}
                    onClick={()=>{setActiveChat(s);loadMessages(s.id);}}>
                    <Avatar s={s} size={38}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.navy,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
                      <div style={{fontSize:11,color:s.online?T.green:T.muted,marginTop:1}}>{s.online?"● Online":"● Offline"}{parseCourses(s.course ?? "").length > 0 ? ` · ${parseCourses(s.course ?? "")[0]}` : ""}</div>
                    </div>
                    {ratings[s.id]&&<div style={{fontSize:11,color:"#F5A623"}}>{ratings[s.id]}★</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Right panel — chat or connection cards */}
          <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,minWidth:0}}>
            {!activeChat?(
              connections.length===0?(
                <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,color:T.muted,padding:16}}>
                  <div style={{fontSize:32}}>🔍</div>
                  <div style={{fontSize:15,fontWeight:600,color:T.navy}}>Find your first study partner</div>
                  <div style={{fontSize:12,color:T.muted,textAlign:"center",maxWidth:280}}>Head to the Discover tab to connect with students in your courses</div>
                  <button className="btn-primary" style={{marginTop:6,padding:"9px 18px",fontSize:13}} onClick={()=>setScreen("discover")}>Go to Discover →</button>
                </div>
              ):(
                <div style={{flex:1,overflowY:"auto",padding:20}}>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:4}}>Select a conversation from the left, or browse your partners:</div>
                  </div>
                  <div className="chat-partner-cards" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
                    {connections.map(s=>(
                      <div key={s.id} className="card fade-in" style={{padding:16,cursor:"pointer"}} onClick={()=>{setActiveChat(s);loadMessages(s.id);}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                          <Avatar s={s} size={42}/>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:13,color:T.navy,cursor:"pointer"}} onClick={e=>{e.stopPropagation();openStudentProfile(s.id);}}>{s.name}</div>
                            <div style={{fontSize:11,color:T.muted}}>{s.uni}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <span style={{background:T.accentSoft,color:T.accent,padding:"3px 10px",borderRadius:99,fontSize:10,fontWeight:600}}>{getMeetIcon(s.meet_type)} {getMeetLabel(s.meet_type)}</span>
                          <button style={{background:"none",border:"none",color:T.accent,fontSize:11,fontWeight:600,cursor:"pointer"}} onClick={e=>{e.stopPropagation();setRateModal(s);setHoverStar(0);}}>Rate ⭐</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ):(
              <>
                <div style={{background:T.navBg,padding:"12px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:12}}>
                  <button onClick={()=>setActiveChat(null)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:T.muted,padding:"2px 6px",display:"flex",alignItems:"center"}}>←</button>
                  <Avatar s={activeChat} size={38}/>
                  <div style={{flex:1,cursor:"pointer"}} onClick={()=>openStudentProfile(activeChat.id)}>
                    <div style={{fontWeight:700,fontSize:14,color:T.navy}}>{activeChat.name}</div>
                    <div style={{fontSize:11,color:activeChat.online?T.green:T.muted,fontWeight:500}}>{activeChat.online?"● Online now":"● Offline"}{parseCourses(activeChat.course ?? "").length > 0 ? ` · ${parseCourses(activeChat.course ?? "")[0]}` : ""}</div>
                  </div>
                  <div className="chat-header-actions" style={{display:"flex",gap:6}}>
                    <button className="btn-accent" style={{padding:"7px 14px",fontSize:12,borderRadius:99}} onClick={()=>setSchedModal(activeChat)}>📅 Schedule</button>
                    <button style={{background:T.goldSoft,color:T.gold,border:"none",padding:"7px 14px",borderRadius:99,fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={()=>{setRateModal(activeChat);setHoverStar(0);}}>⭐ Rate</button>
                  </div>
                </div>
                <div style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:8}}>
                  {(messages[activeChat.id]||[]).length===0&&(
                    <div style={{textAlign:"center",padding:"40px 20px",color:T.muted}}>
                      <div style={{fontSize:28,marginBottom:8}}>👋</div>
                      <div style={{fontSize:13}}>Say hello to {activeChat.name.split(" ")[0]}!</div>
                    </div>
                  )}
                  {(messages[activeChat.id]||[]).map(m=>(
                    <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:m.sender_id===user?.id?"flex-end":"flex-start"}}>
                      <div className={m.sender_id===user?.id?"msg-mine":"msg-theirs"} style={{maxWidth:"76%",padding:m.message_type==="image"?"4px":"10px 14px",borderRadius:16,fontSize:13,lineHeight:1.56,overflow:"hidden"}}>
                        {m.message_type==="voice"&&m.file_url?(
                          <div style={{display:"flex",alignItems:"center",gap:8,padding:m.message_type==="image"?"8px 10px":0}}>
                            <span style={{fontSize:18}}>🎤</span>
                            <audio controls preload="metadata" style={{height:36,maxWidth:220}} src={m.file_url}/>
                          </div>
                        ):m.message_type==="image"&&m.file_url?(
                          <img src={m.file_url} alt={m.file_name||"Image"} loading="lazy" style={{maxWidth:"100%",maxHeight:280,borderRadius:12,display:"block",cursor:"pointer"}} onClick={()=>window.open(m.file_url!,"_blank")}/>
                        ):m.message_type==="file"&&m.file_url?(
                          <a href={m.file_url} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:8,color:"inherit",textDecoration:"none"}}>
                            <span style={{fontSize:22}}>📄</span>
                            <div>
                              <div style={{fontWeight:600,fontSize:13,wordBreak:"break-word"}}>{m.file_name||"File"}</div>
                              <div style={{fontSize:11,opacity:0.7}}>Tap to open</div>
                            </div>
                          </a>
                        ):(
                          <>{m.text}</>
                        )}
                      </div>
                      <div style={{fontSize:10,color:T.muted,marginTop:3}}>{new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                    </div>
                  ))}
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
      )}

      {/* ══════════════ GROUP ROOMS ══════════════ */}
      {curTab==="rooms"&&(
        <div className="page-scroll">
          <div style={{maxWidth:720,margin:"0 auto",padding:"24px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div><h2 style={{fontSize:17,fontWeight:700,color:T.navy,marginBottom:4}}>Group Study Rooms</h2><p style={{fontSize:12,color:T.muted}}>Join a session or host your own</p></div>
              <button className="btn-primary" style={{padding:"9px 16px",fontSize:12,flexShrink:0}} onClick={()=>setShowGrpModal(true)}>+ Create Room</button>
            </div>
            {groups.length===0?(
              <div style={{textAlign:"center",padding:"60px 20px"}}>
                <div style={{fontSize:44,marginBottom:12}}>🎓</div>
                <div style={{fontWeight:600,fontSize:16,color:T.navy,marginBottom:6}}>No study rooms yet</div>
                <button className="btn-primary" style={{marginTop:8}} onClick={()=>setShowGrpModal(true)}>Create the First Room</button>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                {groups.map(g=>{
                  const host = g.host as Profile | undefined;
                  const joined = g.joined;
                  const full = g.filled >= g.spots;
                  return(
                    <div key={g.id} className="request-card">
                      <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
                        <div style={{width:42,height:42,borderRadius:"50%",background:host?.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14,flexShrink:0,cursor:"pointer",overflow:"hidden"}} onClick={()=>g.host_id&&openStudentProfile(g.host_id)}>{host?.photo_mode==="photo"&&host?.photo_url?<img src={host.photo_url} alt={host?.name?`${host.name}'s photo`:"Host photo"} width={42} height={42} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";((e.target as HTMLImageElement).parentElement||{} as HTMLElement).textContent=initials(host?.name||"?");}}/>:initials(host?.name||"?")}</div>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                            <span style={{fontWeight:700,fontSize:14,color:T.navy}}>{g.subject}</span>
                            <span style={{background:T.accentSoft,color:T.accent,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>{getMeetIcon(g.type)} {getMeetLabel(g.type)}</span>
                          </div>
                          <div style={{fontSize:12,color:T.muted,marginTop:3}}>Hosted by <span style={{cursor:"pointer",fontWeight:600}} onClick={()=>g.host_id&&openStudentProfile(g.host_id)}>{host?.name||"Unknown"}</span></div>
                          <div style={{fontSize:12,color:T.textSoft,marginTop:2}}>📅 {g.date} at {g.time}</div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:full?T.red:T.green}}>{g.spots-g.filled} spot{g.spots-g.filled!==1?"s":""} left</div>
                          <div style={{fontSize:11,color:T.muted}}>{g.filled}/{g.spots} joined</div>
                        </div>
                      </div>
                      {(g.link||g.location)&&(
                        <div style={{background:T.bg,borderRadius:10,padding:"8px 12px",fontSize:12,color:T.textSoft,marginBottom:10,wordBreak:"break-all"}}>
                          {g.type==="face"?"📍 ":"🔗 "}{g.link||g.location}
                        </div>
                      )}
                      <button
                        style={{background:joined?T.greenSoft:full?T.border:T.navy,color:joined?T.green:full?T.muted:"#fff",border:"none",padding:"10px 20px",borderRadius:99,fontSize:13,fontWeight:700,cursor:full&&!joined?"not-allowed":"pointer",transition:"background-color 0.2s,color 0.2s"}}
                        disabled={!!(full&&!joined)}
                        onClick={()=>toggleJoinGroup(g.id, !!joined)}>
                        {joined?"✓ Joined — Leave":full?"Session Full":"Join Session →"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ AI HUB ══════════════ */}
      {curTab==="ai"&&(
        <div className="page-scroll">
          <div style={{maxWidth:700,margin:"0 auto",padding:"0 16px 20px"}}>
            {/* ── AI Section Title ── */}

            {/* ── Tab Selector — Clean pill strip ── */}
            <div className="ai-tab-row" style={{display:"flex",gap:6,marginBottom:24,marginTop:8,padding:"6px",background:T.bg,borderRadius:16,border:`1px solid ${T.border}`}}>
              {([["wellbeing","🌿","Wellbeing","#10b981"],["tutor","🎓","Tutor","#6366f1"],["match","🎯","Match","#8b5cf6"],["plan","📅","Planner","#ef4444"]] as const).map(([tab,icon,lbl,color])=>(
                <button key={tab} onClick={()=>setAiTab(tab)} style={{
                  flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,padding:"13px 8px",
                  borderRadius:12,border:"none",
                  background:aiTab===tab?T.surface:"transparent",
                  boxShadow:aiTab===tab?"0 2px 12px rgba(0,0,0,0.08)":"none",
                  cursor:"pointer",transition:"all 0.2s",
                }}>
                  <span style={{fontSize:18}}>{icon}</span>
                  <span style={{fontSize:14,fontWeight:aiTab===tab?700:500,color:aiTab===tab?color:T.muted,transition:"color 0.2s"}}>{lbl}</span>
                </button>
              ))}
            </div>

            {/* ── MENTAL HEALTH AI ── */}
            {aiTab==="wellbeing"&&(
              <div className="slide-in">
                {/* Compact intro */}
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"0 2px"}}>
                  <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#10b981,#059669)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0,boxShadow:"0 4px 14px rgba(16,185,129,0.25)"}}>🌿</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:15,color:T.navy}}>Noor — Wellbeing Companion</div>
                    <div style={{fontSize:12,color:T.muted}}>Bilingual · Arabic & English</div>
                  </div>
                </div>

                {/* ── CHAT AREA ── */}
                <div style={{background:T.surface,borderRadius:24,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04),0 8px 40px rgba(16,185,129,0.06)",marginBottom:14}}>
                  {wellbeingMsgs.length===0&&(wellbeingMood||wellbeingMode)&&(
                    <div style={{padding:"12px 20px",background:"linear-gradient(135deg,#f0fdf4,#ecfdf5)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      {wellbeingMood&&<span style={{padding:"4px 12px",borderRadius:99,background:"#d1fae5",fontSize:12,fontWeight:700,color:"#065f46"}}>Feeling: {wellbeingMood}</span>}
                      {wellbeingMode&&<span style={{padding:"4px 12px",borderRadius:99,background:"#a7f3d0",fontSize:12,fontWeight:700,color:"#064e3b"}}>{wellbeingMode}</span>}
                      <span style={{fontSize:12,color:"#047857",fontWeight:500}}>Ready when you are — type below 💚</span>
                    </div>
                  )}
                  <div style={{minHeight:420,maxHeight:"72vh",overflowY:"auto",padding:"24px 22px",display:"flex",flexDirection:"column",gap:14,background:wellbeingMsgs.length===0?"#fafbfc":T.bg,position:"relative"}}>
                    {wellbeingMsgs.length===0&&(()=>{
                      const quotes=[
                        {q:"\"الصبر مفتاح الفرج\"",t:"Patience is the key to relief — Arabic proverb"},
                        {q:"\"In the middle of difficulty lies opportunity\"",t:"Albert Einstein"},
                        {q:"\"You are stronger than you think, braver than you feel\"",t:"A. A. Milne"},
                        {q:"\"ما كلّفَ اللهُ نفساً إلا وسعها\"",t:"Allah does not burden a soul beyond what it can bear — Quran 2:286"},
                        {q:"\"Be gentle with yourself — you are a child of the universe\"",t:"Desiderata"},
                        {q:"\"الجرح اللي ما بيقتلك بيقويك\"",t:"What doesn't break you, makes you stronger — Arab saying"},
                      ];
                      const q=quotes[Math.floor(Date.now()/86400000)%quotes.length];
                      return (
                        <div style={{textAlign:"center",padding:"30px 20px",color:T.muted,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flex:1}}>
                          {/* Orb */}
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
                                style={{padding:"10px 18px",borderRadius:99,border:"none",background:"#ecfdf5",fontSize:13,color:"#065f46",cursor:"pointer",fontWeight:600,transition:"all 0.15s"}}
                                onMouseEnter={e=>{(e.currentTarget).style.background="#d1fae5";}}
                                onMouseLeave={e=>{(e.currentTarget).style.background="#ecfdf5";}}>
                                {q}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {wellbeingMsgs.map((m,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",alignItems:"flex-end",gap:8}}>
                        {m.role==="assistant"&&(
                          <div style={{width:32,height:32,borderRadius:11,background:"linear-gradient(135deg,#059669,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,marginBottom:2}}>🌿</div>
                        )}
                        <div style={{maxWidth:"78%",padding:"14px 18px",borderRadius:m.role==="user"?"20px 20px 4px 20px":"20px 20px 20px 4px",background:m.role==="user"?"linear-gradient(135deg,#059669,#10b981)":"#fff",color:m.role==="user"?"#fff":T.text,border:m.role==="assistant"?"1px solid #e5e7eb":"none",fontSize:15,lineHeight:1.7,boxShadow:m.role==="assistant"?"0 1px 4px rgba(0,0,0,0.04)":"0 2px 8px rgba(5,150,105,0.15)",...(m.role==="user"?{whiteSpace:"pre-wrap" as const}:{})}}>
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
                  </div>
                  <div style={{padding:"16px 20px",borderTop:"1px solid #f0f0f0",background:"#fff",display:"flex",gap:10,alignItems:"flex-end"}}>
                    <textarea value={wellbeingInput} onChange={e=>setWellbeingInput(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),sendWellbeingMessage())}
                      placeholder={wellbeingMode==="Coping tool"?"خبرني شو حاسس — guide me through a calming technique...":wellbeingMode==="I want to vent"?"بحكيلك — this is your space. Start wherever.":"اكتب / Type — Arabic, English, or both."}
                      rows={2}
                      style={{flex:1,padding:"14px 18px",border:"1.5px solid #e5e7eb",borderRadius:16,fontSize:16,color:T.text,background:"#fafbfc",outline:"none",resize:"none",lineHeight:1.6,fontFamily:"inherit",transition:"border-color 0.2s,box-shadow 0.2s"}}
                      onFocus={e=>{(e.target as HTMLTextAreaElement).style.borderColor="#10b981";(e.target as HTMLTextAreaElement).style.boxShadow="0 0 0 3px rgba(16,185,129,0.1)";}}
                      onBlur={e=>{(e.target as HTMLTextAreaElement).style.borderColor="#e5e7eb";(e.target as HTMLTextAreaElement).style.boxShadow="none";}}
                      maxLength={2000}/>
                    <button type="button" onClick={sendWellbeingMessage} disabled={wellbeingLoading||!wellbeingInput.trim()}
                      style={{width:46,height:46,borderRadius:14,background:wellbeingLoading||!wellbeingInput.trim()?"#e5e7eb":"linear-gradient(135deg,#059669,#10b981)",color:wellbeingLoading||!wellbeingInput.trim()?T.muted:"#fff",border:"none",cursor:wellbeingLoading||!wellbeingInput.trim()?"not-allowed":"pointer",fontSize:18,fontWeight:700,transition:"all 0.2s",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:wellbeingLoading||!wellbeingInput.trim()?"none":"0 3px 12px rgba(16,185,129,0.25)"}}>
                      {wellbeingLoading?"···":"↑"}
                    </button>
                  </div>
                </div>

                {wellbeingMsgs.length>0&&(
                  <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center"}}>
                    <button onClick={()=>{setWellbeingMsgs([]);setWellbeingMood("");setWellbeingMode("");}} style={{padding:"7px 16px",borderRadius:99,border:`1px solid ${T.border}`,background:"transparent",color:T.muted,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                      ↺ New conversation
                    </button>
                    <span style={{fontSize:11,color:T.muted}}>Cleared locally — never stored.</span>
                  </div>
                )}

                {/* ── MOOD & MODE SELECTORS (below chat) ── */}
                {wellbeingMsgs.length===0&&(
                  <div style={{background:T.surface,borderRadius:18,border:`1px solid ${T.border}`,padding:18,marginBottom:14}}>
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:13,fontWeight:700,color:T.navy,marginBottom:10}}>How are you feeling right now?</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {[["😊","Good"],["😐","Okay"],["😔","Down"],["😰","Anxious"],["😤","Frustrated"],["😩","Exhausted"],["😶","Numb"]].map(([emoji,label])=>(
                          <button key={label} onClick={()=>setWellbeingMood(wellbeingMood===label?"":label)}
                            style={{padding:"8px 14px",borderRadius:12,border:`1.5px solid ${wellbeingMood===label?"#059669":"#6ee7b755"}`,background:wellbeingMood===label?"#d1fae5":"transparent",fontSize:13,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:58,transition:"border-color 0.15s,background-color 0.15s"}}>
                            <span style={{fontSize:22}}>{emoji}</span>
                            <span style={{fontSize:10,fontWeight:wellbeingMood===label?700:400,color:wellbeingMood===label?"#065f46":T.muted}}>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:T.navy,marginBottom:10}}>What kind of support do you need?</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {[["💭","I want to vent","Just listen, I need to get this out"],["💡","I want advice","Help me think through a problem"],["🧘","Coping tool","Guide me through a calming exercise"]].map(([icon,label,desc])=>(
                          <button key={label} onClick={()=>setWellbeingMode(wellbeingMode===label?"":label)}
                            style={{flex:1,minWidth:120,padding:"10px 12px",borderRadius:13,border:`1.5px solid ${wellbeingMode===label?"#059669":"#6ee7b755"}`,background:wellbeingMode===label?"#d1fae5":T.bg,cursor:"pointer",textAlign:"left",transition:"border-color 0.15s,background-color 0.15s"}}>
                            <div style={{fontSize:18,marginBottom:3}}>{icon}</div>
                            <div style={{fontSize:12,fontWeight:700,color:wellbeingMode===label?"#065f46":T.navy}}>{label}</div>
                            <div style={{fontSize:10,color:T.muted,marginTop:2,lineHeight:1.4}}>{desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick prompts */}
                {wellbeingMsgs.length===0&&(
                  <div style={{marginBottom:14}}>
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
                          style={{padding:"7px 13px",borderRadius:99,border:"1.5px solid #6ee7b755",background:"#f0fdf4",fontSize:12,color:"#047857",cursor:"pointer",fontWeight:500,textAlign:"left",lineHeight:1.4}}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── RESOURCES (collapsible, at bottom) ── */}
                <details style={{marginTop:4}}>
                  <summary style={{fontSize:13,fontWeight:700,color:T.navy,cursor:"pointer",padding:"10px 0",display:"flex",alignItems:"center",gap:8}}>
                    <span>🆘</span> Crisis Resources &amp; Self-Care Toolkit
                  </summary>
                  <div style={{padding:"16px 18px",borderRadius:16,background:"linear-gradient(135deg,#fff7ed,#fffbf0)",border:"1.5px solid #fed7aa",marginTop:8}}>
                    <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:14}}>
                      <div style={{width:40,height:40,borderRadius:12,background:"#fed7aa",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🆘</div>
                      <div>
                        <div style={{fontSize:13,fontWeight:800,color:"#92400e",marginBottom:6}}>الدعم موجود — Help is always available</div>
                        <div style={{fontSize:12,color:"#78350f",lineHeight:2}}>
                          🇯🇴 Jordan Mental Health Hotline: <strong style={{fontFamily:"monospace"}}>06-550-8888</strong><br/>
                          🚨 Emergency: <strong>911</strong><br/>
                          📱 <strong>"Relax" App</strong> — free, anonymous, Arabic support<br/>
                          🏫 Your university counseling center is free &amp; confidential
                        </div>
                      </div>
                    </div>
                    <div style={{borderTop:"1px solid #fed7aa88",paddingTop:14}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:10}}>📚 Trusted Mental Health Resources</div>
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
                          <div key={r.name} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,background:"rgba(255,255,255,0.6)"}}>
                            <span style={{fontSize:18,flexShrink:0}}>{r.icon}</span>
                            <div>
                              <div style={{fontSize:12,fontWeight:700,color:"#78350f"}}>{r.name}</div>
                              <div style={{fontSize:11,color:"#92400e"}}>{r.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{borderTop:"1px solid #fed7aa88",paddingTop:14,marginTop:14}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:10}}>🧘 Self-Care Toolkit</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {[
                          ["🫁","Breathing","4-7-8 technique"],
                          ["😴","Sleep","Hygiene tips"],
                          ["⏰","Pomodoro","Focus method"],
                          ["🧘","Mindfulness","Ground yourself"],
                          ["📝","Journaling","Express feelings"],
                          ["🚶","Movement","Walk & reset"],
                        ].map(([icon,title,desc])=>(
                          <div key={title} style={{flex:"1 1 90px",padding:"10px 12px",borderRadius:10,background:"rgba(255,255,255,0.6)",textAlign:"center",minWidth:85}}>
                            <div style={{fontSize:20,marginBottom:3}}>{icon}</div>
                            <div style={{fontSize:11,fontWeight:700,color:"#78350f"}}>{title}</div>
                            <div style={{fontSize:10,color:"#92400e"}}>{desc}</div>
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
              </div>
            )}

            {/* ── AI TUTOR ── */}
            {aiTab==="tutor"&&(
              <div className="slide-in">
                <div style={{background:T.surface,borderRadius:24,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04),0 8px 40px rgba(99,102,241,0.06)"}}>
                  <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#6366f1,#4f46e5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:"0 4px 12px rgba(99,102,241,0.25)"}}>🎓</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:15,color:T.navy}}>AI Study Tutor</div>
                      <div style={{fontSize:12,color:T.muted}}>Ask anything — concepts, problems, explanations</div>
                    </div>
                    <select value={tutorSubject} onChange={e=>setTutorSubject(e.target.value)}
                      style={{padding:"8px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:12,fontWeight:600,color:T.text,background:"#fafbfc",outline:"none",maxWidth:180}}>
                      <option value="">📚 General</option>
                      {getCourseGroups().map(([cat,list])=>(
                        <optgroup key={cat} label={cat}>{list.map((c,i)=><option key={i} value={c}>{c}</option>)}</optgroup>
                      ))}
                    </select>
                  </div>

                  <div style={{minHeight:420,maxHeight:"72vh",overflowY:"auto",padding:"24px 22px",display:"flex",flexDirection:"column",gap:12,background:tutorMsgs.length===0?"#fafbfc":T.bg,position:"relative"}}>
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
                              style={{padding:"10px 18px",borderRadius:99,border:"none",background:"#eef2ff",fontSize:13,color:"#4338ca",cursor:"pointer",fontWeight:600,transition:"all 0.15s"}}
                              onMouseEnter={e=>{(e.currentTarget).style.background="#e0e7ff";}}
                              onMouseLeave={e=>{(e.currentTarget).style.background="#eef2ff";}}>
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {tutorMsgs.map((m,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                        {m.role==="assistant"&&(
                          <div style={{width:32,height:32,borderRadius:10,background:"linear-gradient(135deg,#6366f1,#4f46e5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,marginRight:8,flexShrink:0,alignSelf:"flex-end",marginBottom:2,boxShadow:"0 2px 8px rgba(99,102,241,0.2)"}}>🎓</div>
                        )}
                        <div className="ai-msg" style={{background:m.role==="user"?"linear-gradient(135deg,#6366f1,#4f46e5)":"#fff",color:m.role==="user"?"#fff":T.text,border:m.role==="assistant"?"1px solid #e5e7eb":"none",boxShadow:m.role==="user"?"0 2px 8px rgba(99,102,241,0.15)":"0 1px 4px rgba(0,0,0,0.04)",fontSize:15,...(m.role==="user"?{}:{whiteSpace:"normal" as const})}}>
                          {m.content ? (m.role==="assistant" ? renderMarkdown(m.content) : m.content) : <span style={{opacity:0.5}}>▌</span>}
                        </div>
                      </div>
                    ))}
                    {tutorLoading&&tutorMsgs[tutorMsgs.length-1]?.role==="user"&&(
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:28,height:28,borderRadius:9,background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🤖</div>
                        <div style={{display:"flex",gap:4,padding:"12px 16px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:16}}>
                          {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:T.accent,animation:`aiTyping 1.4s ${i*0.2}s ease-in-out infinite`}}/>)}
                        </div>
                      </div>
                    )}
                    <div ref={tutorEndRef}/>
                  </div>

                  {tutorFile&&(
                    <div style={{padding:"8px 16px",borderTop:`1px solid ${T.border}`,background:T.accentSoft,display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:16}}>📎</span>
                      <span style={{fontSize:12,fontWeight:600,color:T.accent,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tutorFile.name}</span>
                      <span style={{fontSize:11,color:T.muted}}>{tutorFile.text.length>500?`${(tutorFile.text.length/1000).toFixed(1)}k chars`:`${tutorFile.text.length} chars`}</span>
                      <button onClick={()=>setTutorFile(null)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:16,padding:2}} aria-label="Remove file">×</button>
                    </div>
                  )}
                  <div style={{padding:"16px 20px",borderTop:"1px solid #f0f0f0",background:"#fff",display:"flex",gap:10,alignItems:"flex-end"}}>
                    <input type="file" ref={tutorFileRef} accept=".txt,.pdf,.md,.csv,.json,.js,.ts,.py,.java,.c,.cpp,.html,.css" style={{display:"none"}}
                      onChange={e=>{
                        const f=e.target.files?.[0];if(!f)return;
                        if(f.size>500000){showNotif("File too large (max 500KB)","err");return;}
                        const reader=new FileReader();
                        reader.onload=()=>{setTutorFile({name:f.name,text:reader.result as string});};
                        reader.readAsText(f);
                        e.target.value="";
                      }}/>
                    <button onClick={()=>tutorFileRef.current?.click()} title="Upload course material"
                      style={{width:46,height:46,borderRadius:14,border:"1.5px solid #e5e7eb",background:tutorFile?"#eef2ff":"#fafbfc",color:tutorFile?"#6366f1":T.muted,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
                      📎
                    </button>
                    <input value={tutorInput} onChange={e=>setTutorInput(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendTutorMessage()}
                      placeholder={tutorFile?"Ask about the uploaded file...":"Ask your AI tutor anything..."} maxLength={2000}
                      style={{flex:1,padding:"14px 18px",border:"1.5px solid #e5e7eb",borderRadius:16,fontSize:16,color:T.text,background:"#fafbfc",outline:"none",transition:"border-color 0.2s,box-shadow 0.2s"}}
                      onFocus={e=>{(e.target as HTMLInputElement).style.borderColor="#6366f1";(e.target as HTMLInputElement).style.boxShadow="0 0 0 3px rgba(99,102,241,0.1)";}}
                      onBlur={e=>{(e.target as HTMLInputElement).style.borderColor="#e5e7eb";(e.target as HTMLInputElement).style.boxShadow="none";}}/>
                    <button type="button" onClick={sendTutorMessage} disabled={tutorLoading||!tutorInput.trim()}
                      style={{width:46,height:46,borderRadius:14,background:tutorLoading||!tutorInput.trim()?"#e5e7eb":"linear-gradient(135deg,#6366f1,#4f46e5)",color:tutorLoading||!tutorInput.trim()?T.muted:"#fff",border:"none",cursor:tutorLoading||!tutorInput.trim()?"not-allowed":"pointer",fontSize:18,fontWeight:700,transition:"all 0.2s",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:tutorLoading||!tutorInput.trim()?"none":"0 3px 12px rgba(99,102,241,0.25)"}}>
                      {tutorLoading?"···":"↑"}
                    </button>
                  </div>
                </div>
                {tutorMsgs.length>0&&(
                  <button onClick={()=>setTutorMsgs([])} style={{marginTop:10,padding:"7px 16px",borderRadius:99,border:`1px solid ${T.border}`,background:"transparent",color:T.muted,fontSize:12,cursor:"pointer"}}>Clear conversation</button>
                )}
              </div>
            )}

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
                                <div style={{fontWeight:700,fontSize:14,color:T.navy,cursor:"pointer"}} onClick={e=>{e.stopPropagation();openStudentProfile(s.id);}}>{s.name}</div>
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
                      <button onClick={()=>{setPomodoroActive(true);setPomodoroMode("work");setPomodoroSeconds(25*60);setPomodoroCount(0);}}
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


            {/* ── Language Toggle ── */}
            <div style={{marginTop:20,padding:"14px 18px",borderRadius:16,background:T.surface,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
              <span style={{fontSize:12,fontWeight:600,color:T.muted,marginRight:8}}>🌐 AI Language:</span>
              {([["auto","Auto","🔄"],["en","English","🇬🇧"],["ar","عربي","🇯🇴"]] as const).map(([val,label,flag])=>(
                <button key={val} onClick={()=>setAiLang(val)}
                  style={{padding:"7px 16px",borderRadius:99,fontSize:12,fontWeight:aiLang===val?700:500,
                    border:`1.5px solid ${aiLang===val?T.accent:T.border}`,
                    background:aiLang===val?T.accentSoft:"transparent",
                    color:aiLang===val?T.accent:T.textSoft,
                    cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:5}}>
                  <span>{flag}</span> {label}
                </button>
              ))}
            </div>

            {/* ── AI Hub Footer ── */}
            <div style={{marginTop:14,padding:"20px 18px",borderRadius:20,background:`linear-gradient(135deg,${T.accentSoft},${T.surface})`,border:`1px solid ${T.border}`,textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:8}}>🤖</div>
              {aiLang==="ar"?(
                <>
                  <div style={{fontSize:14,fontWeight:700,color:T.navy,marginBottom:4}} dir="rtl">رفيقك الذكي للدراسة</div>
                  <div style={{fontSize:12,color:T.muted,lineHeight:1.7,marginBottom:8}} dir="rtl">
                    الصحة النفسية · المدرّس · التوافق الذكي · جدول الدراسة
                  </div>
                  <div style={{fontSize:13,color:T.textSoft,lineHeight:1.8,fontStyle:"italic",marginBottom:8}} dir="rtl">
                    «العلم نور والجهل ظلام»
                  </div>
                  <div style={{marginTop:12,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:T.greenSoft,color:T.green}}>عربي بالكامل</span>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:T.accentSoft,color:T.accent}}>خصوصية تامة</span>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:"#fef3c7",color:"#92400e"}}>صنع في الأردن 🇯🇴</span>
                  </div>
                  <div style={{marginTop:12,fontSize:10,color:T.muted}} dir="rtl">
                    Bas Udrus AI · {aiVersion} · المحادثات خاصة ولا يتم تخزينها على خوادمنا
                  </div>
                </>
              ):aiLang==="en"?(
                <>
                  <div style={{fontSize:14,fontWeight:700,color:T.navy,marginBottom:4}}>Your AI Study Companion</div>
                  <div style={{fontSize:12,color:T.muted,lineHeight:1.7,marginBottom:8}}>
                    Wellbeing · Tutor · Smart Match · Study Planner
                  </div>
                  <div style={{fontSize:13,color:T.textSoft,lineHeight:1.8,fontStyle:"italic",marginBottom:8}}>
                    "Knowledge is light, and ignorance is darkness"
                  </div>
                  <div style={{marginTop:12,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:T.greenSoft,color:T.green}}>English Only</span>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:T.accentSoft,color:T.accent}}>Privacy First</span>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:"#fef3c7",color:"#92400e"}}>Built for Jordan</span>
                  </div>
                  <div style={{marginTop:12,fontSize:10,color:T.muted}}>
                    Bas Udrus AI · {aiVersion} · Conversations are private & never stored on our servers
                  </div>
                </>
              ):(
                <>
                  <div style={{fontSize:14,fontWeight:700,color:T.navy,marginBottom:4}}>Your AI Study Companion</div>
                  <div style={{fontSize:12,color:T.muted,lineHeight:1.7,marginBottom:8}}>
                    Wellbeing · Tutor · Smart Match · Study Planner
                  </div>
                  <div style={{fontSize:13,color:T.textSoft,lineHeight:1.8,fontStyle:"italic",marginBottom:8}} dir="rtl">
                    «العلم نور والجهل ظلام»
                  </div>
                  <div style={{fontSize:11,color:T.muted,lineHeight:1.6}}>
                    Knowledge is light, and ignorance is darkness — Arabic proverb
                  </div>
                  <div style={{marginTop:12,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:T.greenSoft,color:T.green}}>Arabic & English</span>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:T.accentSoft,color:T.accent}}>Privacy First</span>
                    <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:"#fef3c7",color:"#92400e"}}>Built for Jordan</span>
                  </div>
                  <div style={{marginTop:12,fontSize:10,color:T.muted}}>
                    Bas Udrus AI · {aiVersion} · Conversations are private & never stored on our servers
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ══════════════ PROFILE ══════════════ */}
      {curTab==="profile"&&(
        <div className="page-scroll">
          <div style={{maxWidth:680,margin:"0 auto",padding:"24px 20px"}}>
            <div style={{background:T.surface,borderRadius:22,padding:24,border:`1px solid ${T.border}`,marginBottom:18,boxShadow:"0 2px 20px rgba(0,0,0,0.05)"}}>
              <div className="prof-hdr" style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
                <div className="profile-avatar-wrap"><UserAvatar p={editProfile||profile} size={64} ring/></div>
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
                        <UserAvatar p={editProfile||profile} size={64} ring/>
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
                          <div style={{fontSize:11,color:T.muted,marginTop:4}}>JPG or PNG, max 2 MB</div>
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
                      <button className="btn-primary" style={{flex:1,padding:13,borderRadius:14}} onClick={saveProfile}>Save Changes</button>
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
                                    const{error}=await supabase.from("help_requests").delete().eq("id",r.id).eq("user_id",user.id);
                                    if(!error){setHelpRequests(prev=>prev.filter(x=>x.id!==r.id));showNotif("Post removed");}
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
                    <UserAvatar p={profile} size={56} ring/>
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
                      <button className="btn-ghost" style={{width:"100%",textAlign:"left",padding:"14px 18px",borderRadius:14,display:"flex",alignItems:"center",gap:12}} onClick={()=>{const newPass=prompt("Enter your new password (min 6 characters):");if(newPass&&newPass.trim().length>=6){supabase.auth.updateUser({password:newPass.trim()}).then(({error})=>{if(error)showNotif("Error: "+error.message,"err");else showNotif("Password updated!");});}else if(newPass){showNotif("Password must be at least 6 characters.","err");}}}>
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
        <div className="page-scroll">
          <div style={{maxWidth:800,margin:"0 auto",padding:"24px 20px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
              <div style={{width:48,height:48,borderRadius:14,background:T.red+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>🛡️</div>
              <div>
                <h2 style={{fontSize:20,fontWeight:800,color:T.navy,margin:0}}>Admin Dashboard</h2>
                <p style={{fontSize:13,color:T.muted,margin:0}}>Manage reports, posts & analytics</p>
              </div>
            </div>

            <div style={{display:"flex",gap:3,marginBottom:20,background:T.bg,padding:4,borderRadius:99,width:"fit-content",border:`1px solid ${T.border}`,flexWrap:"wrap"}}>
              {[["analytics","📊 Analytics"],["reports","🚩 Reports"],["posts","📢 All Posts"]].map(([tab,lbl])=>(
                <button key={tab} className={`sub-tab ${adminTab===tab?"active":""}`}
                  onClick={()=>setAdminTab(tab)}>{lbl}</button>
              ))}
            </div>

            {adminTab==="analytics"&&(
              <div className="slide-in">
                {!adminAnalytics?(
                  <div style={{textAlign:"center",padding:"40px 20px",color:T.muted}}>Loading analytics...</div>
                ):(()=>{
                  const a = adminAnalytics;
                  const SUBJ_COLORS = ["#378ADD","#1D9E75","#7F77DD","#D4537E","#EF9F27","#639922","#D85A30","#185FA5","#0F6E56","#BA7517"];
                  const maxSubj = a.topSubjects[0]?.[1] || 1;
                  const chartData = a.months6 || [];
                  const W=480,H=140,PAD={t:10,b:28,l:40,r:10};
                  const vals = chartData.map((d:{posts:number;month:string})=>d.posts);
                  const minV = Math.min(...vals), maxV = Math.max(...vals, 1);
                  const xs = chartData.map((_:{posts:number;month:string},i:number)=>PAD.l+(i/(Math.max(chartData.length-1,1)))*(W-PAD.l-PAD.r));
                  const ys = vals.map((v:number)=>PAD.t+((maxV-v)/(maxV-minV||1))*(H-PAD.t-PAD.b));
                  const pts = xs.map((x:number,i:number)=>`${x},${ys[i]}`).join(" ");
                  const area = chartData.length>1?`M${xs[0]},${ys[0]} `+xs.slice(1).map((x:number,i:number)=>`L${x},${ys[i+1]}`).join(" ")+` L${xs[xs.length-1]},${H-PAD.b} L${xs[0]},${H-PAD.b} Z`:"";
                  const rResolved = a.resolvedReports || 0;
                  const rUnresolved = a.unresolvedReports || 0;
                  const donutR=48,CX=70,CY=60,sw=14,circ=2*Math.PI*donutR;
                  const resolvedArc = a.totalReports>0?(rResolved/a.totalReports)*circ:0;
                  const unresolvedArc = a.totalReports>0?(rUnresolved/a.totalReports)*circ:0;

                  return(
                  <>
                    <div style={{marginBottom:20}}>
                      <p style={{fontSize:13,color:T.muted}}>Live data from Supabase</p>
                    </div>

                    <div className="admin-kpi" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
                      {[
                        {label:"Total posts",value:a.totalPosts,sub:`+${a.postsMonth} this month`,accent:"#378ADD"},
                        {label:"Active users",value:a.totalUsers,sub:`+${a.usersMonth} this month`,accent:"#1D9E75"},
                        {label:"Reported accounts",value:a.totalReports,sub:`${rUnresolved} unresolved`,accent:"#E24B4A"},
                        {label:"New registrations",value:a.usersMonth,sub:"this month",accent:"#7F77DD"},
                      ].map(m=>(
                        <div key={m.label} style={{background:"rgba(128,128,128,0.06)",borderRadius:10,padding:"14px 18px"}}>
                          <p style={{fontSize:12,color:T.muted,marginBottom:6}}>{m.label}</p>
                          <p style={{fontSize:24,fontWeight:600,color:m.accent,lineHeight:1,margin:0}}>{m.value}</p>
                          <p style={{fontSize:12,color:T.muted,marginTop:5,margin:0}}>{m.sub}</p>
                        </div>
                      ))}
                    </div>

                    <div className="admin-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                      <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                        <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Post activity — last 6 months</p>
                        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:"block"}}>
                          <defs>
                            <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#378ADD" stopOpacity={0.2}/>
                              <stop offset="100%" stopColor="#378ADD" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          {[0,0.5,1].map(t=>{const y=PAD.t+t*(H-PAD.t-PAD.b);return <line key={t} x1={PAD.l} x2={W-PAD.r} y1={y} y2={y} stroke="rgba(128,128,128,0.12)" strokeWidth="1"/>;})}
                          {area&&<path d={area} fill="url(#aGrad)"/>}
                          {chartData.length>1&&<polyline points={pts} fill="none" stroke="#378ADD" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>}
                          {xs.map((x:number,i:number)=><circle key={i} cx={x} cy={ys[i]} r="3.5" fill="#378ADD" stroke={T.surface} strokeWidth="1.5"/>)}
                          {chartData.map((d:any,i:number)=><text key={i} x={xs[i]} y={H-6} textAnchor="middle" fontSize="10" fill={T.muted}>{d.month}</text>)}
                          {[minV,Math.round((minV+maxV)/2),maxV].map((v:number,i:number)=>{const y=PAD.t+((maxV-v)/(maxV-minV||1))*(H-PAD.t-PAD.b);return <text key={i} x={PAD.l-5} y={y+4} textAnchor="end" fontSize="10" fill={T.muted}>{v}</text>;})}
                        </svg>
                      </div>

                      <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                        <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Most popular subjects</p>
                        {a.topSubjects.length===0?(
                          <div style={{fontSize:12,color:T.muted,textAlign:"center",padding:20}}>No posts yet</div>
                        ):(
                          a.topSubjects.map(([subj,cnt]:[string,number],i:number)=>(
                            <div key={subj} style={{marginBottom:8}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                                <span style={{fontSize:12,color:T.textSoft}}>{i+1}. {subj}</span>
                                <span style={{fontSize:12,fontWeight:600,color:T.navy}}>{cnt}</span>
                              </div>
                              <div style={{height:6,background:"rgba(128,128,128,0.1)",borderRadius:4,overflow:"hidden"}}>
                                <div style={{height:"100%",borderRadius:4,width:`${Math.round((cnt/maxSubj)*100)}%`,background:SUBJ_COLORS[i%SUBJ_COLORS.length],transition:"width 0.6s ease"}}/>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="admin-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                        <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Most active users</p>
                        {a.topActiveUsers.length===0?(
                          <div style={{fontSize:12,color:T.muted,textAlign:"center",padding:20}}>No activity yet</div>
                        ):(
                          a.topActiveUsers.map((u:any,i:number)=>{
                            const colors = [
                              {bg:"#CECBF6",text:"#3C3489"},
                              {bg:"#9FE1CB",text:"#085041"},
                              {bg:"#F4C0D1",text:"#72243E"},
                              {bg:"#B5D4F4",text:"#0C447C"},
                              {bg:"#FAC775",text:"#633806"},
                            ];
                            const c = colors[i%colors.length];
                            const ini = u.name.split(" ").map((w:string)=>w[0]).join("").slice(0,2).toUpperCase();
                            return(
                              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`0.5px solid ${T.border}`}}>
                                <div style={{width:30,height:30,borderRadius:"50%",background:c.bg,color:c.text,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,flexShrink:0}}>{ini}</div>
                                <span style={{flex:1,fontSize:13,color:T.navy}}>{u.name}</span>
                                <span style={{fontSize:12,color:T.muted}}>{u.count} posts</span>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px"}}>
                        <p style={{fontSize:14,fontWeight:600,color:T.navy,marginBottom:14}}>Reports overview</p>
                        <div style={{display:"flex",alignItems:"center",gap:24}}>
                          <svg viewBox="0 0 140 120" width="140" style={{display:"block",flexShrink:0}}>
                            <circle cx={CX} cy={CY} r={donutR} fill="none" stroke="rgba(128,128,128,0.1)" strokeWidth={sw}/>
                            {a.totalReports>0&&<circle cx={CX} cy={CY} r={donutR} fill="none" stroke="#1D9E75" strokeWidth={sw} strokeDasharray={`${resolvedArc} ${circ}`} strokeDashoffset={circ/4} strokeLinecap="round"/>}
                            {a.totalReports>0&&<circle cx={CX} cy={CY} r={donutR} fill="none" stroke="#E24B4A" strokeWidth={sw} strokeDasharray={`${unresolvedArc} ${circ}`} strokeDashoffset={circ/4-resolvedArc} strokeLinecap="round"/>}
                            <text x={CX} y={CY-4} textAnchor="middle" fontSize="18" fontWeight="600" fill={T.navy}>{a.totalReports}</text>
                            <text x={CX} y={CY+14} textAnchor="middle" fontSize="10" fill={T.muted}>total</text>
                          </svg>
                          <div style={{flex:1}}>
                            {[
                              {label:"Resolved",value:rResolved,color:"#1D9E75",bg:"#E1F5EE"},
                              {label:"Unresolved",value:rUnresolved,color:"#A32D2D",bg:"#FCEBEB"},
                            ].map(r=>(
                              <div key={r.label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:r.bg,marginBottom:8}}>
                                <span style={{fontSize:13,color:r.color,fontWeight:500}}>{r.label}</span>
                                <span style={{fontSize:20,fontWeight:700,color:r.color}}>{r.value}</span>
                              </div>
                            ))}
                            <p style={{fontSize:11,color:T.muted,marginTop:10}}>
                              {a.totalReports>0?`${Math.round((rResolved/a.totalReports)*100)}% resolution rate`:"No reports yet"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                  );
                })()}
              </div>
            )}

            {adminTab==="reports"&&(
              <div className="slide-in">
                <div style={{marginBottom:16}}>
                  <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:4}}>Reported Accounts</h3>
                  <p style={{fontSize:12,color:T.muted}}>{adminReports.length} report{adminReports.length!==1?"s":""}</p>
                </div>
                {adminReports.length===0?(
                  <div style={{textAlign:"center",padding:"50px 20px"}}>
                    <div style={{fontSize:40,marginBottom:12}}>✅</div>
                    <div style={{fontWeight:600,fontSize:15,color:T.navy}}>No reports yet</div>
                    <div style={{fontSize:13,color:T.muted,marginTop:6}}>All accounts are in good standing</div>
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    {adminReports.map(r=>{
                      const reported: any = r.reported;
                      const reporter: any = r.reporter;
                      return(
                        <div key={r.id} className="card" style={{padding:18}}>
                          <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                            <div style={{width:44,height:44,borderRadius:"50%",background:reported?.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14,flexShrink:0,overflow:"hidden",cursor:"pointer"}} onClick={()=>reported&&setViewingProfile(reported)}>
                              {reported?.photo_mode==="photo"&&reported?.photo_url?<img src={reported.photo_url} alt={reported?.name?`${reported.name}'s photo`:"Reported user photo"} width={40} height={40} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";((e.target as HTMLImageElement).parentElement||{} as HTMLElement).textContent=initials(reported?.name||"?");}}/>:initials(reported?.name||"?")}
                            </div>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                                <span style={{fontWeight:700,fontSize:15,color:T.navy,cursor:"pointer"}} onClick={()=>reported&&setViewingProfile(reported)}>{reported?.name||"Unknown"}</span>
                                <span style={{background:T.red+"15",color:T.red,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>Reported</span>
                              </div>
                              <div style={{fontSize:12,color:T.muted,marginBottom:6}}>{reported?.email||"--"} · {reported?.uni||"--"}</div>
                              <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",fontSize:13,color:T.textSoft,lineHeight:1.6,marginBottom:6}}>
                                <strong style={{color:T.navy}}>Reason:</strong> {r.reason}
                              </div>
                              <div style={{fontSize:11,color:T.muted}}>
                                Reported by {reporter?.name||"Unknown"} · {new Date(r.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {adminTab==="posts"&&(
              <div className="slide-in">
                <div style={{marginBottom:16}}>
                  <h3 style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:4}}>All Discover Posts</h3>
                  <p style={{fontSize:12,color:T.muted}}>{adminPosts.length} post{adminPosts.length!==1?"s":""} total</p>
                </div>
                {adminPosts.length===0?(
                  <div style={{textAlign:"center",padding:"50px 20px"}}>
                    <div style={{fontSize:40,marginBottom:12}}>📭</div>
                    <div style={{fontWeight:600,fontSize:15,color:T.navy}}>No posts yet</div>
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {adminPosts.map(p=>{
                      const pProfile: any = p.profile;
                      return(
                        <div key={p.id} className="card" style={{padding:16}}>
                          <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                            <div style={{width:40,height:40,borderRadius:"50%",background:pProfile?.avatar_color||"#6C8EF5",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:13,flexShrink:0,overflow:"hidden"}}>
                              {pProfile?.photo_mode==="photo"&&pProfile?.photo_url?<img src={pProfile.photo_url} alt={pProfile?.name?`${pProfile.name}'s photo`:"User photo"} width={40} height={40} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";((e.target as HTMLImageElement).parentElement||{} as HTMLElement).textContent=initials(pProfile?.name||"?");}}/>:initials(pProfile?.name||"?")}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2}}>
                                <span style={{fontWeight:700,fontSize:14,color:T.navy}}>{pProfile?.name||"Unknown"}</span>
                                <span style={{background:T.accentSoft,color:T.accent,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>📚 {p.subject}</span>
                              </div>
                              <div style={{fontSize:12,color:T.muted,marginBottom:4}}>{pProfile?.uni||""} · {new Date(p.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                              {p.detail&&<p style={{fontSize:13,color:T.textSoft,lineHeight:1.5,margin:0}}>{p.detail}</p>}
                            </div>
                            <button className="btn-danger" style={{padding:"8px 14px",fontSize:12,borderRadius:10,flexShrink:0}} onClick={()=>adminDeletePost(p.id)}>Delete</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
