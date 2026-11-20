import {getCurrentWindow} from '@tauri-apps/api/window';
import {applyTheme,nativeTheme,parseTheme,resolveTheme,THEME_KEY,type ThemePreference} from './theme';

// The theme is per user, not per show: it lives in the Editor window storage.
const storage=(()=>{try{return globalThis.localStorage??null;}catch{return null;}})();
const query=(()=>{try{return globalThis.matchMedia?.('(prefers-color-scheme: dark)')??null;}catch{return null;}})();
const stored=():ThemePreference=>{try{return parseTheme(storage?.getItem(THEME_KEY)??null);}catch{return 'system';}};

let preference=$state<ThemePreference>(stored());
const paint=()=>applyTheme(resolveTheme(preference,query?.matches??false));
// The frame follows the OS on its own for system. A failed call keeps the old frame; the page still changes.
const frame=()=>{try{getCurrentWindow().setTheme(nativeTheme(preference)).catch(()=>{});}catch{/* no Tauri host */}};

// Runs before mount. `public/theme-boot.js` already painted the stored theme; this adds the OS listener and the frame.
let started=false;
export function startTheme(){
 if(started)return;
 started=true;
 paint();
 frame();
 query?.addEventListener('change',paint);
}

export const theme={
 get preference(){return preference;},
 set(next:ThemePreference){
  if(next===preference)return;
  preference=next;
  try{storage?.setItem(THEME_KEY,next);}catch{/* the theme is a convenience only */}
  paint();
  frame();
 },
};
