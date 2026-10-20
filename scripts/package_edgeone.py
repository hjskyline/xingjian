"""Package the browser app + EdgeOne functions; keep credentials in Tencent env."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / 'work/xingjian-edgeone.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for folder, prefix in [('dist', ''), ('edge-functions', 'edge-functions')]:
        for file in sorted((root / folder).rglob('*')):
            if not file.is_file():
                continue
            name = str(Path(prefix) / file.relative_to(root / folder))
            if name == 'map-config.js':
                archive.writestr(name, 'window.XJ_MAP_CONFIG={provider:"amap",remoteConfig:"api/map-config",serviceHost:"/_AMapService"};\n')
            else:
                archive.write(file, name)
print(f'Prepared {output.name}; official AMap configuration comes from server environment variables, no secrets included.')
