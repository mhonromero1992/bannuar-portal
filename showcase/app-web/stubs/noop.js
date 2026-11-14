// Phone-only modules with nothing to do in the browser (push, notifications, splash screen): every
// call resolves quietly. Named constants come back as their own names.
const fn = () => Promise.resolve(null);
const handler = {
  get(target, k) {
    if (k === 'then' || k === '__esModule') return undefined;
    if (k in target) return target[k];
    if (typeof k === 'string' && /^[A-Z][A-Z_]+$/.test(k)) return k;
    if (typeof k === 'string' && /^[A-Z]/.test(k)) return new Proxy({}, handler);
    return new Proxy(fn, handler);
  },
  apply() { return Promise.resolve(null); },
};
const noop = new Proxy(function noopModule() { return noop; }, handler);
export default noop;
export const AndroidImportance = { HIGH: 4, DEFAULT: 3, LOW: 2 };
export const AndroidVisibility = { PUBLIC: 1, PRIVATE: 0, SECRET: -1 };
export const EventType = { PRESS: 1, DISMISSED: 0, DELIVERED: 3, ACTION_PRESS: 2 };
export const AuthorizationStatus = { AUTHORIZED: 1, DENIED: 0, NOT_DETERMINED: -1, PROVISIONAL: 2 };
export const getMessaging = () => noop;
export const getApp = () => noop;
export const useHideAnimation = () => ({ container: {}, logo: {}, brand: {} });
// Firebase messaging by name (push is off in the showcase)
const unsubscribe = () => () => {};
export const getApps = () => [];
export const getToken = async () => null;
export const deleteToken = async () => null;
export const getInitialNotification = async () => null;
export const onMessage = unsubscribe;
export const onNotificationOpenedApp = unsubscribe;
export const onTokenRefresh = unsubscribe;
export const registerDeviceForRemoteMessages = async () => null;
export const requestPermission = async () => 1;
export const setBackgroundMessageHandler = () => {};
