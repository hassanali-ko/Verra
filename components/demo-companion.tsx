'use client';
import {useEffect,useRef,useState} from 'react';
import {Icon} from './product-chrome';
import {answerDemoQuestion,companionQuestions,type CompanionAnswer} from '@/lib/demo-companion';
import type {SampleVisit} from '@/lib/demo-model';
export function DemoCompanion({visit,onExplore,beforeOpen}:{visit:SampleVisit;onExplore:(tab:string)=>void;beforeOpen:()=>boolean}){
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null);
 const [question,setQuestion]=useState(''),[answers,setAnswers]=useState<{question:string;answer:CompanionAnswer}[]>([]);
 const conversation=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=conversation.current;if(node)node.scrollTop=node.scrollHeight;},[answers]);
 const revision=JSON.stringify(visit);
 useEffect(()=>{setAnswers([]);setQuestion('');},[revision]);
 function ask(text:string){if(!text.trim())return;setAnswers(current=>[...current.slice(-7),{question:text.trim(),answer:answerDemoQuestion(text,visit)}]);setQuestion('');}
 return <><button ref={opener} className="companion-launch" onClick={()=>{if(beforeOpen())dialog.current?.showModal();}}><Icon name="message" size={17}/>Ask the demo companion</button>
 <dialog ref={dialog} className="companion-dialog" aria-labelledby="companion-title" onClose={()=>opener.current?.focus()}>
 <div className="dialog-heading"><p className="eyebrow">A little guidance, when you need it</p><button aria-label="Close demo companion" onClick={()=>dialog.current?.close()}>×</button></div>
 <h2 id="companion-title">Let’s look at the details.</h2><p className="companion-context">{visit.title} · {visit.venue}</p>
 <p>Ask about this visit’s evidence, sharing or next step. Answers use the demo’s recorded details.</p>
 <div className="companion-suggestions">{companionQuestions.map(q=><button key={q} onClick={()=>ask(q)}>{q}<Icon size={15}/></button>)}</div>
 <div ref={conversation} className="companion-conversation" role="region" aria-label="Conversation">{answers.map((entry,i)=><article key={i}><p className="companion-question">{entry.question}</p><div className="companion-answer"><p>{entry.answer.text}</p><button onClick={()=>{dialog.current?.close();onExplore(entry.answer.action.tab);}}>{entry.answer.action.label}<Icon size={15}/></button></div></article>)}</div>
 <p className="sr-only" role="status">{answers.at(-1)?.answer.text}</p>
 <form onSubmit={e=>{e.preventDefault();ask(question);}}><label>Your question<input value={question} maxLength={600} placeholder="For example, why is the route unresolved?" onChange={e=>setQuestion(e.target.value)}/></label><button className="primary" disabled={!question.trim()}>Ask about this visit <Icon size={16}/></button></form>
 </dialog></>;
}
