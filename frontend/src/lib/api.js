import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 180000 });

export const api = {
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

  // export
  docxUrl: (id, template_id) => {
    const qs = template_id ? `?template_id=${template_id}` : "";
    return `${API}/export/docx/${id}${qs}`;
  },
};
