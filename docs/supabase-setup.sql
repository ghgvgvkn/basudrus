-- ============================================================
-- BAS UDRUS — COMPLETE SUPABASE DATABASE SETUP
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
-- 1. CREATE MISSING TABLES (notifications & reports)
--    Your app uses 9 tables total. You have 7.
--    Run this to add the 2 missing ones.
-- ============================================================

-- NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL DEFAULT '',
  body TEXT DEFAULT '',
  post_id UUID REFERENCES help_requests(id) ON DELETE CASCADE,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- REPORTS TABLE
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  detail TEXT DEFAULT '',
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 2. ENFORCE ALL FOREIGN KEYS
--    This adds any missing foreign key constraints.
--    If a constraint already exists, the command will
--    harmlessly fail — that's fine.
-- ============================================================

-- connections
DO $$ BEGIN
  ALTER TABLE connections
    ADD CONSTRAINT fk_connections_user FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE connections
    ADD CONSTRAINT fk_connections_partner FOREIGN KEY (partner_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- messages
DO $$ BEGIN
  ALTER TABLE messages
    ADD CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE messages
    ADD CONSTRAINT fk_messages_receiver FOREIGN KEY (receiver_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- help_requests
-- IMPORTANT: If Supabase auto-created help_requests_user_id_fkey, drop it first
-- to avoid ambiguous FK errors (PGRST201). Only fk_help_requests_user should exist.
-- Run: ALTER TABLE help_requests DROP CONSTRAINT IF EXISTS help_requests_user_id_fkey;
DO $$ BEGIN
  ALTER TABLE help_requests
    ADD CONSTRAINT fk_help_requests_user FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- subject_history
DO $$ BEGIN
  ALTER TABLE subject_history
    ADD CONSTRAINT fk_subject_history_user FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- group_rooms
DO $$ BEGIN
  ALTER TABLE group_rooms
    ADD CONSTRAINT fk_group_rooms_host FOREIGN KEY (host_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- group_members
DO $$ BEGIN
  ALTER TABLE group_members
    ADD CONSTRAINT fk_group_members_group FOREIGN KEY (group_id)
    REFERENCES group_rooms(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE group_members
    ADD CONSTRAINT fk_group_members_user FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- notifications (already defined in CREATE TABLE, but just in case)
DO $$ BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT fk_notifications_from FOREIGN KEY (from_id)
    REFERENCES profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT fk_notifications_post FOREIGN KEY (post_id)
    REFERENCES help_requests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- reports
DO $$ BEGIN
  ALTER TABLE reports
    ADD CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE reports
    ADD CONSTRAINT fk_reports_reported FOREIGN KEY (reported_id)
    REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
--    Enables RLS on every table and adds the right policies.
--    Uses CREATE POLICY IF NOT EXISTS equivalent via DO blocks.
-- ============================================================

-- ---- PROFILES ----
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "profiles_select_all" ON profiles FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- CONNECTIONS ----
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "connections_select_own" ON connections FOR SELECT
    USING (auth.uid() = user_id OR auth.uid() = partner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "connections_insert_own" ON connections FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "connections_update_own" ON connections FOR UPDATE
    USING (auth.uid() = user_id OR auth.uid() = partner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "connections_delete_own" ON connections FOR DELETE
    USING (auth.uid() = user_id OR auth.uid() = partner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- MESSAGES ----
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "messages_select_own" ON messages FOR SELECT
    USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "messages_insert_own" ON messages FOR INSERT
    WITH CHECK (auth.uid() = sender_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- HELP_REQUESTS ----
ALTER TABLE help_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "help_requests_select_all" ON help_requests FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "help_requests_insert_own" ON help_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "help_requests_update_own" ON help_requests FOR UPDATE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "help_requests_delete_own" ON help_requests FOR DELETE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- GROUP_ROOMS ----
ALTER TABLE group_rooms ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "group_rooms_select_all" ON group_rooms FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "group_rooms_insert_own" ON group_rooms FOR INSERT
    WITH CHECK (auth.uid() = host_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "group_rooms_update_own" ON group_rooms FOR UPDATE
    USING (auth.uid() = host_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "group_rooms_delete_own" ON group_rooms FOR DELETE
    USING (auth.uid() = host_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- GROUP_MEMBERS ----
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "group_members_select_all" ON group_members FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "group_members_insert_own" ON group_members FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "group_members_delete_own" ON group_members FOR DELETE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- SUBJECT_HISTORY ----
ALTER TABLE subject_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "subject_history_select_own" ON subject_history FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "subject_history_insert_own" ON subject_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "subject_history_update_own" ON subject_history FOR UPDATE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- NOTIFICATIONS ----
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "notifications_insert_any" ON notifications FOR INSERT
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "notifications_delete_own" ON notifications FOR DELETE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- REPORTS ----
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "reports_select_admin" ON reports FOR SELECT
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "reports_insert_any" ON reports FOR INSERT
    WITH CHECK (auth.uid() = reporter_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "reports_update_admin" ON reports FOR UPDATE
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- 4. USEFUL INDEXES (optional but recommended)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_partner ON connections(partner_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_help_requests_user ON help_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_subject_history_user ON subject_history(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_post ON notifications(post_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);


-- ============================================================
-- DONE! All foreign keys, cascade deletes, and RLS are set.
-- Refresh your Supabase schema visualizer — all lines
-- should now be solid.
-- ============================================================
