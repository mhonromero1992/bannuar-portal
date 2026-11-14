// react-native-blob-util in the showcase: files "open" without leaving the page
const fs = {
  dirs: { DocumentDir: '/documents', CacheDir: '/cache' },
  exists: async () => true, writeFile: async () => {}, unlink: async () => {}, mkdir: async () => {}, ls: async () => [],
};
const response = { path: () => '/cache/bannuar-files/payslip.pdf', info: () => ({ status: 200, headers: {} }), respInfo: { status: 200 } };
const api = {
  fs,
  config: () => ({ fetch: async () => { await new Promise((r) => setTimeout(r, 400)); return response; } }),
  fetch: async () => response,
  android: { actionViewIntent: async () => {} },
  ios: { previewDocument: () => {}, openDocument: () => {} },
};
export default api;
