'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

export function pageReadingText(){
 const main=document.querySelector('main');if(!main)return '';
 return Array.from(main.querySelectorAll<HTMLElement>('h1,h2,h3,p,li,blockquote'))
  .filter(el=>el.getClientRects().length>0&&!el.closest('dialog,form,[aria-hidden="true"],[data-no-speech]')&&!el.querySelector('h1,h2,h3,p,li,blockquote'))
  .map(el=>el.innerText.trim()).filter(Boolean).join('. ').slice(0,40000);
}
export function ReadAloud({onStart}:{onStart:()=>void}){
 const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[voiceId,setVoiceId]=useState(''),[rate,setRate]=useState('1');
 const [supported,setSupported]=useState(false),[state,setState]=useState<'idle'|'reading'|'paused'>('idle'),[notice,setNotice]=useState('');
 const session=useRef(0),active=useRef(false),utterance=useRef<SpeechSynthesisUtterance|null>(null);
 function stop(){session.current++;active.current=false;if('speechSynthesis' in window)window.speechSynthesis.cancel();utterance.current=null;setState('idle');}
 useEffect(()=>{
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;
  setSupported(true);
  const load=()=>setVoices(window.speechSynthesis.getVoices().filter(v=>v.localService));load();
  window.speechSynthesis.addEventListener('voiceschanged',load);
  const changed=()=>{if(active.current){stop();setNotice('Reading stopped because the page changed. Start again to read the current details.');}};
  const observer=new MutationObserver(changed);const main=document.querySelector('main');if(main)observer.observe(main,{childList:true,subtree:true,characterData:true});
  window.addEventListener('pagehide',changed);window.addEventListener('verra-view-change',changed);
  return()=>{session.current++;active.current=false;window.speechSynthesis.cancel();observer.disconnect();window.speechSynthesis.removeEventListener('voiceschanged',load);window.removeEventListener('pagehide',changed);window.removeEventListener('verra-view-change',changed);};
 },[]);
 function start(){
  stop();const voice=voices.find(v=>v.voiceURI===voiceId)||voices.find(v=>v.lang.startsWith(document.documentElement.lang||'en'))||voices[0];
  if(!voice){setNotice('No on-device voice is available. Enable a system voice or use your screen reader.');return;}
  const text=pageReadingText();if(!text){setNotice('There is no readable page content here yet.');return;}
  const chunks=text.match(/.{1,450}(?:\s|$)|\S+/g)||[text],id=++session.current;active.current=true;setState('reading');setNotice('Reading this page with an on-device voice.');onStart();
  function next(index:number){
   if(id!==session.current)return;if(index>=chunks.length){active.current=false;setState('idle');setNotice('Finished reading this page.');return;}
   const item=new SpeechSynthesisUtterance(chunks[index]);item.voice=voice!;item.lang=voice!.lang;item.rate=Number(rate);utterance.current=item;
   item.onend=()=>next(index+1);item.onerror=()=>{if(id===session.current){stop();setNotice('The voice could not continue. Try another on-device voice.');}};
   window.speechSynthesis.speak(item);
  }
  next(0);
 }
 function pause(){if(state==='reading'){window.speechSynthesis.pause();setState('paused');}else{window.speechSynthesis.resume();setState('reading');}}
 return <section className="read-aloud-settings" aria-labelledby="read-aloud-title"><h3 id="read-aloud-title">Listen to this page</h3><p>Read the visible visit details aloud. Only on-device voices are used; reading never starts automatically.</p>
 {!supported?<p>Read-aloud is unavailable in this browser. You can still use your device’s screen reader.</p>:<>
 <label>Reading voice<select value={voiceId} onChange={e=>{stop();setVoiceId(e.target.value);}}><option value="">Automatic on-device voice</option>{voices.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select></label>
 <label>Reading speed<select value={rate} onChange={e=>{stop();setRate(e.target.value);}}><option value="0.8">Slower</option><option value="1">Standard</option><option value="1.2">Faster</option></select></label>
 <button type="button" disabled={!voices.length} onClick={start}>Read this page</button>{!voices.length&&<p>No on-device voice is available yet. Enable a voice in your device’s speech settings.</p>}
 {state!=='idle'&&<button type="button" onClick={stop}>Stop reading</button>}</>}
 <p role="status">{notice}</p>
 {state!=='idle'&&createPortal(<div className="read-aloud-player" role="region" aria-label="Read-aloud controls"><span>{state==='paused'?'Reading paused':'Reading this page'}</span><button onClick={pause}>{state==='paused'?'Resume reading':'Pause reading'}</button><button onClick={stop}>Stop reading</button></div>,document.body)}
 </section>;
}
