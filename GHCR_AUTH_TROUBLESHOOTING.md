# GitHub Container Registry Authentication Troubleshooting

## Quick Fix: Step-by-Step

### Step 1: Create Personal Access Token (PAT)

1. Go to: https://github.com/settings/tokens/new
2. **Note/Description**: "GHCR Push Access"
3. **Expiration**: Choose your preference (90 days, 1 year, or no expiration)
4. **Select scopes** - Check these boxes:
   - ✅ `write:packages` (required to push)
   - ✅ `read:packages` (required to pull)
   - ✅ `delete:packages` (optional, for cleanup)
5. Click "Generate token" at the bottom
6. **COPY THE TOKEN NOW** - it starts with `ghp_...` (you can't see it again!)

### Step 2: Check if You Need Sudo

```bash
# Test if you can run docker without sudo
docker ps

# If you get "permission denied", you need sudo
# If it works, skip to Step 3
```

### Step 3a: If You Need Sudo

```bash
# Login WITH sudo
echo "ghp_YOUR_TOKEN_HERE" | sudo docker login ghcr.io -u vilenarios --password-stdin

# Should see: "Login Succeeded"

# Run push script WITH sudo
sudo ./push-to-ghcr.sh
```

### Step 3b: If You Don't Need Sudo (Recommended)

```bash
# Login WITHOUT sudo
echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u vilenarios --password-stdin

# Should see: "Login Succeeded"

# Run push script WITHOUT sudo
./push-to-ghcr.sh
```

### Step 4: Fix Docker Permissions (Optional, but Better)

If you're tired of using sudo:

```bash
# Add yourself to docker group
sudo usermod -aG docker $USER

# Apply changes WITHOUT logging out
newgrp docker

# Test - should work without sudo now
docker ps

# Login again (without sudo)
echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u vilenarios --password-stdin

# Now you can run without sudo
./push-to-ghcr.sh
```

## Common Errors and Solutions

### Error: "unauthorized: unauthenticated"

**Cause**: Not logged in, or logged in as wrong user

**Solution**:
```bash
# Check who you're logged in as
cat ~/.docker/config.json  # If not using sudo
sudo cat /root/.docker/config.json  # If using sudo

# Re-login with correct user
echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u vilenarios --password-stdin
```

### Error: "denied: permission_denied: write_package"

**Cause**: Token doesn't have `write:packages` permission

**Solution**:
1. Go to: https://github.com/settings/tokens
2. Find your token and click it
3. Make sure `write:packages` is checked
4. If not, create a new token with correct permissions

### Error: "Error saving credentials"

**Cause**: Docker credential helper issue

**Solution**:
```bash
# Remove credential helper temporarily
mkdir -p ~/.docker
cat > ~/.docker/config.json << 'EOF'
{
  "auths": {},
  "credsStore": ""
}
EOF

# Try login again
echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u vilenarios --password-stdin
```

### Error: "no such host: ghcr.io"

**Cause**: Network/DNS issue

**Solution**:
```bash
# Test connectivity
curl -I https://ghcr.io

# If that fails, check DNS
nslookup ghcr.io

# Try with different DNS
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

## Verify Login Status

```bash
# Check if logged in (without sudo)
docker login ghcr.io
# Should say: "Login Succeeded" or show you're already logged in

# Check credentials file
cat ~/.docker/config.json
# Should show "ghcr.io" in auths

# Test pull access
docker pull ghcr.io/vilenarios/ar-io-x402-bundler:latest 2>&1 | head -5
# Should start downloading or say "image is up to date"
```

## Manual Push (Without Script)

If the script keeps failing, try manually:

```bash
# 1. Login
echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u vilenarios --password-stdin

# 2. Build
docker build -t ghcr.io/vilenarios/ar-io-x402-bundler:latest .

# 3. Push
docker push ghcr.io/vilenarios/ar-io-x402-bundler:latest

# If push fails, check the exact error message
```

## Using Environment Variable for Token

For security, don't paste token in terminal history:

```bash
# Save token to file (secure)
echo "ghp_YOUR_TOKEN_HERE" > ~/.github_token
chmod 600 ~/.github_token

# Login using file
cat ~/.github_token | docker login ghcr.io -u vilenarios --password-stdin

# Or export as environment variable
export GITHUB_TOKEN=$(cat ~/.github_token)
echo $GITHUB_TOKEN | docker login ghcr.io -u vilenarios --password-stdin
```

## Sudo vs Non-Sudo Credential Locations

| User | Credentials Location |
|------|---------------------|
| Regular user | `~/.docker/config.json` |
| Root (sudo) | `/root/.docker/config.json` |

**Key Point**: If you login without sudo but run docker WITH sudo, it won't find your credentials!

**Solution**: Either:
- Login WITH sudo AND run WITH sudo
- Login WITHOUT sudo AND run WITHOUT sudo (recommended)

## Testing Token Permissions

```bash
# Test if token has correct permissions using GitHub API
curl -H "Authorization: Bearer ghp_YOUR_TOKEN_HERE" \
  https://api.github.com/user/packages?package_type=container

# Should return JSON (even if empty array)
# If error, token doesn't have read:packages
```

## Still Not Working?

### Check These:

1. **Token is Classic PAT, not Fine-grained**
   - GitHub has two types of tokens
   - Use "Personal access tokens (classic)" for GHCR
   - Fine-grained tokens have different permission model

2. **Username is correct**
   - Must be your GitHub username: `vilenarios`
   - Not your email address

3. **Registry URL is correct**
   - Must be exactly: `ghcr.io`
   - Not `docker.pkg.github.com` (old registry)

4. **Token hasn't expired**
   - Check: https://github.com/settings/tokens
   - Create new one if expired

### Last Resort: Docker Reset

```bash
# Logout completely
docker logout ghcr.io

# Remove all Docker credentials
rm -f ~/.docker/config.json
sudo rm -f /root/.docker/config.json

# Restart Docker daemon
sudo systemctl restart docker

# Login fresh
echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u vilenarios --password-stdin

# Try push again
./push-to-ghcr.sh
```

## Contact Info

If still having issues, check:
- GitHub Status: https://www.githubstatus.com/
- Docker Hub Status: https://status.docker.com/
- Your firewall/proxy settings
