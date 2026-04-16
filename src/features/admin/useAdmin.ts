import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Report, HelpRequest } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";

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
        onPostDeleted?.(postId);
        showNotif("Post deleted");
      }
    } catch { showNotif("Delete failed — please try again", "err"); }
  };

  const loadAdminAnalytics = async () => {
    if (!isAdmin) return;
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

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
        supabase.from("help_requests").select("subject, user_id").order("created_at", { ascending: false }).limit(200),
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

      const months6: { month: string; posts: number; users: number }[] = [];
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

  return {
    adminTab, setAdminTab,
    adminReports, adminPosts, adminAnalytics,
    loadAdminData, adminDeletePost, loadAdminAnalytics,
  };
}
