# Backend build Stage
FROM golang:1.25.0-alpine AS backend
WORKDIR /backend-build
RUN apk --no-cache add git
ENV GOPROXY=direct
COPY go.mod go.sum ./
ENV GOCACHE=/go-cache
ENV GOMODCACHE=/gomod-cache 
COPY . .

RUN --mount=type=cache,target=/gomod-cache --mount=type=cache,target=/go-cache \
	go build -ldflags="-s -w" -o res_mon ./main.go

FROM alpine:latest AS runtime
WORKDIR /app
RUN apk add --no-cache tzdata 
ENV TZ="UTC"
COPY --from=backend /backend-build/resources_monitor /app/resources_monitor
ENTRYPOINT [ "/app/res_mon" ]
