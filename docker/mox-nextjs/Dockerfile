FROM --platform=$BUILDPLATFORM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS build
ENV GOSUMDB=sum.golang.org GOTOOLCHAIN=local GOFLAGS=-mod=readonly CGO_ENABLED=0
WORKDIR /src
COPY artifacts/vendor/mox-v0.0.17-source.tar.gz /tmp/mox.tar.gz
RUN echo '22f0d7deeaef6e8bae21f98e37ebcff7d18499591638b89eff484eb7fd06ea37  /tmp/mox.tar.gz' | sha256sum -c - \
 && tar -xzf /tmp/mox.tar.gz --strip-components=1 -C /src
COPY docker/mox/go.mod docker/mox/go.sum ./
COPY docker/mox/mailstack.patch /tmp/mailstack.patch
RUN git apply --check /tmp/mailstack.patch && git apply /tmp/mailstack.patch
COPY docker/mox-nextjs/subject.patch /tmp/subject.patch
RUN git apply --unidiff-zero --check /tmp/subject.patch && git apply --unidiff-zero /tmp/subject.patch
COPY docker/mox-nextjs/folders.patch /tmp/folders.patch
RUN git apply --unidiff-zero --check /tmp/folders.patch && git apply --unidiff-zero /tmp/folders.patch
COPY docker/mox-nextjs/drafts.patch /tmp/drafts.patch
RUN git apply --unidiff-zero --check /tmp/drafts.patch && git apply --unidiff-zero /tmp/drafts.patch
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -buildvcs=false -ldflags='-X github.com/mjl-/mox/moxvar.BuildVersion=v0.0.17-mailstack.6-nextjs' -o /out/mox .

# Optional CI target: tests need Linux's case-sensitive filesystem, not a
# macOS bind mount, because message directory names are case-sensitive.
# GOOS/GOARCH above apply only to production compilation; tests run natively.
FROM build AS regression
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build go test -count=1 -p 1 ./message

FROM build AS test
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
 go test -p 1 ./...

# Preserve the upstream CA roots/timezones/users; executable is rebuilt above.
FROM r.xmox.nl/mox:v0.0.17@sha256:8889e7b48fdd5b0b07b51dd11a6d06536334ec442652f2ffb1e1df3a9d45074e
# Alpine 3.24 signed repositories: CVE-2026-14456 is fixed in >=3.5.8.
# zlib 1.3.2-r1 fixes CVE-2026-85091. Keep the reviewed Mox executable.
RUN apk add --no-cache --upgrade libcrypto3=3.5.9-r0 libssl3=3.5.9-r0 zlib=1.3.2-r1
LABEL org.mailstack.mox.source-patch="6-nextjs" org.mailstack.mox.runtime-patch="nextjs.1"
COPY --from=build /out/mox /bin/mox
