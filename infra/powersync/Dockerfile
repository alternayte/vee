# SPDX-License-Identifier: AGPL-3.0-or-later
# PowerSync with its config inside the image. Coolify does not mount files
# from the repo, so the config ships in the build.
FROM journeyapps/powersync-service:1.27.2
COPY powersync.yaml sync-config.yaml /app/
