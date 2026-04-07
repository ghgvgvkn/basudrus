import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  name: string;
  email: string;
  uni: string;
  major: string;
  year: string;
  course: string;
  meet_type: string;
  bio: string;
  avatar_emoji: string;
  avatar_color: string;
  photo_mode: string;
  photo_url: string | null;
  streak: number;
  xp: number;
  badges: string[];
  online: boolean;
  sessions: number;
  rating: number;
  subjects: string[];
  can_post?: boolean;
  created_at: string;
};

export type Connection = {
  id: string;
  user_id: string;
  partner_id: string;
  rating: number | null;
  created_at: string;
  partner?: Profile;
};

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  created_at: string;
};

export type HelpRequest = {
  id: string;
  user_id: string;
  subject: string;
  detail: string;
  meet_type: string;
  created_at: string;
  profile?: Profile;
};

export type GroupRoom = {
  id: string;
  host_id: string;
  subject: string;
  date: string;
  time: string;
  type: string;
  spots: number;
  filled: number;
  link: string;
  location: string;
  created_at: string;
  host?: Profile;
  joined?: boolean;
};

export type SubjectHistory = {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  note: string;
  created_at: string;
};

export type Report = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  created_at: string;
  reporter?: Profile;
  reported?: Profile;
};

export type Notification = {
  id: string;
  user_id: string;
  from_id: string;
  type: string;
  subject: string;
  post_id: string | null;
  read: boolean;
  created_at: string;
  from_profile?: Profile;
};
