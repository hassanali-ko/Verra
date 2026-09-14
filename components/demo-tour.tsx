'use client';
import {useEffect,useRef,useState} from 'react';
import {Icon} from './product-chrome';
export const demoTourKey='verra-demo-tour-v1';
const steps=[
 {icon:'visits',title:'A visit, with the details taken care of.',body:'Explore how Verra follows an access question through evidence, a decision and a clearer plan.',note:'This demo uses example visits and simulated venue replies. Your choices stay in this browser; no venue is contacted.',view:'overview',tab:'requirements'},
 {icon:'needs',title:'Start with what needs to work.',body:'A step-free entrance does not answer whether you can reach the classroom. Each need stays separate, and you choose which details may be shared.',note:'Look for the hard requirement and the sharing choices in Access needs.',view:'detail',tab:'requirements'},
 {icon:'book',title:'Follow the evidence, not a broad promise.',body:'The website describes the entrance. The room-specific reply reveals an upstairs classroom and a broken lift. Verra keeps that conflict visible.',note:'Evidence keeps the statement, its source and its scope together.',view:'detail',tab:'evidence'},
 {icon:'shield',title:'A different route. Your decision.',body:'Review the ground-floor alternative. Approve or decline the question, then load the example reply to see the plan update. You can pause at any point.',note:'The tour never approves, changes permissions or resets your progress.',view:'detail',tab:'requirements'},
 {icon:'message',title:'Make this space your own.',body:'Use Accessibility for read-aloud, colour-blind support, stronger contrast or calmer reading. The demo companion can explain a visit and take you to the relevant details.',note:'Replay this tour from the demo toolbar whenever you like.',view:'detail',tab:'requirements'},
] as const;
export function DemoTour({ready,navigate,beforeOpen}:{ready:boolean;navigate:(view:string,id?:string,tab?:string)=>void;beforeOpen:()=>boolean}){
 const [step,setStep]=useState(0);const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(!ready)return;try{if(localStorage.getItem(demoTourKey)==='seen')return;}catch{}dialog.current?.showModal();},[ready]);
 function markSeen(){try{localStorage.setItem(demoTourKey,'seen');}catch{}}
 function change(next:number){setStep(next);const item=steps[next];navigate(item.view,item.view==='detail'?'studio':undefined,item.tab);}
 useEffect(()=>{if(dialog.current?.open)heading.current?.focus();},[step]);
 const current=steps[step];
 return <><button ref={opener} onClick={()=>{if(!beforeOpen())return;setStep(0);dialog.current?.showModal();}}><Icon name="book" size={17}/>Replay tour</button>
 <dialog ref={dialog} className="tour-dialog" aria-labelledby="tour-title" onClose={()=>{markSeen();opener.current?.focus();}}>
 <div className="dialog-heading"><p className="eyebrow">Welcome to Verra</p><button aria-label="Close tour" onClick={()=>dialog.current?.close()}>×</button></div>
 <div className="tour-progress" role="group" aria-label={`Tour step ${step+1} of ${steps.length}`}>{steps.map((_,i)=><span key={i} data-complete={i<=step}/>)}</div>
 <div className="tour-scene" key={step}><div className="tour-symbol"><Icon name={current.icon} size={36}/><span>{String(step+1).padStart(2,'0')}</span></div><h2 id="tour-title" ref={heading} tabIndex={-1}>{current.title}</h2><p>{current.body}</p><p className="tour-note">{current.note}</p></div>
 <div className="tour-actions">{step>0&&<button onClick={()=>change(step-1)}>Back</button>}<button className="primary" onClick={()=>{if(step===steps.length-1)dialog.current?.close();else change(step+1);}}>{step===steps.length-1?'Explore this visit':'Next'}<Icon size={16}/></button>{step<steps.length-1&&<button className="tour-skip" onClick={()=>dialog.current?.close()}>Skip tour</button>}</div>
 </dialog></>;
}
