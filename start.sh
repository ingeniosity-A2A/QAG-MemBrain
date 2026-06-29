#!/bin/bash
set -e
echo "🚀 AVA007 ON-DEVICE SOVEREIGN RUNTIME"
echo "--------------------------------------------------"
npm install
cd apps/mobile && npm install && cd ../..
cd services/orchestration && mvn clean package -DskipTests && cd ../..
docker-compose up -d --build
sleep 15
echo "🔍 Health checks..."
for svc in "Neo4j:7474" "Tools:5000/health" "Cave:5001/health" "Hermes:8081/health"; do
  name="${svc%:*}"
  endpoint="${svc#*:}"
  echo -n "$name... "
  curl -s "http://localhost:$endpoint" > /dev/null && echo "✅" || echo "❌"
done
echo "--------------------------------------------------"
echo "🎉 System active. Build Capacitor app: cd apps/mobile && npx cap sync android"