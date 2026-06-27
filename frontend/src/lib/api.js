import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const TOKEN_KEY = "documind_token";
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

const client = axios.create({ baseURL: API, timeout: 180000 });

// Attach the bearer token to every request.
client.interceptors.request.use((cfg) => {
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// On 401, drop the token and bounce to login (unless already there).
client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      tokenStore.clear();
      const path = window.location.pathname;
      if (!path.startsWith("/login") && !path.startsWith("/register")) {
        window.location.href = "/login";
      }
    }
    // 402 = trial/subscription lapsed → send the user to the pricing page.
    if (err?.response?.status === 402 && !window.location.pathname.startsWith("/pricing")) {
      window.location.href = "/pricing";
    }
    return Promise.reject(err);
  }
);

// Normalize any axios/HTTP error into a displayable string. FastAPI 422s put an
// ARRAY of objects in `detail` (and 4xx can put an object) — passing that to a
// React renderer (toast/JSX) throws "objects are not valid as a React child"
// and white-screens the app. Always return a plain string.
export function apiError(e, fallback = "Something went wrong. Please try again.") {
  const d = e?.response?.data?.detail;
  if (typeof d === "string" && d.trim()) return d;
  if (Array.isArray(d)) {
    const msg = d
      .map((x) => (typeof x === "string" ? x : x?.msg))
      .filter(Boolean)
      .join("; ");
    if (msg) return msg;
  } else if (d && typeof d === "object" && (d.msg || d.message)) {
    return d.msg || d.message;
  }
  return fallback;
}

export const api = {
  // auth
  register: (payload) => client.post(`/auth/register`, payload).then(r => r.data),
  login: (payload) => client.post(`/auth/login`, payload).then(r => r.data),
  googleLogin: (credential, company_name) =>
    client.post(`/auth/google`, { credential, company_name }).then(r => r.data),
  me: () => client.get(`/auth/me`).then(r => r.data),
  forgotPassword: (email) => client.post(`/auth/forgot-password`, { email }).then(r => r.data),
  resetPassword: (token, password) => client.post(`/auth/reset-password`, { token, password }).then(r => r.data),

  // billing
  billingPlans: () => client.get(`/billing/plans`).then(r => r.data),
  subscription: () => client.get(`/billing/subscription`).then(r => r.data),
  checkout: (plan_id) => client.post(`/billing/checkout`, { plan_id }).then(r => r.data),
  verifyPayment: (payload) => client.post(`/billing/verify`, payload).then(r => r.data),

  // catalog & stats
  catalog: () => client.get(`/catalog`).then(r => r.data),
  stats: () => client.get(`/stats`).then(r => r.data),

  // generation
  generate: (payload) => client.post(`/generate`, payload).then(r => r.data),
  completeness: (payload) => client.post(`/completeness`, payload).then(r => r.data),

  // pipeline
  pipelineGenerate: (source_id, target_type, industry) =>
    client.post(`/pipeline/generate`, { source_id, target_type, industry }).then(r => r.data),

  // documents
  listDocuments: (params = {}) => client.get(`/documents`, { params }).then(r => r.data),
  getDocument: (id) => client.get(`/documents/${id}`).then(r => r.data),
  updateDocument: (id, payload) => client.patch(`/documents/${id}`, payload).then(r => r.data),
  deleteDocument: (id) => client.delete(`/documents/${id}`).then(r => r.data),
  duplicateDocument: (id) => client.post(`/documents/${id}/duplicate`).then(r => r.data),
  listVersions: (id) => client.get(`/documents/${id}/versions`).then(r => r.data),
  createNewVersion: (id) => client.post(`/documents/${id}/versions`).then(r => r.data),
  improveSection: (id, section_index) => client.post(`/documents/${id}/improve`, { section_index }).then(r => r.data),

  // interview
  interviewStart: (type, industry) => client.post(`/interview/start`, { type, industry }).then(r => r.data),
  interviewMessage: (conv_id, answer) => client.post(`/interview/${conv_id}/message`, { answer }).then(r => r.data),
  interviewGenerate: (conv_id) => client.post(`/interview/${conv_id}/generate`).then(r => r.data),

  // reviewer
  reviewUpload: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return client.post(`/review/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
  },
  listReviews: () => client.get(`/reviews`).then(r => r.data),
  getReview: (id) => client.get(`/reviews/${id}`).then(r => r.data),
  deleteReview: (id) => client.delete(`/reviews/${id}`).then(r => r.data),

  // templates
  listTemplates: () => client.get(`/templates`).then(r => r.data),
  uploadTemplate: (file, fields) => {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v ?? ""));
    return client.post(`/templates`, fd, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
  },
  deleteTemplate: (id) => client.delete(`/templates/${id}`).then(r => r.data),

  // settings
  getSettings: () => client.get(`/settings`).then(r => r.data),
  updateSettings: (payload) => client.put(`/settings`, payload).then(r => r.data),

  // export — POST (so client-rendered diagram images can be embedded), fetch
  // as an authenticated blob and trigger a download.
  downloadDocx: async (id, { template_id, sections } = {}) => {
    const res = await client.post(`/export/docx/${id}`, { template_id, sections }, { responseType: "blob" });
    const cd = res.headers["content-disposition"] || "";
    const match = /filename="?([^"]+)"?/.exec(cd);
    const filename = match ? match[1] : "document.docx";
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};
