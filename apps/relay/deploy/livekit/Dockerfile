# Build context: apps/relay/deploy/livekit. Fly Machines do not mount local files, so the config goes into the image.
# livekit-server reads NODE_IP (--node-ip) and LIVEKIT_KEYS (--keys, "key: secret") from the environment,
# and these override the config file.
FROM livekit/livekit-server:latest

COPY fly-livekit.yaml /etc/livekit.yaml

EXPOSE 7880/tcp
EXPOSE 7882/udp

ENTRYPOINT ["/livekit-server"]
CMD ["--config", "/etc/livekit.yaml"]
