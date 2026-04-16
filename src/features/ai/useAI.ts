import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { trackEvent } from "@/services/analytics";
import { getMemory, saveMemory, getStats, incrementStats, getTokenTier, formatMemoryForPrompt, saveTrendingTopic } from "@/lib/ai-memory";

export function useAI(allStudents: Profile[]) {
  const { user, profile, showNotif } = useApp();

  const [aiTab, setAiTab] = useState<"" | "wellbeing" | "tutor" | "match" | "plan">("");
  const [aiLang, setAiLang] = useState<"auto" | "en" | "ar">("auto");
  const [tutorMsgs, setTutorMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [tutorInput, setTutorInput] = useState("");
  const [tutorLoading, setTutorLoading] = useState(false);
  const [tutorSubject, setTutorSubject] = useState("");
  const [tutorFile, setTutorFile] = useState<{ name: string; text: string } | null>(null);
  const tutorFileRef = useRef<HTMLInputElement>(null);
  const tutorEndRef = useRef<HTMLDivElement>(null);
  const [matchScores, setMatchScores] = useState<Record<string, { score: number; reason: string }>>({});
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchQuiz, setMatchQuiz] = useState<Record<string, string>>({});
  const [matchQuizSaved, setMatchQuizSaved] = useState(false);
  const [planSubjects, setPlanSubjects] = useState("");
  const [planExamDates, setPlanExamDates] = useState("");
  const [planResult, setPlanResult] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [savedPlans, setSavedPlans] = useState<{ id: string; plan: string; subjects: string; created_at: string }[]>([]);
  const [aiVersion, setAiVersion] = useState("v1.0");
  const [aiUserTier, setAiUserTier] = useState<{ tier: string; interactionCount: number; maxTokens: number }>({ tier: "new", interactionCount: 0, maxTokens: 500 });
  const [wellbeingMsgs, setWellbeingMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [wellbeingInput, setWellbeingInput] = useState("");
  const [wellbeingLoading, setWellbeingLoading] = useState(false);
  const [wellbeingMood, setWellbeingMood] = useState("");
  const [wellbeingMode, setWellbeingMode] = useState("");
  const wellbeingEndRef = useRef<HTMLDivElement>(null);
  const [aiLimitModal, setAiLimitModal] = useState<{ show: boolean; reason: string; endpoint: string }>({ show: false, reason: "", endpoint: "" });
  const [earlyAccessEmail, setEarlyAccessEmail] = useState("");
  const [earlyAccessSent, setEarlyAccessSent] = useState(false);

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

  const saveChatHistory = async (feature: "tutor" | "wellbeing", msgs: { role: "user" | "assistant"; content: string }[]) => {
    if (!user || msgs.length === 0) return;
    try {
      const { data: existing } = await supabase.from("chat_history").select("id").eq("user_id", user.id).eq("feature", feature).limit(1).maybeSingle();
      if (existing) {
        await supabase.from("chat_history").update({ messages: msgs, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("chat_history").insert({ user_id: user.id, feature, messages: msgs });
      }
    } catch { }
  };

  const loadChatHistory = async (feature: "tutor" | "wellbeing") => {
    if (!user) return [];
    try {
      const { data } = await supabase.from("chat_history").select("messages").eq("user_id", user.id).eq("feature", feature).limit(1).maybeSingle();
      if (data?.messages && Array.isArray(data.messages)) return data.messages as { role: "user" | "assistant"; content: string }[];
    } catch { }
    return [];
  };

  // Load chat history when user logs in
  useEffect(() => {
    if (!user) return;
    loadChatHistory("tutor").then(msgs => { if (msgs.length > 0) setTutorMsgs(msgs); });
    loadChatHistory("wellbeing").then(msgs => { if (msgs.length > 0) setWellbeingMsgs(msgs); });
  }, [user?.id]);

  // Auto-save chat history when AI finishes responding
  const tutorSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wellbeingSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const sendTutorMessage = async () => {
    if (!tutorInput.trim() || tutorLoading) return;
    if (!navigator.onLine) { showNotif("You're offline — AI tutor needs internet to work.", "err"); return; }
    const msg = tutorInput.trim();
    const fileCtx = tutorFile ? `\n\n[Attached file: ${tutorFile.name}]\n${tutorFile.text.slice(0, 4000)}` : "";
    const displayMsg = tutorFile ? `${msg}\n📎 ${tutorFile.name}` : msg;
    setTutorInput("");
    setTutorFile(null);
    const newMsgs = [...tutorMsgs, { role: "user" as const, content: displayMsg }];
    setTutorMsgs(newMsgs);
    setTutorLoading(true);
    setTutorMsgs(prev => [...prev, { role: "assistant" as const, content: "" }]);
    saveMemory("tutor", "user", msg);
    if (tutorSubject) saveTrendingTopic(tutorSubject);
    try {
      const apiMsgs = fileCtx ? [...tutorMsgs, { role: "user" as const, content: msg + fileCtx }] : newMsgs;
      const memory = formatMemoryForPrompt("tutor");
      const { data: { session: sess } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sess?.access_token ? { "Authorization": `Bearer ${sess.access_token}` } : {}) },
        body: JSON.stringify({ messages: apiMsgs, subject: tutorSubject, major: profile.major || "", year: profile.year || "", uni: profile.uni || "", userId: user?.id || "", lang: aiLang === "auto" ? undefined : aiLang, memory }),
      });
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({ reason: "daily_limit" }));
        setTutorMsgs(prev => prev.slice(0, -1));
        setTutorLoading(false);
        if (errData.reason === "daily_limit" || errData.reason === "hourly_limit") {
          setAiLimitModal({ show: true, reason: errData.reason, endpoint: "tutor" });
        } else {
          showNotif(errData.reason === "cooldown" ? "Give it a sec..." : "Slow down a bit — try again in a moment", "err");
        }
        return;
      }
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
                updated[updated.length - 1] = { role: "assistant", content: assistantMsg };
                return updated;
              });
            }
          } catch { }
        }
      }
      trackEvent("ai_call", { endpoint: "tutor", subject: tutorSubject || "" });
      saveMemory("tutor", "assistant", assistantMsg.slice(0, 300));
      const stats = incrementStats("tutor");
      const tier = getTokenTier(stats);
      setAiUserTier({ tier: tier.tier, interactionCount: stats.totalInteractions, maxTokens: tier.maxTokens });
    } catch {
      trackEvent("ai_fail", { endpoint: "tutor" });
      setTutorMsgs(prev => prev.slice(0, -1));
      showNotif("AI tutor error. Please try again.", "err");
    } finally {
      setTutorLoading(false);
    }
  };

  const sendWellbeingMessage = async () => {
    if (!wellbeingInput.trim() || wellbeingLoading) return;
    if (!navigator.onLine) { showNotif("You're offline — wellbeing chat needs internet.", "err"); return; }
    const msg = wellbeingInput.trim();
    setWellbeingInput("");
    const newMsgs = [...wellbeingMsgs, { role: "user" as const, content: msg }];
    setWellbeingMsgs(newMsgs);
    setWellbeingLoading(true);
    setWellbeingMsgs(prev => [...prev, { role: "assistant" as const, content: "" }]);
    saveMemory("wellbeing", "user", msg);
    try {
      const memory = formatMemoryForPrompt("wellbeing");
      const { data: { session: wSess } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/wellbeing", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(wSess?.access_token ? { "Authorization": `Bearer ${wSess.access_token}` } : {}) },
        body: JSON.stringify({ messages: newMsgs, name: profile.name || "", mood: wellbeingMood, mode: wellbeingMode, uni: profile.uni || "", major: profile.major || "", userId: user?.id || "", lang: aiLang === "auto" ? undefined : aiLang, memory }),
      });
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({ reason: "daily_limit" }));
        setWellbeingMsgs(prev => prev.slice(0, -1));
        setWellbeingLoading(false);
        if (errData.reason === "daily_limit" || errData.reason === "hourly_limit") {
          setAiLimitModal({ show: true, reason: errData.reason, endpoint: "wellbeing" });
        } else {
          showNotif(errData.reason === "cooldown" ? "Take a breath..." : "Slow down a bit — try again in a moment", "err");
        }
        return;
      }
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
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.content) {
              assistantMsg += json.content;
              setWellbeingMsgs(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantMsg };
                return updated;
              });
            }
          } catch { }
        }
      }
      trackEvent("ai_call", { endpoint: "wellbeing" });
      saveMemory("wellbeing", "assistant", assistantMsg.slice(0, 300));
      const stats = incrementStats("wellbeing");
      const tier = getTokenTier(stats);
      setAiUserTier({ tier: tier.tier, interactionCount: stats.totalInteractions, maxTokens: tier.maxTokens });
    } catch {
      trackEvent("ai_fail", { endpoint: "wellbeing" });
      setWellbeingMsgs(prev => prev.slice(0, -1));
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myProfile: profile, candidates: allStudents.slice(0, 15), userId: user?.id || "" }),
      });
      const data = await res.json();
      const scores: Record<string, { score: number; reason: string }> = {};
      (data.scores || []).forEach((s: { id: string; score: number; reason: string }) => { scores[s.id] = { score: s.score, reason: s.reason }; });
      setMatchScores(scores);
    } catch { showNotif("Matching error. Try again.", "err"); }
    setMatchLoading(false);
  };

  const generateStudyPlan = async () => {
    if (!planSubjects.trim() || planLoading) return;
    setPlanLoading(true);
    setPlanResult("");
    saveMemory("planner", "user", `Subjects: ${planSubjects}, Exams: ${planExamDates || "none"}`);
    saveTrendingTopic(planSubjects.split(",")[0]?.trim() || planSubjects);
    try {
      const res = await fetch("/api/ai/study-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects: planSubjects, major: profile.major, year: profile.year, uni: profile.uni || "", examDates: planExamDates, userId: user?.id || "", lang: aiLang === "auto" ? undefined : aiLang }),
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
          } catch { }
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

  const resetAI = () => {
    setAiTab("");
    setTutorMsgs([]);
    setTutorInput("");
    setTutorSubject("");
    setTutorFile(null);
    setWellbeingMsgs([]);
    setWellbeingInput("");
    setWellbeingMood("");
    setWellbeingMode("");
    setMatchScores({});
    setMatchQuiz({});
    setMatchQuizSaved(false);
    setPlanSubjects("");
    setPlanExamDates("");
    setPlanResult("");
    setSavedPlans([]);
  };

  return {
    aiTab, setAiTab, aiLang, setAiLang,
    tutorMsgs, setTutorMsgs, tutorInput, setTutorInput,
    tutorLoading, tutorSubject, setTutorSubject,
    tutorFile, setTutorFile, tutorFileRef, tutorEndRef,
    matchScores, matchLoading, matchQuiz, setMatchQuiz, matchQuizSaved,
    planSubjects, setPlanSubjects, planExamDates, setPlanExamDates,
    planResult, planLoading, savedPlans,
    aiVersion, aiUserTier,
    wellbeingMsgs, setWellbeingMsgs, wellbeingInput, setWellbeingInput,
    wellbeingLoading, wellbeingMood, setWellbeingMood,
    wellbeingMode, setWellbeingMode, wellbeingEndRef,
    aiLimitModal, setAiLimitModal, earlyAccessEmail, setEarlyAccessEmail, earlyAccessSent, setEarlyAccessSent,
    loadSavedPlans, savePlanAsNote, loadMatchQuiz, saveMatchQuiz,
    sendTutorMessage, sendWellbeingMessage, loadMatchScores, generateStudyPlan,
    resetAI,
  };
}
