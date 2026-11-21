import {createFile} from './vendor/mp4box.js';

// Keep all processing local. Limit buffered input to 512 MiB to avoid exhausting a tab.
export const MAX_BYTES=512*1024*1024;
export function mediaURL(value){
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&(!u.port||['80','443'].includes(u.port))&&['bilivideo.com','bilivideo.cn','xhscdn.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}
}
export function filename(title,mode){
  const safe=String(title||'视频').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').replace(/[. ]+$/,'').trim().slice(0,100)||'视频';
  return safe+(mode==='audio'?'.m4a':'.mp4');
}
function parse(buffer,kind){
  const file=createFile();const tracks=[];let error;
  file.onError=e=>{error=String(e);};
  file.onReady=info=>{
    for(const t of info.tracks.filter(t=>kind==='audio'?!!t.audio:!!t.video)){
      const track={info:t,entry:file.getTrackById(t.id).mdia.minf.stbl.stsd.entries[0],samples:[],edts:file.getTrackById(t.id).edts,movieScale:info.timescale};
      tracks.push(track);file.setExtractionOptions(t.id,track,{nbSamples:1000});
    }
    file.start();
  };
  file.onSamples=(id,track,samples)=>track.samples.push(...samples);
  buffer.fileStart=0;file.appendBuffer(buffer);file.flush();
  if(error)throw Error('媒体解析失败：'+error);
  if(!tracks.length)throw Error(kind==='audio'?'这个视频没有可提取的音轨。':'没有找到有效视频轨。');
  const track=tracks[0];
  if(!track.samples.length||track.samples.length!==track.info.nb_samples)throw Error('媒体数据不完整，请重新下载。');
  if(track.entry.type==='enca'||track.entry.type==='encv')throw Error('不支持加密媒体。');
  return track;
}
export function validateMedia(buffer,kind){parse(buffer,kind);}
export function remux(sources,mode){
  const tracks=sources.map(s=>parse(s.buffer,s.kind));
  if(mode==='video'&&!tracks.some(t=>t.info.video))throw Error('没有视频轨。');
  const out=createFile();const duration=Math.max(...tracks.map(t=>t.samples.reduce((end,s)=>Math.max(end,s.cts+s.duration),0)/t.info.timescale));
  out.init({timescale:1000,duration:Math.ceil(duration*1000),brands:['isom','iso6','mp41']});
  const samples=[];
  for(const track of tracks){
    const t=track.info;const id=out.addTrack({type:track.entry.type,hdlr:t.audio?'soun':'vide',timescale:t.timescale,media_duration:track.samples.reduce((end,s)=>Math.max(end,s.dts+s.duration),0),duration:Math.ceil(duration*1000),width:t.video?.width||0,height:t.video?.height||0,language:t.language});
    if(!id)throw Error('暂不支持此媒体编码：'+track.entry.type);
    const dest=out.getTrackById(id);dest.mdia.minf.stbl.stsd.entries[0]=track.entry;
    dest.tkhd.width=t.video?(t.video.width<<16):0;dest.tkhd.height=t.video?(t.video.height<<16):0;dest.tkhd.volume=t.audio?256:0;
    if(track.edts){for(const entry of track.edts.elst?.entries||[])entry.segment_duration=Math.round(entry.segment_duration/track.movieScale*1000);dest.addBox(track.edts);}
    for(const sample of track.samples)samples.push({id,sample,time:sample.dts/sample.timescale});
  }
  samples.sort((a,b)=>a.time-b.time);
  for(const {id,sample:s} of samples)out.addSample(id,s.data,{duration:s.duration,dts:s.dts,cts:s.cts,is_sync:s.is_sync});
  return out.getBuffer().buffer;
}
