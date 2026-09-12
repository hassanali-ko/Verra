'use client';
import {useEffect,useState} from 'react';
export function VisitActionDock({targetId,status}:{targetId:string;status:string}){
 const [reading,setReading]=useState(false);
 useEffect(()=>{const target=document.getElementById(targetId);if(!target)return;const observer=new IntersectionObserver(([entry])=>setReading(entry.isIntersecting),{rootMargin:'-130px 0px -160px 0px',threshold:0});observer.observe(target);return()=>observer.disconnect();},[targetId]);
 return <div className={'mobile-visit-action'+(reading?' reading-next-step':'')}><span>{status}</span><button className="primary" onClick={()=>{const panel=document.getElementById(targetId);panel?.scrollIntoView({behavior:'instant',block:'start'});const heading=panel?.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}}>Review next step <span aria-hidden="true">→</span></button></div>;
}
