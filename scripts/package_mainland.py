"""Create a hosting handoff archive without credentials or personal local data."""
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[1]
output = root / 'work/xingjian-mainland.tar.gz'
output.parent.mkdir(exist_ok=True)
files = [p for p in (root / 'dist').rglob('*') if p.is_file()]
files += [root / p for p in ['compose.yaml', '.env.example', '.dockerignore',
          'deploy/Dockerfile', 'deploy/nginx/default.conf.template',
          'deploy/nginx/entrypoint.sh', 'docs/mainland-hosting.md',
          'LICENSE', 'ATTRIBUTION.md']]
with tarfile.open(output, 'w:gz') as archive:
    for file in files:
        archive.add(file, arcname=str(file.relative_to(root)))
print(f'Prepared {len(files)} files in {output.name}; no credentials included.')
