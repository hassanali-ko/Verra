import type { Metadata } from 'next';
import './globals.css';
import './experience.css';
import './mobile-comfort.css';
import './guided-experience.css';
export const metadata:Metadata={title:'Verra | Make room for what matters',description:'Arrange the access details that matter for your next visit.'};
export default function Root({children}:{children:React.ReactNode}){return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('verra-appearance');document.documentElement.dataset.theme=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';var p=JSON.parse(localStorage.getItem('verra-reading-preferences')||'{}');var r=document.documentElement;r.dataset.calm=p.largerText&&p.reduceMotion&&p.quietSurfaces?'on':'off';r.dataset.reading=p.largerText===true?'comfortable':'standard';r.dataset.motion=p.reduceMotion===true?'reduced':'system';r.dataset.surfaces=p.quietSurfaces===true?'quiet':'standard';r.dataset.contrast=p.strongContrast===true?'strong':'standard';r.dataset.colorSupport=p.colorSupport===true?'on':'off';r.dataset.linkStyle=p.underlineLinks===true?'underlined':'standard'}catch{}"}}/></head><body><a className="skip" href="#main">Skip to content</a>{children}</body></html>;}
