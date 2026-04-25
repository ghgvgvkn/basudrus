/**
 * ai-memory.ts — Memory System for Bas Udrus AI
 *
 * Makes the AI feel personal by remembering:
 * 1. User Memory: Last 10 exchanges per feature (tutor, wellbeing, planner)
 * 2. Global Knowledge: Trending topics from all users (except wellbeing for privacy)
 * 3. Token Tiers: Rewards engagement — more interactions = longer responses
 * 4. Version Counter: Increments every 50 interactions, creating a "learning" narrative
 */

const MEMORY_KEYS = {
  tutor: "bas_ai_tutor_memory",
  wellbeing: "bas_ai_wellbeing_memory",
  planner: "bas_ai_planner_memory",
  stats: "bas_ai_stats",
  globalTrends: "bas_ai_global_trends",
} as const;

type MemoryEntry = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type AIStats = {
  totalInteractions: number;
  tutorCount: number;
  wellbeingCount: number;
  plannerCount: number;
  version: string;
  lastUsed: number;
};

type Feature = "tutor" | "wellbeing" | "planner";

const MAX_MEMORY_PER_FEATURE = 10;
const VERSION_INCREMENT_THRESHOLD = 50;

/** Get the stored memory for a feature (last 10 exchanges) */
export function getMemory(feature: Feature): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEYS[feature]);
    if (!raw) return [];
    const entries: MemoryEntry[] = JSON.parse(raw);
    // Only return the last 10 entries
    return entries.slice(-MAX_MEMORY_PER_FEATURE);
  } catch {
    return [];
  }
}

/** Save a new exchange to memory */
export function saveMemory(feature: Feature, role: "user" | "assistant", content: string): void {
  try {
    const entries = getMemory(feature);
    entries.push({
      role,
      content: content.slice(0, 300), // Limit content length to save space
      timestamp: Date.now(),
    });
    // Keep only last 10
    const trimmed = entries.slice(-MAX_MEMORY_PER_FEATURE);
    localStorage.setItem(MEMORY_KEYS[feature], JSON.stringify(trimmed));
  } catch {
    // localStorage might be full or unavailable
  }
}

/** Get AI usage stats */
export function getStats(): AIStats {
  try {
    const raw = localStorage.getItem(MEMORY_KEYS.stats);
    if (!raw) return { totalInteractions: 0, tutorCount: 0, wellbeingCount: 0, plannerCount: 0, version: "1.0", lastUsed: 0 };
    return JSON.parse(raw);
  } catch {
    return { totalInteractions: 0, tutorCount: 0, wellbeingCount: 0, plannerCount: 0, version: "1.0", lastUsed: 0 };
  }
}

/** Increment interaction count and update version */
export function incrementStats(feature: Feature): AIStats {
  const stats = getStats();
  stats.totalInteractions += 1;
  if (feature === "tutor") stats.tutorCount += 1;
  if (feature === "wellbeing") stats.wellbeingCount += 1;
  if (feature === "planner") stats.plannerCount += 1;
  stats.lastUsed = Date.now();

  // Version increments every 50 interactions — creates "learning" narrative
  const versionNum = 1.0 + Math.floor(stats.totalInteractions / VERSION_INCREMENT_THRESHOLD) * 0.1;
  stats.version = versionNum.toFixed(1);

  try {
    localStorage.setItem(MEMORY_KEYS.stats, JSON.stringify(stats));
  } catch {}

  return stats;
}

/** Get token tier based on interaction count — rewards engagement */
export function getTokenTier(stats: AIStats): { tier: "starter" | "standard" | "power"; maxTokens: number; label: string } {
  if (stats.totalInteractions >= 10) {
    return { tier: "power", maxTokens: 2048, label: "Power User 🔥" };
  }
  if (stats.totalInteractions >= 3) {
    return { tier: "standard", maxTokens: 1024, label: "Regular ⭐" };
  }
  return { tier: "starter", maxTokens: 512, label: "New User 🌱" };
}

/** Save global trending topics (from tutor only — NOT wellbeing for privacy) */
export function saveTrendingTopic(topic: string): void {
  try {
    const raw = localStorage.getItem(MEMORY_KEYS.globalTrends);
    const trends: { topic: string; count: number; lastSeen: number }[] = raw ? JSON.parse(raw) : [];

    const existing = trends.find(t => t.topic.toLowerCase() === topic.toLowerCase());
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
    } else {
      trends.push({ topic, count: 1, lastSeen: Date.now() });
    }

    // Keep top 20 trending topics, sorted by count
    trends.sort((a, b) => b.count - a.count);
    const trimmed = trends.slice(0, 20);

    localStorage.setItem(MEMORY_KEYS.globalTrends, JSON.stringify(trimmed));
  } catch {}
}

/** Get trending topics for context injection */
export function getTrendingTopics(): string[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEYS.globalTrends);
    if (!raw) return [];
    const trends: { topic: string; count: number }[] = JSON.parse(raw);
    return trends.slice(0, 5).map(t => t.topic);
  } catch {
    return [];
  }
}

/** Format memory entries for injection into AI system prompt */
export function formatMemoryForPrompt(feature: Feature): { role: string; content: string }[] {
  // For wellbeing, only return the last 5 entries for privacy
  const limit = feature === "wellbeing" ? 5 : MAX_MEMORY_PER_FEATURE;
  const entries = getMemory(feature).slice(-limit);
  return entries.map(e => ({ role: e.role, content: e.content }));
}

/** Clear all AI memory (for sign out) */
export function clearAllMemory(): void {
  try {
    Object.values(MEMORY_KEYS).forEach(key => localStorage.removeItem(key));
  } catch {}
}
