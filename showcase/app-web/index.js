// The showcase's entry: the stand-in API first, then the real app, rendered by react-native-web
import './mock.js';
import { AppRegistry } from 'react-native';
import App from '../App';

AppRegistry.registerComponent('bannuar', () => App);
AppRegistry.runApplication('bannuar', { rootTag: document.getElementById('root') });

// On a phone, Yoga keeps each screen to the screen's height, so its scroll area scrolls. React
// Navigation's stack in a browser lets a screen grow past it instead. Let such a container shrink.
setInterval(() => {
  for (const el of document.querySelectorAll('#root div')) {
    const parent = el.parentElement;
    if (!parent || el.style.flexShrink === '1' || !el.checkVisibility()) continue;
    const ps = getComputedStyle(parent);
    if (ps.display !== 'flex' || /(auto|scroll)/.test(ps.overflowY)) continue;
    if (parent.clientHeight > 0 && el.offsetHeight > parent.clientHeight + 1) {
      el.style.flexShrink = '1';
      el.style.minHeight = '0';
    }
  }
}, 200);
