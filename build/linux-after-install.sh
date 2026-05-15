#!/bin/bash
# Post-install hook wired into the .deb postinst and .rpm %post via
# `deb.afterInstall` / `rpm.afterInstall` in electron-builder.yml.
#
# Important: supplying afterInstall *replaces* electron-builder's default
# postinst template — it does not append. So this script must cover
# everything the default did (sandbox SUID, /usr/bin symlink, desktop
# database refresh) on top of our Ubuntu 24.04 AppArmor fix. Skipping any
# of these silently breaks installs (e.g., omitting the symlink leaves
# `loop` not on PATH even though /opt/Loop/loop is present).
set -e

# 1. /usr/bin/loop launcher symlink. Without this, the .desktop file's
#    Exec=/opt/Loop/loop %U still works from the GNOME app grid, but the
#    `loop` command isn't on PATH for terminal users. `ln -sf` is
#    idempotent across upgrades.
ln -sf /opt/Loop/loop /usr/bin/loop

# 2. SUID on chrome-sandbox so Chromium's sandbox can drop privs at
#    startup. The auto-generated postinst normally does this; we're
#    replacing that template so we do it explicitly.
if [ -f /opt/Loop/chrome-sandbox ]; then
    chown root:root /opt/Loop/chrome-sandbox || true
    chmod 4755 /opt/Loop/chrome-sandbox || true
fi

# 3. AppArmor profile granting `userns,` so Chromium's GPU sandbox can
#    initialize on Ubuntu 24.04+, which restricts unprivileged user
#    namespaces by default (CVE-2023-32629 mitigation). Without this,
#    Electron crashes at startup with FATAL "GPU process isn't usable.
#    Goodbye." — every Electron app hits this on stock Ubuntu 24.04.
#    Skipped automatically on distros without /etc/apparmor.d (Fedora,
#    RHEL, openSUSE).
if [ -d /etc/apparmor.d ]; then
    cat > /etc/apparmor.d/loop <<'APPARMOR_EOF'
abi <abi/4.0>,
include <tunables/global>

profile loop /opt/Loop/loop flags=(unconfined) {
  userns,

  include if exists <local/loop>
}
APPARMOR_EOF

    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -r /etc/apparmor.d/loop 2>/dev/null || true
    fi
fi

# 4. Refresh desktop / mime / icon caches so the .desktop entry and icon
#    appear in GNOME Activities without a re-login. Each tool may or may
#    not be present (minimal containers, server installs) — best effort.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache --quiet /usr/share/icons/hicolor 2>/dev/null || true
fi

exit 0
