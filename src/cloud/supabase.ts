import { createClient } from "@supabase/supabase-js";

export const cloudMode = import.meta.env.VITE_DEPLOYMENT_MODE === "cloud";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudConfigurationError = cloudMode && (!url || !anonKey)
  ? "在线服务配置不完整"
  : null;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export async function accessToken() {
  if (!cloudMode || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
