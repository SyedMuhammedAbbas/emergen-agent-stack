// The pixel crab, ported from mods/paperclip-crew/hooks/crab.ts so the app and the Claude mod look the same.
const CLAY='#D97757',INK='#1F1E1D',GOLD='#F5C542',GREY='#8E929A',DARK='#3A3A3C',PAPER='#F4F3EE';
const ACCENT={engineering:'#4C8DF6',operations:'#3B9C5F',branding:'#E0609A',freelance:'#F5A524'};
const PROFILES={manager:['engineering','cap','clipboard'],cto:['engineering','crown','none'],'frontend engineer':['engineering','headphones','palette'],'backend engineer':['engineering','headphones','none'],'devops engineer':['engineering','hardhat','wrench'],'secops engineer':['engineering','hardhat','shield'],qa:['engineering','glasses','magnifier'],'ux reviewer':['engineering','beret','magnifier'],docs:['engineering','glasses','pen'],estimator:['engineering','cap','calc'],'chief of staff':['operations','crown','clipboard'],timekeeper:['operations','cap','clock'],watchdog:['operations','hardhat','magnifier'],'brand lead':['branding','crown','palette'],designer:['branding','beret','palette'],'video generator':['branding','cap','camera'],'orrisian content':['branding','glasses','pen'],'upwork scout':['freelance','cap','briefcase']};
const HATS={crown:(f,a)=>{f(10,8,10,2,GOLD);f(10,6,2,2,GOLD);f(14,5,2,3,GOLD);f(18,6,2,2,GOLD);f(14,8,2,1,a)},hardhat:f=>{f(9,6,12,3,GOLD);f(8,9,14,1,'#C99A1E');f(14,5,2,1,GOLD)},beret:(f,a)=>{f(8,7,13,3,a);f(10,6,8,1,a);f(14,5,2,1,a)},cap:(f,a)=>{f(9,7,12,3,a);f(20,9,5,2,a)},headphones:(f,a)=>{f(8,7,14,1,DARK);f(7,8,1,5,DARK);f(22,8,1,5,DARK);f(6,11,3,4,a);f(21,11,3,4,a)},glasses:f=>{f(8,11,4,1,DARK);f(8,14,4,1,DARK);f(8,12,1,2,DARK);f(11,12,1,2,DARK);f(18,11,4,1,DARK);f(18,14,4,1,DARK);f(18,12,1,2,DARK);f(21,12,1,2,DARK);f(12,12,6,1,DARK)},none:()=>{}};
const PROPS={clipboard:f=>{f(24,8,5,7,'#C9A66B','it');f(25,7,3,1,GREY,'it');f(25,10,3,1,PAPER,'it');f(25,12,3,1,PAPER,'it')},wrench:f=>{f(24,9,1,1,GREY,'it');f(26,9,1,1,GREY,'it');f(24,10,3,1,GREY,'it');f(25,11,1,5,GREY,'it')},magnifier:f=>{f(24,8,3,1,DARK,'it');f(23,9,1,3,DARK,'it');f(27,9,1,3,DARK,'it');f(24,12,3,1,DARK,'it');f(24,9,3,3,'rgba(169,214,245,.7)','it');f(27,13,1,3,'#7A4A26','it')},pen:(f,a)=>{f(26,7,2,9,a,'it');f(26,16,2,1,INK,'it');f(26,6,2,1,GOLD,'it')},shield:(f,a)=>{f(23,8,6,6,GREY,'it');f(24,9,4,4,a,'it');f(25,14,2,1,GREY,'it')},camera:f=>{f(23,9,7,5,DARK,'it');f(24,8,3,1,DARK,'it');f(25,10,3,3,'rgba(169,214,245,.8)','it')},palette:(f,a)=>{f(23,9,7,6,'#E8D2A8','it');f(24,10,1,1,'#D0453F','it');f(26,10,1,1,'#3B7DD8','it');f(28,11,1,1,'#3B9C5F','it');f(25,12,1,1,a,'it')},briefcase:f=>{f(23,11,7,5,'#7A4A26','it');f(25,10,3,1,'#7A4A26','it');f(26,13,1,1,GOLD,'it')},clock:f=>{f(24,9,5,5,PAPER,'it');f(26,10,1,3,INK,'it');f(26,12,2,1,INK,'it')},calc:f=>{f(24,8,5,8,DARK,'it');f(25,9,3,2,'rgba(169,214,245,.8)','it');f(25,12,1,1,PAPER,'it');f(27,12,1,1,PAPER,'it');f(25,14,1,1,PAPER,'it');f(27,14,1,1,PAPER,'it')},none:()=>{}};
function crab(name,mood){
  const [dept,hat,prop]=PROFILES[name.toLowerCase()]||['engineering','none','none'],a=ACCENT[dept],g=new Map([['bd',[]]]);
  const f=(x,y,w,h,c,cls='bd')=>{if(!g.has(cls))g.set(cls,[]);g.get(cls).push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`)};
  const err=mood==='error';
  f(7,10,16,12,CLAY);f(3,14,4,4,CLAY);f(23,prop==='none'?14:10,4,4,CLAY,'it');f(9,12,2,2,err?'#D0453F':INK);f(19,12,2,2,err?'#D0453F':INK);
  f(7,22,2,4,CLAY,'la');f(17,22,2,4,CLAY,'la');f(11,22,2,4,CLAY,'lb');f(21,22,2,4,CLAY,'lb');
  (HATS[hat]||HATS.none)(f,a);(PROPS[prop]||PROPS.none)(f,a);
  if(err){f(1,0,2,4,'#D0453F');f(1,5,2,2,'#D0453F')}
  if(mood==='paused'){f(1,0,4,1,GOLD);f(3,1,1,1,GOLD);f(2,2,1,1,GOLD);f(1,3,4,1,GOLD)}
  const grp=c=>`<g class="${c}">${(g.get(c)||[]).join('')}</g>`,props=[...g.keys()].filter(k=>!['bd','la','lb'].includes(k));
  const dim=mood==='idle'||mood==='paused'?.62:1;
  return `<g opacity="${dim}" shape-rendering="crispEdges"><g class="${mood==='working'?'run':''}"><g class="bd">${(g.get('bd')||[]).join('')}${props.map(grp).join('')}</g>${grp('la')}${grp('lb')}</g></g>${mood==='working'?`<circle class="live" cx="27" cy="4" r="2.5" fill="${a}"/>`:''}`;
}
const crabSvg=(n,m,label)=>`<svg viewBox="0 0 30 28" role="img" aria-label="${label||n+', '+m}">${crab(n,m)}</svg>`;
export const profileOf = (name) => PROFILES[String(name).toLowerCase()] || ['engineering', 'none', 'none'];
export { crab, crabSvg, ACCENT };
