#!/usr/bin/env bash

set -e

echo "======================================"
echo "EdgeChat Local Deploy to Cloudflare"
echo "======================================"
echo ""

# Check required environment variables
required_vars=("CLOUDFLARE_API_TOKEN" "CLOUDFLARE_ACCOUNT_ID")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Error: Missing required environment variable: $var"
        echo ""
        echo "Please set the following environment variables:"
        echo "  export CLOUDFLARE_API_TOKEN='your_api_token'"
        echo "  export CLOUDFLARE_ACCOUNT_ID='your_account_id'"
        echo ""
        echo "Optional environment variables:"
        echo "  export EDGECHAT_ADMIN_USERNAME='admin'"
        echo "  export EDGECHAT_ADMIN_PASSWORD='your_password'"
        echo "  export EDGECHAT_ADMIN_DISPLAY_NAME='Administrator'"
        exit 1
    fi
done

echo "✅ Environment variables check passed"
echo ""

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
npm ci
echo ""

# Step 2: Build frontend assets
echo "🔨 Building frontend assets..."
npm run build:frontend
echo ""

# Step 3: Ensure Cloudflare resources (D1, KV, R2)
echo "☁️  Ensuring Cloudflare resources..."
node .github/scripts/ensure-cloudflare-resources.mjs > /tmp/cf-resources-output.txt
cat /tmp/cf-resources-output.txt

# Parse outputs from the script
d1_database_name=$(grep "\[output\] d1_database_name=" /tmp/cf-resources-output.txt | cut -d'=' -f2)
d1_database_id=$(grep "\[output\] d1_database_id=" /tmp/cf-resources-output.txt | cut -d'=' -f2)
d1_created=$(grep "\[output\] d1_created=" /tmp/cf-resources-output.txt | cut -d'=' -f2)
kv_namespace_id=$(grep "\[output\] kv_namespace_id=" /tmp/cf-resources-output.txt | cut -d'=' -f2)

echo ""

# Step 4: Generate wrangler config
echo "⚙️  Generating wrangler config..."
cp wrangler.example.toml wrangler.toml
sed -i.bak "s|YOUR_D1_DATABASE_ID_HERE|$d1_database_id|g" wrangler.toml
sed -i.bak "s|YOUR_KV_NAMESPACE_ID_HERE|$kv_namespace_id|g" wrangler.toml
rm -f wrangler.toml.bak
echo "✅ Generated wrangler.toml"
echo ""

# Step 5: Initialize D1 schema (if database was just created)
if [ "$d1_created" = "true" ]; then
    echo "💾 Initializing D1 database schema..."
    npx wrangler d1 execute "$d1_database_name" --remote --file worker/schema.sql
    echo "✅ D1 schema initialized"
    echo ""
fi

# Step 6: Generate admin bootstrap SQL (optional)
if [ -n "$EDGECHAT_ADMIN_USERNAME" ] && [ -n "$EDGECHAT_ADMIN_PASSWORD" ]; then
    echo "👤 Generating admin user bootstrap SQL..."
    node .github/scripts/generate-admin-bootstrap-sql.mjs
    
    echo "📝 Applying admin user to database..."
    npx wrangler d1 execute "$d1_database_name" --remote --file .tmp/edgechat-admin-upsert.sql
    echo "✅ Admin user created/updated"
    echo ""
fi

# Step 7: Deploy worker
echo "🚀 Deploying Worker to Cloudflare..."
npx wrangler deploy
echo ""

echo "======================================"
echo "✅ Deployment completed successfully!"
echo "======================================"
echo ""
echo "Your EdgeChat app is now live on Cloudflare Workers."
echo ""
