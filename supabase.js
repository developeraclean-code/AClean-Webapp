// src/lib/supabase.js
// File ini menghubungkan webapp ke Supabase
// Credentials dibaca dari environment variables — AMAN, tidak hardcode

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase env vars tidak ditemukan. Cek VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Session otomatis tersimpan di browser — tidak logout saat refresh
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    // Aktifkan realtime untuk sync data live antar pengguna
    params: { eventsPerSecond: 10 },
  },
});

// ── Helper functions — dipakai di seluruh webapp ──────────────

/**
 * Login dengan email + password
 * Gantikan doLogin() yang hardcode di v4
 */
export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

/**
 * Logout
 */
export const signOut = async () => {
  await supabase.auth.signOut();
};

/**
 * Ambil profil user yang sedang login
 * Termasuk role (Owner / Admin / Teknisi) dari tabel user_profiles
 */
export const getCurrentUserProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return profile ? { ...user, ...profile } : user;
};

/**
 * Cek apakah ada session aktif (untuk restore login saat refresh)
 */
export const getSession = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
};

// ── Database helpers ──────────────────────────────────────────

export const db = {

  // ORDERS
  orders: {
    getAll: () => supabase.from('orders').select('*').order('date', { ascending: false }),
    getByStatus: (status) => supabase.from('orders').select('*').eq('status', status),
    getByTeknisi: (name) => supabase.from('orders').select('*').eq('teknisi', name),
    create: (data) => supabase.from('orders').insert(data).select().single(),
    update: (id, data) => supabase.from('orders').update(data).eq('id', id),
  },

  // INVOICES
  invoices: {
    getAll: () => supabase.from('invoices').select('*').order('created_at', { ascending: false }),
    getByStatus: (status) => supabase.from('invoices').select('*').eq('status', status),
    create: (data) => supabase.from('invoices').insert(data).select().single(),
    update: (id, data) => supabase.from('invoices').update(data).eq('id', id),
  },

  // CUSTOMERS
  customers: {
    getAll: () => supabase.from('customers').select('*').order('name'),
    getById: (id) => supabase.from('customers').select('*').eq('id', id).single(),
    create: (data) => supabase.from('customers').insert(data).select().single(),
    update: (id, data) => supabase.from('customers').update(data).eq('id', id),
  },

  // INVENTORY
  inventory: {
    getAll: () => supabase.from('inventory').select('*').order('code'),
    getLowStock: () => supabase.from('inventory').select('*').in('status', ['CRITICAL', 'OUT']),
    update: (code, data) => supabase.from('inventory').update(data).eq('code', code),
    create: (data) => supabase.from('inventory').insert(data).select().single(),
  },

  // SERVICE REPORTS (LAPORAN)
  reports: {
    getAll: () => supabase.from('service_reports').select('*').order('submitted_at', { ascending: false }),
    getByJob: (jobId) => supabase.from('service_reports').select('*').eq('job_id', jobId),
    create: (data) => supabase.from('service_reports').insert(data).select().single(),
    update: (id, data) => supabase.from('service_reports').update(data).eq('id', id),
  },

  // WA CONVERSATIONS
  wa: {
    getAll: () => supabase.from('wa_conversations').select('*').order('updated_at', { ascending: false }),
    getMessages: (convId) => supabase.from('wa_messages').select('*').eq('conversation_id', convId).order('sent_at'),
    addMessage: (data) => supabase.from('wa_messages').insert(data),
  },

  // AGENT LOGS
  logs: {
    getRecent: (limit = 50) => supabase.from('agent_logs').select('*').order('created_at', { ascending: false }).limit(limit),
    add: (action, detail, status = 'SUCCESS') => supabase.from('agent_logs').insert({
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      action, detail, status
    }),
  },
};

export default supabase;
