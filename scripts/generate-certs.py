#!/usr/bin/env python3
"""Generate a persistent local CA and an HTTPS leaf certificate with OpenSSL."""
import ipaddress
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
private = root / 'deploy' / 'ca-private'
public = root / 'deploy' / 'certs'
names = list(dict.fromkeys(['virtual-ubuntu', 'localhost', '127.0.0.1', *sys.argv[1:]]))
sans = []
for name in names:
    try:
        sans.append(f'IP:{ipaddress.ip_address(name)}')
    except ValueError:
        if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', name):
            raise SystemExit(f'Invalid hostname or IP: {name!r}')
        sans.append(f'DNS:{name}')

os.umask(0o077)
private.mkdir(parents=True, exist_ok=True, mode=0o700)
public.mkdir(parents=True, exist_ok=True)
public.chmod(0o755)
ca_key = private / 'local-ca.key'
ca_cert = public / 'local-ca.crt'

def openssl(*args):
    subprocess.run(['openssl', *map(str, args)], check=True, stdout=subprocess.DEVNULL)

if ca_key.exists() != ca_cert.exists():
    raise SystemExit('CA key/certificate pair is incomplete. Restore the missing file; do not silently replace a trusted CA.')
if not ca_key.exists():
    openssl('req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650',
            '-keyout', ca_key, '-out', ca_cert,
            '-subj', '/CN=Workaholism Monitor Local CA',
            '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
            '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
    ca_cert.chmod(0o644)

with tempfile.TemporaryDirectory(dir=private) as temporary:
    temp = Path(temporary)
    key, csr, cert = temp / 'server.key', temp / 'server.csr', temp / 'server.crt'
    extensions = temp / 'extensions.cnf'
    extensions.write_text('\n'.join([
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth',
        'subjectAltName=' + ','.join(sans),
        'subjectKeyIdentifier=hash',
        'authorityKeyIdentifier=keyid,issuer',
    ]) + '\n')
    openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
            '-keyout', key, '-out', csr, '-subj', '/CN=virtual-ubuntu')
    openssl('x509', '-req', '-in', csr, '-CA', ca_cert, '-CAkey', ca_key,
            '-set_serial', '0x' + os.urandom(16).hex(), '-out', cert,
            '-days', '365', '-sha256', '-extfile', extensions)
    openssl('verify', '-CAfile', ca_cert, cert)
    key.replace(public / 'server.key')
    cert.replace(public / 'server.crt')
    (public / 'server.crt').chmod(0o644)
print('Certificate ready for: ' + ', '.join(names))
print(f'Import this public CA certificate on the client device: {ca_cert}')
