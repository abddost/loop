#!/bin/bash
# Post-install hook wired into the .deb postinst and .rpm %post via
# `deb.afterInstall` / `rpm.afterInstall` in electron-builder.yml. Fixes two
# Linux realities that otherwise leave Loop unable to launch:
#
# 1. chrome-sandbox needs the SUID bit so Chromium's sandbox can drop privs
#    on startup. electron-builder's auto-postinst normally sets this, but
#    on cross-arch (arm64) builds the bit was missing in practice. Re-apply
#    unconditionally — idempotent and ~free.
#
# 2. Ubuntu 23.10+ ships kernel.apparmor_restrict_unprivileged_userns=1
#    (CVE-2023-32629 mitigation). Without an AppArmor profile granting
#    `userns,`, Chromium's GPU sub-process aborts at startup with
#    "GPU process isn't usable. Goodbye." — the same wall every Electron
#    app hits on stock Ubuntu 24.04. Bambu/Obsidian/OBS ship the same
#    profile from their postinst.
set -e

# 1. SUID on chrome-sandbox.
if [ -f /opt/Loop/chrome-sandbox ]; then
    chown root:root /opt/Loop/chrome-sandbox || true
    chmod 4755 /opt/Loop/chrome-sandbox || true
fi

# 2. AppArmor profile. The `userns,` rule is what unblocks the GPU sandbox.
# `unconfined` keeps the rest of the AppArmor enforcement off — Loop is a
# normal desktop app, not something we're trying to box in.
if [ -d /etc/apparmor.d ]; then
    cat > /etc/apparmor.d/loop <<'APPARMOR_EOF'
abi <abi/4.0>,
include <tunables/global>

profile loop /opt/Loop/loop flags=(unconfined) {
  userns,

  include if exists <local/loop>
}
APPARMOR_EOF

    # apparmor_parser is missing in containers and rootfs-only images.
    # Failing to reload isn't fatal — the profile will be picked up on
    # next AppArmor restart / reboot.
    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -r /etc/apparmor.d/loop 2>/dev/null || true
    fi
fi

exit 0
