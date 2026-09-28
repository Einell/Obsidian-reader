if(!app.vault.getName().includes('qa'))throw Error('QA only');
const id='qiaomu-reader';const wasEnabled=!!app.plugins.plugins[id];
const pause=()=>new Promise(r=>setTimeout(r,120));
let release;const checks=[];const assert=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg)};
try{
 await app.plugins.enablePlugin(id);const p=app.plugins.plugins[id];
 app.commands.executeCommandById(id+':show-onboarding');await pause();
 const modal=document.querySelector('.qiaomu-reader-onb-modal');
 assert(!!modal,'Guide opens');
 assert(getComputedStyle(modal.querySelector('.qiaomu-reader-onb-nav')).display==='flex','Guide navigation has horizontal layout');
 assert(getComputedStyle(modal.querySelector('.qiaomu-reader-onb-dot')).width==='10px','Guide dots use compact styling');
 modal.querySelector('.qiaomu-reader-onb-next').click();
 assert(modal.querySelector('.qiaomu-reader-onb-counter').textContent==='2 / 5','Next step works');
 for(const m of [...p._announcementModals])m.close();
 assert(p._announcementModals.size===0,'Closed modal is released from tracking');
 for(let i=0;i<5;i++){app.commands.executeCommandById(id+':show-onboarding');for(const m of [...p._announcementModals])m.close();}
 assert(p._announcementModals.size===0,'Repeated guides leave no retained modal instances');
 app.commands.executeCommandById(id+':show-onboarding');await app.plugins.disablePlugin(id);
 assert(!document.querySelector('.qiaomu-reader-onb-modal'),'Disable closes the open guide before styles disappear');
 await app.plugins.enablePlugin(id);const next=app.plugins.plugins[id];
 next._onbShown=false;next.settings.onboarded=false;
 next.saveAll=()=>new Promise(r=>{release=r;});next._scheduleFirstRunFlow();await pause();
 assert(typeof release==='function','First-run save is pending');
 await app.plugins.disablePlugin(id);release();await pause();
 assert(!document.querySelector('.qiaomu-reader-onb-modal'),'Delayed first-run save does not reopen an unloaded plugin guide');
 return {checks};
}finally{
 release?.();if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);
 if(wasEnabled)await app.plugins.enablePlugin(id);
}
