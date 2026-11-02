import {getSetting,setSetting} from './storage.js';
// The old app referenced this site, but live verification returned "no site at this domain".
// Integration stays disabled until the owner activates and verifies an actual account.
// Only a fixed event name. Never include URL fragments, names, amounts or screen sizes.
export const INSTALL_COUNTER_ENABLED = false;
export const INSTALL_SITE = 'https://zateznakamata.goatcounter.com';
export const INSTALL_EVENT = 'studio-pwa-installed';
export function installEventURL() {
  return INSTALL_SITE + '/count?' + new URLSearchParams({p:INSTALL_EVENT,t:'Kamata Studio PWA installation',e:'true',r:'',rnd:Math.random().toString(36).slice(2)});
}
let busy=false;
const images=new Set();
export async function initInstallCounter() {
  if (!INSTALL_COUNTER_ENABLED) return;
  window.addEventListener('appinstalled',async()=>{
    if (navigator.webdriver || location.hostname !== 'dbubanja.github.io' || !await getSetting('reportInstall',true) || await getSetting('installationReported',false)) return;
    await setSetting('installationPending',true); await sendPending();
  });
  window.addEventListener('online',()=>sendPending().catch(()=>{}));
  await sendPending();
}
async function sendPending() {
  if (busy || navigator.webdriver || location.hostname !== 'dbubanja.github.io' || !navigator.onLine || !await getSetting('reportInstall',true) || !await getSetting('installationPending',false) || await getSetting('installationReported',false)) return;
  busy=true;
  const img = new Image();images.add(img);img.referrerPolicy='no-referrer';
  img.onload=async()=>{busy=false;images.delete(img);try {await setSetting('installationReported',true);await setSetting('installationPending',false);}catch{}};
  img.onerror=()=>{busy=false;images.delete(img);};img.src=installEventURL();
}
export async function getReportedInstallations(fetcher=fetch) {
  if (!INSTALL_COUNTER_ENABLED) throw new Error('Број инсталација није доступан: сервис још није активиран.');
  const end=new Date();end.setUTCDate(end.getUTCDate()+1);
  const url=INSTALL_SITE+'/counter/'+encodeURIComponent(INSTALL_EVENT)+'.json?start=2026-11-02&end='+end.toISOString().slice(0,10);
  const res=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
  if(!res.ok) throw new Error('Приказ инсталација није доступан: потребно је дозволити јавни бројач у GoatCounter-у, а први догађај мора бити евидентиран.');
  const data=await res.json();
  if(!/^[\d,.\s]+$/.test(String(data.count))) throw new Error('Неочекиван одговор бројача');
  return String(data.count);
}
