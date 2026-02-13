# @rmdes/indiekit-endpoint-linkedin

LinkedIn OAuth 2.0 endpoint for [Indiekit](https://getindiekit.com). Provides a UI-based flow to connect your LinkedIn account and manage access tokens.

**Companion plugin to [`@rmdes/indiekit-syndicator-linkedin`](https://github.com/rmdes/indiekit-syndicator-linkedin).** This endpoint handles OAuth authorization and token management, while the syndicator uses those tokens to post to LinkedIn.

Originally based on work by [Giacomo Debidda](https://giacomodebidda.com) ([jackdbd](https://github.com/jackdbd)), from an unmerged [pull request](https://github.com/jackdbd/indiekit/tree/feat/531-linkedin-syndicator) to the Indiekit monorepo.

## Features

- UI-based OAuth 2.0 authorization flow
- Automatic token persistence in MongoDB
- Token restoration on app restart
- CSRF protection for OAuth callbacks
- Reverse proxy compatibility (nginx, Caddy, Cloudron)
- Status dashboard showing connection state and token expiry
- Immediate token availability to syndicator via `process.env`

## Installation

```bash
npm install @rmdes/indiekit-endpoint-linkedin
```

## Requirements

- A LinkedIn account with a [registered application](https://www.linkedin.com/developers/apps)
- Required OAuth scopes: `openid`, `profile`, `w_member_social`
- Client ID and Client Secret (stored as environment variables or in config)
- MongoDB configured in Indiekit (recommended for token persistence across restarts)

## Usage

Add to your Indiekit configuration alongside the syndicator:

```js
export default {
  plugins: [
    "@rmdes/indiekit-syndicator-linkedin",
    "@rmdes/indiekit-endpoint-linkedin",
  ],
  "@rmdes/indiekit-syndicator-linkedin": {
    authorName: "Your Name",
    authorProfileUrl: "https://www.linkedin.com/in/yourname",
    checked: true,
  },
};
```

Set your environment variables:

```bash
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
```

## OAuth Flow

1. Navigate to `/linkedin` in the Indiekit UI
2. Click "Connect to LinkedIn"
3. Authorize the app on LinkedIn's consent page
4. You're redirected back — the token is saved automatically
5. The syndicator immediately picks up the new token

Tokens are persisted in MongoDB and restored automatically on app restart.

## Options

| Option         | Type     | Default              | Description                    |
| -------------- | -------- | -------------------- | ------------------------------ |
| `clientId`     | string   | env var              | LinkedIn OAuth app Client ID   |
| `clientSecret` | string   | env var              | LinkedIn OAuth app Secret      |
| `mountPath`    | string   | `"/linkedin"`        | URL path for the endpoint      |
| `scopes`       | string[] | `["openid", ...]`    | OAuth 2.0 scopes               |

## LinkedIn App Setup

### Step 1: Create a LinkedIn App

1. Go to [LinkedIn Developers](https://www.linkedin.com/developers/apps)
2. Click "Create app" and fill in the required details:
   - **App name**: Your application name
   - **LinkedIn Page**: Select your company page (or create one)
   - **Privacy policy URL**: Your site's privacy policy
   - **App logo**: Upload a logo (optional)

### Step 2: Configure OAuth Settings

1. In your app dashboard, go to the **Auth** tab
2. Under **OAuth 2.0 settings**, add your redirect URL:
   ```
   https://your-indiekit-domain/linkedin/callback
   ```
   - **Important**: Must be HTTPS in production (LinkedIn rejects HTTP callbacks)
   - Replace `your-indiekit-domain` with your actual domain
   - The path `/linkedin/callback` must match exactly (or use custom `mountPath`)

### Step 3: Request Product Access

1. Go to the **Products** tab
2. Request access to these products:
   - **Share on LinkedIn** — Required for posting content
   - **Sign In with LinkedIn using OpenID Connect** — Required for authentication
3. Wait for approval (usually instant for these products)

### Step 4: Copy Credentials

1. Go back to the **Auth** tab
2. Copy your **Client ID** and **Client Secret**
3. Add them to your environment variables:
   ```bash
   LINKEDIN_CLIENT_ID=your_client_id_here
   LINKEDIN_CLIENT_SECRET=your_client_secret_here
   ```

### Troubleshooting App Setup

- **Redirect URI mismatch**: Ensure the callback URL in your LinkedIn app settings matches exactly (protocol, domain, path)
- **Invalid scope**: Make sure you've requested and been approved for "Share on LinkedIn" and "Sign In with LinkedIn"
- **App not verified**: Some features may require app verification — check the **Settings** tab for verification status

## How It Works

### Token Flow

1. **User authorizes**: Navigate to `/linkedin` and click "Connect to LinkedIn"
2. **OAuth redirect**: Plugin redirects to LinkedIn's authorization page with CSRF protection
3. **User consents**: User approves the requested permissions on LinkedIn
4. **Token exchange**: LinkedIn redirects back with authorization code
5. **Token storage**: Plugin exchanges code for access token and stores in:
   - MongoDB (persistent storage)
   - `process.env.LINKEDIN_ACCESS_TOKEN` (runtime access)
6. **Syndicator uses token**: The syndicator plugin reads the token from `process.env` and uses it to post to LinkedIn

### Relationship with Syndicator Plugin

This endpoint and the syndicator work together:

- **Endpoint** (`@rmdes/indiekit-endpoint-linkedin`): Manages OAuth and stores tokens
- **Syndicator** (`@rmdes/indiekit-syndicator-linkedin`): Uses tokens to post content to LinkedIn

The syndicator reads `process.env.LINKEDIN_ACCESS_TOKEN`, which is set by this endpoint. You can use the syndicator without this endpoint by manually setting the environment variable, but this endpoint provides a much better user experience.

## Token Management

### Token Expiry

LinkedIn access tokens expire after **60 days**. The plugin displays the expiry date on the `/linkedin` status page. When your token expires:

1. Navigate to `/linkedin`
2. Click "Reconnect to LinkedIn"
3. Authorize again to get a fresh token

**Note**: The plugin does not currently support automatic token refresh. You must manually reconnect when tokens expire.

### Token Storage

Tokens are stored in two places:

1. **MongoDB collection** (`linkedin_tokens`): Persistent storage that survives app restarts
2. **Process environment** (`process.env.LINKEDIN_ACCESS_TOKEN`): Runtime access for the syndicator

On app startup, the plugin automatically restores the token from MongoDB to `process.env`.

## Troubleshooting

### "Not connected" status

**Check:**
- Have you completed the OAuth flow via `/linkedin`?
- Are your `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` set correctly?
- Is MongoDB running and accessible?

**Solution:** Navigate to `/linkedin` and click "Connect to LinkedIn"

### "State mismatch" error

**Cause:** Session not persisted between `/auth` and `/callback` requests

**Check:**
- Is Indiekit session middleware configured?
- Is session storage (Redis/MongoDB) running?

**Solution:** Ensure Indiekit has session storage configured in `indiekit.config.js`

### "Redirect URI mismatch" error

**Cause:** The callback URL doesn't match what's registered in LinkedIn app

**Check:**
- LinkedIn app callback URL: `https://your-domain/linkedin/callback`
- If using custom `mountPath`, adjust callback URL accordingly

**Solution:** Update callback URL in LinkedIn Developer Portal to match exactly

### Token exists but syndicator can't use it

**Cause:** Token stored in MongoDB but not loaded into `process.env`

**Solutions:**
- Restart Indiekit (tokens are restored on startup)
- Re-authorize via `/linkedin` (immediately sets `process.env`)

### "Invalid scope" error

**Cause:** Requested OAuth scopes not approved for your LinkedIn app

**Solution:** Go to LinkedIn Developer Portal → Products tab → Request access to required products

## Related Plugins

- [`@rmdes/indiekit-syndicator-linkedin`](https://github.com/rmdes/indiekit-syndicator-linkedin) — Posts content to LinkedIn using tokens managed by this endpoint
- [`@indiekit/endpoint-auth`](https://www.npmjs.com/package/@indiekit/endpoint-auth) — Indiekit's authentication endpoint
- [`@indiekit/endpoint-micropub`](https://www.npmjs.com/package/@indiekit/endpoint-micropub) — Micropub endpoint for creating posts

## Documentation

- **CLAUDE.md** — Comprehensive technical reference for developers working on this plugin
- **README.md** (this file) — User-facing documentation for installing and using the plugin

## Credits

This package is based on the LinkedIn endpoint originally written by [Giacomo Debidda](https://giacomodebidda.com) as an unmerged PR to the [Indiekit monorepo](https://github.com/getindiekit/indiekit). Extended with:

- MongoDB token persistence
- CSRF state validation
- Reverse proxy header handling
- Token expiry tracking
- Improved error messages
- Status dashboard UI

## License

MIT
