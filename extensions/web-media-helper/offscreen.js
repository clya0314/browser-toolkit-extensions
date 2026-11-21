import {mediaURL,remux,validateMedia,MAX_BYTES} from './media.js';
let active=null;
const send=m=>chrome.runtime.sendMessage({target:'background',...m});
async function read(urls,label,task){
  let lastError;let attempts=0;
  for(const raw of [...new Set(urls||[])]){
    if(!mediaURL(raw)||attempts++>=3)continue;
    const url=raw.replace(/^http:/,'https:');
    try{
      const signal=AbortSignal.any([task.controller.signal,AbortSignal.timeout(180000)]);
      const r=await fetch(url,{credentials:'omit',signal});
      if(!r.ok)throw Error('媒体服务器返回 '+r.status);
      if(!mediaURL(r.url))throw Error('媒体被重定向到不受支持的地址。');
      const total=Number(r.headers.get('Content-Length'))||0;
      if(total+task.bytes>MAX_BYTES){await r.body?.cancel();throw Error('文件超过 512 MB，暂不支持在浏览器内处理。');}
      const reader=r.body.getReader();const chunks=[];let bytes=0;let updated=0;
      try{
        while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes+task.bytes>MAX_BYTES)throw Error('文件超过 512 MB，暂不支持在浏览器内处理。');chunks.push(value);if(Date.now()-updated>500){updated=Date.now();await send({action:'progress',id:task.id,message:label+' '+(total?Math.min(100,Math.round(bytes/total*100))+'%':(bytes/1024/1024).toFixed(1)+' MB')+' · 关闭弹窗会继续'});}}
      }catch(e){await reader.cancel();throw e;}
      if(!bytes)throw Error('平台返回了空文件。');
      task.bytes+=bytes;const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return data.buffer;
    }catch(e){if(task.controller.signal.aborted)throw Error('下载已取消。');lastError=e;if(e.message.includes('512 MB'))throw e;}
  }
  throw Error((lastError?.message||'没有可用媒体地址')+'。请确认视频可播放，刷新页面后重试。');
}
async function run(m){
  const task={id:m.id,controller:new AbortController(),bytes:0,blobURL:null};active=task;
  try{
    let blob;
    if(m.media.site==='bili'&&m.mode==='audio'){
      const audio=await read(m.media.audio,'下载原音频',task);validateMedia(audio,'audio');blob=new Blob([audio],{type:'audio/x-m4a'});
    }else{
      const video=await read(m.media.video,'下载视频',task);
      if(m.media.site==='xhs'&&m.mode==='video'){validateMedia(video,'video');blob=new Blob([video],{type:'video/mp4'});}
      else{
        const sources=m.mode==='audio'?[{buffer:video,kind:'audio'}]:[{buffer:video,kind:'video'},{buffer:await read(m.media.audio,'下载音轨',task),kind:'audio'}];
        await send({action:'progress',id:m.id,message:m.mode==='audio'?'正在无损提取音轨…':'正在无损合并视频和音轨…'});
        blob=new Blob([remux(sources,m.mode)],{type:m.mode==='audio'?'audio/x-m4a':'video/mp4'});
      }
    }
    if(active!==task||task.controller.signal.aborted)return;
    task.blobURL=URL.createObjectURL(blob);
    const result=await send({action:'save',id:m.id,blobURL:task.blobURL,filename:m.filename});if(result?.error)throw Error(result.error);
  }catch(e){if(active===task){await send({action:'error',id:m.id,message:e.message||'下载失败。'});dispose(task.id);}}
}
function dispose(id){if(active?.id!==id)return;active.controller.abort();if(active.blobURL)URL.revokeObjectURL(active.blobURL);active=null;}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m.target!=='offscreen'||s.id!==chrome.runtime.id)return;
  if(m.action==='run'){if(active){reply({error:'下载尚未结束。'});return;}run(m);reply({ok:true});}
  if(m.action==='release'){dispose(m.id);reply({ok:true});}
});
