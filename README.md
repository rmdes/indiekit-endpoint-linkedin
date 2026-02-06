# @rmdes/indiekit-endpoint-linkedin

LinkedIn OAuth 2.0 endpoint for [Indiekit](https://getindiekit.com). Provides a UI-based flow to connect your LinkedIn account and manage access tokens, designed as a companion to [`@rmdes/indiekit-syndicator-linkedin`](https://github.com/rmdes/indiekit-syndicator-linkedin).

Originally based on work by [Giacomo Debidda](https://giacomodebidda.com) ([jackdbd](https://github.com/jackdbd)), from an unmerged [pull request](https://github.com/jackdbd/indiekit/tree/feat/531-linkedin-syndicator) to the Indiekit monorepo.

## Installation

```bash
npm install @rmdes/indiekit-endpoint-linkedin
```

## Requirements

- A LinkedIn account with a [registered application](https://www.linkedin.com/developers/apps)
- OAuth scopes: `openid`, `profile`, `w_member_social`
- Client ID and Client Secret stored as environment variables (or in config)
- MongoDB configured in Indiekit (for token persistence across restarts)

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

1. Go to [LinkedIn Developers](https://www.linkedin.com/developers/apps) and create an app
2. Under **Auth**, add your callback URL: `https://your-indiekit-domain/linkedin/callback`
3. Under **Products**, request access to "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect"
4. Copy the Client ID and Client Secret to your environment variables

## Credits

This package is based on the LinkedIn endpoint originally written by [Giacomo Debidda](https://giacomodebidda.com) as an unmerged PR to the [Indiekit monorepo](https://github.com/getindiekit/indiekit). Extended with MongoDB token persistence, CSRF protection, and proper error handling.

## License

MIT
