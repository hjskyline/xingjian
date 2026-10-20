FROM nginx:stable-alpine
COPY dist/ /usr/share/nginx/html/
COPY deploy/nginx/default.conf.template /etc/xingjian/default.conf.template
COPY deploy/nginx/entrypoint.sh /xingjian-entrypoint.sh
RUN chmod 755 /xingjian-entrypoint.sh
ENTRYPOINT ["/xingjian-entrypoint.sh"]
