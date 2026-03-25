#!/bin/bash
echo ""
echo "  ===================================================="
echo "   NexRCM - One-Click Setup for Mac/Linux"
echo "  ===================================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "  [ERROR] Docker is NOT installed."
    echo ""
    echo "  Install Docker Desktop:"
    echo "  Mac:   https://www.docker.com/products/docker-desktop/"
    echo "  Linux: sudo apt install docker.io docker-compose  (Ubuntu/Debian)"
    echo "         sudo yum install docker docker-compose      (CentOS/RHEL)"
    echo ""
    echo "  Then run this script again."
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "  [ERROR] Docker is installed but NOT RUNNING."
    echo "  Open Docker Desktop and wait until it says 'Running'."
    exit 1
fi

echo "  [OK] Docker is installed and running!"
echo ""
echo "  Starting NexRCM... (2-5 minutes first time)"
echo ""

# Start everything
docker-compose up --build -d

if [ $? -ne 0 ]; then
    echo ""
    echo "  [ERROR] Failed to start. Try:"
    echo "  1. sudo docker-compose up --build -d"
    echo "  2. docker-compose down && docker-compose up --build -d"
    exit 1
fi

echo ""
echo "  ===================================================="
echo "   NexRCM is RUNNING!"
echo "  ===================================================="
echo ""
echo "   Open: http://localhost:3000"
echo ""
echo "   Login:"
echo "   Email:    admin@summithealthmg.com"
echo "   Password: NexRCM2024!"
echo ""
echo "   Stop:    docker-compose down"
echo "   Restart: docker-compose up -d"
echo "   Logs:    docker-compose logs -f"
echo ""
echo "  ===================================================="

# Try to open browser
if command -v open &> /dev/null; then
    open http://localhost:3000
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
fi
