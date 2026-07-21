import React, { useState, useEffect, useRef, useCallback } from "react";

// ---------- Storage: uses Claude.ai's built-in window.storage when this runs inside a Claude
// artifact preview; falls back to the browser's own localStorage when deployed standalone (e.g.
// on Vercel/Netlify), so the app still works — just scoped to that one browser instead of the
// Claude.ai account.
const NATIVE_STORAGE = (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function") ? window.storage : null;
const AI_ENDPOINT = NATIVE_STORAGE ? "https://api.anthropic.com/v1/messages" : "/api/claude";

const storage = NATIVE_STORAGE || {
  async get(key) {
    const v = localStorage.getItem(key);
    if (v === null) throw new Error("not found");
    return { key, value: v };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
  async list(prefix = "") {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    return { keys };
  },
};

// ---------- Design tokens ----------
// Cream #F6F0E8 · Rosewood #6E3B34 · Blush #E7D3C4 · Gold #B08D57 · Ink #2A211C · Sage #8C9A7E

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS_ES = ["D","L","M","M","J","V","S"];
const DAYS_LONG_ES = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

const CATEGORIES = [
  { id: "personal", label: "Personal", color: "#6E3B34", bg: "#E7D3C4" },
  { id: "lumar", label: "Lumar", color: "#8a6a2e", bg: "#EFE1C6" },
  { id: "nogalia", label: "Nogalia", color: "#93504A", bg: "#EFDAD6" },
  { id: "casablanca", label: "Casa Blanca", color: "#5f6f52", bg: "#E4EADB" },
  { id: "casalaroja", label: "Casa La Roja", color: "#7a3b2e", bg: "#EAD5CC" },
  { id: "cliente", label: "Cliente externo", color: "#556478", bg: "#DEE4EA" },
];
function catInfo(id) { return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]; }

function escapeICS(str = "") {
  return String(str).replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
}

function buildICS(events) {
  let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Amara Personal//ES\r\nCALSCALE:GREGORIAN\r\n";
  events.forEach((e) => {
    const dt = e.date.replace(/-/g, "");
    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:${e.id}@amara.personal\r\n`;
    ics += `DTSTAMP:${dt}T000000Z\r\n`;
    if (e.time) {
      const [h, m] = e.time.split(":");
      ics += `DTSTART:${dt}T${h.padStart(2,"0")}${m.padStart(2,"0")}00\r\n`;
    } else {
      ics += `DTSTART;VALUE=DATE:${dt}\r\n`;
    }
    ics += `SUMMARY:${escapeICS(e.title)}\r\n`;
    if (e.notes) ics += `DESCRIPTION:${escapeICS(e.notes)}\r\n`;
    ics += "END:VEVENT\r\n";
  });
  ics += "END:VCALENDAR";
  return ics;
}

function downloadICS(events, filename = "amara-calendario.ics") {
  const blob = new Blob([buildICS(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function callClaude(messages, system) {
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return text;
}

async function hashPassword(pw) {
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadAccounts() {
  try {
    const r = await storage.get("amara-accounts");
    return r && r.value ? JSON.parse(r.value) : {};
  } catch (e) { return {}; }
}
async function saveAccounts(obj) {
  try { await storage.set("amara-accounts", JSON.stringify(obj)); } catch (e) { console.error(e); }
}

const WEATHER_CODES = {
  0: "Cielo despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Nublado",
  45: "Neblina", 48: "Neblina con escarcha",
  51: "Llovizna ligera", 53: "Llovizna", 55: "Llovizna densa",
  61: "Lluvia ligera", 63: "Lluvia", 65: "Lluvia intensa",
  71: "Nieve ligera", 73: "Nieve", 75: "Nieve intensa",
  80: "Chubascos ligeros", 81: "Chubascos", 82: "Chubascos intensos",
  95: "Tormenta eléctrica", 96: "Tormenta con granizo",
};
function weatherLabel(code) { return WEATHER_CODES[code] || "Clima variable"; }

async function fetchWeatherFor(lat, lon) {
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
  const data = await res.json();
  return { temp: Math.round(data.current.temperature_2m), code: data.current.weather_code };
}

async function fetchNewsBriefing() {
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: `Eres Amara preparando el resumen matutino de tu usuaria. Busca en la web las noticias más importantes y relevantes de las últimas 24 a 36 horas (panorama internacional y de negocios). Usa ÚNICAMENTE información confirmada por medios de comunicación y televisoras verificados y de trayectoria reconocida (por ejemplo Reuters, AP, BBC, EFE, El País, CNN, Televisa, TV Azteca, Milenio, entre otros de prestigio similar) — nunca inventes una noticia ni un dato, y si una nota solo aparece en una fuente dudosa o sin verificar, no la incluyas. Si genuinamente encuentras alguna noticia positiva o alentadora entre las relevantes y confirmadas, inclúyela con gusto, pero jamás inventes una buena noticia que no exista. Responde en español, en 4 a 6 viñetas breves (una línea cada una), cálido pero directo, sin encabezado ni introducción — empieza directo con la primera viñeta, cada una iniciando con "• ".`,
      messages: [{ role: "user", content: "Dame el resumen de noticias de hoy." }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return text.trim();
}

// ---------- New-account email notification (via EmailJS — a free client-side email service) ----------
// This only tells you a new account was created — nothing about what that person writes or stores.
// To activate: create a free account at https://www.emailjs.com, connect the Gmail inbox that should
// receive the alert, create a template whose body is just "Nueva cuenta de: {{username}}", then paste
// your Service ID / Template ID / Public Key below. Until these are filled in, it's skipped silently.
const EMAILJS_SERVICE_ID = "TU_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "TU_TEMPLATE_ID";
const EMAILJS_PUBLIC_KEY = "TU_PUBLIC_KEY";
const NOTIFY_EMAIL = "alexa.castilloem@gmail.com";

async function notifyNewSignup(username) {
  if (EMAILJS_SERVICE_ID.startsWith("TU_") || EMAILJS_TEMPLATE_ID.startsWith("TU_") || EMAILJS_PUBLIC_KEY.startsWith("TU_")) {
    console.warn("EmailJS no está configurado todavía — omitiendo notificación de nuevo registro.");
    return;
  }
  try {
    await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: { to_email: NOTIFY_EMAIL, username },
      }),
    });
  } catch (e) {
    console.error("No se pudo enviar la notificación de nuevo registro por correo", e);
  }
}

// ---------- Icons (minimal inline SVG, single stroke weight) ----------
const Icon = {
  Calendar: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" strokeLinecap="round" />
    </svg>
  ),
  Chat: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M4 5.5h16v11H9l-4 3.5v-3.5H4v-11Z" strokeLinejoin="round" />
    </svg>
  ),
  Plus: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  Mic: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" strokeLinecap="round" />
    </svg>
  ),
  Download: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Close: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  ),
  Copy: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M5.5 15.5h-1a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Trash: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8 12.5l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  CheckSm: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M5 12.5l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  User: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" strokeLinecap="round" />
    </svg>
  ),
  Speaker: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4v-5Z" strokeLinejoin="round" />
      <path d="M16 9a4.2 4.2 0 0 1 0 6M18.5 6.8a7.8 7.8 0 0 1 0 10.4" strokeLinecap="round" />
    </svg>
  ),
  Bookmark: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M6 4h12v16l-6-4-6 4V4Z" strokeLinejoin="round" />
    </svg>
  ),
  Lock: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  ),
  Logout: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M15 16l4-4-4-4M19 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Brain: (p) => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M9 4.5a2.5 2.5 0 0 0-2.5 2.5v.3A2.7 2.7 0 0 0 5 9.7v1a2.7 2.7 0 0 0 1 2.1v.7a2.7 2.7 0 0 0 2 2.6v.4A2.5 2.5 0 0 0 10.5 19M15 4.5a2.5 2.5 0 0 1 2.5 2.5v.3A2.7 2.7 0 0 1 19 9.7v1a2.7 2.7 0 0 1-1 2.1v.7a2.7 2.7 0 0 1-2 2.6v.4a2.5 2.5 0 0 1-2.5 2.5M9 4.5V19M15 4.5V19" strokeLinecap="round" />
    </svg>
  ),
  Sun: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.55 1.55M7.15 16.85l-1.55 1.55M18.4 18.4l-1.55-1.55M7.15 7.15 5.6 5.6" strokeLinecap="round" />
    </svg>
  ),
  Cloud: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16.2 8.1 4.2 4.2 0 0 1 16 18H7Z" strokeLinejoin="round" />
    </svg>
  ),
  Book: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <path d="M4 5.2c2-1 5-1 8 .3 3-1.3 6-1.3 8-.3v13.6c-2-1-5-1-8 .3-3-1.3-6-1.3-8-.3V5.2Z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M12 5.5v13.6" />
    </svg>
  ),
  Newspaper: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
      <rect x="3.5" y="5.5" width="13" height="13" rx="1.5" />
      <path d="M16.5 8.5H20v8a2 2 0 0 1-2 2h-1.5M7 9.5h6M7 12.5h6M7 15.5h4" strokeLinecap="round" />
    </svg>
  ),
};

// ---------- Seal / monogram, the signature motif ----------
function Seal({ size = 88 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <circle cx="50" cy="50" r="47" fill="none" stroke="#B08D57" strokeWidth="0.7" />
      <circle cx="50" cy="50" r="41" fill="none" stroke="#B08D57" strokeWidth="0.7" />
      <text x="50" y="60" textAnchor="middle" fontFamily="'Cormorant Garamond', serif" fontStyle="italic" fontSize="34" fill="#6E3B34">A</text>
    </svg>
  );
}

export default function Amara() {
  const [phase, setPhase] = useState("welcome"); // welcome | auth | name | app
  const [welcomePhase, setWelcomePhase] = useState(0);
  const [sessionUser, setSessionUser] = useState(null);

  const [account, setAccount] = useState(null); // { username, displayName }
  const [authMode, setAuthMode] = useState("login"); // login | signup
  const [authForm, setAuthForm] = useState({ username: "", password: "", password2: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const [tab, setTab] = useState("calendar");
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", date: todayISO(), time: "", notes: "", category: "personal" });
  const [dictate, setDictate] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);
  const [chatListening, setChatListening] = useState(false);
  const chatRecogRef = useRef(null);

  const [viewMode, setViewMode] = useState("month"); // 'month' | 'week'
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());

  const [todos, setTodos] = useState([]);
  const [todosLoaded, setTodosLoaded] = useState(false);
  const [newTodo, setNewTodo] = useState("");

  const [contacts, setContacts] = useState([]);
  const [newContact, setNewContact] = useState({ name: "", tone: "cercano", notes: "" });
  const [showContactForm, setShowContactForm] = useState(false);

  const [templates, setTemplates] = useState([]);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState("");

  const [greeted, setGreeted] = useState(false);
  const [speaking, setSpeaking] = useState(null);
  const [expandedReasoning, setExpandedReasoning] = useState({});

  const [clock, setClock] = useState(() => new Date());
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState("idle"); // idle | loading | ok | error | denied

  const [showBriefing, setShowBriefing] = useState(false);
  const [newsText, setNewsText] = useState("");
  const [newsStatus, setNewsStatus] = useState("idle"); // idle | loading | ok | error

  const [diary, setDiary] = useState([]);
  const [diaryLoaded, setDiaryLoaded] = useState(false);
  const [diaryText, setDiaryText] = useState("");
  const [editingDiaryId, setEditingDiaryId] = useState(null);

  const [chat, setChat] = useState([
    { role: "assistant", text: "Bienvenida. Soy Amara. Puedo redactar mensajes, correos o avisos con tus indicaciones — solo dime el tono y a quién va dirigido." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Check for a saved session (personal, tied to this Claude.ai account) so returning users skip login
  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("amara-session");
        if (r && r.value) setSessionUser(r.value);
      } catch (e) { /* no session yet */ }
    })();
  }, []);

  // Once logged in, load this account's own data (namespaced by username, shared scope so any device/account can log into it)
  useEffect(() => {
    if (!account) return;
    (async () => {
      const ns = account.username;
      try {
        const r = await storage.get(`${ns}::events`);
        if (r && r.value) setEvents(JSON.parse(r.value));
      } catch (e) { /* none yet */ }
      setLoaded(true);
      try {
        const r2 = await storage.get(`${ns}::todos`);
        if (r2 && r2.value) setTodos(JSON.parse(r2.value));
      } catch (e) { /* none yet */ }
      try {
        const r3 = await storage.get(`${ns}::contacts`);
        if (r3 && r3.value) setContacts(JSON.parse(r3.value));
      } catch (e) { /* none yet */ }
      try {
        const r4 = await storage.get(`${ns}::templates`);
        if (r4 && r4.value) setTemplates(JSON.parse(r4.value));
      } catch (e) { /* none yet */ }
      setTodosLoaded(true);
    })();
  }, [account]);

  const persist = useCallback(async (next) => {
    setEvents(next);
    if (!account) return;
    try { await storage.set(`${account.username}::events`, JSON.stringify(next)); } catch (e) { console.error(e); }
  }, [account]);

  const persistTodos = useCallback(async (next) => {
    setTodos(next);
    if (!account) return;
    try { await storage.set(`${account.username}::todos`, JSON.stringify(next)); } catch (e) { console.error(e); }
  }, [account]);

  const persistContacts = useCallback(async (next) => {
    setContacts(next);
    if (!account) return;
    try { await storage.set(`${account.username}::contacts`, JSON.stringify(next)); } catch (e) { console.error(e); }
  }, [account]);

  const persistTemplates = useCallback(async (next) => {
    setTemplates(next);
    if (!account) return;
    try { await storage.set(`${account.username}::templates`, JSON.stringify(next)); } catch (e) { console.error(e); }
  }, [account]);

  const persistDiary = useCallback(async (next) => {
    setDiary(next);
    if (!account) return;
    try { await storage.set(`${account.username}::diary`, JSON.stringify(next)); } catch (e) { console.error(e); }
  }, [account]);

  // Clock — ticks every 30s
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  function requestWeather() {
    if (!navigator.geolocation) { setWeatherStatus("error"); return; }
    setWeatherStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const w = await fetchWeatherFor(pos.coords.latitude, pos.coords.longitude);
          setWeather(w);
          setWeatherStatus("ok");
        } catch (e) { setWeatherStatus("error"); }
      },
      () => setWeatherStatus("denied"),
      { timeout: 8000 }
    );
  }

  async function loadNewsBriefing() {
    setNewsStatus("loading");
    try {
      const text = await fetchNewsBriefing();
      setNewsText(text);
      setNewsStatus(text ? "ok" : "error");
    } catch (e) {
      setNewsStatus("error");
    }
  }

  // Diario: load once logged in
  useEffect(() => {
    if (!account) return;
    (async () => {
      try {
        const r = await storage.get(`${account.username}::diary`);
        if (r && r.value) setDiary(JSON.parse(r.value));
      } catch (e) { /* none yet */ }
      setDiaryLoaded(true);
    })();
  }, [account]);

  // Morning briefing — first time the app is opened each day, once data + weather trigger are ready
  useEffect(() => {
    if (!account || !loaded) return;
    (async () => {
      let last = null;
      try {
        const r = await storage.get(`${account.username}::lastBriefing`);
        last = r && r.value;
      } catch (e) { /* none yet */ }
      if (last !== todayISO()) {
        setShowBriefing(true);
        requestWeather();
        loadNewsBriefing();
        try { await storage.set(`${account.username}::lastBriefing`, todayISO()); } catch (e) { /* ignore */ }
      } else {
        requestWeather();
      }
    })();
  }, [account, loaded]);

  function addDiaryEntry() {
    if (!diaryText.trim()) return;
    if (editingDiaryId) {
      persistDiary(diary.map((d) => (d.id === editingDiaryId ? { ...d, text: diaryText } : d)));
      setEditingDiaryId(null);
    } else {
      persistDiary([{ id: Date.now() + Math.random().toString(36).slice(2), date: todayISO(), text: diaryText, createdAt: Date.now() }, ...diary]);
    }
    setDiaryText("");
  }
  function editDiaryEntry(d) { setEditingDiaryId(d.id); setDiaryText(d.text); setTab("diario"); }
  function deleteDiaryEntry(id) { persistDiary(diary.filter((d) => d.id !== id)); if (editingDiaryId === id) { setEditingDiaryId(null); setDiaryText(""); } }

  async function submitAuth() {
    const username = authForm.username.trim().toLowerCase();
    const { password, password2 } = authForm;
    setAuthError("");
    if (!username || !password) { setAuthError("Escribe usuario y contraseña."); return; }
    setAuthLoading(true);
    try {
      const accounts = await loadAccounts();
      if (authMode === "signup") {
        if (accounts[username]) { setAuthError("Ese usuario ya existe. Inicia sesión mejor."); setAuthLoading(false); return; }
        if (password.length < 4) { setAuthError("La contraseña debe tener al menos 4 caracteres."); setAuthLoading(false); return; }
        if (password !== password2) { setAuthError("Las contraseñas no coinciden."); setAuthLoading(false); return; }
        const passwordHash = await hashPassword(password);
        accounts[username] = { passwordHash, displayName: username };
        await saveAccounts(accounts);
        await storage.set("amara-session", username);
        notifyNewSignup(username);
        setAccount({ username, displayName: username });
        setPhase("name");
      } else {
        if (!accounts[username]) { setAuthError("No encontramos ese usuario. ¿Quieres crear una cuenta?"); setAuthLoading(false); return; }
        const passwordHash = await hashPassword(password);
        if (passwordHash !== accounts[username].passwordHash) { setAuthError("Contraseña incorrecta."); setAuthLoading(false); return; }
        await storage.set("amara-session", username);
        setAccount({ username, displayName: accounts[username].displayName || username });
        setPhase("app");
      }
    } catch (e) {
      setAuthError("No pudimos conectar en este momento. Intenta de nuevo.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function continueWithSession() {
    if (!sessionUser) { setPhase("auth"); return; }
    setAuthLoading(true);
    try {
      const accounts = await loadAccounts();
      if (accounts[sessionUser]) {
        setAccount({ username: sessionUser, displayName: accounts[sessionUser].displayName || sessionUser });
        setPhase("app");
      } else {
        setPhase("auth");
      }
    } catch (e) {
      setPhase("auth");
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitName() {
    if (!nameInput.trim() || !account) return;
    const displayName = nameInput.trim();
    try {
      const accounts = await loadAccounts();
      if (accounts[account.username]) { accounts[account.username].displayName = displayName; await saveAccounts(accounts); }
    } catch (e) { /* keep going even if this fails */ }
    setAccount((a) => ({ ...a, displayName }));
    setPhase("app");
  }

  async function logout() {
    try { await storage.delete("amara-session"); } catch (e) { /* ignore */ }
    setAccount(null);
    setSessionUser(null);
    setLoaded(false);
    setTodosLoaded(false);
    setGreeted(false);
    setEvents([]); setTodos([]); setContacts([]); setTemplates([]);
    setDiary([]); setDiaryLoaded(false); setDiaryText(""); setEditingDiaryId(null);
    setWeather(null); setWeatherStatus("idle"); setShowBriefing(false); setNewsText(""); setNewsStatus("idle");
    setChat([{ role: "assistant", text: "Bienvenida de nuevo. Soy Amara." }]);
    setAuthForm({ username: "", password: "", password2: "" });
    setAuthError("");
    setPhase("auth");
  }

  // Welcome sequence
  useEffect(() => {
    if (phase !== "welcome") return;
    const t1 = setTimeout(() => setWelcomePhase(1), 400);
    const t2 = setTimeout(() => setWelcomePhase(2), 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, chatLoading]);

  // Daily briefing — replaces the static welcome line once data is in
  useEffect(() => {
    if (!loaded || !todosLoaded || greeted || !account) return;
    const todayEvents = events.filter((e) => e.date === todayISO()).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
    const pending = todos.filter((t) => !t.done);
    let msg = `Bienvenida, ${account.displayName}. `;
    if (todayEvents.length === 0 && pending.length === 0) {
      msg += "Hoy no tienes eventos ni pendientes agendados. Dime si quieres agregar algo o redactar un mensaje.";
    } else {
      if (todayEvents.length > 0) {
        msg += `Hoy tienes ${todayEvents.length} ${todayEvents.length === 1 ? "evento" : "eventos"}: ` +
          todayEvents.map((e) => `${e.time ? e.time + " " : ""}${e.title}`).join(", ") + ". ";
      } else {
        msg += "Hoy no tienes eventos agendados. ";
      }
      if (pending.length > 0) {
        msg += `Tienes ${pending.length} ${pending.length === 1 ? "pendiente" : "pendientes"} sin marcar.`;
      }
    }
    setChat([{ role: "assistant", text: msg }]);
    setGreeted(true);
  }, [loaded, todosLoaded, greeted, events, todos, account]);

  function addTodo() {
    if (!newTodo.trim()) return;
    persistTodos([...todos, { id: Date.now() + Math.random().toString(36).slice(2), text: newTodo.trim(), done: false }]);
    setNewTodo("");
  }
  function toggleTodo(id) { persistTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t))); }
  function deleteTodo(id) { persistTodos(todos.filter((t) => t.id !== id)); }

  function addContact() {
    if (!newContact.name.trim()) return;
    persistContacts([...contacts, { id: Date.now() + Math.random().toString(36).slice(2), ...newContact }]);
    setNewContact({ name: "", tone: "cercano", notes: "" });
    setShowContactForm(false);
  }
  function deleteContact(id) { persistContacts(contacts.filter((c) => c.id !== id)); }

  function useContactInChat(c) {
    setTab("asistente");
    setChatInput(`Redacta un mensaje para ${c.name} (tono ${c.tone}${c.notes ? `, ${c.notes}` : ""}): `);
  }

  function saveCurrentAsTemplate() {
    if (!newTemplateTitle.trim() || !chatInput.trim()) return;
    persistTemplates([...templates, { id: Date.now() + Math.random().toString(36).slice(2), title: newTemplateTitle.trim(), text: chatInput }]);
    setNewTemplateTitle("");
    setShowSaveTemplate(false);
  }
  function useTemplate(t) { setChatInput(t.text); }
  function deleteTemplate(id) { persistTemplates(templates.filter((t) => t.id !== id)); }

  function speak(text, id) {
    if (!window.speechSynthesis) return;
    if (speaking === id) { window.speechSynthesis.cancel(); setSpeaking(null); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.onend = () => setSpeaking(null);
    u.onerror = () => setSpeaking(null);
    setSpeaking(id);
    window.speechSynthesis.speak(u);
  }

  function addEvent(e) {
    const withId = { ...e, id: e.id || (Date.now() + Math.random().toString(36).slice(2)) };
    persist([...events, withId]);
  }
  function deleteEvent(id) { persist(events.filter((e) => e.id !== id)); }

  function openAddModal(dateStr) {
    setForm({ title: "", date: dateStr || todayISO(), time: "", notes: "", category: "personal" });
    setShowModal(true);
  }

  function submitForm() {
    if (!form.title.trim() || !form.date) return;
    addEvent({ ...form });
    setShowModal(false);
  }

  async function handleDictateSubmit() {
    if (!dictate.trim()) return;
    setParsing(true);
    setParseError("");
    try {
      const system = `Eres un asistente que extrae un evento de calendario de un texto en español, dictado o pegado por la usuaria. Responde ÚNICAMENTE con un objeto JSON válido, sin backticks ni texto adicional, con este formato exacto:\n{"title": "string breve", "date": "YYYY-MM-DD", "time": "HH:MM en formato 24h o null", "notes": "string o null"}\nLa fecha de hoy es ${todayISO()}. Si no se menciona año, usa el actual. Si el texto describe varios detalles, resume lo esencial en "title" y pon el resto en "notes".`;
      const text = await callClaude([{ role: "user", content: dictate }], system);
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (!parsed.date) throw new Error("sin fecha");
      addEvent({ title: parsed.title || "Evento", date: parsed.date, time: parsed.time || "", notes: parsed.notes || "" });
      setCursor({ y: Number(parsed.date.slice(0,4)), m: Number(parsed.date.slice(5,7)) - 1 });
      setDictate("");
    } catch (e) {
      setParseError("No pude interpretar la fecha con claridad. Intenta con un formato como “junta el 22 de julio a las 5pm”.");
    } finally {
      setParsing(false);
    }
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const r = new SR();
    r.lang = "es-ES";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (ev) => { setDictate((prev) => (prev ? prev + " " : "") + ev.results[0][0].transcript); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    r.start();
    setListening(true);
  }

  function toggleChatMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (chatListening) { chatRecogRef.current?.stop(); setChatListening(false); return; }
    const r = new SR();
    r.lang = "es-ES";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (ev) => { setChatInput((prev) => (prev ? prev + " " : "") + ev.results[0][0].transcript); };
    r.onend = () => setChatListening(false);
    r.onerror = () => setChatListening(false);
    chatRecogRef.current = r;
    r.start();
    setChatListening(true);
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: "user", text: chatInput };
    const next = [...chat, userMsg];
    setChat(next);
    setChatInput("");
    setChatLoading(true);
    try {
      const contactsNote = contacts.length
        ? ` Contactos frecuentes de ${account?.displayName || "la usuaria"} y su tono habitual: ${contacts.map((c) => `${c.name} (${c.tone}${c.notes ? `, ${c.notes}` : ""})`).join("; ")}.`
        : "";
      const system = `Eres Amara, la asistente personal de ${account?.displayName || "la usuaria"}: elegante, cálida y eficiente. Ayudas a redactar mensajes (WhatsApp, correo, notas para su equipo) según lo que te indique — tono, destinatario, motivo. Responde en español.` + contactsNote +
        ` Antes de redactar, piensa brevemente y en privado cómo abordar la petición (tono adecuado, contexto, qué información falta, mejor estructura). Luego entrega la respuesta final.
Responde ÚNICAMENTE con este formato exacto, sin nada fuera de las etiquetas:
<razonamiento>2 a 4 líneas de análisis breve, en primera persona, sin repetir la petición completa</razonamiento>
<respuesta>tu respuesta final lista para copiar, sin explicaciones alrededor salvo que te las pidan explícitamente</respuesta>`;
      const apiMessages = next.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
      const raw = await callClaude(apiMessages, system);
      const reasonMatch = raw.match(/<razonamiento>([\s\S]*?)<\/razonamiento>/i);
      const answerMatch = raw.match(/<respuesta>([\s\S]*?)<\/respuesta>/i);
      const reasoning = reasonMatch ? reasonMatch[1].trim() : "";
      const answer = answerMatch ? answerMatch[1].trim() : raw.replace(/<\/?razonamiento>|<\/?respuesta>/gi, "").trim();
      setChat((c) => [...c, { role: "assistant", text: answer || "...", reasoning }]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", text: "No pude conectarme en este momento. ¿Lo intentamos de nuevo?" }]);
    } finally {
      setChatLoading(false);
    }
  }

  function copyText(t) { navigator.clipboard?.writeText(t); }

  // ---------- Calendar computations ----------
  const { y, m } = cursor;
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDate = {};
  events.forEach((e) => { (eventsByDate[e.date] = eventsByDate[e.date] || []).push(e); });

  const todayStr = todayISO();
  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []).sort((a,b)=>(a.time||"").localeCompare(b.time||"")) : [];

  const weekStart = (() => { const d = new Date(weekAnchor); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d; })();
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const pendingCount = todos.filter((t) => !t.done).length;

  return (
    <div style={{ minHeight: "100vh", background: "#F6F0E8", fontFamily: "'Jost', sans-serif", color: "#2A211C", position: "relative" }}>
      <style>{`
        @import url("${FONT_LINK}");
        * { box-sizing: border-box; }
        ::selection { background: #E7D3C4; }
        .serif { font-family: 'Cormorant Garamond', serif; }
        .fade-in { animation: fadeIn .9s ease forwards; opacity: 0; }
        @keyframes fadeIn { to { opacity: 1; } }
        .rise { animation: rise .9s cubic-bezier(.2,.7,.3,1) forwards; opacity: 0; transform: translateY(14px); }
        @keyframes rise { to { opacity: 1; transform: translateY(0); } }
        .hair { border: none; border-top: 1px solid rgba(176,141,87,0.35); }
        button { font-family: inherit; cursor: pointer; }
        input, textarea { font-family: inherit; }
        .day-cell:hover .day-num { color: #6E3B34; }
        .scrollbar::-webkit-scrollbar { width: 6px; }
        .scrollbar::-webkit-scrollbar-thumb { background: #D8C4AE; border-radius: 4px; }
        @media (max-width: 720px) {
          .rail-label { display: none; }
          .side-panel { display: none !important; }
        }
      `}</style>

      {phase === "welcome" && (
        <div style={{
          position: "fixed", inset: 0, background: "#F6F0E8", display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div className="fade-in" style={{ animationDelay: "0.1s" }}><Seal size={100} /></div>
          {welcomePhase >= 1 && (
            <div className="rise" style={{ textAlign: "center", marginTop: 28 }}>
              <div className="serif" style={{ fontSize: 15, letterSpacing: "0.35em", color: "#B08D57", textTransform: "uppercase" }}>Bienvenida</div>
              <div className="serif" style={{ fontSize: 44, fontStyle: "italic", color: "#6E3B34", marginTop: 6 }}>Amara</div>
              <div style={{ fontSize: 13, color: "#8a7d6e", marginTop: 10, letterSpacing: "0.03em" }}>tu asistente personal</div>
            </div>
          )}
          {welcomePhase >= 2 && (
            <button
              className="rise"
              onClick={continueWithSession}
              disabled={authLoading}
              style={{
                marginTop: 44, padding: "13px 46px", background: "transparent",
                border: "1px solid #6E3B34", color: "#6E3B34", borderRadius: 2,
                fontSize: 12, letterSpacing: "0.25em", textTransform: "uppercase",
                transition: "all .3s",
              }}
              onMouseEnter={(e)=>{e.currentTarget.style.background="#6E3B34";e.currentTarget.style.color="#F6F0E8";}}
              onMouseLeave={(e)=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#6E3B34";}}
            >
              Entrar
            </button>
          )}
        </div>
      )}

      {phase === "auth" && (
        <div style={{
          position: "fixed", inset: 0, background: "#F6F0E8", display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20,
        }}>
          <div className="rise"><Seal size={64} /></div>
          <div className="rise" style={{ width: 320, maxWidth: "100%", marginTop: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 22 }}>
              <div className="serif" style={{ fontSize: 26, fontStyle: "italic", color: "#6E3B34" }}>
                {authMode === "login" ? "Iniciar sesión" : "Crear tu cuenta"}
              </div>
              <div style={{ fontSize: 12, color: "#8a7d6e", marginTop: 6 }}>Cada quien guarda sus propios eventos, pendientes y contactos, aparte de los demás.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Usuario</label>
                <input value={authForm.username} onChange={(e) => setAuthForm((f) => ({ ...f, username: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") submitAuth(); }}
                  style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "10px 12px", fontSize: 13.5, marginTop: 4, background: "#FBF8F3" }} />
              </div>
              <div>
                <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Contraseña</label>
                <input type="password" value={authForm.password} onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") submitAuth(); }}
                  style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "10px 12px", fontSize: 13.5, marginTop: 4, background: "#FBF8F3" }} />
              </div>
              {authMode === "signup" && (
                <div>
                  <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Confirmar contraseña</label>
                  <input type="password" value={authForm.password2} onChange={(e) => setAuthForm((f) => ({ ...f, password2: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") submitAuth(); }}
                    style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "10px 12px", fontSize: 13.5, marginTop: 4, background: "#FBF8F3" }} />
                </div>
              )}
              {authError && <div style={{ fontSize: 12, color: "#93504a" }}>{authError}</div>}
              <button onClick={submitAuth} disabled={authLoading} style={{
                marginTop: 4, background: "#6E3B34", border: "none", borderRadius: 3, padding: "12px", color: "#F6F0E8",
                fontSize: 12.5, letterSpacing: "0.1em", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: authLoading ? 0.6 : 1,
              }}><Icon.Lock /> {authLoading ? "Un momento…" : authMode === "login" ? "Entrar" : "Crear cuenta"}</button>
              <button onClick={() => { setAuthMode((m) => (m === "login" ? "signup" : "login")); setAuthError(""); }} style={{
                background: "none", border: "none", color: "#B08D57", fontSize: 12, marginTop: 2,
              }}>
                {authMode === "login" ? "¿Primera vez? Crea una cuenta" : "¿Ya tienes cuenta? Inicia sesión"}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "name" && (
        <div style={{
          position: "fixed", inset: 0, background: "#F6F0E8", display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20,
        }}>
          <div className="rise"><Seal size={64} /></div>
          <div className="rise" style={{ width: 320, maxWidth: "100%", marginTop: 24, textAlign: "center" }}>
            <div className="serif" style={{ fontSize: 26, fontStyle: "italic", color: "#6E3B34" }}>¿Cómo te gustaría que te llamemos?</div>
            <div style={{ fontSize: 12, color: "#8a7d6e", marginTop: 8, marginBottom: 20 }}>Así te saludará Amara cada vez que entres.</div>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitName(); }}
              placeholder="Tu nombre"
              style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "11px 13px", fontSize: 14, textAlign: "center", background: "#FBF8F3" }} />
            <button onClick={submitName} disabled={!nameInput.trim()} style={{
              marginTop: 16, background: "#6E3B34", border: "none", borderRadius: 2, padding: "12px 40px", color: "#F6F0E8",
              fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", opacity: !nameInput.trim() ? 0.5 : 1,
            }}>Continuar</button>
          </div>
        </div>
      )}

      {phase === "app" && (
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <div style={{
            position: "fixed", top: 18, right: 24, zIndex: 30, display: "flex", alignItems: "center", gap: 10,
            background: "#FBF8F3", border: "1px solid rgba(176,141,87,0.35)", borderRadius: 20, padding: "6px 14px 6px 6px",
          }}>
            <button onClick={() => { setShowBriefing(true); if (newsStatus === "idle") loadNewsBriefing(); if (weatherStatus === "idle") requestWeather(); }}
              title="Ver resumen matutino" style={{
                width: 26, height: 26, borderRadius: "50%", background: "#E7D3C4", border: "none", color: "#6E3B34",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}><Icon.Sun /></button>
            <span style={{ fontSize: 12.5, color: "#4a4038" }}>
              {clock.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span style={{ width: 1, height: 12, background: "rgba(176,141,87,0.4)" }} />
            <span style={{ fontSize: 12.5, color: "#4a4038", display: "flex", alignItems: "center", gap: 4 }}>
              {weatherStatus === "ok" && weather ? (<>{weather.temp}° <span style={{ color: "#8a7d6e" }} className="rail-label">{weatherLabel(weather.code)}</span></>) :
               weatherStatus === "loading" ? "…" :
               weatherStatus === "denied" ? <span style={{ color: "#8a7d6e" }}>Sin ubicación</span> :
               <button onClick={requestWeather} style={{ background: "none", border: "none", color: "#B08D57", fontSize: 11.5 }}>Ver clima</button>}
            </span>
          </div>
          {/* Rail nav */}
          <div style={{
            width: 84, borderRight: "1px solid rgba(176,141,87,0.25)", display: "flex",
            flexDirection: "column", alignItems: "center", paddingTop: 26, gap: 6, flexShrink: 0,
          }}>
            <div style={{ marginBottom: 22 }}><Seal size={40} /></div>
            {[
              { id: "calendar", label: "Calendario", Ic: Icon.Calendar },
              { id: "pendientes", label: "Pendientes", Ic: Icon.Check },
              { id: "asistente", label: "Amara", Ic: Icon.Chat },
              { id: "diario", label: "Diario", Ic: Icon.Book },
              { id: "contactos", label: "Contactos", Ic: Icon.User },
            ].map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                width: 64, padding: "10px 4px", background: tab === t.id ? "#E7D3C4" : "transparent",
                border: "none", borderRadius: 3, color: tab === t.id ? "#6E3B34" : "#8a7d6e",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                transition: "all .25s", position: "relative",
              }}>
                <t.Ic />
                {t.id === "pendientes" && pendingCount > 0 && (
                  <span style={{
                    position: "absolute", top: 6, right: 10, background: "#6E3B34", color: "#F6F0E8",
                    fontSize: 9, borderRadius: "50%", width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{pendingCount}</span>
                )}
                <span className="rail-label" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.label}</span>
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <div className="rail-label" style={{ fontSize: 10, color: "#8a7d6e", textAlign: "center", padding: "0 6px 6px", maxWidth: 76, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {account?.displayName}
            </div>
            <button onClick={logout} title="Cerrar sesión" style={{
              width: 64, padding: "8px 4px 20px", background: "none", border: "none", color: "#8a7d6e",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            }}>
              <Icon.Logout />
              <span className="rail-label" style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}>Salir</span>
            </button>
          </div>

          {/* Main content */}
          <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
            {tab === "calendar" && (
              <>
                <div style={{ flex: 1, padding: "34px 40px", minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#B08D57", textTransform: "uppercase" }}>Calendario</div>
                      <div className="serif" style={{ fontSize: 34, fontStyle: "italic", color: "#6E3B34" }}>
                        {viewMode === "month" ? (
                          <>{MONTHS_ES[m]} <span style={{ fontStyle: "normal", color: "#2A211C" }}>{y}</span></>
                        ) : (
                          <>{weekDays[0].getDate()} – {weekDays[6].getDate()} <span style={{ fontStyle: "normal", color: "#2A211C" }}>{MONTHS_ES[weekDays[6].getMonth()]}</span></>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", border: "1px solid rgba(176,141,87,.4)", borderRadius: 2, overflow: "hidden" }}>
                        <button onClick={() => setViewMode("month")} style={{ background: viewMode === "month" ? "#6E3B34" : "none", color: viewMode === "month" ? "#F6F0E8" : "#6E3B34", border: "none", padding: "7px 12px", fontSize: 11, letterSpacing: "0.08em" }}>Mes</button>
                        <button onClick={() => setViewMode("week")} style={{ background: viewMode === "week" ? "#6E3B34" : "none", color: viewMode === "week" ? "#F6F0E8" : "#6E3B34", border: "none", padding: "7px 12px", fontSize: 11, letterSpacing: "0.08em" }}>Semana</button>
                      </div>
                      {viewMode === "month" ? (
                        <>
                          <button onClick={() => setCursor((c) => { const nm = c.m - 1; return nm < 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: nm }; })}
                            style={{ background: "none", border: "1px solid rgba(176,141,87,.4)", borderRadius: 2, padding: "7px 12px", color: "#6E3B34" }}>‹</button>
                          <button onClick={() => setCursor({ y: new Date().getFullYear(), m: new Date().getMonth() })}
                            style={{ background: "none", border: "1px solid rgba(176,141,87,.4)", borderRadius: 2, padding: "7px 12px", fontSize: 11, letterSpacing: "0.1em", color: "#6E3B34", textTransform: "uppercase" }}>Hoy</button>
                          <button onClick={() => setCursor((c) => { const nm = c.m + 1; return nm > 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: nm }; })}
                            style={{ background: "none", border: "1px solid rgba(176,141,87,.4)", borderRadius: 2, padding: "7px 12px", color: "#6E3B34" }}>›</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setWeekAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
                            style={{ background: "none", border: "1px solid rgba(176,141,87,.4)", borderRadius: 2, padding: "7px 12px", color: "#6E3B34" }}>‹</button>
                          <button onClick={() => setWeekAnchor(new Date())}
                            style={{ background: "none", border: "1px solid rgba(176,141,87,.4)", borderRadius: 2, padding: "7px 12px", fontSize: 11, letterSpacing: "0.1em", color: "#6E3B34", textTransform: "uppercase" }}>Hoy</button>
                          <button onClick={() => setWeekAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
                            style={{ background: "none", border: "1px solid rgba(176,141,87,.4)", borderRadius: 2, padding: "7px 12px", color: "#6E3B34" }}>›</button>
                        </>
                      )}
                      <button onClick={() => openAddModal(selectedDate || todayStr)}
                        style={{ background: "#6E3B34", border: "none", borderRadius: 2, padding: "8px 16px", color: "#F6F0E8", fontSize: 12, letterSpacing: "0.1em", display: "flex", gap: 6, alignItems: "center" }}>
                        <Icon.Plus /> Añadir
                      </button>
                    </div>
                  </div>

                  <hr className="hair" style={{ margin: "20px 0 18px" }} />

                  {viewMode === "month" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, background: "rgba(176,141,87,0.2)", border: "1px solid rgba(176,141,87,0.2)" }}>
                    {DAYS_ES.map((d, i) => (
                      <div key={i} style={{ background: "#F6F0E8", textAlign: "center", padding: "8px 0", fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>{d}</div>
                    ))}
                    {cells.map((d, i) => {
                      if (d === null) return <div key={i} style={{ background: "#F6F0E8", minHeight: 92 }} />;
                      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                      const isToday = dateStr === todayStr;
                      const isSel = dateStr === selectedDate;
                      const dayEvents = eventsByDate[dateStr] || [];
                      return (
                        <div key={i} className="day-cell" onClick={() => setSelectedDate(dateStr)}
                          style={{
                            background: isSel ? "#EFE2D3" : "#F6F0E8", minHeight: 92, padding: "8px 8px", cursor: "pointer",
                            position: "relative", transition: "background .2s",
                          }}>
                          <div className="day-num" style={{
                            fontSize: 13, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                            borderRadius: "50%", background: isToday ? "#6E3B34" : "transparent", color: isToday ? "#F6F0E8" : "#4a4038",
                          }}>{d}</div>
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                            {dayEvents.slice(0, 3).map((ev) => {
                              const c = catInfo(ev.category);
                              return (
                              <div key={ev.id} style={{ fontSize: 10.5, background: c.bg, color: c.color, borderRadius: 2, padding: "2px 5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {ev.time ? `${ev.time} · ` : ""}{ev.title}
                              </div>
                            );})}
                            {dayEvents.length > 3 && <div style={{ fontSize: 9.5, color: "#B08D57" }}>+{dayEvents.length - 3} más</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, background: "rgba(176,141,87,0.2)", border: "1px solid rgba(176,141,87,0.2)" }}>
                    {weekDays.map((d, i) => {
                      const dateStr = toISO(d);
                      const isToday = dateStr === todayStr;
                      const dayEvents = (eventsByDate[dateStr] || []).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
                      return (
                        <div key={i} onClick={() => setSelectedDate(dateStr)} style={{ background: "#F6F0E8", minHeight: 260, padding: "10px 8px", cursor: "pointer" }}>
                          <div style={{ textAlign: "center", marginBottom: 8 }}>
                            <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "#B08D57", textTransform: "uppercase" }}>{DAYS_ES[i]}</div>
                            <div style={{
                              fontSize: 14, width: 24, height: 24, margin: "3px auto 0", display: "flex", alignItems: "center", justifyContent: "center",
                              borderRadius: "50%", background: isToday ? "#6E3B34" : "transparent", color: isToday ? "#F6F0E8" : "#4a4038",
                            }}>{d.getDate()}</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {dayEvents.map((ev) => {
                              const c = catInfo(ev.category);
                              return (
                                <div key={ev.id} style={{ fontSize: 10.5, background: c.bg, color: c.color, borderRadius: 2, padding: "4px 6px" }}>
                                  {ev.time && <div style={{ fontSize: 9.5, opacity: 0.85 }}>{ev.time}</div>}
                                  <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ev.title}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}

                  <div style={{ marginTop: 26, background: "#FBF8F3", border: "1px solid rgba(176,141,87,0.25)", borderRadius: 3, padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                      <Icon.Calendar style={{ color: "#B08D57" }} />
                      <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#B08D57", textTransform: "uppercase" }}>Conectar con tu iPhone</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
                      <div style={{ fontSize: 12.5, color: "#5c5044", lineHeight: 1.6, maxWidth: 460 }}>
                        Descarga tus eventos actuales e impórtalos una vez en Calendario de Apple — quedan ahí con sus notificaciones normales de iPhone.
                      </div>
                      <button onClick={() => downloadICS(events)} style={{
                        background: "none", border: "1px solid #6E3B34", color: "#6E3B34", borderRadius: 2,
                        padding: "8px 14px", fontSize: 11.5, letterSpacing: "0.08em", display: "flex", gap: 7, alignItems: "center", whiteSpace: "nowrap",
                      }}><Icon.Download /> Exportar a Apple Calendar (.ics)</button>
                    </div>
                    <hr className="hair" style={{ margin: "14px 0" }} />
                    <div style={{ fontSize: 12, color: "#8a7d6e", lineHeight: 1.6 }}>
                      <strong style={{ color: "#6E3B34", fontWeight: 500 }}>Sincronización automática</strong> — para que cada evento nuevo aparezca solo en tu iPhone (sin exportar a mano), Amara necesita vivir en una dirección web propia que tu iPhone pueda "seguir" (una suscripción webcal). Esto requiere publicar la app en un servidor — con tu cuenta de Vercel ya conectada, puedo ayudarte a montarlo cuando quieras.
                    </div>
                  </div>
                </div>

                {/* Side panel: dictate + day agenda */}
                <div className="side-panel scrollbar" style={{ width: 340, borderLeft: "1px solid rgba(176,141,87,0.25)", padding: "34px 26px", overflowY: "auto", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#B08D57", textTransform: "uppercase", marginBottom: 8 }}>Dictar o pegar</div>
                  <div style={{ fontSize: 12, color: "#8a7d6e", marginBottom: 10, lineHeight: 1.5 }}>Describe el evento en tus palabras — Amara lo agenda por ti.</div>
                  <textarea
                    value={dictate}
                    onChange={(e) => setDictate(e.target.value)}
                    placeholder="Ej. Junta con Humberto el 22 de julio a las 5pm sobre Lumar"
                    rows={4}
                    style={{
                      width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: 10,
                      fontSize: 13, resize: "vertical", background: "#FBF8F3", color: "#2A211C",
                    }}
                  />
                  {parseError && <div style={{ color: "#93504a", fontSize: 11.5, marginTop: 6 }}>{parseError}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
                      <button onClick={toggleMic} style={{
                        border: "1px solid rgba(176,141,87,0.5)", background: listening ? "#E7D3C4" : "none",
                        color: "#6E3B34", borderRadius: 2, padding: "9px 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5,
                      }}><Icon.Mic /> {listening ? "Escuchando…" : "Dictar"}</button>
                    )}
                    <button onClick={handleDictateSubmit} disabled={parsing || !dictate.trim()} style={{
                      flex: 1, background: "#6E3B34", border: "none", borderRadius: 2, padding: "9px 12px",
                      color: "#F6F0E8", fontSize: 11.5, letterSpacing: "0.08em", opacity: parsing || !dictate.trim() ? 0.5 : 1,
                    }}>{parsing ? "Agendando…" : "Agendar"}</button>
                  </div>

                  <hr className="hair" style={{ margin: "26px 0" }} />

                  <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#B08D57", textTransform: "uppercase", marginBottom: 10 }}>
                    {selectedDate ? new Date(selectedDate + "T00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "Selecciona un día"}
                  </div>
                  {selectedDate && selectedEvents.length === 0 && (
                    <div style={{ fontSize: 12.5, color: "#8a7d6e" }}>Sin eventos. Añade uno con el botón “Añadir”.</div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {selectedEvents.map((ev) => {
                      const c = catInfo(ev.category);
                      return (
                      <div key={ev.id} style={{ border: "1px solid rgba(176,141,87,0.3)", borderRadius: 3, padding: "10px 12px", background: "#FBF8F3" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.color, display: "inline-block" }} />
                              <div style={{ fontSize: 13.5, color: "#2A211C" }}>{ev.title}</div>
                            </div>
                            {ev.time && <div style={{ fontSize: 11, color: "#B08D57", marginTop: 2 }}>{ev.time}</div>}
                            {ev.notes && <div style={{ fontSize: 11.5, color: "#8a7d6e", marginTop: 4 }}>{ev.notes}</div>}
                          </div>
                          <button onClick={() => deleteEvent(ev.id)} style={{ background: "none", border: "none", color: "#B08D57" }}><Icon.Trash /></button>
                        </div>
                      </div>
                    );})}
                  </div>
                </div>
              </>
            )}

            {tab === "pendientes" && (
              <div style={{ flex: 1, maxWidth: 640, margin: "0 auto", width: "100%", padding: "34px 40px" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#B08D57", textTransform: "uppercase" }}>Pendientes</div>
                <div className="serif" style={{ fontSize: 34, fontStyle: "italic", color: "#6E3B34" }}>Recordatorios rápidos</div>
                <hr className="hair" style={{ margin: "20px 0 22px" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={newTodo}
                    onChange={(e) => setNewTodo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addTodo(); }}
                    placeholder="Ej. Llamar a Beto sobre la constructora"
                    style={{ flex: 1, border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "11px 13px", fontSize: 13.5, background: "#FBF8F3" }}
                  />
                  <button onClick={addTodo} style={{ background: "#6E3B34", border: "none", borderRadius: 3, padding: "0 18px", color: "#F6F0E8", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon.Plus /> Añadir
                  </button>
                </div>

                <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                  {todos.filter((t) => !t.done).length === 0 && todos.filter((t) => t.done).length === 0 && (
                    <div style={{ fontSize: 13, color: "#8a7d6e", textAlign: "center", padding: "30px 0" }}>Sin pendientes por ahora. Cualquier cosa sin fecha fija va aquí.</div>
                  )}
                  {todos.filter((t) => !t.done).map((t) => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(176,141,87,0.3)", borderRadius: 3, padding: "10px 13px", background: "#FBF8F3" }}>
                      <button onClick={() => toggleTodo(t.id)} style={{
                        width: 19, height: 19, borderRadius: 4, border: "1.4px solid #B08D57", background: "none", flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, fontSize: 13.5 }}>{t.text}</div>
                      <button onClick={() => deleteTodo(t.id)} style={{ background: "none", border: "none", color: "#B08D57" }}><Icon.Trash /></button>
                    </div>
                  ))}
                  {todos.filter((t) => t.done).length > 0 && (
                    <>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.2em", color: "#B08D57", textTransform: "uppercase", marginTop: 14 }}>Completados</div>
                      {todos.filter((t) => t.done).map((t) => (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(176,141,87,0.2)", borderRadius: 3, padding: "10px 13px", opacity: 0.55 }}>
                          <button onClick={() => toggleTodo(t.id)} style={{
                            width: 19, height: 19, borderRadius: 4, border: "1.4px solid #6E3B34", background: "#6E3B34",
                            display: "flex", alignItems: "center", justifyContent: "center", color: "#F6F0E8", flexShrink: 0,
                          }}><Icon.CheckSm /></button>
                          <div style={{ flex: 1, fontSize: 13.5, textDecoration: "line-through" }}>{t.text}</div>
                          <button onClick={() => deleteTodo(t.id)} style={{ background: "none", border: "none", color: "#B08D57" }}><Icon.Trash /></button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {tab === "diario" && (
              <div style={{ flex: 1, maxWidth: 680, margin: "0 auto", width: "100%", padding: "34px 40px" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#B08D57", textTransform: "uppercase" }}>Diario</div>
                <div className="serif" style={{ fontSize: 34, fontStyle: "italic", color: "#6E3B34" }}>Tu espacio para escribir</div>
                <hr className="hair" style={{ margin: "20px 0 20px" }} />

                <div style={{ border: "1px solid rgba(176,141,87,0.3)", borderRadius: 3, padding: 16, background: "#FBF8F3" }}>
                  <textarea
                    value={diaryText}
                    onChange={(e) => setDiaryText(e.target.value)}
                    placeholder="Escribe lo que quieras dejar aquí hoy…"
                    rows={5}
                    style={{ width: "100%", border: "none", background: "transparent", fontSize: 14, lineHeight: 1.7, resize: "vertical", outline: "none" }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                    {editingDiaryId && (
                      <button onClick={() => { setEditingDiaryId(null); setDiaryText(""); }} style={{ background: "none", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 2, padding: "8px 14px", color: "#6E3B34", fontSize: 11.5 }}>Cancelar</button>
                    )}
                    <button onClick={addDiaryEntry} disabled={!diaryText.trim()} style={{
                      background: "#6E3B34", border: "none", borderRadius: 2, padding: "8px 18px", color: "#F6F0E8", fontSize: 11.5, letterSpacing: "0.08em",
                      opacity: !diaryText.trim() ? 0.5 : 1,
                    }}>{editingDiaryId ? "Guardar cambios" : "Guardar entrada"}</button>
                  </div>
                </div>

                <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 14 }}>
                  {diaryLoaded && diary.length === 0 && (
                    <div style={{ fontSize: 13, color: "#8a7d6e", textAlign: "center", padding: "24px 0" }}>Aún no has escrito nada. Este espacio queda solo para ti.</div>
                  )}
                  {diary.map((d) => (
                    <div key={d.id} style={{ borderLeft: "2px solid #E7D3C4", paddingLeft: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <div className="serif" style={{ fontSize: 14, fontStyle: "italic", color: "#B08D57" }}>
                          {new Date(d.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <button onClick={() => editDiaryEntry(d)} style={{ background: "none", border: "none", color: "#B08D57", fontSize: 11 }}>Editar</button>
                          <button onClick={() => deleteDiaryEntry(d.id)} style={{ background: "none", border: "none", color: "#B08D57" }}><Icon.Trash /></button>
                        </div>
                      </div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.7, marginTop: 4, whiteSpace: "pre-wrap" }}>{d.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "contactos" && (
              <div style={{ flex: 1, maxWidth: 640, margin: "0 auto", width: "100%", padding: "34px 40px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#B08D57", textTransform: "uppercase" }}>Contactos</div>
                    <div className="serif" style={{ fontSize: 34, fontStyle: "italic", color: "#6E3B34" }}>Frecuentes</div>
                  </div>
                  <button onClick={() => setShowContactForm((s) => !s)} style={{ background: "#6E3B34", border: "none", borderRadius: 2, padding: "8px 16px", color: "#F6F0E8", fontSize: 12, letterSpacing: "0.1em", display: "flex", gap: 6, alignItems: "center" }}>
                    <Icon.Plus /> Añadir
                  </button>
                </div>
                <hr className="hair" style={{ margin: "20px 0 22px" }} />

                {showContactForm && (
                  <div style={{ border: "1px solid rgba(176,141,87,0.3)", borderRadius: 3, padding: 16, marginBottom: 20, background: "#FBF8F3" }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))}
                        placeholder="Nombre" style={{ flex: "1 1 160px", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 11px", fontSize: 13.5, background: "#F6F0E8" }} />
                      <select value={newContact.tone} onChange={(e) => setNewContact((c) => ({ ...c, tone: e.target.value }))}
                        style={{ border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 11px", fontSize: 13.5, background: "#F6F0E8", color: "#2A211C" }}>
                        <option value="cercano">Cercano</option>
                        <option value="formal">Formal</option>
                        <option value="directo">Directo</option>
                        <option value="cálido">Cálido</option>
                      </select>
                    </div>
                    <input value={newContact.notes} onChange={(e) => setNewContact((c) => ({ ...c, notes: e.target.value }))}
                      placeholder="Notas (ej. equipo Nogalia, prefiere WhatsApp)" style={{ width: "100%", marginTop: 10, border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 11px", fontSize: 13.5, background: "#F6F0E8" }} />
                    <button onClick={addContact} style={{ marginTop: 12, background: "#6E3B34", border: "none", borderRadius: 3, padding: "9px 16px", color: "#F6F0E8", fontSize: 12 }}>Guardar contacto</button>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {contacts.length === 0 && <div style={{ fontSize: 13, color: "#8a7d6e", textAlign: "center", padding: "20px 0" }}>Aún no guardas contactos. Añade a quien le escribes seguido, con su tono habitual.</div>}
                  {contacts.map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(176,141,87,0.3)", borderRadius: 3, padding: "12px 14px", background: "#FBF8F3" }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: "50%", background: "#E7D3C4", color: "#6E3B34",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
                      }} className="serif">{c.name.charAt(0).toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: "#B08D57" }}>{c.tone}{c.notes ? ` · ${c.notes}` : ""}</div>
                      </div>
                      <button onClick={() => useContactInChat(c)} style={{ background: "none", border: "1px solid rgba(176,141,87,0.5)", color: "#6E3B34", borderRadius: 2, padding: "6px 11px", fontSize: 11 }}>Escribirle</button>
                      <button onClick={() => deleteContact(c.id)} style={{ background: "none", border: "none", color: "#B08D57" }}><Icon.Trash /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "asistente" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 760, margin: "0 auto", width: "100%", padding: "34px 40px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Seal size={44} />
                  <div>
                    <div className="serif" style={{ fontSize: 26, fontStyle: "italic", color: "#6E3B34" }}>Amara</div>
                    <div style={{ fontSize: 12, color: "#8a7d6e" }}>Piensa paso a paso antes de responder, y redacta mensajes, correos y avisos con tus indicaciones</div>
                  </div>
                </div>
                <hr className="hair" style={{ margin: "18px 0" }} />
                <div className="scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingBottom: 12 }}>
                  {chat.map((c, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: c.role === "user" ? "flex-end" : "flex-start" }}>
                      <div style={{
                        maxWidth: "78%", background: c.role === "user" ? "#6E3B34" : "#FBF8F3",
                        color: c.role === "user" ? "#F6F0E8" : "#2A211C",
                        border: c.role === "user" ? "none" : "1px solid rgba(176,141,87,0.3)",
                        borderRadius: 4, padding: "12px 15px", fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap",
                      }}>
                        {c.reasoning && (
                          <div style={{ marginBottom: 8 }}>
                            <button onClick={() => setExpandedReasoning((s) => ({ ...s, [i]: !s[i] }))} style={{
                              background: "none", border: "none", color: "#B08D57", fontSize: 10.5, display: "inline-flex", gap: 4, alignItems: "center", padding: 0,
                            }}><Icon.Brain /> {expandedReasoning[i] ? "Ocultar razonamiento" : "Ver razonamiento"}</button>
                            {expandedReasoning[i] && (
                              <div className="serif" style={{ fontStyle: "italic", fontSize: 12, color: "#8a7d6e", marginTop: 5, lineHeight: 1.5, borderLeft: "2px solid #E7D3C4", paddingLeft: 10 }}>
                                {c.reasoning}
                              </div>
                            )}
                          </div>
                        )}
                        {c.text}
                        {c.role === "assistant" && i > 0 && (
                          <div style={{ marginTop: 8, textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 14 }}>
                            {window.speechSynthesis && (
                              <button onClick={() => speak(c.text, i)} style={{ background: "none", border: "none", color: "#B08D57", fontSize: 10.5, display: "inline-flex", gap: 4, alignItems: "center" }}>
                                <Icon.Speaker /> {speaking === i ? "Detener" : "Escuchar"}
                              </button>
                            )}
                            <button onClick={() => copyText(c.text)} style={{ background: "none", border: "none", color: "#B08D57", fontSize: 10.5, display: "inline-flex", gap: 4, alignItems: "center" }}>
                              <Icon.Copy /> Copiar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {chatLoading && <div style={{ fontSize: 12.5, color: "#B08D57", fontStyle: "italic" }} className="serif">Amara está redactando…</div>}
                  <div ref={chatEndRef} />
                </div>

                {(templates.length > 0 || contacts.length > 0) && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, marginTop: 4 }}>
                    {contacts.slice(0, 5).map((c) => (
                      <button key={c.id} onClick={() => useContactInChat(c)} style={{
                        border: "1px solid rgba(176,141,87,0.4)", background: "none", color: "#6E3B34",
                        borderRadius: 12, padding: "4px 11px", fontSize: 11, display: "flex", alignItems: "center", gap: 5,
                      }}><Icon.User style={{ width: 11, height: 11 }} />{c.name}</button>
                    ))}
                    {templates.map((t) => (
                      <button key={t.id} onClick={() => useTemplate(t)} style={{
                        border: "1px solid rgba(176,141,87,0.4)", background: "#E7D3C4", color: "#6E3B34",
                        borderRadius: 12, padding: "4px 11px", fontSize: 11, display: "flex", alignItems: "center", gap: 5,
                      }}><Icon.Bookmark style={{ width: 11, height: 11 }} />{t.title}
                        <span onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }} style={{ marginLeft: 2, opacity: 0.6 }}>×</span>
                      </button>
                    ))}
                  </div>
                )}

                {showSaveTemplate && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input value={newTemplateTitle} onChange={(e) => setNewTemplateTitle(e.target.value)} placeholder="Nombre de la plantilla (ej. Reporte mensual)"
                      style={{ flex: 1, border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 12px", fontSize: 12.5, background: "#FBF8F3" }} />
                    <button onClick={saveCurrentAsTemplate} style={{ background: "#6E3B34", border: "none", borderRadius: 3, padding: "0 14px", color: "#F6F0E8", fontSize: 11.5 }}>Guardar</button>
                    <button onClick={() => setShowSaveTemplate(false)} style={{ background: "none", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "0 12px", color: "#6E3B34", fontSize: 11.5 }}>Cancelar</button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
                    <button onClick={toggleChatMic} title="Dictar" style={{
                      border: "1px solid rgba(176,141,87,0.5)", background: chatListening ? "#E7D3C4" : "none",
                      color: "#6E3B34", borderRadius: 3, padding: "0 14px", display: "flex", alignItems: "center", flexShrink: 0,
                    }}><Icon.Mic /></button>
                  )}
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                    placeholder={chatListening ? "Escuchando…" : "Redacta un mensaje para… / pídeme que responda a…"}
                    style={{ flex: 1, border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "12px 14px", fontSize: 13.5, background: "#FBF8F3" }}
                  />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{
                    background: "#6E3B34", border: "none", borderRadius: 3, padding: "0 20px", color: "#F6F0E8", fontSize: 12.5, letterSpacing: "0.05em",
                    opacity: chatLoading || !chatInput.trim() ? 0.5 : 1,
                  }}>Enviar</button>
                  <button onClick={() => setShowSaveTemplate((s) => !s)} title="Guardar como plantilla" disabled={!chatInput.trim()} style={{
                    background: "none", border: "1px solid rgba(176,141,87,0.5)", color: "#6E3B34", borderRadius: 3, padding: "0 12px",
                    opacity: !chatInput.trim() ? 0.4 : 1, flexShrink: 0,
                  }}><Icon.Bookmark /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Morning briefing */}
      {showBriefing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(42,33,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 20 }}
          onClick={() => setShowBriefing(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F6F0E8", borderRadius: 4, padding: 32, width: 460, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", border: "1px solid rgba(176,141,87,0.3)" }} className="scrollbar">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#B08D57", textTransform: "uppercase" }}>
                  {clock.getHours() < 12 ? "Buenos días" : clock.getHours() < 19 ? "Buenas tardes" : "Buenas noches"}
                </div>
                <div className="serif" style={{ fontSize: 30, fontStyle: "italic", color: "#6E3B34" }}>{account?.displayName}</div>
              </div>
              <button onClick={() => setShowBriefing(false)} style={{ background: "none", border: "none", color: "#8a7d6e" }}><Icon.Close /></button>
            </div>

            <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 13, color: "#4a4038" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: "#B08D57" }}>Hora</span> {clock.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: "#B08D57" }}>Clima</span>
                {weatherStatus === "ok" && weather ? `${weather.temp}° · ${weatherLabel(weather.code)}` :
                 weatherStatus === "loading" ? "buscando…" :
                 weatherStatus === "denied" ? "activa la ubicación para verlo" : "—"}
              </div>
            </div>

            <hr className="hair" style={{ margin: "18px 0" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <Icon.Newspaper style={{ color: "#B08D57" }} />
              <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#B08D57", textTransform: "uppercase" }}>Mientras dormías</div>
            </div>
            {newsStatus === "loading" && <div className="serif" style={{ fontStyle: "italic", fontSize: 13, color: "#8a7d6e" }}>Amara está revisando las noticias de hoy…</div>}
            {newsStatus === "error" && <div style={{ fontSize: 12.5, color: "#93504a" }}>No pude buscar las noticias en este momento. <button onClick={loadNewsBriefing} style={{ background: "none", border: "none", color: "#6E3B34", textDecoration: "underline" }}>Reintentar</button></div>}
            {newsStatus === "ok" && (
              <div style={{ fontSize: 13.5, lineHeight: 1.8, color: "#2A211C", whiteSpace: "pre-wrap" }}>{newsText}</div>
            )}

            <button onClick={() => setShowBriefing(false)} style={{
              marginTop: 24, background: "#6E3B34", border: "none", borderRadius: 2, padding: "11px 30px", color: "#F6F0E8",
              fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase",
            }}>Comenzar el día</button>
          </div>
        </div>
      )}

      {/* Add event modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(42,33,28,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}
          onClick={() => setShowModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F6F0E8", borderRadius: 4, padding: 28, width: 380, maxWidth: "100%", border: "1px solid rgba(176,141,87,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div className="serif" style={{ fontSize: 22, fontStyle: "italic", color: "#6E3B34" }}>Nuevo evento</div>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "#8a7d6e" }}><Icon.Close /></button>
            </div>
            <hr className="hair" style={{ margin: "10px 0 16px" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Título</label>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 10px", fontSize: 13.5, marginTop: 4, background: "#FBF8F3" }} />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Fecha</label>
                  <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 10px", fontSize: 13.5, marginTop: 4, background: "#FBF8F3" }} />
                </div>
                <div style={{ width: 120 }}>
                  <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Hora</label>
                  <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                    style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 10px", fontSize: 13.5, marginTop: 4, background: "#FBF8F3" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Notas</label>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  style={{ width: "100%", border: "1px solid rgba(176,141,87,0.4)", borderRadius: 3, padding: "9px 10px", fontSize: 13.5, marginTop: 4, background: "#FBF8F3", resize: "vertical" }} />
              </div>
              <div>
                <label style={{ fontSize: 10.5, letterSpacing: "0.15em", color: "#B08D57", textTransform: "uppercase" }}>Categoría</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                  {CATEGORIES.map((c) => (
                    <button key={c.id} onClick={() => setForm((f) => ({ ...f, category: c.id }))} style={{
                      border: form.category === c.id ? `1.5px solid ${c.color}` : "1px solid rgba(176,141,87,0.3)",
                      background: form.category === c.id ? c.bg : "transparent", color: c.color,
                      borderRadius: 12, padding: "5px 11px", fontSize: 11,
                    }}>{c.label}</button>
                  ))}
                </div>
              </div>
              <button onClick={submitForm} style={{ marginTop: 6, background: "#6E3B34", border: "none", borderRadius: 3, padding: "11px", color: "#F6F0E8", fontSize: 12.5, letterSpacing: "0.1em" }}>
                Guardar evento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
