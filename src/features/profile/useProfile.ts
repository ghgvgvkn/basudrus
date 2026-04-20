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
  const { user, profile, setProfile, setScreen, showNotif, screen } = useApp();

  // ── Edit profile state ──
  const [editProfile, setEditProfile] = useState<Partial<Profile> | null>(null);
  const [editCourseSearch, setEditCourseSearch] = useState("");
  const [editCourseDropOpen, setEditCourseDropOpen] = useState(false);
  const editCourseDropRef = useRef<HTMLDivElement>(null);
  const [editMajorSearch, setEditMajorSearch] = useState("");
  const [editMajorOpen, setEditMajorOpen] = useState(false);
  const editMajorRef = useRef<HTMLDivElement>(null);
  const [profileTab, setProfileTab] = useState("edit");

  // Always land on Edit Profile when the user navigates to the Me tab.
  // Keeps the experience consistent — previously, the tab state persisted across
  // navigations, so a user who clicked "My Posts" once would see that tab the
  // next time they opened Me, which was confusing.
  useEffect(() => {
    if (screen === "profile") setProfileTab("edit");
  }, [screen]);

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
    // Basic type check — Supabase bucket rejects non-images, and HEIC from iPhone can't be decoded by canvas
    if (file.type && !file.type.startsWith("image/")) { showNotif("Please select an image (JPG or PNG)", "err"); return; }
    if (/heic|heif/i.test(file.type || file.name)) { showNotif("HEIC photos aren't supported — please convert to JPG", "err"); return; }
    const reader = new FileReader();
    reader.onerror = () => { showNotif("Couldn't read the file — try a different photo", "err"); };
    reader.onload = () => {
      // Reset position to (0,0); zoom is set by the useEffect once the image loads (cover-fit).
      // Do NOT set cropZoom here — that creates a race with the effect below, causing the
      // image to be saved at the wrong scale if the user clicks Save before the effect runs.
      setCropPos({ x: 0, y: 0 });
      setCropModal({ src: reader.result as string, file });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const cropAndUpload = async () => {
    if (!cropModal || !user) return;
    if (!navigator.onLine) { showNotif("You're offline — can't upload the photo right now.", "err"); return; }
    try {
      const canvas = document.createElement("canvas");
      const size = 400;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) { showNotif("Your browser can't process images — try a different browser", "err"); return; }

      const img = new Image();
      // Don't set crossOrigin for data: URLs — it's unnecessary and can cause issues on some browsers.
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed — the file may be corrupted or in an unsupported format"));
        img.src = cropModal.src;
      });

      if (!img.naturalWidth || !img.naturalHeight) {
        showNotif("Couldn't read the image dimensions — try a different photo", "err");
        return;
      }

      const canvasToPreview = size / 260;
      const imgW = img.naturalWidth * cropZoom * canvasToPreview;
      const imgH = img.naturalHeight * cropZoom * canvasToPreview;
      const drawX = (size - imgW) / 2 + cropPos.x * canvasToPreview;
      const drawY = (size - imgH) / 2 + cropPos.y * canvasToPreview;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, drawX, drawY, imgW, imgH);
      ctx.restore();

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) { showNotif("Couldn't encode the photo — try a smaller or different image", "err"); return; }
      // Sanity check: a valid 400x400 JPEG is at least a few KB. A near-empty blob means
      // the canvas didn't render — usually from an unsupported iOS image format.
      if (blob.size < 1024) {
        logError("cropAndUpload:emptyBlob", { size: blob.size });
        showNotif("Couldn't process this image — try a different photo (JPG or PNG)", "err");
        return;
      }

      // Use a unique path per upload so CDN cache is never stale for other viewers.
      // The old avatar remains in storage but is orphaned; optionally cleaned up below.
      const newPath = `${user.id}/avatar-${Date.now()}.jpg`;
      // Retry the upload once on transient edge errors (Cloudflare 520 / upstream
      // timeouts between Vercel and Supabase storage). A user hit HTTP 520 on
      // Apr 20 and had no recovery path — one retry fixes it silently.
      type UploadErr = { message?: string; statusCode?: number; status?: number } | null;
      let upErr: UploadErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await supabase.storage.from("avatars").upload(newPath, blob, {
          upsert: false,
          contentType: "image/jpeg",
          cacheControl: "3600",
        });
        upErr = (res.error as UploadErr) ?? null;
        if (!upErr) break;
        const m = (upErr.message || "").toLowerCase();
        const code = Number(upErr.statusCode || upErr.status || 0);
        const isTransient = /520|521|522|523|524|502|503|504|timeout|gateway|network|fetch failed|connection/i.test(m) || (code >= 500 && code <= 599);
        if (!isTransient || attempt >= 1) break;
        await new Promise(r => setTimeout(r, 700));
      }
      if (upErr) {
        logError("cropAndUpload:upload", upErr);
        const msg = ((upErr as UploadErr)?.message || "").toLowerCase();
        if (msg.includes("bucket") || msg.includes("not found")) {
          showNotif("Upload failed — the 'avatars' bucket is missing in Supabase Storage", "err");
        } else if (msg.includes("permission") || msg.includes("policy") || msg.includes("unauthorized") || msg.includes("forbidden")) {
          showNotif("Upload blocked — storage policy is denying write access", "err");
        } else if (msg.includes("520") || msg.includes("502") || msg.includes("503") || msg.includes("504") || msg.includes("gateway") || msg.includes("timeout")) {
          showNotif("Photo upload had a brief hiccup — please try again in a moment", "err");
        } else if (msg.includes("network") || msg.includes("fetch") || !navigator.onLine) {
          showNotif("Upload failed — connection issue. Try again.", "err");
        } else {
          showNotif(`Upload failed: ${(upErr as UploadErr)?.message || "unknown error"}`, "err");
        }
        return;
      }

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(newPath);
      const url = urlData.publicUrl;
      const { error: updateErr } = await supabase.from("profiles").update({ photo_mode: "photo", photo_url: url }).eq("id", user.id);
      if (updateErr) {
        logError("cropAndUpload:dbUpdate", updateErr);
        showNotif(`Photo uploaded but profile update failed: ${updateErr.message || "unknown error"}`, "err");
        // Clean up the orphaned upload since we couldn't attach it to the profile
        supabase.storage.from("avatars").remove([newPath]).catch(() => {});
        return;
      }

      // Clean up the previously uploaded avatar (best-effort). We derive the old path from
      // the existing photo_url if it points at our storage; ignore any failure.
      const oldUrl = profile.photo_url;
      if (oldUrl && oldUrl.includes("/storage/v1/object/public/avatars/")) {
        const idx = oldUrl.indexOf("/avatars/");
        if (idx >= 0) {
          const oldPath = oldUrl.slice(idx + "/avatars/".length).split("?")[0];
          if (oldPath && oldPath !== newPath) {
            supabase.storage.from("avatars").remove([oldPath]).catch(() => {});
          }
        }
      }

      setProfile(p => ({ ...p, photo_mode: "photo", photo_url: url }));
      if (editProfile) setEditProfile(p => ({ ...p!, photo_mode: "photo", photo_url: url }));
      setCropModal(null);
      showNotif("Profile photo updated! 📸");
    } catch (e: unknown) {
      logError("cropAndUpload", e);
      const msg = e instanceof Error ? e.message : "Upload failed — please try again";
      showNotif(msg, "err");
    }
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
