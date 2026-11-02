// Public GitHub release counts. No case data, identifiers or telemetry leave the device.
export async function getDownloadStats(config, fetcher = fetch) {
  if (!/^[A-Za-z0-9-]+$/.test(config.owner) || !/^[A-Za-z0-9._-]+$/.test(config.repository) || !config.assetPrefix) throw new Error('Неисправно подешавање бројача');
  const base = `https://api.github.com/repos/${config.owner}/${config.repository}`;
  const get = async path => {
    const response = await fetcher(base + path, {cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', headers:{Accept:'application/vnd.github+json'}});
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub је привремено ограничио број упита. Покушајте касније.' : `GitHub HTTP ${response.status}`);
    const data = await response.json(); if (!Array.isArray(data)) throw new Error('Неочекиван одговор GitHub-а'); return data;
  };
  const all = [];
  for (let page=1; ; page++) {
    const releases = await get(`/releases?per_page=100&page=${page}`);
    for (const r of releases.filter(r=>!r.draft)) {
      for (let aPage=1; ; aPage++) {
        const assets=await get(`/releases/${r.id}/assets?per_page=100&page=${aPage}`);
        for (const a of assets) if (a.name?.startsWith(config.assetPrefix) && /\.apk$/i.test(a.name)) {
          if (!Number.isSafeInteger(a.download_count) || a.download_count < 0) throw new Error('Неисправан број преузимања');
          all.push({id:a.id,name:a.name,tag:r.tag_name,count:a.download_count,url:a.browser_download_url});
        }
        if (assets.length < 100) break;
      }
    }
    if (releases.length < 100) break;
  }
  return {checkedAt:new Date().toISOString(), total:all.reduce((s,a)=>s+a.count,0), assets:all};
}
