#!/bin/sh
set -eu
case "${AMAP_JS_KEY:-}" in ''|*[!a-zA-Z0-9]*) echo 'Set a valid AMAP_JS_KEY.' >&2; exit 1;; esac
case "${AMAP_SECURITY_CODE:-}" in ''|*[!a-zA-Z0-9]*) echo 'Set a valid AMAP_SECURITY_CODE.' >&2; exit 1;; esac
[ -s /etc/nginx/certs/server.crt ] && [ -s /etc/nginx/certs/server.key ] || {
  echo 'Install the domain TLS certificate before starting.' >&2; exit 1;
}
envsubst '${AMAP_SECURITY_CODE}' < /etc/xingjian/default.conf.template > /etc/nginx/conf.d/default.conf
printf 'window.XJ_MAP_CONFIG={provider:"amap",amapKey:"%s",serviceHost:"/_AMapService"};\n' "$AMAP_JS_KEY" > /usr/share/nginx/html/map-config.js
nginx -t
exec nginx -g 'daemon off;'
