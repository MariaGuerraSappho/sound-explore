import { convertBlobToWav } from './audio-convert.js';

export class Exporter {
  async createZip({ recordings, mapPositions, mapBackgroundUrl }) {
    const zip = new JSZip();
    const soundsFolder = zip.folder('sounds');
    const thumbsFolder = zip.folder('thumbnails');
    const photosFolder = zip.folder('photos');
    const imagesFolder = zip.folder('images');

    const sanitize = (s) => s.replace(/[^a-z0-9\\-_\\s]/gi, '').trim().replace(/\\s+/g, '_');
    const toBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

    const items = [];
    for (const rec of recordings) {
      const label = rec.label || 'Untitled_Sound';
      const name = `${new Date(rec.timestamp).toISOString().slice(0,10)}_${sanitize(label)}_${rec.id}`;
      const audioBlob = await convertBlobToWav(rec.audioBlob);
      const thumbBlob = await toBlob(rec.thumbnail);

      soundsFolder.file(`${name}.wav`, audioBlob);
      thumbsFolder.file(`${name}.png`, thumbBlob);

      let photoPath = null;
      if (rec.photoDataUrl) {
          photoPath = `photos/${name}.jpg`;
          const photoBlob = await toBlob(rec.photoDataUrl);
          photosFolder.file(`${name}.jpg`, photoBlob);
      }

      items.push({
        id: rec.id,
        label: rec.label,
        tags: rec.tags,
        timestamp: rec.timestamp,
        durationMs: rec.duration,
        audio: `sounds/${name}.wav`,
        thumbnail: `thumbnails/${name}.png`,
        photo: photoPath,
        map: mapPositions[rec.id] || null
      });
      // per-sound note with tags
      const note = `Label: ${rec.label}\nDate: ${new Date(rec.timestamp).toLocaleString()}\nDuration: ${Math.round(rec.duration/1000)}s\nTags: ${(rec.tags||[]).join(', ') || 'None'}\nFile: ${name}.wav\n`;
      soundsFolder.file(`${name}.txt`, note);
    }

    if (mapBackgroundUrl) {
      const mapBlob = await toBlob(mapBackgroundUrl);
      imagesFolder.file('map.png', mapBlob);
    }

    zip.file('metadata.json', JSON.stringify({ items }, null, 2));
    // CSV summary
    const csv = ['id,label,timestamp,duration_seconds,tags,audio,thumbnail,photo,x,y,color'].concat(
      items.map(it => [
        it.id,
        `"${(it.label||'').replace(/"/g,'""')}"`,
        new Date(it.timestamp).toISOString(),
        Math.round((it.durationMs||0)/1000),
        `"${(it.tags||[]).join('|').replace(/"/g,'""')}"`,
        it.audio,
        it.thumbnail,
        it.photo ?? '',
        it.map?.x ?? '',
        it.map?.y ?? '',
        it.map?.color ?? ''
      ].join(','))
    ).join('\n');
    zip.file('summary.csv', csv);
    // README
    zip.file('README.txt', 'Sound Explorer Package\n\nHow to use:\n1) Unzip this folder.\n2) Open map.html in your browser.\n3) Click colored pins or list Play buttons.\nAll audio, thumbnails, and tag notes are included.\n');

    zip.file('map.html', this._mapHtml(!!mapBackgroundUrl, items));

    const blob = await zip.generateAsync({ type: 'blob' });
    return { blob, filename: `sound-explorer-package-${Date.now()}.zip` };
  }

  _mapHtml(hasBg, items) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sound Explorer Package</title>
<style>
  body{font-family:Noto Sans,system-ui,Arial;background:#fff;color:#111;margin:0}
  header{padding:16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:10}
  h1{font-size:24px;margin:0}
  .container{padding:16px;display:grid;grid-template-columns:1fr;gap:16px}
  .map{position:relative;background:#fafafa;border:1px solid #eee;border-radius:12px;min-height:360px;overflow:hidden}
  .map img{width:100%;height:100%;object-fit:contain}
  .overlay{position:absolute;inset:0}
  .pin{position:absolute;width:40px;height:40px;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 6px 16px rgba(0,0,0,.15);cursor:pointer;border:2px solid rgba(255,255,255,.9)}
  .pin:hover{transform:translate(-50%,-50%) scale(1.05)}
  .pin-label{position:absolute;bottom:-28px;left:50%;transform:translateX(-50%);font-size:12px;background:rgba(0,0,0,.8);color:#fff;padding:2px 6px;border-radius:6px;white-space:nowrap}
  .list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
  .card{border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff}
  .thumb{width:100%;height:140px;object-fit:cover;background:#000}
  .content{padding:12px}
  .label{font-weight:700;margin-bottom:6px}
  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .tag{font-size:12px;background:#f7f7f7;border:1px solid #eee;border-radius:999px;padding:4px 8px}
  .controls{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  button{padding:8px 12px;border-radius:8px;border:1px solid #ddd;background:#111;color:#fff;cursor:pointer}
  button.secondary{background:#fff;color:#111}
  .note{font-size:12px;color:#555;margin-top:6px}
</style>
</head><body>
<header>
  <h1>Sound Explorer Package</h1>
  <div>
    <button id="playAll" class="secondary">Play All</button>
    <a href="summary.csv" class="secondary" style="text-decoration:none;padding:8px 12px;border:1px solid #ddd;border-radius:8px;margin-left:8px">Download CSV</a>
  </div>
</header>
<div class="container">
  <div class="map">${hasBg ? '<img src="images/map.png" alt="Map">' : ''}<div class="overlay" id="overlay"></div></div>
  <div class="list" id="list"></div>
</div>
<script>
  const ITEMS = ${JSON.stringify(items)};
  (function(){
    const overlay = document.getElementById('overlay'); const list = document.getElementById('list');
    function play(src){ audio.src = src; audio.play(); }
    function makePin(item){
      const d = item.map || {x: 15 + (parseInt(item.id)%70), y: 20 + (parseInt(item.id)%60), color: 'hsl(' + (parseInt(item.id)%360) + ',75%,55%)'};
      const el = document.createElement('div'); el.className='pin';
      el.style.left = d.x + '%'; el.style.top = d.y + '%'; el.style.background = d.color || 'hsl(' + (parseInt(item.id)%360) + ',75%,55%)';
      const label = document.createElement('div'); label.className='pin-label'; label.textContent = item.label; el.appendChild(label);
      el.title = 'Tags: ' + ((item.tags||[]).join(', ') || 'None');
      el.addEventListener('click', ()=> play(item.audio));
      return el;
    }
    function card(item){
      const c = document.createElement('div'); c.className='card';
      const img = document.createElement('img'); img.className='thumb'; img.src=item.photo || item.thumbnail; img.alt=item.label; c.appendChild(img);
      const ct = document.createElement('div'); ct.className='content';
      const h = document.createElement('div'); h.className='label'; h.textContent=item.label; ct.appendChild(h);
      const meta = document.createElement('div'); meta.style.fontSize='12px'; meta.style.color='#555'; meta.textContent = new Date(item.timestamp).toLocaleString() + ' • ' + Math.round((item.durationMs||0)/1000) + 's'; ct.appendChild(meta);
      const tags = document.createElement('div'); tags.className='tags';
      (item.tags||[]).forEach(t=>{ const s=document.createElement('span'); s.className='tag'; s.textContent=t; tags.appendChild(s); }); ct.appendChild(tags);
      const note = document.createElement('div'); note.className='note'; note.textContent = (item.tags&&item.tags.length) ? 'Tags: ' + item.tags.join(', ') : 'No tags'; ct.appendChild(note);
      const ctrl = document.createElement('div'); ctrl.className='controls';
      const p = document.createElement('button'); p.textContent='Play'; p.addEventListener('click', ()=> play(item.audio));
      const dl = document.createElement('a'); dl.textContent='Download'; dl.className='secondary'; dl.href=item.audio; dl.download=(item.label||'sound')+'.webm'; dl.style.textDecoration='none'; dl.style.display='inline-block'; dl.style.padding='8px 12px'; dl.style.border='1px solid #ddd'; dl.style.borderRadius='8px';
      const nt = document.createElement('a'); nt.textContent='Tags Note'; nt.className='secondary'; nt.href=item.audio.replace(/\\.wav$/i,'.txt'); nt.download=(item.label||'sound')+'_tags.txt'; nt.style.textDecoration='none'; nt.style.display='inline-block'; nt.style.padding='8px 12px'; nt.style.border='1px solid #ddd'; nt.style.borderRadius='8px';
      ctrl.appendChild(p); ctrl.appendChild(dl); ctrl.appendChild(nt); ct.appendChild(ctrl); c.appendChild(ct); return c;
    }
    const audio = new Audio();
    ITEMS.forEach(it=> overlay.appendChild(makePin(it)));
    ITEMS.forEach(it=> list.appendChild(card(it)));
    document.getElementById('playAll').addEventListener('click', async ()=>{
      for(const it of ITEMS){ await new Promise(r=>{ audio.onended=r; play(it.audio); }); }
    });
  })();
</script>
</body></html>`;
  }
}