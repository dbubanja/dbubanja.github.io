from pathlib import Path
import shutil,json
root=Path(__file__).resolve().parent.parent
out=root/'dist'
out.mkdir(exist_ok=True)
for name in ['index.html','manifest.webmanifest','sw.js','rates.json','counter-config.json','Pregled_stopa_CBCG.html','.nojekyll']:
 shutil.copy2(root/name,out/name)
for name in ['js','css','fonts','icons','lib']:
 shutil.copytree(root/name,out/name,dirs_exist_ok=True)
print('Static build ready: dist')
