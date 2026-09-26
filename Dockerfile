# The API image.
#
# Two stages: one that has the whole monorepo and a toolchain, and one that ships almost nothing.
# The API is bundled by esbuild into a single `dist/server.js` with the workspace packages
# inlined, so the runtime stage needs the built file, the third-party dependencies, and nothing
# else - no TypeScript, no source, no test fixtures, no mobile app.
#
# That last one is the reason the dependency install is done the way it is below rather than with
# a plain `npm ci --omit=dev` at the root. This is an npm workspaces repo, and `apps/mobile` has
# Expo and React Native as *production* dependencies. A root prod install therefore drags several
# hundred megabytes of a mobile app into an image that serves HTTP, which is slower to pull,
# slower to start and a much larger surface to keep patched.

# ---------------------------------------------------------------------------- build
FROM node:20-alpine AS build
WORKDIR /repo

# Manifests first, so the dependency layer is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/

# The full install, lockfile-exact, because this stage builds and is thrown away.
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api

RUN npm run build --workspace packages/core --if-present \
 && npm run build --workspace apps/api

# The runtime dependency tree, resolved on its own.
#
# `@hyperlocal/core` is removed because esbuild has already inlined it - asking npm for a
# workspace package outside the workspace would fail, and installing it would be dead weight.
#
# The honest caveat: this resolves from `apps/api/package.json` rather than from the root
# lockfile, so the versions are the caret ranges rather than the exact pins CI tested with. The
# alternative was shipping the mobile dependency tree, and this is the lesser of the two. If
# exact pinning matters more later, the fix is a lockfile committed per deployable package, not
# a bigger image.
RUN mkdir /runtime \
 && cp apps/api/package.json /runtime/package.json \
 && cd /runtime \
 && node -e "const p=require('./package.json'); delete p.dependencies['@hyperlocal/core']; delete p.devDependencies; delete p.scripts; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));" \
 && npm install --omit=dev --no-audit --no-fund

# -------------------------------------------------------------------------- runtime
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Fastify has to listen on every interface: bound to localhost it is unreachable from outside
# the container, which presents as a container that starts cleanly and serves nobody.
ENV API_HOST=0.0.0.0
ENV API_PORT=4000

# `tini` because node as PID 1 does not reap children or forward signals the way an init does,
# and without it SIGTERM on deploy becomes SIGKILL after the grace period - which cuts requests
# off mid-flight instead of draining them.
RUN apk add --no-cache tini

COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
# Migrations travel with the image so the version that runs is the version that was built.
COPY --from=build /repo/supabase/migrations ./supabase/migrations
COPY --from=build /repo/scripts/apply-migrations.mjs ./scripts/apply-migrations.mjs

# The `node` user ships with the image. Root inside a container is still root if something
# escapes, and nothing here needs to write to the filesystem.
USER node

EXPOSE 4000

# Liveness only, and on purpose. `/health` answers from the process alone, while `/ready` is the
# readiness signal and consults the database. A container healthcheck that fails on a database
# blip restarts every container at once, which turns a short outage into a long one.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
