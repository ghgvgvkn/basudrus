export const AVATAR_COLORS = [
  "#6C8EF5", "#F4845F", "#43C59E", "#B87CF5", "#F5A623",
  "#3BBFBF", "#F06292", "#66BB6A", "#FF7043", "#42A5F5"
];

export const BADGES_DEF = [
  { id: "first_connect",  icon: "🤝", name: "First Connect",   desc: "Connected with your first study partner",    xp: 50  },
  { id: "ice_breaker",    icon: "💬", name: "Ice Breaker",     desc: "Sent your first message",                    xp: 30  },
  { id: "helper",         icon: "🦸", name: "Helper",          desc: "Posted a study request",                     xp: 100 },
  { id: "streak_7",       icon: "🔥", name: "Week Warrior",    desc: "Maintained a 7-day study streak",            xp: 150 },
  { id: "streak_30",      icon: "👑", name: "Streak Legend",   desc: "Maintained a 30-day study streak",           xp: 500 },
  { id: "subject_master", icon: "📚", name: "Subject Master",  desc: "Completed 3 subjects",                       xp: 200 },
  { id: "top_rated",      icon: "⭐", name: "Top Rated",       desc: "Received a 5-star rating",                   xp: 120 },
  { id: "group_host",     icon: "🎓", name: "Group Host",      desc: "Created your first group study room",        xp: 80  },
];

export const getMeetIcon  = (t: string) => t === "online" ? "🎥" : t === "face" ? "📍" : "💬";
export const getMeetLabel = (t: string) => t === "online" ? "Online" : t === "face" ? "On Campus" : "Flexible";
export const statusColor  = (s: string) => s === "active" ? "#1B8A5A" : s === "done" ? "#6B7280" : "#B37A00";

export const LIGHT = { 
  bg: "#F5F4F0", surface: "#FFFFFF", navy: "#0F1B2D", navyLight: "#1C2E45", 
  accent: "#4A7CF7", accentSoft: "#EEF2FF", green: "#1B8A5A", greenSoft: "#E8FBF3", 
  red: "#D93636", redSoft: "#FEF0F0", border: "#EAEAEA", muted: "#5A6370", 
  text: "#1A2332", textSoft: "#3D4A5C", gold: "#B37A00", goldSoft: "#FFF8EC", navBg: "#FFFFFFCC" 
};

export const DARK = { 
  bg: "#0D1117", surface: "#161B22", navy: "#F0F6FF", navyLight: "#CDD9FF", 
  accent: "#6B9CFF", accentSoft: "#1A2544", green: "#3DDC97", greenSoft: "#0D2B1E", 
  red: "#FF6B6B", redSoft: "#2B0F0F", border: "#21262D", muted: "#9CA4AD", 
  text: "#E6EDF3", textSoft: "#A0AAB5", gold: "#FFB938", goldSoft: "#2B1F0A", navBg: "#161B22CC" 
};

export type Theme = typeof LIGHT;
