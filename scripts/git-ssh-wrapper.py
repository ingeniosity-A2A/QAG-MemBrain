#!/usr/bin/env python3
import sys, os, paramiko, threading

args = sys.argv[1:]
host = None; port = 22; command = None
i = 0
while i < len(args):
    if args[i] == '-p' and i + 1 < len(args): port = int(args[i + 1]); i += 2
    elif '@' in args[i] and host is None: host = args[i]; i += 1
    else: command = ' '.join(args[i:]); break

if not host or not command: print(f"Usage: {sys.argv[0]} [-p port] user@host command", file=sys.stderr); sys.exit(1)

user, hostname = host.split('@', 1)
key_path = os.path.expanduser('~/.ssh/id_ed25519')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    pkey = paramiko.Ed25519Key.from_private_key_file(key_path)
    client.connect(hostname, port=port, username=user, pkey=pkey, timeout=30)
    transport = client.get_transport()
    channel = transport.open_session()
    channel.exec_command(command)

    def pipe_stdin():
        try:
            while True:
                data = os.read(0, 4096)
                if not data: channel.shutdown_write(); break
                channel.sendall(data)
        except: channel.shutdown_write()

    threading.Thread(target=pipe_stdin, daemon=True).start()

    while True:
        if channel.recv_ready():
            data = channel.recv(4096)
            if not data: break
            os.write(1, data)
        elif channel.recv_stderr_ready():
            data = channel.recv_stderr(4096)
            if data: os.write(2, data)
        elif channel.exit_status_ready():
            while channel.recv_ready():
                data = channel.recv(4096)
                if data: os.write(1, data)
            while channel.recv_stderr_ready():
                data = channel.recv_stderr(4096)
                if data: os.write(2, data)
            break

    sys.exit(channel.recv_exit_status())
except paramiko.ssh_exception.AuthenticationException as e:
    print(f"SSH Auth failed: {e}", file=sys.stderr); sys.exit(1)
except Exception as e:
    print(f"SSH error: {e}", file=sys.stderr); sys.exit(1)
finally:
    client.close()
