"""One-time server setup; never prints credentials and preserves encryption keys."""
import base64
import os
from pathlib import Path
import secrets

os.umask(0o077)
target = Path('/opt/finance-app/sync-worker/.env')
transfer = Path('/root/finance-sync-key.transfer')
old = dict(line.split('=', 1) for line in target.read_text().splitlines() if '=' in line) if target.exists() else {}
key = transfer.read_text().strip()
if not key.startswith('sb_secret_') or '\n' in key:
    raise ValueError('Invalid dedicated server key format')
values = {
    'APP_ORIGIN': 'https://finance-app-six-ivory.vercel.app',
    'SUPABASE_URL': 'https://qtaotqswcxhqhcefosar.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': key,
    'SYNC_ENCRYPTION_KEY': old.get('SYNC_ENCRYPTION_KEY') or base64.b64encode(secrets.token_bytes(32)).decode(),
    'SYNC_DATA_DIR': '/data', 'HOST': '0.0.0.0', 'PORT': '8787',
}
target.write_text(''.join(f'{name}={value}\n' for name, value in values.items()))
target.chmod(0o600)
transfer.unlink()
print('Server configuration saved with mode 0600; transfer removed.')
