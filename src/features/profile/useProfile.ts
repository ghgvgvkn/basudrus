import { useState, useRef, useMemo, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile, SubjectHistory } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { logError } from "@/services/analytics";
import { getCourseGroups } from "@/services/uniData";
import { useDebounce } from "@/shared/useDebounce";

export function useProfile(
  awardBadge: (badgeId: string) => Promise<void>,
  uniDataReady: boolean,
) {
  const { user, profile, setProfile, setScreen, showNotif } = useApp();

  // ── Edit profile state ──
  const [editProfile, setEditProfile] = useState<Partial<Profile> | null>(null);
  const [editCourseSearch, setEditCourseSearch] = useState("");
  const [editCourseDropOpen, setEditCourseDropOpen] = useState(false);
  const editCourseDropRef = useRef<HTMLDivElement>(null);
  const [editMajorSearch, setEditMajorSearch] = useState("");
  const [editMajorOpen, setEditMajorOpen] = useState(false);
  const editMajorRef = useRef<HTMLDivElement>(null);
  const [profileTab, setProfileTab] = useState("edit");

  // ── Subject history ──
  const [subjectHistory, setSubjectHistory] = useState<SubjectHistory[]>([]);
  const [showSubModal, setShowSubModal] = useState(false);
  const [newSub, setNewSub] = useState({ subject: "", note: "", status: "active" });

  // ── Profile save loading (was shared actionLoading) ──
  const [profileSaveLoading, setProfileSaveLoading] = useState(false);

  // ── Crop modal ──
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [cropModal, setCropModal] = useState<{ src: string; file: File } | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropDragging = useRef(false);
  const cropLastPos = useRef({ x: 0, y: 0 });
  const [cropImgDims, setCropImgDims] = useState<{ w: number; h: number } | null>(null);

  const cropInitialZoom = useMemo(() => {
    if (!cropImgDims) return 1;
    const previewSize = 260;
    return Math.max(previewSize / cropImgDims.w, previewSize / cropImgDims.h);
  }, [cropImgDims]);

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

  // ── Report modal ──
  const [reportModal, setReportModal] = useState<{ userId: string; name: string } | null>(null);
  const [reportReason, setReportReason] = useState("");

  // ── Viewing profile modal ──
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);

  // ── Course helpers ──
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
    const results: { course: string; group: string }[] = [];
    const seen = new Set<string>();
    for (const [cat, list] of groups) {
      for (const c of list) { if (!seen.has(c)) { seen.add(c); results.push({ course: c, group: cat }); } }
    }
    return results;
  }, [uniDataReady, !!editProfile]);

  const debouncedEditCourseSearch = useDebounce(editCourseSearch, 150);
  const editFilteredCourseOptions = useMemo(() => {
    const selected = new Set(editCoursesList);
    const available = editAllCourseOptions.filter(o => !selected.has(o.course));
    if (!debouncedEditCourseSearch) return available.slice(0, 80);
    const q = debouncedEditCourseSearch.toLowerCase();
    const startsWith: typeof available = [];
    const wordStarts: typeof available = [];
    const contains: typeof available = [];
    for (const opt of available) {
      const name = opt.course.toLowerCase();
      if (name.startsWith(q)) startsWith.push(opt);
      else if (name.split(/[\s(&]/).some(w => w.startsWith(q))) wordStarts.push(opt);
      else if (name.includes(q)) contains.push(opt);
    }
    return [...startsWith, ...wordStarts, ...contains];
  }, [editAllCourseOptions, editCoursesList, debouncedEditCourseSearch]);

  // ── Handlers ──

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { showNotif("Photo must be under 5 MB", "err"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setCropModal({ src: reader.result as string, file });
      setCropZoom(1);
      setCropPos({ x: 0, y: 0 });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const cropAndUpload = async () => {
    if (!cropModal || !user) return;
    try {
      const canvas = document.createElement("canvas");
      const size = 400;
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

      const canvasToPreview = size / 260;
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

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
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

  const saveProfile = async () => {
    if (!user) { showNotif("Not signed in", "err"); return; }
    if (!editProfile) { showNotif("Nothing to save", "err"); return; }
    if (!navigator.onLine) { showNotif("You're offline — changes can't be saved right now.", "err"); return; }
    if (profileSaveLoading) return;
    setProfileSaveLoading(true);
    try {
      const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authUser) {
        showNotif("Session expired — please sign in again", "err");
        setScreen("auth");
        return;
      }

      const merged = { ...profile, ...editProfile };
      const updatePayload: Record<string, unknown> = {
        name: (merged.name || "").trim(),
        uni: (merged.uni || "").trim(),
        major: (merged.major || "").trim(),
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
        if (error.code === "PGRST301" || error.message?.includes("JWT")) {
          const { error: refreshErr } = await supabase.auth.refreshSession();
          if (refreshErr) {
            showNotif("Session expired — please sign in again", "err");
            setScreen("auth");
            return;
          }
          const { data: retryData, error: retryErr } = await supabase.from("profiles").update(updatePayload).eq("id", user.id).select().single();
          if (retryErr || !retryData) {
            showNotif("Save failed after retry — please sign out and back in", "err");
            return;
          }
          setProfile(prev => ({ ...prev, ...retryData } as Profile));
          setEditProfile(null);
          showNotif("Profile saved ✅");
          return;
        }
        showNotif("Save failed: " + (error.message || "unknown error"), "err");
        return;
      }
      if (!data) {
        showNotif("Save failed — please try again", "err");
        return;
      }
      setProfile(prev => ({ ...prev, ...data } as Profile));
      setEditProfile(null);
      showNotif("Profile saved ✅");
    } catch (e) {
      logError("saveProfile", e);
      showNotif("Save failed — please try again", "err");
    } finally {
      setProfileSaveLoading(false);
    }
  };

  const submitSubject = async () => {
    if (!newSub.subject || !user) return showNotif("Pick a subject", "err");
    if (subjectHistory.find(s => s.subject === newSub.subject)) return showNotif("Already in your history", "err");
    try {
      const { data, error } = await supabase.from("subject_history").insert({
        user_id: user.id,
        subject: newSub.subject,
        status: newSub.status,
        note: newSub.note || "",
      }).select().single();
      if (error) { showNotif("Failed to add subject — try again", "err"); return; }
      if (data) {
        const updatedHistory = [data, ...subjectHistory];
        setSubjectHistory(updatedHistory);
        setNewSub({ subject: "", note: "", status: "active" });
        setShowSubModal(false);
        showNotif("Subject added ✅");
        const done = updatedHistory.filter(x => x.status === "done").length;
        if (done >= 3) await awardBadge("subject_master");
      }
    } catch { showNotif("Failed to add subject", "err"); }
  };

  const markSubjectDone = async (subId: string) => {
    try {
      const { error } = await supabase.from("subject_history").update({ status: "done" }).eq("id", subId);
      if (error) { showNotif("Failed to update subject", "err"); return; }
      const updated = subjectHistory.map(x => x.id === subId ? { ...x, status: "done" } : x);
      setSubjectHistory(updated);
      const done = updated.filter(x => x.status === "done").length;
      if (done >= 3) await awardBadge("subject_master");
    } catch { }
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

  return {
    // Edit profile
    editProfile, setEditProfile,
    editCourseSearch, setEditCourseSearch,
    editCourseDropOpen, setEditCourseDropOpen,
    editCourseDropRef,
    editMajorSearch, setEditMajorSearch,
    editMajorOpen, setEditMajorOpen,
    editMajorRef,
    profileTab, setProfileTab,
    // Course helpers
    parseCourses, serializeCourses,
    editCoursesList, editFilteredCourseOptions,
    // Subject history
    subjectHistory, setSubjectHistory,
    showSubModal, setShowSubModal,
    newSub, setNewSub,
    // Loading
    profileSaveLoading,
    // Crop modal
    photoInputRef, cropModal, setCropModal,
    cropZoom, setCropZoom, cropPos, setCropPos,
    cropCanvasRef, cropDragging, cropLastPos,
    cropImgDims, cropInitialZoom,
    // Report
    reportModal, setReportModal, reportReason, setReportReason,
    // Viewing profile
    viewingProfile, setViewingProfile,
    // Handlers
    handlePhotoUpload, cropAndUpload, saveProfile,
    submitSubject, markSubjectDone, submitReport,
  };
}
