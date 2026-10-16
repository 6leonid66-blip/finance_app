#!/bin/sh
set -eu
# Run on the dedicated finance server. No credentials are passed to this script.
IP=142.93.99.71
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx python3-venv
python3 -m venv /opt/finance-certbot
/opt/finance-certbot/bin/pip install --disable-pip-version-check 'certbot>=5.4,<7'
mkdir -p /var/www/finance-acme
cat > /etc/nginx/sites-available/finance-sync <<'NGINX'
server {
  listen 80 default_server;
  server_name 142.93.99.71;
  location /.well-known/acme-challenge/ { root /var/www/finance-acme; }
  location / { return 308 https://142.93.99.71$request_uri; }
}
NGINX
if [ -L /etc/nginx/sites-enabled/default ]; then unlink /etc/nginx/sites-enabled/default; fi
ln -sfn /etc/nginx/sites-available/finance-sync /etc/nginx/sites-enabled/finance-sync
nginx -t
systemctl enable --now nginx
systemctl reload nginx
ufw allow 80/tcp
ufw allow 443/tcp
/opt/finance-certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --preferred-profile shortlived --webroot --webroot-path /var/www/finance-acme --ip-address "$IP" --cert-name finance-sync-ip
cat >> /etc/nginx/sites-available/finance-sync <<'NGINX'
server {
  listen 443 ssl;
  server_name 142.93.99.71;
  ssl_certificate /etc/letsencrypt/live/finance-sync-ip/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/finance-sync-ip/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 16k;
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options nosniff always;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
  }
}
NGINX
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/finance-nginx
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/finance-nginx
cat > /etc/systemd/system/finance-cert-renew.service <<'UNIT'
[Unit]
Description=Renew finance sync IP certificate
[Service]
Type=oneshot
ExecStart=/opt/finance-certbot/bin/certbot renew --quiet
UNIT
cat > /etc/systemd/system/finance-cert-renew.timer <<'UNIT'
[Unit]
Description=Check finance sync certificate twice daily
[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=3600
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now finance-cert-renew.timer
nginx -t
systemctl reload nginx
/opt/finance-certbot/bin/certbot renew --dry-run --run-deploy-hooks
