// react-native-keychain in the browser: localStorage (the showcase only; the app encrypts on the phone)
const KEY = (s) => `showcase.keychain.${s || 'default'}`;
const store = {
  get: (s) => { try { return JSON.parse(localStorage.getItem(KEY(s))); } catch { return null; } },
  set: (s, v) => localStorage.setItem(KEY(s), JSON.stringify(v)),
  del: (s) => localStorage.removeItem(KEY(s)),
  all: () => Object.keys(localStorage).filter((k) => k.startsWith('showcase.keychain.')).map((k) => k.slice('showcase.keychain.'.length)),
};
const tokens = new Proxy({}, { get: (_, k) => String(k) });
export const ACCESSIBLE = tokens;
export const STORAGE_TYPE = tokens;
export const ACCESS_CONTROL = tokens;
export const AUTHENTICATION_TYPE = tokens;
export const SECURITY_LEVEL = tokens;
export const BIOMETRY_TYPE = tokens;
export async function getGenericPassword(o = {}) { const v = store.get(o.service); return v ? { username: v.u, password: v.p, service: o.service } : false; }
export async function setGenericPassword(u, p, o = {}) { store.set(o.service, { u, p }); return { service: o.service, storage: 'web' }; }
export async function resetGenericPassword(o = {}) { store.del(o.service); return true; }
export async function hasGenericPassword(o = {}) { return Boolean(store.get(o.service)); }
export async function getAllGenericPasswordServices() { return store.all(); }
export async function isPasscodeAuthAvailable() { return true; }
export async function getSupportedBiometryType() { return 'FaceID'; }
export async function canImplyAuthentication() { return true; }
const api = { ACCESSIBLE, STORAGE_TYPE, ACCESS_CONTROL, AUTHENTICATION_TYPE, SECURITY_LEVEL, BIOMETRY_TYPE, getGenericPassword, setGenericPassword, resetGenericPassword, hasGenericPassword, getAllGenericPasswordServices, isPasscodeAuthAvailable, getSupportedBiometryType, canImplyAuthentication };
export default api;
