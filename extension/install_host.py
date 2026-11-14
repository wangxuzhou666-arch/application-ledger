"""Install a per-user native host after loading the unpacked extension.
Uses the current Python (must include openpyxl), no browser profile modifications.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import sys

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--extension-id",required=True)
    p.add_argument("--config",required=True,type=Path)
    p.add_argument("--host-dir",type=Path)
    p.add_argument("--install-dir",type=Path,default=Path.home()/".application-ledger/native")
    args=p.parse_args()
    if not re.fullmatch("[a-p]{32}",args.extension_id):p.error("Invalid Chrome extension ID")
    import openpyxl
    config=json.loads(args.config.read_text())
    for k in ("db","resume_root","master","answers"):
        if not Path(config[k]).exists():p.error("Missing configured path: "+k)
    origin="chrome-extension://"+args.extension_id+"/"
    config["extension_origin"]=origin
    os.umask(0o077)
    dest=args.install_dir.expanduser().resolve()
    dest.mkdir(parents=True,exist_ok=True)
    cfg=dest/"config.json"
    cfg.write_text(json.dumps(config,ensure_ascii=False,indent=2)+"\n");cfg.chmod(0o600)
    bridge=Path(__file__).resolve().parents[1]/"prepare_bridge.py"
    runner=dest/"prepare-host"
    runner.write_text("#!/bin/sh\nexport PYTHON_DOTENV_DISABLED=1\nexec "+shlex.quote(sys.executable)+" -B "+shlex.quote(str(bridge))+" --config "+shlex.quote(str(cfg))+' "$@"\n')
    runner.chmod(0o700)
    folder=args.host_dir
    if folder is None:
        if sys.platform=="darwin":folder=Path.home()/"Library/Application Support/Google/Chrome/NativeMessagingHosts"
        elif sys.platform.startswith("linux"):folder=Path.home()/".config/google-chrome/NativeMessagingHosts"
        else:p.error("Windows registration is not implemented")
    folder.mkdir(parents=True,exist_ok=True)
    manifest=folder/"org.application_ledger.prepare.json"
    manifest.write_text(json.dumps(dict(name="org.application_ledger.prepare",description="Approved application preparation",
        path=str(runner),type="stdio",allowed_origins=[origin]),indent=2)+"\n")
    manifest.chmod(0o600)
    print("Native host installed:",manifest)
    print("No application was opened, uploaded or submitted.")
if __name__=="__main__":main()
