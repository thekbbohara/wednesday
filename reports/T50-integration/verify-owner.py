#!/usr/bin/env python3
import hashlib,json,pathlib,subprocess
m=json.loads((pathlib.Path(__file__).parent/'owner-manifest.json').read_text())
r=pathlib.Path(m['liveRoot'])
assert subprocess.check_output(['git','-C',str(r),'rev-parse','HEAD']).decode().strip()==m['liveHead'], 'Owner HEAD changed'
assert subprocess.check_output(['git','-C',str(r),'status','--porcelain']).decode()==m['statusPorcelain'], 'Owner inventory/status changed'
for name,v in m['files'].items():
 f=r/name
 assert f.is_file() and hashlib.sha256(f.read_bytes()).hexdigest()==v['sha256'], name+' content changed'
 assert oct(f.stat().st_mode & 0o777)==v['mode'], name+' permissions changed'
f=r/'.env'
assert hashlib.sha256(f.read_bytes()).hexdigest()==m['env']['sha256'], 'Owner .env changed'
assert oct(f.stat().st_mode & 0o777)==m['env']['mode'], 'Owner .env permissions changed'
print('All '+str(len(m['files']))+' owner files, .env, HEAD and status match the original snapshot.')
