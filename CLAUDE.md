# CLAUDE.md - LinkedIn OAuth Endpoint Plugin

## Package Overview

**Package:** `@rmdes/indiekit-endpoint-linkedin`
**Purpose:** LinkedIn OAuth 2.0 endpoint for Indiekit — provides UI-based token acquisition and management
**Relationship:** Companion plugin to `@rmdes/indiekit-syndicator-linkedin` (syndicator reads tokens, endpoint writes tokens)

This plugin handles the OAuth 2.0 authorization flow with LinkedIn, stores access tokens in MongoDB, and exposes them via `process.env.LINKEDIN_ACCESS_TOKEN` for immediate use by the syndicator plugin.

## Architecture

### Token Flow

```
User → /linkedin (status page)
     → /linkedin/auth (start OAuth)
     → LinkedIn consent page
     → /linkedin/callback (receive code)
     → Exchange code for token
     → Store in MongoDB + process.env
     → Syndicator reads process.env.LINKEDIN_ACCESS_TOKEN
```

### Storage Strategy (Dual Persistence)

1. **MongoDB (persistent):** Stored as `{ _id: "current", access_token, updated_at, expires_at, id_token? }`
2. **process.env (runtime):** Set immediately on save/restore for syndicator consumption

**Why both?** MongoDB persists across restarts. `process.env` provides immediate access without async DB reads in the syndicator.

### Key Files

| File | Purpose |
|------|---------|
| `index.js` | Main plugin class — defines routes, OAuth flow, CSRF protection |
| `lib/token.js` | Token storage/retrieval — saves to MongoDB and `process.env` |
| `views/linkedin.njk` | Status page — shows connection state, expiry, reconnect button |
| `assets/icon.svg` | LinkedIn logo for Indiekit UI |

## OAuth Flow Implementation

### Route: GET /linkedin

**Purpose:** Status dashboard showing connection state

**Logic:**
1. Check MongoDB for `{ _id: "current" }` document
2. If `access_token` exists → "Connected", display `updated_at` and `expires_at`
3. Fallback: if no DB but `process.env.LINKEDIN_ACCESS_TOKEN` exists → "Connected"
4. Display success/error messages from query params

**Template variables:**
- `connected` — Boolean, whether token exists
- `updatedAt` — Locale string of last token update
- `expiresAt` — Locale string of token expiry
- `authHref` — URL to start OAuth flow
- `success` — Success message from query param
- `error` — Error message from query param

### Route: GET /linkedin/auth

**Purpose:** Start OAuth authorization flow

**Steps:**
1. Validate `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are set
2. Generate CSRF state token (`crypto.randomUUID()`)
3. Store state in `request.session.linkedinOauthState`
4. Derive callback URL from request headers (handles reverse proxy scenarios)
5. Build authorization URL **manually** (LinkedIn requires proper space encoding in scopes)
6. Redirect to LinkedIn consent page

**Critical detail:** Does NOT use `simple-oauth2`'s `authorizeURL()` method because it doesn't encode scopes correctly for LinkedIn's API. Constructs the URL manually with proper `encodeURIComponent()` handling.

**Authorization URL structure:**
```
https://www.linkedin.com/oauth/v2/authorization?
  response_type=code&
  client_id=<CLIENT_ID>&
  redirect_uri=<CALLBACK_URL>&
  scope=<SCOPES>&
  state=<CSRF_TOKEN>
```

### Route: GET /linkedin/callback

**Purpose:** Handle OAuth callback from LinkedIn

**Steps:**
1. Check for LinkedIn-reported errors (`error` query param)
2. Validate CSRF state matches session-stored value
3. Clear session state
4. Derive callback URL (must match the URL used in `/auth`)
5. Exchange authorization code for access token using `simple-oauth2`
6. Save token to MongoDB + `process.env` via `saveToken()`
7. Redirect to `/linkedin?success=true`

**Error handling:** All failures redirect to `/linkedin?error=<message>` for user-friendly display.

**OAuth client configuration:**
```js
const oauthClient = new AuthorizationCode({
  client: {
    id: endpoint.options.clientId,
    secret: endpoint.options.clientSecret,
  },
  options: { authorizationMethod: "body" },
  auth: {
    authorizeHost: "https://www.linkedin.com",
    authorizePath: "/oauth/v2/authorization",
    tokenHost: "https://www.linkedin.com",
    tokenPath: "/oauth/v2/accessToken",
  },
});
```

## Token Storage (`lib/token.js`)

### `saveToken(collection, tokenData)`

**Purpose:** Persist token to MongoDB and `process.env`

**Parameters:**
- `collection` — MongoDB collection (nullable)
- `tokenData` — OAuth response object from `simple-oauth2`
  - `access_token` (required) — LinkedIn API access token
  - `id_token` (optional) — OpenID Connect ID token
  - `expires_in` (optional) — Token lifetime in seconds

**Behavior:**
1. Always update `process.env.LINKEDIN_ACCESS_TOKEN` (even if DB unavailable)
2. If DB available, upsert document:
   ```js
   {
     _id: "current",
     access_token: "...",
     updated_at: new Date(),  // Date object
     expires_at: new Date(Date.now() + expires_in * 1000),  // calculated expiry
     id_token: "..."  // optional
   }
   ```

**Gotcha:** Stores `updated_at` and `expires_at` as JavaScript `Date` objects (not ISO strings). The view template converts these to locale strings with `new Date(...).toLocaleString()`.

### `restoreToken(collection)`

**Purpose:** Load token from MongoDB into `process.env` on app startup

**Returns:** Token document or `null`

**Behavior:**
1. Query MongoDB for `{ _id: "current" }`
2. If found, set `process.env.LINKEDIN_ACCESS_TOKEN = doc.access_token`
3. Return the document (contains `updated_at`, `expires_at` for logging/debugging)

**Called from:** `init()` method as fire-and-forget (`.catch(() => {})`)

**Why fire-and-forget?** If DB is unavailable on startup, plugin still initializes. Token can be set manually via env var or through OAuth flow.

## Configuration

### Environment Variables (Required)

| Variable | Description |
|----------|-------------|
| `LINKEDIN_CLIENT_ID` | OAuth app Client ID from LinkedIn Developer Portal |
| `LINKEDIN_CLIENT_SECRET` | OAuth app Client Secret |

### Environment Variables (Runtime, managed by plugin)

| Variable | Description |
|----------|-------------|
| `LINKEDIN_ACCESS_TOKEN` | Current access token — set by this plugin, read by syndicator |

### Plugin Options

```js
{
  clientId: "...",          // Override env var
  clientSecret: "...",      // Override env var
  mountPath: "/linkedin",   // URL path for endpoint
  scopes: [                 // OAuth 2.0 scopes
    "openid",
    "profile",
    "w_member_social"
  ]
}
```

**Default scopes:**
- `openid` — Sign in with LinkedIn
- `profile` — Access profile data
- `w_member_social` — Post on behalf of user (required for syndicator)

## Inter-Plugin Relationships

### With `@rmdes/indiekit-syndicator-linkedin`

**Data flow:**
1. User authorizes via this endpoint → token saved to `process.env.LINKEDIN_ACCESS_TOKEN`
2. Syndicator reads `process.env.LINKEDIN_ACCESS_TOKEN` on instantiation
3. Syndicator uses token to make LinkedIn API calls (create posts, share links, etc.)

**Dependency:** Syndicator does NOT depend on this endpoint's MongoDB collection. It only reads `process.env.LINKEDIN_ACCESS_TOKEN`, which can be set manually or by this plugin.

**Typical config:**
```js
export default {
  plugins: [
    "@rmdes/indiekit-endpoint-linkedin",    // Token management
    "@rmdes/indiekit-syndicator-linkedin",  // Post syndication
  ],
  "@rmdes/indiekit-syndicator-linkedin": {
    authorName: "Your Name",
    authorProfileUrl: "https://www.linkedin.com/in/yourname",
    checked: true,
  },
};
```

### With Indiekit Core

**Collections:** Adds `linkedin_tokens` MongoDB collection via `Indiekit.addCollection()`

**Endpoints:** Registers routes via `Indiekit.addEndpoint(this)`

**Session:** Requires Indiekit session middleware (stores CSRF state)

**Environment validation:** Declares `environment` property so Indiekit can validate required env vars on startup

## LinkedIn API Setup

### Developer Portal Steps

1. Go to https://www.linkedin.com/developers/apps
2. Create a new app (or use existing)
3. Under **Auth** → **OAuth 2.0 settings**:
   - Add redirect URL: `https://your-indiekit-domain/linkedin/callback`
   - Note: Must be HTTPS in production (LinkedIn rejects HTTP callbacks)
4. Under **Products**:
   - Request access to "Share on LinkedIn"
   - Request access to "Sign In with LinkedIn using OpenID Connect"
   - Wait for approval (usually instant for OAuth products)
5. Copy **Client ID** and **Client Secret** to environment variables

### Required Scopes

- `openid` — Authentication (Sign In with LinkedIn)
- `profile` — Read profile data
- `w_member_social` — Write posts to LinkedIn feed (required for syndicator)

### Token Expiry

LinkedIn access tokens expire after **60 days**. The plugin stores `expires_at` in MongoDB but does NOT automatically refresh tokens. Users must manually reconnect via `/linkedin` when tokens expire.

**Future improvement:** Implement OAuth refresh token flow for automatic renewal.

## Security Features

### CSRF Protection

- Generates random state token (`crypto.randomUUID()`) on `/auth`
- Stores in session (`request.session.linkedinOauthState`)
- Validates on `/callback` — rejects if mismatch
- Clears from session after use (prevents replay attacks)

**Attack prevented:** Prevents attackers from tricking users into authorizing attacker's LinkedIn account by forging callback requests.

### Reverse Proxy Compatibility

- Derives callback URL from `x-forwarded-proto` and `x-forwarded-host` headers
- Handles cases where Indiekit runs behind nginx, Caddy, or Cloudron proxy
- Ensures callback URL sent to LinkedIn matches the URL LinkedIn redirects to

**Why this matters:** If Indiekit sees requests as `http://localhost:3000` but users access via `https://example.com`, callback URL mismatch breaks OAuth flow.

### Error Handling

- All OAuth errors redirect to `/linkedin?error=<message>`
- Displays errors in Nunjucks notification banner
- No sensitive data (secrets, tokens) in error messages
- LinkedIn-reported errors (`error_description`) passed through verbatim

## Common Gotchas

### 1. Scope Encoding

**Problem:** `simple-oauth2`'s `authorizeURL()` doesn't encode scopes correctly for LinkedIn.

**Solution:** Manually construct authorization URL with `encodeURIComponent(scopes.join(" "))`.

**Why:** LinkedIn expects scopes as space-separated string (`openid profile w_member_social`), not individual parameters. The library's default encoding breaks this.

### 2. Callback URL Mismatch

**Problem:** Callback URL sent to LinkedIn must EXACTLY match the URL LinkedIn redirects to.

**Solution:** Both `/auth` and `/callback` routes derive the callback URL using the same logic (from request headers). If deployment changes (HTTP→HTTPS, domain change), URL automatically adapts.

**Debug tip:** Check LinkedIn Developer Portal → Your App → Auth → OAuth 2.0 settings. Callback URL must match exactly (protocol, domain, path).

### 3. Token Not Available to Syndicator

**Problem:** Token exists in MongoDB but syndicator can't access it.

**Cause:** Syndicator reads `process.env.LINKEDIN_ACCESS_TOKEN`, which is only set on app startup (via `restoreToken()`) or when user authorizes.

**Solution:** Restart Indiekit after manual DB edits, or use `/linkedin` UI to re-authorize.

### 4. Date Storage Convention

**Pattern:** Stores `updated_at` and `expires_at` as JavaScript `Date` objects in MongoDB, not ISO strings.

**Why:** Template uses `new Date(...).toLocaleString()` for display, NOT the `| date` Nunjucks filter.

**Contrast:** Most other `@rmdes/*` plugins store dates as ISO strings and use `| date` filter. This plugin predates that convention.

**If migrating to ISO strings:** Change `lib/token.js` to use `.toISOString()`, and update template to use `{% if expiresAt %}{{ expiresAt | date("PPp") }}{% endif %}`.

### 5. Session Dependency

**Problem:** OAuth flow fails with "state mismatch" error.

**Cause:** Indiekit session middleware not configured, or session storage (Redis/MongoDB) unavailable.

**Solution:** Ensure Indiekit has session storage configured. Check `indiekit.config.js` for session settings.

## Commands

```bash
# Publish to npm (requires OTP)
npm publish

# Install in Indiekit project
npm install @rmdes/indiekit-endpoint-linkedin

# Check token in MongoDB (if using mongosh)
db.linkedin_tokens.findOne({ _id: "current" })

# Verify token in environment (from inside container/process)
echo $LINKEDIN_ACCESS_TOKEN
```

## Debugging

### Check Token Status

1. Navigate to `/linkedin` in Indiekit UI
2. Look for "Connected" status
3. Check "Token last updated" and "Token expires" timestamps
4. If "Not connected", click "Connect to LinkedIn" to start OAuth flow

### Verify Token in Database

```js
const collection = Indiekit.collections.get("linkedin_tokens");
const doc = await collection.findOne({ _id: "current" });
console.log(doc);
// Expected output:
// {
//   _id: "current",
//   access_token: "AQV...",
//   updated_at: 2025-02-06T19:15:00.000Z,
//   expires_at: 2025-04-07T19:15:00.000Z,
//   id_token: "eyJ..."
// }
```

### Verify Token in Environment

```bash
# In Indiekit container/process
echo $LINKEDIN_ACCESS_TOKEN
```

### Test Syndicator Integration

1. Authorize via `/linkedin` (should see "Successfully connected" message)
2. Create a test post with LinkedIn syndication checkbox enabled
3. Check syndicator logs for API calls:
   ```
   POST https://api.linkedin.com/rest/posts
   Authorization: Bearer AQV...
   ```
4. Verify post appears on LinkedIn feed

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "LinkedIn OAuth credentials not configured" | Missing env vars | Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` |
| "state mismatch" | Session not persisted or CSRF attack | Check session storage configuration |
| "redirect_uri mismatch" | Callback URL not registered in LinkedIn app | Add exact callback URL to LinkedIn Developer Portal |
| "invalid_scope" | Requested scope not approved for app | Request access to required products in Developer Portal |

## Credits

Based on the LinkedIn endpoint originally written by [Giacomo Debidda](https://giacomodebidda.com) ([jackdbd](https://github.com/jackdbd)) as an unmerged [pull request](https://github.com/jackdbd/indiekit/tree/feat/531-linkedin-syndicator) to the Indiekit monorepo. Extended with:

- MongoDB token persistence
- CSRF state validation
- Reverse proxy header handling
- Token expiry tracking
- Improved error messages
- Nunjucks template for status page
- Fire-and-forget token restoration on startup

## Related Documentation

- [LinkedIn OAuth 2.0 Documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication)
- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [Indiekit Plugin API](https://getindiekit.com/plugins)
- [@rmdes/indiekit-syndicator-linkedin](https://github.com/rmdes/indiekit-syndicator-linkedin)
