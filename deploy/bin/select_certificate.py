#!/usr/bin/env python3
"""Find an existing, trusted, sufficiently valid lineage without modifying it."""
import argparse, json, pathlib
from tls_deploy import validate

def select(names,root=pathlib.Path('/etc/letsencrypt/live')):
    for lineage in sorted(root.iterdir()) if root.is_dir() else []:
        if not lineage.is_dir():continue
        try:validate(lineage,names)
        except Exception:continue
        return str(lineage)
    return None
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('names',nargs='+');a=p.parse_args();print(json.dumps({'lineage':select(a.names)}))
