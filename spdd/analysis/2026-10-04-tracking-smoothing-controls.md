# Tracking smoothing controls analysis

User feedback: the initial filter removes too much movement and adds lag. The 1 Hz minimum cutoff is too low as a tracking default. Use 5 Hz and beta 0.5 as lighter starting values, and expose per-source settings and bypass.

Do not store tuning inside connection config: setTrackingConfig changes generation and restarts sockets or camera. Add optional smoothing settings to tracking assets with a dedicated validated operation. Missing settings use new defaults. Preserve packet time, counter and stale-fade behavior. Retain the latest raw sample to apply tuning and bypass immediately.
