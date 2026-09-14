export const readingKey='verra-reading-preferences';
export type ReadingPreferences={largerText:boolean;reduceMotion:boolean;quietSurfaces:boolean;strongContrast:boolean;colorSupport:boolean;underlineLinks:boolean};
export const readingDefaults:ReadingPreferences={largerText:false,reduceMotion:false,quietSurfaces:false,strongContrast:false,colorSupport:false,underlineLinks:false};
export function normalizeReading(value:unknown):ReadingPreferences{
 const source=value&&typeof value==='object'?value as Record<string,unknown>:{};
 return Object.fromEntries(Object.keys(readingDefaults).map(key=>[key,source[key]===true])) as ReadingPreferences;
}
export function applyReading(p:ReadingPreferences){
 const root=document.documentElement;
 root.dataset.calm=p.largerText&&p.reduceMotion&&p.quietSurfaces?'on':'off';
 root.dataset.reading=p.largerText?'comfortable':'standard';root.dataset.motion=p.reduceMotion?'reduced':'system';
 root.dataset.surfaces=p.quietSurfaces?'quiet':'standard';root.dataset.contrast=p.strongContrast?'strong':'standard';
 root.dataset.colorSupport=p.colorSupport?'on':'off';root.dataset.linkStyle=p.underlineLinks?'underlined':'standard';
}
