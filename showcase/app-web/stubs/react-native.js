// react-native for the browser: react-native-web, plus what it lacks (Android permissions) and real
// alert dialogs (react-native-web's Alert does nothing).
export * from 'react-native-web';
import { Alert as WebAlert } from 'react-native-web';

const GRANTED = 'granted';
export const PermissionsAndroid = {
  PERMISSIONS: new Proxy({}, { get: (_, k) => `android.permission.${String(k)}` }),
  RESULTS: { GRANTED, DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
  request: async () => GRANTED,
  requestMultiple: async (list) => Object.fromEntries(list.map((p) => [p, GRANTED])),
  check: async () => true,
};

function showDialog(title, message, buttons) {
  const list = buttons && buttons.length ? buttons : [{ text: 'OK' }];
  const wrap = document.createElement('div');
  wrap.setAttribute('data-showcase-dialog', '');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(5,10,20,.55);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:Archivo-Regular,sans-serif';
  const box = document.createElement('div');
  box.style.cssText = 'width:84%;max-width:340px;background:var(--dialog-bg,#fff);color:var(--dialog-ink,#0d1a2b);border-radius:20px;padding:22px 22px 12px;box-shadow:0 20px 60px rgba(0,0,0,.35)';
  const h = document.createElement('div');
  h.textContent = title || '';
  h.style.cssText = 'font-family:Archivo-Bold,sans-serif;font-size:19px;line-height:25px;margin-bottom:8px';
  box.appendChild(h);
  if (message) {
    const p = document.createElement('div');
    p.textContent = message;
    p.style.cssText = 'font-size:15px;line-height:22px;color:var(--dialog-muted,#4f5b6b);margin-bottom:10px';
    box.appendChild(p);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap';
  for (const b of list) {
    const btn = document.createElement('button');
    btn.textContent = b.text || 'OK';
    btn.setAttribute('aria-label', b.text || 'OK');
    btn.style.cssText = `font-family:Archivo-SemiBold,sans-serif;font-size:16px;border:0;background:none;padding:12px 14px;border-radius:12px;cursor:pointer;color:${b.style === 'destructive' ? '#c4161c' : b.style === 'cancel' ? '#4f5b6b' : '#c4161c'}`;
    btn.onclick = () => { wrap.remove(); b.onPress && b.onPress(); };
    row.appendChild(btn);
  }
  box.appendChild(row);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
}
export const Alert = { ...WebAlert, alert: showDialog, prompt: showDialog };
