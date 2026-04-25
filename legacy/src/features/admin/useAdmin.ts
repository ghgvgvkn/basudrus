import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Report, HelpRequest } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { logError } from "@/services/analytics";

export function useAdmin(onPostDeleted?: (postId: string) => void) {
  const { isAdmin, showNotif } = useApp();

  const [adminTab, setAdminTab] = useState("analytics");
  const [adminReports, setAdminReports] = useState<Report[]>([]);
  const [adminPosts, setAdminPosts] = useState<HelpRequest[]>([]);
  const [adminAnalytics, setAdminAnalytics] = useState<any>(null);

  const loadAdminData = async () => {
    if (!isAdmin) return;
    try {
      const { data: reports, error: rErr } = await supabase
        .from("reports")
        .select("*, reporter:profiles!reports_reporter_id_fkey(*), reported:profiles!reports_reported_id_fkey(*)")
        .order("created_at", { ascending: false });
      if (rErr) { logError("loadAdminData:reports", rErr); return; }
      if (reports) setAdminReports(reports as Report[]);
      const { data: posts, error: pErr } = await supabase
        .from("help_requests")
        .select("*, profile:profiles!fk_help_requests_user(*)")
        .order("created_at", { ascending: false });
      if (pErr) logError("loadAdminData:posts", pErr);
      else if (posts) setAdminPosts(posts as HelpRequest[]);
    } catch (e) { logError("loadAdminData", e); }
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
        onPostDeleted?.(postId);
        showNotif("Post deleted");
      }
    } catch (e) { logError("adminDeletePost", e); showNotif("Delete failed — please try again", "err"); }
  };

  const loadAdminAnalytics = async () => {
    if (!isAdmin) return;
    try {
      const now = new Date();

      // Single RPC call replaces 10 count queries
      const [statsRes, recentPostsRes, topUsersRes] = await Promise.all([
        supabase.rpc("admin_analytics_stats"),
        supabase.from("help_requests").select("subject, user_id").order("created_at", { ascending: false }).limit(200),
        supabase.from("profiles").select("id, name, xp").order("xp", { ascending: false }).limit(5),
      ]);
      if (statsRes.error) logError("admin_analytics_stats", statsRes.error);
      const s = (statsRes.data as any) || {};

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

      const months6: { month: string; posts: number; users: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mLabel = d.toLocaleDateString("en-US", { month: "short" });
        months6.push({ month: mLabel, posts: 0, users: 0 });
      }

      const totalReports = s.totalReports || 0;
      const resolvedReports = s.resolvedReports || 0;

      setAdminAnalytics({
        totalUsers: s.totalUsers || 0, usersToday: s.usersToday || 0, usersWeek: s.usersWeek || 0, usersMonth: s.usersMonth || 0,
        totalPosts: s.totalPosts || 0, postsToday: s.postsToday || 0, postsWeek: s.postsWeek || 0, postsMonth: s.postsMonth || 0,
        totalReports, resolvedReports, unresolvedReports: totalReports - resolvedReports,
        topSubjects, topActiveUsers, months6,
      });
    } catch (e) { logError("loadAdminAnalytics", e); }
  };

  return {
    adminTab, setAdminTab,
    adminReports, adminPosts, adminAnalytics,
    loadAdminData, adminDeletePost, loadAdminAnalytics,
  };
}
