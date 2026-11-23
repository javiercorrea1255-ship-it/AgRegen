#!/bin/bash
set -e

npm install --legacy-peer-deps
npm run db:push --if-present || true
npx tsx scripts/seed-conferences.ts
npx tsx scripts/seed-mexico-soil.ts
