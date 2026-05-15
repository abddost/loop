#!/bin/bash
# Post-remove hook wired into the .deb postrm and .rpm %postun via
# `deb.afterRemove` / `rpm.afterRemove` in electron-builder.yml.
#
# Called on both full removal AND upgrade — postrm receives different
# args depending on which. We only want to clean up on actual removal:
# during an upgrade, the new package's postinst will recreate the symlink
# and profile a moment later.
#
#   deb postrm args: "remove" | "purge" | "upgrade" | "failed-upgrade" | ...
#   rpm %postun args: "1" (upgrade), "0" (final removal)
set -e

case "$1" in
    remove|purge|0)
        rm -f /usr/bin/loop
        rm -f /etc/apparmor.d/loop

        if command -v update-desktop-database >/dev/null 2>&1; then
            update-desktop-database /usr/share/applications 2>/dev/null || true
        fi
        ;;
esac

exit 0
