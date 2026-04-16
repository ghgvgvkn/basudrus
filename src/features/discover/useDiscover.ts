import { useState, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile, HelpRequest } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { logError, trackEvent } from "@/services/analytics";
import { getCourseGroups } from "@/services/uniData";
import { useDebounce } from "@/shared/useDebounce";

export function useDiscover(
  awardBadge: (badgeId: string) => Promise<void>,
  uniDataReady: boolean,
) {
  const { user, profile, setScreen, showNotif } = useApp();

  // ── Students / posts ──
  const [allStudents, setAllStudents] = useState<Profile[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [postLoading, setPostLoading] = useState(false);

  // ── Filters ──
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
  const courseDropRef = useRef<HTMLDivElement>(null);
  const [flyCard, setFlyCard] = useState<{ id: string; dir: string } | null>(null);

  // ── Post modal ──
  const [showReqModal, setShowReqModal] = useState(false);
  const [newReq, setNewReq] = useState({ subject: "", detail: "", meetType: "flexible" });

  // ── Course search memos ──
  const allCourseOptions = useMemo(() => {
    const groups = getCourseGroups();
    const results: { course: string; group: string }[] = [];
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

  // ── Data loading ──
  const loadAllStudents = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("help_requests")
        .select("*, profile:profiles!fk_help_requests_user(*)")
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) return;
      if (data) {
        const cards = (data as Array<HelpRequest & { profile: Profile }>)
          .filter((r) => r.profile && r.subject && r.detail?.trim())
          .map((r) => ({
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

  const loadHelpRequests = async () => {
    try {
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
      if ((canPostRes as any).data?.can_post) setCanPost(true);
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

  // ── Handlers ──
  const openReqModal = () => {
    if (!profile.name || !profile.uni || !profile.major) {
      showNotif("Complete your profile first — add your name, university & major 👤", "err");
      setScreen("profile");
      return;
    }
    setShowReqModal(true);
  };

  const submitRequest = async () => {
    if (!newReq.subject || !user) return showNotif("Pick a course first", "err");
    if (!newReq.detail?.trim()) return showNotif("Write what you need help with", "err");
    if (!navigator.onLine) return showNotif("You're offline — can't post right now. Try again when connected.", "err");
    if (postLoading) return;
    setPostLoading(true);
    try {
      const { data: existingProfile, error: profileCheckError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .single();

      if (profileCheckError || !existingProfile) {
        setPostLoading(false);
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
        setHelpRequests(prev => [fullReq as HelpRequest, ...prev]);
        setNewReq({ subject: "", detail: "", meetType: "flexible" });
        setShowReqModal(false);
        trackEvent("post_created", { subject: newReq.subject });
        showNotif("Your post is live! 📢");
        await awardBadge("helper");
      } else if (error) {
        showNotif("Error posting — " + (error.message || "please try again"), "err");
      }
    } catch { showNotif("Error posting — please try again", "err"); }
    setPostLoading(false);
  };

  const handleReject = (s: Profile & { _postId?: string }) => {
    const key = s._postId || s.id;
    setFlyCard({ id: key, dir: "down" });
    setTimeout(() => { setDismissed(prev => ({ ...prev, [key]: true })); setFlyCard(null); }, 310);
  };

  return {
    // Students & posts
    allStudents, setAllStudents,
    helpRequests, setHelpRequests,
    canPost, setCanPost, postLoading,
    // Filters
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
    // Course memos
    allCourseOptions, filteredCourseOptions,
    // Post modal
    showReqModal, setShowReqModal,
    newReq, setNewReq,
    // Handlers
    loadAllStudents, loadHelpRequests, enablePosting,
    openReqModal, submitRequest, handleReject,
  };
}
