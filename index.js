import crypto from "node:crypto";
import process from "node:process";
import express from "express";
import { AuthorizationCode } from "simple-oauth2";
import { saveToken, restoreToken } from "./lib/token.js";

const AUTH = {
  authorizeHost: "https://www.linkedin.com",
  authorizePath: "/oauth/v2/authorization",
  tokenHost: "https://www.linkedin.com",
  tokenPath: "/oauth/v2/accessToken",
};

const defaults = {
  mountPath: "/linkedin",
  scopes: ["openid", "profile", "w_member_social"],
  clientId: process.env.LINKEDIN_CLIENT_ID,
  clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
};

export default class LinkedInEndpoint {
  name = "LinkedIn endpoint";

  /**
   * @param {object} [options] - Plug-in options
   * @param {string} [options.clientId] - LinkedIn OAuth app Client ID
   * @param {string} [options.clientSecret] - LinkedIn OAuth app Client Secret
   * @param {string} [options.mountPath] - Path to mount endpoint (default "/linkedin")
   * @param {Array<string>} [options.scopes] - OAuth 2.0 scopes
   */
  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.mountPath = this.options.mountPath;
    this.collection = null;
  }

  get environment() {
    return ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"];
  }

  get routes() {
    const router = express.Router({ caseSensitive: true, mergeParams: true });
    const endpoint = this;

    // GET / — Auth page showing connection status
    router.get("/", async (request, response) => {
      let connected = false;
      let updatedAt = null;
      let expiresAt = null;

      if (endpoint.collection) {
        try {
          const doc = await endpoint.collection.findOne({ _id: "current" });
          if (doc?.access_token) {
            connected = true;
            if (doc.updated_at) {
              updatedAt = new Date(doc.updated_at).toLocaleString();
            }
            if (doc.expires_at) {
              expiresAt = new Date(doc.expires_at).toLocaleString();
            }
          }
        } catch {
          // DB unavailable — check env var
        }
      }

      if (!connected && process.env.LINKEDIN_ACCESS_TOKEN) {
        connected = true;
      }

      return response.render("linkedin", {
        title: "LinkedIn",
        connected,
        updatedAt,
        expiresAt,
        authHref: `${endpoint.mountPath}/auth`,
        success:
          request.query.success === "true"
            ? "Successfully connected to LinkedIn. Your access token has been saved."
            : undefined,
        error: request.query.error
          ? decodeURIComponent(request.query.error)
          : undefined,
      });
    });

    // GET /auth — Start OAuth flow
    router.get("/auth", (request, response) => {
      const { clientId, scopes } = endpoint.options;

      if (!clientId || !endpoint.options.clientSecret) {
        const error = encodeURIComponent(
          "LinkedIn OAuth credentials not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.",
        );
        return response.redirect(`${endpoint.mountPath}?error=${error}`);
      }

      // Generate CSRF state and store in session
      const state = crypto.randomUUID();
      request.session.linkedinOauthState = state;

      // Derive callback URL from the current request
      const protocol = request.headers["x-forwarded-proto"] || request.protocol;
      const host = request.headers["x-forwarded-host"] || request.get("host");
      const callbackUrl = `${protocol}://${host}${endpoint.mountPath}/callback`;

      // Build authorization URL manually
      // (simple-oauth2's authorizeURL doesn't encode scopes correctly for LinkedIn)
      const params = [
        `response_type=code`,
        `client_id=${clientId}`,
        `redirect_uri=${encodeURIComponent(callbackUrl)}`,
        `scope=${encodeURIComponent(scopes.join(" "))}`,
        `state=${state}`,
      ].join("&");

      const authorizationUri = `${AUTH.authorizeHost}${AUTH.authorizePath}?${params}`;
      return response.redirect(authorizationUri);
    });

    // GET /callback — Handle OAuth callback from LinkedIn
    router.get("/callback", async (request, response) => {
      const { code, error, error_description, state } = request.query;

      // Handle LinkedIn-reported errors
      if (error) {
        const message = encodeURIComponent(
          error_description || `LinkedIn authorization failed: ${error}`,
        );
        return response.redirect(`${endpoint.mountPath}?error=${message}`);
      }

      // Validate CSRF state
      if (!state || state !== request.session.linkedinOauthState) {
        const message = encodeURIComponent(
          "Authorization failed: state mismatch. Please try again.",
        );
        return response.redirect(`${endpoint.mountPath}?error=${message}`);
      }

      // Clear state from session
      delete request.session.linkedinOauthState;

      // Derive callback URL (must match the one used in /auth)
      const protocol = request.headers["x-forwarded-proto"] || request.protocol;
      const host = request.headers["x-forwarded-host"] || request.get("host");
      const callbackUrl = `${protocol}://${host}${endpoint.mountPath}/callback`;

      try {
        const oauthClient = new AuthorizationCode({
          client: {
            id: endpoint.options.clientId,
            secret: endpoint.options.clientSecret,
          },
          options: { authorizationMethod: "body" },
          auth: AUTH,
        });

        const accessToken = await oauthClient.getToken({
          code,
          redirect_uri: callbackUrl,
          scope: encodeURIComponent(endpoint.options.scopes.join(" ")),
        });

        await saveToken(endpoint.collection, accessToken.token);

        return response.redirect(`${endpoint.mountPath}?success=true`);
      } catch (err) {
        const message = encodeURIComponent(
          `Could not obtain access token: ${err.message}`,
        );
        return response.redirect(`${endpoint.mountPath}?error=${message}`);
      }
    });

    return router;
  }

  init(Indiekit) {
    Indiekit.addCollection("linkedin_tokens");
    Indiekit.addEndpoint(this);

    this.collection = Indiekit.collections.get("linkedin_tokens");

    // Restore token from DB on startup (fire-and-forget)
    if (this.collection) {
      restoreToken(this.collection).catch(() => {});
    }
  }
}
