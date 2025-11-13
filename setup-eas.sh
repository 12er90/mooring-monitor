#!/bin/bash
# Mooring Monitor - EAS Build Setup Script

echo "🚀 Mooring Monitor - EAS Build Setup"
echo "===================================="

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js first."
    exit 1
fi

# Check if eas is installed globally
if ! command -v eas &> /dev/null; then
    echo "📦 Installing EAS CLI globally..."
    npm install -g eas-cli
fi

echo "✅ EAS CLI is installed"

# Change to mobile-app directory
cd "$(dirname "$0")/mobile-app" || exit

echo "📱 Installing mobile app dependencies..."
npm install

echo ""
echo "✅ Setup Complete!"
echo ""
echo "🔗 Next Steps:"
echo "1. Login to Expo: eas login"
echo "2. Build Android: eas build --platform android"
echo "3. Build iOS: eas build --platform ios"
echo "4. Build Both: eas build --platform all"
echo ""
echo "📖 For more info, read README.md in mobile-app/"
echo ""
