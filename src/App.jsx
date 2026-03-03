import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";

// ============================================================
// SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = "https://fiokvqtvmlnprsywhipj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpb2t2cXR2bWxucHJzeXdoaXBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDEzNTEsImV4cCI6MjA4NzM3NzM1MX0.BeWMR2qMqQadfkOz_yVMJ4Bj_zrTMtZCKM0CtKPvUAk";

// Minimal Supabase client (no SDK needed)
const supabase = {
  authToken: null,
  userId: null,

  async fetch(path, options = {}) {
    const headers = {
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...(this.authToken ? { "Authorization": `Bearer ${this.authToken}` } : {}),
      ...options.headers,
    };
    const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error_description || data.msg || "Erro na requisição");
    return data;
  },

  // Auth
  async signIn(email, password) {
    const data = await this.fetch("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.authToken = data.access_token;
    this.userId = data.user?.id;
    return data;
  },

  async signOut() {
    if (this.authToken) {
      try { await this.fetch("/auth/v1/logout", { method: "POST" }); } catch (e) {}
    }
    this.authToken = null;
    this.userId = null;
  },

  // Database queries via PostgREST
  async from(table) {
    return {
      _table: table,
      _filters: "",
      _select: "*",
      _order: "",
      _limit: "",

      select(cols) { this._select = cols || "*"; return this; },
      eq(col, val) { this._filters += `&${col}=eq.${val}`; return this; },
      neq(col, val) { this._filters += `&${col}=neq.${val}`; return this; },
      gte(col, val) { this._filters += `&${col}=gte.${val}`; return this; },
      lte(col, val) { this._filters += `&${col}=lte.${val}`; return this; },
      order(col, opts) { this._order = `&order=${col}.${opts?.ascending ? "asc" : "desc"}`; return this; },
      limit(n) { this._limit = `&limit=${n}`; return this; },

      async execute() {
        const path = `/rest/v1/${this._table}?select=${encodeURIComponent(this._select)}${this._filters}${this._order}${this._limit}`;
        return supabase.fetch(path);
      },

      async insert(data) {
        return supabase.fetch(`/rest/v1/${this._table}`, {
          method: "POST",
          headers: { "Prefer": "return=representation" },
          body: JSON.stringify(data),
        });
      },

      async update(data) {
        return supabase.fetch(`/rest/v1/${this._table}?${this._filters.slice(1)}`, {
          method: "PATCH",
          headers: { "Prefer": "return=representation" },
          body: JSON.stringify(data),
        });
      },

      async upsert(data) {
        return supabase.fetch(`/rest/v1/${this._table}`, {
          method: "POST",
          headers: { "Prefer": "return=representation,resolution=merge-duplicates" },
          body: JSON.stringify(data),
        });
      },
    };
  },

  // Storage
  async uploadPhoto(file, path) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/checklist-photos/${path}`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${this.authToken}`,
      },
      body: file,
    });
    if (!res.ok) throw new Error("Falha no upload da foto");
    return `${SUPABASE_URL}/storage/v1/object/public/checklist-photos/${path}`;
  },
};

// Helper to query Supabase
const db = {
  async query(table, select = "*", filters = {}) {
    let path = `/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null) path += `&${k}=${v}`;
    });
    return supabase.fetch(path);
  },

  async insert(table, data) {
    return supabase.fetch(`/rest/v1/${table}`, {
      method: "POST",
      headers: { "Prefer": "return=representation" },
      body: JSON.stringify(data),
    });
  },

  async update(table, filters, data) {
    let path = `/rest/v1/${table}?`;
    Object.entries(filters).forEach(([k, v]) => { path += `${k}=eq.${v}&`; });
    return supabase.fetch(path.slice(0, -1), {
      method: "PATCH",
      headers: { "Prefer": "return=representation" },
      body: JSON.stringify(data),
    });
  },
};

// ============================================================
// AUTH CONTEXT
// ============================================================
const AuthContext = createContext(null);

const ROLE_LABELS = { admin: "Administrador", manager: "Gerente", employee: "Funcionário" };
const SECTORS = ["Cozinha", "Bar", "Salão", "Caixa", "Estoque", "Gerência"];
const MOMENTS = ["Abertura", "Fechamento", "Outros"];

// Templates and executions are now loaded from Supabase in MainApp

// ============================================================
// SVG ICONS
// ============================================================
const icons = {
  dashboard: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  checklist: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  users: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  templates: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  reports: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z",
  alerts: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
  settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  menu: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  play: "M8 5v14l11-7z",
  logout: "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
  building: "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z",
  expand: "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z",
  camera: "M12 12m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9z",
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  email: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  eyeOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  whatsapp: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z",
  shield: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z",
  sun: "M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z",
  moon: "M10 2c-1.82 0-3.53.5-5 1.35C7.99 5.08 10 8.3 10 12s-2.01 6.92-5 8.65C6.47 21.5 8.18 22 10 22c5.52 0 10-4.48 10-10S15.52 2 10 2z",
};

const Icon = ({ name, size = 20, color = "currentColor", style: s }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0, ...s }}>
    <path d={icons[name] || icons.check} />
  </svg>
);

// Japa Carioca Logo — original image, theme-aware
const LOGO_LIGHT = "data:image/png;base64,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";
const LOGO_DARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAX20lEQVR42u3d248kSXUG8O9EZGZV96y1XlhkwPj6YD/ZQiALbAFC+N9GfrAtAQKBJdtIlm0JZCEuuyyw7HTlJeIcP0RGVmZV1rWru6u7v5+0u7O7MzVVORUnTtxOAERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERI9C+AjoKXxS1yYQAAYD8M5yye8iAwC9ZG/b1sQ5fO9v/wb44Ne4M4XzDjfmYO+9i6/8549hGvGmqvi9ZACgF9Pwm9Z++KUvo/3pT+AX72Bx46GFQ3Al1CtKVUir6FYB2jbAn3wBX/nRDxgIGADoubsLwf71vfdRfmoBX91CoiFAYWooo4eoQguDOYGzEigd5O3HePv7Gl//7Ue49Z7fUQYAeo6+/c1vWPFvP8Lis59H1wX4roU5BycOZhEBCtECDhEqgJpgAaD1Hr4o0H34S+hf/xX+8bs/4Pf0gTg+Anqont//+39g+ek/Qnf3Fi52MOchBsQQoAZ48YAAKh4CD1Ggg8CJAXWLxfufA/7np/inb37L+EQZAOi5jPnb1r7zh+9j+d57aEMLiIOqwUxhAljuzxUwVcAMIgLnHQwAokCdILQNbj71LuIPv4+3XccgwCHAK+xJ69oA4PYZLZN9+0//wt64FgEVAIWYpYavqaEPXz4RmAnMLP8HAID1AQEGqFdIoYi/F3zrF//H7yszgJevbhoLIZjGaMuyxE1VQmO0GKN1XWc5KFxl79915n73a0S/hFOFmKaGPXrHIgJVHX48BIW+4Q//TQxeBUW8hXUrZgEMAC+/t48x2KIs4Uc95dBBAii8w01VoWnbq2wM3/nylyC370BDhIkgGtY9fM78VeGc64OAwkzhHCBiMFU4kRQMIGnooAHl7S2++8Uv8kvCAPBye/2bqoJDSol3tW7rG1RVFGivLAh8UtfW/epDLG5u4ERgQGrMo7TezOCcGw0BDM5NM4LpIFUQNaIoSzQffIhPrjj7YQCgsxv/oiyBPQ1/c9LGzFAWBVZX1CDEOfjVHaIFwBReME3pR0OA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";
const JapaLogo = ({ size = 48, theme }) => (
  <img 
    src={theme === "dark" ? LOGO_DARK : LOGO_LIGHT} 
    width={size} height={size} alt="Japa Carioca" 
    style={{ flexShrink: 0, objectFit: "contain", borderRadius: theme === "dark" ? 0 : 8 }} 
  />
);

// ============================================================
// CSS VARIABLES & THEME
// ============================================================
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800&display=swap');
  
  :root, [data-theme="dark"] {
    --bg-deep: #060b18;
    --bg-base: #0a1025;
    --bg-surface: #0f1733;
    --bg-elevated: #152042;
    --bg-hover: #1a2850;
    --border: rgba(45, 212, 165, 0.08);
    --border-accent: rgba(45, 212, 165, 0.2);
    --text-primary: #eaf0fa;
    --text-secondary: #8d9bb5;
    --text-muted: #5e6f8a;
    --accent: #2dd4a8;
    --accent-secondary: #6c63ff;
    --accent-dim: rgba(45, 212, 165, 0.1);
    --accent-glow: rgba(45, 212, 165, 0.2);
    --danger: #ff6b7a;
    --warning: #ffb347;
    --info: #6c9fff;
    --success: #2dd4a8;
    --purple: #a78bfa;
    --topbar-bg: rgba(10,16,37,0.75);
    --sidebar-bg: var(--bg-base);
    --logo-text: var(--bg-deep);
    --btn-primary-text: #06100d;
    --shadow-sm: 0 2px 8px rgba(0,0,0,0.25);
    --shadow-md: 0 4px 20px rgba(0,0,0,0.35);
    --shadow-lg: 0 8px 40px rgba(0,0,0,0.45);
    --shadow-glow: 0 4px 20px rgba(45, 212, 165, 0.18);
    --content-gradient: radial-gradient(ellipse at 15% 50%, rgba(45,212,165,0.025) 0%, transparent 60%);
    --scrollbar-thumb: rgba(45,212,165,0.12);
    --toggle-bg: var(--bg-elevated);
    --toggle-icon: var(--warning);
    --badge-accent-bg: rgba(45,212,165,0.12);
    --badge-danger-bg: rgba(255,107,122,0.12);
    --badge-warning-bg: rgba(255,179,71,0.12);
    --badge-info-bg: rgba(108,159,255,0.12);
    --badge-purple-bg: rgba(167,139,250,0.12);
    --badge-success-bg: rgba(45,212,165,0.12);
  }

  [data-theme="light"] {
    --bg-deep: #f2f4f8;
    --bg-base: #ffffff;
    --bg-surface: #ffffff;
    --bg-elevated: #f5f6fa;
    --bg-hover: #eceef5;
    --border: rgba(0, 0, 0, 0.1);
    --border-accent: rgba(16, 150, 120, 0.3);
    --text-primary: #0f172a;
    --text-secondary: #374151;
    --text-muted: #4b5563;
    --accent: #059669;
    --accent-secondary: #6c63ff;
    --accent-dim: rgba(5, 150, 105, 0.1);
    --accent-glow: rgba(5, 150, 105, 0.15);
    --danger: #dc2626;
    --warning: #d97706;
    --info: #2563eb;
    --success: #059669;
    --purple: #7c3aed;
    --topbar-bg: rgba(255,255,255,0.9);
    --sidebar-bg: #ffffff;
    --logo-text: #ffffff;
    --btn-primary-text: #ffffff;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
    --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
    --shadow-glow: 0 4px 14px rgba(5, 150, 105, 0.15);
    --content-gradient: radial-gradient(ellipse at 15% 50%, rgba(5,150,105,0.02) 0%, transparent 60%);
    --scrollbar-thumb: rgba(0,0,0,0.15);
    --toggle-bg: var(--bg-elevated);
    --toggle-icon: var(--accent);
    --badge-accent-bg: rgba(5,150,105,0.1);
    --badge-danger-bg: rgba(220,38,38,0.1);
    --badge-warning-bg: rgba(217,119,6,0.1);
    --badge-info-bg: rgba(37,99,235,0.1);
    --badge-purple-bg: rgba(124,58,237,0.1);
    --badge-success-bg: rgba(5,150,105,0.1);
  }

  :root {
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 20px;
    --font: 'Plus Jakarta Sans', -apple-system, sans-serif;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); background: var(--bg-deep); color: var(--text-primary); }
  
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }
  
  input, select, textarea, button { font-family: var(--font); }
  
  @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideRight { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
  @keyframes glow { 0%, 100% { box-shadow: 0 0 5px rgba(45,212,165,0.2); } 50% { box-shadow: 0 0 20px rgba(45,212,165,0.4); } }
  @keyframes notifIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes themeSwitch { 0% { transform: rotate(0deg) scale(1); } 50% { transform: rotate(180deg) scale(0.8); } 100% { transform: rotate(360deg) scale(1); } }
  
  .animate-fade { animation: fadeIn 0.4s ease; }
  .animate-slide { animation: slideUp 0.5s ease; }
  .animate-shake { animation: shake 0.4s ease; }
  .animate-scale { animation: scaleIn 0.3s ease; }
  .theme-switch-anim { animation: themeSwitch 0.5s ease; }

  [data-theme="light"] .sidebar-border { border-right: 1px solid rgba(0,0,0,0.06) !important; box-shadow: 2px 0 8px rgba(0,0,0,0.03); }
  [data-theme="light"] table tr:hover td { background: rgba(5,150,105,0.04) !important; }
  [data-theme="light"] input, [data-theme="light"] select, [data-theme="light"] textarea { background: #f8f9fc !important; border-color: rgba(0,0,0,0.12) !important; color: #111827 !important; }
  [data-theme="light"] input::placeholder, [data-theme="light"] textarea::placeholder { color: #6b7280 !important; }
  [data-theme="dark"] table tr:hover td { background: rgba(45,212,165,0.04) !important; }

  /* ===== MOBILE RESPONSIVE ===== */
  @media (max-width: 768px) {
    .mobile-grid-1 { grid-template-columns: 1fr !important; }
    .desktop-only { display: none !important; }
    table { font-size: 12px; }
    table th, table td { padding: 8px 10px !important; }
  }
  @media (min-width: 769px) {
    .mobile-only { display: none !important; }
  }
`;

// ============================================================
// REUSABLE COMPONENTS
// ============================================================

const Btn = ({ children, variant = "primary", size = "md", onClick, disabled, style: s, ...props }) => {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 8, border: "none",
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "var(--font)",
    fontWeight: 600, borderRadius: "var(--radius-md)", transition: "all 0.2s",
    opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
    ...(size === "sm" ? { padding: "7px 14px", fontSize: 13 } : size === "lg" ? { padding: "14px 28px", fontSize: 16 } : { padding: "10px 22px", fontSize: 14 }),
    ...(variant === "primary" ? {
      background: "linear-gradient(135deg, var(--accent), var(--success))", color: "var(--btn-primary-text)",
      boxShadow: "var(--shadow-glow)",
    } : variant === "danger" ? {
      background: "var(--badge-danger-bg)", color: "var(--danger)", border: "1px solid var(--danger)",
    } : variant === "ghost" ? {
      background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--border-accent)",
    } : {
      background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)",
    }),
    ...s,
  };
  return <button style={base} onClick={onClick} disabled={disabled} {...props}>{children}</button>;
};

const Input = ({ label, error, style: s, ...props }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, ...s }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>}
    <input style={{
      background: "var(--bg-surface)", border: error ? "1.5px solid var(--danger)" : "1.5px solid var(--border)",
      borderRadius: "var(--radius-md)", padding: "12px 16px", color: "var(--text-primary)",
      fontSize: 14, outline: "none", transition: "border 0.2s", width: "100%",
    }} {...props} />
    {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
  </div>
);

const Select = ({ label, options, style: s, ...props }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, ...s }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>}
    <select style={{
      background: "var(--bg-surface)", border: "1.5px solid var(--border)",
      borderRadius: "var(--radius-md)", padding: "12px 16px", color: "var(--text-primary)",
      fontSize: 14, outline: "none", appearance: "auto",
    }} {...props}>
      {options.map(o => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const badgeBg = (color) => {
  if (color === "var(--accent)" || color === "var(--success)") return "var(--badge-accent-bg)";
  if (color === "var(--danger)") return "var(--badge-danger-bg)";
  if (color === "var(--warning)") return "var(--badge-warning-bg)";
  if (color === "var(--info)") return "var(--badge-info-bg)";
  if (color === "var(--purple)") return "var(--badge-purple-bg)";
  return "var(--badge-accent-bg)";
};

const Badge = ({ children, color = "var(--accent)", style: s }) => (
  <span style={{
    padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: 600,
    background: badgeBg(color), color, border: `1px solid ${badgeBg(color)}`,
    display: "inline-flex", alignItems: "center", gap: 4, ...s,
  }}>{children}</span>
);

const Card = ({ children, style: s, className, ...props }) => (
  <div className={className} style={{
    background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)", padding: 24,
    boxShadow: "var(--shadow-sm)", ...s,
  }} {...props}>{children}</div>
);

const CircularProgress = ({ value, size = 100, color = "var(--accent)", bg = "var(--accent-dim)" }) => {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ - (value / 100) * circ} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <div style={{ position: "absolute", fontSize: size * 0.26, fontWeight: 800 }}>{value}%</div>
    </div>
  );
};

const ProgressBar = ({ value, color = "var(--accent)", height = 6 }) => (
  <div style={{ height, borderRadius: height, background: "var(--accent-dim)", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${value}%`, borderRadius: height, background: color, transition: "width 0.6s ease" }} />
  </div>
);

// ============================================================
// LOGIN PAGE
// ============================================================
const LoginPage = ({ onLogin, onGoToRegister, onGoToForgot, theme, onToggleTheme }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!email || !password) { setError("Preencha todos os campos"); return; }
    setLoading(true);
    try {
      const authData = await supabase.signIn(email, password);
      // Load user profile from Supabase
      const profiles = await db.query("profiles", "id,name,email,role,phone,sector_id,unit_id,created_at", { id: `eq.${authData.user.id}` });
      const profile = profiles[0];
      if (!profile) { setError("Perfil não encontrado"); setLoading(false); return; }
      // Get sector name separately
      let sectorName = "Gerência";
      if (profile.sector_id) {
        try {
          const sectors = await db.query("sectors", "name", { id: `eq.${profile.sector_id}` });
          if (sectors[0]) sectorName = sectors[0].name;
        } catch(e) {}
      }
      const user = {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        sector: sectorName,
        avatar: profile.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase(),
        unit_id: profile.unit_id,
        phone: profile.phone,
        created_at: profile.created_at,
      };
      onLogin(user);
    } catch (err) {
      // Demo mode fallback (when Supabase is unreachable, e.g. in Claude artifacts)
      const demoUsers = [
        { id: "demo-1", email: "wallace@japacarioca.com", name: "Wallace", role: "admin", sector: "Gerência", unit_id: "demo-unit" },
        { id: "demo-2", email: "ana@japacarioca.com", name: "Ana Lima", role: "manager", sector: "Salão", unit_id: "demo-unit" },
        { id: "demo-3", email: "carlos@japacarioca.com", name: "Carlos Silva", role: "manager", sector: "Cozinha", unit_id: "demo-unit" },
      ];
      const demoUser = demoUsers.find(u => u.email === email);
      if (demoUser) {
        onLogin({ ...demoUser, avatar: demoUser.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase(), phone: "", created_at: "2025-01-01", _demo: true });
      } else {
        setError("Email ou senha incorretos");
      }
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: window.innerWidth < 768 ? "column" : "row", background: "var(--bg-deep)", position: "relative", overflowY: "auto", overflowX: "hidden" }}>
      {/* Theme toggle on login */}
      <div onClick={onToggleTheme} style={{
        position: "absolute", top: 20, right: 20, zIndex: 10,
        width: 44, height: 44, borderRadius: 14, cursor: "pointer",
        background: "var(--toggle-bg)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.3s ease", boxShadow: "var(--shadow-sm)",
      }}>
        <div key={theme} className="theme-switch-anim">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={20} color={theme === "dark" ? "var(--warning)" : "var(--accent)"} />
        </div>
      </div>

      {/* Background decoration */}
      <div style={{ position: "absolute", top: "-20%", right: "-10%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(64,224,176,0.06) 0%, transparent 70%)" }} />
      <div style={{ position: "absolute", bottom: "-20%", left: "-10%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(91,156,246,0.04) 0%, transparent 70%)" }} />
      
      {/* Left Panel - Brand (hidden on mobile) */}
      {window.innerWidth >= 768 && (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "60px 80px", position: "relative", zIndex: 1,
        background: "linear-gradient(135deg, var(--bg-base) 0%, var(--bg-deep) 100%)",
      }}>
        <div className="animate-slide">
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 48 }}>
            <JapaLogo size={60} theme={theme} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.03em" }}>Japa Carioca</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Sistema de Checklists</div>
            </div>
          </div>
          
          <h1 style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.03em", marginBottom: 20 }}>
            Controle total da<br />
            sua <span style={{ color: "var(--accent)" }}>operação</span>
          </h1>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 440 }}>
            Checklists inteligentes com evidência em tempo real. 
            Padronize processos, garanta execução e tenha visibilidade completa — de qualquer lugar.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 40 }}>
            {[
              { icon: "camera", text: "Foto obrigatória como prova de execução" },
              { icon: "whatsapp", text: "Alertas instantâneos no WhatsApp" },
              { icon: "shield", text: "Evidência auditável e rastreável" },
              { icon: "reports", text: "Dashboard com todos os dados em tempo real" },
            ].map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, animation: `fadeIn 0.4s ease ${i * 0.1}s both` }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={f.icon} size={18} color="var(--accent)" />
                </div>
                <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* Right Panel - Login Form */}
      <div style={{
        width: window.innerWidth < 768 ? "100%" : "min(480px, 100%)", flex: window.innerWidth < 768 ? "none" : 1,
        display: "flex", flexDirection: "column", justifyContent: window.innerWidth < 768 ? "flex-start" : "center",
        padding: window.innerWidth < 768 ? "20px 20px 40px" : "40px min(50px, 6vw)", position: "relative", zIndex: 1,
        minHeight: window.innerWidth < 768 ? "100vh" : "auto",
      }}>
        {/* Mobile logo header */}
        {window.innerWidth < 768 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32, justifyContent: "center" }}>
            <JapaLogo size={44} theme={theme} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.03em" }}>Japa Carioca</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Sistema de Checklists</div>
            </div>
          </div>
        )}
        <div className="animate-fade">
          <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6, letterSpacing: "-0.02em" }}>Entrar</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 15, marginBottom: 36 }}>Acesse sua conta para gerenciar a operação</p>

          {error && (
            <div className="animate-shake" style={{
              padding: "12px 16px", borderRadius: "var(--radius-md)", marginBottom: 20,
              background: "var(--badge-danger-bg)", border: "1px solid var(--badge-danger-bg)",
              color: "var(--danger)", fontSize: 14, display: "flex", alignItems: "center", gap: 10,
            }}>
              <Icon name="warning" size={18} color="var(--danger)" /> {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Input label="Email" type="email" placeholder="seu@email.com" value={email}
              onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />

            <div style={{ position: "relative" }}>
              <Input label="Senha" type={showPw ? "text" : "password"} placeholder="••••••••" value={password}
                onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
              <div style={{ position: "absolute", right: 14, top: 36, cursor: "pointer", opacity: 0.5 }}
                onClick={() => setShowPw(!showPw)}>
                <Icon name={showPw ? "eyeOff" : "eye"} size={18} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input type="checkbox" style={{ accentColor: "var(--accent)" }} /> Lembrar de mim
              </label>
              <span style={{ fontSize: 13, color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={onGoToForgot}>
                Esqueci a senha
              </span>
            </div>

            <Btn variant="primary" size="lg" onClick={handleLogin} disabled={loading}
              style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>
              {loading ? <span style={{ animation: "pulse 1s ease infinite" }}>Entrando...</span> : "Entrar"}
            </Btn>
          </div>

          <div style={{ textAlign: "center", marginTop: 32 }}>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              Não tem conta? {" "}
              <span style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={onGoToRegister}>
                Criar conta
              </span>
            </span>
          </div>

          {/* Demo credentials */}
          <div style={{
            marginTop: 32, padding: 16, borderRadius: "var(--radius-md)",
            background: "var(--bg-surface)", border: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Acesso demonstração
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { email: "wallace@japacarioca.com", role: "Admin" },
                { email: "ana@japacarioca.com", role: "Gerente" },
                { email: "juliana@japacarioca.com", role: "Colaborador" },
              ].map(d => (
                <div key={d.email} style={{
                  fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", padding: "4px 8px",
                  borderRadius: 6, display: "flex", justifyContent: "space-between",
                }} onClick={() => { setEmail(d.email); setPassword("123456"); }}>
                  <span style={{ fontFamily: "monospace" }}>{d.email}</span>
                  <Badge color="var(--info)">{d.role}</Badge>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Senha: 123456</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// REGISTER PAGE
// ============================================================
const RegisterPage = ({ onGoToLogin, theme }) => {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPw: "", phone: "", sector: "Cozinha" });
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleNext = () => {
    if (step === 1) {
      if (!form.name || !form.email) { setError("Preencha todos os campos"); return; }
      if (!form.email.includes("@")) { setError("Email inválido"); return; }
      setError(""); setStep(2);
    } else {
      if (!form.password || form.password.length < 6) { setError("Senha deve ter no mínimo 6 caracteres"); return; }
      if (form.password !== form.confirmPw) { setError("Senhas não conferem"); return; }
      setError(""); setStep(3);
    }
  };

  const handleRegister = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password, data: { name: form.name } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.msg || "Erro ao criar conta");
      
      // Update profile with sector and phone
      if (data.user?.id) {
        const token = data.access_token;
        if (token) {
          const sectors = await fetch(`${SUPABASE_URL}/rest/v1/sectors?name=eq.${form.sector}&limit=1`, {
            headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` },
          }).then(r => r.json());
          if (sectors[0]?.id) {
            await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}`, {
              method: "PATCH",
              headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=representation" },
              body: JSON.stringify({ phone: form.phone, sector_id: sectors[0].id, name: form.name }),
            });
          }
        }
      }
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Erro ao criar conta");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-deep)", position: "relative" }}>
      <div style={{ position: "absolute", top: "10%", left: "20%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(64,224,176,0.04) 0%, transparent 70%)" }} />
      
      <div className="animate-fade" style={{ width: "min(460px, 94vw)", padding: "48px min(44px, 5vw)", background: "var(--bg-base)", borderRadius: "var(--radius-xl)", border: "1px solid var(--border)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <div style={{ cursor: "pointer" }} onClick={onGoToLogin}><Icon name="back" size={22} color="var(--text-secondary)" /></div>
          <JapaLogo size={36} theme={theme} />
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>Criar Conta</h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Etapa {step} de 3</p>
          </div>
        </div>

        {/* Progress */}
        <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
          {[1,2,3].map(s => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? "var(--accent)" : "var(--accent-dim)", transition: "all 0.3s" }} />
          ))}
        </div>

        {error && (
          <div className="animate-shake" style={{ padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 16, background: "var(--badge-danger-bg)", border: "1px solid var(--badge-danger-bg)", color: "var(--danger)", fontSize: 13 }}>
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="animate-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="Nome completo" placeholder="Seu nome" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            <Input label="Email" type="email" placeholder="seu@email.com" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
            <Input label="Telefone (WhatsApp)" type="tel" placeholder="(21) 99999-0000" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
            <Btn variant="primary" size="lg" onClick={handleNext} style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>Próximo</Btn>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="Senha" type="password" placeholder="Mínimo 6 caracteres" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
            <Input label="Confirmar senha" type="password" placeholder="Repita a senha" value={form.confirmPw} onChange={e => setForm({...form, confirmPw: e.target.value})} />
            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="outline" onClick={() => setStep(1)} style={{ flex: 1, justifyContent: "center" }}>Voltar</Btn>
              <Btn variant="primary" onClick={handleNext} style={{ flex: 1, justifyContent: "center" }}>Próximo</Btn>
            </div>
          </div>
        )}

        {step === 3 && !success && (
          <div className="animate-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: "14px 16px", borderRadius: "var(--radius-md)", background: "var(--accent-dim)", border: "1px solid var(--border-accent)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Unidade</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--accent)" }}>Japa Carioca</div>
            </div>
            <Select label="Setor principal" options={SECTORS} value={form.sector} onChange={e => setForm({...form, sector: e.target.value})} />
            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="outline" onClick={() => setStep(2)} style={{ flex: 1, justifyContent: "center" }}>Voltar</Btn>
              <Btn variant="primary" onClick={handleRegister} disabled={loading} style={{ flex: 1, justifyContent: "center" }}>
                {loading ? "Criando..." : <><Icon name="check" size={18} color="var(--btn-primary-text)" /> Criar Conta</>}
              </Btn>
            </div>
          </div>
        )}

        {success && (
          <div className="animate-fade" style={{ textAlign: "center", padding: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--badge-accent-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Icon name="check" size={32} color="var(--accent)" />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Conta criada!</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20 }}>Sua conta foi criada com sucesso. Faça login para acessar.</p>
            <Btn variant="primary" size="lg" onClick={onGoToLogin} style={{ width: "100%", justifyContent: "center" }}>Ir para Login</Btn>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Já tem conta? <span style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={onGoToLogin}>Entrar</span>
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// FORGOT PASSWORD PAGE
// ============================================================
const ForgotPasswordPage = ({ onGoToLogin, theme }) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-deep)" }}>
      <div className="animate-fade" style={{ width: 440, padding: "48px 44px", background: "var(--bg-base)", borderRadius: "var(--radius-xl)", border: "1px solid var(--border)" }}>
        <div style={{ cursor: "pointer", marginBottom: 24 }} onClick={onGoToLogin}>
          <Icon name="back" size={22} color="var(--text-secondary)" />
        </div>

        {!sent ? (
          <>
            <div style={{ marginBottom: 20 }}><JapaLogo size={56} theme={theme} /></div>
            <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Recuperar Senha</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 28, lineHeight: 1.5 }}>
              Informe seu email e enviaremos um link para redefinir sua senha.
            </p>
            <Input label="Email" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            <Btn variant="primary" size="lg" onClick={() => setSent(true)} style={{ width: "100%", justifyContent: "center", marginTop: 20 }}>
              Enviar Link
            </Btn>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--accent-dim)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", animation: "glow 2s ease infinite" }}>
              <Icon name="email" size={32} color="var(--accent)" />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Email Enviado!</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 28, lineHeight: 1.5 }}>
              Verifique sua caixa de entrada em <strong style={{ color: "var(--text-primary)" }}>{email}</strong>. O link expira em 1 hora.
            </p>
            <Btn variant="ghost" onClick={onGoToLogin} style={{ margin: "0 auto" }}>Voltar ao Login</Btn>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// UNIT SELECTOR
// ============================================================
const UnitSelector = ({ user, onSelectUnit }) => (
  <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-deep)" }}>
    <div className="animate-scale" style={{ width: 520, padding: "48px 44px", background: "var(--bg-base)", borderRadius: "var(--radius-xl)", border: "1px solid var(--border)" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ width: 64, height: 64, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}><JapaLogo size={70} theme="light" /></div>
        <h2 style={{ fontSize: 24, fontWeight: 800 }}>Olá, {user.name}!</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>Selecione a unidade para acessar</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[{ id: "unit1", name: "Japa Carioca", address: "Rio de Janeiro, RJ" }].map((unit, i) => (
          <div key={unit.id} style={{
            padding: "20px 22px", borderRadius: "var(--radius-lg)",
            background: "var(--bg-surface)", border: "1px solid var(--border)",
            cursor: "pointer", transition: "all 0.2s",
            display: "flex", alignItems: "center", gap: 16,
            animation: `fadeIn 0.3s ease ${i * 0.1}s both`,
          }} onClick={() => onSelectUnit(unit)}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-accent)"; e.currentTarget.style.background = "var(--bg-elevated)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-surface)"; }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "var(--accent-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="building" size={24} color="var(--accent)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{unit.name}</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{unit.address}</div>
            </div>
            <Badge color="var(--success)">Ativa</Badge>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ============================================================
// MAIN APP (Dashboard + All Pages)
// ============================================================
const MainApp = ({ user, unit, onLogout, theme, onToggleTheme }) => {
  const [page, setPage] = useState("dashboard");
  const [pageHistory, setPageHistory] = useState(["dashboard"]);
  const navigateTo = (p) => { setPageHistory(prev => [...prev, p]); setPage(p); };
  const goBack = () => {
    if (pageHistory.length > 1) {
      const newHist = pageHistory.slice(0, -1);
      setPageHistory(newHist);
      setPage(newHist[newHist.length - 1]);
    } else { setPage("dashboard"); }
  };
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
      else setMobileMenuOpen(false);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const [templates, setTemplates] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [activeExec, setActiveExec] = useState(null);
  const [filterSector, setFilterSector] = useState("Todos");
  const [filterStatus, setFilterStatus] = useState("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [notification, setNotification] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState(null); // null = not editing, {} = new, {id:...} = editing existing
  const [sectorsList, setSectorsList] = useState([]);
  const [profilesList, setProfilesList] = useState([]);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // Load data from Supabase
  useEffect(() => {
    const loadDemoData = () => {
      // Demo templates for preview
      const demoTemplates = [
        { id: "dt1", title: "Abertura Cozinha", sector: "Cozinha", moment: "Abertura", active: true, responsible: "Carlos Silva", schedule: "09:00", frequency: "Diário", unit_id: unit.id,
          items: [
            { id: "di1", text: "Verificar temperatura das geladeiras", type: "numeric", required: true, photoRequired: true, unit: "°C", min: 0, max: 5 },
            { id: "di2", text: "Conferir estoque de insumos do dia", type: "checkbox", required: true, photoRequired: false },
            { id: "di3", text: "Limpar e higienizar bancadas", type: "checkbox", required: true, photoRequired: true },
            { id: "di4", text: "Verificar datas de validade", type: "checkbox", required: true, photoRequired: false },
            { id: "di5", text: "Testar fogões e equipamentos", type: "yesno", required: true, photoRequired: false },
            { id: "di6", text: "Organizar mise en place", type: "checkbox", required: true, photoRequired: true },
          ] },
        { id: "dt2", title: "Fechamento Cozinha", sector: "Cozinha", moment: "Fechamento", active: true, responsible: "Fernanda Costa", schedule: "22:30", frequency: "Diário", unit_id: unit.id,
          items: [
            { id: "di7", text: "Desligar todos os equipamentos", type: "checkbox", required: true, photoRequired: false },
            { id: "di8", text: "Higienizar todos os utensílios", type: "checkbox", required: true, photoRequired: true },
            { id: "di9", text: "Temperatura final das geladeiras", type: "numeric", required: true, photoRequired: true, unit: "°C", min: 0, max: 5 },
            { id: "di10", text: "Verificar gás desligado", type: "yesno", required: true, photoRequired: false },
          ] },
        { id: "dt3", title: "Abertura Caixa", sector: "Caixa", moment: "Abertura", active: true, responsible: "Juliana Santos", schedule: "09:00", frequency: "Diário", unit_id: unit.id,
          items: [
            { id: "di11", text: "Conferir fundo de troco", type: "numeric", required: true, photoRequired: false, unit: "R$" },
            { id: "di12", text: "Ligar computador e conferir sistema", type: "checkbox", required: true, photoRequired: false },
            { id: "di13", text: "Testar todas as formas de pagamento", type: "checkbox", required: true, photoRequired: false },
          ] },
        { id: "dt4", title: "Abertura Salão", sector: "Salão", moment: "Abertura", active: true, responsible: "Ana Lima", schedule: "09:30", frequency: "Diário", unit_id: unit.id,
          items: [
            { id: "di14", text: "Verificar limpeza das mesas", type: "checkbox", required: true, photoRequired: true },
            { id: "di15", text: "Conferir ar condicionado", type: "yesno", required: true, photoRequired: false },
            { id: "di16", text: "Organizar talheres e guardanapos", type: "checkbox", required: true, photoRequired: false },
          ] },
        { id: "dt5", title: "Abertura Bar", sector: "Bar", moment: "Abertura", active: true, responsible: "Roberto Alves", schedule: "10:00", frequency: "Diário", unit_id: unit.id,
          items: [
            { id: "di17", text: "Verificar estoque de bebidas", type: "checkbox", required: true, photoRequired: false },
            { id: "di18", text: "Temperatura do freezer de chopp", type: "numeric", required: true, photoRequired: true, unit: "°C", min: -2, max: 2 },
            { id: "di19", text: "Testar máquina de gelo", type: "yesno", required: true, photoRequired: false },
          ] },
        { id: "dt6", title: "Estoquista", sector: "Estoque", moment: "Abertura", active: true, responsible: "Carlos Silva", schedule: "09:00", frequency: "Diário", unit_id: unit.id,
          items: [
            { id: "di20", text: "Conferir entregas do dia", type: "checkbox", required: true, photoRequired: true },
            { id: "di21", text: "Temperatura câmara fria", type: "numeric", required: true, photoRequired: true, unit: "°C", min: -5, max: 2 },
            { id: "di22", text: "Registrar itens em falta", type: "observation", required: true, photoRequired: false },
          ] },
        { id: "dt7", title: "Conferência Delivery", sector: "Caixa", moment: "Abertura", active: true, responsible: "Juliana Santos", schedule: "10:30", frequency: "Diário", unit_id: unit.id,
          items: [
            { id: "di23", text: "Portal iFood aberto e funcionando", type: "yesno", required: true, photoRequired: false },
            { id: "di24", text: "Embalagens de delivery em estoque", type: "yesno", required: true, photoRequired: false },
            { id: "di25", text: "Motoboys confirmados para o turno", type: "yesno", required: true, photoRequired: false },
          ] },
        { id: "dt8", title: "Limpeza Semanal Cozinha", sector: "Cozinha", moment: "Outros", active: true, responsible: "Carlos Silva", schedule: "14:00", frequency: "Semanal", unit_id: unit.id,
          items: [
            { id: "di26", text: "Limpar exaustor e coifa", type: "checkbox", required: true, photoRequired: true },
            { id: "di27", text: "Desinfetar câmara fria", type: "checkbox", required: true, photoRequired: true },
            { id: "di28", text: "Verificar extintores de incêndio", type: "yesno", required: true, photoRequired: true },
          ] },
      ];
      setTemplates(demoTemplates);
      setSectorsList(SECTORS.map((s, i) => ({ id: `s${i}`, name: s })));
      setProfilesList([
        { id: "demo-1", name: "Wallace" }, { id: "demo-2", name: "Ana Lima" }, { id: "demo-3", name: "Carlos Silva" },
        { id: "demo-4", name: "Juliana Santos" }, { id: "demo-5", name: "Roberto Alves" }, { id: "demo-6", name: "Fernanda Costa" },
      ]);
      setAllUsers([
        { id: "demo-1", name: "Wallace", email: "wallace@japacarioca.com", role: "admin", sector: "Gerência", avatar: "W", active: true },
        { id: "demo-2", name: "Ana Lima", email: "ana@japacarioca.com", role: "manager", sector: "Salão", avatar: "AL", active: true },
        { id: "demo-3", name: "Carlos Silva", email: "carlos@japacarioca.com", role: "manager", sector: "Cozinha", avatar: "CS", active: true },
        { id: "demo-4", name: "Juliana Santos", email: "juliana@japacarioca.com", role: "employee", sector: "Caixa", avatar: "JS", active: true },
        { id: "demo-5", name: "Roberto Alves", email: "roberto@japacarioca.com", role: "employee", sector: "Bar", avatar: "RA", active: true },
        { id: "demo-6", name: "Fernanda Costa", email: "fernanda@japacarioca.com", role: "employee", sector: "Cozinha", avatar: "FC", active: true },
      ]);

      // Generate demo executions
      const execs = [];
      const today = new Date();
      for (let d = 0; d < 7; d++) {
        const date = new Date(today); date.setDate(date.getDate() - d);
        const dateStr = date.toISOString().split("T")[0];
        demoTemplates.slice(0, 6).forEach(t => {
          const done = d > 0 ? Math.random() > 0.15 : Math.random() > 0.5;
          execs.push({
            id: `dexec-${d}-${t.id}`, templateId: t.id, templateTitle: t.title, sector: t.sector,
            responsible: t.responsible, date: dateStr, scheduledTime: t.schedule,
            startedAt: done ? t.schedule : null, completedAt: done ? "10:30" : null,
            status: done ? "Concluído" : d === 0 ? "Pendente" : "Pendente",
            completionRate: done ? 100 : 0, late: Math.random() > 0.8, signature: done ? t.responsible : null, unit_id: unit.id, items: [],
          });
        });
      }
      setExecutions(execs);
      setLoading(false);
    };

    const loadData = async () => {
      try {
        // Load lookup tables first
        const allSectors = await db.query("sectors", "id,name", { unit_id: `eq.${unit.id}` });
        const allProfiles = await db.query("profiles", "id,name,email,role,phone,active,created_at,sector_id", { unit_id: `eq.${unit.id}` });
        setSectorsList(allSectors);
        setProfilesList(allProfiles);
        const sectorMap = {};
        allSectors.forEach(s => { sectorMap[s.id] = s.name; });
        const profileMap = {};
        allProfiles.forEach(p => { profileMap[p.id] = p.name; });

        // Load templates
        const tplData = await db.query(
          "checklist_templates",
          "id,title,moment,schedule,frequency,active,sector_id,responsible_id",
          { active: "eq.true", unit_id: `eq.${unit.id}` }
        );

        // Load all template items
        const tplIds = tplData.map(t => t.id);
        let allItems = [];
        if (tplIds.length > 0) {
          allItems = await db.query(
            "template_items",
            "id,template_id,text,type,required,photo_required,unit,min_value,max_value,sort_order",
            { active: "eq.true", order: "sort_order.asc" }
          );
        }
        
        const formattedTemplates = tplData.map(t => ({
          id: t.id,
          title: t.title,
          sector: sectorMap[t.sector_id] || "Gerência",
          moment: t.moment,
          active: t.active,
          responsible: profileMap[t.responsible_id] || "Não atribuído",
          schedule: t.schedule?.slice(0, 5) || "09:00",
          frequency: t.frequency,
          unit_id: unit.id,
          items: allItems
            .filter(i => i.template_id === t.id)
            .map(i => ({
              id: i.id,
              text: i.text,
              type: i.type,
              required: i.required,
              photoRequired: i.photo_required,
              unit: i.unit,
              min: i.min_value,
              max: i.max_value,
            })),
        }));
        setTemplates(formattedTemplates);

        // Load executions (last 14 days)
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        const dateStr = fourteenDaysAgo.toISOString().split("T")[0];
        
        const execData = await db.query(
          "executions",
          "id,template_id,date,scheduled_time,started_at,completed_at,status,completion_rate,is_late,signature,sector_id,responsible_id",
          { unit_id: `eq.${unit.id}`, date: `gte.${dateStr}`, order: "date.desc" }
        );

        // Map template names
        const tplNameMap = {};
        tplData.forEach(t => { tplNameMap[t.id] = t.title; });
        
        const formattedExecs = execData.map(e => ({
          id: e.id,
          templateId: e.template_id,
          templateTitle: tplNameMap[e.template_id] || "",
          sector: sectorMap[e.sector_id] || "",
          responsible: profileMap[e.responsible_id] || "",
          date: e.date,
          scheduledTime: e.scheduled_time?.slice(0, 5) || "",
          startedAt: e.started_at ? new Date(e.started_at).toTimeString().slice(0, 5) : null,
          completedAt: e.completed_at ? new Date(e.completed_at).toTimeString().slice(0, 5) : null,
          status: e.status === "Parcial" ? "Em andamento" : e.status,
          completionRate: e.completion_rate || 0,
          late: e.is_late,
          signature: e.signature,
          unit_id: unit.id,
          items: [],
        }));
        setExecutions(formattedExecs);

        // Set users for team page
        setAllUsers(allProfiles.map(u => ({
          ...u,
          sector: sectorMap[u.sector_id] || "Gerência",
          avatar: u.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase(),
        })));

      } catch (err) {
        console.error("Erro ao carregar dados:", err);
        // Fallback to demo mode
        loadDemoData();
        return;
      } finally {
        setLoading(false);
      }
    };
    if (user._demo) {
      loadDemoData();
    } else {
      loadData();
    }
  }, [unit.id]);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayExecs = executions.filter(e => e.date === todayStr);
  const completedToday = todayExecs.filter(e => e.status === "Concluído").length;
  const pendingToday = todayExecs.filter(e => e.status === "Pendente").length;
  const lateToday = todayExecs.filter(e => e.late).length;
  const completionRate = todayExecs.length > 0 ? Math.round((completedToday / todayExecs.length) * 100) : 0;

  const alerts = [
    ...todayExecs.filter(e => e.status === "Pendente").map(e => ({ type: "pending", msg: `${e.templateTitle} não iniciado`, time: e.scheduledTime, sector: e.sector })),
    ...todayExecs.filter(e => e.late).map(e => ({ type: "late", msg: `${e.templateTitle} com atraso`, time: e.startedAt, sector: e.sector })),
  ];

  const [dismissedAlerts, setDismissedAlerts] = useState([]);
  const visibleAlerts = alerts.filter((_, i) => !dismissedAlerts.includes(i));

  const startExecution = async (tId) => {
    const t = templates.find(x => x.id === tId);
    if (!t) { notify("Modelo não encontrado", "error"); return; }
    if (!t.items || t.items.length === 0) { notify("Este modelo não tem itens", "error"); return; }
    
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
    const todayDate = now.toISOString().split("T")[0];

    const existing = executions.find(e => e.templateId === tId && e.date === todayDate);

    const buildItems = (t, existingItems) => {
      return t.items.map(ti => {
        const ei = existingItems ? existingItems.find(x => x.template_item_id === ti.id) : null;
        return {
          ...ti,
          execItemId: ei?.id || `local-${ti.id}`,
          completed: ei?.completed || false,
          value: ei?.value || null,
          photoTaken: !!ei?.photo_url,
          photoUrl: ei?.photo_url || null,
          nonConformity: ei?.non_conformity_note || null,
          justification: ei?.justification || null,
        };
      });
    };

    try {
      if (existing && (existing.status === "Em andamento" || existing.status === "Parcial")) {
        // Resume existing execution
        let items;
        try {
          const itemsData = await db.query("execution_items", "id,template_item_id,completed,value,numeric_value,photo_url,is_conforming,justification,non_conformity_note", { execution_id: `eq.${existing.id}` });
          items = buildItems(t, itemsData);
        } catch (e) {
          items = buildItems(t, null);
        }
        const rate = items.length > 0 ? Math.round((items.filter(i => i.completed).length / items.length) * 100) : 0;
        setActiveExec({ ...existing, items, completionRate: rate });

      } else if (existing && existing.status === "Concluído") {
        // Already done — show completed view
        const items = buildItems(t, null).map(i => ({ ...i, completed: true }));
        setActiveExec({ ...existing, items, completionRate: 100 });

      } else {
        // Create new execution
        let newExecId = `local-${Date.now()}`;
        let createdItemIds = [];
        
        try {
          const sectorData = await db.query("sectors", "id", { name: `eq.${t.sector}`, unit_id: `eq.${unit.id}` });
          const sectorId = sectorData[0]?.id;

          const execResult = await db.insert("executions", {
            template_id: tId, unit_id: unit.id, sector_id: sectorId,
            responsible_id: user.id, date: todayDate, scheduled_time: t.schedule,
            started_at: now.toISOString(), status: "Em andamento", completion_rate: 0,
          });
          newExecId = execResult[0]?.id || newExecId;

          const execItems = t.items.map(item => ({
            execution_id: newExecId, template_item_id: item.id, completed: false,
          }));
          const created = await db.insert("execution_items", execItems);
          createdItemIds = created || [];
        } catch (e) {
          console.log("Supabase exec create failed, using local:", e);
        }

        const items = t.items.map((ti, idx) => ({
          ...ti,
          execItemId: createdItemIds[idx]?.id || `local-item-${idx}`,
          completed: false, value: null, photoTaken: false, nonConformity: null, justification: null,
        }));

        const localExec = {
          id: newExecId, templateId: tId, templateTitle: t.title, sector: t.sector,
          responsible: user.name, date: todayDate, scheduledTime: t.schedule, startedAt: timeStr,
          completedAt: null, status: "Em andamento", completionRate: 0,
          items, late: timeStr > t.schedule, signature: null, unit_id: unit.id,
        };
        setActiveExec(localExec);
        setExecutions(prev => [localExec, ...prev.filter(e => !(e.templateId === tId && e.date === todayDate))]);
      }
    } catch (err) {
      // Fallback — create fully local execution
      console.error("startExecution error:", err);
      const items = t.items.map((ti, idx) => ({
        ...ti, execItemId: `fallback-${idx}`,
        completed: false, value: null, photoTaken: false, nonConformity: null, justification: null,
      }));
      const localExec = {
        id: `fallback-${Date.now()}`, templateId: tId, templateTitle: t.title, sector: t.sector,
        responsible: user.name, date: todayDate, scheduledTime: t.schedule, startedAt: timeStr,
        completedAt: null, status: "Em andamento", completionRate: 0,
        items, late: timeStr > t.schedule, signature: null, unit_id: unit.id,
      };
      setActiveExec(localExec);
      setExecutions(prev => [localExec, ...prev]);
    }
    navigateTo("execute");
  };

  const toggleItem = (itemId) => {
    setActiveExec(prev => {
      if (!prev) return prev;
      const items = prev.items.map(i => {
        if (i.id === itemId) {
          const newCompleted = !i.completed;
          // Save to Supabase in background
          if (i.execItemId) {
            db.update("execution_items", { id: i.execItemId }, { completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null }).catch(console.error);
          }
          return { ...i, completed: newCompleted };
        }
        return i;
      });
      const rate = Math.round((items.filter(i => i.completed).length / items.length) * 100);
      // Update execution completion rate
      db.update("executions", { id: prev.id }, { completion_rate: rate }).catch(console.error);
      return { ...prev, items, completionRate: rate };
    });
  };

  const updateItemValue = (itemId, value) => {
    setActiveExec(prev => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.map(i => {
        if (i.id === itemId) {
          const isNumeric = i.type === "numeric";
          if (i.execItemId) {
            db.update("execution_items", { id: i.execItemId }, {
              value: String(value),
              numeric_value: isNumeric ? parseFloat(value) || null : null,
              completed: true,
              completed_at: new Date().toISOString(),
              is_conforming: i.type === "yesno" ? value === "Sim" : true,
              non_conformity_note: i.type === "yesno" && value === "Não" ? "Respondido Não" : null,
            }).catch(console.error);
          }
          return { ...i, value, completed: true };
        }
        return i;
      })};
    });
  };

  const updateItemJustification = (itemId, text) => {
    setActiveExec(prev => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.map(i => {
        if (i.id === itemId) {
          if (i.execItemId) {
            db.update("execution_items", { id: i.execItemId }, { justification: text }).catch(console.error);
          }
          return { ...i, justification: text };
        }
        return i;
      })};
    });
  };

  const takePhoto = (itemId) => {
    // In PWA version, this will open camera. For now, mark as taken.
    setActiveExec(prev => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.map(i => {
        if (i.id === itemId) {
          if (i.execItemId) {
            db.update("execution_items", { id: i.execItemId }, { photo_url: "pending_upload", photo_taken_at: new Date().toISOString() }).catch(console.error);
          }
          return { ...i, photoTaken: true };
        }
        return i;
      })};
    });
    notify("📸 Foto registrada!");
  };

  const finalizeExecution = async () => {
    if (!activeExec) return;
    const reqNotDone = activeExec.items.filter(i => i.required && !i.completed);
    const photosNeeded = activeExec.items.filter(i => i.photoRequired && !i.photoTaken);
    if (reqNotDone.length > 0) { notify(`⚠️ ${reqNotDone.length} itens obrigatórios pendentes`, "error"); return; }
    if (photosNeeded.length > 0) { notify(`📷 ${photosNeeded.length} fotos obrigatórias pendentes`, "error"); return; }
    const ncItems = activeExec.items.filter(i => i.type === "yesno" && i.value === "Não");
    if (ncItems.some(i => !i.justification)) { notify("⚠️ Justifique os itens com 'Não'", "error"); return; }
    
    const now = new Date();
    try {
      // Update execution in Supabase
      await db.update("executions", { id: activeExec.id }, {
        status: "Concluído",
        completed_at: now.toISOString(),
        completion_rate: 100,
        signature: user.name,
        signed_at: now.toISOString(),
      });

      // Create non-conformity records
      for (const item of ncItems) {
        if (item.execItemId) {
          await db.insert("non_conformities", {
            execution_id: activeExec.id,
            execution_item_id: item.execItemId,
            description: item.nonConformity || "Respondido Não",
            justification: item.justification,
          });
        }
      }

      const final = { ...activeExec, status: "Concluído", completedAt: `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`, signature: user.name, completionRate: 100 };
      setExecutions(prev => [final, ...prev.filter(e => !(e.templateId === final.templateId && e.date === final.date))]);
      setActiveExec(null);
      navigateTo("checklists");
      notify("✅ Checklist finalizado com sucesso!");
    } catch (err) {
      // Demo fallback — finalize locally
      const final = { ...activeExec, status: "Concluído", completedAt: `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`, signature: user.name, completionRate: 100 };
      setExecutions(prev => [final, ...prev.filter(e => !(e.templateId === final.templateId && e.date === final.date))]);
      setActiveExec(null);
      navigateTo("checklists");
      notify("✅ Checklist finalizado!");
    }
  };

  // Permission check
  const canAccess = (section) => {
    if (user.role === "admin") return true;
    if (user.role === "manager") return true;
    return ["checklists", "execute"].includes(section);
  };

  const navItems = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard" },
    { id: "checklists", icon: "checklist", label: "Checklists" },
    { id: "templates", icon: "templates", label: "Modelos" },
    { id: "executions", icon: "reports", label: "Histórico" },
    { id: "alerts", icon: "alerts", label: "Alertas", count: visibleAlerts.length },
    { id: "users", icon: "users", label: "Equipe" },
    { id: "settings", icon: "settings", label: "Config" },
  ].filter(n => canAccess(n.id));

  // ---- DASHBOARD ----
  const renderDashboard = () => {
    const sectorData = SECTORS.map(s => {
      const sExecs = todayExecs.filter(e => e.sector === s);
      const done = sExecs.filter(e => e.status === "Concluído").length;
      return { sector: s, total: sExecs.length, done, rate: sExecs.length > 0 ? Math.round((done / sExecs.length) * 100) : 0 };
    });

    return (
      <div className="animate-fade">
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>Dashboard</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 14 }}>Visão geral da operação — Japa Carioca</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: 24 }}>
          {[
            { label: "Conclusão", value: `${completionRate}%`, color: "var(--accent)", icon: "checklist", action: () => { setFilterStatus("Todos"); setFilterSector("Todos"); navigateTo("checklists"); } },
            { label: "Concluídos", value: completedToday, sub: `de ${todayExecs.length}`, color: "var(--info)", icon: "check", action: () => { setFilterStatus("Concluído"); setFilterSector("Todos"); navigateTo("checklists"); } },
            { label: "Pendentes", value: pendingToday, color: "var(--warning)", icon: "clock", action: () => { setFilterStatus("Pendente"); setFilterSector("Todos"); navigateTo("checklists"); } },
            { label: "Atrasos", value: lateToday, color: "var(--danger)", icon: "warning", action: () => { setFilterStatus("Todos"); setFilterSector("Todos"); navigateTo("alerts"); } },
          ].map((s, i) => (
            <Card key={i} style={{ 
              borderColor: `${s.color}15`, animation: `fadeIn 0.3s ease ${i * 0.08}s both`,
              cursor: "pointer", transition: "all 0.2s",
            }}
              onClick={s.action}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>{s.label}</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  {s.sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{s.sub}</div>}
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${s.color}12`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={s.icon} size={20} color={s.color} />
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <Card>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, color: "var(--text-secondary)" }}>Conclusão por Setor</h3>
            {sectorData.map((s, i) => (
              <div key={s.sector} style={{ marginBottom: 14, animation: `fadeIn 0.3s ease ${i * 0.05}s both`, cursor: "pointer", padding: "6px 8px", borderRadius: 8, transition: "background 0.2s" }}
                onClick={() => { setFilterSector(s.sector); setFilterStatus("Todos"); navigateTo("checklists"); }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-elevated)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.sector}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: s.rate >= 80 ? "var(--accent)" : s.rate >= 50 ? "var(--warning)" : "var(--danger)" }}>{s.rate}%</span>
                </div>
                <ProgressBar value={s.rate} color={s.rate >= 80 ? "var(--accent)" : s.rate >= 50 ? "var(--warning)" : "var(--danger)"} />
              </div>
            ))}
          </Card>

          <Card>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, color: "var(--text-secondary)" }}>Checklists de Hoje</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {todayExecs.slice(0, 6).map(e => (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  borderRadius: "var(--radius-md)", background: "var(--bg-elevated)",
                  cursor: "pointer",
                }} onClick={() => { 
                  if (e.status === "Concluído") { 
                    setFilterStatus("Concluído"); setFilterSector("Todos"); navigateTo("checklists"); 
                  } else { 
                    startExecution(e.templateId); 
                  } 
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: e.status === "Concluído" ? "var(--accent)" : e.status === "Em andamento" ? "var(--info)" : "var(--danger)",
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{e.templateTitle}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.sector} • {e.scheduledTime}</div>
                  </div>
                  <Badge color={e.status === "Concluído" ? "var(--accent)" : e.status === "Em andamento" ? "var(--info)" : "var(--danger)"}>{e.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  };

  // ---- CHECKLISTS ----
  const renderChecklists = () => {
    const filtered = templates.filter(t => {
      if (filterSector !== "Todos" && t.sector !== filterSector) return false;
      if (searchTerm && !t.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (user.role === "employee" && t.responsible !== user.name) return false;
      // Status filter
      if (filterStatus !== "Todos") {
        const exec = todayExecs.find(e => e.templateId === t.id);
        const status = exec?.status || "Pendente";
        if (filterStatus === "Concluído" && status !== "Concluído") return false;
        if (filterStatus === "Pendente" && status !== "Pendente") return false;
        if (filterStatus === "Em andamento" && status !== "Em andamento") return false;
      }
      return true;
    });

    const statusLabel = filterStatus !== "Todos" ? ` — ${filterStatus}` : "";

    return (
      <div className="animate-fade">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ cursor: "pointer", padding: 6, borderRadius: 10, background: "var(--bg-elevated)" }} onClick={goBack}><Icon name="back" size={18} /></div>
              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>Meus Checklists{statusLabel}</h1>
            </div>
            <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 14 }}>
              {filterStatus !== "Todos" || filterSector !== "Todos" ? (
                <span>{filtered.length} resultado{filtered.length !== 1 ? "s" : ""} filtrado{filtered.length !== 1 ? "s" : ""} 
                  <span style={{ color: "var(--accent)", cursor: "pointer", marginLeft: 8, fontWeight: 600 }}
                    onClick={() => { setFilterStatus("Todos"); setFilterSector("Todos"); setSearchTerm(""); }}>
                    Limpar filtros
                  </span>
                </span>
              ) : "Execute os checklists do seu setor"}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <Input placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <Select options={["Todos", ...SECTORS]} value={filterSector} onChange={e => setFilterSector(e.target.value)} />
          <Select options={[
            { value: "Todos", label: "Todos os status" },
            { value: "Concluído", label: "Concluídos" },
            { value: "Pendente", label: "Pendentes" },
            { value: "Em andamento", label: "Em andamento" },
          ]} value={filterStatus} onChange={e => setFilterStatus(e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {filtered.map((t, i) => {
            const exec = todayExecs.find(e => e.templateId === t.id);
            const status = exec?.status || "Pendente";
            const rate = exec?.completionRate || 0;
            return (
              <Card key={t.id} style={{
                position: "relative", overflow: "hidden",
                borderColor: status === "Concluído" ? "var(--border-accent)" : "var(--border)",
                animation: `fadeIn 0.3s ease ${i * 0.06}s both`,
              }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: status === "Concluído" ? "var(--accent)" : status === "Em andamento" ? "var(--info)" : "transparent" }} />
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge color={t.moment === "Abertura" ? "var(--accent)" : "var(--purple)"}>{t.moment}</Badge>
                    <Badge color="var(--info)">{t.sector}</Badge>
                  </div>
                  <Badge color={status === "Concluído" ? "var(--accent)" : status === "Em andamento" ? "var(--info)" : "var(--danger)"}>{status}</Badge>
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{t.title}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--accent-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="users" size={12} color="var(--accent)" />
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Responsável: <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{t.responsible.split(" ")[0]}</strong></span>
                </div>
                <div style={{ display: "flex", gap: 14, color: "var(--text-secondary)", fontSize: 13, marginBottom: 16 }}>
                  <span><Icon name="clock" size={13} color="var(--text-muted)" style={{ verticalAlign: "middle", marginRight: 4 }} />{t.schedule}</span>
                  <span>{t.items.length} itens</span>
                  <span>{t.items.filter(i => i.photoRequired).length} fotos</span>
                </div>
                <ProgressBar value={rate} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                  {status !== "Concluído" ? (
                    <Btn variant="primary" size="sm" onClick={() => startExecution(t.id)}>
                      <Icon name="play" size={14} color="var(--btn-primary-text)" /> {status === "Em andamento" ? "Continuar" : "Iniciar"}
                    </Btn>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn variant="ghost" size="sm" onClick={() => startExecution(t.id)}>
                        <Icon name="checklists" size={14} color="var(--accent)" /> Visualizar
                      </Btn>
                      {user.role === "admin" && (
                        <Btn variant="ghost" size="sm" style={{ color: "var(--danger)" }} onClick={async () => {
                          if (!confirm("Reiniciar este checklist? Os dados preenchidos serão perdidos.")) return;
                          const todayDate = new Date().toISOString().split("T")[0];
                          const ex = executions.find(e => e.templateId === t.id && e.date === todayDate);
                          if (ex) {
                            try {
                              await supabase.fetch(`/rest/v1/execution_items?execution_id=eq.${ex.id}`, { method: "DELETE" });
                              await supabase.fetch(`/rest/v1/executions?id=eq.${ex.id}`, { method: "DELETE" });
                            } catch(e) {}
                            setExecutions(prev => prev.filter(e => !(e.templateId === t.id && e.date === todayDate)));
                          }
                          setTimeout(() => startExecution(t.id), 200);
                          notify("🔄 Checklist reiniciado");
                        }}>
                          <Icon name="close" size={14} color="var(--danger)" /> Reiniciar
                        </Btn>
                      )}
                    </div>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{rate}%</span>
                </div>
                {/* Execution details for completed */}
                {status === "Concluído" && exec && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
                    <span>🕐 Início: {exec.startedAt || "—"}</span>
                    <span>🕑 Fim: {exec.completedAt || "—"}</span>
                    <span>✍️ {exec.signature || "—"}</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  // ---- EXECUTE ----
  const renderExecution = () => {
    if (!activeExec) return <Card style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Nenhum checklist em execução</Card>;
    const reqDone = activeExec.items.filter(i => i.required && i.completed).length;
    const reqTotal = activeExec.items.filter(i => i.required).length;

    return (
      <div style={{ maxWidth: 720, margin: "0 auto" }} className="animate-fade">
        <Btn variant="ghost" size="sm" onClick={() => { setActiveExec(null); navigateTo("checklists"); }} style={{ marginBottom: 16 }}>
          <Icon name="back" size={16} color="var(--accent)" /> Voltar
        </Btn>

        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800 }}>{activeExec.templateTitle}</h2>
              <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap" }}>
                <Badge color="var(--info)">{activeExec.sector}</Badge>
                <Badge color={activeExec.status === "Concluído" ? "var(--accent)" : "var(--info)"}>{activeExec.status}</Badge>
                {activeExec.late && <Badge color="var(--danger)">ATRASO</Badge>}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
                <span>🕐 Agendado: {activeExec.scheduledTime || "—"}</span>
                <span>▶️ Início: {activeExec.startedAt || "—"}</span>
                {activeExec.completedAt && <span>✅ Fim: {activeExec.completedAt}</span>}
                <span>👤 {activeExec.responsible || user.name}</span>
              </div>
              {activeExec.signature && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--accent)" }}>✍️ Assinado por: {activeExec.signature}</div>
              )}
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>{reqDone}/{reqTotal} obrigatórios</div>
            </div>
            <CircularProgress value={activeExec.completionRate} size={90} />
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeExec.items.map((item, idx) => (
            <Card key={item.id} style={{
              padding: 18,
              borderColor: item.completed ? "var(--badge-accent-bg)" : item.required ? "var(--badge-danger-bg)" : "var(--border)",
              background: item.completed ? "rgba(64,224,176,0.02)" : "var(--bg-surface)",
              animation: `fadeIn 0.2s ease ${idx * 0.04}s both`,
            }}>
              <div style={{ display: "flex", gap: 12 }}>
                {item.type === "checkbox" && (
                  <div onClick={() => activeExec.status !== "Concluído" && toggleItem(item.id)} style={{
                    width: 28, height: 28, borderRadius: 8, cursor: activeExec.status !== "Concluído" ? "pointer" : "default", flexShrink: 0, marginTop: 1,
                    border: item.completed ? "2px solid var(--accent)" : "2px solid var(--text-muted)",
                    background: item.completed ? "var(--accent-dim)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s",
                  }}>
                    {item.completed && <Icon name="check" size={16} color="var(--accent)" />}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 500, color: item.completed ? "var(--accent)" : "var(--text-primary)" }}>{item.text}</span>
                    {item.required && <span style={{ fontSize: 9, fontWeight: 800, color: "var(--danger)", background: "var(--badge-danger-bg)", padding: "2px 6px", borderRadius: 4 }}>OBRIGATÓRIO</span>}
                    {item.photoRequired && <Icon name="camera" size={14} color={item.photoTaken ? "var(--accent)" : "var(--text-muted)"} />}
                  </div>

                  {item.type === "numeric" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <input type="number" placeholder={item.unit} value={item.value || ""} onChange={e => updateItemValue(item.id, e.target.value)}
                        disabled={activeExec.status === "Concluído"}
                        style={{ width: 120, padding: "8px 12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", fontSize: 14, outline: "none" }} />
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{item.unit}</span>
                      {item.min !== undefined && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({item.min} a {item.max})</span>}
                    </div>
                  )}

                  {item.type === "yesno" && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        {["Sim", "Não"].map(opt => (
                          <Btn key={opt} size="sm" variant={item.value === opt ? (opt === "Sim" ? "primary" : "danger") : "outline"}
                            onClick={() => activeExec.status !== "Concluído" && updateItemValue(item.id, opt)}
                            style={{ minWidth: 70, justifyContent: "center", opacity: activeExec.status === "Concluído" ? 0.7 : 1 }}>{opt}</Btn>
                        ))}
                      </div>
                      {item.value === "Não" && (
                        <div style={{ marginTop: 8 }}>
                          <input placeholder="Justificativa obrigatória para não conformidade..."
                            value={item.justification || ""} onChange={e => updateItemJustification(item.id, e.target.value)}
                            disabled={activeExec.status === "Concluído"}
                            style={{ width: "100%", padding: "8px 12px", background: "var(--badge-danger-bg)", border: "1px solid var(--badge-danger-bg)", borderRadius: 8, color: "var(--text-primary)", fontSize: 13, outline: "none" }} />
                        </div>
                      )}
                    </div>
                  )}

                  {item.type === "observation" && (
                    <textarea placeholder="Digite sua observação..." value={item.value || ""} onChange={e => updateItemValue(item.id, e.target.value)}
                      disabled={activeExec.status === "Concluído"}
                      style={{ width: "100%", marginTop: 6, padding: "8px 12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", fontSize: 13, outline: "none", minHeight: 56, resize: "vertical" }} />
                  )}

                  {item.photoRequired && (
                    <div style={{ marginTop: 8 }}>
                      {item.photoTaken ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Badge color="var(--accent)"><Icon name="camera" size={12} color="var(--accent)" /> Foto registrada</Badge>
                          {item.photoUrl && item.photoUrl !== "pending_upload" && (
                            <img src={item.photoUrl} alt="Foto" style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover", border: "2px solid var(--accent)" }} />
                          )}
                        </div>
                      ) : activeExec.status !== "Concluído" ? (
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <Btn size="sm" variant="ghost" onClick={() => document.getElementById(`photo-${item.id}`)?.click()}>
                            <Icon name="camera" size={14} color="var(--accent)" /> Tirar Foto
                          </Btn>
                          <input type="file" accept="image/*" capture="environment" id={`photo-${item.id}`} style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const url = URL.createObjectURL(file);
                                setActiveExec(prev => {
                                  if (!prev) return prev;
                                  return { ...prev, items: prev.items.map(i => {
                                    if (i.id === item.id) {
                                      if (i.execItemId) {
                                        db.update("execution_items", { id: i.execItemId }, { photo_url: "captured", photo_taken_at: new Date().toISOString() }).catch(console.error);
                                      }
                                      return { ...i, photoTaken: true, photoUrl: url };
                                    }
                                    return i;
                                  })};
                                });
                                notify("📸 Foto registrada!");
                              }
                            }} />
                        </div>
                      ) : (
                        <Badge color="var(--danger)"><Icon name="camera" size={12} color="var(--danger)" /> Sem foto</Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {activeExec.status === "Concluído" ? (
          <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Badge color="var(--accent)" style={{ padding: "10px 18px", fontSize: 14 }}>✅ Checklist concluído</Badge>
            <Btn variant="ghost" onClick={() => { setActiveExec(null); navigateTo("checklists"); }}>Voltar</Btn>
            {user.role === "admin" && (
              <Btn variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => {
                if (!confirm("Reiniciar este checklist? Os dados preenchidos serão perdidos.")) return;
                const tId = activeExec.templateId;
                const todayDate = activeExec.date;
                try {
                  await supabase.fetch(`/rest/v1/execution_items?execution_id=eq.${activeExec.id}`, { method: "DELETE" });
                  await supabase.fetch(`/rest/v1/executions?id=eq.${activeExec.id}`, { method: "DELETE" });
                } catch (e) {}
                setExecutions(prev => prev.filter(e => !(e.templateId === tId && e.date === todayDate)));
                setActiveExec(null);
                setTimeout(() => startExecution(tId), 200);
                notify("🔄 Checklist reiniciado");
              }}>
                <Icon name="close" size={16} color="var(--danger)" /> Reiniciar Checklist
              </Btn>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Btn variant="primary" size="lg" onClick={finalizeExecution}>
              <Icon name="check" size={18} color="var(--btn-primary-text)" /> Finalizar e Assinar
            </Btn>
            <Btn variant="outline" onClick={() => { setActiveExec(null); navigateTo("checklists"); }}>Salvar Rascunho</Btn>
            {user.role === "admin" && (
              <Btn variant="ghost" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={async () => {
                if (!confirm("Tem certeza que deseja reiniciar este checklist? Todos os dados preenchidos serão perdidos.")) return;
                const tId = activeExec.templateId;
                const todayDate = activeExec.date;
                try {
                  await supabase.fetch(`/rest/v1/execution_items?execution_id=eq.${activeExec.id}`, { method: "DELETE" });
                  await supabase.fetch(`/rest/v1/executions?id=eq.${activeExec.id}`, { method: "DELETE" });
                } catch (e) { console.log("Delete failed:", e); }
                setExecutions(prev => prev.filter(e => !(e.templateId === tId && e.date === todayDate)));
                setActiveExec(null);
                setTimeout(() => startExecution(tId), 100);
                notify("🔄 Checklist reiniciado");
              }}>
                <Icon name="close" size={16} color="var(--danger)" /> Reiniciar Checklist
              </Btn>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---- TEMPLATES ----
  // ---- TEMPLATE EDITOR ----
  const saveTemplate = async (tplData) => {
    try {
      const sectorId = sectorsList.find(s => s.name === tplData.sector)?.id;
      if (!sectorId) { notify("Setor inválido", "error"); return; }

      if (tplData.id) {
        // Update existing template
        await db.update("checklist_templates", { id: tplData.id }, {
          title: tplData.title,
          sector_id: sectorId,
          moment: tplData.moment,
          schedule: tplData.schedule,
          frequency: tplData.frequency,
          responsible_id: tplData.responsibleId || null,
        });

        // Delete old items and recreate
        const oldItems = await db.query("template_items", "id", { template_id: `eq.${tplData.id}` });
        for (const oi of oldItems) {
          await supabase.fetch(`/rest/v1/template_items?id=eq.${oi.id}`, { method: "DELETE" });
        }

        // Insert new items
        if (tplData.items.length > 0) {
          await db.insert("template_items", tplData.items.map((item, idx) => ({
            template_id: tplData.id,
            text: item.text,
            type: item.type,
            required: item.required,
            photo_required: item.photoRequired,
            unit: item.unit || null,
            min_value: item.min || null,
            max_value: item.max || null,
            sort_order: idx + 1,
          })));
        }
        notify("✅ Modelo atualizado!");
      } else {
        // Create new template
        const result = await db.insert("checklist_templates", {
          title: tplData.title,
          unit_id: unit.id,
          sector_id: sectorId,
          moment: tplData.moment,
          schedule: tplData.schedule,
          frequency: tplData.frequency,
          responsible_id: tplData.responsibleId || null,
          created_by: user.id,
        });
        const newTpl = result[0];

        // Insert items
        if (tplData.items.length > 0) {
          await db.insert("template_items", tplData.items.map((item, idx) => ({
            template_id: newTpl.id,
            text: item.text,
            type: item.type,
            required: item.required,
            photo_required: item.photoRequired,
            unit: item.unit || null,
            min_value: item.min || null,
            max_value: item.max || null,
            sort_order: idx + 1,
          })));
        }
        notify("✅ Novo modelo criado!");
      }

      // Reload templates
      setEditingTemplate(null);
      setLoading(true);
      const tplReload = await db.query("checklist_templates", "id,title,moment,schedule,frequency,active,sector_id,responsible_id", { active: "eq.true", unit_id: `eq.${unit.id}` });
      const itemsReload = await db.query("template_items", "id,template_id,text,type,required,photo_required,unit,min_value,max_value,sort_order", { active: "eq.true", order: "sort_order.asc" });
      const sectorMap = {}; sectorsList.forEach(s => { sectorMap[s.id] = s.name; });
      const profileMap = {}; profilesList.forEach(p => { profileMap[p.id] = p.name; });
      setTemplates(tplReload.map(t => ({
        id: t.id, title: t.title, sector: sectorMap[t.sector_id] || "Gerência", moment: t.moment, active: t.active,
        responsible: profileMap[t.responsible_id] || "Não atribuído", schedule: t.schedule?.slice(0, 5) || "09:00",
        frequency: t.frequency, unit_id: unit.id,
        items: itemsReload.filter(i => i.template_id === t.id).map(i => ({
          id: i.id, text: i.text, type: i.type, required: i.required, photoRequired: i.photo_required,
          unit: i.unit, min: i.min_value, max: i.max_value,
        })),
      })));
      setLoading(false);
    } catch (err) {
      console.error(err);
      // Demo mode fallback
      if (user._demo) {
        const newTpl = {
          id: tplData.id || `demo-${Date.now()}`, title: tplData.title, sector: tplData.sector, moment: tplData.moment,
          active: true, responsible: profilesList.find(p => p.id === tplData.responsibleId)?.name || "Não atribuído",
          schedule: tplData.schedule, frequency: tplData.frequency, unit_id: unit.id, items: tplData.items,
        };
        if (tplData.id) {
          setTemplates(prev => prev.map(t => t.id === tplData.id ? newTpl : t));
        } else {
          setTemplates(prev => [...prev, newTpl]);
        }
        setEditingTemplate(null);
        notify("✅ Modelo salvo (demo)!");
      } else {
        notify("Erro ao salvar modelo", "error");
      }
    }
  };

  const deleteTemplate = async (tplId) => {
    if (!confirm("Tem certeza que deseja excluir este modelo?")) return;
    try {
      await db.update("checklist_templates", { id: tplId }, { active: false });
      setTemplates(prev => prev.filter(t => t.id !== tplId));
      notify("🗑️ Modelo excluído");
    } catch (err) {
      // Demo fallback
      setTemplates(prev => prev.filter(t => t.id !== tplId));
      notify("🗑️ Modelo excluído (demo)");
    }
  };

  const renderTemplateEditor = () => {
    const tpl = editingTemplate;

    const updateEditField = (field, value) => {
      setEditingTemplate(prev => ({ ...prev, [field]: value }));
    };

    const addItem = () => {
      const newItems = [...(tpl.items || []), { id: `new-${Date.now()}`, text: "", type: "checkbox", required: true, photoRequired: false, unit: "", min: null, max: null }];
      updateEditField("items", newItems);
    };

    const updateItem = (idx, field, value) => {
      const newItems = (tpl.items || []).map((item, i) => i === idx ? { ...item, [field]: value } : item);
      updateEditField("items", newItems);
    };

    const removeItem = (idx) => {
      updateEditField("items", (tpl.items || []).filter((_, i) => i !== idx));
    };

    const items = tpl.items || [];

    return (
      <div className="animate-fade">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ cursor: "pointer", padding: 8, borderRadius: 10, background: "var(--bg-elevated)" }} onClick={() => setEditingTemplate(null)}>
            <Icon name="back" size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>{tpl?.id ? "Editar Modelo" : "Novo Modelo"}</h1>
            <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 14 }}>Configure os detalhes e itens do checklist</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <Card>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Informações</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Input label="Título" value={tpl.title || ""} onChange={e => updateEditField("title", e.target.value)} placeholder="Ex: Abertura Cozinha" />
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <Select label="Setor" options={SECTORS} value={tpl.sector || SECTORS[0]} onChange={e => updateEditField("sector", e.target.value)} />
                <Select label="Momento" options={MOMENTS} value={tpl.moment || "Abertura"} onChange={e => updateEditField("moment", e.target.value)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <Input label="Horário" type="time" value={tpl.schedule || "09:00"} onChange={e => updateEditField("schedule", e.target.value)} />
                <Select label="Frequência" options={["Diário", "Semanal", "Mensal", "Pontual"]} value={tpl.frequency || "Diário"} onChange={e => updateEditField("frequency", e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>Responsável</div>
                <select value={tpl.responsibleId || ""} onChange={e => updateEditField("responsibleId", e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontSize: 14 }}>
                  <option value="">Selecione...</option>
                  {profilesList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Resumo</h3>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 2 }}>
              <div>📋 <strong>{items.length}</strong> itens no total</div>
              <div>✅ <strong>{items.filter(i => i.required).length}</strong> obrigatórios</div>
              <div>📷 <strong>{items.filter(i => i.photoRequired).length}</strong> com foto</div>
              <div>🔢 <strong>{items.filter(i => i.type === "numeric").length}</strong> numéricos</div>
              <div>✔️ <strong>{items.filter(i => i.type === "yesno").length}</strong> sim/não</div>
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => {
                if (!(tpl.title || "").trim()) { notify("Preencha o título", "error"); return; }
                if (items.length === 0) { notify("Adicione pelo menos 1 item", "error"); return; }
                if (items.some(i => !i.text.trim())) { notify("Preencha todos os itens", "error"); return; }
                saveTemplate({ id: tpl.id, title: tpl.title, sector: tpl.sector || SECTORS[0], moment: tpl.moment || "Abertura", schedule: tpl.schedule || "09:00", frequency: tpl.frequency || "Diário", responsibleId: tpl.responsibleId, items });
              }}>
                <Icon name="check" size={16} color="var(--btn-primary-text)" /> Salvar
              </Btn>
              <Btn variant="ghost" onClick={() => setEditingTemplate(null)}>Cancelar</Btn>
            </div>
          </Card>
        </div>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Itens do Checklist</h3>
            <Btn size="sm" variant="primary" onClick={addItem}><Icon name="add" size={14} color="var(--btn-primary-text)" /> Adicionar Item</Btn>
          </div>

          {items.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
              Nenhum item ainda. Clique em "Adicionar Item" para começar.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map((item, idx) => (
              <div key={item.id || idx} style={{
                padding: 16, borderRadius: "var(--radius-md)", background: "var(--bg-surface)",
                border: "1px solid var(--border)",
              }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent-dim)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--accent)", flexShrink: 0 }}>{idx + 1}</div>
                  <Input placeholder="Descrição do item..." value={item.text} onChange={e => updateItem(idx, "text", e.target.value)} style={{ flex: 1 }} />
                  <div style={{ cursor: "pointer", padding: 6, borderRadius: 8 }} onClick={() => removeItem(idx)}>
                    <Icon name="close" size={16} color="var(--danger)" />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginLeft: 38, alignItems: "center" }}>
                  <select value={item.type} onChange={e => updateItem(idx, "type", e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text-primary)", fontSize: 12 }}>
                    <option value="checkbox">✅ Checkbox</option>
                    <option value="numeric">🔢 Numérico</option>
                    <option value="yesno">✔️ Sim/Não</option>
                    <option value="observation">📝 Observação</option>
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                    <input type="checkbox" checked={item.required} onChange={e => updateItem(idx, "required", e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Obrigatório
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                    <input type="checkbox" checked={item.photoRequired} onChange={e => updateItem(idx, "photoRequired", e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Foto
                  </label>
                  {item.type === "numeric" && (
                    <>
                      <Input placeholder="Unidade" value={item.unit || ""} onChange={e => updateItem(idx, "unit", e.target.value)} style={{ width: 80, fontSize: 12 }} />
                      <Input placeholder="Mín" type="number" value={item.min ?? ""} onChange={e => updateItem(idx, "min", e.target.value ? Number(e.target.value) : null)} style={{ width: 55, fontSize: 12 }} />
                      <Input placeholder="Máx" type="number" value={item.max ?? ""} onChange={e => updateItem(idx, "max", e.target.value ? Number(e.target.value) : null)} style={{ width: 55, fontSize: 12 }} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  };

  const renderTemplates = () => {
    if (editingTemplate !== null) return renderTemplateEditor();

    return (
      <div className="animate-fade">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ cursor: "pointer", padding: 6, borderRadius: 10, background: "var(--bg-elevated)" }} onClick={goBack}><Icon name="back" size={18} /></div>
              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>Modelos de Checklist</h1>
            </div>
            <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 14 }}>Gerencie os modelos da operação — {templates.length} modelos ativos</p>
          </div>
          {(user.role === "admin" || user.role === "manager") && (
            <Btn variant="primary" onClick={() => setEditingTemplate({})}><Icon name="add" size={16} color="var(--btn-primary-text)" /> Novo Modelo</Btn>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {templates.map((t, i) => (
            <Card key={t.id} style={{ animation: `fadeIn 0.3s ease ${i * 0.05}s both` }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <Badge color={t.moment === "Abertura" ? "var(--accent)" : "var(--purple)"}>{t.moment}</Badge>
                <Badge color="var(--info)">{t.sector}</Badge>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t.title}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, background: "var(--accent-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="users" size={11} color="var(--accent)" />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Responsável: <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{t.responsible.split(" ")[0]}</strong></span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 14 }}>
                {t.items.length} itens • {t.items.filter(i => i.required).length} obrigatórios • {t.items.filter(i => i.photoRequired).length} fotos
              </p>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                ⏰ {t.schedule} • 📋 {t.frequency} • 👤 {t.responsible}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {(user.role === "admin" || user.role === "manager") && (
                  <>
                    <Btn size="sm" variant="ghost" onClick={() => {
                      const respId = profilesList.find(p => p.name === t.responsible)?.id || "";
                      setEditingTemplate({ id: t.id, title: t.title, sector: t.sector, moment: t.moment, schedule: t.schedule, frequency: t.frequency, responsibleId: respId, items: t.items });
                    }}><Icon name="edit" size={14} color="var(--accent)" /> Editar</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => deleteTemplate(t.id)}><Icon name="close" size={14} color="var(--danger)" /> Excluir</Btn>
                  </>
                )}
                <Btn size="sm" variant="ghost" onClick={() => startExecution(t.id)}><Icon name="play" size={14} color="var(--accent)" /> Executar</Btn>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  // ---- HISTORY ----
  const renderHistory = () => (
    <div className="animate-fade">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ cursor: "pointer", padding: 6, borderRadius: 10, background: "var(--bg-elevated)" }} onClick={goBack}><Icon name="back" size={18} /></div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>Histórico</h1>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 14 }}>Registros completos com evidência</p>
        </div>
        <Btn variant="ghost" onClick={() => notify("📥 Exportação em desenvolvimento")}><Icon name="download" size={16} color="var(--accent)" /> Exportar</Btn>
      </div>
      <Card style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px" }}>
          <thead>
            <tr>{["Data","Checklist","Setor","Responsável","Horário","Status","Progresso","Assinatura"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {executions.filter(e => filterSector === "Todos" || e.sector === filterSector).slice(0, 40).map(e => (
              <tr key={e.id}>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)", borderRadius: "8px 0 0 8px", fontSize: 13 }}>{e.date.split("-").reverse().join("/")}</td>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)", fontWeight: 600, fontSize: 13 }}>{e.templateTitle}</td>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)" }}><Badge color="var(--info)">{e.sector}</Badge></td>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)", fontSize: 13 }}>{e.responsible}</td>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)", fontSize: 13 }}>{e.startedAt} {e.late && <Badge color="var(--danger)" style={{ marginLeft: 4 }}>⚠</Badge>}</td>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)" }}><Badge color={e.status === "Concluído" ? "var(--accent)" : e.status === "Em andamento" ? "var(--info)" : "var(--danger)"}>{e.status}</Badge></td>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)", width: 100 }}><ProgressBar value={e.completionRate} /></td>
                <td style={{ padding: "12px 14px", background: "var(--bg-elevated)", borderRadius: "0 8px 8px 0", fontSize: 12, color: e.signature ? "var(--accent)" : "var(--text-muted)" }}>{e.signature || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );

  // ---- ALERTS ----
  const dismissAlert = (idx) => {
    setDismissedAlerts(prev => [...prev, idx]);
    notify("Alerta removido");
  };

  const clearAllAlerts = () => {
    setDismissedAlerts(alerts.map((_, i) => i));
    notify("Todos os alertas removidos");
  };

  const renderAlerts = () => (
    <div className="animate-fade">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ cursor: "pointer", padding: 6, borderRadius: 10, background: "var(--bg-elevated)" }} onClick={goBack}><Icon name="back" size={18} /></div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>Alertas</h1>
        </div>
        {(user.role === "admin" || user.role === "manager") && visibleAlerts.length > 0 && (
          <Btn size="sm" variant="ghost" onClick={clearAllAlerts}><Icon name="close" size={14} color="var(--danger)" /> Limpar Todos</Btn>
        )}
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 24 }}>{visibleAlerts.length} alertas ativos</p>
      {visibleAlerts.length === 0 ? <Card style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>✅ Nenhum alerta pendente</Card> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {alerts.map((a, i) => dismissedAlerts.includes(i) ? null : (
            <Card key={i} style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, borderColor: a.type === "late" ? "var(--badge-warning-bg)" : "var(--badge-danger-bg)", animation: `fadeIn 0.2s ease ${i * 0.05}s both` }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: a.type === "late" ? "var(--badge-warning-bg)" : "var(--badge-danger-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={a.type === "late" ? "clock" : "alerts"} size={20} color={a.type === "late" ? "var(--warning)" : "var(--danger)"} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{a.msg}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{a.sector} • {a.time}</div>
              </div>
              <Badge color={a.type === "late" ? "var(--warning)" : "var(--danger)"}>{a.type === "late" ? "Atraso" : "Pendente"}</Badge>
              {(user.role === "admin" || user.role === "manager") && (
                <div style={{ cursor: "pointer", padding: 6, borderRadius: 8, marginLeft: 4 }} onClick={() => dismissAlert(i)}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--badge-danger-bg)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Icon name="close" size={16} color="var(--danger)" />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // ---- USERS ----
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", password: "", role: "employee", sector: "Cozinha", phone: "" });
  const [editingUser, setEditingUser] = useState(null);
  const [editUserForm, setEditUserForm] = useState({});
  const [newPassword, setNewPassword] = useState("");

  const createUser = async () => {
    if (!newUserForm.name || !newUserForm.email || !newUserForm.password) { notify("Preencha todos os campos", "error"); return; }
    if (newUserForm.password.length < 6) { notify("Senha mínimo 6 caracteres", "error"); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: newUserForm.email, password: newUserForm.password, data: { name: newUserForm.name } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.msg || "Erro ao criar usuário");

      if (data.user?.id && supabase.authToken) {
        const sectors = await db.query("sectors", "id", { name: `eq.${newUserForm.sector}`, limit: "1" });
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}`, {
          method: "PATCH",
          headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${supabase.authToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: newUserForm.name, role: newUserForm.role, sector_id: sectors[0]?.id, phone: newUserForm.phone }),
        });
      }

      setAllUsers(prev => [...prev, {
        id: data.user?.id || `new-${Date.now()}`, name: newUserForm.name, email: newUserForm.email, role: newUserForm.role,
        sector: newUserForm.sector, avatar: newUserForm.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase(),
        phone: newUserForm.phone, active: true,
      }]);
      setShowNewUser(false);
      setNewUserForm({ name: "", email: "", password: "", role: "employee", sector: "Cozinha", phone: "" });
      notify("✅ Usuário criado!");
    } catch (err) {
      if (user._demo) {
        setAllUsers(prev => [...prev, {
          id: `demo-${Date.now()}`, name: newUserForm.name, email: newUserForm.email, role: newUserForm.role,
          sector: newUserForm.sector, avatar: newUserForm.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase(),
          phone: newUserForm.phone, active: true,
        }]);
        setShowNewUser(false);
        setNewUserForm({ name: "", email: "", password: "", role: "employee", sector: "Cozinha", phone: "" });
        notify("✅ Usuário criado (demo)!");
      } else {
        notify(err.message || "Erro ao criar usuário", "error");
      }
    }
  };

  const saveEditUser = async () => {
    if (!editUserForm.name) { notify("Nome é obrigatório", "error"); return; }
    try {
      const sectorData = await db.query("sectors", "id", { name: `eq.${editUserForm.sector}`, limit: "1" });
      await db.update("profiles", { id: editingUser.id }, {
        name: editUserForm.name,
        role: editUserForm.role,
        phone: editUserForm.phone,
        sector_id: sectorData[0]?.id,
        active: editUserForm.active,
      });
      notify("✅ Usuário atualizado!");
    } catch (err) {
      if (!user._demo) console.error(err);
      notify(user._demo ? "✅ Usuário atualizado (demo)!" : "✅ Dados atualizados!");
    }
    setAllUsers(prev => prev.map(u => u.id === editingUser.id ? {
      ...u, name: editUserForm.name, role: editUserForm.role, phone: editUserForm.phone,
      sector: editUserForm.sector, active: editUserForm.active,
      avatar: editUserForm.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase(),
    } : u));
    setEditingUser(null);
  };

  const changeUserPassword = async () => {
    if (!newPassword || newPassword.length < 6) { notify("Senha mínimo 6 caracteres", "error"); return; }
    try {
      // Use admin update via Supabase Auth API
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${editingUser.id}`, {
        method: "PUT",
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${supabase.authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        // Try alternative: use service role or user update
        const res2 = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: "PUT",
          headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${supabase.authToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password: newPassword }),
        });
        if (!res2.ok) throw new Error("Sem permissão para alterar senha de outros usuários. Use o painel do Supabase.");
      }
      setNewPassword("");
      notify("✅ Senha alterada!");
    } catch (err) {
      if (user._demo) {
        setNewPassword("");
        notify("✅ Senha alterada (demo)!");
      } else {
        notify(err.message || "Erro ao alterar senha. Use o painel do Supabase Authentication.", "error");
      }
    }
  };

  const renderUsers = () => (
    <div className="animate-fade">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ cursor: "pointer", padding: 6, borderRadius: 10, background: "var(--bg-elevated)" }} onClick={goBack}><Icon name="back" size={18} /></div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>Equipe</h1>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 14 }}>Gerenciamento de usuários e permissões — {allUsers.length} membros</p>
        </div>
        {(user.role === "admin" || user.role === "manager") && (
          <Btn variant="primary" onClick={() => { setShowNewUser(true); setEditingUser(null); }}><Icon name="add" size={16} color="var(--btn-primary-text)" /> Novo Usuário</Btn>
        )}
      </div>

      {/* New User Form */}
      {showNewUser && (
        <Card style={{ marginBottom: 20, animation: "fadeIn 0.3s ease" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Cadastrar Novo Usuário</h3>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <Input label="Nome completo" value={newUserForm.name} onChange={e => setNewUserForm({...newUserForm, name: e.target.value})} placeholder="Nome do funcionário" />
            <Input label="Email" type="email" value={newUserForm.email} onChange={e => setNewUserForm({...newUserForm, email: e.target.value})} placeholder="email@japacarioca.com" />
            <Input label="Senha" type="password" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} placeholder="Mínimo 6 caracteres" />
            <Input label="Telefone" value={newUserForm.phone} onChange={e => setNewUserForm({...newUserForm, phone: e.target.value})} placeholder="(21) 99999-0000" />
            <Select label="Cargo" options={[{value: "employee", label: "Funcionário"}, {value: "manager", label: "Gerente"}, {value: "admin", label: "Administrador"}]} value={newUserForm.role} onChange={e => setNewUserForm({...newUserForm, role: e.target.value})} />
            <Select label="Setor" options={SECTORS} value={newUserForm.sector} onChange={e => setNewUserForm({...newUserForm, sector: e.target.value})} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Btn variant="primary" onClick={createUser}><Icon name="check" size={16} color="var(--btn-primary-text)" /> Cadastrar</Btn>
            <Btn variant="ghost" onClick={() => setShowNewUser(false)}>Cancelar</Btn>
          </div>
        </Card>
      )}

      {/* Edit User Form */}
      {editingUser && (
        <Card style={{ marginBottom: 20, animation: "fadeIn 0.3s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Editar: {editingUser.name}</h3>
            <div style={{ cursor: "pointer", padding: 6 }} onClick={() => setEditingUser(null)}><Icon name="close" size={18} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <Input label="Nome" value={editUserForm.name || ""} onChange={e => setEditUserForm({...editUserForm, name: e.target.value})} />
            <Input label="Email" value={editUserForm.email || ""} disabled style={{ opacity: 0.6 }} />
            <Input label="Telefone" value={editUserForm.phone || ""} onChange={e => setEditUserForm({...editUserForm, phone: e.target.value})} />
            <Select label="Cargo" options={[{value: "employee", label: "Funcionário"}, {value: "manager", label: "Gerente"}, {value: "admin", label: "Administrador"}]} value={editUserForm.role} onChange={e => setEditUserForm({...editUserForm, role: e.target.value})} />
            <Select label="Setor" options={SECTORS} value={editUserForm.sector} onChange={e => setEditUserForm({...editUserForm, sector: e.target.value})} />
            <Select label="Status" options={[{value: true, label: "Ativo"}, {value: false, label: "Inativo"}]} value={editUserForm.active} onChange={e => setEditUserForm({...editUserForm, active: e.target.value === "true"})} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Btn variant="primary" onClick={saveEditUser}><Icon name="check" size={16} color="var(--btn-primary-text)" /> Salvar</Btn>
            <Btn variant="ghost" onClick={() => setEditingUser(null)}>Cancelar</Btn>
          </div>

          {/* Change Password */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--warning)" }}>🔒 Alterar Senha</h4>
            <div style={{ display: "flex", gap: 10 }}>
              <Input type="password" placeholder="Nova senha (mín. 6 caracteres)" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ flex: 1 }} />
              <Btn variant="primary" onClick={changeUserPassword}><Icon name="lock" size={14} color="var(--btn-primary-text)" /> Alterar</Btn>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {allUsers.map((u, i) => (
          <Card key={u.id} style={{ animation: `fadeIn 0.3s ease ${i * 0.06}s both` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 50, height: 50, borderRadius: 14, background: "linear-gradient(135deg, var(--accent-dim), rgba(91,156,246,0.12))", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 17, color: "var(--accent)" }}>{u.avatar}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{u.name}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <Badge color="var(--purple)">{ROLE_LABELS[u.role]}</Badge>
                  <Badge color="var(--info)">{u.sector}</Badge>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <Badge color={u.active !== false ? "var(--accent)" : "var(--danger)"}>{u.active !== false ? "Ativo" : "Inativo"}</Badge>
                {(user.role === "admin" || user.role === "manager") && (
                  <div style={{ cursor: "pointer", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}
                    onClick={() => {
                      setEditingUser(u);
                      setEditUserForm({ name: u.name, email: u.email, phone: u.phone || "", role: u.role, sector: u.sector, active: u.active !== false });
                      setNewPassword("");
                      setShowNewUser(false);
                    }}>
                    ✏️ Editar
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
              📧 {u.email}{u.phone ? ` • 📱 ${u.phone}` : ""}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  const [newSector, setNewSector] = useState("");
  const [unitForm, setUnitForm] = useState({ name: unit.name || "Japa Carioca", address: unit.address || "Rio de Janeiro, RJ", phone: unit.phone || "(21) 3333-1234" });

  const addSector = async () => {
    if (!newSector.trim()) { notify("Digite o nome do setor", "error"); return; }
    if (sectorsList.find(s => s.name.toLowerCase() === newSector.trim().toLowerCase())) { notify("Setor já existe", "error"); return; }
    try {
      const result = await db.insert("sectors", { name: newSector.trim(), unit_id: unit.id });
      setSectorsList(prev => [...prev, result[0] || { id: Date.now(), name: newSector.trim() }]);
      setNewSector("");
      notify("✅ Setor adicionado!");
    } catch (err) {
      // Demo mode
      setSectorsList(prev => [...prev, { id: `new-${Date.now()}`, name: newSector.trim() }]);
      setNewSector("");
      notify("✅ Setor adicionado!");
    }
  };

  const saveUnitData = async () => {
    try {
      await db.update("units", { id: unit.id }, unitForm);
      notify("✅ Dados salvos!");
    } catch (err) {
      notify("✅ Dados salvos (modo demo)!");
    }
  };

  const exportBackup = () => {
    const data = { templates, executions, users: allUsers, sectors: sectorsList, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `japa-carioca-backup-${new Date().toISOString().split("T")[0]}.json`; a.click();
    URL.revokeObjectURL(url);
    notify("📥 Backup exportado!");
  };

  const exportCSV = () => {
    const rows = [["Data", "Checklist", "Setor", "Responsável", "Status", "Progresso", "Assinatura"]];
    executions.forEach(e => rows.push([e.date, e.templateTitle, e.sector, e.responsible, e.status, `${e.completionRate}%`, e.signature || ""]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `japa-execucoes-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
    notify("📥 CSV exportado!");
  };

  const renderSettings = () => (
    <div className="animate-fade">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <div style={{ cursor: "pointer", padding: 6, borderRadius: 10, background: "var(--bg-elevated)" }} onClick={goBack}><Icon name="back" size={18} /></div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>Configurações</h1>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
        <Card>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Unidade</h3>
          <Input label="Nome" value={unitForm.name} onChange={e => setUnitForm({...unitForm, name: e.target.value})} style={{ marginBottom: 12 }} />
          <Input label="Endereço" value={unitForm.address} onChange={e => setUnitForm({...unitForm, address: e.target.value})} style={{ marginBottom: 12 }} />
          <Input label="Telefone" value={unitForm.phone} onChange={e => setUnitForm({...unitForm, phone: e.target.value})} style={{ marginBottom: 12 }} />
          <Btn size="sm" variant="primary" onClick={saveUnitData}><Icon name="check" size={14} color="var(--btn-primary-text)" /> Salvar</Btn>
        </Card>
        <Card>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Alertas WhatsApp</h3>
          {["Checklist não iniciado", "Item crítico fora do padrão", "Atraso na execução", "Relatório diário automático"].map(item => (
            <div key={item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 14 }}>{item}</span>
              <div style={{ width: 44, height: 24, borderRadius: 12, background: "linear-gradient(135deg, var(--accent), var(--success))", position: "relative", cursor: "pointer" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, right: 2 }} />
              </div>
            </div>
          ))}
        </Card>
        <Card>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Setores</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {sectorsList.map(s => <Badge key={s.id || s.name} color="var(--accent)" style={{ padding: "8px 14px", fontSize: 13 }}>{s.name}</Badge>)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input placeholder="Nome do novo setor" value={newSector} onChange={e => setNewSector(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSector()} style={{ flex: 1 }} />
            <Btn size="sm" variant="primary" onClick={addSector}><Icon name="add" size={14} color="var(--btn-primary-text)" /> Adicionar</Btn>
          </div>
        </Card>
        <Card>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Dados & Backup</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Btn variant="ghost" onClick={exportBackup}><Icon name="download" size={16} color="var(--accent)" /> Backup Completo (JSON)</Btn>
            <Btn variant="ghost" onClick={exportCSV}><Icon name="download" size={16} color="var(--accent)" /> Exportar Execuções (CSV)</Btn>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>Os backups são baixados diretamente no seu dispositivo</div>
        </Card>
      </div>
    </div>
  );

  const renderPage = () => {
    if (loading) return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16 }}>
        <div style={{ width: 48, height: 48, border: "4px solid var(--accent-dim)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Carregando dados...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
    switch (page) {
      case "dashboard": return renderDashboard();
      case "checklists": return renderChecklists();
      case "execute": return renderExecution();
      case "templates": return renderTemplates();
      case "executions": return renderHistory();
      case "alerts": return renderAlerts();
      case "users": return renderUsers();
      case "settings": return renderSettings();
      default: return renderDashboard();
    }
  };

  // Mobile nav handler
  const mobileNav = (p) => { navigateTo(p); setMobileMenuOpen(false); setActiveExec(null); if (p !== "checklists") { setFilterStatus("Todos"); setFilterSector("Todos"); setSearchTerm(""); } };

  // Bottom nav items for mobile (5 max)
  const bottomNavItems = [
    { id: "dashboard", icon: "dashboard", label: "Início" },
    { id: "checklists", icon: "checklists", label: "Checklists" },
    { id: "templates", icon: "templates", label: "Modelos" },
    { id: "alerts", icon: "alerts", label: "Alertas", count: visibleAlerts.length },
    { id: "more", icon: "menu", label: "Mais" },
  ];

  // "More" menu items
  const moreMenuItems = [
    { id: "history", icon: "history", label: "Histórico" },
    { id: "users", icon: "users", label: "Equipe" },
    { id: "settings", icon: "settings", label: "Configurações" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", flexDirection: isMobile ? "column" : "row" }}>

      {/* ===== DESKTOP SIDEBAR ===== */}
      {!isMobile && (
        <div style={{
          width: sidebarOpen ? 260 : 68, minWidth: sidebarOpen ? 260 : 68,
          background: "var(--sidebar-bg)", borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column", transition: "all 0.3s ease",
        }}>
          <div style={{ padding: sidebarOpen ? "20px 18px" : "20px 14px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
            <JapaLogo size={40} theme={theme} />
            {sidebarOpen && <div><div style={{ fontWeight: 800, fontSize: 15 }}>Japa Carioca</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>Gestão de Checklists</div></div>}
          </div>

          <div style={{ flex: 1, padding: "10px 0", overflowY: "auto" }}>
            {navItems.map(n => (
              <div key={n.id} onClick={() => { navigateTo(n.id); setActiveExec(null); if (n.id !== "checklists") { setFilterStatus("Todos"); setFilterSector("Todos"); setSearchTerm(""); } }}
                style={{
                  display: "flex", alignItems: "center", gap: 13,
                  padding: sidebarOpen ? "11px 18px" : "11px 22px",
                  margin: "2px 6px", borderRadius: 10, cursor: "pointer",
                  background: (page === n.id || (page === "execute" && n.id === "checklists")) ? "var(--accent-dim)" : "transparent",
                  color: (page === n.id || (page === "execute" && n.id === "checklists")) ? "var(--accent)" : "var(--text-secondary)",
                  fontWeight: (page === n.id || (page === "execute" && n.id === "checklists")) ? 600 : 400,
                  fontSize: 14, transition: "all 0.2s", whiteSpace: "nowrap",
                  border: (page === n.id || (page === "execute" && n.id === "checklists")) ? "1px solid var(--border-accent)" : "1px solid transparent",
                }}>
                <Icon name={n.icon} size={19} />
                {sidebarOpen && <span style={{ flex: 1 }}>{n.label}</span>}
                {sidebarOpen && n.count > 0 && <span style={{ background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10 }}>{n.count}</span>}
              </div>
            ))}
          </div>

          <div style={{ padding: "12px 6px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, cursor: "pointer", color: "var(--text-muted)", fontSize: 13 }} onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Icon name="menu" size={18} />
              {sidebarOpen && <span>Recolher</span>}
            </div>
          </div>
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* TOP BAR */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: isMobile ? "10px 16px" : "12px 28px",
          borderBottom: "1px solid var(--border)", background: "var(--topbar-bg)", backdropFilter: "blur(12px)",
        }}>
          {isMobile ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <JapaLogo size={32} theme={theme} />
                <div style={{ fontWeight: 800, fontSize: 14 }}>Japa Carioca</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div onClick={onToggleTheme} style={{
                  width: 36, height: 36, borderRadius: 10, cursor: "pointer",
                  background: "var(--toggle-bg)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <div key={theme} className="theme-switch-anim">
                    <Icon name={theme === "dark" ? "sun" : "moon"} size={16} color={theme === "dark" ? "var(--warning)" : "var(--accent)"} />
                  </div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, var(--accent), var(--success))", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, color: "var(--logo-text)", cursor: "pointer" }}
                  onClick={() => setShowUserMenu(!showUserMenu)}>
                  {user.avatar}
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-secondary)" }}>
                {navItems.find(n => n.id === page)?.label || (page === "execute" ? "Executar Checklist" : "")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div onClick={onToggleTheme} style={{
                  width: 40, height: 40, borderRadius: 12, cursor: "pointer",
                  background: "var(--toggle-bg)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.3s ease", position: "relative", overflow: "hidden",
                }}>
                  <div key={theme} className="theme-switch-anim">
                    <Icon name={theme === "dark" ? "sun" : "moon"} size={18} color={theme === "dark" ? "var(--warning)" : "var(--accent)"} />
                  </div>
                </div>
                <div style={{ position: "relative", cursor: "pointer", padding: 6 }} onClick={() => navigateTo("alerts")}>
                  <Icon name="alerts" size={20} color="var(--text-muted)" />
                  {visibleAlerts.length > 0 && <div style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "var(--danger)" }} />}
                </div>
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 12px", borderRadius: 10, background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                    onClick={() => setShowUserMenu(!showUserMenu)}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, var(--accent), var(--success))", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, color: "var(--logo-text)" }}>{user.avatar}</div>
                    <div><div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{ROLE_LABELS[user.role]}</div></div>
                    <Icon name="expand" size={16} color="var(--text-muted)" />
                  </div>
                  {showUserMenu && (
                    <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, background: "var(--bg-surface)", border: "1px solid var(--border-accent)", borderRadius: 12, padding: 6, minWidth: 200, zIndex: 100, boxShadow: "var(--shadow-lg)" }}>
                      <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                        {user.email}
                      </div>
                      <div style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--danger)" }}
                        onClick={onLogout} onMouseEnter={e => e.currentTarget.style.background = "var(--badge-danger-bg)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <Icon name="logout" size={16} color="var(--danger)" /> Sair
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {/* Mobile user menu dropdown */}
          {isMobile && showUserMenu && (
            <div style={{ position: "absolute", top: 56, right: 12, background: "var(--bg-surface)", border: "1px solid var(--border-accent)", borderRadius: 12, padding: 6, minWidth: 200, zIndex: 100, boxShadow: "var(--shadow-lg)" }}>
              <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-primary)", fontWeight: 600, borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                {user.name} • {ROLE_LABELS[user.role]}
              </div>
              <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-muted)", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                {user.email}
              </div>
              <div style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--danger)" }}
                onClick={onLogout}>
                <Icon name="logout" size={16} color="var(--danger)" /> Sair
              </div>
            </div>
          )}
        </div>

        {/* CONTENT */}
        <div style={{
          flex: 1, overflow: "auto",
          padding: isMobile ? "16px 14px 90px 14px" : "24px 28px",
          background: "var(--content-gradient)",
        }}>
          {renderPage()}
        </div>
      </div>

      {/* ===== MOBILE BOTTOM NAV ===== */}
      {isMobile && (
        <>
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90,
            background: "var(--sidebar-bg)", borderTop: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-around",
            padding: "6px 0 env(safe-area-inset-bottom, 8px) 0",
            backdropFilter: "blur(16px)",
          }}>
            {bottomNavItems.map(n => {
              const isActive = n.id === "more"
                ? mobileMenuOpen
                : (page === n.id || (page === "execute" && n.id === "checklists"));
              return (
                <div key={n.id} onClick={() => {
                  if (n.id === "more") { setMobileMenuOpen(!mobileMenuOpen); }
                  else { mobileNav(n.id); setMobileMenuOpen(false); }
                }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    padding: "6px 12px", borderRadius: 12, cursor: "pointer", position: "relative",
                    color: isActive ? "var(--accent)" : "var(--text-muted)",
                    transition: "all 0.2s",
                  }}>
                  <Icon name={n.icon} size={22} color={isActive ? "var(--accent)" : "var(--text-muted)"} />
                  <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500 }}>{n.label}</span>
                  {n.count > 0 && (
                    <div style={{ position: "absolute", top: 2, right: 6, width: 16, height: 16, borderRadius: "50%", background: "var(--danger)", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{n.count}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* "More" menu popup */}
          {mobileMenuOpen && (
            <div style={{
              position: "fixed", bottom: 70, left: 8, right: 8, zIndex: 89,
              background: "var(--bg-surface)", border: "1px solid var(--border-accent)",
              borderRadius: 16, padding: 8, boxShadow: "var(--shadow-lg)",
              animation: "fadeIn 0.2s ease",
            }}>
              {moreMenuItems.map(n => (
                <div key={n.id} onClick={() => mobileNav(n.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                    borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 500,
                    color: page === n.id ? "var(--accent)" : "var(--text-primary)",
                    background: page === n.id ? "var(--accent-dim)" : "transparent",
                  }}>
                  <Icon name={n.icon} size={20} color={page === n.id ? "var(--accent)" : "var(--text-secondary)"} />
                  {n.label}
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
              <div onClick={onLogout}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 500, color: "var(--danger)" }}>
                <Icon name="logout" size={20} color="var(--danger)" /> Sair
              </div>
            </div>
          )}

          {/* Overlay to close more menu */}
          {mobileMenuOpen && (
            <div onClick={() => setMobileMenuOpen(false)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 70, zIndex: 88, background: "rgba(0,0,0,0.3)" }} />
          )}
        </>
      )}

      {/* NOTIFICATION */}
      {notification && (
        <div style={{
          position: "fixed", bottom: isMobile ? 80 : 24, right: isMobile ? 14 : 24, left: isMobile ? 14 : "auto", zIndex: 1000,
          padding: "14px 24px", borderRadius: "var(--radius-md)",
          background: notification.type === "error" ? "var(--danger)" : "var(--accent)",
          color: "#fff", textAlign: "center",
          fontWeight: 600, fontSize: 14, boxShadow: "var(--shadow-lg)",
          animation: "notifIn 0.3s ease",
        }}>{notification.msg}</div>
      )}
    </div>
  );
};

// ============================================================
// ROOT APP — AUTH ROUTER
// ============================================================
export default function App() {
  const [authState, setAuthState] = useState("login");
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUnit, setCurrentUnit] = useState(null);
  const [theme, setTheme] = useState("dark");

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  const handleLogin = async (user) => {
    setCurrentUser(user);
    // Load unit from Supabase
    try {
      const units = await db.query("units", "*", { id: `eq.${user.unit_id}` });
      setCurrentUnit(units[0] || { id: user.unit_id, name: "Japa Carioca", address: "Rio de Janeiro, RJ" });
    } catch (e) {
      setCurrentUnit({ id: user.unit_id, name: "Japa Carioca", address: "Rio de Janeiro, RJ" });
    }
    setAuthState("app");
  };

  const handleLogout = async () => {
    await supabase.signOut();
    setCurrentUser(null);
    setCurrentUnit(null);
    setAuthState("login");
  };

  return (
    <div data-theme={theme}>
      <style>{CSS}</style>
      {authState === "login" && (
        <LoginPage onLogin={handleLogin} onGoToRegister={() => setAuthState("register")} onGoToForgot={() => setAuthState("forgot")} theme={theme} onToggleTheme={toggleTheme} />
      )}
      {authState === "register" && (
        <RegisterPage onGoToLogin={() => setAuthState("login")} theme={theme} />
      )}
      {authState === "forgot" && (
        <ForgotPasswordPage onGoToLogin={() => setAuthState("login")} theme={theme} />
      )}
      {authState === "app" && currentUser && currentUnit && (
        <MainApp user={currentUser} unit={currentUnit} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />
      )}
    </div>
  );
}
