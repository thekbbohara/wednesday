#!/usr/bin/env bash
# Prepared only. Do not run until the owner explicitly approves the live restart.
set -euo pipefail
if [[ ${T48_OWNER_APPROVED:-} != 1 ]]; then
  echo 'Owner approval is required. This script has not stopped or started anything.' >&2
  exit 2
fi
review=/home/kb26/.jarvis/worktrees/runtimecredits-live-review
live_pid=${T48_LIVE_PID:-1468384}
python3 - "$review" "$live_pid" <<'PY'
import pathlib,json,hashlib,subprocess,sys,os
review=pathlib.Path(sys.argv[1]);pid=int(sys.argv[2]);live=pathlib.Path('/home/kb26/kb/jarvis')
d=json.loads((review/'reports/T48-integration/owner-manifest.json').read_text())
assert subprocess.check_output(['git','-C',str(live),'rev-parse','HEAD']).decode().strip()==d['liveHead'],'Live HEAD changed; rebuild integration first'
paths=set(subprocess.check_output(['git','-C',str(live),'diff','HEAD','--name-only','-z']).decode().strip('\0').split('\0'))|set(subprocess.check_output(['git','-C',str(live),'ls-files','--others','--exclude-standard','-z']).decode().strip('\0').split('\0'));paths.discard('')
assert paths==set(d['files']),'Owner edit inventory changed; rebuild integration first'
for p,v in d['files'].items():
 a=live/p
 if v.get('deleted'):assert not a.exists(),p
 elif 'symlink' in v:assert a.is_symlink() and os.readlink(a)==v['symlink'],p
 else:assert a.exists() and hashlib.sha256(a.read_bytes()).hexdigest()==v['sha256'] and oct(a.stat().st_mode&0o777)==v['mode'],p
p=live/'.env';assert (hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None)==d['envSha256'],'Owner environment file changed'
proc=pathlib.Path(f'/proc/{pid}')
assert (proc/'cwd').resolve()==live,'PID is no longer the original live checkout'
args=(proc/'cmdline').read_bytes().split(b'\0')
assert b'src/server.ts' in args and b'--env-file-if-exists=.env' in args,'PID is not the reviewed live server'
assert (review/'dist/index.html').exists(),'Integrated build is missing'
print('Owner files/environment unchanged; original live PID verified; integrated build exists.')
PY
# Stop only the verified Node server. The existing pnpm parent should exit with it.
kill -TERM "$live_pid"
for attempt in {1..50}; do
  if ! kill -0 "$live_pid" 2>/dev/null; then break; fi
  sleep 0.2
done
if kill -0 "$live_pid" 2>/dev/null; then
  echo 'Original server did not exit; refusing to start a second server.' >&2
  exit 1
fi
cd "$review"
# Use the owner's original environment file; remove inherited worker-specific routing.
exec env -u MAJORDOMO_AGENT -u MAJORDOMO_URL -u MAJORDOMO_SESSION -u MAJORDOMO_DB \
  -u MAJORDOMO_DATA_DIR -u CLAUDE_CONFIG_DIR -u HOST -u PORT -u ASSISTANT_NAME \
  /home/kb26/.local/share/pi-node/node-v22.23.2-linux-x64/bin/node \
  --env-file-if-exists=/home/kb26/kb/jarvis/.env \
  --disable-warning=ExperimentalWarning src/server.ts
