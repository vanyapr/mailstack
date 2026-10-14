#!/bin/sh
set -eu
# Only this owned API destination is filtered; other sites and mail ports are untouched.
iptables -N MSNX_API 2>/dev/null || true
iptables -C MSNX_API -i br-mailstack -s 172.30.95.2/32 -j ACCEPT 2>/dev/null || iptables -A MSNX_API -i br-mailstack -s 172.30.95.2/32 -j ACCEPT
iptables -C MSNX_API -j REJECT 2>/dev/null || iptables -A MSNX_API -j REJECT
iptables -C INPUT -d 172.30.95.1/32 -p tcp --dport 1080 -j MSNX_API 2>/dev/null || iptables -I INPUT -d 172.30.95.1/32 -p tcp --dport 1080 -j MSNX_API
