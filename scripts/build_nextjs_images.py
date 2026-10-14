#!/usr/bin/env python3
"""Build pinned Mox/web images and record immutable IDs and export checksums."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess
from prepare_mox_source import ensure_mox_source
ROOT = pathlib.Path(__file__).resolve().parents[1]

def run(args):
    subprocess.run(args, cwd=ROOT, check=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--platform',choices=['linux/amd64','linux/arm64']);p.add_argument('--export',action='store_true');args=p.parse_args()
    ensure_mox_source(ROOT)
    output=ROOT/'artifacts/nextjs';output.mkdir(parents=True,exist_ok=True)
    platform=args.platform or 'linux/'+json.loads(subprocess.check_output(['docker','info','--format','{{json .Architecture}}'])) .replace('aarch64','arm64').replace('x86_64','amd64')
    arch=platform.split('/')[1]
    refs={'mox':'mailstack-mox:nextjs-source6-'+arch,'web':'mailstack-web:nextjs-0.2.0-'+arch}
    # Tags are local build handles only. Deployment consumes the inspected ID
    # and, for offline transport, verifies the checksum of each saved archive.
    for service,ref in refs.items():
        file='docker/mox-nextjs/Dockerfile' if service=='mox' else 'apps/web/Dockerfile'
        run(['docker','build','--platform',platform,'-f',file,'-t',ref,'.'])
    manifest={'schema':1,'architecture':arch,'moxVersion':'v0.0.17-mailstack.6-nextjs','nextVersion':'16.4.0','images':{}}
    for service,ref in refs.items():
        image=json.loads(subprocess.check_output(['docker','image','inspect',ref]))[0]
        if image['Architecture']!=arch or not re.fullmatch(r'sha256:[a-f0-9]{64}',image['Id']):raise SystemExit('Image identity mismatch')
        entry={'id':image['Id'],'tag':ref}
        if args.export:
            archive=output/(service+'-'+arch+'.tar');run(['docker','save','-o',str(archive),ref]);entry['archive']=archive.name;entry['sha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
        manifest['images'][service]=entry
    path=output/('images-'+arch+'.json');path.write_text(json.dumps(manifest,indent=2)+'\n');print(str(path))

if __name__=='__main__':main()
