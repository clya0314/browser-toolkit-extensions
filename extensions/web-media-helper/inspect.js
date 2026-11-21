// Runs only after a click, in the active page's MAIN world.
export async function inspectPage(){
  const url=new URL(location.href);
  if(url.hostname==='www.bilibili.com'||url.hostname==='bilibili.com'){
    const bvid=url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1];
    if(!bvid)throw Error('请打开 B站 BV 视频播放页。');
    async function api(path){
      const r=await fetch('https://api.bilibili.com'+path,{credentials:'include',signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error('B站接口请求失败（'+r.status+'）。');
      const d=await r.json();if(d.code!==0)throw Error(d.message||'B站暂时没有提供可下载媒体。');return d.data;
    }
    const view=await api('/x/web-interface/view?bvid='+bvid);
    const page=Number(url.searchParams.get('p')||1);
    if(!Number.isInteger(page)||page<1||page>view.pages.length)throw Error('分P编号无效。');
    const part=view.pages[page-1];
    const data=await api('/x/player/playurl?'+new URLSearchParams({bvid,cid:String(part.cid),fnval:'16',qn:'80',fourk:'1'}));
    const dash=data.dash||{};
    const audio=(dash.audio||[]).sort((a,b)=>b.bandwidth-a.bandwidth)[0];
    const videos=(dash.video||[]).sort((a,b)=>(b.height||0)-(a.height||0)||(String(a.codecs).startsWith('avc')?-1:String(b.codecs).startsWith('avc')?1:0)||(b.bandwidth||0)-(a.bandwidth||0));
    const urls=x=>x?[x.baseUrl||x.base_url,...(x.backupUrl||x.backup_url||[])].filter(Boolean):[];
    if(!audio)throw Error('B站没有返回音轨。请确认视频能正常播放，再试一次。');
    return {site:'bili',title:view.title+(view.pages.length>1?' - '+part.part:''),audio:urls(audio),video:urls(videos[0]),referer:'https://www.bilibili.com/'};
  }
  if(url.hostname==='www.xiaohongshu.com'||url.hostname==='xiaohongshu.com'){
    const id=url.pathname.match(/\/(?:explore|discovery\/item|search_result)\/([a-f0-9]{24})/)?.[1]||url.searchParams.get('noteId');
    if(!id)throw Error('请先点开一篇小红书视频笔记。');
    const unwrap=x=>x?.value??x?._value??x;
    const state=unwrap(window.__INITIAL_STATE__);const noteState=unwrap(state?.note);const map=unwrap(noteState?.noteDetailMap);
    const item=unwrap(map?.[id]);let note=unwrap(item?.note);
    if(!note){const matching=Object.values(map||{}).map(unwrap).find(x=>unwrap(x?.note)?.noteId===id);note=unwrap(matching?.note);}
    const streams=unwrap(unwrap(unwrap(note?.video)?.media)?.stream)||{};const candidates=[];
    for(const list of Object.values(streams))for(const raw of Array.isArray(unwrap(list))?unwrap(list):[]){const s=unwrap(raw);const rank=Number(s.avgBitrate||s.videoBitrate||s.width*s.height||0);for(const u of [s.masterUrl,...(s.backupUrls||[])])if(u)candidates.push({url:u,rank});}
    const origin=unwrap(note?.video)?.consumer?.originVideoKey;
    if(typeof origin==='string'&&/^[a-zA-Z0-9_\-/]+$/.test(origin))candidates.unshift({url:'https://sns-video-bd.xhscdn.com/'+origin,rank:Number.MAX_SAFE_INTEGER});
    // Only a single visible player may supply a fallback, never arbitrary feed videos.
    if(!candidates.length){const visible=[...document.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;});if(visible.length===1){const src=visible[0].currentSrc||visible[0].src;if(/^https?:/.test(src))candidates.push({url:src,rank:0});}}
    if(!candidates.length)throw Error(note&&!note.video?'这是图文笔记，没有可下载的视频。':'没有读到这篇笔记的视频，请播放几秒后重试。');
    const video=[...new Set(candidates.sort((a,b)=>b.rank-a.rank).map(c=>c.url))];
    return {site:'xhs',title:note?.title||note?.desc?.slice(0,80)||document.title.replace(/\s*[-|]\s*小红书.*$/,''),video,referer:'https://www.xiaohongshu.com/'};
  }
  // Generic sites: inspect media elements and resource URLs seen by the current page.
  const video=[],audio=[],manifests=[],segments=[],seen=new Set();
  const add=(target,value)=>{if(typeof value!=="string"||!/^https?:\/\//i.test(value))return;try{const u=new URL(value,location.href);if(u.username||u.password)return;const clean=u.href;if(!seen.has(clean)){seen.add(clean);target.push(clean);}}catch{}};
  const classify=(value,type="")=>{
    if(typeof value!=="string"||!/^https?:\/\//i.test(value))return;
    const path=value.split(/[?#]/)[0].toLowerCase();
    if(/\.(m3u8|mpd)$/.test(path)){add(manifests,value);return;}
    if(/\.(m4s|ts|cmfv|cmfa)$/.test(path)){add(segments,value);return;}
    if(/\.(mp3|m4a|aac|oga|ogg|opus|wav|flac|weba)$/.test(path)||/audio\//i.test(type)){add(audio,value);return;}
    if(/\.(mp4|webm|mov|mkv|mpeg|mpg|ogv|3gp|m4v)$/.test(path)||/video\//i.test(type)){add(video,value);return;}
  };
  for(const el of document.querySelectorAll("video,audio")){
    const isVideo=el.tagName.toLowerCase()==="video";
    classify(el.currentSrc||el.src,isVideo?"video/*":"audio/*");
    for(const source of el.querySelectorAll("source"))classify(source.src,source.type||"");
  }
  for(const entry of performance.getEntriesByType("resource")){
    const name=entry.name;if(!/^https?:\/\//i.test(name))continue;const lower=name.toLowerCase();
    if(/\.(m3u8|mpd)(?:[?#]|$)/.test(lower)){add(manifests,name);continue;}
    if(/\.(m4s|ts|cmfv|cmfa)(?:[?#]|$)/.test(lower)){add(segments,name);continue;}
    if(/\.(mp3|m4a|aac|oga|ogg|opus|wav|flac|weba)(?:[?#]|$)/.test(lower)||/[?&](?:mime|mime_type)=audio(?:%2f|\/)/i.test(name)){add(audio,name);continue;}
    if(/\.(mp4|webm|mov|mkv|mpeg|mpg|ogv|3gp|m4v)(?:[?#]|$)/.test(lower)||/[?&](?:mime|mime_type)=video(?:%2f|\/)/i.test(name)||/googlevideo\.com\/videoplayback/i.test(name)){add(video,name);continue;}
  }
  const blobPlayers=[...document.querySelectorAll("video,audio")].filter(el=>(el.currentSrc||el.src||"").startsWith("blob:"));
  if(!video.length&&!audio.length&&!manifests.length&&!segments.length&&blobPlayers.length)throw Error("检测到网页播放器使用 blob: 临时地址，不能直接下载；该网站可能需要专门适配。");
  if(!video.length&&!audio.length&&!manifests.length&&!segments.length)throw Error("当前页面没有检测到可识别的媒体文件。请先播放几秒后重试。");
  return {site:"generic",title:document.title||"网页媒体",video,audio,manifests,segments,referer:location.origin+"/",pageUrl:location.href};
}
