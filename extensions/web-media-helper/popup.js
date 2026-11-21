const status=document.querySelector('#status');
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
const supported=/^https?:\/\//.test(tab?.url||'');
async function refresh(){
  const {job}=await chrome.storage.session.get('job');const busy=job?.status==='progress';
  document.body.dataset.state=job?.status||'ready';
  for(const id of ['audio','video'])document.getElementById(id).disabled=busy||!supported;
  document.getElementById('cancel').hidden=!busy;document.getElementById('show').hidden=!(job?.status==='done'&&job.downloadId);
  status.textContent=job&&(busy||['done','error','canceled'].includes(job.status))?job.message:supported?'支持网页中的常见视频/音频直链。遇到分段流或加密媒体会提示原因。':'请先打开普通网页，再使用下载功能。';
}
async function message(m){try{return await chrome.runtime.sendMessage({target:'background',...m});}catch(e){return {error:e.message};}}
for(const mode of ['audio','video'])document.getElementById(mode).onclick=async()=>{
  const isPlatform=/^https:\/\/(www\.)?(bilibili\.com|xiaohongshu\.com)\//.test(tab?.url||'');
  if(mode==='audio'&&!isPlatform){
    status.textContent='从普通网站提取音频需要读取跨域媒体。Chrome 会询问是否允许插件访问 HTTP/HTTPS 网站；插件仍只在你主动点击时处理当前页面。';
    const granted=await chrome.permissions.request({origins:['http://*/*','https://*/*']});
    if(!granted){status.textContent='未获媒体读取权限。若网页有独立音频文件，可改用支持该资源的方式下载。';return;}
  }
  for(const id of ['audio','video'])document.getElementById(id).disabled=true;
  status.textContent='正在扫描当前网页的媒体资源…';
  const r=await message({action:'download',mode,tabId:tab.id});await refresh();if(r?.error)status.textContent=r.error;
};
for(const action of ['cancel','show','folder'])document.getElementById(action).onclick=async()=>{const r=await message({action});await refresh();if(r?.error)status.textContent=r.error;};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.job)refresh();});
await refresh();
