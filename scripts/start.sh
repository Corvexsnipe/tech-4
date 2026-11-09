#!/bin/sh
# Production entrypoint: apply migrations (retrying while the database is
# still coming up or temporarily unreachable), then serve. A transient DB
# blip no longer crash-loops the container.
attempt=0
until npx prisma migrate deploy; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 12 ]; then
    echo "prisma migrate deploy failed after $attempt attempts" >&2
    exit 1
  fi
  echo "prisma migrate deploy failed (attempt $attempt); retrying in 5s" >&2
  sleep 5
done
exec npm start
