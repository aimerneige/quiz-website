# 自部署镜像：一个静态链接的 Go 可执行文件，内置前端，数据保存在 /data。
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY embed.go ./
COPY src ./src
COPY migrations ./migrations
COPY server ./server
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/quiz-server ./server/cmd/quiz-server \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/quiz-server /quiz-server
COPY --from=build --chown=65532:65532 /out/data /data
ENV QUIZ_ADDR=:8080 QUIZ_DB=/data/quiz.db
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/quiz-server"]
