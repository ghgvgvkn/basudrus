import { supabase } from "@/lib/supabase";
import { COURSE_CATEGORIES, getCategoryForCourse } from "@/lib/courses";
import { logError } from "@/services/analytics";

// ─── DATA (fetched from Supabase) ───────────────────────────────────────────
export type UniRow = { id: string; name: string; short_name: string; full_name: string; display_order: number };
export type MajorRow = { id: string; university_id: string; name: string; display_order: number };
export type CourseRow = { id: string; major_id: string; name: string; display_order: number };

// Loaded at runtime; fallback to empty while loading
let _uniList: UniRow[] = [];
let _majorList: MajorRow[] = [];
let _courseList: CourseRow[] = [];
let _uniDataReady = false;

export async function loadUniData() {
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

export function isUniDataReady(): boolean {
  return _uniDataReady;
}

export function getUniversities(): string[] {
  return _uniList.map(u => u.name.trim());
}

/**
 * Normalize a user-entered university string to the canonical name from the DB.
 * Handles: short names (PSUT, GJU), partial names, trailing spaces, case mismatch.
 */
export function normalizeUni(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  // 1. Exact match (trimmed)
  for (const u of _uniList) {
    if (u.name.trim() === trimmed) return u.name.trim();
  }
  // 2. Case-insensitive match on name, short_name, full_name
  for (const u of _uniList) {
    const canonical = u.name.trim();
    if (u.name.trim().toLowerCase() === lower) return canonical;
    if (u.short_name?.toLowerCase() === lower) return canonical;
    if (u.full_name?.toLowerCase() === lower) return canonical;
  }
  // 3. Partial / contains match (e.g., "Jordan University" matches "University of Jordan")
  for (const u of _uniList) {
    const canonical = u.name.trim();
    const uLower = canonical.toLowerCase();
    // Check if user input contains main keywords of the uni name
    const keywords = uLower.split(/\s+/).filter(w => w.length > 2 && !["the","of","for","and"].includes(w));
    const inputWords = lower.split(/\s+/);
    const matchCount = keywords.filter(kw => inputWords.some(iw => iw.includes(kw) || kw.includes(iw))).length;
    if (keywords.length > 0 && matchCount >= Math.ceil(keywords.length * 0.5)) return canonical;
  }
  // 4. No match — return trimmed original (so it still works for comparison)
  return trimmed;
}

/**
 * Check if a profile's uni matches a filter value. Handles all variations.
 */
export function uniMatches(profileUni: string, filterUni: string): boolean {
  if (!filterUni) return true;
  if (!profileUni) return false;
  const normProfile = normalizeUni(profileUni);
  const normFilter = normalizeUni(filterUni);
  if (normProfile === normFilter) return true;
  // Fallback: case-insensitive trimmed compare
  return normProfile.toLowerCase() === normFilter.toLowerCase();
}

/**
 * Check if a profile's major matches a filter value. Case-insensitive, trimmed.
 */
export function majorMatches(profileMajor: string, filterMajor: string): boolean {
  if (!filterMajor) return true;
  if (!profileMajor) return false;
  return profileMajor.trim().toLowerCase() === filterMajor.trim().toLowerCase();
}

export function getAllMajors(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of _majorList) {
    if (!seen.has(m.name)) { seen.add(m.name); result.push(m.name); }
  }
  result.push("Other");
  return result;
}

export function getMajorsForUni(uniFilter: string): string[] {
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
export function getCourseGroups(_uniFilter?: string, _majorFilter?: string, categoryFilter?: string): [string, string[]][] {
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

export function getUniCards(): {uni: string; full: string; emoji: string}[] {
  const emojis: Record<string, string> = {
    "PSUT": "🏛️", "UJ": "🎓", "GJU": "🌍", "AAU": "🏫", "ASU": "📘", "MEU": "🎯", "AUM": "🌿"
  };
  return _uniList.map(u => ({ uni: u.short_name, full: u.full_name, emoji: emojis[u.short_name] || "🏫" }));
}
