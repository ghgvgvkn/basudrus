import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { GroupRoom, Profile } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { logError, trackEvent } from "@/services/analytics";
import { withRetry } from "@/shared/retry";

export function useRooms(awardBadge: (badgeId: string) => Promise<void>) {
  const { user, profile, showNotif } = useApp();

  const [groups, setGroups] = useState<GroupRoom[]>([]);
  const [showGrpModal, setShowGrpModal] = useState(false);
  const [newGrp, setNewGrp] = useState({ subject: "", date: "", time: "", type: "online", spots: 4, link: "", location: "", note: "" });
  const [editingRoom, setEditingRoom] = useState<GroupRoom | null>(null);
  const [editGrp, setEditGrp] = useState({ subject: "", date: "", time: "", type: "online", spots: 4, link: "", location: "" });
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(null);
  const [roomActionLoading, setRoomActionLoading] = useState(false);
  const joiningGroupRef = useRef<Set<string>>(new Set());

  // ── Members modal (host clicks "View Members" on a room they created) ──
  const [viewingMembersRoom, setViewingMembersRoom] = useState<GroupRoom | null>(null);
  const [roomMembers, setRoomMembers] = useState<Profile[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const openRoomMembers = async (room: GroupRoom) => {
    if (!user) return;
    setViewingMembersRoom(room);
    setRoomMembers([]);
    setLoadingMembers(true);
    try {
      const { data, error } = await supabase
        .from("group_members")
        .select("user_id, member:profiles!fk_group_members_user(*)")
        .eq("group_id", room.id);
      if (error) { logError("openRoomMembers", error); showNotif("Couldn't load members — try again", "err"); setLoadingMembers(false); return; }
      const members: Profile[] = (data || [])
        .map((r: any) => r.member)
        .filter(Boolean)
        .filter((m: Profile) => m.id !== user.id); // don't show the host themselves
      setRoomMembers(members);
      trackEvent("room_members_view", { room_id: room.id, member_count: members.length });
    } catch (e) {
      logError("openRoomMembers", e);
      showNotif("Couldn't load members — try again", "err");
    } finally {
      setLoadingMembers(false);
    }
  };

  const closeRoomMembers = () => {
    setViewingMembersRoom(null);
    setRoomMembers([]);
  };

  const loadGroups = async () => {
    if (!user) return;
    try {
      const [groupRes, joinedRes] = await Promise.all([
        withRetry(() => supabase.from("group_rooms")
          .select("*, host:profiles!fk_group_rooms_host(*)")
          .order("created_at", { ascending: false })
          .limit(50)),
        withRetry(() => supabase.from("group_members").select("group_id").eq("user_id", user.id)),
      ]);
      if (groupRes.error) { logError("loadGroups", groupRes.error); return; }
      const joinedSet = new Set((joinedRes.data || []).map((j: any) => j.group_id));
      if (groupRes.data) setGroups(groupRes.data.map((g: any) => ({ ...g, joined: joinedSet.has(g.id) })));
    } catch (e) { logError("loadGroups", e); }
  };

  const submitGroup = async () => {
    if (!newGrp.subject || !newGrp.date || !newGrp.time || !user) return showNotif("Fill subject, date and time", "err");
    if (!navigator.onLine) return showNotif("You're offline — can't create room right now.", "err");
    if (roomActionLoading) return;
    setRoomActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showNotif("Session expired — please sign in again", "err"); return; }
      await supabase.from("profiles").upsert({
        id: user.id, email: user.email, name: profile.name || "", uni: profile.uni || "", major: profile.major || "",
        year: profile.year || "", course: profile.course || "", meet_type: profile.meet_type || "flexible",
        bio: profile.bio || "", avatar_emoji: profile.avatar_emoji || "🫶", avatar_color: profile.avatar_color || "#6C8EF5",
        photo_mode: profile.photo_mode || "initials", photo_url: profile.photo_url || null,
        streak: profile.streak ?? 0, xp: profile.xp ?? 0, badges: profile.badges ?? [], online: true,
        sessions: profile.sessions ?? 0, rating: profile.rating ?? 0, subjects: profile.subjects ?? [],
      }, { onConflict: "id" });
      const { data, error } = await supabase.from("group_rooms").insert({
        host_id: user.id,
        subject: newGrp.subject,
        date: newGrp.date,
        time: newGrp.time,
        type: newGrp.type,
        spots: Number(newGrp.spots) || 4,
        filled: 0,
        link: newGrp.link,
        location: newGrp.location,
      }).select("*, host:profiles!fk_group_rooms_host(*)").single();
      if (error) { showNotif("Failed to create room — " + error.message, "err"); return; }
      if (data) {
        setGroups(prev => [{ ...data, joined: false } as GroupRoom, ...prev]);
        setNewGrp({ subject: "", date: "", time: "", type: "online", spots: 4, link: "", location: "", note: "" });
        setShowGrpModal(false);
        showNotif("Study room created! 🎓");
        await awardBadge("group_host");
      }
    } catch { showNotif("Failed to create room — please try again", "err"); }
    finally { setRoomActionLoading(false); }
  };

  const openEditRoom = (g: GroupRoom) => {
    setEditingRoom(g);
    setEditGrp({ subject: g.subject, date: g.date, time: g.time, type: g.type, spots: g.spots, link: g.link || "", location: g.location || "" });
  };

  const saveEditRoom = async () => {
    if (!editingRoom || !user) return;
    if (!editGrp.subject || !editGrp.date || !editGrp.time) return showNotif("Fill subject, date and time", "err");
    if (!navigator.onLine) return showNotif("You're offline — can't save changes right now.", "err");
    if (roomActionLoading) return;
    setRoomActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showNotif("Session expired — please sign in again", "err"); return; }
      if (editingRoom.host_id !== user.id) { showNotif("Only the room creator can edit", "err"); return; }
      const newSpots = Number(editGrp.spots) || 4;
      if (newSpots < editingRoom.filled) { showNotif(`Can't reduce spots below ${editingRoom.filled} (current members)`, "err"); return; }
      const { error } = await supabase.from("group_rooms").update({
        subject: editGrp.subject,
        date: editGrp.date,
        time: editGrp.time,
        type: editGrp.type,
        spots: newSpots,
        link: editGrp.link,
        location: editGrp.location,
      }).eq("id", editingRoom.id).eq("host_id", user.id);
      if (error) { showNotif("Failed to update room — " + error.message, "err"); return; }
      setGroups(prev => prev.map(g => g.id === editingRoom.id ? { ...g, subject: editGrp.subject, date: editGrp.date, time: editGrp.time, type: editGrp.type, spots: newSpots, link: editGrp.link, location: editGrp.location } : g));
      setEditingRoom(null);
      showNotif("Room updated ✅");
    } catch { showNotif("Failed to update room — please try again", "err"); }
    finally { setRoomActionLoading(false); }
  };

  const deleteRoom = async (groupId: string) => {
    if (!user) return;
    if (!navigator.onLine) return showNotif("You're offline — can't delete right now.", "err");
    if (roomActionLoading) return;
    setRoomActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showNotif("Session expired — please sign in again", "err"); return; }
      const room = groups.find(g => g.id === groupId);
      if (!room || room.host_id !== user.id) { showNotif("Only the room creator can delete", "err"); return; }
      const { error } = await supabase.from("group_rooms").delete().eq("id", groupId).eq("host_id", user.id);
      if (error) { showNotif("Failed to delete room — " + error.message, "err"); return; }
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setConfirmDeleteRoom(null);
      showNotif("Room deleted");
      trackEvent("room_delete", { room_id: groupId });
    } catch { showNotif("Failed to delete room — please try again", "err"); }
    finally { setRoomActionLoading(false); }
  };

  const toggleJoinGroup = async (groupId: string, joined: boolean) => {
    if (!user) return;
    if (joiningGroupRef.current.has(groupId)) return;
    joiningGroupRef.current.add(groupId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showNotif("Session expired — please sign in again", "err"); return; }
      if (joined) {
        const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", user.id);
        if (error) { showNotif("Failed to leave group", "err"); return; }
        await supabase.rpc("increment_filled", { room_id: groupId, delta: -1 });
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, filled: Math.max(0, g.filled - 1), joined: false } : g));
        trackEvent("room_leave", { room_id: groupId });
      } else {
        const cur = groups.find(g => g.id === groupId);
        if (cur && cur.filled >= cur.spots) { showNotif("Room is full!", "err"); return; }
        const { error } = await supabase.from("group_members").upsert({ group_id: groupId, user_id: user.id }, { onConflict: "group_id,user_id" });
        if (error) { showNotif("Failed to join group", "err"); return; }
        const { error: rpcErr } = await supabase.rpc("increment_filled", { room_id: groupId, delta: 1 });
        if (rpcErr) { showNotif("Failed to join — room may be full", "err"); return; }
        const { count } = await supabase.from("group_members").select("*", { count: "exact", head: true }).eq("group_id", groupId);
        const room = groups.find(g => g.id === groupId);
        if (room && count !== null && count > room.spots) {
          try { await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", user.id); } catch (e) { logError("rollback:leave_group", e); }
          try { await supabase.rpc("increment_filled", { room_id: groupId, delta: -1 }); } catch (e) { logError("rollback:decrement_filled", e); }
          showNotif("Room just filled up! Try another session.", "err");
          return;
        }
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, filled: g.filled + 1, joined: true } : g));
        trackEvent("room_join", { room_id: groupId });
        showNotif("You joined the session! 🎓");
      }
    } catch { showNotif("Failed — please try again", "err"); }
    finally { joiningGroupRef.current.delete(groupId); }
  };

  return {
    groups, setGroups,
    showGrpModal, setShowGrpModal,
    newGrp, setNewGrp,
    editingRoom, setEditingRoom,
    editGrp, setEditGrp,
    confirmDeleteRoom, setConfirmDeleteRoom,
    roomActionLoading,
    loadGroups, submitGroup, openEditRoom, saveEditRoom, deleteRoom, toggleJoinGroup,
    // Members modal
    viewingMembersRoom, roomMembers, loadingMembers,
    openRoomMembers, closeRoomMembers,
  };
}
