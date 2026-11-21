import {inspectPage} from './inspect.js';
import {mediaURL,filename} from './media.js';
let starting=false;
async function job(value){await chrome.storage.session.set({job:value});await chrome.action.setBadgeText({text:value.status==='progress'?'↓':value.status==='error'?'!':''});}
async function ensureOffscreen(){
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
  if(!contexts.length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'在本机提取原音轨、合并视频并生成下载文件，无需第三方服务器。'});
}
async function clearRules(){const rules=await chrome.declarativeNetRequest.getSessionRules();if(rules.length)await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:rules.map(r=>r.id)});}
async function release(id){try{await chrome.runtime.sendMessage({target:'offscreen',action:'release',id});await chrome.offscreen.closeDocument();}catch{}await clearRules();}

function genericMediaURL(value){
  try{
    const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return false;
    const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    if(!h||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal'))return false;
    if(/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)||h==='::1'||h==='::'||h.startsWith('fe80:')||h.startsWith('fc')||h.startsWith('fd'))return false;
    if(u.port&&!['80','443'].includes(u.port))return false;
    return true;
  }catch{return false;}
}
function genericFilename(title,raw,mode){
  const safe=String(title||'媒体文件').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').replace(/[. ]+$/,'').trim().slice(0,100)||'媒体文件';
  let ext='';try{ext=new URL(raw).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()||'';}catch{}
  if(!['mp4','webm','mov','mkv','mpeg','mpg','ogv','3gp','m4v','mp3','m4a','aac','oga','ogg','opus','wav','flac','weba'].includes(ext))ext=mode==='audio'?'m4a':'mp4';
  return safe+'.'+ext;
}
async function genericDownload(media,raw,mode,id){
  if(!genericMediaURL(raw))throw Error('检测到的媒体地址不安全或不受支持。');
  const name=genericFilename(media.title,raw,mode);
  const downloadId=await chrome.downloads.download({url:raw,filename:name,conflictAction:'uniquify',saveAs:false});
  await job({id,status:'progress',downloadId,filename:name,message:'已找到媒体，正在保存到下载文件夹…'});
  const [item]=await chrome.downloads.search({id:downloadId});
  if(item&&item.state!=='in_progress')await finishDownload(id,downloadId,item.state,item.error);
  return {ok:true};
}

async function start(mode,tabId){
  const stored=(await chrome.storage.session.get('job')).job;
  if(starting||stored?.status==='progress')return {error:'已有下载正在进行。请等待完成或点取消。'};
  if(!['audio','video'].includes(mode))return {error:'未知下载类型。'};
  starting=true;const id=crypto.randomUUID();
  await job({id,status:'progress',message:'正在读取当前视频…'});
  try{
    const [result]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:inspectPage});
    const media=result.result;if(!media)throw Error('无法读取页面。请刷新页面后重试。');
    if(media.site==='generic'){
      for(const field of ['audio','video'])if(media[field])media[field]=media[field].filter(genericMediaURL);
      if(mode==='video'&&media.video?.length)return await genericDownload(media,media.video[0],mode,id);
      if(mode==='audio'&&media.audio?.length)return await genericDownload(media,media.audio[0],mode,id);
      if(media.manifests?.length)throw Error('检测到 HLS/DASH 分段播放清单，但目前还不能合并完整流媒体文件。');
      if(media.segments?.length)throw Error('检测到分段媒体资源，目前还不能合并成完整文件。');
      throw Error(mode==='audio'?'没有找到独立音频文件。':'没有找到可直接下载的视频文件。');
    }
    // Platform-specific path remains original, using its CDN allowlist and exact URLs.
    for(const field of ['audio','video'])if(media[field])media[field]=media[field].filter(mediaURL);
    const source=media.site==='bili'&&mode==='audio'?media.audio:media.video;
    if(!source?.some(mediaURL))throw Error('没有可下载的媒体地址。');
    if(media.site==='bili'&&mode==='video'&&!media.audio?.some(mediaURL))throw Error('没有可下载的音轨。');
    const urls=[...new Set([...(source||[]),...(media.site==='bili'&&mode==='video'?media.audio||[]:[])])].filter(mediaURL);
    await clearRules();
    await chrome.declarativeNetRequest.updateSessionRules({addRules:urls.map((url,i)=>({id:i+1,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:media.referer}]},condition:{urlFilter:'|'+url+'|',initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest']}}))});
    await ensureOffscreen();
    const accepted=await chrome.runtime.sendMessage({target:'offscreen',action:'run',id,mode,media,filename:filename(media.title,mode)});
    if(accepted?.error)throw Error(accepted.error);
    return {ok:true};
  }catch(e){await release(id);await job({id,status:'error',message:e.message||'读取页面失败。'});return {error:e.message};}
  finally{starting=false;}
}
async function finishDownload(id,downloadId,state,error){
  const current=(await chrome.storage.session.get('job')).job;
  if(current?.id!==id||current.downloadId!==downloadId||current.status!=='progress')return;
  const [item]=await chrome.downloads.search({id:downloadId});
  const actual=item?.filename?.split(/[\\/]/).pop()||current.filename.split('/').pop();
  await release(id);
  await job({...current,status:state==='complete'?'done':'error',message:state==='complete'?'下载完成：'+actual:'下载未完成：'+(error||'已取消或被浏览器中断')});
}
async function route(m){
  if(m.action==='download')return start(m.mode,m.tabId);
  if(m.action==='folder'){await chrome.downloads.showDefaultFolder();return {ok:true};}
  if(m.action==='show'){const {job:current}=await chrome.storage.session.get('job');if(current?.downloadId)await chrome.downloads.show(current.downloadId);return {ok:true};}
  if(m.action==='cancel'){
    if(starting)return {error:'正在读取页面，请稍候再取消。'};
    const {job:current}=await chrome.storage.session.get('job');if(current?.downloadId)await chrome.downloads.cancel(current.downloadId);
    await release(current?.id);await job({...current,status:'canceled',message:'下载已取消。'});return {ok:true};
  }
  if(m.action==='progress'||m.action==='error'){
    const {job:current}=await chrome.storage.session.get('job');if(current?.id!==m.id||current.status!=='progress')return;
    if(m.action==='error')await release(m.id);
    await job({...current,status:m.action==='error'?'error':'progress',message:m.message});return {ok:true};
  }
  if(m.action==='save'){
    const {job:current}=await chrome.storage.session.get('job');if(current?.id!==m.id||current.status!=='progress')return;
    if(!m.blobURL?.startsWith('blob:'+chrome.runtime.getURL('')))throw Error('下载地址无效。');
    try{
      const downloadId=await chrome.downloads.download({url:m.blobURL,filename:m.filename,conflictAction:'uniquify',saveAs:false});
      await job({...current,downloadId,filename:m.filename,message:'正在保存到下载文件夹…'});
      const [item]=await chrome.downloads.search({id:downloadId});if(item&&item.state!=='in_progress')await finishDownload(m.id,downloadId,item.state,item.error);
      return {ok:true};
    }catch(e){await release(m.id);await job({...current,status:'error',message:'保存失败：'+e.message});return {error:e.message};}
  }
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.target!=='background'||s.id!==chrome.runtime.id)return;route(m).then(reply).catch(e=>reply({error:e.message}));return true;});
chrome.downloads.onChanged.addListener(async delta=>{if(delta.state?.current&&delta.state.current!=='in_progress'){const {job:current}=await chrome.storage.session.get('job');if(current?.downloadId===delta.id)await finishDownload(current.id,delta.id,delta.state.current,delta.error?.current);}});
chrome.runtime.onInstalled.addListener(async()=>{await clearRules();await job({status:'ready',message:'打开视频页面，选择原音频或视频。'});});
chrome.runtime.onStartup.addListener(async()=>{await clearRules();await job({status:'ready',message:'打开视频页面，选择原音频或视频。'});});

