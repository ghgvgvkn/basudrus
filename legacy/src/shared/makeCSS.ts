import type { Theme } from "@/lib/constants";

export const makeCSS = (T: Theme) => `
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; -webkit-text-size-adjust:100%; text-size-adjust:100%; touch-action:manipulation; }
  body { font-family:'Plus Jakarta Sans',sans-serif; background:${T.bg}; color:${T.text}; -webkit-font-smoothing:antialiased; transition:background-color 0.3s,color 0.3s; overflow-x:hidden; touch-action:manipulation; }
  @media (max-width: 768px) {
    input, textarea, select { font-size:16px !important; }
  }
  * { touch-action:manipulation; }
  .s-card,.card,.request-card,.notif { will-change:auto; contain:layout style; }
  .modal { will-change:auto; contain:style; }
  @supports(-webkit-touch-callout:none){ input,select,textarea { font-size:max(16px,1em); } }
  input,select,textarea,button { font-family:'Plus Jakarta Sans',sans-serif; }
  input:focus,select:focus,textarea:focus { outline:none; border-color:${T.accent}!important; box-shadow:0 0 0 3px ${T.accentSoft}!important; }
  ::-webkit-scrollbar { width:4px; height:4px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:99px; }
  .scroll-col { display:flex; flex-direction:column; gap:16px; overflow-y:auto; overflow-x:hidden; padding:8px 16px 120px; scroll-snap-type:y proximity; -webkit-overflow-scrolling:touch; flex:1; min-height:0; overscroll-behavior:contain; }
  .page-scroll { overflow-y:auto; height:calc(100dvh - 62px); }
  .s-card { flex:0 0 auto; width:100%; max-width:500px; margin:0 auto; scroll-snap-align:start; background:${T.surface}; border-radius:22px; border:1px solid ${T.border}; box-shadow:0 8px 24px rgba(0,0,0,0.06); overflow:hidden; transition:box-shadow 0.3s ease, border-color 0.3s ease; }
  @media (hover: hover) { .s-card:hover { box-shadow:0 22px 50px rgba(0,0,0,0.12); border:1px solid ${T.accent}44; } }
  @keyframes flyUp    { to { transform:translateY(-130%) scale(0.85); opacity:0; } }
  @keyframes flyDown  { to { transform:translateY(130%) scale(0.85); opacity:0; } }
  @keyframes fadeIn   { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  @keyframes slideIn  { from { opacity:0; transform:translateX(24px); } to { opacity:1; transform:translateX(0); } }
  @keyframes popIn    { from { opacity:0; transform:scale(0.93); } to { opacity:1; transform:scale(1); } }
  @keyframes shimmer  { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
  @keyframes pulse    { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
  @keyframes orbFloat { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-8px) scale(1.03)} }
  @keyframes bounceIn { 0%{transform:scale(0.3);opacity:0} 60%{transform:scale(1.05)} 100%{transform:scale(1);opacity:1} }
  @keyframes slideDown { 0%{transform:translateY(-100%)} 100%{transform:translateY(0)} }
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
  .card { background:${T.surface}; border-radius:18px; border:1px solid ${T.border}; box-shadow: 0 4px 16px rgba(0,0,0,0.04); transition:box-shadow 0.3s ease; }
  @media (hover: hover) { .card:hover { box-shadow:0 16px 40px rgba(0,0,0,0.08); } }
  .request-card { background:${T.surface}; border-radius:16px; padding:18px; border:1px solid ${T.border}; box-shadow: 0 4px 14px rgba(0,0,0,0.03); transition:box-shadow 0.3s ease; }
  @media (hover: hover) { .request-card:hover { box-shadow:0 12px 32px rgba(0,0,0,0.08); } }
  .streak-badge { display:inline-flex; align-items:center; gap:5px; background:linear-gradient(135deg,#C44D1A,#B07D00); color:#fff; padding:5px 12px; border-radius:99px; font-size:12px; font-weight:700; }
  .ai-msg { padding:16px 20px; border-radius:24px; font-size:15px; line-height:1.6; max-width:85%; animation:fadeIn 0.3s ease; word-break:break-word; border:1px solid rgba(255,255,255,0.4); box-shadow: 0 4px 16px rgba(0,0,0,0.03); }
  .ai-msg b { font-weight:700; }
  .msg-mine, .ai-msg.user { background: linear-gradient(135deg, ${T.accent}, #6C8EF5); color: #fff; border-bottom-right-radius: 6px; border:none; box-shadow: 0 6px 20px rgba(74, 124, 247, 0.25); }
  .msg-theirs, .ai-msg.assistant { background: linear-gradient(135deg, ${T.surface}, ${T.bg}); color: ${T.text}; border-bottom-left-radius: 6px; }
  .match-score-high { background:linear-gradient(135deg,#0E7E5A,#0A6B4C); color:#fff; }
  .match-score-mid { background:linear-gradient(135deg,#B07D00,#9B6E00); color:#fff; }
  .match-score-low { background:linear-gradient(135deg,#6B7280,#596673); color:#fff; }
  .plan-output { white-space:pre-wrap; font-size:14px; line-height:1.85; color:${T.text}; }
  button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible { outline:2.5px solid ${T.accent}; outline-offset:2px; }
  @media(prefers-reduced-motion:reduce){ *,*::before,*::after { animation-duration:0.01ms!important; transition-duration:0.01ms!important; } }
  .nav-inner { backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .scroll-to-bottom {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: ${T.navy};
    color: ${T.bg};
    border: none;
    cursor: pointer;
    font-size: 16px;
    font-weight: 700;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeInUp 0.2s ease;
    transition: opacity 0.2s, transform 0.2s;
  }
  .scroll-to-bottom:hover {
    transform: translateX(-50%) scale(1.1);
  }
  @keyframes fabTooltip {
    0% { opacity: 0; transform: translateX(8px); }
    10% { opacity: 1; transform: translateX(0); }
    80% { opacity: 1; transform: translateX(0); }
    100% { opacity: 0; transform: translateX(8px); }
  }
  .fab-tooltip {
    position: fixed;
    bottom: 36px;
    right: 86px;
    background: ${T.navy};
    color: ${T.bg};
    padding: 8px 14px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    z-index: 89;
    animation: fabTooltip 5s ease forwards;
    pointer-events: none;
  }
  .fab-tooltip::after {
    content: '';
    position: absolute;
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    border: 6px solid transparent;
    border-left-color: ${T.navy};
  }
  .ai-chat-wrap {
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 62px);
    background: ${T.bg};
    overflow: hidden;
  }
  .ai-chat-topbar {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    gap: 12px;
    border-bottom: 1px solid ${T.border};
    background: ${T.surface};
    flex-shrink: 0;
  }
  .ai-chat-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
  }
  .chat-scroll { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
  .ai-chat-input {
    padding: 12px 16px;
    border-top: 1px solid ${T.border};
    background: ${T.surface};
    display: flex;
    gap: 10px;
    align-items: flex-end;
    flex-shrink: 0;
  }
  @keyframes orbPulse {
    0%,100% { transform:scale(1); box-shadow:0 0 50px rgba(251,146,60,0.18),0 0 100px rgba(168,85,247,0.1),0 8px 32px rgba(139,92,246,0.15); }
    50%     { transform:scale(1.08); box-shadow:0 0 70px rgba(251,146,60,0.28),0 0 120px rgba(168,85,247,0.18),0 12px 40px rgba(139,92,246,0.22); }
  }
  @keyframes aiTyping {
    0%,80%,100% { opacity:0.3; transform:scale(0.85); }
    40%         { opacity:1;   transform:scale(1); }
  }
  @keyframes orbit {
    0% { transform: rotate(0deg) translateX(30px) rotate(0deg); }
    100% { transform: rotate(360deg) translateX(30px) rotate(-360deg); }
  }
  .mesh-glow {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: radial-gradient(ellipse 80% 60% at 25% 40%, rgba(74, 124, 247, 0.10), transparent 60%),
                radial-gradient(ellipse 70% 50% at 75% 25%, rgba(67, 197, 158, 0.10), transparent 60%),
                radial-gradient(ellipse 60% 40% at 50% 80%, rgba(232, 114, 42, 0.05), transparent 50%);
    filter: blur(80px);
    z-index: 0;
    pointer-events: none;
  }
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
    .landing-feat:nth-child(1) { grid-column: span 2; padding: 40px; }
    .landing-feat:nth-child(1) .landing-feat-icon { font-size: 42px; margin-bottom: 18px; }
    .landing-feat:nth-child(1) h3 { font-size: 22px; }
    .landing-feat:nth-child(1) p { font-size: 15px; }
    .landing-feat:nth-child(4) { grid-column: span 2; }
    .landing-feat:nth-child(7) { grid-column: span 3; }
  }
  .page-scroll > div { animation:fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
  details summary { min-height:44px; display:flex; align-items:center; }
  details summary::-webkit-details-marker { display:none; }
  details summary::before { content:"▸"; margin-right:8px; transition:transform 0.2s; font-size:12px; color:${T.muted}; }
  details[open] summary::before { transform:rotate(90deg); }
  .xp-bar-fill { background:linear-gradient(90deg,${T.accent},#6C8EF5); height:100%; border-radius:99px; transition:transform 0.8s cubic-bezier(0.4,0,0.2,1); transform-origin:left; will-change:transform; }
  .star { font-size:18px; cursor:pointer; transition:transform 0.1s; }
  .star:hover { transform:scale(1.2); }
  .notif { position:fixed; top:20px; left:50%; transform:translateX(-50%); padding:13px 26px; border-radius:99px; font-size:14px; font-weight:600; z-index:9999; white-space:nowrap; box-shadow:0 6px 30px rgba(0,0,0,0.18); animation:popIn 0.28s ease; max-width:90vw; overflow:hidden; text-overflow:ellipsis; }
  .modal-bg { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:300; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(4px); animation:fadeIn 0.2s ease; overscroll-behavior:contain; }
  .modal { background:${T.surface}; border-radius:24px; padding:28px; width:100%; max-width:460px; box-shadow:0 24px 80px rgba(0,0,0,0.25); animation:popIn 0.28s ease; max-height:92dvh; overflow-y:auto; border:1px solid ${T.border}; overscroll-behavior:contain; }
  .progress-track { background:${T.border}; border-radius:99px; height:6px; overflow:hidden; }
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
    /* Mobile chat tweaks — compact header, readable bubbles, wider bubbles on narrow screens */
    .chat-header-bar { padding:10px 12px!important; gap:10px!important; }
    .chat-header-bar > button:first-child { font-size:24px!important; padding:4px 6px!important; }
    .chat-header-name { font-size:15px!important; }
    .chat-header-status { font-size:12px!important; }
    .chat-header-actions { gap:4px!important; flex-wrap:nowrap!important; }
    .chat-header-actions button { padding:6px 10px!important; font-size:11px!important; }
    .msg-bubble { max-width:85%!important; font-size:15px!important; line-height:1.45!important; padding:11px 15px!important; }
    .msg-bubble audio { max-width:100%!important; width:100%!important; }
    .chat-partner-cards { grid-template-columns:1fr!important; gap:8px!important; padding:12px!important; }
    .conn-course-hide{ display:none; }
    .dis-page  { height:calc(100dvh - 52px)!important; padding-top:0!important; }
    .dis-header{ padding:8px 12px 4px!important; }
    .dis-header h2 { font-size:15px!important; margin-bottom:1px!important; }
    .dis-header p  { display:none!important; }
    .dis-filter-row{ display:flex!important; flex-wrap:wrap!important; overflow-x:unset!important; gap:6px!important; padding-bottom:0!important; }
    .dis-filter-sel{ flex:0 0 calc(50% - 3px)!important; min-width:0!important; max-width:none!important; padding:9px 10px!important; font-size:12px!important; border-radius:11px!important; }
    .dis-course-box { flex:0 0 100%!important; }
    .dis-filter-meet { flex:0 0 100%!important; }
    .dis-clear-btn { flex:0 0 100%!important; }
    .dis-count { padding:0 12px 2px!important; flex-shrink:0; }
    .scroll-col{ min-height:0!important; padding:4px 10px 20px!important; gap:10px!important; }
    .s-card    { border-radius:16px!important; }
    .dis-card-hdr{ padding:14px 14px 10px!important; }
    .dis-card-body{ padding:10px 14px!important; }
    .dis-card-btns{ padding:0 12px 12px!important; gap:8px!important; }
    .dis-avatar { width:50px!important; height:50px!important; flex-shrink:0!important; }
    .dis-name  { font-size:15px!important; }
    .dis-uni   { font-size:11px!important; margin-top:2px!important; }
    .dis-major { font-size:11px!important; margin-top:1px!important; }
    .dis-online{ font-size:11px!important; }
    .dis-sessions{ font-size:10px!important; }
    .dis-meet-pill { padding:4px 10px!important; font-size:11px!important; }
    .dis-card-body > div:first-child { gap:5px!important; flex-wrap:wrap!important; }
    .dis-chip { padding:4px 10px!important; font-size:11px!important; }
    .dis-bio { font-size:13px!important; line-height:1.55!important; margin-bottom:10px!important; }
    .dis-card-btns .btn-danger  { font-size:13px!important; padding:11px 0!important; }
    .dis-card-btns .btn-success { font-size:13px!important; padding:11px 0!important; }
    .fab-post  { bottom:82px!important; right:14px!important; width:50px!important; height:50px!important; border-radius:14px!important; font-size:22px!important; padding:0!important; }
    .ai-chat-wrap { height: calc(100dvh - 120px); }
    .fab-tooltip { bottom: 90px; right: 72px; }
    .sub-tab   { padding:9px 14px!important; font-size:13px!important; }
    .modal     { padding:22px 18px; border-radius:20px; }
    .btn-primary,.btn-ghost,.btn-accent { font-size:13px!important; padding:11px 20px!important; }
    .field label { font-size:11px!important; }
    .field input,.field select,.field textarea { font-size:16px!important; padding:11px 13px!important; }
    .admin-kpi { grid-template-columns:repeat(2,1fr)!important; }
    .admin-grid2 { grid-template-columns:1fr!important; }
    .page-scroll>div { padding:16px 14px!important; }
    .page-scroll h2 { font-size:16px!important; }
    .page-scroll h3 { font-size:14px!important; }
    .profile-avatar-wrap { width:72px!important; height:72px!important; }
    .profile-avatar-wrap>div,.profile-avatar-wrap>img { width:72px!important; height:72px!important; font-size:26px!important; }
    .request-card { padding:14px!important; }
    .request-card h3 { font-size:14px!important; }
    .chat-sidebar .conn-row { padding:8px 10px!important; }
    .bot-tab .bi { font-size:22px!important; }
    .bot-tab { font-size:9px!important; gap:2px!important; padding:6px 4px 4px!important; }
    .ai-tab-row { flex-wrap:nowrap!important; scrollbar-width:none!important; overflow-x:auto!important; -webkit-overflow-scrolling:touch!important; padding:5px!important; }
    .ai-tab-row::-webkit-scrollbar { display:none; }
    .ai-tab-row .sub-tab { padding:10px 14px!important; font-size:13px!important; white-space:nowrap!important; flex-shrink:0!important; font-weight:600!important; }
    .page-scroll [style*="borderRadius:20"] { border-radius:16px!important; }
    .page-scroll [style*="padding:22"] { padding:16px!important; }
    .page-scroll [style*="padding:24"] { padding:16px!important; }
    .prof-hdr { gap:10px!important; }
    .prof-name { font-size:15px!important; }
    .nav-inner .logo { font-size:20px!important; }
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
    .auth-card { padding:24px 18px!important; }
    .auth-card h2 { font-size:19px!important; }
  }
`;
