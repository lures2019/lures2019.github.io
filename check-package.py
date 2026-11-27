import hashlib, json, pathlib, sys
bundle=pathlib.Path(sys.argv[1])
manifest=json.loads(pathlib.Path('app-hashes.json').read_text(encoding='utf8'))
root=bundle/'resources/app'
actual={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
assert actual==manifest, 'App resources differ from tested Windows package'
