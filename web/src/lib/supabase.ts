import { createClient } from '@supabase/supabase-js';

// Fallbacks keep createClient from throwing in demo builds (no env). Demo mode
// never issues real requests, so these placeholders are never contacted.
const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://demo.supabase.co';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'demo-anon-key';

export const supabase = createClient(url, anon);
